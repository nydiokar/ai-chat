import dotenv from 'dotenv';
dotenv.config(); // Load environment variables first

import { DatabaseService } from "../db-service.js";
import { MCPClientService } from "./mcp-client-service.js";
import EventEmitter from "events";
import { ToolsHandler } from "./tools-handler.js";
import { AIService } from "../ai/base-service.js";
import {
  getMCPConfig,
  MCPConfig,
  MCPServerConfig,
  MCPToolConfig,
  ToolWithUsage
} from "../../types/mcp-config.js";
import { MCPError, ErrorType } from "../../types/errors.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { MCPToolUsage } from '@prisma/client';
export class MCPServerManager extends EventEmitter {
  private readonly _servers: Map<string, MCPClientService> = new Map();
  private readonly _toolsHandlers: Map<string, ToolsHandler> = new Map();
  private readonly config: MCPConfig;
  private readonly basePath: string;

  constructor(private db: DatabaseService, private aiService: AIService) {
    super();
    console.log("[MCPServerManager] Constructor started");
    this.config = getMCPConfig();
    console.log(
        "[MCPServerManager] Server configurations:",
        Object.keys(this.config.mcpServers).map(id => ({
            id,
            command: this.config.mcpServers[id].command,
            args: this.config.mcpServers[id].args
        }))
    );

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    this.basePath = join(__dirname, "..", "..", "..");

    this._startHealthCheck();
    console.log("[MCPServerManager] Constructor completed");
  }

  /**
   * Check if a specific server ID is currently managed
   */
  public hasServer(serverId: string): boolean {
    return this._servers.has(serverId);
  }

  /**
   * List all active server IDs
   */
  public getServerIds(): string[] {
    return [...this._servers.keys()];
  }

  /**
   * Get the MCPClientService instance for a given server ID
   */
  public getServerByIds(serverId: string): MCPClientService | undefined {
    return this._servers.get(serverId);
  }

  /**
   * Get the ToolsHandler instance for a given server ID
   */
  public getToolsHandler(serverId: string): ToolsHandler | undefined {
    return this._toolsHandlers.get(serverId);
  }

  /**
   * Start (or restart) a server by its ID using the provided config.
   */
  async startServer(serverId: string, config: MCPServerConfig): Promise<void> {
    try {
        console.log(
            `[MCPServerManager] Starting server: ${serverId} with full config:`,
            JSON.stringify({
                ...config,
                env: Object.keys(config.env || {}) // Only log keys, not values
            }, null, 2)
        );

        if (this.hasServer(serverId)) {
            console.log(`[MCPServerManager] Server ${serverId} is already running`);
            return;
        }

        const client = new MCPClientService(config);
        console.log(`[MCPServerManager] Created MCPClientService for ${serverId}`);
        
        client.initialize();
        console.log(`[MCPServerManager] Initialized MCPClientService for ${serverId}`);
        
        await client.connect();

        const tools = await client.listTools();
        console.log(
          `[MCPServerManager] Server ${serverId} started with ${tools.length} tools`
        );

        await this._syncToolsWithDB(serverId, tools);
        this._servers.set(serverId, client);

        await this._updateServerStatusInDB(serverId, "RUNNING");
    } catch (error) {
      this._servers.delete(serverId);
      throw new MCPError(
        ErrorType.SERVER_START_FAILED,
        `Failed to start server ${serverId}`,
        error
      );
    }
  }

  /**
   * Stop (and remove) a server by its ID.
   */
  async stopServer(serverId: string): Promise<void> {
    const server = this._servers.get(serverId);
    if (server) {
      await server.cleanup();
      this._servers.delete(serverId);
      this._toolsHandlers.delete(serverId);
      await this._updateServerStatusInDB(serverId, "STOPPED");
    }
  }

  /**
   * Reload a server by stopping and starting it again with the existing config.
   */
  async reloadServer(serverId: string): Promise<void> {
    try {
      console.log(`[MCPServerManager] Reloading server: ${serverId}`);

      if (this.hasServer(serverId)) {
        await this.stopServer(serverId);
      }

      const config = this.config.mcpServers[serverId];
      if (!config) {
        throw MCPError.serverNotFound(serverId);
      }

      await this.startServer(serverId, config);
      console.log(`[MCPServerManager] Server ${serverId} reloaded successfully`);
    } catch (error) {
      console.error(`[MCPServerManager] Failed to reload server ${serverId}:`, error);
      throw new MCPError(
        ErrorType.SERVER_RELOAD_FAILED,
        `Failed to reload server ${serverId}`,
        error
      );
    }
  }

  /**
   * Enable a specific tool on a server.
   */
  async enableTool(serverId: string, toolName: string): Promise<void> {
    if (!this.hasServer(serverId)) {
      throw new MCPError(
        ErrorType.SERVER_NOT_FOUND,
        `Server ${serverId} not found`
      );
    }
    await this._setToolEnabledState(serverId, toolName, true);
    console.log(`[MCPServerManager] Enabled tool ${toolName} on server ${serverId}`);
  }

  /**
   * Disable a specific tool on a server.
   */
  async disableTool(serverId: string, toolName: string): Promise<void> {
    if (!this.hasServer(serverId)) {
      throw new MCPError(
        ErrorType.SERVER_NOT_FOUND,
        `Server ${serverId} not found`
      );
    }
    await this._setToolEnabledState(serverId, toolName, false);
    console.log(`[MCPServerManager] Disabled tool ${toolName} on server ${serverId}`);
  }

  /**
   * Get all enabled tools for a server.
   */
  async getEnabledTools(serverId: string): Promise<MCPToolConfig[]> {
    return this.db.executePrismaOperation(async (prisma) => {
      return prisma.mCPTool.findMany({
        where: { serverId, isEnabled: true }
      });
    });
  }

  /**
   * Execute a user query against a tool on a given server.
   */
  async executeToolQuery(serverId: string, query: string, conversationId: number): Promise<string> {
    try {
      const server = this._getServerOrThrow(serverId);
      const handler = this._getToolsHandler(serverId, server);

      const toolName = query.split(" ")[0];
      await this._verifyToolIsEnabled(serverId, toolName);

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

  /**
   * Refresh the internal context for a given tool on a server.
   */
  async refreshToolContext(serverId: string, toolName: string, tool: ToolWithUsage): Promise<void> {
    const server = this._getServerOrThrow(serverId);
    await this._verifyToolIsEnabled(serverId, toolName);

    const handler = this._getToolsHandler(serverId, server);
    try {
      await handler.refreshToolContext(toolName, tool as any & { usage: MCPToolUsage[] });
      console.log(
        `[MCPServerManager] Refreshed context for tool ${toolName} on server ${serverId}`
      );
    } catch (error) {
      throw new MCPError(
        ErrorType.TOOL_CONTEXT_REFRESH_FAILED,
        `Failed to refresh context for tool ${toolName} on server ${serverId}`,
        error
      );
    }
  }

  /**
   * Health check function, periodically verifies servers are responsive.
   */
  private _startHealthCheck() {
    setInterval(async () => {
      for (const [serverId, server] of this._servers.entries()) {
        try {
          await server.listTools();
        } catch (error) {
          console.error(
            `[MCPServerManager] Server ${serverId} health check failed:`,
            error
          );
          try {
            console.log(
              `[MCPServerManager] Attempting to restart server ${serverId}`
            );
            await this.stopServer(serverId);
            const config = this.config.mcpServers[serverId];
            if (config) {
              await this.startServer(serverId, config);
            }
          } catch (restartError) {
            console.error(
              `[MCPServerManager] Failed to restart server ${serverId}:`,
              restartError
            );
          }
        }
      }
    }, 60000); // Check every minute
  }

  /**
   * Create or update tools in DB based on the list from the server,
   * and disable any that no longer exist on the server.
   */
  private async _syncToolsWithDB(
    serverId: string,
    tools: { name: string; description: string }[]
  ): Promise<void> {
    try {
        // First, ensure the MCPServer record exists
        await this.db.executePrismaOperation(async (prisma) => {
            await prisma.mCPServer.upsert({
                where: { id: serverId },
                create: {
                    id: serverId,
                    name: serverId, // or get this from config
                    version: "1.0.0", // or get from actual server version
                    status: "RUNNING"
                },
                update: {
                    status: "RUNNING",
                    updatedAt: new Date()
                }
            });
        });

        // Now sync the tools
        await this.db.executePrismaOperation(async (prisma) => {
            for (const tool of tools) {
                await prisma.mCPTool.upsert({
                    where: {
                        serverId_name: {
                            serverId: serverId,
                            name: tool.name
                        }
                    },
                    create: {
                        id: `${serverId}:${tool.name}`,
                        serverId: serverId,
                        name: tool.name,
                        description: tool.description
                    },
                    update: {
                        description: tool.description,
                        updatedAt: new Date()
                    }
                });
            }
        });
    } catch (error) {
        console.error("Error syncing tools with DB:", error);
        throw error;
    }
  }

  /**
   * Update server status in the database to reflect current state.
   */
  private async _updateServerStatusInDB(serverId: string, status: string): Promise<void> {
    try {
      await this.db.executePrismaOperation(async (prisma) => {
        await prisma.mCPServer.upsert({
          where: { id: serverId },
          update: { status, updatedAt: new Date() },
          create: {
            id: serverId,
            status,
            name: serverId,
            version: "1.0.0"
          }
        });
      });
    } catch (dbError) {
      console.warn(
        `Database update failed for server ${serverId}, status: ${status}`,
        dbError
      );
      // We don't throw here; it's not fatal if the DB update fails
    }
  }

  /**
   * Enable or disable a tool in the database.
   */
  private async _setToolEnabledState(serverId: string, toolName: string, isEnabled: boolean): Promise<void> {
    await this.db.executePrismaOperation(async (prisma) => {
      await prisma.mCPTool.update({
        where: {
          serverId_name: {
            serverId,
            name: toolName
          }
        },
        data: {
          isEnabled,
          updatedAt: new Date()
        }
      });
    });
  }

  /**
   * Retrieve an existing server instance or throw an error if not found.
   */
  private _getServerOrThrow(serverId: string): MCPClientService {
    const server = this._servers.get(serverId);
    if (!server) {
      throw new MCPError(
        ErrorType.SERVER_NOT_FOUND,
        `Server ${serverId} not found`
      );
    }
    return server;
  }

  /**
   * Retrieve a ToolsHandler for the given server. Create one if it doesn't exist.
   */
  private _getToolsHandler(
    serverId: string,
    server: MCPClientService
  ): ToolsHandler {
    let handler = this._toolsHandlers.get(serverId);
    if (!handler) {
      handler = new ToolsHandler(server, this.aiService, this.db);
      this._toolsHandlers.set(serverId, handler);
    }
    return handler;
  }

  /**
   * Ensure that a given tool is enabled on a server before proceeding.
   */
  private async _verifyToolIsEnabled(serverId: string, toolName: string): Promise<void> {
    const enabledTools = await this.getEnabledTools(serverId);
    if (!enabledTools.some((tool) => tool.name === toolName)) {
      throw new MCPError(
        ErrorType.TOOL_NOT_FOUND,
        `Tool ${toolName} is not enabled on server ${serverId}`
      );
    }
  }
}
