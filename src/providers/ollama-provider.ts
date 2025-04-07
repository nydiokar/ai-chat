import { LLMProvider } from '../interfaces/llm-provider.js';
import { Input, Response } from '../types/common.js';
import { MCPContainer } from '../tools/mcp/di/container.js';
import { MCPError, ErrorType } from '../types/errors.js';
import { OllamaBridge } from './utils/ollama_helpers/ollama-bridge.js';
import { IMCPClient } from '../tools/mcp/interfaces/core.js';
import { debug } from '../utils/logger.js';
import { ToolDefinition } from '../tools/mcp/types/tools.js';

export class OllamaProvider implements LLMProvider {
    private bridge!: OllamaBridge;
    private bridgeInitialized: boolean = false;
    private model: string;
    private endpoint: string;
    private systemPrompt: string = '';

    constructor(
        container: MCPContainer,
        model: string = "llama3.2:latest",
        endpoint: string = "http://127.0.0.1:11434"
    ) {
        this.model = model;
        this.endpoint = endpoint;
        this.initialize(container).catch(error => {
            debug(`Failed to initialize OllamaProvider: ${error instanceof Error ? error.message : String(error)}`);
        });
    }

    public getModel(): string {
        return this.model;
    }

    public setSystemPrompt(prompt: string): void {
        this.systemPrompt = prompt;
    }

    public async generateResponse(
        message: string, 
        conversationHistory?: Input[], 
        tools?: ToolDefinition[]
    ): Promise<Response> {
        const content = await this.processMessage(message, conversationHistory || []);
        return {
            content,
            tokenCount: null, // Ollama doesn't provide token counts
            toolResults: []
        };
    }

    public async processMessage(message: string, history: Input[]): Promise<string> {
        await this.ensureInitialized();
        
        try {
            const response = await this.bridge.processMessage(message);
            return response;
        } catch (error) {
            debug(`Ollama error: ${error instanceof Error ? error.message : String(error)}`);
            throw new MCPError('Failed to generate response', ErrorType.API_ERROR, { 
                cause: error instanceof Error ? error : new Error(String(error))
            });
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (this.bridgeInitialized) {
            return;
        }
        throw new MCPError('OllamaProvider not initialized', ErrorType.INITIALIZATION_ERROR);
    }

    private async initialize(container: MCPContainer): Promise<void> {
        if (!container) {
            throw new MCPError('Container not initialized', ErrorType.INITIALIZATION_ERROR);
        }

        try {
            // Initialize clients
            const clients = await this.initializeClients(container);
            if (clients.size === 0) {
                throw new MCPError('No MCP clients could be initialized', ErrorType.INITIALIZATION_ERROR);
            }

            // Initialize bridge with the tool manager from container
            this.bridge = new OllamaBridge(
                this.model,
                this.endpoint,
                clients,
                container.getToolManager()
            );

            // Use tools from the central tool manager
            const tools = await container.getToolManager().getAvailableTools();
            await this.bridge.updateAvailableTools(tools);
            
            this.bridgeInitialized = true;
            debug('OllamaProvider initialization complete');
        } catch (error) {
            throw new MCPError('Failed to initialize OllamaProvider', ErrorType.INITIALIZATION_ERROR, {
                cause: error instanceof Error ? error : new Error(String(error))
            });
        }
    }

    private async initializeClients(container: MCPContainer): Promise<Map<string, IMCPClient>> {
        const clients = new Map<string, IMCPClient>();
        
        // Get server manager from container
        const serverManager = container.getServerManager();
        const serverIds = serverManager.getServerIds();
        
        for (const serverId of serverIds) {
            try {
                const client = container.getMCPClient(serverId);
                await client.initialize();
                clients.set(serverId, client);
            } catch (error) {
                debug(`Failed to initialize client for server ${serverId}: ${error instanceof Error ? error.message : String(error)}`);
                // Continue with other clients even if one fails
            }
        }
        
        return clients;
    }

    public async cleanup(): Promise<void> {
        this.bridgeInitialized = false;
    }
} 