/**
 * Dynamic loader integration for pulse commands
 * 
 * This module provides functions to handle dynamic loading of MCP server packages
 * directly from GitHub repositories without requiring a bot restart.
 */

import { MCPConfig } from '../../../tools/mcp/di/container.js';
import { PulseMCPServer } from '../services/pulse-api-service.js';
import { GitRepoLoader } from '../services/git-repo-loader.js';

/**
 * Installation method options (only GitHub supported)
 */
export enum InstallMethod {
  GITHUB = 'github'
}

/**
 * Install and configure servers from Pulse API using GitHub repositories
 * 
 * @param servers List of server information from Pulse API
 * @returns Updated MCP configuration with new servers
 */
export async function installFromGitHub(servers: PulseMCPServer[]): Promise<{
  config: MCPConfig;
  installedServers: string[];
}> {
  // Create a minimal config object
  const config: MCPConfig = {
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
    mcpServers: {}
  };
  
  const installedServers: string[] = [];
  
  for (const server of servers) {
    if (!server.source_code_url) {
      console.warn(`Server ${server.name} has no source code URL, skipping`);
      continue;
    }
    
    try {
      console.log(`Installing server ${server.name} from GitHub: ${server.source_code_url}`);
      
      // Use GitRepoLoader to prepare the server with minimal configuration
      const serverConfig = await GitRepoLoader.prepareFromGitHub(server);
      
      if (serverConfig) {
        config.mcpServers[serverConfig.id] = serverConfig;
        installedServers.push(serverConfig.id);
        console.log(`Successfully installed server ${server.name} from GitHub`);
      } else {
        console.error(`Failed to install server ${server.name} from GitHub`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error installing server ${server.name} from GitHub:`, errorMessage);
    }
  }
  
  return { config, installedServers };
} 