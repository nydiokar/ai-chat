import { MCPConfig } from "./tools/mcp/di/container.js";
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

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
};

// Filter enabled servers based on environment requirements
const enabledServers = Object.entries(servers).reduce((acc, [key, config]) => {
    // Check if server has required environment variables
    const hasRequiredEnv = Object.entries(config.env || {}).every(([envKey, envValue]) => {
        return !envKey.endsWith('_TOKEN') && !envKey.endsWith('_KEY') || envValue;
    });

    if (hasRequiredEnv) {
        acc[key] = config;
    } else {
        console.warn(`[MCP Config] Server '${key}' disabled due to missing environment variables`);
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