import { MCPConfig } from "../types/mcp-config";
import dotenv from 'dotenv';


// Load environment variables
dotenv.config();

if (!process.env.BRAVE_API_KEY) {
    console.warn('Warning: BRAVE_API_KEY not found in environment variables');
}

// Use node directly instead of npx
const nodePath = process.execPath; // Gets the full path to the node executable

export const mcpConfig: MCPConfig = {
    mcpServers: {
        "brave-search": {
            command: nodePath,
            args: [
                "node_modules/@modelcontextprotocol/server-brave-search/dist/index.js"
            ],
            env: {
                BRAVE_API_KEY: process.env.BRAVE_API_KEY || ''
            },
            tools: [
                {
                    name: "brave_web_search",
                    description: "Performs a web search using the Brave Search API"
                },
                {
                    name: "brave_local_search",
                    description: "Searches for local businesses and places"
                }
            ]
        }
    }
};

export default mcpConfig;
