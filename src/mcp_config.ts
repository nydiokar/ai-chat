import { MCPConfig } from "./tools/mcp/di/container.js";
import dotenv from 'dotenv';


// Load environment variables
dotenv.config();

const nodePath = process.execPath; // Gets the full path to the node executable

// Get the project root directory
const projectRoot = process.cwd(); // This will give us the current working directory (project root)

// Validate environment variables
function validateMCPEnvironment() {
  const warnings: string[] = [];
  
  if (!process.env.GITHUB_TOKEN) {
    warnings.push('GITHUB_TOKEN not found in environment variables. GitHub tools will be disabled.');
  }
  if (!process.env.BRAVE_API_KEY) {
    warnings.push('BRAVE_API_KEY not found in environment variables. Brave Search tools will be disabled.');
  }
  
  if (warnings.length > 0) {
    console.warn('[MCP Config] Environment warnings:');
    warnings.forEach(warning => console.warn('- ' + warning));
  }
}

// Validate environment before creating config
validateMCPEnvironment();

// Only enable servers if their required environment variables are present
const enabledServers: Record<string, any> = {};

// Add GitHub server if token is present
if (process.env.GITHUB_TOKEN) {
  enabledServers["github"] = {
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
  };
}

// Add Brave Search server if API key is present
if (process.env.BRAVE_API_KEY) {
  enabledServers["brave-search"] = {
    id: "brave-search",
    name: "Brave Search",
    command: nodePath,
    args: [
      "node_modules/@modelcontextprotocol/server-brave-search/dist/index.js"
    ],
    env: {
      BRAVE_API_KEY: process.env.BRAVE_API_KEY
    }
  };
}

// DYNAMICALLY ADDED SERVERS - DO NOT REMOVE THIS COMMENT

// END DYNAMIC SERVERS

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
