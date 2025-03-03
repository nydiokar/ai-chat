import OpenAI from 'openai';
import { Message } from '../../../types/index.js';
import { ToolsHandler } from '../../../tools/tools-handler.js';
import { 
    ChatCompletionMessageParam,
    ChatCompletionSystemMessageParam,
    ChatCompletionUserMessageParam,
    ChatCompletionAssistantMessageParam
} from 'openai/resources/chat/completions.js';

interface OllamaBridgeConfig {
    baseUrl: string;
    model: string;
}

interface BridgeResponse {
    content: string;
    toolResults: any[];
    tokenCount: number;
}

export class OllamaBridge {
    private client: OpenAI;
    private systemPrompt: string | null = null;
    private messages: ChatCompletionMessageParam[] = [];
    private modelName: string;
    private toolNameMapping: Map<string, string> = new Map();

    constructor(config: OllamaBridgeConfig) {
        console.log('[OllamaBridge] Initializing with config:', {
            baseUrl: config.baseUrl,
            model: config.model
        });
        
        this.modelName = config.model;
        this.client = new OpenAI({
            baseURL: `${config.baseUrl}/v1`,
            apiKey: 'ollama',
        });
    }

    setSystemPrompt(prompt: string | null) {
        this.systemPrompt = prompt;
    }

    private prepareMessages(): ChatCompletionMessageParam[] {
        const formattedMessages: ChatCompletionMessageParam[] = [];
        if (this.systemPrompt) {
            const systemMessage: ChatCompletionSystemMessageParam = {
                role: "system",
                content: this.systemPrompt
            };
            formattedMessages.push(systemMessage);
        }
        return [...formattedMessages, ...this.messages];
    }

    private convertMCPToolsToOllamaFormat(mcpTools: any[]): any[] {
        console.log('[OllamaBridge] Converting MCP tools:', mcpTools);
        
        const ollamaTools = mcpTools.map(tool => {
            // Sanitize the name for Ollama compatibility
            const ollamaName = tool.name.replace(/-/g, '_').replace(/ /g, '_').toLowerCase();
            
            // Store the mapping
            this.toolNameMapping.set(ollamaName, tool.name);
            
            // Convert to Ollama format
            return {
                type: 'function',
                function: {
                    name: ollamaName,
                    description: tool.description,
                    parameters: tool.inputSchema || {
                        type: "object",
                        properties: {},
                        required: []
                    }
                }
            };
        });

        console.log('[OllamaBridge] Converted tools:', ollamaTools);
        return ollamaTools;
    }

    async processMessage(
        message: string, 
        conversationHistory?: Message[],
        toolsHandler?: ToolsHandler, 
        functions?: any[],
        conversationId?: number
    ): Promise<BridgeResponse> {
        console.log('[OllamaBridge] Raw functions received:', functions);
        
        // Convert the tools if they exist
        const convertedTools = functions?.length ? 
            this.convertMCPToolsToOllamaFormat(functions) : 
            undefined;
        
        console.log('[OllamaBridge] Converted tools:', convertedTools);
        
        console.log('[OllamaBridge] ToolsHandler present:', !!toolsHandler);
        console.log('[OllamaBridge] Available functions:', functions?.map(f => f.name));

        if (!functions?.length) {
            console.warn('[OllamaBridge] No functions provided to bridge');
        }

        // Reset message history
        this.messages = [];

        // Add context messages
        if (conversationHistory) {
            for (const msg of conversationHistory) {
                if (msg.role === "user") {
                    const userMsg: ChatCompletionUserMessageParam = {
                        role: "user",
                        content: msg.content
                    };
                    this.messages.push(userMsg);
                } else if (msg.role === "assistant") {
                    const assistantMsg: ChatCompletionAssistantMessageParam = {
                        role: "assistant",
                        content: msg.content
                    };
                    this.messages.push(assistantMsg);
                } else if (msg.role === "system") {
                    const systemMsg: ChatCompletionSystemMessageParam = {
                        role: "system",
                        content: msg.content
                    };
                    this.messages.push(systemMsg);
                }
            }
        }

        // Add current message
        const userMessage: ChatCompletionUserMessageParam = {
            role: "user",
            content: message
        };
        this.messages.push(userMessage);

        try {
            if (!this.modelName) {
                throw new Error('Model name is required but not set');
            }

            const completion = await this.client.chat.completions.create({
                model: this.modelName,
                messages: this.prepareMessages(),
                tools: convertedTools,
                tool_choice: convertedTools ? 'auto' : 'none',
                temperature: 0.7,
            });

            if (!completion.choices[0]?.message) {
                throw new Error('No response received from Ollama');
            }

            const responseMessage = completion.choices[0].message;
            console.log('[OllamaBridge] Response message:', {
                content: responseMessage.content,
                toolCalls: responseMessage.tool_calls
            });

            let tokenCount = completion.usage?.total_tokens || 0;

            // Handle tool calls if present
            if (responseMessage.tool_calls?.length && toolsHandler) {
                console.log('Tool calls detected:', responseMessage.tool_calls);
                
                const toolResults = await Promise.all(
                    responseMessage.tool_calls.map(async toolCall => {
                        try {
                            // Get the original MCP tool name
                            const mcpToolName = this.toolNameMapping.get(toolCall.function.name) || toolCall.function.name;
                            
                            const toolQuery = `[Calling tool ${mcpToolName} with args ${toolCall.function.arguments}]`;
                            console.log('Processing tool query:', toolQuery);
                            
                            const result = await toolsHandler.processQuery(toolQuery, conversationId ?? 0);
                            console.log('Tool result received:', result);
                            return result;
                        } catch (error) {
                            console.error(`Error calling tool ${toolCall.function.name}:`, error);
                            return { error: `Failed to execute tool ${toolCall.function.name}` };
                        }
                    })
                );

                // Add tool results to conversation
                this.messages.push(responseMessage);
                this.messages.push({
                    role: 'tool',
                    content: JSON.stringify(toolResults),
                    tool_call_id: responseMessage.tool_calls[0].id
                });

                // Get final response
                if (!this.modelName) {
                    throw new Error('Model name is required but not set');
                }

                const finalCompletion = await this.client.chat.completions.create({
                    model: this.modelName,
                    messages: this.prepareMessages(),
                    temperature: 0.7,
                });

                if (!finalCompletion.choices[0]?.message) {
                    throw new Error('No response received from Ollama');
                }

                tokenCount += finalCompletion.usage?.total_tokens || 0;
                const messageContent = finalCompletion.choices[0].message.content;

                return {
                    content: String(messageContent || ''),
                    toolResults,
                    tokenCount
                };
            }

            return {
                content: responseMessage.content ?? '',
                toolResults: [],
                tokenCount: completion.usage?.total_tokens || 0
            };

        } catch (error) {
            console.error('[OllamaBridge] Error:', error);
            console.error('[OllamaBridge] Model name:', this.modelName);
            console.error('[OllamaBridge] Base URL:', this.client.baseURL);
            throw error;
        }
    }
}
