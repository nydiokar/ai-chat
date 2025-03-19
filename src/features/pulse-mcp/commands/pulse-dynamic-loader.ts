/**
 * Dynamic loader integration for pulse commands
 * 
 * This module provides functions to handle dynamic loading of MCP server packages
 * without requiring a bot restart, integrating with the package-loader utilities.
 */

import { execSync } from 'child_process';
import { MCPConfig } from '../../../tools/mcp/di/container.js';
import path from 'path';
import fs from 'fs/promises';

const nodePath = process.execPath;
const projectRoot = process.cwd();

/**
 * Install packages and prepare them for dynamic loading
 * 
 * @param packages Names of packages to install
 * @returns Installation result message
 */
export async function installAndPreparePackages(packages: string[]): Promise<string> {
    try {
        // Filter out empty package names
        const validPackages = packages.filter(pkg => pkg && pkg.trim());
        if (validPackages.length === 0) {
            return "No valid packages to install.";
        }

        // Install packages with exact versions
        console.log('Installing packages:', validPackages);
        execSync(`npm install ${validPackages.join(' ')} --save-exact`, { 
            stdio: 'inherit',
            cwd: projectRoot
        });

        // Build packages if needed
        for (const pkg of validPackages) {
            const pkgPath = path.join(projectRoot, 'node_modules', pkg);
            try {
                // Check if package has a build script
                const pkgJson = JSON.parse(await fs.readFile(path.join(pkgPath, 'package.json'), 'utf8'));
                if (pkgJson.scripts?.build) {
                    console.log(`Building package ${pkg}...`);
                    execSync('npm run build', { 
                        stdio: 'inherit',
                        cwd: pkgPath 
                    });
                }
            } catch (error) {
                console.warn(`Warning: Could not build package ${pkg}:`, error);
            }
        }

        return `Successfully installed and prepared packages: ${validPackages.join(', ')}`;
    } catch (error) {
        console.error('Error installing packages:', error);
        throw new Error(`Failed to install packages: ${error.message}`);
    }
}

/**
 * Prepare newly installed servers for dynamic loading
 * 
 * @param serverIds IDs of servers that were newly installed
 * @returns Updated configuration
 */
export function prepareNewServers(serverIds: string[]): MCPConfig {
    const config = {
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

    for (const serverId of serverIds) {
        // Get package name from node_modules
        const packageName = getPackageNamesFromServerIds([serverId])[0];
        if (!packageName) {
            console.warn(`No package found for server ${serverId}`);
            continue;
        }

        try {
            // Read package.json to get entry point
            const pkgPath = path.join(projectRoot, 'node_modules', packageName);
            const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgPath, 'package.json'), 'utf8'));
            
            // Get the entry point - prefer dist/index.js if it exists
            let entryPoint = 'dist/index.js';
            if (!fs.existsSync(path.join(pkgPath, entryPoint))) {
                entryPoint = pkgJson.main || 'index.js';
            }

            // Create server config following the GitHub/Brave pattern
            config.mcpServers[serverId] = {
                id: serverId,
                name: pkgJson.name || serverId,
                command: nodePath,
                args: [
                    path.join('node_modules', packageName, entryPoint)
                ],
                env: {
                    PWD: projectRoot,
                    // Add any additional environment variables needed by the server
                    NODE_ENV: process.env.NODE_ENV || 'production'
                }
            };
        } catch (error) {
            console.error(`Error preparing server ${serverId}:`, error);
        }
    }

    return config;
}

/**
 * Get package names from server IDs
 * 
 * @param serverIds IDs of servers
 * @returns Array of package names
 */
export function getPackageNamesFromServerIds(serverIds: string[]): string[] {
    // Map server IDs to package names based on a convention
    // This should match how the packages are published in npm
    return serverIds.map(id => {
        // Convert server ID to package name format
        // e.g., "twitter" -> "@modelcontextprotocol/server-twitter"
        return `@modelcontextprotocol/server-${id}`;
    });
} 