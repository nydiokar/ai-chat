import { IMCPClient, IToolManager } from '../interfaces/core.js';
import { ToolDefinition, ToolResponse, ToolHandler } from '../types/tools.js';
import { inject, injectable } from 'inversify';
import { Container } from 'inversify';
import { ServerConfig } from '../types/server.js';
import { debug } from '../../../utils/config.js';

@injectable()
export class BaseToolManager implements IToolManager {
    protected clientsMap: Map<string, IMCPClient>;
    protected toolsCache: Map<string, ToolDefinition>;
    protected handlers: Map<string, ToolHandler>;
    protected serverConfigs: Map<string, ServerConfig>;
    protected readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
    private lastCacheRefresh: number = 0;

    constructor(
        @inject('ClientsMap') clientsMap: Map<string, string>, 
        @inject('Container') container: Container,
        @inject('ServerConfigs') serverConfigs: Map<string, ServerConfig>
    ) {
        this.clientsMap = new Map();
        this.serverConfigs = serverConfigs;
        for (const [serverId, clientId] of clientsMap.entries()) {
            this.clientsMap.set(serverId, container.get<IMCPClient>(clientId));
        }
        this.toolsCache = new Map();
        this.handlers = new Map();
    }

    public registerTool(name: string, handler: ToolHandler): void {
        this.handlers.set(name, handler);
    }

    public async getAvailableTools(): Promise<ToolDefinition[]> {
        if (this.shouldRefreshCache()) {
            await this.refreshToolInformation();
        }
        return Array.from(this.toolsCache.values());
    }

    public async getToolByName(name: string): Promise<ToolDefinition | undefined> {
        if (this.shouldRefreshCache()) {
            await this.refreshToolInformation();
        }
        return this.toolsCache.get(name);
    }

    public clearCache(): void {
        debug('Manually clearing tool cache');
        this.toolsCache.clear();
        this.lastCacheRefresh = 0;
    }

    private shouldRefreshCache(): boolean {
        // Only refresh if cache is empty or TTL has expired
        const shouldRefresh = this.toolsCache.size === 0 || 
                             Date.now() - this.lastCacheRefresh > this.CACHE_TTL;
        
        // If we're refreshing, update the timestamp to prevent multiple refreshes
        if (shouldRefresh) {
            this.lastCacheRefresh = Date.now();
        }
        return shouldRefresh;
    }

    public async executeTool(name: string, args: any): Promise<ToolResponse> {
        console.log(`Executing tool: ${name}`);
        
        const tool = await this.getToolByName(name);
        if (!tool) {
            const error = `Tool ${name} not found`;
            console.error(error);
            return {
                success: false,
                data: null,
                error
            };
        }

        // First try local handler if registered
        const handler = this.handlers.get(name);
        if (handler) {
            try {
                return handler(args);
            } catch (error) {
                const errorMsg = `Error executing local handler for ${name}: ${error instanceof Error ? error.message : String(error)}`;
                console.error(errorMsg);
                return {
                    success: false,
                    data: null,
                    error: errorMsg
                };
            }
        }
        
        // Get the appropriate client for this tool
        const client = this.clientsMap.get(tool.server?.id || '');
        if (!client) {
            const error = `No client found for server ${tool.server?.id}`;
            console.error(error);
            return {
                success: false,
                data: null,
                error
            };
        }
        
        // Execute with the client
        try {
            return client.callTool(name, args);
        } catch (error) {
            const errorMsg = `Error calling remote tool ${name}: ${error instanceof Error ? error.message : String(error)}`;
            console.error(errorMsg);
            return {
                success: false,
                data: null,
                error: errorMsg
            };
        }
    }

    public async refreshToolInformation(force: boolean = false): Promise<void> {
        // Skip if not forced and cache is still valid
        if (!force && !this.shouldRefreshCache()) {
            return;
        }

        const toolSummary: Record<string, { available: number; unavailable: number }> = {};

        for (const [serverId, client] of this.clientsMap.entries()) {
            try {
                // Initialize the client first
                await client.initialize();

                // Now try to list tools
                const tools = await client.listTools();
                
                // Update tool cache for this server
                tools.forEach((tool: ToolDefinition) => {
                    this.toolsCache.set(tool.name, {
                        ...tool,
                        server: this.serverConfigs.get(serverId),
                        enabled: true,
                        metadata: tool.metadata || {}
                    });
                });
                
                // Update summary
                toolSummary[serverId] = {
                    available: tools.length,
                    unavailable: 0
                };

                console.log(`[${serverId}] Successfully loaded ${tools.length} tools`);
            } catch (error) {
                console.error(`[${serverId}] Failed to refresh tools:`, error);
                
                // Clear tool cache for this server
                for (const [toolName, tool] of this.toolsCache.entries()) {
                    if (tool.server?.id === serverId) {
                        this.toolsCache.delete(toolName);
                    }
                }
                
                // Update summary
                toolSummary[serverId] = {
                    available: 0,
                    unavailable: 1
                };
            }
        }

        // Log summary
        for (const [serverId, summary] of Object.entries(toolSummary)) {
            console.log(`[${serverId}] Tool summary - Available: ${summary.available}, Unavailable: ${summary.unavailable}`);
        }
    }
} 