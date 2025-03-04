import { mcpConfig } from '../tools/mcp/mcp_config.js';

// Configuration interfaces
export interface MCPToolConfig {
    name: string;
    description: string;
}

export interface MCPServerConfig {
    id: string;
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    tools?: MCPToolConfig[];
}

// For database operations
export interface ToolUsage {
    id: number;
    toolId?: string;
    mcpToolId?: string;
    input: Record<string, unknown>;
    output: string;
    error?: string;
    duration: number;
    status: string;
    createdAt: Date;
}

export interface ToolUsageHistory {
    args: Record<string, unknown>;
    result: string;
    timestamp: Date;
    success: boolean;
}

export interface MCPToolModel {
    id: string;
    serverId: string;
    name: string;
    description: string;
    isEnabled: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface MCPConfig {
    mcpServers: Record<string, MCPServerConfig>;
}

export function getMCPConfig(): MCPConfig {
    return mcpConfig;
}

// Type for database operations that include usage
export interface ToolWithUsage extends MCPToolConfig {
    id: string;
    usage: ToolUsage[];
}

// List of configured MCP server IDs
export const MCP_SERVER_IDS = [
    'brave-search',
    'github'
] as const;

// Extend existing MCPToolConfig for chain-specific needs
export interface ChainedToolConfig extends MCPToolConfig {
    dependsOn?: string[];           // Tool dependencies
    retryConfig?: {
        maxAttempts: number;
        delayMs: number;
    };
    timeout?: number;               // In milliseconds
}


// Track chain execution results
export interface ChainExecutionResult {
    success: boolean;
    steps: {
        toolId?: string;
        usage?: ToolUsage;          // Reuse existing ToolUsage
        completed: boolean;
    }[];
    error?: {
        step: string;
        message: string;
        attemptCount: number;
    };
}