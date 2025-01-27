import { MCPConfig } from "../types/mcp-config";
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

if (!process.env.BRAVE_API_KEY) {
    console.warn('Warning: BRAVE_API_KEY not found in environment variables');
}

if (!process.env.GITHUB_TOKEN) {
    console.warn('Warning: GITHUB_TOKEN not found in environment variables');
} else {
    console.log('GitHub token format:', {
        length: process.env.GITHUB_TOKEN.length,
        prefix: process.env.GITHUB_TOKEN.substring(0, 10) + '...',
        type: process.env.GITHUB_TOKEN.startsWith('github_pat_') ? 'fine-grained' : 'classic'
    });
}

// Use node directly instead of npx
// Use node directly instead of npx
const nodePath = process.execPath; // Gets the full path to the node executable

// Get the project root directory
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const mcpConfig: MCPConfig = {
    mcpServers: {
        "github": {
            id: "github",
            name: "GitHub Tools",
            command: nodePath,
            args: [
                "node_modules/@modelcontextprotocol/server-github/dist/index.js"
            ],
            env: {
                GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN || '',
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
                BRAVE_API_KEY: process.env.BRAVE_API_KEY || ''
            }
        }
    }
};

export default mcpConfig;
