import { PulseAPIService, PulseMCPServer } from './pulse-api-service.js';
import { MCPConfig } from '../../../tools/mcp/di/container.js';
import { ServerConfig } from '../../../tools/mcp/types/server.js';
import path from 'path';
import { GitRepoLoader } from './git-repo-loader.js';

export class PulseMCPManager {
  private pulseApi: PulseAPIService;
  
  constructor() {
    this.pulseApi = new PulseAPIService();
  }

  /**
   * Search for MCP servers using the Pulse API
   * @param query Search term to filter servers 
   * @param limit Max number of results to return
   * @returns Promise with found servers
   */
  async searchServers(query: string, limit: number = 10): Promise<PulseMCPServer[]> {
    const result = await this.pulseApi.searchServers(query, limit);
    return result.servers;
  }

  /**
   * Prepare a server from GitHub source
   * 
   * @param pulseServer Server from Pulse API
   * @returns Promise resolving to the server config or null if preparation fails
   */
  async prepareGitHubServer(pulseServer: PulseMCPServer): Promise<ServerConfig | null> {
    return await GitRepoLoader.prepareFromGitHub(pulseServer);
  }

  /**
   * Add a Pulse server to the MCP configuration using GitHub installation
   * 
   * @param config Existing MCP configuration
   * @param pulseServer Server from Pulse API to add
   * @returns Updated MCP configuration with the new server
   */
  async addServerToConfig(config: MCPConfig, pulseServer: PulseMCPServer): Promise<MCPConfig> {
    // Check if a server with a matching ID already exists
    const serverId = pulseServer.name.toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    
    // Check if a server with this ID already exists in the configuration
    if (config.mcpServers && config.mcpServers[serverId]) {
      console.log(`Server with ID ${serverId} already exists in configuration. Skipping.`);
      return config; // Return unchanged config
    }
    
    // Check if the server has a source code URL
    if (!pulseServer.source_code_url) {
      console.error(`Server ${serverId} does not have a source code URL. Cannot install.`);
      return config; // Return unchanged config
    }
    
    console.log(`Adding server ${serverId} (${pulseServer.name}) to configuration from GitHub`);
    
    try {
      // Prepare the server from GitHub
      const serverConfig = await this.prepareGitHubServer(pulseServer);
      
      if (!serverConfig) {
        console.error(`Could not create config for server ${serverId}. Skipping.`);
        return config;
      }
      
      // Create a new config object to avoid mutating the original
      return {
        ...config,
        mcpServers: {
          ...config.mcpServers,
          [serverId]: serverConfig
        }
      };
    } catch (error) {
      console.error(`Failed to prepare server ${serverId} from GitHub:`, error);
      return config; // Return unchanged config if installation fails
    }
  }

  /**
   * Find and add multiple servers to the configuration based on search
   * @param config Existing MCP configuration
   * @param query Search query to find servers
   * @param limit Maximum number of servers to add
   * @returns Updated configuration and array of added servers
   */
  async findAndAddServers(
    config: MCPConfig, 
    query: string, 
    limit: number = 10
  ): Promise<{
    updatedConfig: MCPConfig;
    addedServers: PulseMCPServer[];
  }> {
    const servers = await this.searchServers(query, limit);
    
    if (servers.length === 0) {
      return { 
        updatedConfig: config, 
        addedServers: [] 
      };
    }
    
    let updatedConfig = { ...config };
    const addedServers: PulseMCPServer[] = [];
    
    for (const server of servers) {
      const currentConfig = { ...updatedConfig };
      updatedConfig = await this.addServerToConfig(updatedConfig, server);
      
      // Check if the server was actually added by comparing configs
      if (Object.keys(updatedConfig.mcpServers).length > Object.keys(currentConfig.mcpServers).length) {
        addedServers.push(server);
      }
    }
    
    return {
      updatedConfig,
      addedServers
    };
  }
} 