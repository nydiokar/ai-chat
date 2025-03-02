import { OpenAI } from 'openai';
import { Message } from '../../types/index.js';
import { BaseAIService, AIResponse } from './base-service.js';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { aiRateLimiter } from './utils/rate-limiter.js';

export class OpenAIService extends BaseAIService {
    private client: OpenAI;
    private modelName: string;

    constructor() {
        super();
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OpenAI API key not found');
        }
        
        this.modelName = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
        this.client = new OpenAI({ apiKey });
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
            console.error('OpenAI Service Error:', error);
            return this.processWithoutTools(message, conversationHistory);
        }
    }

    protected async handleToolBasedCompletion(
        messages: ChatCompletionMessageParam[],
        functions: any[],
        toolsHandler: any,
        conversationId?: number
    ): Promise<AIResponse> {
        try {
            const completion = await this.client.chat.completions.create({
                model: this.modelName,
                messages,
                tools: functions.map(fn => ({ type: 'function', function: fn })),
                tool_choice: 'auto',
                temperature: 0.7,
            });

            let currentMessages = [...messages];
            let responseMessage = completion.choices[0]?.message;
            let totalTokens = completion.usage?.total_tokens || 0;
            let toolResults = [];

            while (responseMessage?.tool_calls) {
                currentMessages.push(responseMessage);

                // Process all tool calls in this response
                for (const toolCall of responseMessage.tool_calls) {
                    try {
                        console.log(`Processing tool call for ${toolCall.function.name}`);
                        const toolQuery = `[Calling tool ${toolCall.function.name} with args ${toolCall.function.arguments}]`;
                        const toolResult = await toolsHandler.processQuery(toolQuery, conversationId);
                        toolResults.push(toolResult);

                        // Add the tool response message
                        currentMessages.push({
                            role: 'tool',
                            content: toolResult,
                            tool_call_id: toolCall.id
                        } as ChatCompletionMessageParam);
                    } catch (error) {
                        console.error(`Tool execution failed:`, error);
                        throw error;
                    }
                }

                // Get the next response
                const nextCompletion = await this.client.chat.completions.create({
                    model: this.modelName,
                    messages: currentMessages,
                    tools: functions.map(fn => ({
                        type: "function",
                        function: fn
                    })),
                    tool_choice: "auto",
                    temperature: 0.7
                });

                totalTokens += nextCompletion.usage?.total_tokens || 0;
                responseMessage = nextCompletion.choices[0]?.message;
            }

            return {
                content: responseMessage?.content || '',
                tokenCount: totalTokens,
                toolResults
            };
        } catch (error) {
            console.error('Error in handleToolBasedCompletion:', error);
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

        const completion = await this.client.chat.completions.create({
            model: this.modelName,
            messages,
            temperature: 0.7
        });

        return {
            content: completion.choices[0]?.message?.content || '',
            tokenCount: completion.usage?.total_tokens || null,
            toolResults: []
        };
    }

    protected async makeApiCall(
        messages: ChatCompletionMessageParam[],
        temperature: number
    ) {
        return this.client.chat.completions.create({
            model: this.modelName,
            messages,
            temperature
        });
    }

    getModel(): 'gpt' | 'claude' | 'deepseek' {
        return 'gpt';
    }
}
