import { Message } from '../../types/index.js';
import { BaseAIService, AIResponse } from './base-service.js';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { aiRateLimiter } from './utils/rate-limiter.js';
import fetch from 'node-fetch';

export class OllamaService extends BaseAIService {
    private baseUrl: string;
    private modelName: string;

    constructor() {
        super();
        this.baseUrl = process.env.OLLAMA_HOST || 'http://localhost:11434';
        this.modelName = process.env.OLLAMA_MODEL || 'llama2:13b-instruct-q8_0';
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
            console.error('Ollama Service Error:', error);
            return this.processWithoutTools(message, conversationHistory);
        }
    }

    protected async makeApiCall(messages: ChatCompletionMessageParam[], temperature: number) {
        // Format messages for Ollama's chat endpoint
        const formattedMessages = messages.map(msg => ({
            role: msg.role,
            // Handle both string and structured content
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        }));

        try {
            const response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.modelName,
                    messages: formattedMessages,
                    options: {
                        temperature: temperature,
                        num_ctx: 4096 // Allow for larger context
                    }
                }),
            });

            if (!response.ok) {
                throw new Error(`Ollama API error: ${response.statusText}`);
            }

            const data = await response.json();
            const content = String(data.message?.content || '');

            // Structure response to match OpenAI format
            const messageContent = String(data.message?.content || '');
            // Use type assertion to ensure type compatibility
            return {
                choices: [{
                    message: {
                        role: 'assistant' as const,
                        content: messageContent,
                        tool_calls: undefined
                    },
                    finish_reason: 'stop'
                }],
                usage: {
                    total_tokens: data.total_tokens || 0
                }
            };
        } catch (error) {
            console.error('Error calling Ollama API:', error);
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
            content: completion.choices[0]?.message?.content || '',
            tokenCount: completion.usage?.total_tokens || null,
            toolResults: []
        };
    }

    getModel(): 'gpt' | 'claude' | 'deepseek' | 'ollama' {
        return 'ollama';
    }
}
