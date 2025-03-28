import { BaseToolManager } from '../base/base-tool-manager.js';
import { ToolDefinition, ToolResponse, ToolHandler, ToolUsage, ToolContext, ToolAnalytics } from '../types/tools.js';
import { EventEmitter } from 'events';
import { inject, injectable } from 'inversify';
import { Container } from 'inversify';
import { ServerConfig } from '../types/server.js';
import { MCPError, ErrorType } from '../types/errors.js';
import { EnhancedMCPClient } from './enhanced-mcp-client.js';
import { info, warn, error, debug } from '../../../utils/logger.js';
import { createLogContext, createErrorContext } from '../../../utils/log-utils.js';

const COMPONENT = 'EnhancedToolsHandler';

@injectable()
export class EnhancedToolsHandler extends BaseToolManager {
    private cache: Map<string, { value: any; timestamp: number }>;
    private analytics: EventEmitter;
    private usageHistory: Map<string, ToolUsage[]>;
    private toolContexts: Map<string, ToolContext>;
    private readonly MAX_HISTORY_SIZE = 100;
    private readonly MAX_ERROR_HISTORY = 10;
    private readonly REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

    constructor(
        @inject('ClientsMap') clientsMap: Map<string, string>,
        @inject('Container') container: Container,
        @inject('ServerConfigs') serverConfigs: Map<string, ServerConfig>
    ) {
        super(clientsMap, container, serverConfigs);
        this.cache = new Map();
        this.analytics = new EventEmitter();
        this.usageHistory = new Map();
        this.toolContexts = new Map();
        
        info('Enhanced Tools Handler initialized', createLogContext(
            COMPONENT,
            'constructor',
            {
                maxHistorySize: this.MAX_HISTORY_SIZE,
                maxErrorHistory: this.MAX_ERROR_HISTORY,
                refreshInterval: this.REFRESH_INTERVAL
            }
        ));

        // Set up listeners for client events
        this.setupClientEventListeners();
    }
    
    /**
     * Set up event listeners for client notifications
     * This ensures tool data is refreshed when servers report changes
     */
    private async setupClientEventListeners(): Promise<void> {
        try {
            const serverIds = Array.from(this.serverConfigs.keys());
            
            for (const serverId of serverIds) {
                const client = this.clientsMap.get(serverId);
                if (!client || !(client instanceof EnhancedMCPClient)) continue;
                
                client.on('tools.changed', async () => {
                    debug('Tool change event', createLogContext(
                        COMPONENT,
                        'setupClientEventListeners',
                        { 
                            serverId,
                            event: 'tools.changed',
                            action: 'refresh'
                        }
                    ));
                    
                    this.cache.delete('available-tools');
                    
                    try {
                        await this.refreshToolInformation();
                    } catch (err) {
                        error('Tool refresh failed', createErrorContext(
                            COMPONENT,
                            'setupClientEventListeners',
                            'System',
                            'REFRESH_ERROR',
                            err,
                            { serverId }
                        ));
                    }
                });
            }

            const enhancedClients = Array.from(this.clientsMap.values())
                .filter(client => client instanceof EnhancedMCPClient) as EnhancedMCPClient[];
                
            info('Client setup completed', createLogContext(
                COMPONENT,
                'setupClientEventListeners',
                { 
                    clientCount: enhancedClients.length,
                    serverCount: serverIds.length
                }
            ));
            
            // Set up periodic refresh
            setInterval(() => {
                this.refreshToolInformation().catch(err => {
                    error('Periodic refresh failed', createErrorContext(
                        COMPONENT,
                        'setupClientEventListeners',
                        'System',
                        'REFRESH_ERROR',
                        err
                    ));
                });
            }, this.REFRESH_INTERVAL);
        } catch (err) {
            error('Client setup failed', createErrorContext(
                COMPONENT,
                'setupClientEventListeners',
                'System',
                'SETUP_ERROR',
                err
            ));
        }
    }

    public override async getAvailableTools(): Promise<ToolDefinition[]> {
        const cacheKey = 'available-tools';
        const cached = this.getCachedValue<ToolDefinition[]>(cacheKey);
        
        if (cached) {
            this.analytics.emit('cache.hit', { key: cacheKey });
            return cached;
        }

        this.analytics.emit('cache.miss', { key: cacheKey });
        const tools = await super.getAvailableTools();
        this.setCachedValue(cacheKey, tools);
        
        info('Tools retrieved', createLogContext(
            COMPONENT,
            'getAvailableTools',
            {
                toolCount: tools.length,
                cacheStatus: 'updated'
            }
        ));
        
        return tools;
    }

    public override async executeTool(name: string, args: any): Promise<ToolResponse> {
        const startTime = Date.now();
        this.analytics.emit('tool.called', { name, args });

        try {
            debug('Tool execution started', createLogContext(
                COMPONENT,
                'executeTool',
                {
                    toolName: name,
                    args: JSON.stringify(args)
                }
            ));

            const result = await super.executeTool(name, args);
            const duration = Date.now() - startTime;
            
            this.analytics.emit('tool.success', { 
                name, 
                duration,
                resultSize: JSON.stringify(result).length
            });
            
            this.trackToolUsage({
                toolName: name,
                timestamp: startTime,
                success: result.success,
                executionTime: duration,
                args,
                result
            });

            info('Tool execution completed', createLogContext(
                COMPONENT,
                'executeTool',
                {
                    toolName: name,
                    success: result.success,
                    duration,
                    status: result.success ? 'success' : 'failed'
                }
            ));

            return result;
        } catch (err) {
            const duration = Date.now() - startTime;
            
            error('Tool execution failed', createErrorContext(
                COMPONENT,
                'executeTool',
                'MCP',
                'TOOL_EXECUTION_ERROR',
                err,
                {
                    toolName: name,
                    duration,
                    args: JSON.stringify(args)
                }
            ));

            this.analytics.emit('tool.error', { 
                name, 
                duration,
                error: err instanceof Error ? err.message : String(err)
            });
            throw err;
        }
    }

    public override async refreshToolInformation(): Promise<void> {
        try {
            debug('Starting tool information refresh', createLogContext(
                COMPONENT,
                'refreshToolInformation',
                { cacheSize: this.cache.size }
            ));

            this.cache.clear();
            this.analytics.emit('cache.cleared');
            await super.refreshToolInformation();

            info('Tool information refresh completed', createLogContext(
                COMPONENT,
                'refreshToolInformation'
            ));
        } catch (err) {
            error('Tool information refresh failed', createErrorContext(
                COMPONENT,
                'refreshToolInformation',
                'System',
                'REFRESH_ERROR',
                err
            ));
            throw err;
        }
    }

    public getAnalytics(): EventEmitter {
        return this.analytics;
    }

    public getCacheStats(): { size: number; ttl: number } {
        return {
            size: this.cache.size,
            ttl: this.CACHE_TTL
        };
    }

    private getCachedValue<T>(key: string): T | null {
        const cached = this.cache.get(key);
        const now = Date.now();
        
        if (!cached) {
            this.analytics.emit('cache.miss', { key });
            return null;
        }

        if (now - cached.timestamp > this.CACHE_TTL) {
            this.cache.delete(key);
            this.analytics.emit('cache.expired', { key });
            return null;
        }

        this.analytics.emit('cache.hit', { key });
        return cached.value as T;
    }

    private setCachedValue<T>(key: string, value: T): void {
        this.cache.set(key, {
            value,
            timestamp: Date.now()
        });
        this.analytics.emit('cache.set', { key });
    }

    private initializeContext(toolName: string): void {
        if (!this.toolContexts.has(toolName)) {
            this.toolContexts.set(toolName, {
                usageCount: 0,
                successRate: 0,
                averageExecutionTime: 0,
                recentErrors: []
            });
            
            debug('Tool context initialized', createLogContext(
                COMPONENT,
                'initializeContext',
                { toolName }
            ));
        }
    }

    private trackToolUsage(usage: ToolUsage): void {
        try {
            let history = this.usageHistory.get(usage.toolName) || [];
            
            if (history.length >= this.MAX_HISTORY_SIZE) {
                history = history.slice(-this.MAX_HISTORY_SIZE + 1);
                debug('Usage history updated', createLogContext(
                    COMPONENT,
                    'trackToolUsage',
                    {
                        toolName: usage.toolName,
                        historySize: history.length,
                        maxSize: this.MAX_HISTORY_SIZE,
                        action: 'trimmed'
                    }
                ));
            }
            
            history.push(usage);
            this.usageHistory.set(usage.toolName, history);

            // Update context
            this.initializeContext(usage.toolName);
            const context = this.toolContexts.get(usage.toolName)!;
            
            context.lastUsed = usage.timestamp;
            context.usageCount++;
            
            const successCount = history.filter(u => u.success).length;
            context.successRate = successCount / history.length;
            
            const totalExecutionTime = history.reduce((sum, u) => sum + u.executionTime, 0);
            context.averageExecutionTime = totalExecutionTime / history.length;

            // Track errors
            if (!usage.success && usage.result?.error) {
                context.recentErrors = [
                    usage.result.error,
                    ...(context.recentErrors || [])
                ].slice(0, this.MAX_ERROR_HISTORY);

                warn('Tool error recorded', createLogContext(
                    COMPONENT,
                    'trackToolUsage',
                    {
                        toolName: usage.toolName,
                        errorCount: context.recentErrors.length,
                        maxErrors: this.MAX_ERROR_HISTORY,
                        successRate: context.successRate
                    }
                ));
            }
        } catch (err) {
            error('Failed to track tool usage', createErrorContext(
                COMPONENT,
                'trackToolUsage',
                'System',
                'TOOL_TRACKING_ERROR',
                err,
                { toolName: usage.toolName }
            ));
            throw MCPError.toolTrackingFailed(err instanceof Error ? err : new Error(String(err)));
        }
    }

    public getToolContext(name: string): ToolContext | undefined {
        return this.toolContexts.get(name);
    }

    public getToolAnalytics(name: string): ToolAnalytics | undefined {
        const history = this.usageHistory.get(name);
        const context = this.toolContexts.get(name);

        if (!history || !context) {
            return undefined;
        }

        // Generate recommendations based on usage patterns
        const recommendations: string[] = [];
        
        if (context.successRate < 0.5) {
            recommendations.push('Tool has a low success rate. Consider reviewing error patterns.');
        }
        
        if (context.averageExecutionTime > 5000) {
            recommendations.push('Tool has high average execution time. Consider optimization.');
        }

        return { 
            history, 
            context,
            recommendations: recommendations.length > 0 ? recommendations : undefined
        };
    }

    public async getToolByName(name: string): Promise<ToolDefinition | undefined> {
        try {
            const tool = await super.getToolByName(name);
            
            if (tool) {
                this.initializeContext(name);
                debug('Tool retrieved', createLogContext(
                    COMPONENT,
                    'getToolByName',
                    { 
                        toolName: name,
                        status: 'found'
                    }
                ));
            } else {
                warn('Tool not found', createLogContext(
                    COMPONENT,
                    'getToolByName',
                    { toolName: name }
                ));
            }
            
            return tool;
        } catch (err) {
            error(`Failed to get tool ${name}`, createErrorContext(
                COMPONENT,
                'getToolByName',
                'System',
                'TOOL_NOT_FOUND',
                err,
                { toolName: name }
            ));
            throw MCPError.toolNotFound(err instanceof Error ? err : new Error(String(err)));
        }
    }
} 