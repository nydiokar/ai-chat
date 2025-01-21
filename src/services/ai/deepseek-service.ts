import OpenAI from 'openai';
import { Message } from '../../types/index.js';
import { BaseAIService, AIResponse } from './base-service.js';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { aiRateLimiter } from './utils/rate-limiter.js';

export class DeepseekService extends BaseAIService {
    private client: OpenAI;
    private modelName: string;

    constructor() {
        super();
        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
            throw new Error('Deepseek API key not found');
        }
        
        this.modelName = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
        this.client = new OpenAI({
            apiKey,
            baseURL: 'https://api.deepseek.com/v1'
        });
    }

    async generateResponse(message: string, conversationHistory?: Message[]): Promise<AIResponse> {
        return this.processMessage(message, conversationHistory);
    }

    async processMessage(message: string, conversationHistory?: Message[]): Promise<AIResponse> {
        await this.initPromise;

        try {
            if (this.mcpManager) {
                return this.processWithTools(message, conversationHistory);
            } else {
                return this.processWithoutTools(message, conversationHistory);
            }
        } catch (error) {
            console.error('Deepseek Service Error:', error);
            return this.processWithoutTools(message, conversationHistory);
        }
    }

    protected async handleToolBasedCompletion(
        messages: ChatCompletionMessageParam[],
        functions: any[],
        server: any
    ): Promise<AIResponse> {
        const completion = await this.client.chat.completions.create({
            model: this.modelName,
            messages,
            tools: functions.map(fn => ({
                type: "function",
                function: fn
            })),
            tool_choice: "auto",
            temperature: 0.5
        });

        let currentMessages = [...messages];
        let responseMessage = completion.choices[0]?.message;
        
        while (responseMessage?.tool_calls) {
            currentMessages.push(responseMessage);
            
            for (const toolCall of responseMessage.tool_calls) {
                try {
                    const functionName = toolCall.function.name;
                    const functionArgs = JSON.parse(toolCall.function.arguments);
                    const result = await server.callTool(functionName, functionArgs);
                    
                    currentMessages.push({
                        role: 'tool',
                        content: result,
                        tool_call_id: toolCall.id
                    } as ChatCompletionMessageParam);
                } catch (error) {
                    console.error(`Tool execution failed:`, error);
                    throw error;
                }
            }
            
            const nextCompletion = await this.client.chat.completions.create({
                model: this.modelName,
                messages: currentMessages,
                tools: functions.map(fn => ({
                    type: "function",
                    function: fn
                })),
                tool_choice: "auto",
                temperature: 0.5
            });
            
            responseMessage = nextCompletion.choices[0]?.message;
        }

        return {
            content: responseMessage?.content || '',
            tokenCount: completion.usage?.total_tokens || null
        };
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
            temperature: 0.5
        });

        return {
            content: completion.choices[0]?.message?.content || '',
            tokenCount: completion.usage?.total_tokens || null
        };
    }

    getModel(): 'gpt' | 'claude' | 'deepseek' {
        return 'deepseek';
    }
} 