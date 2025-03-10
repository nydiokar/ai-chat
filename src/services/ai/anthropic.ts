import { Anthropic, HUMAN_PROMPT, AI_PROMPT } from '@anthropic-ai/sdk';
import { MCPToolResponse, MCPToolConfig, ToolInformationProvider } from '../../types/tools.js';
import { BaseAIService } from './base-service.js';
import { ChatCompletionMessageParam, ChatCompletionFunctionMessageParam } from 'openai/resources/chat/completions.js';
import { AIResponse, AIMessage } from '../../types/ai-service.js';
import { ToolsHandler } from '../../tools/tools-handler.js';
import { prepareAnthropicMessages } from './utils/message-preparation.js';

export class AnthropicService extends BaseAIService {
    private client: Anthropic;
    private modelName: string;

    constructor(toolProvider?: ToolInformationProvider) {
        super(toolProvider);
        if (!process.env.ANTHROPIC_API_KEY) {
            throw new Error('Anthropic API key not found');
        }
        this.client = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY
        });
        this.modelName = process.env.ANTHROPIC_MODEL || 'claude-3-opus-20240229';
    }

    async generateResponse(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse> {
        return this.processMessage(message, conversationHistory);
    }

    async processMessage(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse> {
        try {
            if (this.toolsHandler) {
                return this.processWithTools(message, conversationHistory);
            } else {
                return this.processWithoutTools(message, conversationHistory);
            }
        } catch (error) {
            console.error('Anthropic Service Error:', error);
            return this.processWithoutTools(message, conversationHistory);
        }
    }

    protected async processWithTools(
        message: string,
        conversationHistory?: AIMessage[]
    ): Promise<AIResponse> {
        const systemPrompt = await this.getSystemPrompt();
        const messages = prepareAnthropicMessages(systemPrompt, message, conversationHistory);
        return this.handleToolBasedCompletion(messages, [], this.toolsHandler!);
    }

    protected async processWithoutTools(
        message: string,
        conversationHistory?: AIMessage[]
    ): Promise<AIResponse> {
        const systemPrompt = await this.getSystemPrompt();
        const messages = prepareAnthropicMessages(systemPrompt, message, conversationHistory);
        const completion = await this.makeApiCall(messages);

        return {
            content: completion.choices[0]?.message?.content || '',
            tokenCount: completion.usage?.total_tokens || null,
            toolResults: []
        };
    }

    protected async handleToolBasedCompletion(
        messages: ChatCompletionMessageParam[],
        functions: MCPToolConfig[],
        toolsHandler: ToolsHandler,
        conversationId?: number
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
                const toolQuery = `[Calling tool ${functionName} with args ${JSON.stringify(functionArgs)}]`;
                const result = await toolsHandler.processQuery(toolQuery, conversationId ?? 0);

                // Get final response with tool result
                const finalCompletion = await this.client.messages.create({
                    model: this.modelName,
                    max_tokens: 1000,
                    messages: [
                        { role: 'user', content: prompt },
                        { role: 'assistant', content: content },
                        { role: 'user', content: `Tool ${functionName} returned: ${result.content[0]?.text || ''}` }
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

    getModel(): string {
        return 'claude';
    }
}