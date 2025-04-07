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
                    hasTools: !!tools?.length
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

            const completion = await this.createCompletion(messages, tools);

            if (!completion.choices[0]?.message?.content) {
                throw new MCPError(
                    'OpenAI response missing content',
                    ErrorType.API_ERROR
                );
            }

            const response = {
                content: completion.choices[0].message.content,
                tokenCount: completion.usage?.total_tokens ?? null,
                toolResults: []
            };

            // Cache the response
            await this.messageCache.set(cacheKey, response);

            return response;
        } catch (err) {
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
            role: msg.role,
            content: msg.content,
            name: msg.name
        } as ChatCompletionMessageParam;
    }

    private async createCompletion(
        messages: ChatCompletionMessageParam[],
        tools?: ToolDefinition[]
    ): Promise<ChatCompletion> {
        // Format tools for OpenAI function calling if provided
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

        return await this.client.chat.completions.create({
            model: this.model,
            messages,
            tools: formattedTools,
            tool_choice: formattedTools ? 'auto' : undefined,
            temperature: this.temperature
        });
    }

    private sanitizeToolName(name: string): string {
        return name.replace(/[-\s]/g, '_').toLowerCase();
    }
} 