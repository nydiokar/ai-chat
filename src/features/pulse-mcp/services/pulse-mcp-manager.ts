import { PulseAPIService, PulseMCPServer } from './pulse-api-service.js';
import { MCPConfig } from '../../../tools/mcp/di/container.js';
import { ServerConfig } from '../../../tools/mcp/types/server.js';
import path from 'path';

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
   * Convert a Pulse MCP server to our ServerConfig format
   * @param pulseServer The server from Pulse API
   * @returns ServerConfig compatible with our MCP container
   */
  convertToServerConfig(pulseServer: PulseMCPServer): ServerConfig {
    // Extract package name and registry info
    const packageInfo = pulseServer.package_name ? 
      { 
        name: pulseServer.package_name,
        registry: pulseServer.package_registry || 'npm'
      } : null;

    // Create a safe server ID from the name
    const serverId = pulseServer.name.toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    
    // Get Node.js executable path
    const nodePath = process.execPath;
    
    // Default path for node modules
    const nodeModulesPath = path.join(process.cwd(), 'node_modules');
    
    // Try to determine the package path based on naming convention
    const packagePath = packageInfo?.name ? 
      path.join(nodeModulesPath, packageInfo.name, 'dist', 'index.js') : 
      null;

    return {
      id: serverId,
      name: pulseServer.name,
      command: nodePath,
      args: packagePath ? [packagePath] : [],
      env: {
        SHORT_DESCRIPTION: pulseServer.short_description,
        SERVER_URL: pulseServer.url || '',
        SOURCE_URL: pulseServer.source_code_url || '',
        PACKAGE_NAME: pulseServer.package_name || '',
        PACKAGE_REGISTRY: pulseServer.package_registry || '',
        GITHUB_STARS: String(pulseServer.github_stars || 0)
      }
    };
  }

  /**
   * Add a Pulse server to the MCP configuration
   * @param config Existing MCP configuration
   * @param pulseServer Server from Pulse API to add
   * @returns Updated MCP configuration with the new server
   */
  addServerToConfig(config: MCPConfig, pulseServer: PulseMCPServer): MCPConfig {
    const serverConfig = this.convertToServerConfig(pulseServer);
    const serverId = serverConfig.id;
    
    // Check if a server with this ID already exists in the configuration
    if (config.mcpServers && config.mcpServers[serverId]) {
      console.log(`Server with ID ${serverId} already exists in configuration. Skipping.`);
      return config; // Return unchanged config
    }
    
    console.log(`Adding server ${serverId} (${pulseServer.name}) to configuration`);
    
    // Create a new config object to avoid mutating the original
    return {
      ...config,
      mcpServers: {
        ...config.mcpServers,
        [serverId]: serverConfig
      }
    };
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
    limit: number = 5
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
    
    for (const server of servers) {
      updatedConfig = this.addServerToConfig(updatedConfig, server);
    }
    
    return {
      updatedConfig,
      addedServers: servers
    };
  }
} 