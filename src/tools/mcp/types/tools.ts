import { ServerConfig } from './server.js';

/**
 * Core MCP Tool Schema - follows JSON Schema standard
 */
export interface MCPToolSchema {
    type: "object";
    properties: Record<string, {
        type: string;
        description?: string;
        enum?: string[];
    }>;
    required: string[];
}

/**
 * Core tool interface aligned with MCP standard
 */
export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: MCPToolSchema;
    version?: string;
    metadata?: Record<string, any>;
    enabled?: boolean;
    server?: ServerConfig;
    handler?: (args: any) => Promise<ToolResponse>;
}

/**
 * Represents a tool's response
 */
export interface ToolResponse {
    success: boolean;
    data: any;
    error?: string;
    metadata?: Record<string, any>;
}

/**
 * Enhanced tool usage tracking
 */
export interface ToolUsage {
    toolName: string;
    timestamp: number;
    success: boolean;
    executionTime: number;
    args?: Record<string, any>;
    result?: ToolResponse;
}

/**
 * Enhanced tool context with analytics
 */
export interface ToolContext {
    lastUsed?: number;
    usageCount: number;
    successRate: number;
    averageExecutionTime: number;
    recentErrors?: string[];
    history?: Array<{
        args: Record<string, unknown>;
        result: string;
        timestamp: Date;
        success: boolean;
    }>;
    patterns?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}

/**
 * Tool analytics data
 */
export interface ToolAnalytics {
    history: ToolUsage[];
    context: ToolContext;
    recommendations?: string[];
}

/**
 * MCP server configuration
 */
export interface MCPServerConfig {
    id: string;
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    tools?: ToolDefinition[];
}

/**
 * Database model for tools
 */
export interface MCPToolModel {
    id: string;
    serverId: string;
    name: string;
    description: string;
    isEnabled: boolean;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Tool information provider interface
 */
export interface ToolInformationProvider {
    getAvailableTools(): Promise<ToolDefinition[]>;
    getToolByName(name: string): Promise<ToolDefinition | undefined>;
    refreshToolInformation(): Promise<void>;
}

/**
 * Tool handler function type
 */
export type ToolHandler = (args: any) => Promise<ToolResponse>;