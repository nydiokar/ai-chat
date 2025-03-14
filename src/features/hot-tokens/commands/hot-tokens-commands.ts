import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { HotTokensService } from '../services/hot-tokens-service.js';
import { TokenCategory } from '../types/token-category.js';

export const hotTokensCommands = new SlashCommandBuilder()
    .setName('ht')
    .setDescription('Manage hot tokens list')
    .addSubcommand(subcommand =>
        subcommand
            .setName('add')
            .setDescription('Add a new token to the hot list')
            .addStringOption(option =>
                option.setName('name')
                    .setDescription('Token name')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('contract')
                    .setDescription('Token contract address')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('category')
                    .setDescription('Token category')
                    .setRequired(true)
                    .addChoices(
                        ...Object.entries(TokenCategory).map(([name, value]) => ({
                            name,
                            value
                        }))))
            .addStringOption(option =>
                option.setName('note')
                    .setDescription('Additional notes about the token')
                    .setRequired(false))
            .addBooleanOption(option =>
                option.setName('community')
                    .setDescription('Is this a community token?')
                    .setRequired(false)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('remove')
            .setDescription('Remove a token from the hot list')
            .addStringOption(option =>
                option.setName('contract')
                    .setDescription('Token contract address')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('update')
            .setDescription('Update token information')
            .addStringOption(option =>
                option.setName('contract')
                    .setDescription('Token contract address')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('name')
                    .setDescription('New token name')
                    .setRequired(false))
            .addStringOption(option =>
                option.setName('category')
                    .setDescription('New token category')
                    .setRequired(false)
                    .addChoices(
                        ...Object.entries(TokenCategory).map(([name, value]) => ({
                            name,
                            value
                        }))))
            .addStringOption(option =>
                option.setName('note')
                    .setDescription('New note')
                    .setRequired(false))
            .addBooleanOption(option =>
                option.setName('community')
                    .setDescription('Is this a community token?')
                    .setRequired(false)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('note')
            .setDescription('Add or update a note for a token')
            .addStringOption(option =>
                option.setName('contract')
                    .setDescription('Token contract address')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('note')
                    .setDescription('Note to add')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('list')
            .setDescription('Show the hot tokens list')
            .addStringOption(option =>
                option.setName('category')
                    .setDescription('Filter by category')
                    .setRequired(false)
                    .addChoices(
                        ...Object.entries(TokenCategory).map(([name, value]) => ({
                            name,
                            value
                        }))))
            .addBooleanOption(option =>
                option.setName('community')
                    .setDescription('Show only community tokens')
                    .setRequired(false)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('price')
            .setDescription('Get current price and stats for a token')
            .addStringOption(option =>
                option.setName('contract')
                    .setDescription('Token contract address')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('trending')
            .setDescription('Show top performing tokens from the list')
            .addStringOption(option =>
                option.setName('timeframe')
                    .setDescription('Time period to check')
                    .setRequired(false)
                    .addChoices(
                        { name: '1h', value: '1h' },
                        { name: '24h', value: '24h' },
                        { name: '7d', value: '7d' },
                        { name: '30d', value: '30d' }
                    )))
    .addSubcommand(subcommand =>
        subcommand
            .setName('alert')
            .setDescription('Set price alert for a token')
            .addStringOption(option =>
                option.setName('contract')
                    .setDescription('Token contract address')
                    .setRequired(true))
            .addNumberOption(option =>
                option.setName('target')
                    .setDescription('Target price (in USD)')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('condition')
                    .setDescription('Alert condition')
                    .setRequired(true)
                    .addChoices(
                        { name: 'above', value: 'above' },
                        { name: 'below', value: 'below' }
                    )))
    .addSubcommand(subcommand =>
        subcommand
            .setName('help')
            .setDescription('Show hot tokens commands and tips'));

export function getHotTokensHelpMenu(): string {
    return `🔥 **Hot Tokens Tracking System** 🔥

Track and manage potentially interesting tokens with the community.

**Quick Commands:**
⚡ **/ht add** - Found a promising token? Add it!
  Example: /ht add name:PEPE contract:0x123 category:MEME note:"Trending on CT, high volume"

🔍 **/ht list** - View & Filter Tokens
  • By Category: /ht list category:DEFI
  • Community Picks: /ht list community:true
  • All Tokens: /ht list

✏️ **/ht note** - Share insights about a token
  Example: /ht note contract:0x123 note:"Volume spiking, new listings coming"

🔄 **/ht update** - Update token details
  Example: /ht update contract:0x123 category:DEFI note:"Moving from meme to DeFi"

❌ **/ht remove** - Remove outdated tokens
  Example: /ht remove contract:0x123

📊 **Categories & Their Meaning:**
• MEME 🐕 - Meme tokens, social tokens
• DEFI 💎 - DeFi protocols, yield platforms
• GAMING 🎮 - Gaming, metaverse, NFT projects
• LAYER1 ⛓️ - Base layer blockchains
• LAYER2 ⚡ - Scaling solutions, rollups
• INFRASTRUCTURE 🏗️ - Dev tools, oracles, bridges
• AI 🤖 - AI-related crypto projects
• OTHER 🔮 - Unique or multi-category projects

💡 **Tips:**
• Use notes to share alpha, warnings, or important updates
• Mark community-discovered tokens with community:true
• Check /ht list regularly for new additions
• Share insights by updating token notes`;
}

export async function handleHotTokensCommand(interaction: ChatInputCommandInteraction, hotTokensService: HotTokensService) {
    try {
        switch (interaction.options.getSubcommand()) {
            case 'help': {
                await interaction.reply({
                    content: getHotTokensHelpMenu(),
                    ephemeral: true
                });
                break;
            }
            
            case 'add': {
                const name = interaction.options.getString('name', true);
                const contractAddress = interaction.options.getString('contract', true);
                const category = interaction.options.getString('category', true) as TokenCategory;
                const note = interaction.options.getString('note');
                const isCommunity = interaction.options.getBoolean('community') || false;

                await hotTokensService.addToken({
                    name,
                    contractAddress,
                    category,
                    note: note ?? null,
                    isCommunity,
                    marketCapNow: null,
                    marketCapFirstEntry: null,
                    meta: null
                });

                await interaction.reply({ 
                    content: `✅ Added ${name} to hot tokens list! 🔥`,
                    ephemeral: true 
                });
                break;
            }

            case 'remove': {
                const contractAddress = interaction.options.getString('contract', true);
                const removed = await hotTokensService.removeToken(contractAddress);
                
                if (!removed) {
                    await interaction.reply({ 
                        content: '❌ Token not found in hot list!',
                        ephemeral: true 
                    });
                    return;
                }

                await interaction.reply({ 
                    content: '✅ Token removed from hot list! 🔥',
                    ephemeral: true 
                });
                break;
            }

            case 'update': {
                const contractAddress = interaction.options.getString('contract', true);
                const name = interaction.options.getString('name') || undefined;
                const category = (interaction.options.getString('category') || undefined) as TokenCategory | undefined;
                const note = interaction.options.getString('note') || undefined;
                const isCommunity = interaction.options.getBoolean('community') ?? undefined;

                const update = {
                    ...(name && { name }),
                    ...(category && { category }),
                    ...(note && { note }),
                    ...(isCommunity !== undefined && { isCommunity })
                };

                const updated = await hotTokensService.updateToken(contractAddress, update);
                
                if (!updated) {
                    await interaction.reply({ 
                        content: '❌ Token not found in hot list!',
                        ephemeral: true 
                    });
                    return;
                }

                await interaction.reply({ 
                    content: '✅ Token updated successfully! 🔥',
                    ephemeral: true 
                });
                break;
            }

            case 'note': {
                const contractAddress = interaction.options.getString('contract', true);
                const note = interaction.options.getString('note', true);
                
                const updated = await hotTokensService.addNote(contractAddress, note);
                
                if (!updated) {
                    await interaction.reply({ 
                        content: '❌ Token not found in hot list!',
                        ephemeral: true 
                    });
                    return;
                }

                await interaction.reply({ 
                    content: '✅ Note added successfully! 📝',
                    ephemeral: true 
                });
                break;
            }

            case 'list': {
                const category = (interaction.options.getString('category') || undefined) as TokenCategory | undefined;
                const communityOnly = interaction.options.getBoolean('community') ?? undefined;

                const tokens = await hotTokensService.listTokens({ category, communityOnly });
                const embed = await hotTokensService.createListEmbed(tokens);
                
                await interaction.reply({ embeds: [embed] });
                break;
            }

            case 'price': {
                const contractAddress = interaction.options.getString('contract', true);
                const priceData = await hotTokensService.getTokenPrice(contractAddress);
                
                if (!priceData) {
                    await interaction.reply({ 
                        content: '❌ Unable to fetch price data for the token.',
                        ephemeral: true 
                    });
                    return;
                }

                const embed = await hotTokensService.createPriceEmbed(priceData);
                
                await interaction.reply({ embeds: [embed] });
                break;
            }

            case 'trending': {
                const timeframe = interaction.options.getString('timeframe') as '7d' | '1h' | '24h' | '30d';
                const topTokens = await hotTokensService.getTopPerformingTokens(timeframe);
                
                if (!topTokens.length) {
                    await interaction.reply({ 
                        content: '❌ No tokens found in the specified timeframe.',
                        ephemeral: true 
                    });
                    return;
                }

                const embed = await hotTokensService.createTrendingEmbed(topTokens);
                
                await interaction.reply({ embeds: [embed] });
                break;
            }

            case 'alert': {
                const contractAddress = interaction.options.getString('contract', true);
                const targetPrice = interaction.options.getNumber('target', true);
                const condition = interaction.options.getString('condition', true) as 'above' | 'below';
                
                const alert = await hotTokensService.setPriceAlert(contractAddress, targetPrice, condition, interaction.user.id);
                
                if (!alert) {
                    await interaction.reply({ 
                        content: '❌ Unable to set price alert for the token.',
                        ephemeral: true 
                    });
                    return;
                }

                await interaction.reply({ 
                    content: '✅ Price alert set successfully! 🔔',
                    ephemeral: true 
                });
                break;
            }
        }
    } catch (error) {
        console.error('Error handling hot tokens command:', error);
        await interaction.reply({ 
            content: '❌ An error occurred while processing your request.',
            ephemeral: true 
        });
    }
} 