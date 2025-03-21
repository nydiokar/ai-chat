import { z } from 'zod';
import { ServerConfig } from './server.js';

/**
 * Core tool interfaces
 */

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
 * Represents a tool's parameter
 */
export interface ToolParameter {
    name: string;
    type: string;
    description: string;
    required?: boolean;
    enum?: string[];
}

/**
 * Base tool configuration
 */
export interface ToolConfig {
    name: string;
    description: string;
    version?: string;
    enabled?: boolean;
    parameters?: ToolParameter[];
}

/**
 * Core tool interface
 */
export interface Tool extends ToolConfig {
    inputSchema: z.ZodSchema;
    handler: (args: any) => Promise<ToolResponse>;
    examples?: string[];
    metadata?: Record<string, unknown>;
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
 * MCP-specific interfaces
 */
export interface MCPServerConfig {
    id: string;
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    tools?: ToolConfig[];
}

export interface MCPConfig {
    mcpServers: Record<string, MCPServerConfig>;
}

/**
 * Tool definition with server configuration
 */
export interface ToolDefinition extends ToolConfig {
    version: string;
    parameters: ToolParameter[];
    server?: ServerConfig;
    inputSchema?: z.ZodSchema;
    handler?: (args: any) => Promise<ToolResponse>;
}

/**
 * MCP-specific tool interface
 */
export interface MCPTool extends Tool {
    server: ServerConfig;
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
    getAvailableTools(): Promise<Tool[]>;
    getToolByName(name: string): Promise<Tool | undefined>;
    refreshToolInformation(): Promise<void>;
}

/**
 * Tool handler function type
 */
export type ToolHandler = (args: any) => Promise<ToolResponse>;