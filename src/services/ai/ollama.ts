import { BaseAIService, AIResponse } from './base-service.js';
import { Message } from '../../types/index.js';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { Ollama } from 'ollama';
import { OllamaMessage, OllamaToolDefinition } from '../../types/ollama_types.js';
import { ToolsHandler } from '../../tools/tools-handler.js';
import { MCPServerManager } from '../../tools/mcp/mcp-server-manager.js';
import { OllamaToolAdapter } from './utils/ollama_helpers/ollama-tool-adapter.js';

export class OllamaService extends BaseAIService {
    private client: Ollama;
    private readonly model = 'mistral:7b';
    private readonly maxRetries = 3;
    private readonly retryDelay = 1000; // 1 second
    private isInitialized = false;
    private cachedTools: OllamaToolDefinition[] | null = null;
    private lastToolUpdateTime: number = 0;
    private readonly TOOL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    constructor() {
        super();
        this.client = new Ollama({
            host: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'
        });
    }

    public injectMCPComponents(mcpManager: MCPServerManager, toolsHandler: ToolsHandler): void {
        super.injectMCPComponents(mcpManager, toolsHandler);
    }

    private async ensureConnection(): Promise<void> {
        if (this.isInitialized) return;

        let attempts = this.maxRetries;
        while (attempts > 0) {
            try {
                // Try a simple ping/list request
                await this.client.list();
                this.isInitialized = true;
                console.log('[OllamaService] Successfully connected to Ollama server');
                return;
            } catch (error) {
                attempts--;
                if (attempts === 0) {
                    console.error('[OllamaService] Failed to connect to Ollama server after multiple attempts:', error);
                    throw new Error('Failed to connect to Ollama server. Please ensure Ollama is running and accessible.');
                }
                console.warn(`[OllamaService] Connection attempt failed, retrying... (${attempts} attempts left)`);
                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
            }
        }
    }

    async generateResponse(message: string, conversationHistory?: Message[]): Promise<AIResponse> {
        await this.ensureConnection();
        console.log('[OllamaService] Generating response with tools:', !!this.toolsHandler);
        if (this.toolsHandler) {
            const tools = await this.getAvailableTools();
            console.log(`[OllamaService] Available tools: ${tools.length}`);
            return this.handleToolBasedCompletion(
                conversationHistory ? [...this.convertToOpenAIMessages(conversationHistory), { role: 'user', content: message }] : [{ role: 'user', content: message }],
                tools,
                this.toolsHandler,
                conversationHistory?.[0]?.conversationId
            );
        }
        return this.processMessage(message, conversationHistory);
    }

    private async getAvailableTools(): Promise<OllamaToolDefinition[]> {
        const now = Date.now();
        if (this.cachedTools && (now - this.lastToolUpdateTime) < this.TOOL_CACHE_TTL) {
            console.log('[OllamaService] Using cached tools');
            return this.cachedTools;
        }

        if (!this.toolsHandler || !this.mcpManager) return [];
        try {
            const tools = [];
            const serverIds = this.mcpManager.getServerIds();
            
            for (const serverId of serverIds) {
                try {
                    const server = this.mcpManager.getServerByIds(serverId);
                    if (!server) {
                        console.warn(`[OllamaService] Server ${serverId} not found`);
                        continue;
                    }

                    const enabledTools = await this.mcpManager.getEnabledTools(serverId);
                    const enabledToolNames = new Set(enabledTools.map(t => t.name));
                    
                    const serverTools = await server.listTools();
                    const enabledServerTools = serverTools.filter(t => enabledToolNames.has(t.name));
                    
                    console.log(`[OllamaService] Found ${enabledServerTools.length} enabled tools for server ${serverId}`);
                    
                    const convertedTools = OllamaToolAdapter.convertMCPToolsToOllama(enabledServerTools);
                    tools.push(...convertedTools);
                    
                    if (process.env.DEBUG) {
                        console.log(`[OllamaService] Converted tools for ${serverId}:`, 
                            convertedTools.map(t => t.function.name));
                    }
                } catch (error) {
                    console.error(`[OllamaService] Failed to get tools for server ${serverId}:`, error);
                }
            }

            this.cachedTools = tools;
            this.lastToolUpdateTime = now;
            return tools;
        } catch (error) {
            console.error('[OllamaService] Failed to get available tools:', error);
            return this.cachedTools || [];
        }
    }

    protected async processWithoutTools(message: string, conversationHistory?: Message[]): Promise<AIResponse> {
        await this.ensureConnection();
        return this.processMessage(message, conversationHistory);
    }

    protected async makeApiCall(messages: ChatCompletionMessageParam[], temperature: number) {
        await this.ensureConnection();
        try {
            console.log('[OllamaService] Making API call with temperature:', temperature);
            
            const response = await this.client.chat({
                model: this.model,
                messages: messages.map(msg => ({
                    role: msg.role,
                    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
                })) as OllamaMessage[],
                options: {
                    temperature
                }
            });

            return {
                choices: [{
                    message: {
                        role: 'assistant' as const,
                        content: response.message.content
                    },
                    finish_reason: 'stop'
                }],
                usage: {
                    total_tokens: 0
                }
            };
        } catch (error) {
            console.error('[OllamaService] API call failed:', error);
            throw new Error('Failed to get response from Ollama. Please try again later.');
        }
    }

    protected async handleToolBasedCompletion(
        messages: ChatCompletionMessageParam[],
        functions: OllamaToolDefinition[],
        toolsHandler: ToolsHandler,
        conversationId?: number
    ): Promise<AIResponse> {
        await this.ensureConnection();
        try {
            console.log('[OllamaService] Starting tool-based completion with:', {
                messageCount: messages.length,
                functionCount: functions.length,
                hasConversationId: !!conversationId
            });

            // Convert messages to Ollama format and add system message
            const ollamaMessages: OllamaMessage[] = [
                {
                    role: 'system',
                    content: `You are a helpful assistant with access to tools. ONLY use the tools that are explicitly provided to you. 
When using tools:
1. Use ONLY the tools that are available in the tools list
2. Process and filter results yourself - do not try to use additional tools to filter or process results
3. If you need to process or filter results, do it in your response after getting the tool results
4. Format your responses clearly and concisely

Remember: NEVER try to use tools that haven't been explicitly provided to you.`
                },
                ...messages.map(msg => ({
                    role: msg.role as 'system' | 'user' | 'assistant' | 'tool',
                    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
                }))
            ];

            // Make initial API call with tools
            const response = await this.client.chat({
                model: this.model,
                messages: ollamaMessages,
                tools: functions,
                options: {
                    temperature: 0.7
                }
            });

            // Log the response in debug mode
            if (process.env.DEBUG === 'true') {
                console.log('[OllamaService] Raw response:', JSON.stringify(response.message, null, 2));
            }

            const toolResults: string[] = [];
            
            // Process tool calls if any
            if (response.message.tool_calls && response.message.tool_calls.length > 0 && conversationId) {
                // Add assistant's response with tool calls to conversation
                ollamaMessages.push({
                    role: response.message.role as 'system' | 'user' | 'assistant' | 'tool',
                    content: response.message.content,
                    tool_calls: response.message.tool_calls
                });

                // Process each tool call
                for (const toolCall of response.message.tool_calls) {
                    try {
                        console.log(`[OllamaService] Executing tool: ${toolCall.function.name}`);
                        const query = `[Calling tool ${toolCall.function.name} with args ${JSON.stringify(toolCall.function.arguments)}]`;
                        const result = await toolsHandler.processQuery(query, conversationId);
                        console.log(`[OllamaService] Tool ${toolCall.function.name} result:`, result);
                        
                        // Add tool result to conversation
                        ollamaMessages.push({
                            role: 'tool',
                            content: result
                        });
                        
                        toolResults.push(result);
                    } catch (error) {
                        console.error(`[OllamaService] Tool execution failed:`, error);
                        ollamaMessages.push({
                            role: 'tool',
                            content: `Error: ${error instanceof Error ? error.message : String(error)}`
                        });
                    }
                }

                // Get final response incorporating tool results
                const finalResponse = await this.client.chat({
                    model: this.model,
                    messages: ollamaMessages,
                    options: {
                        temperature: 0.7
                    }
                });

                return {
                    content: finalResponse.message.content,
                    tokenCount: 0,
                    toolResults
                };
            }

            // If no tool calls were made, return the initial response
            return {
                content: response.message.content,
                tokenCount: 0,
                toolResults
            };
        } catch (error) {
            console.error('[OllamaService] Tool-based completion failed:', error);
            throw new Error('Failed to process tool-based completion. Please try again later.');
        }
    }

    async processMessage(message: string, conversationHistory?: Message[]): Promise<AIResponse> {
        await this.ensureConnection();
        try {
            console.log('[OllamaService] Processing message with history:', !!conversationHistory);
            
            // If we have tools available, use handleToolBasedCompletion
            if (this.toolsHandler) {
                const tools = await this.getAvailableTools();
                const messages = conversationHistory ? this.convertToOpenAIMessages(conversationHistory) : [];
                messages.push({ role: 'user', content: message });
                
                return this.handleToolBasedCompletion(
                    messages,
                    tools,
                    this.toolsHandler,
                    conversationHistory?.[0]?.conversationId
                );
            }

            // Otherwise do a simple message exchange
            const messages = conversationHistory ? this.convertToOpenAIMessages(conversationHistory) : [];
            messages.push({
                role: 'user',
                content: message
            });

            const response = await this.client.chat({
                model: this.model,
                messages: messages.map(msg => ({
                    role: msg.role,
                    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
                })) as OllamaMessage[],
                options: {
                    temperature: 0.7
                }
            });

            return {
                content: response.message.content,
                tokenCount: 0,
                toolResults: []
            };
        } catch (error) {
            console.error('[OllamaService] Message processing failed:', error);
            throw new Error('Failed to process message with Ollama. Please try again later.');
        }
    }

    private convertToOpenAIMessages(history: Message[]): ChatCompletionMessageParam[] {
        return history.map(msg => ({
            role: msg.role.toLowerCase() as 'user' | 'assistant' | 'system',
            content: msg.content
        }));
    }

    getModel(): 'gpt' | 'claude' | 'deepseek' | 'ollama' {
        return 'ollama';
    }

    async cleanup(): Promise<void> {
        this.cachedTools = null;
        if (this.mcpManager) {
            const serverIds = this.mcpManager.getServerIds();
            await Promise.all(serverIds.map(id => this.mcpManager!.stopServer(id)));
        }
        if (this.isInitialized) {
            await this.client.abort();
        }
    }
}