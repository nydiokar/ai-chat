import { DatabaseService } from "./db-service.js";

import { MCPClientService } from "./mcp-client-service.js";

import EventEmitter from "events";
import { ToolsHandler } from "./tools-handler.js";
import { AIService } from "./ai-service.js";
import { MCPServerConfig } from "../types/mcp-config.js";

// This manages multiple tool servers and their lifecycle
export class MCPServerManager extends EventEmitter {
    private readonly _servers: Map<string, MCPClientService> = new Map();
    private readonly _toolsHandlers: Map<string, ToolsHandler> = new Map();

    constructor(
        private db: DatabaseService,
        private aiService: AIService
    ) {
        super();
    }

    // Public method to check if server exists
    public hasServer(serverId: string): boolean {
        return this._servers.has(serverId);
    }

    // Public method to get active server IDs
    public getServerIds(): string[] {
        return Array.from(this._servers.keys());
    }

    async startServer(serverId: string, config: MCPServerConfig): Promise<void> {
        const client = new MCPClientService(config);
        await client.connect();
        this._servers.set(serverId, client);
        
        await this.db.executePrismaOperation(async (prisma) => {
            await prisma.mCPServer.update({
                where: { id: serverId },
                data: { status: 'RUNNING' }
            });
        });
    }

    async executeToolQuery(serverId: string, query: string, conversationId: number): Promise<string> {
        const server = this._servers.get(serverId);
        if (!server) throw new Error(`Server ${serverId} not found`);

        let handler = this._toolsHandlers.get(serverId);
        if (!handler) {
            handler = new ToolsHandler(server, this.aiService, this.db);
            this._toolsHandlers.set(serverId, handler);
        }

        return handler.processQuery(query, conversationId);
    }

    async stopServer(serverId: string): Promise<void> {
        const server = this._servers.get(serverId);
        if (server) {
            await server.cleanup();
            this._servers.delete(serverId);
            this._toolsHandlers.delete(serverId);
            
            await this.db.executePrismaOperation(async (prisma) => {
                await prisma.mCPServer.update({
                    where: { id: serverId },
                    data: { status: 'STOPPED' }
                });
            });
        }
    }
} 