/**
 * Dynamic Package Loader for MCP Servers
 * 
 * This service ensures that newly installed packages can be properly loaded
 * without requiring the bot to restart. It handles the dynamic import challenges
 * by providing methods to refresh module paths and clear require cache.
 */

import path from 'path';
import { MCPConfig } from '../../../tools/mcp/di/container.js';
import { clearRequireCache } from './module-utils.js';
import { ServerConfig } from '../../../tools/mcp/types/server.js';

export class PackageLoader {
    /**
     * Update package paths in server configurations after installation
     * 
     * @param mcpConfig The current MCP configuration
     * @param serverIds IDs of servers with newly installed packages
     * @returns Updated MCP configuration
     */
    static updatePackagePaths(mcpConfig: MCPConfig, serverIds: string[]): MCPConfig {
        const updatedConfig = { ...mcpConfig };
        const updatedServers = { ...updatedConfig.mcpServers };
        let updated = false;
        
        for (const serverId of serverIds) {
            if (!updatedServers[serverId]) {
                console.warn(`Server ${serverId} not found in configuration, skipping update`);
                continue;
            }
            
            const server = { ...updatedServers[serverId] };
            if (server.env?.PACKAGE_NAME) {
                // Update the package path to point to the newly installed module
                const nodeModulesPath = path.join(process.cwd(), 'node_modules');
                const packagePath = path.join(nodeModulesPath, server.env.PACKAGE_NAME, 'dist', 'index.js');
                
                console.log(`Updating package path for ${serverId} to ${packagePath}`);
                
                // Update the config
                updatedServers[serverId] = {
                    ...server,
                    args: [packagePath]
                };
                updated = true;
            }
        }
        
        if (updated) {
            return {
                ...updatedConfig,
                mcpServers: updatedServers
            };
        }
        
        return updatedConfig;
    }
    
    /**
     * Prepare a server config for dynamic loading
     * 
     * @param config The server configuration
     * @returns Configuration ready for dynamic loading
     */
    static prepareForDynamicLoading(config: ServerConfig): ServerConfig {
        const updatedConfig = { ...config };
        
        // Ensure any Node.js-specific settings are prepared for dynamic loading
        if (updatedConfig.env) {
            // Create a new env object if it doesn't exist
            const env = updatedConfig.env || {};
            
            // Add flags to indicate this server was dynamically loaded
            env.DYNAMICALLY_LOADED = 'true';
            
            // Add the current timestamp to avoid caching issues
            env.LOAD_TIMESTAMP = Date.now().toString();
            
            // Update the config with the modified env
            updatedConfig.env = env;
        }
        
        return updatedConfig;
    }
    
    /**
     * Clear module caches for newly installed packages
     * This is important when trying to load a newly installed package
     * without restarting the Node.js process
     * 
     * @param packageNames Names of packages to clear from cache
     */
    static clearPackageCaches(packageNames: string[]): void {
        if (!packageNames || packageNames.length === 0) return;
        
        console.log(`Clearing cache for packages: ${packageNames.join(', ')}`);
        
        try {
            // Clear cache for each package
            packageNames.forEach(packageName => {
                if (packageName && packageName.trim()) {
                    clearRequireCache(packageName);
                    console.log(`Cleared cache for package: ${packageName}`);
                }
            });
        } catch (error) {
            console.error(`Failed to clear package caches:`, error);
        }
    }
} 