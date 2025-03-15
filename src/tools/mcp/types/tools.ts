import { ServerConfig } from './server.js';

/**
 * Represents a tool's parameter
 */
export interface ToolParameter {
    name: string;
    type: string;
    description: string;
    required?: boolean;
}

/**
 * Represents a tool's definition
 */
export interface ToolDefinition {
    name: string;
    description: string;
    version: string;
    parameters: ToolParameter[];
    enabled?: boolean;
    server?: ServerConfig;
    inputSchema?: any;
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
 * Represents the context for tool execution
 */
export interface ToolContext {
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
 * Represents a tool handler function
 */
export type ToolHandler = (args: any) => Promise<ToolResponse>;