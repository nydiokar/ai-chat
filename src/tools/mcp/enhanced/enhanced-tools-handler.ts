import { BaseToolManager } from '../base/base-tool-manager.js';
import { ToolDefinition, ToolResponse, ToolHandler, ToolUsage, ToolContext, ToolAnalytics } from '../types/tools.js';
import { EventEmitter } from 'events';
import { inject, injectable } from 'inversify';
import { Container } from 'inversify';
import { ServerConfig } from '../types/server.js';
import { MCPError, ErrorType } from '../types/errors.js';

@injectable()
export class EnhancedToolsHandler extends BaseToolManager {
    private cache: Map<string, { value: any; timestamp: number }>;
    private analytics: EventEmitter;
    private usageHistory: Map<string, ToolUsage[]>;
    private toolContexts: Map<string, ToolContext>;
    private readonly MAX_HISTORY_SIZE = 100;
    private readonly MAX_ERROR_HISTORY = 10;

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
        return tools;
    }

    public override async executeTool(name: string, args: any): Promise<ToolResponse> {
        this.analytics.emit('tool.called', { name, args });
        const startTime = Date.now();

        try {
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

            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            this.analytics.emit('tool.error', { 
                name, 
                duration,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    public override async refreshToolInformation(): Promise<void> {
        this.cache.clear();
        this.analytics.emit('cache.cleared');
        await super.refreshToolInformation();
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
        if (!cached) return null;

        const { value, timestamp } = cached;
        if (Date.now() - timestamp > this.CACHE_TTL) {
            this.cache.delete(key);
            this.analytics.emit('cache.expired', { key });
            return null;
        }

        return value as T;
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
        }
    }

    private trackToolUsage(usage: ToolUsage): void {
        try {
            let history = this.usageHistory.get(usage.toolName) || [];
            
            // Maintain fixed history size
            if (history.length >= this.MAX_HISTORY_SIZE) {
                history = history.slice(-this.MAX_HISTORY_SIZE + 1);
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
            }
        } catch (error) {
            console.error('Error tracking tool usage:', error);
            throw new MCPError(
                'Failed to track tool usage',
                ErrorType.TOOL_TRACKING_FAILED,
                { cause: error instanceof Error ? error : new Error(String(error)) }
            );
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
            }
            return tool;
        } catch (error) {
            throw new MCPError(
                `Failed to get tool ${name}`,
                ErrorType.TOOL_NOT_FOUND,
                { cause: error instanceof Error ? error : new Error(String(error)) }
            );
        }
    }
} 