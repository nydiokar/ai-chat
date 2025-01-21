import dotenv from 'dotenv';
dotenv.config(); // Load environment variables first

import { DatabaseService } from "../db-service.js";

import { MCPClientService } from "./mcp-client-service.js";

import EventEmitter from "events";
import { ToolsHandler } from "./tools-handler.js";
import { AIService } from "../ai/base-service.js";
import { getMCPConfig, MCPConfig, MCPServerConfig } from '../../types/mcp-config.js';
import { MCPError, ErrorType } from "../../types/errors.js";
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// This manages multiple tool servers and their lifecycle
export class MCPServerManager extends EventEmitter {
    private readonly _servers: Map<string, MCPClientService> = new Map();
    private readonly _toolsHandlers: Map<string, ToolsHandler> = new Map();
    private readonly config: MCPConfig;
    private readonly basePath: string;

    private async startHealthCheck() {
        setInterval(async () => {
            for (const [serverId, server] of this._servers.entries()) {
                try {
                    // Test if server is responsive
                    await server.listTools();
                } catch (error) {
                    console.error(`[MCPServerManager] Server ${serverId} health check failed:`, error);
                    
                    // Try to restart the server
                    try {
                        console.log(`[MCPServerManager] Attempting to restart server ${serverId}`);
                        await this.stopServer(serverId);
                        const config = this.config.mcpServers[serverId];
                        if (config) {
                            await this.startServer(serverId, config);
                        }
                    } catch (restartError) {
                        console.error(`[MCPServerManager] Failed to restart server ${serverId}:`, restartError);
                    }
                }
            }
        }, 60000); // Check every minute
    }

    constructor(
        private db: DatabaseService,
        private aiService: AIService
    ) {
        super();
        this.config = getMCPConfig();
        console.log('[MCPServerManager] Loaded config:', JSON.stringify(this.config, null, 2));
        // Get the absolute path to the project root
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        this.basePath = join(__dirname, '..', '..', '..');
        
        // Start health check monitoring
        this.startHealthCheck();
    }

    // Public method to check if server exists
    public hasServer(serverId: string): boolean {
        return this._servers.has(serverId);
    }

    // Public method to get active server IDs
    public getServerIds(): string[] {
        return Array.from(this._servers.keys());
    }

    public getServerByIds(serverId: string): MCPClientService | undefined {
        return this._servers.get(serverId);
    }

    async startServer(serverId: string, config: MCPServerConfig): Promise<void> {
        try {
            console.log(`[MCPServerManager] Starting server: ${serverId} with config:`, JSON.stringify(config, null, 2));

            // Check if server is already running
            if (this._servers.has(serverId)) {
                console.log(`[MCPServerManager] Server ${serverId} is already running`);
                return;
            }

            // Use the command from config directly (no npx override)
            const client = new MCPClientService(config);

            await client.connect();

            // Verify server is working by listing tools
            const tools = await client.listTools();
            console.log(`[MCPServerManager] Server ${serverId} started with ${tools.length} tools`);

            this._servers.set(serverId, client);
            
            // Update database outside of the server initialization
            try {
                await this.db.executePrismaOperation(async (prisma) => {
                    await prisma.mCPServer.upsert({
                        where: { id: serverId },
                        update: { 
                        status: 'RUNNING',
                        updatedAt: new Date()
                    },
                    create: {
                            id: serverId,
                            status: 'RUNNING',
                            name: serverId,
                            version: '1.0.0'
                        }
                    });
                });
            } catch (dbError) {
                console.warn(`Database update failed for server ${serverId}, but server is running:`, dbError);
                // Don't throw here - server is running even if DB update fails
            }

            return;
        } catch (error) {
            this._servers.delete(serverId); // Cleanup if server was partially initialized
            throw new MCPError(
                ErrorType.SERVER_START_FAILED,
                `Failed to start server ${serverId}`,
                error
            );
        }
    }

    async executeToolQuery(serverId: string, query: string, conversationId: number): Promise<string> {
        try {
            const server = this._servers.get(serverId);
            if (!server) {
                throw new MCPError(
                    ErrorType.SERVER_NOT_FOUND,
                    `Server ${serverId} not found`
                );
            }

            let handler = this._toolsHandlers.get(serverId);
            if (!handler) {
                handler = new ToolsHandler(server, this.aiService, this.db);
                this._toolsHandlers.set(serverId, handler);
            }

            return handler.processQuery(query, conversationId);
        } catch (error) {
            if (error instanceof MCPError) {
                throw error;
            }
            throw new MCPError(
                ErrorType.TOOL_EXECUTION_FAILED,
                `Failed to execute tool query on server ${serverId}`,
                error
            );
        }
    }

    async stopServer(serverId: string): Promise<void> {
        const server = this._servers.get(serverId);
        if (server) {
            await server.cleanup();
            this._servers.delete(serverId);
            this._toolsHandlers.delete(serverId);
            
            await this.db.executePrismaOperation(async (prisma) => {
                await prisma.mCPServer.upsert({
                    where: { id: serverId },
                    update: { status: 'STOPPED' },
                    create: {
                        id: serverId,
                        status: 'STOPPED',
                        name: serverId,
                        version: '1.0.0'
                    }
                });
            });
        }
    }
}
