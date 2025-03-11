import { IToolManager } from '../interfaces/core.js';
import { ToolDefinition, ToolResponse, ToolHandler } from '../types/tools.js';
import { BaseToolManager } from '../base/base-tool-manager.js';
import { IMCPClient } from '../interfaces/core.js';
import { MCPError, ErrorType } from '../types/errors.js';

export interface ToolUsage {
    toolName: string;
    timestamp: number;
    success: boolean;
    executionTime: number;
    args?: Record<string, any>;
    result?: ToolResponse;
}

export interface ToolContext {
    lastUsed?: number;
    usageCount: number;
    successRate: number;
    averageExecutionTime: number;
    recentErrors?: string[];
}

export interface ToolAnalytics {
    history: ToolUsage[];
    context: ToolContext;
    recommendations?: string[];
}

export class EnhancedToolsHandler extends BaseToolManager {
    private usageHistory: Map<string, ToolUsage[]>;
    private toolContexts: Map<string, ToolContext>;
    private readonly MAX_HISTORY_SIZE = 100;
    private readonly MAX_ERROR_HISTORY = 10;

    constructor(client: IMCPClient) {
        super(client);
        this.usageHistory = new Map();
        this.toolContexts = new Map();
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

    public async executeTool(name: string, args: any): Promise<ToolResponse> {
        const startTime = Date.now();
        let result: ToolResponse;
        
        try {
            result = await super.executeTool(name, args);
            
            this.trackToolUsage({
                toolName: name,
                timestamp: startTime,
                success: result.success,
                executionTime: Date.now() - startTime,
                args,
                result
            });

            return result;
        } catch (error) {
            const errorResponse: ToolResponse = {
                success: false,
                data: null,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };

            this.trackToolUsage({
                toolName: name,
                timestamp: startTime,
                success: false,
                executionTime: Date.now() - startTime,
                args,
                result: errorResponse
            });

            return errorResponse;
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