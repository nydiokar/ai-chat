import { MCPConfig } from "./tools/mcp/di/container.js";
import dotenv from 'dotenv';
import { warn } from './utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables based on DOTENV_CONFIG_PATH or NODE_ENV
const envPath = process.env.DOTENV_CONFIG_PATH || (process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development');

// Load environment variables
const result = dotenv.config({ path: envPath });
if (result.error) {
    console.error(`Error loading environment from ${envPath}:`, result.error);
}

const projectRoot = process.cwd();

// Server configurations
const servers: Record<string, any> = {
    // Core MCP Servers
    "github": {
        id: "github",
        name: "GitHub Tools",
        command: "npx",
        args: [
            "-y",
            "@modelcontextprotocol/server-github"
        ],
        env: {
            GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN,
            PWD: projectRoot
        }
    },
    "brave-search": {
        id: "brave-search",
        name: "Brave Search",
        command: "npx",
        args: [
            "-y",
            "@modelcontextprotocol/server-brave-search"
        ],
        env: {
            BRAVE_API_KEY: process.env.BRAVE_API_KEY
        }
    },
    "sequential-thinking": {
        id: "sequential-thinking",
        name: "Sequential Thinking",
        command: "npx",
        args: [
            "-y",
            "@modelcontextprotocol/server-sequential-thinking"
        ]
    },
    "youtube-transcript": {
        id: "youtube-transcript",
        name: "YouTube Transcript",
        command: "npx",
        args: [
            "-y",
            "@kimtaeyoon83/mcp-server-youtube-transcript"
        ]
    }
};

// Filter only explicitly disabled servers
const enabledServers = Object.entries(servers).reduce((acc, [key, config]) => {
    // Check if server is explicitly disabled
    const isDisabled = process.env[`MCP_${key.toUpperCase().replace(/-/g, '_')}_DISABLED`] === 'true';
    
    if (!isDisabled) {
        acc[key] = config;
        // Log only missing required environment variables
        Object.entries(config.env || {}).forEach(([envKey, envValue]) => {
            if (!envValue && (envKey.endsWith('_TOKEN') || envKey.endsWith('_KEY'))) {
                warn(`Server '${key}' missing ${envKey} - some features may be unavailable`);
            }
        });
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