import { DatabaseService, DatabaseError } from './db-service';
import { debug } from '../config';
import { PrismaClient } from '@prisma/client';

export interface CreateMCPServerInput {
  name: string;
  config?: Record<string, any>;
}

export interface CreateMCPToolInput {
  serverId: string;
  name: string;
  description?: string;
  version?: string;
  config?: Record<string, any>;
}

export interface MCPToolUsageInput {
  toolId: string;
  conversationId: number;
  input?: Record<string, any>;
  output?: Record<string, any>;
  error?: string;
  duration?: number;
  status: 'success' | 'error' | 'timeout';
}

export class MCPDatabaseService {
  private static instance: MCPDatabaseService | null = null;
  private baseService: DatabaseService;
  private prisma: PrismaClient;

  private constructor() {
    this.baseService = DatabaseService.getInstance();
    this.prisma = new PrismaClient();
  }

  public static getInstance(): MCPDatabaseService {
    if (!MCPDatabaseService.instance) {
      MCPDatabaseService.instance = new MCPDatabaseService();
    }
    return MCPDatabaseService.instance;
  }

  // Server Management
  async createServer(input: CreateMCPServerInput) {
    try {
      debug(`Creating MCP server: ${input.name}`);
      return await this.prisma.mcpServer.create({
        data: {
          name: input.name,
          status: 'inactive',
          config: input.config ? JSON.stringify(input.config) : null,
        },
      });
    } catch (error: any) {
      throw new DatabaseError(`Failed to create MCP server: ${error.message}`, error);
    }
  }

  async updateServerStatus(id: string, status: string, error?: string) {
    try {
      debug(`Updating MCP server status: ${id} -> ${status}`);
      return await this.prisma.mcpServer.update({
        where: { id },
        data: {
          status,
          error,
          lastActive: new Date(),
        },
      });
    } catch (error: any) {
      throw new DatabaseError(`Failed to update server status: ${error.message}`, error);
    }
  }

  async getServer(id: string) {
    try {
      return await this.prisma.mcpServer.findUnique({
        where: { id },
        include: {
          tools: true,
        },
      });
    } catch (error: any) {
      throw new DatabaseError(`Failed to get MCP server: ${error.message}`, error);
    }
  }

  async getServerByName(name: string) {
    try {
      return await this.prisma.mcpServer.findUnique({
        where: { name },
        include: {
          tools: true,
        },
      });
    } catch (error: any) {
      throw new DatabaseError(`Failed to get MCP server by name: ${error.message}`, error);
    }
  }

  async listServers() {
    try {
      return await this.prisma.mcpServer.findMany({
        include: {
          tools: true,
        },
      });
    } catch (error: any) {
      throw new DatabaseError(`Failed to list MCP servers: ${error.message}`, error);
    }
  }

  // Tool Management
  async createTool(input: CreateMCPToolInput) {
    try {
      debug(`Creating MCP tool: ${input.name} for server ${input.serverId}`);
      return await this.prisma.mcpTool.create({
        data: {
          serverId: input.serverId,
          name: input.name,
          description: input.description,
          version: input.version,
          config: input.config ? JSON.stringify(input.config) : null,
        },
      });
    } catch (error: any) {
      throw new DatabaseError(`Failed to create MCP tool: ${error.message}`, error);
    }
  }

  async updateTool(id: string, input: Partial<CreateMCPToolInput>) {
    try {
      debug(`Updating MCP tool: ${id}`);
      return await this.prisma.mcpTool.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          version: input.version,
          config: input.config ? JSON.stringify(input.config) : undefined,
        },
      });
    } catch (error: any) {
      throw new DatabaseError(`Failed to update MCP tool: ${error.message}`, error);
    }
  }

  async getTool(id: string) {
    try {
      return await this.prisma.mcpTool.findUnique({
        where: { id },
        include: {
          server: true,
        },
      });
    } catch (error: any) {
      throw new DatabaseError(`Failed to get MCP tool: ${error.message}`, error);
    }
  }

  async listToolsForServer(serverId: string) {
    try {
      return await this.prisma.mcpTool.findMany({
        where: {
          serverId,
          isEnabled: true,
        },
      });
    } catch (error: any) {
      throw new DatabaseError(`Failed to list MCP tools: ${error.message}`, error);
    }
  }

  // Tool Usage Tracking
  async recordToolUsage(input: MCPToolUsageInput) {
    try {
      debug(`Recording tool usage: ${input.toolId} in conversation ${input.conversationId}`);
      return await this.prisma.mcpToolUsage.create({
        data: {
          toolId: input.toolId,
          conversationId: input.conversationId,
          input: input.input ? JSON.stringify(input.input) : null,
          output: input.output ? JSON.stringify(input.output) : null,
          error: input.error,
          duration: input.duration,
          status: input.status,
        },
      });
    } catch (error: any) {
      throw new DatabaseError(`Failed to record tool usage: ${error.message}`, error);
    }
  }

  async getToolUsageStats(toolId: string, days: number = 30) {
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);

      const stats = await this.prisma.mcpToolUsage.groupBy({
        by: ['status'],
        where: {
          toolId,
          timestamp: {
            gte: since,
          },
        },
        _count: true,
        _avg: {
          duration: true,
        },
      });

      return stats;
    } catch (error: any) {
      throw new DatabaseError(`Failed to get tool usage stats: ${error.message}`, error);
    }
  }

  // Cleanup
  async cleanupInactiveServers(hours: number = 24) {
    try {
      const threshold = new Date();
      threshold.setHours(threshold.getHours() - hours);

      debug(`Cleaning up inactive MCP servers older than ${hours} hours`);
      return await this.prisma.mcpServer.updateMany({
        where: {
          lastActive: {
            lt: threshold,
          },
          status: 'active',
        },
        data: {
          status: 'inactive',
        },
      });
    } catch (error: any) {
      throw new DatabaseError(`Failed to cleanup inactive servers: ${error.message}`, error);
    }
  }
}
