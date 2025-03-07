import { Message, MCPToolContext, ToolUsage } from '../types/index.js';
import { AIService } from '../services/ai/base-service.js';
import { MCPClientService } from './mcp/mcp-client-service.js';
import { DatabaseService } from '../services/db-service.js';
import { MCPError } from '../types/errors.js';
import { ToolUsageHistory, ToolWithUsage } from '../types/tools.js';

export class ToolsHandler {
    private availableTools: Set<string>;
    private toolContexts: Map<string, MCPToolContext> = new Map();
    private clients: Map<string, MCPClientService>;
    private toolClientMap: Map<string, MCPClientService> = new Map();

    constructor(
        clients: { id: string; client: MCPClientService }[],
        private ai: AIService,
        private db: DatabaseService
    ) {
        this.availableTools = new Set();
        this.toolContexts = new Map();
        this.clients = new Map(clients.map(({ id, client }) => [id, client]));
        this.initializeTools();
        // Clear old contexts first
        this.clearOldContexts().then(() => this.loadPersistedContexts());
    }

    private async loadPersistedContexts(): Promise<void> {
        try {
            type DBContext = {
                tool: { name: string };
                contextData: any;
                lastRefreshed: Date;
                refreshCount: number;
            };

            const contexts = await this.db.executePrismaOperation(async (prisma) => {
                const result = await prisma.$queryRaw`
                    SELECT c.*, t.name as toolName 
                    FROM MCPToolContext c
                    JOIN MCPTool t ON t.id = c.toolId
                `;
                return result as DBContext[];
            });

            for (const context of contexts) {
                this.toolContexts.set(context.tool.name, {
                    ...context.contextData,
                    lastRefreshed: context.lastRefreshed,
                    refreshCount: context.refreshCount
                });
            }
            console.log(`[ToolsHandler] Loaded ${contexts.length} persisted tool contexts`);
        } catch (error) {
            console.error('[ToolsHandler] Failed to load persisted contexts:', error);
        }
    }

    public async getToolContext(toolName: string): Promise<MCPToolContext | undefined> {
        if (!this.availableTools.has(toolName)) {
            return undefined;
        }
        return this.toolContexts.get(toolName);
    }

    private async getEnhancedContext(toolName: string, args: any): Promise<any> {
        try {
            return {
                ...args,
                toolName  // Include only the current tool name
            };
        } catch (error) {
            console.error('[ToolsHandler] Failed to get enhanced context:', error);
            return args;
        }
    }

    private async initializeTools() {
        try {
            for (const [serverId, client] of this.clients.entries()) {
                const tools = await client.listTools();
                tools.forEach(tool => {
                    this.availableTools.add(tool.name);
                    this.toolClientMap.set(tool.name, client); // Cache the tool-client mapping
                });
            }
        } catch (error) {
            console.error('[ToolsHandler] Failed to initialize tools:', error);
        }
    }

    private async getClientForTool(toolName: string): Promise<MCPClientService> {
        const client = this.toolClientMap.get(toolName);
        if (!client) {
            // If not found in cache, try to find it and cache it
            for (const [serverId, client] of this.clients.entries()) {
                if (await client.hasToolEnabled(toolName)) {
                    this.toolClientMap.set(toolName, client);
                    return client;
                }
            }
            throw new Error(`No client found for tool: ${toolName}`);
        }
        return client;
    }

    async refreshToolContext(toolName: string, tool: ToolWithUsage): Promise<void> {
        if (!this.availableTools.has(toolName)) {
            throw new Error(`Tool ${toolName} not found`);
        }

        // Generate new context with usage patterns
        const context = {
            lastRefreshed: new Date(),
            refreshCount: (this.toolContexts.get(toolName)?.refreshCount || 0) + 1,
            history: tool.usage.map((u: ToolUsage) => ({
                args: u.input,
                result: u.output,
                timestamp: u.createdAt,
                success: u.status === 'success'
            } as ToolUsageHistory)),
            patterns: await this.analyzeUsagePatterns(tool.id)
        };

        // Update in-memory context
        this.toolContexts.set(toolName, context);

        // Persist context to database
        await this.db.executePrismaOperation(prisma =>
            prisma.$executeRaw`
                INSERT OR REPLACE INTO MCPToolContext (toolId, contextData, lastRefreshed, refreshCount)
                VALUES (${tool.id}, ${JSON.stringify(context)}, ${context.lastRefreshed}, ${context.refreshCount})
            `
        );

        console.log(`[ToolsHandler] Refreshed and persisted context for tool ${toolName}`);
    }

    private async analyzeUsagePatterns(toolId: string): Promise<any> {
        const usage = await this.db.executePrismaOperation(prisma =>
            prisma.toolUsage.findMany({
                where: {
                    toolId,
                    status: 'success'
                },
                orderBy: { createdAt: 'desc' },
                take: 20
            })
        );

        // Analyze common input patterns
        interface ToolUsageRecord extends ToolUsage {
            input: Record<string, unknown>;
        }

        const inputPatterns = (usage as ToolUsageRecord[]).reduce((acc: Record<string, unknown[]>, u) => {
            if (u.input) {
                const inputKeys = Object.keys(u.input);
                inputKeys.forEach(key => {
                    if (!acc[key]) acc[key] = [];
                    acc[key].push(u.input[key]);
                });
            }
            return acc;
        }, {});

        const patterns = Object.entries(inputPatterns).reduce((acc: Record<string, { mostCommon: unknown[]; uniqueValues: number }>, [key, values]) => {
            const frequency = (values as unknown[]).reduce((freq: Record<string, number>, val) => {
                const strVal = JSON.stringify(val);
                freq[strVal] = (freq[strVal] || 0) + 1;
                return freq;
            }, {});

            acc[key] = {
                mostCommon: Object.entries(frequency)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 3)
                    .map(([val]) => JSON.parse(val)),
                uniqueValues: new Set(values.map(v => JSON.stringify(v))).size
            };
            return acc;
        }, {});

        return patterns;
    }

    async processQuery(query: string, conversationId: number): Promise<string> {
        const toolMatch = query.match(/\[Calling tool (\w+) with args (.+)\]/);
        
        if (toolMatch) {
            const [, toolName, argsStr] = toolMatch;
            try {
                const args = JSON.parse(argsStr);
                const enhancedContext = await this.getEnhancedContext(toolName, args);
                const client = await this.getClientForTool(toolName);
                
                console.log(`[Tool:${toolName}] Executing...`);
                const result = await client.callTool(toolName, args, enhancedContext);
                console.log(`[Tool:${toolName}] Completed ✓`);
                
                await this.db.addMessage(conversationId, result, 'assistant');
                return result;
            } catch (error) {
                console.error(`[Tool:${toolName}] Failed ✗`, error);
                throw MCPError.toolExecutionFailed(error);
            }
        }
        throw new Error(`Invalid tool query format: ${query}`);
    }

    private async clearOldContexts(): Promise<void> {
        try {
            await this.db.executePrismaOperation(async (prisma) => {
                await prisma.$executeRaw`
                    DELETE FROM MCPToolContext 
                    WHERE lastRefreshed < datetime('now', '-1 day')
                `;
            });
        } catch (error) {
            console.error('[ToolsHandler] Failed to clear old contexts:', error);
        }
    }
}
