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
        return this.toolsCache.size === 0 || 
               Date.now() - this.lastCacheRefresh > this.CACHE_TTL;
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

    public async refreshToolInformation(): Promise<void> {
        debug('\n=== Tool Information Refresh ===');
        this.toolsCache.clear();
        
        let totalTools = 0;
        const serverSummary: Record<string, { available: number; unavailable: number; tools: string[] }> = {};
        
        for (const [serverId, client] of this.clientsMap.entries()) {
            debug(`\nChecking server: ${serverId}`);
            try {
                const tools = await client.listTools();
                
                // Get server config
                const serverConfig = this.serverConfigs.get(serverId);
                if (!serverConfig) {
                    debug(`  ✗ No config found for ${serverId}, skipping`);
                    serverSummary[serverId] = { available: 0, unavailable: 0, tools: [] };
                    continue;
                }
                
                // Update totals
                totalTools += tools.length;
                serverSummary[serverId] = {
                    available: tools.length,
                    unavailable: 0,
                    tools: tools.map(t => t.name)
                };
                debug(`  ✓ Server available with ${tools.length} tools`);
                
                // Cache tools with server information
                tools.forEach((tool: ToolDefinition) => {
                    // Store tool in cache with server info
                    const toolWithServer = {
                        ...tool,
                        server: serverConfig,
                        enabled: true
                    };
                    this.toolsCache.set(tool.name, toolWithServer);
                });
            } catch (error) {
                debug(`  ✗ Server ${serverId} unavailable: ${error instanceof Error ? error.message : String(error)}`);
                serverSummary[serverId] = { available: 0, unavailable: 1, tools: [] };
                
                // Remove any cached tools from this server since it's unavailable
                for (const [toolName, tool] of this.toolsCache.entries()) {
                    if (tool.server?.id === serverId) {
                        this.toolsCache.delete(toolName);
                    }
                }
            }
        }

        this.lastCacheRefresh = Date.now();

        // Print summary
        debug('\n=== Tool Availability Summary ===');
        debug(`Total available tools: ${totalTools}`);
        debug('\nServer status:');
        Object.entries(serverSummary).forEach(([serverId, status]) => {
            const statusSymbol = status.available > 0 ? '✓' : '✗';
            debug(`\n${statusSymbol} ${serverId}:`);
            if (status.available > 0) {
                debug(`  Available tools (${status.available}):`);
                status.tools.forEach(tool => debug(`    - ${tool}`));
            } else {
                debug('  No tools available');
            }
        });
        debug('\n=== End Tool Information ===\n');
    }
} 