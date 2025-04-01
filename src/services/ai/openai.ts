import { OpenAI } from 'openai';
import { AIResponse, AIMessage } from '../../types/ai-service.js';
import { BaseAIService } from './base-service.js';
import { MCPContainer } from '../../tools/mcp/di/container.js';
import { MCPError, ErrorType } from '../../types/errors.js';
import { aiRateLimiter } from './utils/rate-limiter.js';
import { defaultConfig, modelConfig } from '../../utils/config.js';
import { 
    ChatCompletionMessageParam,
    ChatCompletionTool,
    ChatCompletion,
    ChatCompletionToolMessageParam,
    ChatCompletionCreateParams,
    ChatCompletionMessageToolCall
} from 'openai/resources/chat/completions.js';
import { ToolDefinition, ToolResponse } from '../../tools/mcp/types/tools.js';
import { CacheService, CacheType } from '../cache/cache-service.js';
import { info, error as logError, warn, debug } from '../../utils/logger.js';
import { createLogContext, createErrorContext, LogContext } from '../../utils/log-utils.js';
import path from 'path';
import fs from 'fs';
import type { CacheConfig } from '../../types/cache/base.js';

const COMPONENT = 'OpenAIService';

// Add custom cache config interface that extends the base config
interface OpenAICacheConfig extends CacheConfig {
    maxSize?: number;
    onError?: (error: Error) => void;
}

export class OpenAIService extends BaseAIService {
    private readonly openai: OpenAI;
    private readonly model: string;
    private readonly temperature: number;
    private readonly messageCache: CacheService;

    constructor(container: MCPContainer) {
        super(container);
        
        if (!process.env.OPENAI_API_KEY) {
            throw new MCPError('OpenAI API key not found', ErrorType.API_ERROR);
        }
        
        // Configure OpenAI logging based on our config
        const logLevel = defaultConfig.logging.showRequests ? 'info' : 'warn';
        process.env.OPENAI_DEBUG = defaultConfig.logging.showRequests ? 'true' : undefined;
        process.env.OPENAI_LOG_LEVEL = logLevel;
        
        // Validate model
        const env = process.env.NODE_ENV || 'development';
        const envConfig = modelConfig[env as keyof typeof modelConfig];
        const configuredModel = process.env.OPENAI_MODEL || defaultConfig.openai.model;

        // Check if the model is in the available options
        const isValidModel = envConfig.options.some(model => model === configuredModel);
        if (!isValidModel) {
            throw new MCPError(
                `Unsupported model: ${configuredModel}. Available models for ${env}: ${envConfig.options.join(', ')}`,
                ErrorType.INVALID_MODEL
            );
        }
        
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            maxRetries: defaultConfig.openai.maxRetries || 3
        });
        
        this.model = configuredModel;
        this.temperature = defaultConfig.openai.temperature;

        // Initialize cache in a dedicated cache directory
        const cacheDir = path.join(process.cwd(), 'cache', env);
        
        // Ensure cache directory exists
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }

        const cacheFile = path.join(cacheDir, 'openai-messages.cache');
        
        const cacheConfig: OpenAICacheConfig = {
            type: CacheType.PERSISTENT,
            namespace: 'openai-messages',
            ttl: defaultConfig.discord.sessionTimeout * 60 * 60 * 1000,
            filename: cacheFile,
            writeDelay: 1000,
            maxSize: 1000,
            onError: (err: Error) => {
                logError('Cache error', createLogContext(
                    COMPONENT,
                    'cache',
                    { error: err.message }
                ));
            }
        };

        this.messageCache = CacheService.getInstance(cacheConfig);

        info('Service initialized', createLogContext(
            COMPONENT,
            'constructor',
            {
                model: this.model,
                environment: env,
                maxRetries: defaultConfig.openai.maxRetries || 3,
                temperature: this.temperature,
                cacheLocation: cacheFile
            }
        ));
    }

    async generateResponse(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse> {
        try {
            // Check rate limit
            aiRateLimiter.checkLimit('gpt');
            
            // Try to get from cache first
            const cacheKey = `${message}_${conversationHistory?.length || 0}_${this.systemPrompt}`;
            const cachedResponse = await this.messageCache.get(cacheKey);
            if (cachedResponse) {
                debug('Using cached response', createLogContext(
                    COMPONENT,
                    'generateResponse',
                    { cached: true, messageLength: message.length }
                ));
                return cachedResponse as AIResponse;
            }

            // Get system prompt and relevant tools
            const [systemPrompt, relevantTools] = await Promise.all([
                this.getSystemPrompt(),
                this.promptGenerator.getTools(message)
            ]);
            
            // Prepare messages
            const messages = this.prepareMessages(systemPrompt, message, conversationHistory);
            let currentMessages = [...messages];
            let totalTokens = 0;

            info('Starting OpenAI completion', createLogContext(
                COMPONENT,
                'generateResponse',
                {
                    messageLength: message.length,
                    toolCount: relevantTools.length,
                    historyLength: conversationHistory?.length || 0
                }
            ));

            // Initial completion to get tool calls
            const completion = await this.createCompletion(currentMessages, relevantTools);
            totalTokens += completion.usage?.total_tokens || 0;
            const choice = completion.choices[0];

            // If no tool calls, return response directly
            if (!choice.message.tool_calls) {
                const response = {
                    content: choice.message.content || '',
                    tokenCount: totalTokens,
                    toolResults: []
                };
                await this.messageCache.set(cacheKey, response);
                return response;
            }

            // Add assistant's message with tool calls
            currentMessages.push(choice.message);

            // Execute tool calls and collect results
            const toolResults = await Promise.all(
                choice.message.tool_calls.map(async toolCall => {
                    try {
                        const toolName = toolCall.function.name;
                        const args = this.parseToolArguments(toolCall.function.arguments);
                        
                        info('Executing tool', createLogContext(
                            COMPONENT,
                            'executeTool',
                            {
                                tool: toolName,
                                args: JSON.stringify(args),
                                toolCallId: toolCall.id
                            }
                        ));

                        const result = await this.toolManager.executeTool(toolName, args);

                        info('Tool execution completed', createLogContext(
                            COMPONENT,
                            'executeTool',
                            {
                                tool: toolName,
                                success: true,
                                resultSummary: typeof result.data === 'string' ? result.data.substring(0, 100) : 'object result'
                            }
                        ));

                        // Format result for tool response
                        const formattedResult = typeof result.data === 'string' 
                            ? result.data 
                            : JSON.stringify(result.data);

                        // Add tool response message
                        currentMessages.push({
                            role: 'tool',
                            content: formattedResult,
                            tool_call_id: toolCall.id
                        } as ChatCompletionToolMessageParam);

                        return {
                            success: true,
                            data: result.data,
                            metadata: {
                                toolName: toolCall.function.name
                            }
                        } as ToolResponse;
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        
                        logError('Tool execution failed', createErrorContext(
                            COMPONENT,
                            'executeTool',
                            'System',
                            'EXECUTION_ERROR',
                            error,
                            {
                                tool: toolCall.function.name,
                                args: toolCall.function.arguments
                            }
                        ));

                        // Add error response message
                        currentMessages.push({
                            role: 'tool',
                            content: `Error: ${errorMessage}`,
                            tool_call_id: toolCall.id
                        } as ChatCompletionToolMessageParam);

                        return {
                            tool: toolCall.function.name,
                            success: false,
                            data: null,
                            error: errorMessage
                        } as ToolResponse;
                    }
                })
            );

            // Get final response with tool results
            const finalCompletion = await this.createCompletion(currentMessages, []);
            totalTokens += finalCompletion.usage?.total_tokens || 0;

            info('OpenAI completion finished', createLogContext(
                COMPONENT,
                'generateResponse',
                {
                    totalTokens,
                    toolResults: toolResults.map(r => ({ toolName: r.metadata?.toolName || 'unknown', success: r.success }))
                }
            ));

            const response: AIResponse = {
                content: finalCompletion.choices[0].message.content || '',
                tokenCount: totalTokens,
                toolResults
            };

            await this.messageCache.set(cacheKey, response);
            return response;

        } catch (error) {
            if (error instanceof Error && error.message.includes('model')) {
                logError('Model configuration error', createErrorContext(
                    COMPONENT,
                    'generateResponse',
                    'System',
                    'INVALID_MODEL',
                    error,
                    { model: this.model }
                ));
                throw new MCPError('Invalid model configuration', ErrorType.INVALID_MODEL, { 
                    cause: error
                });
            }
            
            logError('Failed to generate response', createErrorContext(
                COMPONENT,
                'generateResponse',
                'System',
                'API_ERROR',
                error,
                {
                    model: this.model,
                    messageLength: message.length,
                    historyLength: conversationHistory?.length || 0
                }
            ));
            
            throw new MCPError('Failed to generate response', ErrorType.API_ERROR, { 
                cause: error instanceof Error ? error : new Error(String(error))
            });
        }
    }

    private prepareMessages(
        systemPrompt: string,
        message: string,
        history?: AIMessage[]
    ): ChatCompletionMessageParam[] {
        const messages: ChatCompletionMessageParam[] = [
            { role: 'system', content: systemPrompt }
        ];

        if (history) {
            const historyLimit = defaultConfig.messageHandling.maxContextMessages;
            const recentHistory = history.slice(-historyLimit);
            
            messages.push(...recentHistory.map(msg => 
                this.convertToCompletionMessage(msg)
            ));
        }

        messages.push({ role: 'user', content: message });
        return messages;
    }

    private convertToCompletionMessage(msg: AIMessage): ChatCompletionMessageParam {
        if (msg.role === 'tool' && msg.tool_call_id) {
            return {
                role: 'tool',
                content: msg.content,
                tool_call_id: msg.tool_call_id
            } as ChatCompletionToolMessageParam;
        }
        return {
            role: msg.role,
            content: msg.content,
            name: msg.name
        } as ChatCompletionMessageParam;
    }

    private parseToolArguments(args: string | undefined): Record<string, unknown> {
        try {
            return JSON.parse(args || '{}');
        } catch (error) {
            debug(`Failed to parse tool arguments: ${error}`);
            return {};
        }
    }

    private async createCompletion(
        messages: ChatCompletionMessageParam[],
        tools: ToolDefinition[]
    ): Promise<ChatCompletion> {
        debug(`Creating completion with ${tools.length} tools`);
        
        // Format tools for OpenAI function calling
        const formattedTools: ChatCompletionTool[] = tools.map(tool => ({
            type: 'function',
            function: {
                name: this.sanitizeToolName(tool.name),
                description: tool.description,
                parameters: {
                    type: 'object',
                    properties: tool.inputSchema.properties,
                    required: tool.inputSchema.required
                }
            }
        }));
        
        // Create the completion with formatted tools
        const completion = await this.openai.chat.completions.create({
            model: this.model,
            messages,
            tools: formattedTools.length > 0 ? formattedTools : undefined,
            tool_choice: formattedTools.length > 0 ? 'auto' : undefined,
            temperature: this.temperature
        });
        
        // Log token usage (keep this since it's important for cost tracking)
        if (completion.usage) {
            debug(`Token usage - Total: ${completion.usage.total_tokens} (Prompt: ${completion.usage.prompt_tokens}, Completion: ${completion.usage.completion_tokens})`);
        }
        
        return completion;
    }

    private sanitizeToolName(name: string): string {
        return name.replace(/[-\s]/g, '_').toLowerCase();
    }

    private async determineToolArgs(message: string, tool: ToolDefinition): Promise<any | null> {
        try {
            const completion = await this.createCompletion(
                [{
                    role: 'system',
                    content: `Extract arguments for the tool "${tool.name}" with schema: ${JSON.stringify(tool.inputSchema)}. Respond only with a valid JSON object containing the arguments.`
                },
                {
                    role: 'user',
                    content: message
                }],
                []
            );

            const argsString = completion.choices[0].message.content;
            if (!argsString) return null;

            try {
                return JSON.parse(argsString);
            } catch {
                return null;
            }
        } catch (error) {
            debug(`Failed to determine args for tool ${tool.name}`, { tool: tool.name } as Partial<LogContext>);
            return null;
        }
    }

    getModel(): string {
        return 'gpt';
    }
}
