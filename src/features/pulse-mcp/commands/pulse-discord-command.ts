import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { ChatInputCommandInteraction, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, MessageActionRowComponentBuilder, StringSelectMenuOptionBuilder, Message, ComponentType, MessageComponentInteraction } from 'discord.js';
import { PulseMCPManager } from '../services/pulse-mcp-manager.js';
import { PulseMCPServer } from '../services/pulse-api-service.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { MCPConfig } from '../../../tools/mcp/di/container.js';
import mcpConfig from '../../../mcp_config.js';
import { ServerState } from '../../../tools/mcp/types/server.js';
import { installFromGitHub } from './pulse-dynamic-loader.js';
import { isEnhancedServerManager } from '../types/server-extensions.js';

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
        
        // If server doesn't exist or is in another state, start it directly
        console.log(`Starting server ${serverId} for the first time`);
        
        // Start the server with the configuration from mcpConfig
        await serverManager.startServer(serverId, mcpConfig.mcpServers[serverId]);
        return true;
    } catch (error) {
        console.error(`Error starting server ${serverId}:`, error);
        return false;
    }
}

/**
 * Creates a formatted embed for a server with an install button
 */
function createServerEmbed(server: PulseMCPServer, index: number): { 
    embed: EmbedBuilder, 
    button: ButtonBuilder 
} {
    // Create embed
    const embed = new EmbedBuilder()
        .setTitle(server.name)
        .setColor('#0099ff');

    // Add description
    if (server.short_description) {
        embed.setDescription(server.short_description);
    }

    // Add fields
    const fields = [];
    
    // Stars count
    fields.push({
        name: '⭐ GitHub Stars',
        value: `${(server.github_stars ?? 0).toLocaleString()}`,
        inline: true
    });

    // Links
    const links = [];
    if (server.source_code_url) {
        links.push(`[GitHub](${server.source_code_url})`);
    }
    if (server.external_url) {
        links.push(`[Website](${server.external_url})`);
    }
    
    if (links.length > 0) {
        fields.push({
            name: '🔗 Links',
            value: links.join(' · '),
            inline: true
        });
    }

    embed.addFields(fields);
    
    // Add footer
    embed.setFooter({ 
        text: `Server #${index + 1} · Pulse MCP` 
    });

    // Create install button
    const button = new ButtonBuilder()
        .setCustomId(`install-server-${index}`)
        .setLabel('Install Server')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📥');
        
    return { embed, button };
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

            // Sort servers by stars (highest first)
            const sortedServers = [...servers].sort((a, b) => (b.github_stars ?? 0) - (a.github_stars ?? 0));

            // Create embeds with buttons for each server
            const serverComponents = sortedServers.map((server, index) => 
                createServerEmbed(server, index)
            );

            // Split into chunks of 5 servers per message
            const chunkedResults = [];
            for (let i = 0; i < serverComponents.length; i += 5) {
                chunkedResults.push(serverComponents.slice(i, i + 5));
            }
            
            // Send the first message with servers
            const firstChunk = chunkedResults[0];
            const embeds = firstChunk.map(item => item.embed);
            
            // Create button rows for the first chunk
            const actionRows = firstChunk.map((item, i) => {
                return new ActionRowBuilder<MessageActionRowComponentBuilder>()
                    .addComponents(item.button);
            });
            
            const initialMessage = await interaction.editReply({
                content: `Found ${servers.length} MCP servers matching \`${query}\`. Click the install button to install a server:`,
                embeds: embeds,
                components: actionRows
            });
            
            // Send additional chunks if any
            const followupMessages = [];
            for (let i = 1; i < chunkedResults.length; i++) {
                const chunk = chunkedResults[i];
                const chunkEmbeds = chunk.map(item => item.embed);
                const chunkActionRows = chunk.map((item, j) => {
                    return new ActionRowBuilder<MessageActionRowComponentBuilder>()
                        .addComponents(item.button);
                });
                
                const message = await interaction.followUp({
                    embeds: chunkEmbeds,
                    components: chunkActionRows
                });
                
                followupMessages.push(message);
            }
            
            // Set up collector for button interactions
            const collector = interaction.channel?.createMessageComponentCollector({
                filter: i => i.customId.startsWith('install-server-') && i.user.id === interaction.user.id,
                time: 300000 // 5 minutes
            });
            
            collector?.on('collect', async (buttonInteraction) => {
                // Extract the server index from the button customId
                const serverIndex = parseInt(buttonInteraction.customId.replace('install-server-', ''));
                const serverToInstall = sortedServers[serverIndex];
                
                if (!serverToInstall) {
                    await buttonInteraction.reply({
                        content: '❌ Error: Could not find the selected server.',
                        ephemeral: true
                    });
                    return;
                }
                
                // Acknowledge the interaction
                await buttonInteraction.deferUpdate();
                
                // First check if the server already exists
                const serverId = serverToInstall.name.toLowerCase()
                    .replace(/[^a-z0-9-]/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/^-|-$/g, '');
                
                if (mcpConfig.mcpServers[serverId]) {
                    // Server already exists
                    await buttonInteraction.followUp({
                        content: `⚠️ Server \`${serverToInstall.name}\` is already installed. Use \`/pulse start ${serverId}\` to start it.`,
                        ephemeral: true
                    });
                    return;
                }
                
                // Show installation progress
                const progressMessage = await buttonInteraction.followUp({
                    content: `⏳ Installing server \`${serverToInstall.name}\` from GitHub repository...`,
                });
                
                try {
                    // Install the server
                    const result = await installFromGitHub([serverToInstall]);
                    
                    if (result.installedServers.length === 0) {
                        await progressMessage.edit({
                            content: `❌ Failed to install server \`${serverToInstall.name}\`. Check logs for details.`
                        });
                        return;
                    }
                    
                    // Save the configuration
                    const updatedConfig = {
                        ...mcpConfig,
                        mcpServers: {
                            ...mcpConfig.mcpServers,
                            ...result.config.mcpServers
                        }
                    };
                    
                    // Update global mcpConfig
                    Object.entries(result.config.mcpServers).forEach(([id, config]) => {
                        mcpConfig.mcpServers[id] = config;
                    });
                    
                    await saveConfig(updatedConfig);
                    
                    // Create start button
                    const startButton = new ButtonBuilder()
                        .setCustomId(`start-server-${serverId}`)
                        .setLabel('Start Server')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('▶️');
                    
                    const startRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
                        .addComponents(startButton);
                    
                    await progressMessage.edit({
                        content: `✅ Successfully installed server \`${serverToInstall.name}\`.`,
                        components: [startRow]
                    });
                    
                    // Set up collector for the start button
                    const startCollector = interaction.channel?.createMessageComponentCollector({
                        filter: i => i.customId === `start-server-${serverId}` && i.user.id === interaction.user.id,
                        time: 60000 // 1 minute
                    });
                    
                    startCollector?.on('collect', async (startInteraction) => {
                        await startInteraction.deferUpdate();
                        
                        const startProgressMessage = await startInteraction.followUp({
                            content: `⏳ Starting server \`${serverToInstall.name}\`...`,
                        });
                        
                        try {
                            const serverManager = await getServerManager();
                            
                            const started = await startServer(serverId, serverManager);
                            if (started) {
                                await startProgressMessage.edit({
                                    content: `✅ Server \`${serverToInstall.name}\` started successfully!`
                                });
                            } else {
                                await startProgressMessage.edit({
                                    content: `❌ Failed to start server \`${serverToInstall.name}\`. Check logs for details.`
                                });
                            }
                        } catch (error) {
                            console.error('Error starting server:', error);
                            await startProgressMessage.edit({
                                content: `❌ Error starting server: ${error instanceof Error ? error.message : String(error)}`
                            });
                        }
                    });
                    
                } catch (error) {
                    console.error('Error installing server:', error);
                    await progressMessage.edit({
                        content: `❌ Error installing server: ${error instanceof Error ? error.message : String(error)}`
                    });
                }
            });
            
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
            
            // Create server embeds
            const embeds = servers.map((server, index) => {
                const config = server?.config;
                const statusEmoji = 
                    server?.state === ServerState.RUNNING ? '🟢' : 
                    server?.state === ServerState.PAUSED ? '🟠' : 
                    server?.state === ServerState.ERROR ? '🔴' : '⚫';
                
                const embed = new EmbedBuilder()
                    .setTitle(`${statusEmoji} ${server?.name}`)
                    .setDescription(`Status: \`${server?.state}\``)
                    .setColor(
                        server?.state === ServerState.RUNNING ? '#00FF00' : 
                        server?.state === ServerState.PAUSED ? '#FFA500' : 
                        server?.state === ServerState.ERROR ? '#FF0000' : '#808080'
                    );
                
                // Add fields
                const fields = [];
                
                fields.push({
                    name: 'ID',
                    value: `\`${server?.id}\``,
                    inline: true
                });
                
                // Show source URL if available
                if (config?.env?.SOURCE_URL) {
                    fields.push({
                        name: 'Source',
                        value: `[GitHub](${config.env.SOURCE_URL})`,
                        inline: true
                    });
                }
                
                embed.addFields(fields);
                
                return embed;
            });
            
            // Create start buttons for each server
            const actionRows = servers.map(server => {
                const startButton = new ButtonBuilder()
                    .setCustomId(`list-start-${server?.id}`)
                    .setLabel(server?.state === ServerState.RUNNING ? 'Restart' : 'Start')
                    .setStyle(
                        server?.state === ServerState.RUNNING ? ButtonStyle.Secondary : ButtonStyle.Success
                    )
                    .setEmoji(
                        server?.state === ServerState.RUNNING ? '🔄' : '▶️'
                    );
                
                // Add stop button if server is running
                if (server?.state === ServerState.RUNNING) {
                    const stopButton = new ButtonBuilder()
                        .setCustomId(`list-stop-${server?.id}`)
                        .setLabel('Stop')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('⏹️');
                    
                    return new ActionRowBuilder<MessageActionRowComponentBuilder>()
                        .addComponents(startButton, stopButton);
                }
                
                return new ActionRowBuilder<MessageActionRowComponentBuilder>()
                    .addComponents(startButton);
            });
            
            // Split into chunks of 5 servers per message
            const chunkedEmbeds = [];
            const chunkedRows = [];
            for (let i = 0; i < embeds.length; i += 5) {
                chunkedEmbeds.push(embeds.slice(i, i + 5));
                chunkedRows.push(actionRows.slice(i, i + 5));
            }
            
            // Send the first message
            await interaction.editReply({
                content: '**Available MCP Servers:**',
                embeds: chunkedEmbeds[0],
                components: chunkedRows[0]
            });
            
            // Send additional chunks if any
            for (let i = 1; i < chunkedEmbeds.length; i++) {
                await interaction.followUp({
                    embeds: chunkedEmbeds[i],
                    components: chunkedRows[i]
                });
            }
            
            // Set up collector for button interactions
            const collector = interaction.channel?.createMessageComponentCollector({
                filter: i => 
                    (i.customId.startsWith('list-start-') || i.customId.startsWith('list-stop-')) && 
                    i.user.id === interaction.user.id,
                time: 300000 // 5 minutes
            });
            
            collector?.on('collect', async (buttonInteraction) => {
                await buttonInteraction.deferUpdate();
                
                // Extract the server ID from the button customId
                const isStart = buttonInteraction.customId.startsWith('list-start-');
                const serverId = isStart ? 
                    buttonInteraction.customId.replace('list-start-', '') : 
                    buttonInteraction.customId.replace('list-stop-', '');
                
                const progressMessage = await buttonInteraction.followUp({
                    content: `⏳ ${isStart ? 'Starting' : 'Stopping'} server \`${serverId}\`...`,
                });
                
                try {
                    const serverManager = await getServerManager();
                    
                    if (isStart) {
                        // Start the server
                        const started = await startServer(serverId, serverManager);
                        if (started) {
                            await progressMessage.edit({
                                content: `✅ Server \`${serverId}\` started successfully!`
                            });
                        } else {
                            await progressMessage.edit({
                                content: `❌ Failed to start server \`${serverId}\`. Check logs for details.`
                            });
                        }
                    } else {
                        // Stop the server
                        await serverManager.stopServer(serverId);
                        await progressMessage.edit({
                            content: `✅ Server \`${serverId}\` stopped successfully!`
                        });
                    }
                } catch (error) {
                    console.error(`Error ${isStart ? 'starting' : 'stopping'} server:`, error);
                    await progressMessage.edit({
                        content: `❌ Error ${isStart ? 'starting' : 'stopping'} server: ${error instanceof Error ? error.message : String(error)}`
                    });
                }
            });
            
        } catch (error) {
            console.error('Error listing servers:', error);
            await interaction.editReply('❌ Error listing servers. Please check the bot logs for more details.');
        }
    }
}