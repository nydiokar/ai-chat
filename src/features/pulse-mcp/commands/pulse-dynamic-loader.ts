/**
 * Dynamic loader integration for pulse commands
 * 
 * This module provides functions to handle dynamic loading of MCP server packages
 * without requiring a bot restart, integrating with the package-loader utilities.
 */

import { spawn } from 'child_process';
import path from 'path';
import { MCPConfig } from '../../../tools/mcp/di/container.js';
import { PackageLoader } from '../services/package-loader.js';
import mcpConfig from '../../../mcp_config.js';

/**
 * Install packages and prepare them for dynamic loading
 * 
 * @param packageNames Names of packages to install
 * @returns Installation result message
 */
export async function installAndPreparePackages(packageNames: string[]): Promise<string> {
    if (packageNames.length === 0) {
        return "No packages to install.";
    }
    
    try {
        // First install the packages
        const installResult = await installServerPackages(packageNames);
        
        // Then clear the require cache for these packages to allow dynamic loading
        PackageLoader.clearPackageCaches(packageNames);
        
        return installResult;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error installing packages:', errorMessage);
        return `❌ Installation failed: ${errorMessage}`;
    }
}

/**
 * Install packages using npm/yarn
 * 
 * @param packageNames Names of packages to install
 * @returns Installation result message
 */
async function installServerPackages(packageNames: string[]): Promise<string> {
    if (packageNames.length === 0) return "No packages to install.";
    
    return new Promise((resolve, reject) => {
        const isWindows = process.platform === 'win32';
        const command = isWindows ? 'npm.cmd' : 'npm';
        
        const args = ['install', ...packageNames];
        console.log(`Installing packages with command: ${command} ${args.join(' ')}`);
        
        const child = spawn(command, args, { 
            stdio: 'pipe',
            cwd: process.cwd(),
            env: { ...process.env }
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data: Buffer) => {
            const output = data.toString();
            stdout += output;
            console.log(`[npm install] ${output.trim()}`);
        });
        
        child.stderr.on('data', (data: Buffer) => {
            const output = data.toString();
            stderr += output;
            console.error(`[npm install error] ${output.trim()}`);
        });
        
        child.on('error', (error: Error) => {
            console.error(`[npm install] Command execution error:`, error);
            reject(`Failed to install packages: ${error.message}`);
        });
        
        child.on('close', (code: number) => {
            if (code !== 0) {
                console.error(`[npm install] Process exited with code ${code}`);
                reject(`Package installation failed with code ${code}. Error: ${stderr}`);
                return;
            }
            
            console.log(`[npm install] Successfully installed packages: ${packageNames.join(', ')}`);
            resolve(`Packages installed successfully: ${packageNames.join(', ')}`);
        });
    });
}

/**
 * Prepare newly installed servers for dynamic loading
 * 
 * @param serverIds IDs of servers that were newly installed
 * @returns Updated configuration
 */
export function prepareNewServers(serverIds: string[]): MCPConfig {
    // Update package paths in the configuration
    const updatedConfig = PackageLoader.updatePackagePaths(mcpConfig, serverIds);
    
    // For each server, prepare its configuration for dynamic loading
    for (const serverId of serverIds) {
        if (updatedConfig.mcpServers[serverId]) {
            const config = updatedConfig.mcpServers[serverId];
            updatedConfig.mcpServers[serverId] = PackageLoader.prepareForDynamicLoading(config);
        }
    }
    
    return updatedConfig;
}

/**
 * Get package names from server IDs
 * 
 * @param serverIds IDs of servers
 * @returns Array of package names
 */
export function getPackageNamesFromServerIds(serverIds: string[]): string[] {
    return serverIds
        .map(id => mcpConfig.mcpServers[id]?.env?.PACKAGE_NAME)
        .filter((name): name is string => !!name);
} 