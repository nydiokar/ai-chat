import { MCPConfig } from "../../types/tools.js";
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

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
