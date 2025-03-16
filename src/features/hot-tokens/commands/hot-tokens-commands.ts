import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { HotTokensService } from '../services/hot-tokens-service.js';
import { TokenCategory } from '../types/token-category.js';
import { PriceTrackingService } from '../services/price-tracking-service.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const hotTokensCommands = new SlashCommandBuilder()
    .setName('ht')
    .setDescription('Manage hot tokens list')
    .addSubcommand(subcommand =>
        subcommand
            .setName('add')
            .setDescription('Add a new token to the hot list')
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
                option.setName('name')
                    .setDescription('Token name (optional, will auto-fetch if not provided)')
                    .setRequired(false))
            .addStringOption(option =>
                option.setName('note')
                    .setDescription('Additional notes about the token')
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
            .setDescription('Show hot tokens commands and tips'))
    .addSubcommand(subcommand =>
        subcommand
            .setName('debug')
            .setDescription('Debug token price fetching')
            .addStringOption(option =>
                option.setName('contract')
                    .setDescription('Token contract address or "test" for known tokens')
                    .setRequired(true)));

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
        const subcommand = interaction.options.getSubcommand();
        
        switch (subcommand) {
            case 'help': {
                await interaction.reply({
                    content: getHotTokensHelpMenu(),
                    ephemeral: true
                });
                break;
            }
            
            case 'add': {
                await interaction.deferReply({ ephemeral: true });
                
                const contractAddress = interaction.options.getString('contract', true);
                const providedName = interaction.options.getString('name');
                const category = interaction.options.getString('category') as TokenCategory || 'UNKNOWN';
                const note = interaction.options.getString('note') || '';
                
                try {
                    // First fetch the token data to get name and details
                    const priceTrackingService = new PriceTrackingService(prisma);
                    const priceData = await priceTrackingService.getTokenPrice(contractAddress);
                    
                    if (!priceData && !providedName) {
                        await interaction.editReply(`❌ Could not fetch token data and no name was provided. Please provide a name or try again later.`);
                        return;
                    }
                    
                    // Use provided name or fetched name
                    const name = providedName || priceData?.name || 'Unknown Token';
                    
                    // Add the token to the database
                    const token = await hotTokensService.addToken({
                        contractAddress,
                        name,
                        category,
                        note: note || null,
                        isCommunity: false,
                        marketCapNow: priceData?.marketCap || null,
                        marketCapFirstEntry: priceData?.marketCap || null,
                        meta: null
                    });
                    
                    let responseMessage = `✅ Added **${name}** to the hot tokens list!`;
                    
                    if (priceData) {
                        responseMessage += `\n\n**Current Data:**\n`;
                        responseMessage += `💰 Price: $${priceData.currentPrice.toFixed(8)}\n`;
                        responseMessage += `📊 Market Cap: $${priceData.marketCap.toLocaleString()}\n`;
                        responseMessage += `💧 Liquidity: $${priceData.liquidity.toLocaleString()}\n`;
                        responseMessage += `📈 24h Change: ${priceData.priceChange['24h'].toFixed(2)}%`;
                    } else {
                        responseMessage += `\n\n⚠️ Could not fetch price data for this token.`;
                    }
                    
                    await interaction.editReply(responseMessage);
                } catch (error) {
                    console.error('Error adding token:', error);
                    await interaction.editReply(`❌ Failed to add token: ${(error as Error).message}`);
                }
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
                await interaction.deferReply({ ephemeral: true });
                const tokens = await prisma.hotToken.findMany({
                    orderBy: { id: 'desc' }
                });
                
                if (tokens.length === 0) {
                    await interaction.editReply('No tokens in the hot list yet.');
                    return;
                }
                
                const priceTrackingService = new PriceTrackingService(prisma);
                
                // Fetch current prices for all tokens
                const tokenPrices = await Promise.all(
                    tokens.map(async (token) => {
                        const price = await priceTrackingService.getTokenPrice(token.contractAddress);
                        return { token, price };
                    })
                );
                
                let response = `## 🔥 Hot Tokens List\n\nTotal tokens: ${tokens.length}\n\n### Tokens\n`;
                
                tokenPrices.forEach((item, index) => {
                    const { token, price } = item;
                    
                    // Format market cap values
                    const initialMC = token.marketCapFirstEntry !== null 
                        ? `$${token.marketCapFirstEntry.toLocaleString()}`
                        : 'N/A';
                    
                    const currentMC = token.marketCapNow !== null 
                        ? `$${token.marketCapNow.toLocaleString()}`
                        : 'N/A';
                    
                    // Calculate market cap change if both values exist
                    let mcChangeText = '';
                    if (token.marketCapFirstEntry !== null && token.marketCapNow !== null && token.marketCapFirstEntry > 0) {
                        const mcChange = ((token.marketCapNow - token.marketCapFirstEntry) / token.marketCapFirstEntry) * 100;
                        const changeEmoji = mcChange >= 0 ? '📈' : '📉';
                        mcChangeText = ` ${changeEmoji} ${mcChange.toFixed(2)}%`;
                    }
                    
                    // Current price from API
                    const currentPrice = price ? `$${price.currentPrice.toFixed(8)}` : 'N/A';
                    
                    response += `**${index + 1}. ${token.name}** (${token.category})\n`;
                    response += `📝 Contract: \`${token.contractAddress}\`\n`;
                    response += `💰 Current Price: ${currentPrice}\n`;
                    response += `📊 Initial Market Cap: ${initialMC}\n`;
                    response += `📈 Current Market Cap: ${currentMC}${mcChangeText}\n`;
                    
                    if (token.note) {
                        response += `📝 Note: ${token.note}\n`;
                    }
                    
                    response += '\n';
                });
                
                await interaction.editReply(response);
                break;
            }

            case 'price': {
                await interaction.deferReply();
                const contractAddress = interaction.options.getString('contract', true);
                
                const priceTrackingService = new PriceTrackingService(prisma);
                const priceData = await priceTrackingService.getTokenPrice(contractAddress);
                
                if (!priceData) {
                    await interaction.editReply('❌ Unable to fetch price data for the token.');
                    return;
                }

                // Create a rich embed with token details
                const embed = priceTrackingService.createPriceEmbed(priceData);
                
                // Create a formatted message with token details
                let message = '';
                
                // Add token name and symbol
                message += `# ${priceData.name} (${priceData.symbol})\n\n`;
                
                // Add price and market data
                message += `💰 **Price:** $${priceData.currentPrice.toFixed(8)}\n`;
                message += `📊 **Market Cap:** $${priceData.marketCap.toLocaleString()}\n`;
                message += `💧 **Liquidity:** $${priceData.liquidity.toLocaleString()}\n`;
                message += `📈 **24h Volume:** $${priceData.volume24h.toLocaleString()}\n\n`;
                
                // Add price changes
                message += `## Price Changes\n`;
                message += `1h: ${priceData.priceChange['1h'] >= 0 ? '🟢' : '🔴'} ${priceData.priceChange['1h'].toFixed(2)}%\n`;
                message += `24h: ${priceData.priceChange['24h'] >= 0 ? '🟢' : '🔴'} ${priceData.priceChange['24h'].toFixed(2)}%\n`;
                message += `7d: ${priceData.priceChange['7d'] >= 0 ? '🟢' : '🔴'} ${priceData.priceChange['7d'].toFixed(2)}%\n`;
                message += `30d: ${priceData.priceChange['30d'] >= 0 ? '🟢' : '🔴'} ${priceData.priceChange['30d'].toFixed(2)}%\n\n`;
                
                // Add contract and DEX info
                message += `## Token Info\n`;
                message += `📝 **Contract:** \`${priceData.contractAddress}\`\n`;
                message += `🔄 **DEX:** ${priceData.dexId.toUpperCase()}\n`;
                message += `🔗 **Pair:** \`${priceData.pairAddress}\`\n\n`;
                
                // Add description if available
                if (priceData.profile?.description) {
                    message += `## Description\n${priceData.profile.description}\n\n`;
                }
                
                // Add links if available
                if (priceData.profile?.links && priceData.profile.links.length > 0) {
                    message += `## Links\n`;
                    priceData.profile.links.forEach(link => {
                        message += `- [${link.label || link.type}](${link.url})\n`;
                    });
                }
                
                await interaction.editReply({ content: message, embeds: [embed] });
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

            case 'debug': {
                await interaction.deferReply({ ephemeral: true });
                const contractAddress = interaction.options.getString('contract', true);
                
                const priceTrackingService = new PriceTrackingService(prisma);
                const priceData = await priceTrackingService.getTokenPrice(contractAddress);
                
                let response = `## 🔍 Debug Results for ${contractAddress}\n\n`;
                
                if (priceData) {
                    response += `✅ **Successfully fetched data!**\n\n`;
                    response += `**Token Details:**\n`;
                    response += `- Name: ${priceData.name}\n`;
                    response += `- Symbol: ${priceData.symbol}\n`;
                    response += `- Price: $${priceData.currentPrice.toFixed(8)}\n`;
                    response += `- Market Cap: $${priceData.marketCap.toLocaleString()}\n`;
                    response += `- Liquidity: $${priceData.liquidity.toLocaleString()}\n`;
                    response += `- 24h Change: ${priceData.priceChange['24h'].toFixed(2)}%\n`;
                    response += `- DEX: ${priceData.dexId}\n`;
                    response += `- Pair Address: ${priceData.pairAddress}\n`;
                } else {
                    response += `❌ **Failed to fetch data**\n\n`;
                    response += `Please check the console logs for detailed error information.`;
                }
                
                await interaction.editReply(response);
                break;
            }
        }
    } catch (error) {
        console.error('Error handling hot tokens command:', error);
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply('An error occurred while processing your command.');
            } else {
                await interaction.reply({ content: 'An error occurred while processing your command.', ephemeral: true });
            }
        } catch (replyError) {
            console.error('Error handling slash command:', replyError);
        }
    }
} 