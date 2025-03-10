import { OpenAI } from 'openai';
import { MCPToolResponse } from '../../types/tools.js';
import { BaseAIService } from './base-service.js';
import { MCPServerManager } from '../../tools/mcp/mcp-server-manager.js';
import { 
    ChatCompletionMessageParam,
    ChatCompletionSystemMessageParam,
    ChatCompletionUserMessageParam,
    ChatCompletionAssistantMessageParam,
    ChatCompletionToolMessageParam
} from 'openai/resources/chat/completions.js';
import { aiRateLimiter } from './utils/rate-limiter.js';
import { debug } from '../../utils/config.js';
import { AIResponse, AIMessage } from '../../types/ai-service.js';

export class OpenAIService extends BaseAIService {
    private openai: OpenAI;
    private model: string;

    constructor(mcpManager: MCPServerManager) {
        super(mcpManager);
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OpenAI API key not found');
        }
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        this.model = process.env.OPENAI_MODEL || 'gpt-4';
        
        // Set o1 model flag for newer models
        if (this.model.includes('gpt-4-0125') || this.model.includes('gpt-4-turbo') || this.model.includes('gpt-4-1106')) {
            this.setIsO1Model(true);
        }
    }

    async generateResponse(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse> {
        return this.processMessage(message, conversationHistory);
    }

    async processMessage(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse> {
        aiRateLimiter.checkLimit('gpt');
        
        const systemPrompt = await this.getSystemPrompt();
        const messages: ChatCompletionMessageParam[] = [
            { role: 'system', content: systemPrompt } as ChatCompletionSystemMessageParam,
            ...(conversationHistory || []).map(msg => {
                if (msg.role === 'tool' && msg.tool_call_id) {
                    return {
                        role: 'tool',
                        content: msg.content,
                        tool_call_id: msg.tool_call_id
                    } as ChatCompletionToolMessageParam;
                }
                if (msg.role === 'assistant') {
                    return {
                        role: 'assistant',
                        content: msg.content
                    } as ChatCompletionAssistantMessageParam;
                }
                return {
                    role: 'user',
                    content: msg.content
                } as ChatCompletionUserMessageParam;
            }),
            { role: 'user', content: message } as ChatCompletionUserMessageParam
        ];

        try {
            const tools = await this.toolsHandler.getAvailableTools();
            if (tools.length > 0) {
                return this.handleToolBasedCompletion(messages, tools);
            }

            // Otherwise, use simple completion
            const completion = await this.openai.chat.completions.create({
                model: this.model,
                messages,
                temperature: 0.7
            });

            return {
                content: completion.choices[0].message.content || '',
                tokenCount: completion.usage?.total_tokens || null,
                toolResults: []
            };

        } catch (error) {
            debug('OpenAI API Error: ' + (error instanceof Error ? error.message : String(error)));
            throw error;
        }
    }

    private async handleToolBasedCompletion(
        messages: ChatCompletionMessageParam[],
        tools: any[]
    ): Promise<AIResponse> {
        let currentMessages = [...messages];
        let totalTokens = 0;
        let allToolResults: MCPToolResponse[] = [];

        try {
            while (true) {
                const completion = await this.openai.chat.completions.create({
                    model: this.model,
                    messages: currentMessages,
                    tools: tools.map(tool => ({
                        type: 'function',
                        function: {
                            name: tool.name,
                            description: tool.description,
                            parameters: tool.inputSchema || {
                                type: 'object',
                                properties: {},
                                required: []
                            }
                        }
                    })),
                    tool_choice: 'auto',
                    temperature: 0.7
                });

                totalTokens += completion.usage?.total_tokens || 0;
                const responseMessage = completion.choices[0].message;

                // If no tool calls, we're done
                if (!responseMessage.tool_calls?.length) {
                    return {
                        content: responseMessage.content || '',
                        tokenCount: totalTokens,
                        toolResults: allToolResults
                    };
                }

                // Process tool calls
                currentMessages.push(responseMessage);
                
                for (const toolCall of responseMessage.tool_calls) {
                    try {
                        const tool = await this.toolsHandler.getToolByName(toolCall.function.name);
                        if (!tool) {
                            throw new Error(`Tool ${toolCall.function.name} not found`);
                        }

                        const result = await tool.handler(JSON.parse(toolCall.function.arguments));
                        allToolResults.push(result);

                        currentMessages.push({
                            role: 'tool',
                            content: result.content
                                .map(c => c.text || c.url || JSON.stringify(c))
                                .filter(Boolean)
                                .join('\n'),
                            tool_call_id: toolCall.id
                        } as ChatCompletionToolMessageParam);
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        debug(`Tool execution failed: ${errorMessage}`);
                        currentMessages.push({
                            role: 'system',
                            content: `Tool execution failed: ${errorMessage}`
                        } as ChatCompletionSystemMessageParam);
                    }
                }
            }
        } catch (error) {
            debug('Tool handling error: ' + (error instanceof Error ? error.message : String(error)));
            throw error;
        }
    }

    getModel(): string {
        return 'gpt';
    }
}
