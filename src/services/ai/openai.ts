import { OpenAI } from 'openai';
import { AIResponse, AIMessage } from '../../types/ai-service.js';
import { BaseAIService } from './base-service.js';
import { MCPContainer } from '../../tools/mcp/di/container.js';
import { MCPError, ErrorType } from '../../types/errors.js';
import { aiRateLimiter } from './utils/rate-limiter.js';
import { debug, defaultConfig } from '../../utils/config.js';
import { CacheService, CacheType } from '../cache/cache-service.js';
import { 
    ChatCompletionMessageParam,
    ChatCompletionTool,
    ChatCompletion,
    ChatCompletionSystemMessageParam,
    ChatCompletionUserMessageParam,
    ChatCompletionAssistantMessageParam,
    ChatCompletionToolMessageParam
} from 'openai/resources/chat/completions.js';
import { ToolDefinition, ToolResponse } from '../../tools/mcp/types/tools.js';

// Custom debug logger for OpenAI
function logOpenAI(type: 'request' | 'response' | 'error', message: string, details?: any) {
    if (!defaultConfig.debug || !defaultConfig.logging.showRequests) return;
    
    // Always log errors regardless of debug settings
    if (type === 'error') {
        console.error(`OpenAI Error: ${message}`, details?.error || '');
        return;
    }

    // Only log requests/responses if log level is debug
    if (defaultConfig.logging.level !== 'debug') return;
    
    const timestamp = new Date().toISOString();
    const logMessage: any = {
        timestamp,
        type: `OpenAI:${type.toUpperCase()}`,
        message
    };
    
    // Redact sensitive information before logging
    function redactSensitiveInfo(obj: any): any {
        if (!obj) return obj;
        
        const sensitiveKeys = [
            'token', 'key', 'password', 'secret', 'auth', 'credential',
            'GITHUB_PERSONAL_ACCESS_TOKEN', 'OPENAI_API_KEY', 'authorization'
        ];
        
        if (typeof obj === 'string') {
            // Check if the string looks like a token/key (long string with special chars)
            if (obj.length > 20 && /[A-Za-z0-9_\-\.]+/.test(obj)) {
                return '[REDACTED]';
            }
            return obj;
        }
        
        if (Array.isArray(obj)) {
            return obj.map(item => redactSensitiveInfo(item));
        }
        
        if (typeof obj === 'object') {
            const redacted = { ...obj };
            for (const [key, value] of Object.entries(redacted)) {
                if (sensitiveKeys.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
                    redacted[key] = '[REDACTED]';
                } else if (typeof value === 'object') {
                    redacted[key] = redactSensitiveInfo(value);
                }
            }
            return redacted;
        }
        
        return obj;
    }
    
    // Filter and format request details
    if (type === 'request' && details?.body) {
        logMessage.details = redactSensitiveInfo({
            model: details.body.model,
            messageCount: details.body.messages?.length || 0,
            toolCount: details.body.tools?.length || 0,
            temperature: details.body.temperature
        });
    }
    
    // Filter and format response details
    if (type === 'response' && details?.response) {
        logMessage.details = redactSensitiveInfo({
            id: details.response.id,
            model: details.response.model,
            usage: details.response.usage,
            finishReason: details.response.choices?.[0]?.finish_reason
        });
    }

    console.log(JSON.stringify(logMessage));
}

export class OpenAIService extends BaseAIService {
    private readonly openai: OpenAI;
    private readonly model: string;
    private readonly maxRetries: number;
    private readonly temperature: number;
    private readonly messageCache: CacheService;

    constructor(container: MCPContainer) {
        super(container);
        
        if (!process.env.OPENAI_API_KEY) {
            throw new MCPError('OpenAI API key not found', ErrorType.API_ERROR);
        }
        
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        this.model = defaultConfig.openai.model;
        this.maxRetries = defaultConfig.openai.maxRetries;
        this.temperature = defaultConfig.openai.temperature;
        
        // Initialize message cache with proper store configuration
        this.messageCache = CacheService.getInstance({
            type: CacheType.SENSITIVE,
            namespace: 'openai-messages',
            ttl: 5 * 60 * 1000, // 5 minutes
            filename: 'openai-messages.json', // Add persistent storage
            writeDelay: 100 // Add write delay for performance
        });
    }

    async generateResponse(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse> {
        try {
            aiRateLimiter.checkLimit('gpt');
            
            const systemPrompt = await this.getSystemPrompt();
            const messages = await this.prepareMessages(systemPrompt, message, conversationHistory);
            const tools = await this.toolManager.getAvailableTools();

            return tools.length > 0 
                ? this.handleToolBasedCompletion(messages, tools)
                : this.handleSimpleCompletion(messages);
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            debug(err.message, defaultConfig);
            throw new MCPError('Failed to generate response', ErrorType.API_ERROR, { cause: err });
        }
    }

    private async prepareMessages(
        systemPrompt: string,
        message: string,
        conversationHistory?: AIMessage[]
    ): Promise<ChatCompletionMessageParam[]> {
        // Create a more reliable cache key using hash of content
        const cacheKey = `messages:${this.hashContent(systemPrompt)}:${this.hashContent(message)}:${conversationHistory?.length || 0}`;
        
        // Try to get from cache first
        const cachedMessages = await this.messageCache.get<ChatCompletionMessageParam[]>(cacheKey);
        if (cachedMessages) {
            return cachedMessages;
        }

        const messages: ChatCompletionMessageParam[] = [
            { 
                role: 'system', 
                content: systemPrompt 
            } as ChatCompletionSystemMessageParam
        ];

        if (conversationHistory) {
            // Estimate tokens in system prompt and current message
            const estimatedSystemTokens = this.estimateTokens(systemPrompt);
            const estimatedMessageTokens = this.estimateTokens(message);
            let availableTokens = defaultConfig.messageHandling.maxTokens - 
                                estimatedSystemTokens - 
                                estimatedMessageTokens - 
                                defaultConfig.messageHandling.tokenBuffer;

            // Process history from most recent to oldest
            const relevantHistory = this.selectRelevantMessages(
                conversationHistory,
                availableTokens
            );

            // Add selected messages
            for (const msg of relevantHistory) {
                let message: ChatCompletionMessageParam | undefined;
                switch (msg.role) {
                    case 'system':
                        message = {
                            role: 'system',
                            content: msg.content
                        } as ChatCompletionSystemMessageParam;
                        break;
                    case 'user':
                        message = {
                            role: 'user',
                            content: msg.content
                        } as ChatCompletionUserMessageParam;
                        break;
                    case 'assistant':
                        message = {
                            role: 'assistant',
                            content: msg.content
                        } as ChatCompletionAssistantMessageParam;
                        break;
                    case 'tool':
                        if (msg.tool_call_id) {
                            message = {
                                role: 'tool',
                                content: msg.content,
                                tool_call_id: msg.tool_call_id
                            } as ChatCompletionToolMessageParam;
                        }
                        break;
                }
                if (message) {
                    messages.push(message);
                }
            }
        }

        // Add the current user message
        messages.push({
            role: 'user',
            content: message
        } as ChatCompletionUserMessageParam);

        // Cache the prepared messages
        await this.messageCache.set(cacheKey, messages);
        return messages;
    }

    private selectRelevantMessages(
        history: AIMessage[],
        availableTokens: number
    ): AIMessage[] {
        const selected: AIMessage[] = [];
        let tokenCount = 0;

        // Start from the most recent messages
        const recentMessages = history
            .slice(-defaultConfig.messageHandling.maxContextMessages)
            .reverse();

        for (const msg of recentMessages) {
            const estimatedTokens = this.estimateTokens(msg.content);
            
            // Check if adding this message would exceed our token budget
            if (tokenCount + estimatedTokens > availableTokens) {
                break;
            }

            // Add message and update token count
            selected.unshift(msg);
            tokenCount += estimatedTokens;
        }

        return selected;
    }

    private estimateTokens(text: string): number {
        // Rough estimation: ~4 characters per token
        return Math.ceil(text.length / 4);
    }

    private async handleSimpleCompletion(
        messages: ChatCompletionMessageParam[]
    ): Promise<AIResponse> {
        const completion = await this.openai.chat.completions.create({
            model: this.model,
            messages,
            temperature: this.temperature
        });

        return {
            content: completion.choices[0].message.content || '',
            tokenCount: completion.usage?.total_tokens || null,
            toolResults: []
        };
    }

    private async handleToolBasedCompletion(
        messages: ChatCompletionMessageParam[],
        tools: ToolDefinition[]
    ): Promise<AIResponse> {
        let currentMessages = [...messages];
        let totalTokens = 0;
        let allToolResults: ToolResponse[] = [];
        let retryCount = 0;
        let lastError: Error | null = null;

        while (retryCount < this.maxRetries) {
            try {
                const completion = await this.createToolCompletion(currentMessages, tools);
                totalTokens += completion.usage?.total_tokens || 0;
                
                const responseMessage = completion.choices[0].message;
                if (!responseMessage.tool_calls?.length) {
                    return {
                        content: responseMessage.content || '',
                        tokenCount: totalTokens,
                        toolResults: allToolResults.map(result => ({
                            content: [{
                                type: 'text',
                                text: JSON.stringify(result.data)
                            }],
                            success: result.success
                        }))
                    };
                }

                // Add the assistant's message with tool calls
                currentMessages.push(responseMessage);
                
                // Execute all tool calls in parallel
                const toolResults = await Promise.all(
                    responseMessage.tool_calls.map(async toolCall => {
                        try {
                            const args = JSON.parse(toolCall.function.arguments);
                            const result = await this.toolManager.executeTool(
                                toolCall.function.name,
                                args
                            );
                            
                            // Add tool response message
                            currentMessages.push({
                                role: 'tool',
                                content: JSON.stringify(result),
                                tool_call_id: toolCall.id
                            } as ChatCompletionToolMessageParam);

                            return result;
                        } catch (error) {
                            const err = error instanceof Error ? error : new Error(String(error));
                            lastError = err;
                            
                            // Log specific error details
                            debug(`Tool execution error (${toolCall.function.name}): ${err.message}`, defaultConfig);
                            
                            // Create error result
                            const errorResult = {
                                success: false,
                                data: { error: err.message }
                            };

                            // Add tool error response message
                            currentMessages.push({
                                role: 'tool',
                                content: JSON.stringify(errorResult),
                                tool_call_id: toolCall.id
                            } as ChatCompletionToolMessageParam);

                            return errorResult;
                        }
                    })
                );

                // Add all results to the collection
                allToolResults.push(...toolResults);

                // Continue the conversation to handle the tool results
                continue;
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                debug('OpenAI API error: ' + err.message);
                lastError = err;
                retryCount++;
            }
        }

        // If we've exhausted retries or hit an error, return the error state
        if (lastError) {
            throw new MCPError('Failed to complete tool-based conversation', ErrorType.API_ERROR, { cause: lastError });
        }

        // Return final response
        const lastMessage = currentMessages[currentMessages.length - 1];
        const finalContent = typeof lastMessage?.content === 'string' 
            ? lastMessage.content 
            : 'Failed to generate response';

        return {
            content: finalContent,
            tokenCount: totalTokens,
            toolResults: allToolResults.map(result => ({
                content: [{
                    type: 'text',
                    text: JSON.stringify(result.data)
                }],
                success: result.success
            }))
        };
    }

    private async createToolCompletion(
        messages: ChatCompletionMessageParam[],
        tools: ToolDefinition[]
    ): Promise<ChatCompletion> {
        try {
            // Create a cache key based on messages and tools
            const cacheKey = `tool_completion:${this.hashMessages(messages)}:${this.hashTools(tools)}`;
            
            // Try to get from cache first
            const cachedCompletion = await this.messageCache.get<ChatCompletion>(cacheKey);
            if (cachedCompletion) {
                logOpenAI('response', 'Using cached chat completion');
                return cachedCompletion;
            }

            const formattedTools = tools.map(tool => {
                // Convert to OpenAI function definition format
                const functionDef: ChatCompletionTool = {
                    type: 'function',
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.inputSchema
                    }
                };

                return functionDef;
            });

            logOpenAI('request', 'Creating chat completion');

            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages,
                tools: formattedTools,
                tool_choice: 'auto',
                temperature: this.temperature
            });

            // Cache the completion
            await this.messageCache.set(cacheKey, response);

            logOpenAI('response', 'Chat completion created', { response });
            return response;

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logOpenAI('error', 'Failed to create chat completion', { 
                error: err.message,
                model: this.model
            });
            throw new MCPError('Failed to create chat completion', ErrorType.API_ERROR, { cause: err });
        }
    }

    private hashMessages(messages: ChatCompletionMessageParam[]): string {
        // Create a deterministic hash of messages for caching
        return messages.map(msg => {
            const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            return `${msg.role}:${content.slice(0, 50)}`;
        }).join('|');
    }

    private hashTools(tools: ToolDefinition[]): string {
        // Create a deterministic hash of tools for caching
        return tools.map(tool => `${tool.name}`).sort().join('|');
    }

    private hashContent(content: string): string {
        // Create a simple hash of the content
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }

    async processMessage(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse> {
        return this.generateResponse(message, conversationHistory);
    }

    getModel(): string {
        return 'gpt';
    }
}
