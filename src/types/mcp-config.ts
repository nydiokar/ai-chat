import { mcpConfig } from '../tools/tools.js';

export interface MCPTool {
    name: string;
    description: string;
}

export interface MCPServerConfig {
    command: string;
    args: string[];
    env?: Record<string, string>;
    tools?: MCPTool[];
}

export interface MCPConfig {
    mcpServers: Record<string, MCPServerConfig>;
}

export function getMCPConfig(): MCPConfig {
    console.log('[getMCPConfig] Loading config:', JSON.stringify(mcpConfig, null, 2));
    return mcpConfig;
}
