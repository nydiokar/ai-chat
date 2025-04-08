import { OpenAI } from 'openai';
import { Input, Response } from '../types/common.js';
import { LLMProvider } from '../interfaces/llm-provider.js';
import { MCPError, ErrorType } from '../types/errors.js';
import { debug } from '../utils/logger.js';
import { createLogContext } from '../utils/log-utils.js';
import { validateInput } from '../utils/ai-utils.js';
import { BaseConfig } from '../utils/config.js';
import { CacheService, CacheType } from '../services/cache/cache-service.js';
import { 
    ChatCompletionMessageParam,
    ChatCompletionTool, 
    ChatCompletion,
    ChatCompletionToolMessageParam
} from 'openai/resources/chat/completions.js';
import { ToolDefinition } from '../tools/mcp/types/tools.js';

export class OpenAIProvider implements LLMProvider {
    private client: OpenAI;
    private model: string;
    private temperature: number;
    private systemPrompt: string = '';
    private messageCache: CacheService;

    constructor(config: BaseConfig) {
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            maxRetries: config.openai.maxRetries || 3
        });
        this.model = config.openai.model;
        this.temperature = config.openai.temperature;
        
        // Initialize cache with default settings
        this.messageCache = CacheService.getInstance({
            type: CacheType.PERSISTENT,
            namespace: 'openai-messages',
            ttl: 3600, // 1 hour
            filename: 'openai-cache.json'
        });
    }

    async generateResponse(
        message: string, 
        conversationHistory?: Input[],
        tools?: ToolDefinition[]
    ): Promise<Response> {
        validateInput(message);

        try {
            debug('Generating response', createLogContext(
                'OpenAIProvider',
                'generateResponse',
                { 
                    model: this.model,
                    hasTools: !!tools?.length,
                    messageLength: message.length
                }
            ));

            // Try to get from cache first
            const cacheKey = `${message}_${conversationHistory?.length || 0}_${this.systemPrompt}_${tools?.length || 0}`;
            const cachedResponse = await this.messageCache.get(cacheKey);
            if (cachedResponse) {
                debug('Using cached response', createLogContext(
                    'OpenAIProvider',
                    'generateResponse',
                    { cached: true, messageLength: message.length }
                ));
                return cachedResponse as Response;
            }

            // Convert conversation history to OpenAI format
            const messages = this.convertToCompletionMessages(message, conversationHistory);
            
            // Add system prompt if set
            if (this.systemPrompt) {
                messages.unshift({ role: 'system', content: this.systemPrompt });
            }

            // Log the request
            debug('Sending request to OpenAI', createLogContext(
                'OpenAIProvider',
                'generateResponse',
                { 
                    messageCount: messages.length,
                    toolCount: tools?.length || 0
                }
            ));

            // Initial completion to get tool calls
            const completion = await this.createCompletionWithToolChoice(messages, tools);
            const choice = completion.choices[0]?.message;

            if (!choice) {
                throw new MCPError(
                    'OpenAI response missing message',
                    ErrorType.API_ERROR
                );
            }

            // Log response details
            debug('Received response from OpenAI', createLogContext(
                'OpenAIProvider',
                'generateResponse',
                { 
                    hasContent: !!choice.content,
                    hasToolCalls: !!choice.tool_calls?.length,
                    tokenCount: completion.usage?.total_tokens,
                    finishReason: completion.choices[0]?.finish_reason
                }
            ));

            // If no tool calls, return the content directly
            if (!choice.tool_calls || choice.tool_calls.length === 0) {
                const response: Response = {
                    content: choice.content || '',
                    tokenCount: completion.usage?.total_tokens ?? null,
                    toolResults: []
                };
                
                await this.messageCache.set(cacheKey, response);
                return response;
            }

            // Extract tool call information for the agent to execute
            const toolResults = choice.tool_calls.map(toolCall => ({
                success: false, // Will be set to true after execution
                data: '',       // Will be filled after execution
                error: '',      // Will be filled if execution fails
                metadata: {
                    toolName: toolCall.function.name,
                    arguments: toolCall.function.arguments,
                    toolCallId: toolCall.id
                }
            }));

            // Create response with tool calls for the agent to execute
            const response: Response = {
                content: choice.content || 'I need to use a tool to help with that.',
                tokenCount: completion.usage?.total_tokens ?? null,
                toolResults
            };

            // Cache and return the response
            await this.messageCache.set(cacheKey, response);
            return response;
        } catch (err) {
            debug('Error generating response', createLogContext(
                'OpenAIProvider',
                'generateResponse',
                { error: err instanceof Error ? err.message : String(err) }
            ));

            if (err instanceof MCPError) {
                throw err;
            }

            // Handle rate limiting
            if (err instanceof OpenAI.RateLimitError) {
                throw MCPError.rateLimitExceeded(this.model);
            }

            // Handle API errors
            throw MCPError.apiError(this.model, err);
        }
    }

    async getFinalResponse(
        originalMessage: string,
        toolResults: {
            toolName: string;
            toolCallId: string;
            result: string;
            success: boolean;
        }[],
        conversationHistory?: Input[]
    ): Promise<Response> {
        try {
            debug('Getting final response after tool execution', createLogContext(
                'OpenAIProvider',
                'getFinalResponse',
                { 
                    model: this.model,
                    toolResultCount: toolResults.length
                }
            ));

            // Convert conversation history to OpenAI format
            const messages = this.convertToCompletionMessages(originalMessage, conversationHistory);
            
            // Add system prompt if set
            if (this.systemPrompt) {
                messages.unshift({ role: 'system', content: this.systemPrompt });
            }
            
            // Add assistant's tool calls
            const assistantMessage: ChatCompletionMessageParam = {
                role: 'assistant',
                content: null,
                tool_calls: toolResults.map(result => ({
                    id: result.toolCallId,
                    type: 'function',
                    function: {
                        name: result.toolName,
                        arguments: '{}'  // Arguments are simplified here
                    }
                }))
            };
            
            messages.push(assistantMessage);

            // Add tool results
            for (const result of toolResults) {
                messages.push({
                    role: 'tool',
                    tool_call_id: result.toolCallId,
                    content: result.success ? result.result : `Error: ${result.result}`
                } as ChatCompletionToolMessageParam);
            }

            // Get final completion with tool results
            const completion = await this.client.chat.completions.create({
                model: this.model,
                messages,
                temperature: this.temperature
            });

            const choice = completion.choices[0]?.message;

            if (!choice) {
                throw new MCPError(
                    'OpenAI response missing message in final response',
                    ErrorType.API_ERROR
                );
            }

            return {
                content: choice.content || 'I processed the tool results but have no additional information to provide.',
                tokenCount: completion.usage?.total_tokens ?? null,
                toolResults: []
            };
        } catch (err) {
            debug('Error getting final response', createLogContext(
                'OpenAIProvider',
                'getFinalResponse',
                { error: err instanceof Error ? err.message : String(err) }
            ));

            if (err instanceof MCPError) {
                throw err;
            }

            throw MCPError.apiError(this.model, err);
        }
    }

    setSystemPrompt(prompt: string): void {
        this.systemPrompt = prompt;
    }

    getModel(): string {
        return this.model;
    }

    async cleanup(): Promise<void> {
        await this.messageCache.cleanup();
    }

    private convertToCompletionMessages(
        message: string,
        history?: Input[]
    ): ChatCompletionMessageParam[] {
        const messages: ChatCompletionMessageParam[] = [];

        if (history) {
            messages.push(...history.map(msg => this.convertToCompletionMessage(msg)));
        }

        messages.push({ role: 'user', content: message });
        return messages;
    }

    private convertToCompletionMessage(msg: Input): ChatCompletionMessageParam {
        if (msg.role === 'tool' && msg.tool_call_id) {
            return {
                role: 'tool',
                content: msg.content,
                tool_call_id: msg.tool_call_id
            } as ChatCompletionToolMessageParam;
        }
        return {
            role: msg.role as any,
            content: msg.content,
            name: msg.name
        };
    }

    private async createCompletionWithToolChoice(
        messages: ChatCompletionMessageParam[],
        tools?: ToolDefinition[]
    ): Promise<ChatCompletion> {
        // Format tools for OpenAI function calling
        const formattedTools: ChatCompletionTool[] | undefined = tools?.map(tool => ({
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

        const hasTools = formattedTools && formattedTools.length > 0;

        return await this.client.chat.completions.create({
            model: this.model,
            messages,
            tools: hasTools ? formattedTools : undefined,
            tool_choice: hasTools ? 'auto' : undefined,
            temperature: this.temperature
        });
    }

    private sanitizeToolName(name: string): string {
        return name.replace(/[-\s]/g, '_').toLowerCase();
    }
} 