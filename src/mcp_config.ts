import { MCPConfig } from "./tools/mcp/di/container.js";
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables based on DOTENV_CONFIG_PATH or NODE_ENV
console.log('[MCP Config] Environment setup:', {
    DOTENV_CONFIG_PATH: process.env.DOTENV_CONFIG_PATH || 'not set',
    NODE_ENV: process.env.NODE_ENV || 'not set'
});

const envPath = process.env.DOTENV_CONFIG_PATH || (process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development');
console.log(`[MCP Config] Using environment file: ${envPath}`);

// Load environment variables
const result = dotenv.config({ path: envPath });
if (result.error) {
    console.error(`Error loading environment from ${envPath}:`, result.error);
} else {
    console.log(`[MCP Config] Loaded environment from ${envPath}`);
    console.log('[MCP Config] Environment variables loaded:', {
        NODE_ENV: process.env.NODE_ENV,
        GITHUB_TOKEN: process.env.GITHUB_TOKEN ? 'set' : 'not set',
        PWD: process.env.PWD
    });
}

const nodePath = process.execPath;
const projectRoot = process.cwd();

// Server configurations
const servers: Record<string, any> = {
    // Core MCP Servers
    "github": {
        id: "github",
        name: "GitHub Tools",
        command: nodePath,
        args: [
            "node_modules/@modelcontextprotocol/server-github/dist/index.js"
        ],
        env: {
            GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN,
            PWD: projectRoot
        }
    },
    "brave-search": {
        id: "brave-search",
        name: "Brave Search",
        command: nodePath,
        args: [
            "node_modules/@modelcontextprotocol/server-brave-search/dist/index.js"
        ],
        env: {
            BRAVE_API_KEY: process.env.BRAVE_API_KEY
        }
    },
    "youtube-transcript": {
        id: "youtube-transcript",
        name: "YouTube Transcript",
        command: nodePath,
        args: [
            "node_modules/@kimtaeyoon83/mcp-server-youtube-transcript/dist/index.js"
        ]
    }
};

// Filter only explicitly disabled servers
const enabledServers = Object.entries(servers).reduce((acc, [key, config]) => {
    // Check if server is explicitly disabled
    const isDisabled = process.env[`MCP_${key.toUpperCase().replace(/-/g, '_')}_DISABLED`] === 'true';
    
    if (!isDisabled) {
        acc[key] = config;
        // Log if required environment variables are missing but don't prevent initialization
        Object.entries(config.env || {}).forEach(([envKey, envValue]) => {
            if (!envValue && (envKey.endsWith('_TOKEN') || envKey.endsWith('_KEY'))) {
                console.warn(`[MCP Config] Server '${key}' missing ${envKey} - some features may be unavailable`);
            } else if (envValue) {
                console.log(`[MCP Config] Server '${key}' has ${envKey}`);
            }
        });
        console.log(`[MCP Config] Server '${key}' configuration:`, {
            id: config.id,
            name: config.name,
            command: config.command,
            args: config.args,
            env: Object.keys(config.env || {}).reduce((acc: Record<string, string>, key) => {
                acc[key] = config.env[key] ? 'set' : 'not set';
                return acc;
            }, {})
        });
    } else {
        console.log(`[MCP Config] Server '${key}' disabled by configuration`);
    }
    return acc;
}, {} as Record<string, any>);

export const mcpConfig: MCPConfig = {
    features: {
        core: {
            serverManagement: true,
            toolOperations: true,
            clientCommunication: true
        },
        enhanced: {
            analytics: false,
            contextManagement: false,
            caching: false,
            stateManagement: false,
            healthMonitoring: false
        }
    },
    mcpServers: enabledServers
};

export default mcpConfig;