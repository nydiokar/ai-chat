import { OpenAI } from 'openai';
import { AIResponse, AIMessage } from '../../types/ai-service.js';
import { BaseAIService } from './base-service.js';
import { MCPContainer } from '../../tools/mcp/di/container.js';
import { MCPError, ErrorType } from '../../types/errors.js';
import { aiRateLimiter } from './utils/rate-limiter.js';
import { debug, defaultConfig } from '../../utils/config.js';
import { redactSensitiveInfo } from '../../utils/security.js';
import { 
    ChatCompletionMessageParam,
    ChatCompletionTool,
    ChatCompletion,
    ChatCompletionToolMessageParam,
    ChatCompletionCreateParams
} from 'openai/resources/chat/completions.js';
import { ToolDefinition, ToolResponse } from '../../tools/mcp/types/tools.js';

export class OpenAIService extends BaseAIService {
    private readonly openai: OpenAI;
    private readonly model: string;
    private readonly temperature: number;

    constructor(container: MCPContainer) {
        super(container);
        
        if (!process.env.OPENAI_API_KEY) {
            throw new MCPError('OpenAI API key not found', ErrorType.API_ERROR);
        }
        
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        this.model = defaultConfig.openai.model;
        this.temperature = defaultConfig.openai.temperature;
    }

    async generateResponse(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse> {
        try {
            // Check rate limit
            aiRateLimiter.checkLimit('gpt');
            
            // Get system prompt (which internally gets relevant tools)
            const systemPrompt = await this.getSystemPrompt();
            
            // Get the tools that were used in the system prompt
            const relevantTools = await this.promptGenerator.getTools(message);
            debug(`Using ${relevantTools.length} relevant tools for message`);

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
                    tokenCount: completion.usage?.total_tokens || null,
                    toolResults: []
                };
            }

            // Add the assistant's message with tool calls
            currentMessages.push(choice.message);

            // Handle tool calls
            const toolResults = await Promise.all(
                choice.message.tool_calls.map(async toolCall => {
                    try {
                        const args = JSON.parse(toolCall.function.arguments || '{}');
                        // Add detailed logging of the tool call arguments
                        console.log(`Tool call from model: ${toolCall.function.name}`);
                        console.log(`Raw arguments string: "${toolCall.function.arguments}"`);
                        console.log(`Parsed arguments:`, JSON.stringify(args, null, 2));
                        
                        debug(`Executing tool ${toolCall.function.name} with args: ${JSON.stringify(args)}`);
                        const result = await this.toolManager.executeTool(
                            toolCall.function.name,
                            args
                        );

                        // Add tool response message
                        currentMessages.push({
                            role: 'tool',
                            content: JSON.stringify(result.data),
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

                        // Add error response message
                        currentMessages.push({
                            role: 'tool',
                            content: JSON.stringify(errorResult),
                            tool_call_id: toolCall.id
                        } as ChatCompletionToolMessageParam);

                        return errorResult;
                    }
                })
            );

            // Get final response with tool results
            const finalCompletion = await this.createCompletion(currentMessages, relevantTools);
            totalTokens += finalCompletion.usage?.total_tokens || 0;

            return {
                content: finalCompletion.choices[0].message.content || '',
                tokenCount: totalTokens,
                toolResults
            };

        } catch (error) {
            debug(`OpenAI error: ${error instanceof Error ? error.message : String(error)}`);
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
            // Take last N messages that fit within token limit
            const historyLimit = defaultConfig.messageHandling.maxContextMessages;
            const recentHistory = history.slice(-historyLimit);
            console.log(`Using ${recentHistory.length} messages from history (limit: ${historyLimit})`);
            
            messages.push(...recentHistory.map(msg => {
                if (msg.role === 'tool' && msg.tool_call_id) {
                    return {
                        role: 'tool' as const,
                        content: msg.content,
                        tool_call_id: msg.tool_call_id
                    } as ChatCompletionToolMessageParam;
                }
                return {
                    role: msg.role,
                    content: msg.content
                } as ChatCompletionMessageParam;
            }));
        }

        messages.push({ role: 'user', content: message });
        
        // Log estimated token usage
        const totalChars = messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
        console.log(`Estimated message size: ~${totalChars} chars (~${Math.floor(totalChars/4)} tokens)`);
        
        return messages;
    }

    private async createCompletion(
        messages: ChatCompletionMessageParam[],
        tools: ToolDefinition[]
    ): Promise<ChatCompletion> {
        // Log the number of tools being processed
        console.log(`Processing ${tools.length} tools for completion`);
        
        // Format tools for OpenAI function calling
        const formattedTools = tools.map(tool => {
            // Convert to OpenAI function definition format
            const functionDef: ChatCompletionTool = {
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema as any
                }
            };

            return functionDef;
        });
        
        // Log approximate token usage from tools
        const toolsJson = JSON.stringify(formattedTools);
        console.log(`Tool schemas size: ~${toolsJson.length} bytes (~${Math.floor(toolsJson.length/4)} tokens)`);
        
        // Create the completion with formatted tools
        const completion = await this.openai.chat.completions.create({
            model: this.model,
            messages,
            tools: formattedTools.length > 0 ? formattedTools : undefined,
            tool_choice: formattedTools.length > 0 ? 'auto' : undefined,
            temperature: this.temperature
        });
        
        // Log token usage
        if (completion.usage) {
            console.log(`Token usage - Prompt: ${completion.usage.prompt_tokens}, Completion: ${completion.usage.completion_tokens}, Total: ${completion.usage.total_tokens}`);
        }
        
        return completion;
    }

    getModel(): string {
        return 'gpt';
    }
}
