import { Message } from '../../types/index.js';
import { AIResponse, BaseAIService } from './base-service.js';
import { aiRateLimiter } from './utils/rate-limiter.js';
import { ChatCompletionMessageParam, ChatCompletionAssistantMessageParam } from 'openai/resources/chat/completions.js';
import OpenAI from 'openai';
import { debug } from '../../utils/config.js';
import { ToolsHandler } from '../../tools/tools-handler.js';

export class OllamaService extends BaseAIService {
    private baseUrl: string;
    private modelName: string;
    private client: OpenAI;

    constructor() {
        super();
        this.baseUrl = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
        this.modelName = process.env.OLLAMA_MODEL || 'llama3.1:8b-instruct-q8_0';
        
        // Initialize OpenAI client with Ollama endpoint
        this.client = new OpenAI({
            baseURL: `${this.baseUrl}/v1`,
            apiKey: 'ollama', // required but unused
        });
    }

    async generateResponse(message: string, conversationHistory?: Message[]): Promise<AIResponse> {
        return this.processMessage(message, conversationHistory);
    }

    async processMessage(message: string, conversationHistory?: Message[]): Promise<AIResponse> {
        await this.initPromise;

        try {
            const conversationId = conversationHistory?.[0]?.conversationId;
            if (this.mcpManager) {
                return this.processWithTools(message, conversationHistory, conversationId);
            } else {
                return this.processWithoutTools(message, conversationHistory);
            }
        } catch (error) {
            console.error('Ollama Service Error:', error);
            return this.processWithoutTools(message, conversationHistory);
        }
    }

    protected async handleToolBasedCompletion(
        messages: ChatCompletionMessageParam[],
        functions: any[],
        toolsHandler: ToolsHandler,
        conversationId?: number
    ): Promise<AIResponse> {
        try {
            const completion = await this.createChatCompletion({
                messages,
                tools: functions.map(fn => ({ type: 'function', function: fn })),
                tool_choice: 'auto',
                temperature: 0.7,
            });

            const responseMessage = completion.choices[0].message as ChatCompletionAssistantMessageParam;
            let tokenCount = completion.usage?.total_tokens || 0;

            if (responseMessage?.tool_calls?.length) {
                const toolCalls = responseMessage.tool_calls;
                const toolResults = await Promise.all(
                    toolCalls.map(async toolCall => {
                        try {
                            const toolQuery = `[Calling tool ${toolCall.function.name} with args ${toolCall.function.arguments}]`;
                            return await toolsHandler.processQuery(toolQuery, conversationId ?? 0); 
                        } catch (error) {
                            console.error(`Error calling tool ${toolCall.function.name}:`, error);
                            return { error: `Failed to execute tool ${toolCall.function.name}` };
                        }
                    })
                );

                // Add tool results to messages
                messages.push(responseMessage);
                messages.push({
                    role: 'tool',
                    content: JSON.stringify(toolResults),
                    tool_call_id: toolCalls[0].id
                });

                // Get final response
                const finalCompletion = await this.createChatCompletion({
                    messages,
                    temperature: 0.7,
                });

                tokenCount += finalCompletion.usage?.total_tokens || 0;
                const messageContent = finalCompletion.choices[0].message.content;

                return {
                    content: String(messageContent || ''),
                    toolResults,
                    tokenCount
                };
            }

            return {
                content: String(responseMessage.content || ''),
                toolResults: [],
                tokenCount
            };
        } catch (error) {
            console.error('Error in handleToolBasedCompletion:', error);
            throw error;
        }
    }

    protected async makeApiCall(
        messages: ChatCompletionMessageParam[],
        temperature: number
    ) {
        try {
            const completion = await this.client.chat.completions.create({
                model: this.modelName,
                messages,
                temperature,
            });

            return completion;

        } catch (error) {
            console.error('[OllamaService] Error:', error);
            throw error;
        }
    }

    protected async processWithoutTools(
        message: string, 
        conversationHistory?: Message[]
    ): Promise<AIResponse> {
        aiRateLimiter.checkLimit(this.getModel());
        
        const contextMessages = this.getContextMessages(conversationHistory);
        const messages: ChatCompletionMessageParam[] = [
            { role: "system", content: this.systemPrompt },
            ...contextMessages,
            { role: "user", content: message }
        ];

        const completion = await this.makeApiCall(messages, 0.7);

        return {
            content: completion.choices[0].message.content as string,
            tokenCount: completion.usage?.total_tokens || null,
            toolResults: []
        };
    }

    getModel(): 'gpt' | 'claude' | 'deepseek' | 'ollama' {
        return 'ollama';
    }
}
