import { IMCPClient, IToolManager } from '../interfaces/core.js';
import { ToolDefinition, ToolResponse, ToolHandler } from '../types/tools.js';
import { inject, injectable } from 'inversify';
import { Container } from 'inversify';
import { ServerConfig } from '../types/server.js';
import { debug } from '../../../utils/logger.js';
import { getLogger } from '../../../utils/shared-logger.js';
import { createLogContext, createErrorContext } from '../../../utils/log-utils.js';

@injectable()
export class BaseToolManager implements IToolManager {
    protected clientsMap: Map<string, IMCPClient>;
    protected toolsCache: Map<string, ToolDefinition>;
    protected handlers: Map<string, ToolHandler>;
    protected serverConfigs: Map<string, ServerConfig>;
    protected readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
    private lastCacheRefresh: number = 0;
    protected readonly logger = getLogger('ToolManager');

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
        this.logger.info('Tool execution requested', createLogContext(
            'ToolManager',
            'executeTool',
            {
                toolName: name,
                args: JSON.stringify(args)
            }
        ));
        
        const tool = await this.getToolByName(name);
        if (!tool) {
            const errorMsg = `Tool ${name} not found`;
            this.logger.warn('Tool not found', createLogContext(
                'ToolManager',
                'executeTool',
                { toolName: name }
            ));
            return {
                success: false,
                data: null,
                error: errorMsg
            };
        }

        // First try local handler if registered
        const handler = this.handlers.get(name);
        if (handler) {
            try {
                this.logger.debug('Executing local handler', createLogContext(
                    'ToolManager',
                    'executeTool',
                    { 
                        toolName: name,
                        handlerType: 'local'
                    }
                ));
                
                const result = await handler(args);
                
                this.logger.info('Local handler execution completed', createLogContext(
                    'ToolManager',
                    'executeTool',
                    { 
                        toolName: name,
                        success: result.success
                    }
                ));
                
                return result;
            } catch (error) {
                const errorMsg = `Error executing local handler for ${name}: ${error instanceof Error ? error.message : String(error)}`;
                
                this.logger.error('Local handler execution failed', createErrorContext(
                    'ToolManager',
                    'executeTool',
                    'System',
                    'HANDLER_EXECUTION_ERROR',
                    error,
                    { toolName: name }
                ));
                
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
            const errorMsg = `No client found for server ${tool.server?.id}`;
            
            this.logger.error('No client for server', createErrorContext(
                'ToolManager',
                'executeTool',
                'System',
                'CLIENT_NOT_FOUND',
                new Error(errorMsg),
                { 
                    toolName: name,
                    serverId: tool.server?.id || 'unknown'
                }
            ));
            
            return {
                success: false,
                data: null,
                error: errorMsg
            };
        }
        
        // Execute with the client
        try {
            this.logger.debug('Calling remote tool', createLogContext(
                'ToolManager',
                'executeTool',
                { 
                    toolName: name,
                    serverId: tool.server?.id || 'unknown'
                }
            ));
            
            const result = await client.callTool(name, args);
            
            this.logger.info('Remote tool execution completed', createLogContext(
                'ToolManager',
                'executeTool',
                { 
                    toolName: name,
                    serverId: tool.server?.id || 'unknown',
                    success: result.success
                }
            ));
            
            // If the result wasn't successful but doesn't have an error field,
            // add one to ensure consistent error handling
            if (!result.success && !result.error) {
                result.error = `Tool execution failed without specific error`;
                this.logger.warn('Tool returned unsuccessful result without error details', createLogContext(
                    'ToolManager',
                    'executeTool',
                    { 
                        toolName: name,
                        serverId: tool.server?.id || 'unknown'
                    }
                ));
            }
            
            return result;
        } catch (error) {
            const errorMsg = `Error calling remote tool ${name}: ${error instanceof Error ? error.message : String(error)}`;
            
            this.logger.error('Remote tool execution failed', createErrorContext(
                'ToolManager',
                'executeTool',
                'MCP',
                'TOOL_EXECUTION_ERROR',
                error,
                { 
                    toolName: name,
                    serverId: tool.server?.id || 'unknown',
                    args: JSON.stringify(args)
                }
            ));
            
            return {
                success: false,
                data: null,
                error: errorMsg,
                // Add original error for better debugging
                metadata: {
                    originalError: error instanceof Error ? error.message : String(error),
                    errorType: error instanceof Error ? error.name : 'Unknown'
                }
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