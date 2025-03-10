import { MCPToolContext, ToolUsage, MCPToolResponse, MCPToolDefinition } from '../types/index.js';
import { MCPClientService } from './mcp/mcp-client-service.js';
import { DatabaseService } from '../services/db-service.js';
import { CacheService } from '../services/cache-service.js';
import { MCPError, ErrorType } from '../types/errors.js';
import { ToolUsageHistory, ToolWithUsage, ToolInformationProvider, MCPToolConfig } from '../types/tools.js';
import { z } from 'zod';
import { debug } from '../utils/config.js';

export class ToolsHandler implements ToolInformationProvider {
    private availableTools: Map<string, MCPToolDefinition>;
    private toolContexts: Map<string, MCPToolContext>;
    private clients: Map<string, MCPClientService>;
    private toolClientMap: Map<string, MCPClientService>;
    private cacheService: CacheService;
    private readonly TOOLS_CACHE_KEY = 'available-tools';
    private readonly TOOLS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    private initialized: boolean = false;
    private initializationPromise: Promise<void> | null = null;

    constructor(
        initialClients: { id: string; client: MCPClientService }[] = [],
        private readonly db: DatabaseService
    ) {
        this.availableTools = new Map();
        this.toolContexts = new Map();
        this.clients = new Map(initialClients.map(({ id, client }) => [id, client]));
        this.toolClientMap = new Map();
        this.cacheService = CacheService.getInstance({
            filename: 'tools-cache.json',
            namespace: 'tools',
            ttl: this.TOOLS_CACHE_TTL
        });
    }

    /**
     * Add a new client to the handler
     */
    public async addClient(id: string, client: MCPClientService): Promise<void> {
        this.clients.set(id, client);
        await this.refreshToolInformation();
    }

    /**
     * Remove a client from the handler
     */
    public async removeClient(id: string): Promise<void> {
        this.clients.delete(id);
        // Remove any tools associated with this client
        for (const [toolName, client] of this.toolClientMap.entries()) {
            if (client === this.clients.get(id)) {
                this.toolClientMap.delete(toolName);
                this.availableTools.delete(toolName);
            }
        }
        await this.refreshToolInformation();
    }

    /**
     * Get all clients currently managed by this handler
     */
    public getClients(): Map<string, MCPClientService> {
        return new Map(this.clients);
    }

    public async getAvailableTools(): Promise<MCPToolDefinition[]> {
        await this.ensureInitialized();
        return Array.from(this.availableTools.values());
    }

    public async getToolByName(name: string): Promise<MCPToolDefinition | undefined> {
        await this.ensureInitialized();
        return this.availableTools.get(name);
    }

    public async refreshToolInformation(): Promise<void> {
        this.initialized = false;
        await this.initializeTools();
    }

    private async ensureInitialized(): Promise<void> {
        if (this.initialized) return;
        if (this.initializationPromise) {
            await this.initializationPromise;
            return;
        }

        this.initializationPromise = this.initialize();
        try {
            await this.initializationPromise;
            this.initialized = true;
        } finally {
            this.initializationPromise = null;
        }
    }

    private async initialize(): Promise<void> {
        await Promise.all([
            this.initializeTools(),
            this.clearOldContexts().then(() => this.loadPersistedContexts())
        ]);
    }

    private async initializeTools() {
        try {
            const cachedTools = await this.cacheService.get<MCPToolDefinition[]>(this.TOOLS_CACHE_KEY);
            if (cachedTools) {
                cachedTools.forEach(tool => this.availableTools.set(tool.name, tool));
                return;
            }

            for (const [serverId, client] of this.clients.entries()) {
                try {
                    const tools = await client.listTools();
                    for (const tool of tools) {
                        const toolDef: MCPToolDefinition = {
                            ...tool,
                            handler: async (args: any) => {
                                const result = await client.callTool(tool.name, args);
                                return this.formatToolResponse(result);
                            }
                        };
                        this.availableTools.set(tool.name, toolDef);
                        this.toolClientMap.set(tool.name, client);
                    }
                    debug(`Loaded ${tools.length} tools from server ${serverId}`);
                } catch (error) {
                    console.error(`Error loading tools from server ${serverId}:`, error);
                }
            }

            // Cache the tools
            await this.cacheService.set(
                this.TOOLS_CACHE_KEY,
                Array.from(this.availableTools.values())
            );
        } catch (error) {
            throw MCPError.initializationFailed(error instanceof Error ? error : new Error(String(error)));
        }
    }

    private formatToolResponse(result: any): MCPToolResponse {
        if (typeof result === 'string') {
            return {
                content: [{
                    type: 'text',
                    text: result
                }]
            };
        }

        if (result.error) {
            return {
                content: [{
                    type: 'text',
                    text: result.error
                }],
                isError: true,
                hint: result.hint
            };
        }

        if (Array.isArray(result.content)) {
            return result as MCPToolResponse;
        }

        return {
            content: [{
                type: 'text',
                text: JSON.stringify(result)
            }]
        };
    }

    async processQuery(query: string, conversationId: number): Promise<MCPToolResponse> {
        const toolMatch = query.match(/\[Calling tool (\w+) with args (.+)\]/);
        
        if (!toolMatch) {
            throw MCPError.queryError(`Invalid tool query format: ${query}`);
        }

        const [, toolName, argsStr] = toolMatch;
        const tool = this.availableTools.get(toolName);

        if (!tool) {
            return {
                content: [{
                    type: 'text',
                    text: `Tool ${toolName} not found`
                }],
                isError: true,
                hint: 'Please check available tools and try again'
            };
        }

        try {
            const args = JSON.parse(argsStr);
            const validatedArgs = await this.validateToolArgs(tool, args);
            const enhancedContext = await this.getEnhancedContext(toolName, validatedArgs);
            
            debug(`Executing tool ${toolName} with args:`, validatedArgs);
            const result = await tool.handler(enhancedContext);
            
            // Track tool usage and add to conversation
            await this.trackToolUsage(toolName, {
                input: validatedArgs,
                output: result,
                conversationId,
                status: result.isError ? 'error' : 'success'
            });

            // Add tool response to conversation
            if (result.content?.[0]?.text) {
                await this.db.addMessage(
                    conversationId,
                    result.content[0].text,
                    'assistant'
                );
            }

            return result;
        } catch (error) {
            if (error instanceof z.ZodError) {
                throw MCPError.validationFailed(error);
            }
            throw MCPError.toolExecutionFailed(error instanceof Error ? error : new Error(String(error)));
        }
    }

    private async validateToolArgs(tool: MCPToolDefinition, args: any): Promise<any> {
        try {
            return await tool.inputSchema.parseAsync(args);
        } catch (error) {
            if (error instanceof z.ZodError) {
                const formattedError = error.errors.map(e => 
                    `${e.path.join('.')}: ${e.message}`
                ).join(', ');
                throw new MCPError(`Invalid arguments: ${formattedError}`);
            }
            throw error;
        }
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

    private async trackToolUsage(toolName: string, usage: {
        input: any;
        output: MCPToolResponse;
        conversationId: number;
        status: 'success' | 'error';
    }) {
        try {
            const client = await this.getClientForTool(toolName);
            const tools = await client.listTools();
            const tool = tools.find(t => t.name === toolName);
            
            if (!tool) {
                throw new Error(`Tool ${toolName} not found on MCP server`);
            }

            await this.db.executePrismaOperation(async (prisma) => {
                await prisma.toolUsage.create({
                    data: {
                        mcpToolId: tool.server?.id || '',
                        input: JSON.stringify(usage.input),
                        output: JSON.stringify(usage.output),
                        status: usage.status,
                        conversationId: usage.conversationId,
                        duration: 0, // Required by schema
                        createdAt: new Date()
                    }
                });
            });
        } catch (error) {
            console.error(`Failed to track tool usage for ${toolName}:`, error);
        }
    }

    /**
     * Enable a specific tool on a server.
     */
    public async enableTool(serverId: string, toolName: string): Promise<void> {
        if (!this.clients.has(serverId)) {
            throw new MCPError(
                `Server ${serverId} not found`,
                ErrorType.SERVER_NOT_FOUND
            );
        }
        await this._setToolEnabledState(serverId, toolName, true);
    }

    /**
     * Disable a specific tool on a server.
     */
    public async disableTool(serverId: string, toolName: string): Promise<void> {
        if (!this.clients.has(serverId)) {
            throw new MCPError(
                `Server ${serverId} not found`,
                ErrorType.SERVER_NOT_FOUND
            );
        }
        await this._setToolEnabledState(serverId, toolName, false);
    }

    /**
     * Get all enabled tools for a server.
     */
    public async getEnabledTools(serverId: string): Promise<MCPToolConfig[]> {
        return this.db.executePrismaOperation(async (prisma) => {
            return prisma.mCPTool.findMany({
                where: { serverId, isEnabled: true }
            });
        });
    }

    /**
     * Create or update tools in DB based on the list from the server,
     * and disable any that no longer exist on the server.
     */
    public async syncToolsWithDB(
        serverId: string,
        tools: { name: string; description: string }[]
    ): Promise<void> {
        await this.db.executePrismaOperation(async (prisma) => {
            await prisma.mCPServer.upsert({
                where: { id: serverId },
                create: {
                    id: serverId,
                    name: serverId,
                    version: "1.0.0",
                    status: "RUNNING"
                },
                update: {
                    status: "RUNNING",
                    updatedAt: new Date()
                }
            });
        });

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
     * Ensure that a given tool is enabled on a server before proceeding.
     */
    public async verifyToolIsEnabled(serverId: string, toolName: string): Promise<void> {
        const enabledTools = await this.getEnabledTools(serverId);
        if (!enabledTools.some((tool) => tool.name === toolName)) {
            throw new MCPError(
                `Tool ${toolName} is not enabled on server ${serverId}`,
                ErrorType.TOOL_NOT_FOUND
            );
        }
    }
}
