import { BaseAIService } from './base-service.js';
import { OllamaBridge } from './utils/ollama_helpers/ollama-bridge.js';
import { MCPClientService } from '../../tools/mcp/mcp-client-service.js';
import { ChatCompletionMessageParam, ChatCompletionAssistantMessageParam, ChatCompletionFunctionMessageParam } from 'openai/resources/chat/completions.js';
import { debug } from '../../utils/config.js';
import { ToolsHandler } from '../../tools/tools-handler.js';
import { MCPServerManager } from '../../tools/mcp/mcp-server-manager.js';
import { AIResponse, AIMessage } from '../../types/ai-service.js';
import { MCPToolResponse } from '../../types/tools.js';
import { DatabaseService } from '../../services/db-service.js';

export class OllamaService extends BaseAIService {
    private bridge!: OllamaBridge;
    private bridgeInitialized: boolean = false;
    private mcpManager?: MCPServerManager;
    private toolsHandler?: ToolsHandler;

    constructor(mcpManager?: MCPServerManager) {
        super(mcpManager);
        this.mcpManager = mcpManager;
        if (mcpManager) {
            this.toolsHandler = new ToolsHandler([], DatabaseService.getInstance());
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.bridgeInitialized) {
            await this.initialize();
        }
    }

    private async initialize(): Promise<void> {
        if (this.bridgeInitialized) {
            return;
        }

        await this.ensureInitialized();
        
        if (!this.mcpManager) {
            throw new Error('MCPManager not initialized');
        }

        if (!this.toolsHandler) {
            throw new Error('ToolsHandler not initialized');
        }

        // Create a map of all available MCP clients
        const clients = new Map<string, MCPClientService>();
        const serverIds = this.mcpManager.getServerIds();
        
        for (const serverId of serverIds) {
            try {
                const client = await this.mcpManager.getServerByIds(serverId);
                if (client) {
                    clients.set(serverId, client);
                    debug(`Successfully initialized client for server ${serverId}`);
                }
            } catch (error) {
                console.error(`Failed to initialize client for server ${serverId}:`, error);
            }
        }

        if (clients.size === 0) {
            throw new Error('No MCP clients could be initialized');
        }

        // Initialize the bridge with all available clients
        this.bridge = new OllamaBridge(
            "llama3.2:latest",
            "http://127.0.0.1:11434",
            clients,
            this.toolsHandler
        );

        // Update available tools
        const toolPromises = Array.from(clients.values()).map(async client => {
            try {
                return await client.listTools();
            } catch (error) {
                console.error(`Failed to list tools for client:`, error);
                return [];
            }
        });

        const tools = (await Promise.all(toolPromises)).flat();
        await this.bridge.updateAvailableTools(tools);
        
        this.bridgeInitialized = true;
        debug('OllamaService initialization complete');
    }

    public getModel(): 'gpt' | 'claude' | 'ollama' {
        return 'ollama';
    }

    protected async makeApiCall(
        messages: ChatCompletionMessageParam[],
        temperature: number
    ): Promise<{
        choices: Array<{
            message: ChatCompletionAssistantMessageParam;
            finish_reason: string;
        }>;
        usage?: { total_tokens: number; };
    }> {
        await this.initialize();

        const ollamaMessages = messages.map(msg => ({
            role: msg.role,
            content: msg.content as string
        }));

        const response = await this.bridge.processMessage(ollamaMessages[ollamaMessages.length - 1].content);

        return {
            choices: [{
                message: {
                    role: 'assistant',
                    content: response
                },
                finish_reason: 'stop'
            }],
            usage: {
                total_tokens: 0 // Ollama doesn't provide token counts
            }
        };
    }

    public async processMessage(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse> {
        await this.initialize();

        if (this.toolsHandler) {
            return this.processWithTools(message, conversationHistory);
        }

        return this.processWithoutTools(message, conversationHistory);
    }

    protected async processWithTools(
        message: string,
        conversationHistory?: AIMessage[]
    ): Promise<AIResponse> {
        await this.initialize();
        const messages: ChatCompletionMessageParam[] = [
            { role: "system", content: this.systemPrompt },
            ...(conversationHistory || []).map(msg => {
                if (msg.role === "function" && "name" in msg) {
                    return { role: msg.role, content: msg.content, name: msg.name } as ChatCompletionFunctionMessageParam;
                }
                if (msg.role === "tool" && "tool_call_id" in msg) {
                    return { role: msg.role, content: msg.content, tool_call_id: msg.tool_call_id };
                }
                return { role: msg.role as "user" | "assistant" | "system", content: msg.content };
            }),
            { role: "user", content: message }
        ];

        return this.handleToolBasedCompletion(messages, [], this.toolsHandler!);
    }

    protected async processWithoutTools(
        message: string,
        conversationHistory?: AIMessage[]
    ): Promise<AIResponse> {
        await this.initialize();
        const response = await this.bridge.processMessage(message);
        return {
            content: response,
            tokenCount: null,
            toolResults: []
        };
    }

    protected async handleToolBasedCompletion(
        messages: ChatCompletionMessageParam[],
        functions: any[],
        toolsHandler: ToolsHandler,
        conversationId?: number
    ): Promise<AIResponse> {
        await this.initialize();
        
        try {
            debug('Starting Ollama tool-based completion');
            let currentMessages = [...messages];
            let allToolResults: MCPToolResponse[] = [];

            // Get the last user message
            const userMessage = messages[messages.length - 1].content as string;
            const response = await this.bridge.processMessage(userMessage);

            // Parse the response to extract tool calls
            const toolCalls = this.extractToolCalls(response);
            if (!toolCalls.length) {
                return {
                    content: response,
                    tokenCount: null,
                    toolResults: []
                };
            }

            // Process tool calls
            const toolResults = await Promise.all(
                toolCalls.map(async toolCall => {
                    try {
                        const toolQuery = `[Calling tool ${toolCall.name} with args ${JSON.stringify(toolCall.arguments)}]`;
                        debug(`Processing tool query: ${toolQuery}`);
                        const result = await toolsHandler.processQuery(toolQuery, conversationId ?? 0);
                        debug('Tool execution successful');
                        return result;
                    } catch (error) {
                        console.error(`Tool execution failed:`, error);
                        return {
                            content: [{ type: 'text', text: `Failed to execute tool ${toolCall.name}` }],
                            isError: true
                        };
                    }
                })
            );

            allToolResults.push(...toolResults);

            // Get final response with tool results
            const finalResponse = await this.bridge.processMessage(
                `Tool results: ${JSON.stringify(toolResults)}\nPlease provide a final response based on these results.`
            );

            return {
                content: finalResponse,
                tokenCount: null,
                toolResults: allToolResults
            };
        } catch (error) {
            console.error('Error in Ollama tool-based completion:', error);
            throw error;
        }
    }

    private extractToolCalls(response: string): Array<{ name: string; arguments: any }> {
        const toolCallRegex = /\[Calling tool ([\w-]+) with args ({[^}]+})\]/g;
        const toolCalls = [];
        let match;

        while ((match = toolCallRegex.exec(response)) !== null) {
            try {
                toolCalls.push({
                    name: match[1],
                    arguments: JSON.parse(match[2])
                });
            } catch (error) {
                console.error('Failed to parse tool call:', error);
            }
        }

        return toolCalls;
    }

    public async generateResponse(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse> {
        return this.processMessage(message, conversationHistory);
    }
} 