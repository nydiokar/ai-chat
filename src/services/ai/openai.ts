import { OpenAI } from 'openai';
import { AIResponse, AIMessage } from '../../types/ai-service.js';
import { BaseAIService } from './base-service.js';
import { MCPContainer } from '../../tools/mcp/di/container.js';
import { MCPError, ErrorType } from '../../types/errors.js';
import { aiRateLimiter } from './utils/rate-limiter.js';
import { debug, defaultConfig, modelConfig } from '../../utils/config.js';
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
import { info, error as logError, warn } from '../../utils/logger.js';

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

        // Initialize cache in the appropriate environment directory
        const cacheFile = `logs/${env}/openai-messages.json`;
        
        this.messageCache = CacheService.getInstance({
            type: CacheType.PERSISTENT,
            namespace: 'openai-messages',
            ttl: defaultConfig.discord.sessionTimeout * 60 * 60 * 1000,
            filename: cacheFile,
            writeDelay: 100
        });

        info({
            component: 'OpenAI',
            message: 'Service initialized',
            model: this.model
        });
    }

    async generateResponse(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse> {
        try {
            // Check rate limit
            aiRateLimiter.checkLimit('gpt');
            
            // Try to get from cache first
            const cacheKey = `${message}_${conversationHistory?.length || 0}_${this.systemPrompt}`;
            const cachedResponse = await this.messageCache.get(cacheKey);
            if (cachedResponse) {
                debug('Using cached response');
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

            // Create initial completion
            const completion = await this.createCompletion(currentMessages, relevantTools);
            totalTokens += completion.usage?.total_tokens || 0;
            const choice = completion.choices[0];

            // If no tool calls, return response directly
            if (!choice.message.tool_calls) {
                return {
                    content: choice.message.content || '',
                    tokenCount: totalTokens,
                    toolResults: []
                };
            }

            // Add the assistant's message with tool calls
            currentMessages.push(choice.message);

            // Process tool calls
            const toolResults = await Promise.all(
                choice.message.tool_calls.map(async toolCall => {
                    try {
                        debug(`Executing tool ${toolCall.function.name} with args: ${toolCall.function.arguments}`);
                        const args = JSON.parse(toolCall.function.arguments || '{}');
                        const result = await this.toolManager.executeTool(
                            toolCall.function.name,
                            args
                        );
                        debug(`Tool ${toolCall.function.name} execution successful: ${JSON.stringify(result.data)}`);

                        // Format the result based on its type
                        let formattedResult: string;
                        if (typeof result.data === 'string') {
                            formattedResult = result.data;
                        } else if (Array.isArray(result.data) && result.data.every(item => typeof item.text === 'string')) {
                            formattedResult = result.data.map(item => item.text).join(' ');
                        } else {
                            formattedResult = JSON.stringify(result.data);
                        }

                        // Add tool response message
                        currentMessages.push({
                            role: 'tool',
                            content: formattedResult,
                            tool_call_id: toolCall.id
                        } as ChatCompletionToolMessageParam);

                        return result;
                    } catch (error) {
                        debug(`Tool execution error (${toolCall.function.name}): ${error}`);
                        const errorResult = {
                            success: false,
                            data: null,
                            error: error instanceof Error ? error.message : String(error)
                        };

                        // Add error response message with better formatting
                        currentMessages.push({
                            role: 'tool',
                            content: `Error executing ${toolCall.function.name}: ${errorResult.error}`,
                            tool_call_id: toolCall.id
                        } as ChatCompletionToolMessageParam);

                        return errorResult;
                    }
                })
            );

            // Get final response with tool results
            const finalCompletion = await this.createCompletion(currentMessages, relevantTools);
            totalTokens += finalCompletion.usage?.total_tokens || 0;

            const response: AIResponse = {
                content: finalCompletion.choices[0].message.content || '',
                tokenCount: totalTokens,
                toolResults
            };

            await this.messageCache.set(cacheKey, response);
            return response;

        } catch (error) {
            debug(`OpenAI error: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error && error.message.includes('model')) {
                throw new MCPError('Invalid model configuration', ErrorType.INVALID_MODEL, { 
                    cause: error
                });
            }
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
        const formattedTools: ChatCompletionTool[] = tools.map(tool => {
            debug(`Formatting tool: ${tool.name}`);
            return {
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
            };
        });
        
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

    getModel(): string {
        return 'gpt';
    }
}
