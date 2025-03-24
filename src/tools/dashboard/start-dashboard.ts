#!/usr/bin/env node

/**
 * Start the MCP Metrics Dashboard as a standalone service
 */

import { MCPContainer } from '../mcp/di/container.js';
import mcpConfig from '../../mcp_config.js';
import { startDashboard } from './dashboard.js';
import { BaseServerManager } from '../mcp/base/base-server-manager.js';

/**
 * Ensure all configured servers are registered
 */
async function ensureServersRegistered(serverManager: BaseServerManager): Promise<void> {
    try {
        console.log('Registering servers with MCP Manager...');
        
        // Get the server IDs from the configuration
        const configuredServers = Object.keys(mcpConfig.mcpServers);
        console.log(`Found ${configuredServers.length} servers in configuration: ${configuredServers.join(', ')}`);
        
        // Register each server
        const registrationPromises = configuredServers.map(async (serverId) => {
            try {
                // Check if server already registered
                if (serverManager.hasServer(serverId)) {
                    console.log(`Server ${serverId} already registered.`);
                    return serverId;
                }
                
                console.log(`Registering server: ${serverId}`);
                const config = mcpConfig.mcpServers[serverId];
                await serverManager.registerServer(serverId, config);
                console.log(`Successfully registered server: ${serverId}`);
                return serverId;
            } catch (error) {
                console.error(`Failed to register server ${serverId}:`, error);
                return null;
            }
        });
        
        // Wait for all registration to complete
        const results = await Promise.all(registrationPromises);
        const successfulRegistrations = results.filter(Boolean);
        
        console.log(`Registered ${successfulRegistrations.length}/${configuredServers.length} servers`);
    } catch (error) {
        console.error('Error registering servers:', error);
    }
}

async function main(): Promise<void> {
    try {
        console.log('Starting MCP Metrics Dashboard...');
        
        // Create container with configuration
        const container = new MCPContainer(mcpConfig);
        
        // Get the server manager from the container
        const serverManager = container.getServerManager() as BaseServerManager;
        
        // Ensure all servers are registered
        await ensureServersRegistered(serverManager);
        
        // Start the dashboard server (defaults to port 8080)
        const dashboardPort = process.env.MCP_DASHBOARD_PORT ? 
            parseInt(process.env.MCP_DASHBOARD_PORT, 10) : 
            8080;
            
        await startDashboard(serverManager, dashboardPort);
        
        console.log(`Dashboard server started. Access at http://localhost:${dashboardPort}`);
        console.log('Press Ctrl+C to exit.');
        
    } catch (error) {
        console.error('Failed to start dashboard:', error);
        process.exit(1);
    }
}

// Run the dashboard
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
}); 