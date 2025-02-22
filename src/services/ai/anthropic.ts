import { Message } from '../../types/index.js';
import { BaseAIService, AIResponse } from './base-service.js';
import { Anthropic, HUMAN_PROMPT, AI_PROMPT } from '@anthropic-ai/sdk';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { aiRateLimiter } from './utils/rate-limiter.js';

export class AnthropicService extends BaseAIService {
    private client: Anthropic;
    private modelName: string;

    constructor() {
        super();
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            throw new Error('Anthropic API key not found');
        }
        this.modelName = process.env.ANTHROPIC_MODEL || 'claude-2';
        this.client = new Anthropic({ apiKey });
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
            console.error('Anthropic Service Error:', error);
            return this.processWithoutTools(message, conversationHistory);
        }
    }

    protected async handleToolBasedCompletion(
        messages: ChatCompletionMessageParam[],
        functions: any[],
        server: any
    ): Promise<AIResponse> {
        // Convert OpenAI-style messages to Anthropic format
        let prompt = '';
        for (const msg of messages) {
            if (msg.role === 'system') {
                prompt += `${msg.content}\n\n`;
            } else if (msg.role === 'user') {
                prompt += `${HUMAN_PROMPT} ${msg.content}\n\n`;
            } else if (msg.role === 'assistant') {
                prompt += `${AI_PROMPT} ${msg.content}\n\n`;
            }
        }

        // Add function descriptions to the prompt
        prompt += `\nAvailable tools:\n${functions.map(fn => 
            `${fn.name}: ${fn.description}\nParameters: ${JSON.stringify(fn.parameters, null, 2)}\n`
        ).join('\n')}\n\n`;

        const completion = await this.client.messages.create({
            model: this.modelName,
            max_tokens: 1000,
            messages: [{ role: 'user', content: prompt }]
        });

        // Parse the response to extract function calls
        const content = completion.content[0].type === 'text' ? completion.content[0].text : '';
        const functionCallMatch = content.match(/Use tool: (\w+)\nArguments: ({[^}]+})/);

        if (functionCallMatch) {
            const [functionName, argsString] = functionCallMatch;
            try {
                const functionArgs = JSON.parse(argsString);
                const result = await server.callTool(functionName, functionArgs);

                // Get final response with tool result
                const finalCompletion = await this.client.messages.create({
                    model: this.modelName,
                    max_tokens: 1000,
                    messages: [
                        { role: 'user', content: prompt },
                        { role: 'assistant', content: content },
                        { role: 'user', content: `Tool ${functionName} returned: ${result}` }
                    ]
                });

                return {
                    content: finalCompletion.content[0].type === 'text' ? finalCompletion.content[0].text : '',
                    tokenCount: null, // Anthropic doesn't provide token counts
                    toolResults: [result]
                };
            } catch (error) {
                console.error(`Tool execution failed:`, error);
                throw error;
            }
        }

        return {
            content: completion.content[0].type === 'text' ? completion.content[0].text : '',
            tokenCount: null,
            toolResults: []
        };
    }

    protected async processWithoutTools(
        message: string,
        conversationHistory?: Message[]
    ): Promise<AIResponse> {
        aiRateLimiter.checkLimit(this.getModel());

        const contextMessages = this.getContextMessages(conversationHistory);
        let prompt = this.systemPrompt ? `${this.systemPrompt}\n\n` : '';

        for (const msg of contextMessages) {
            if (msg.role === 'user') {
                prompt += `${HUMAN_PROMPT} ${msg.content}\n\n`;
            } else if (msg.role === 'assistant') {
                prompt += `${AI_PROMPT} ${msg.content}\n\n`;
            }
        }

        prompt += `${HUMAN_PROMPT} ${message}\n\n${AI_PROMPT}`;

        const completion = await this.client.messages.create({
            model: this.modelName,
            max_tokens: 1000,
            messages: [{ role: 'user', content: prompt }]
        });

        return {
            content: completion.content[0].type === 'text' ? completion.content[0].text : '',
            tokenCount: null, // Anthropic doesn't provide token counts
            toolResults: []
        };
    }

    protected async makeApiCall(
        messages: ChatCompletionMessageParam[],
        temperature: number = 0.7
    ) {
        // Convert OpenAI-style messages to Anthropic format
        let prompt = '';
        for (const msg of messages) {
            if (msg.role === 'system') {
                prompt += `${msg.content}\n\n`;
            } else if (msg.role === 'user') {
                prompt += `${HUMAN_PROMPT} ${msg.content}\n\n`;
            } else if (msg.role === 'assistant') {
                prompt += `${AI_PROMPT} ${msg.content}\n\n`;
            }
        }

        const completion = await this.client.messages.create({
            model: this.modelName,
            max_tokens: 1000,
            temperature: temperature,
            messages: [{ role: 'user', content: prompt }]
        });


        const content = completion.content[0].type === 'text' ? completion.content[0].text : '';
        const message: ChatCompletionMessageParam = {
            role: 'assistant',
            content
        };

        return {
            choices: [{
                message,
                finish_reason: 'stop'
            }],
            usage: {
                total_tokens: 0 // Anthropic doesn't provide token counts
            }
        };
    }

    getModel(): 'gpt' | 'claude' | 'deepseek' {
        return 'claude';
    }
}