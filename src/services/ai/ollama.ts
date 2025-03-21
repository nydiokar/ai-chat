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
import { AIMessage, AIResponse } from '../../types/ai-service.js';
import { ToolDefinition, ToolResponse } from '../../tools/mcp/types/tools.js';
import { Server } from '../../tools/mcp/types/server.js';
import { MCPContainer } from '../../tools/mcp/di/container.js';
import { MCPError, ErrorType } from '../../types/errors.js';
import { redactSensitiveInfo } from '../../utils/security.js';

export class OllamaService extends BaseAIService {
    private bridge!: OllamaBridge;
    private bridgeInitialized: boolean = false;

    constructor(container: MCPContainer) {
        super(container);
    }

    public getModel(): string {
        return 'ollama';
    }

    public async generateResponse(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse> {
        await this.initialize();
        
        try {
            const response = await this.bridge.processMessage(message);
            return {
                content: response,
                tokenCount: null, // Ollama doesn't provide token counts
                toolResults: []
            };
        } catch (error) {
            debug(`Ollama error: ${error instanceof Error ? error.message : String(error)}`);
            throw new MCPError('Failed to generate response', ErrorType.API_ERROR, { 
                cause: error instanceof Error ? error : new Error(String(error))
            });
        }
    }

    private async initialize(): Promise<void> {
        if (this.bridgeInitialized) {
            return;
        }

        if (!this.container) {
            throw new MCPError('Container not initialized', ErrorType.INITIALIZATION_ERROR);
        }

        try {
            // Initialize clients
            const clients = await this.initializeClients();
            if (clients.size === 0) {
                throw new MCPError('No MCP clients could be initialized', ErrorType.INITIALIZATION_ERROR);
            }

            // Initialize bridge with the tool manager from BaseAIService
            this.bridge = new OllamaBridge(
                "llama3.2:latest",
                "http://127.0.0.1:11434",
                clients,
                this.toolManager
            );

            // Use tools from the central tool manager
            const tools = await this.toolManager.getAvailableTools();
            await this.bridge.updateAvailableTools(tools);
            
            this.bridgeInitialized = true;
            debug('OllamaService initialization complete');
        } catch (error) {
            throw new MCPError('Failed to initialize OllamaService', ErrorType.INITIALIZATION_ERROR, {
                cause: error instanceof Error ? error : new Error(String(error))
            });
        }
    }

    private async initializeClients(): Promise<Map<string, MCPClientService>> {
        const clients = new Map<string, MCPClientService>();
        const serverManager = this.container.getServerManager();
        const serverIds = serverManager.getServerIds();
        
        for (const serverId of serverIds) {
            try {
                const server = serverManager.getServer(serverId);
                if (server) {
                    const client = await this.createClientFromServer(server);
                    if (client) {
                        clients.set(serverId, client);
                        debug(`Successfully initialized client for server ${serverId}`);
                    }
                }
            } catch (error) {
                debug(`Failed to initialize client for server ${serverId}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        return clients;
    }

    private async createClientFromServer(server: Server): Promise<MCPClientService | undefined> {
        try {
            const client = new MCPClientService(server.config);
            await client.initialize();
            return client;
        } catch (error) {
            debug(`Failed to create MCPClientService: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
    }

    private convertToToolDefinition(mcpTool: ToolDefinition): ToolDefinition {
        const handler = mcpTool.handler;
        if (!handler || typeof handler !== 'function') {
            throw new MCPError(`Tool ${mcpTool.name} has no valid handler`, ErrorType.TOOL_ERROR);
        }

        return {
            name: mcpTool.name,
            description: mcpTool.description,
            version: mcpTool.version || '1.0.0',
            parameters: mcpTool.parameters || [],
            enabled: true,
            server: mcpTool.server,
            handler: async (args: any): Promise<ToolResponse> => {
                try {
                    const mcpResponse = await handler(args);
                    return {
                        success: !mcpResponse.error,
                        data: mcpResponse.data,
                        error: mcpResponse.error,
                        metadata: mcpResponse.metadata
                    };
                } catch (error) {
                    return {
                        success: false,
                        data: null,
                        error: error instanceof Error ? error.message : String(error)
                    };
                }
            }
        };
    }
} 