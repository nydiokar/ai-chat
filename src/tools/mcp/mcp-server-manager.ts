import dotenv from 'dotenv';
dotenv.config();

import { DatabaseService } from "../../services/db-service.js";
import { MCPClientService } from "./mcp-client-service.js";
import { ServerStateManager, ServerState } from "./server-state-manager.js";
import { ToolsHandler } from "../tools-handler.js";
import {
    MCPServerConfig,
    MCPToolConfig,
    ToolWithUsage,
    ToolInformationProvider,
    MCPToolDefinition,
    MCPToolResponse,
    MCPConfig
} from "../../types/tools.js";
import { MCPError, ErrorType } from "../../types/errors.js";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { ToolUsage } from '@prisma/client';
import mcpConfig from './mcp_config.js';
import { Cleanable } from "../../types/cleanable.js";

export class MCPServerManager implements ToolInformationProvider, Cleanable {
    private readonly config: MCPConfig;
    private readonly basePath: string;
    private readonly stateManager: ServerStateManager;
    private readonly toolsHandler: ToolsHandler;
    private readonly clients: Map<string, MCPClientService> = new Map();

    constructor(private readonly db: DatabaseService) {
        this.config = mcpConfig;
        this.basePath = dirname(fileURLToPath(import.meta.url));
        this.stateManager = new ServerStateManager();
        
        // Create a single ToolsHandler instance
        this.toolsHandler = new ToolsHandler([], this.db);

        // Listen to server state changes
        this.stateManager.on('serverError', async ({ id, error }) => {
            console.error(`Server ${id} error:`, error);
            await this._updateServerStatusInDB(id, ServerState.ERROR);
        });

        this.stateManager.on('serverPaused', async (id) => {
            await this._updateServerStatusInDB(id, ServerState.PAUSED);
        });

        // Initialize servers on startup
        this._startServers().catch(error => {
            console.error('Failed to start servers during initialization:', error);
        });
    }

    // ToolInformationProvider implementation - delegates to ToolsHandler
    async getAvailableTools(): Promise<MCPToolDefinition[]> {
        return this.toolsHandler.getAvailableTools();
    }

    async getToolByName(name: string): Promise<MCPToolDefinition | undefined> {
        return this.toolsHandler.getToolByName(name);
    }

    async refreshToolInformation(): Promise<void> {
        await this.toolsHandler.refreshToolInformation();
    }

    /**
     * Check if a specific server ID is currently managed
     */
    public hasServer(serverId: string): boolean {
        return this.stateManager.getServerState(serverId) !== null;
    }

    /**
     * List all active server IDs
     */
    public getServerIds(): string[] {
        return Array.from(this.clients.keys());
    }

    /**
     * Get the MCPClientService instance for a given server ID
     */
    async getServerByIds(serverId: string): Promise<MCPClientService | undefined> {
        return this.clients.get(serverId);
    }

    /**
     * Start (or restart) a server by its ID using the provided config.
     */
    async startServer(serverId: string, config: MCPServerConfig): Promise<void> {
        try {
            // Use ServerStateManager to start the server
            const client = await this.stateManager.startServer(serverId, config);
            
            // Add client to our map and update ToolsHandler
            this.clients.set(serverId, client);
            await this.toolsHandler.addClient(serverId, client);
            
            await this._updateServerStatusInDB(serverId, ServerState.RUNNING);
        } catch (error: unknown) {
            throw new MCPError(
                `Failed to start server ${serverId}`,
                ErrorType.SERVER_START_FAILED,
                { cause: error instanceof Error ? error : new Error(String(error)) }
            );
        }
    }

    /**
     * Stop (and remove) a server by its ID.
     */
    async stopServer(serverId: string): Promise<void> {
        await this.stateManager.stopServer(serverId);
        this.clients.delete(serverId);
        await this.toolsHandler.removeClient(serverId);
        await this._updateServerStatusInDB(serverId, ServerState.STOPPED);
    }

    /**
     * Reload a server by stopping and starting it again with the existing config.
     */
    async reloadServer(serverId: string): Promise<void> {
        try {
            await this.stopServer(serverId);
            const config = this.config.mcpServers[serverId];
            if (!config) {
                throw new MCPError(
                    `Configuration not found for server ${serverId}`,
                    ErrorType.SERVER_NOT_FOUND
                );
            }
            await this.startServer(serverId, config);
        } catch (error: unknown) {
            throw new MCPError(
                `Failed to reload server ${serverId}`,
                ErrorType.SERVER_RELOAD_FAILED,
                { cause: error instanceof Error ? error : new Error(String(error)) }
            );
        }
    }

    /**
     * Enable a specific tool on a server.
     */
    async enableTool(serverId: string, toolName: string): Promise<void> {
        if (!this.hasServer(serverId)) {
            throw new MCPError(
                `Server ${serverId} not found`,
                ErrorType.SERVER_NOT_FOUND
            );
        }
        await this.toolsHandler.enableTool(serverId, toolName);
    }

    /**
     * Disable a specific tool on a server.
     */
    async disableTool(serverId: string, toolName: string): Promise<void> {
        if (!this.hasServer(serverId)) {
            throw new MCPError(
                `Server ${serverId} not found`,
                ErrorType.SERVER_NOT_FOUND
            );
        }
        await this.toolsHandler.disableTool(serverId, toolName);
    }

    /**
     * Get all enabled tools for a server.
     */
    async getEnabledTools(serverId: string): Promise<MCPToolConfig[]> {
        if (!this.hasServer(serverId)) {
            throw new MCPError(
                `Server ${serverId} not found`,
                ErrorType.SERVER_NOT_FOUND
            );
        }
        return this.toolsHandler.getEnabledTools(serverId);
    }

    /**
     * Execute a user query against a tool on a given server.
     */
    async executeToolQuery(serverId: string, query: string, conversationId: number): Promise<MCPToolResponse> {
        try {
            const server = await this.getServerByIds(serverId);
            if (!server) {
                throw new MCPError(
                    `Server ${serverId} not found`,
                    ErrorType.SERVER_NOT_FOUND
                );
            }
            const handler = this.toolsHandler;

            const toolName = query.split(" ")[0];
            await this._verifyToolIsEnabled(serverId, toolName);

            // Process the query directly using the tools handler
            return handler.processQuery(query, conversationId);
        } catch (error: unknown) {
            if (error instanceof MCPError) {
                throw error;
            }
            throw new MCPError(
                `Failed to execute tool query on server ${serverId}`,
                ErrorType.TOOL_EXECUTION_FAILED,
                { cause: error instanceof Error ? error : new Error(String(error)) }
            );
        }
    }

    /**
     * Refresh the internal context for a given tool on a server.
     */
    async refreshToolContext(serverId: string, toolName: string, tool: ToolWithUsage): Promise<void> {
        const server = await this.getServerByIds(serverId);
        if (!server) {
            throw new MCPError(
                `Server ${serverId} not found`,
                ErrorType.SERVER_NOT_FOUND
            );
        }
        await this._verifyToolIsEnabled(serverId, toolName);

        const handler = this.toolsHandler;
        try {
            await handler.refreshToolContext(toolName, tool as any & { usage: ToolUsage[] });
        } catch (error: unknown) {
            throw new MCPError(
                `Failed to refresh context for tool ${toolName} on server ${serverId}`,
                ErrorType.TOOL_CONTEXT_REFRESH_FAILED,
                { cause: error instanceof Error ? error : new Error(String(error)) }
            );
        }
    }

    /**
     * Update server status in the database to reflect current state.
     */
    private async _updateServerStatusInDB(serverId: string, status: ServerState): Promise<void> {
        try {
            await this.db.executePrismaOperation(async (prisma) => {
                await prisma.mCPServer.upsert({
                    where: { id: serverId },
                    update: { status: status.toString(), updatedAt: new Date() },
                    create: {
                        id: serverId,
                        status: status.toString(),
                        name: serverId,
                        version: "1.0.0"
                    }
                });
            });
        } catch (dbError) {
            console.error(`Failed to update server status in DB for ${serverId}:`, dbError);
        }
    }

    /**
     * Ensure that a given tool is enabled on a server before proceeding.
     */
    private async _verifyToolIsEnabled(serverId: string, toolName: string): Promise<void> {
        await this.toolsHandler.verifyToolIsEnabled(serverId, toolName);
    }

    private async _startServers(): Promise<void> {
        try {
            const config = mcpConfig;
            const startupPromises = Object.entries(config.mcpServers || {}).map(
                async ([serverId, serverConfig]) => {
                    try {
                        await this.startServer(serverId, serverConfig as MCPServerConfig);
                    } catch (error: unknown) {
                        console.error(`Failed to start server ${serverId}:`, error);
                    }
                }
            );

            await Promise.allSettled(startupPromises);
        } catch (error: unknown) {
            console.error('Failed to start servers:', error);
            throw error;
        }
    }

    async cleanup(): Promise<void> {
        try {
            // Cleanup state manager first
            await this.stateManager.cleanup();

            // Stop all servers
            const stopPromises = Array.from(this.clients.keys()).map(async (serverId) => {
                try {
                    await this.stopServer(serverId);
                } catch (error) {
                    console.error(`Error stopping server ${serverId}:`, error);
                }
            });

            await Promise.all(stopPromises);

            // Clear all collections
            this.clients.clear();
        } catch (error) {
            console.error('[MCPServerManager] Cleanup failed:', error);
            throw error;
        }
    }

    getClients(): MCPClientService[] {
        return Array.from(this.clients.values());
    }
}
