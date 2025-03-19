import { SlashCommandBuilder } from 'discord.js';
import { ChatInputCommandInteraction, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, MessageActionRowComponentBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { PulseMCPManager } from '../services/pulse-mcp-manager.js';
import { PulseMCPServer } from '../services/pulse-api-service.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { MCPConfig } from '../../../tools/mcp/di/container.js';
import mcpConfig from '../../../mcp_config.js';
import { ServerState } from '../../../tools/mcp/types/server.js';
import { installAndPreparePackages, prepareNewServers, getPackageNamesFromServerIds } from './pulse-dynamic-loader.js';
import { isEnhancedServerManager } from '../types/server-extensions.js';
import { registerMCPServerId } from '../../../types/tools.js';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// For saving, we'll need to handle both development and production environments
async function getConfigPath(): Promise<string> {
    const possiblePaths = [
        // Source paths
        path.resolve(process.cwd(), 'src/mcp_config.ts'),
        path.resolve(__dirname, '../../../mcp_config.ts'),
        
        // Distribution paths
        path.resolve(process.cwd(), 'dist/mcp_config.js'),
        path.resolve(__dirname, '../../../mcp_config.js'),
        
        // Root paths (in case the file is at project root)
        path.resolve(process.cwd(), 'mcp_config.ts'),
        path.resolve(process.cwd(), 'mcp_config.js')
    ];
    
    // Try all paths in order until we find one that exists
    for (const tryPath of possiblePaths) {
        try {
            await fs.access(tryPath);
            console.log(`Found config file at: ${tryPath}`);
            return tryPath;
        } catch (error) {
            console.log(`Config not found at: ${tryPath}`);
            // Continue to next path
        }
    }
    
    // If we get here, we couldn't find the config file in any of the expected locations
    // Throw an error with detailed information
    throw new Error(`Could not find mcp_config file in any of the expected locations. 
        Tried: ${JSON.stringify(possiblePaths, null, 2)}
        Process CWD: ${process.cwd()}
        Module dirname: ${__dirname}`);
}

// Create the command
export const pulseCommand = new SlashCommandBuilder()
    .setName('pulse')
    .setDescription('Search and integrate MCP servers from Pulse API')
    .addSubcommand(subcommand =>
        subcommand
            .setName('search')
            .setDescription('Search for MCP servers')
            .addStringOption(option =>
                option.setName('query')
                    .setDescription('Search term')
                    .setRequired(true))
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('start')
            .setDescription('Start an installed MCP server')
            .addStringOption(option =>
                option.setName('server')
                    .setDescription('Server ID to start')
                    .setRequired(true))
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('list')
            .setDescription('List all available MCP servers')
    );

/**
 * Save the updated MCP configuration back to the file
 * @param updatedConfig The new configuration object
 */
async function saveConfig(updatedConfig: MCPConfig): Promise<void> {
    try {
        // Get the appropriate config path for this environment
        const configPath = await getConfigPath();
        console.log(`Saving config to: ${configPath}`);

        // Read the current file content to preserve formatting and comments
        const currentContent = await fs.readFile(configPath, 'utf8');

        // Extract all servers from the updated config that aren't part of the default set
        const newServers = Object.entries(updatedConfig.mcpServers)
            .filter(([id]) => id !== 'github' && id !== 'brave-search');
        
        if (newServers.length === 0) {
            console.log('No dynamic servers to save');
            return;
        }
            
        // Create a new block that will add all servers to enabledServers
        const serverAdditions = newServers
            .map(([id, server]) => {
                return `enabledServers["${id}"] = ${JSON.stringify(server, null, 2)};`;
            })
            .join('\n\n');
        
        console.log(`Adding ${newServers.length} servers to config: ${newServers.map(([id]) => id).join(', ')}`);
        
        // First check if we already have a section for dynamically added servers
        const dynamicSectionStartMarker = '// DYNAMICALLY ADDED SERVERS - DO NOT REMOVE THIS COMMENT';
        const dynamicSectionEndMarker = '// END DYNAMIC SERVERS';
        
        let updatedContent;
        if (currentContent.includes(dynamicSectionStartMarker)) {
            // Replace existing dynamic section with careful boundary detection
            const startIndex = currentContent.indexOf(dynamicSectionStartMarker);
            const endIndex = currentContent.indexOf(dynamicSectionEndMarker, startIndex);
            
            if (startIndex !== -1 && endIndex !== -1) {
                const beforeSection = currentContent.substring(0, startIndex + dynamicSectionStartMarker.length);
                const afterSection = currentContent.substring(endIndex);
                
                updatedContent = `${beforeSection}\n\n${serverAdditions}\n\n${afterSection}`;
                console.log('Replaced existing dynamic section in config');
            } else {
                // Couldn't find proper boundaries, append to the end
                updatedContent = currentContent.replace(
                    /export const mcpConfig/,
                    `\n${dynamicSectionStartMarker}\n${serverAdditions}\n${dynamicSectionEndMarker}\n\nexport const mcpConfig`
                );
                console.log('Could not find proper section boundaries, appended to end');
            }
        } else {
            // Add dynamic section before the export const
            updatedContent = currentContent.replace(
                /export const mcpConfig/,
                `\n${dynamicSectionStartMarker}\n${serverAdditions}\n${dynamicSectionEndMarker}\n\nexport const mcpConfig`
            );
            console.log('Added new dynamic section to config');
        }
        
        // Write the updated content back to the file
        await fs.writeFile(configPath, updatedContent, 'utf8');
        console.log(`Configuration saved successfully to ${configPath}`);
        
        // Force reload the config to ensure we have the latest version in memory
        try {
            // Clear the module cache for mcp_config
            const { clearRequireCache } = await import('../services/module-utils.js');
            
            // Clear and reload mcp_config
            const configModulePath = '../../../mcp_config.js';
            clearRequireCache(configModulePath);
            
            // Force re-import of the config
            const refreshedConfig = await import('../../../mcp_config.js?t=' + Date.now());
            
            // This is a workaround to update the current mcpConfig
            Object.assign(mcpConfig, refreshedConfig.default);
            
            console.log('Successfully reloaded configuration into memory');
        } catch (reloadError) {
            console.error('Failed to reload configuration:', reloadError);
            console.warn('Changes were saved to file but may not be reflected until restart');
        }
        
        return;
    } catch (error) {
        console.error('Failed to update configuration:', error);
        throw error;
    }
}

/**
 * Get the server manager from the Discord bot
 */
async function getServerManager() {
    // Import the Discord service to get the existing server manager
    const { DiscordService } = await import('../../../services/discord-service.js');
    
    // Get the instance of DiscordService
    const discordService = await DiscordService.getInstance();
    
    // Get MCP container from the service
    const container = discordService.getMCPContainer();
    if (!container) {
        throw new Error('MCP Container is not initialized in the Discord service');
    }
    
    // Get the server manager
    return container.getServerManager();
}

/**
 * Start a server or ensure it's running, with support for dynamic loading
 */
async function startServer(serverId: string, serverManager: any): Promise<boolean> {
    try {
        // First, check if the server exists in our configuration
        if (!mcpConfig.mcpServers[serverId]) {
            console.error(`Server ${serverId} not found in configuration`);
            return false; // Server not found in config
        }
        
        // Check if server is already registered in the server manager
        if (serverManager.hasServer(serverId)) {
            const server = serverManager.getServer(serverId);
            
            // Handle different server states
            if (server?.state === ServerState.RUNNING) {
                // Server is already running, no need to do anything
                console.log(`Server ${serverId} is already running`);
                return true;
            } else if (server?.state === ServerState.PAUSED && isEnhancedServerManager(serverManager)) {
                // Resume paused server with EnhancedServerManager
                console.log(`Resuming paused server ${serverId}`);
                await serverManager.resumeServer(serverId);
                return true;
            } else if (server?.state === ServerState.STOPPING || server?.state === ServerState.STOPPED) {
                // Restart a stopped server using the server's existing config
                console.log(`Restarting stopped server ${serverId}`);
                await serverManager.startServer(serverId, server.config);
                return true;
            } else if (server?.state === ServerState.ERROR) {
                // For servers in error state, try to restart them
                console.log(`Restarting server ${serverId} that was in ERROR state`);
                
                // Use the latest config from mcpConfig rather than potentially outdated server.config
                await serverManager.startServer(serverId, mcpConfig.mcpServers[serverId]);
                return true;
            }
        }
        
        // If server doesn't exist or is in another state, prepare it for dynamic loading
        console.log(`Starting server ${serverId} for the first time`);
        
        // Prepare the server configuration for dynamic loading
        const updatedConfig = prepareNewServers([serverId]);
        
        // Start the server with the prepared configuration
        await serverManager.startServer(serverId, updatedConfig.mcpServers[serverId]);
        return true;
    } catch (error) {
        console.error(`Error starting server ${serverId}:`, error);
        return false;
    }
}

/**
 * Handle the pulse search command
 */
export async function handlePulseCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'search') {
        await interaction.deferReply();
        const query = interaction.options.getString('query', true);
        
        const manager = new PulseMCPManager();
        
        try {
            // Search for servers
            const servers = await manager.searchServers(query, 15);
            
            if (servers.length === 0) {
                await interaction.editReply(`No MCP servers found matching \`${query}\`.`);
                return;
            }
            
            // Create select menu for servers
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('pulse-server-select')
                .setPlaceholder('Select servers to add')
                .setMinValues(1)
                .setMaxValues(Math.min(servers.length, 10));
            
            // Add options to the select menu
            servers.forEach((server, index) => {
                selectMenu.addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel(server.name)
                        .setDescription(server.short_description.substring(0, 100))
                        .setValue(index.toString())
                );
            });
            
            // Create action row with the select menu
            const row = new ActionRowBuilder<MessageActionRowComponentBuilder>()
                .addComponents(selectMenu);
            
            // Send the message with the select menu
            const response = await interaction.editReply({
                content: `Found ${servers.length} MCP servers matching \`${query}\`. Please select servers to add:`,
                components: [row]
            });
            
            try {
                // Wait for user selection
                const collectedInteraction = await response.awaitMessageComponent({
                    filter: i => i.customId === 'pulse-server-select' && i.user.id === interaction.user.id,
                    time: 60000
                });
                
                // Get selected server indices
                const selectedIndices = collectedInteraction.isStringSelectMenu() 
                    ? collectedInteraction.values.map(v => parseInt(v)) 
                    : [];
                
                // Get selected servers
                const selectedServers = selectedIndices.map(index => servers[index]);
                
                // Indicate processing
                await collectedInteraction.update({
                    content: `Adding ${selectedServers.length} servers to configuration...`,
                    components: []
                });
                
                // Check for existing servers before adding to config
                const existingServers: string[] = [];
                const newServers: PulseMCPServer[] = [];
                const newServerIds: string[] = [];
                
                // Create a local copy of the config to update
                let updatedConfig = { 
                    ...mcpConfig, 
                    mcpServers: { ...mcpConfig.mcpServers } 
                };
                
                for (const server of selectedServers) {
                    const serverId = server.name.toLowerCase()
                        .replace(/[^a-z0-9-]/g, '-')
                        .replace(/-+/g, '-')
                        .replace(/^-|-$/g, '');
                        
                    if (mcpConfig.mcpServers[serverId]) {
                        existingServers.push(server.name);
                    } else {
                        newServers.push(server);
                        newServerIds.push(serverId);
                        
                        // Register the new server ID dynamically
                        registerMCPServerId(serverId);
                        console.log(`Dynamically registered new server ID: ${serverId}`);
                    }
                }
                
                // Add servers to config
                for (const server of selectedServers) {
                    // Get the updated config with the new server
                    const configWithServer = manager.addServerToConfig(updatedConfig, server);
                    
                    // Update our local copy
                    updatedConfig = configWithServer;
                    
                    // Also update the global mcpConfig object to ensure it reflects the changes
                    // This is important because other code might reference mcpConfig directly
                    const serverId = server.name.toLowerCase()
                        .replace(/[^a-z0-9-]/g, '-')
                        .replace(/-+/g, '-')
                        .replace(/^-|-$/g, '');
                        
                    if (configWithServer.mcpServers[serverId] && !mcpConfig.mcpServers[serverId]) {
                        // Add to the in-memory config too
                        mcpConfig.mcpServers[serverId] = configWithServer.mcpServers[serverId];
                        console.log(`Added server ${serverId} to in-memory config`);
                    }
                }
                
                // Now that both configs are updated, save to disk
                await saveConfig(updatedConfig);
                
                // Prepare message about existing servers
                let existingServersMessage = '';
                if (existingServers.length > 0) {
                    existingServersMessage = `\n\nNote: The following servers were already in your configuration: ${existingServers.join(', ')}`;
                }
                
                // Get packages to install (only for new servers)
                const packagesToInstall = newServers
                    .filter((server: PulseMCPServer) => server.package_name)
                    .map((server: PulseMCPServer) => server.package_name as string);
                
                let installationResult = "No packages needed to be installed.";
                
                if (packagesToInstall.length > 0) {
                    // Create buttons for installation choice
                    const installButton = new ButtonBuilder()
                        .setCustomId('install-packages')
                        .setLabel(`Install ${packagesToInstall.length} package(s)`)
                        .setStyle(ButtonStyle.Primary);
                    
                    const skipButton = new ButtonBuilder()
                        .setCustomId('skip-install')
                        .setLabel('Skip installation')
                        .setStyle(ButtonStyle.Secondary);
                    
                    const buttonRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
                        .addComponents(installButton, skipButton);
                    
                    // Ask if user wants to install packages
                    const installPrompt = await interaction.followUp({
                        content: `Would you like to install the required packages? (${packagesToInstall.join(', ')})`,
                        components: [buttonRow]
                    });
                    
                    // Wait for user decision
                    try {
                        const buttonInteraction = await installPrompt.awaitMessageComponent({
                            filter: i => 
                                (i.customId === 'install-packages' || i.customId === 'skip-install') && 
                                i.user.id === interaction.user.id,
                            time: 60000
                        });
                        
                        if (buttonInteraction.customId === 'install-packages') {
                            await buttonInteraction.update({
                                content: 'Installing packages... This might take a moment.',
                                components: []
                            });
                            
                            try {
                                // Use the enhanced installation function that handles dynamic loading
                                installationResult = await installAndPreparePackages(packagesToInstall);
                            } catch (installError) {
                                if (installError instanceof Error) {
                                    installationResult = `❌ Installation failed: ${installError.message}`;
                                } else {
                                    installationResult = `❌ Installation failed: ${String(installError)}`;
                                }
                            }
                        } else {
                            await buttonInteraction.update({
                                content: 'Package installation skipped.',
                                components: []
                            });
                            installationResult = "Packages were not installed. You'll need to install them manually.";
                        }
                    } catch (timeoutError) {
                        await installPrompt.edit({
                            content: 'Package installation selection timed out.',
                            components: []
                        });
                        installationResult = "Packages were not installed due to timeout. You'll need to install them manually.";
                    }
                }
                
                // Try to start the servers immediately
                let startResults: string[] = [];
                
                try {
                    const serverManager = await getServerManager();
                    
                    // Prepare the servers for dynamic loading if they were newly added
                    if (newServerIds.length > 0) {
                        // This updates the configuration with dynamic loading support
                        const updatedConfig = prepareNewServers(newServerIds);
                        await saveConfig(updatedConfig);
                    }
                    
                    // For each selected server, try to start it
                    for (const server of selectedServers) {
                        const serverId = server.name.toLowerCase()
                            .replace(/[^a-z0-9-]/g, '-')
                            .replace(/-+/g, '-')
                            .replace(/^-|-$/g, '');
                        
                        // Use the enhanced startServer function with dynamic loading support
                        const started = await startServer(serverId, serverManager);
                        
                        if (started) {
                            startResults.push(`✅ Started **${server.name}** server successfully`);
                        } else {
                            startResults.push(`⚠️ Could not start **${server.name}** server. Server may not exist or there was an error.`);
                        }
                    }
                } catch (error) {
                    console.error('Error starting servers:', error);
                    startResults.push('❌ Error starting servers. Please check the bot logs for more details.');
                }
                
                // Send the result message
                await interaction.followUp({
                    content: `Installation result: ${installationResult}${existingServersMessage}`,
                    embeds: [
                        {
                            description: startResults.join('\n'),
                            color: 0x00FF00
                        }
                    ]
                });
            } catch (error) {
                console.error('Error handling pulse command:', error);
                await interaction.followUp({
                    content: '❌ Error handling pulse command. Please check the bot logs for more details.',
                    ephemeral: true
                });
            }
        } catch (error) {
            console.error('Error handling pulse command:', error);
            await interaction.followUp({
                content: '❌ Error handling pulse command. Please check the bot logs for more details.',
                ephemeral: true
            });
        }
    } else if (subcommand === 'start') {
        await interaction.deferReply();
        const serverId = interaction.options.getString('server', true);
        
        try {
            const serverManager = await getServerManager();
            
            // Use our enhanced startServer function
            const started = await startServer(serverId, serverManager);
            
            if (started) {
                await interaction.editReply({
                    content: `✅ Started server \`${serverId}\` successfully`
                });
            } else {
                await interaction.editReply({
                    content: `❌ Failed to start server \`${serverId}\`. Server may not exist in configuration.`
                });
            }
        } catch (error) {
            console.error('Error starting server:', error);
            await interaction.editReply({
                content: '❌ Error starting server. Please check the bot logs for more details.'
            });
        }
    } else if (subcommand === 'list') {
        await interaction.deferReply();
        
        try {
            const serverManager = await getServerManager();
            const serverIds = serverManager.getServerIds();
            
            if (serverIds.length === 0) {
                await interaction.editReply('No MCP servers are currently registered.');
                return;
            }
            
            const servers = serverIds
                .map(id => serverManager.getServer(id))
                .filter(server => server !== undefined);
            
            if (servers.length === 0) {
                await interaction.editReply('No valid MCP servers found.');
                return;
            }
            
            // Generate server list with status
            const serverList = servers.map(server => {
                const config = server?.config;
                const description = config?.env?.SHORT_DESCRIPTION || 'No description';
                const statusEmoji = server?.state === ServerState.RUNNING ? '🟢' : 
                                   server?.state === ServerState.PAUSED ? '🟠' : '⚫';
                
                return `${statusEmoji} **${server?.name}** (\`${server?.id}\`)\n   Status: \`${server?.state}\`\n   Description: ${description}`;
            }).join('\n\n');
            
            await interaction.editReply({
                content: `**Available MCP Servers:**\n\n${serverList}\n\nTo start a server, use \`/pulse start\` with the server ID.`
            });
        } catch (error) {
            console.error('Error listing servers:', error);
            await interaction.editReply('❌ Error listing servers. Please check the bot logs for more details.');
        }
    }
}