import { mcpConfig } from '../utils/tools.js';

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
export interface MCPToolUsage {
    input: any;
    output: any;
    createdAt: Date;
    status: string;
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
    usage: MCPToolUsage[];
}

// List of configured MCP server IDs
export const MCP_SERVER_IDS = [
    'brave-search',
    'github'
] as const;
