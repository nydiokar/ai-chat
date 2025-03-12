import { BaseAIService } from './base-service.js';
import { OllamaBridge } from './utils/ollama_helpers/ollama-bridge.js';
import { MCPClientService } from '../../tools/mcp/mcp-client-service.js';
import {
    ChatCompletionMessageParam,
    ChatCompletionAssistantMessageParam,
    ChatCompletionToolMessageParam,
    ChatCompletionUserMessageParam,
    ChatCompletionSystemMessageParam
} from 'openai/resources/chat/completions.js';
import { debug } from '../../utils/config.js';
import { AIResponse, AIMessage } from '../../types/ai-service.js';
import { MCPToolResponse, MCPToolDefinition } from '../../types/tools.js';
import { Server } from '../../tools/mcp/migration/types/server.js';
import { MCPContainer } from '../../tools/mcp/migration/di/container.js';
import { ToolDefinition } from '../../tools/mcp/migration/types/tools.js';

export class OllamaService extends BaseAIService {
    private bridge!: OllamaBridge;
    private bridgeInitialized: boolean = false;

    constructor(container: MCPContainer) {
        super(container);
    }

    private convertToToolDefinition(mcpTool: MCPToolDefinition): ToolDefinition {
        return {
            name: mcpTool.name,
            description: mcpTool.description,
            version: '1.0.0', // Default version
            parameters: [], // We'll extract these from the inputSchema
            enabled: true,
            server: mcpTool.server,
            inputSchema: mcpTool.inputSchema,
            handler: async (args: any) => {
                const mcpResponse = await mcpTool.handler(args);
                return {
                    success: !mcpResponse.isError,
                    data: mcpResponse.content[0]?.text || JSON.stringify(mcpResponse.content),
                    error: mcpResponse.isError ? mcpResponse.content[0]?.text : undefined,
                    metadata: mcpResponse.content[0]?.metadata
                };
            }
        };
    }

    private async initialize(): Promise<void> {
        if (this.bridgeInitialized) {
            return;
        }

        if (!this.container) {
            throw new Error('Container not initialized');
        }

        // Create a map of all available MCP clients
        const clients = new Map<string, MCPClientService>();
        const serverManager = this.container.getServerManager();
        const serverIds = serverManager.getServerIds();
        
        for (const serverId of serverIds) {
            try {
                const server = serverManager.getServer(serverId);
                if (server) {
                    const client = await this.getClientFromServer(server);
                    if (client) {
                        clients.set(serverId, client);
                        debug(`Successfully initialized client for server ${serverId}`);
                    }
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
            this.toolManager
        );

        // Convert MCPToolDefinitions to ToolDefinitions
        const mcpTools = (await Promise.all(Array.from(clients.values()).map(client => client.listTools()))).flat();
        const tools = mcpTools.map((tool: any) => this.convertToToolDefinition(tool));
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

        return this.processWithoutTools(message, conversationHistory);
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

    public async generateResponse(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse> {
        return this.processMessage(message, conversationHistory);
    }

    private async getClientFromServer(server: Server): Promise<MCPClientService | undefined> {
        try {
            const client = new MCPClientService(server.config);
            await client.initialize();
            return client;
        } catch (error) {
            console.error(`Failed to create MCPClientService from server:`, error);
            return undefined;
        }
    }
} 