import { MCPConfig } from "../types/mcp-config";
import dotenv from 'dotenv';


// Load environment variables
dotenv.config();

if (!process.env.BRAVE_API_KEY) {
    console.warn('Warning: BRAVE_API_KEY not found in environment variables');
}

if (!process.env.GITHUB_TOKEN) {
    console.warn('Warning: GITHUB_TOKEN not found in environment variables');
}

// Use node directly instead of npx
const nodePath = process.execPath; // Gets the full path to the node executable

export const mcpConfig: MCPConfig = {
    mcpServers: {
        "github": {
            command: nodePath,
            args: [
                "node_modules/@modelcontextprotocol/server-github/dist/index.js"
            ],
            env: {
                GITHUB_TOKEN: process.env.GITHUB_TOKEN || ''
            },
            tools: [
                {
                    name: "get_issue",
                    description: "Get details of a specific issue in a GitHub repository"
                },
                {
                    name: "create_issue",
                    description: "Create a new issue in a GitHub repository"
                },
                {
                    name: "add_issue_comment",
                    description: "Add a comment to an existing issue"
                },
                {
                    name: "create_pull_request",
                    description: "Create a new pull request in a GitHub repository"
                },
                {
                    name: "get_file_contents",
                    description: "Get the contents of a file from a GitHub repository"
                },
                {
                    name: "create_or_update_file",
                    description: "Create or update a file in a GitHub repository"
                }
            ]
        },
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
