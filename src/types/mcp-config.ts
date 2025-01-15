import fs from 'fs';
import path from 'path';

// Export the type
export interface MCPServerConfig {
    command: string;
    args: string[];
    env?: Record<string, string>;
}

export interface MCPConfig {
    mcpServers: {
        [key: string]: MCPServerConfig;
    };
}

// Default config
export const defaultMCPConfig: MCPConfig = {
    mcpServers: {}
};

// Validation function
function validateConfig(config: any): asserts config is MCPConfig {
    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
        throw new Error('Invalid config: mcpServers object is required');
    }

    for (const [serverId, serverConfig] of Object.entries<any>(config.mcpServers)) {
        // Type guard for serverConfig
        if (!serverConfig || typeof serverConfig !== 'object') {
            throw new Error(`Invalid config for server ${serverId}: must be an object`);
        }

        // Validate command
        if (!serverConfig.command || typeof serverConfig.command !== 'string') {
            throw new Error(`Invalid config for server ${serverId}: command is required and must be a string`);
        }

        // Validate args
        if (!Array.isArray(serverConfig.args)) {
            throw new Error(`Invalid config for server ${serverId}: args must be an array`);
        }

        // Validate env if present
        if (serverConfig.env !== undefined && (typeof serverConfig.env !== 'object' || serverConfig.env === null)) {
            throw new Error(`Invalid config for server ${serverId}: env must be an object if provided`);
        }
    }
}

// Config loader function
export function loadMCPConfig(configPath?: string): MCPConfig {
    const defaultPath = path.join(process.cwd(), 'mcp-config.json');
    const configFile = configPath || defaultPath;

    if (!fs.existsSync(configFile)) {
        console.warn(`MCP config file not found at ${configFile}, using default config`);
        return defaultMCPConfig;
    }

    try {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
        validateConfig(config);
        return config;
    } catch (error) {
        console.error(`Failed to load MCP config: ${error instanceof Error ? error.message : String(error)}`);
        return defaultMCPConfig;
    }
} 