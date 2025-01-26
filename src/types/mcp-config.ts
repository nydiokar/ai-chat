import { mcpConfig } from '../tools/tools.js';

// Configuration interfaces
export interface MCPToolConfig {
    name: string;
    description: string;
}

export interface MCPServerConfig {
    command: string;
    args: string[];
    env?: Record<string, string>;
    tools?: MCPToolConfig[];
}

// Database model interfaces
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
    console.log('[getMCPConfig] Loading config:', JSON.stringify(mcpConfig, null, 2));
    return mcpConfig;
}
