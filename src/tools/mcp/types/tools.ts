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
 * Configuration for MCP Client
 */
export interface MCPClientConfig {
    command: string;
    args: string[];
}

/**
 * Represents a tool handler function
 */
export type ToolHandler = (args: any) => Promise<ToolResponse>;