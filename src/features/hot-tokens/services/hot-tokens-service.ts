import { PrismaClient, TokenCategory, Prisma } from '@prisma/client';
import { HotToken, TokenUpdate, TokenListOptions } from '../types/token.js';
import { EmbedBuilder } from 'discord.js';
import { PriceTrackingService } from './price-tracking-service.js';

// Import TokenPrice type from price-tracking-service
import type { TokenPrice } from './price-tracking-service.js';

export class HotTokensService {
    private priceTrackingService: PriceTrackingService;

    constructor(private readonly prisma: PrismaClient) {
        this.priceTrackingService = new PriceTrackingService(prisma);
    }

    async addToken(token: Omit<HotToken, 'id' | 'firstSeen'>): Promise<HotToken> {
        const result = await this.prisma.hotToken.create({
            data: {
                name: token.name,
                contractAddress: token.contractAddress,
                note: token.note ?? null,
                marketCapNow: token.marketCapNow ?? null,
                marketCapFirstEntry: token.marketCapFirstEntry ?? null,
                category: token.category,
                tags: token.tags ? token.tags : Prisma.JsonNull,
                meta: token.meta === null ? Prisma.JsonNull : token.meta,
                isCommunity: token.isCommunity
            }
        });
        return this.mapToHotToken(result);
    }

    async removeToken(contractAddress: string): Promise<boolean> {
        try {
            await this.prisma.hotToken.delete({
                where: { contractAddress }
            });
            return true;
        } catch {
            return false;
        }
    }

    async updateToken(contractAddress: string, update: TokenUpdate): Promise<boolean> {
        try {
            await this.prisma.hotToken.update({
                where: { contractAddress },
                data: {
                    ...update,
                    tags: update.tags ? update.tags : undefined,
                    meta: update.meta === null ? Prisma.JsonNull : update.meta
                }
            });
            return true;
        } catch {
            return false;
        }
    }

    async addNote(contractAddress: string, note: string): Promise<boolean> {
        try {
            await this.prisma.hotToken.update({
                where: { contractAddress },
                data: { note }
            });
            return true;
        } catch {
            return false;
        }
    }

    async listTokens(options: TokenListOptions = {}): Promise<HotToken[]> {
        const tokens = await this.prisma.hotToken.findMany({
            where: {
                ...(options.category ? { category: options.category } : {}),
                ...(options.communityOnly ? { isCommunity: true } : {})
            },
            orderBy: { firstSeen: 'desc' }
        });
        return tokens.map(this.mapToHotToken);
    }

    private mapToHotToken(token: Prisma.HotTokenGetPayload<{}>): HotToken {
        return {
            ...token,
            category: token.category as TokenCategory,
            tags: token.tags ? (token.tags as string[]) : null
        };
    }

    async getTokenPrice(contractAddress: string) {
        return this.priceTrackingService.getTokenPrice(contractAddress);
    }

    async getTopPerformingTokens(timeframe: '1h' | '24h' | '7d' | '30d' = '24h') {
        return this.priceTrackingService.getTopPerformingTokens(timeframe);
    }

    async getTrendingTokens(chainId: string = 'solana', timeframe: '1h' | '24h' | '7d' | '30d' = '24h') {
        return this.priceTrackingService.getTrendingTokens(chainId, timeframe);
    }

    async setPriceAlert(contractAddress: string, targetPrice: number, condition: 'above' | 'below', userId: string) {
        return this.priceTrackingService.setPriceAlert(contractAddress, targetPrice, condition, userId);
    }

    async createPriceEmbed(price: any) {
        return this.priceTrackingService.createPriceEmbed(price);
    }

    async createTrendingEmbed(tokens: TokenPrice[], isWatchlist: boolean = false, chainId?: string) {
        const title = isWatchlist ? '🔥 Top Performing Watchlist Tokens' : '🔥 Trending Tokens';
        const description = isWatchlist 
            ? 'Top performing tokens from your watchlist' 
            : `Currently trending tokens${chainId ? ` on ${this.formatChainName(chainId)}` : ''}`;
            
        return this.priceTrackingService.createTrendingEmbed(tokens, title, description);
    }

    private formatChainName(chainId: string): string {
        const chainNames: Record<string, string> = {
            'solana': 'Solana',
            'ethereum': 'Ethereum',
            'bsc': 'Binance Smart Chain',
            'polygon': 'Polygon',
            'arbitrum': 'Arbitrum',
            'avalanche': 'Avalanche'
        };
        
        return chainNames[chainId] || chainId;
    }

    async createListEmbed(tokens: HotToken[]): Promise<EmbedBuilder> {
        const embed = new EmbedBuilder()
            .setTitle('🔥 Hot Tokens List')
            .setColor('#FF6B6B')
            .setDescription(`Total tokens: ${tokens.length}`)
            .setTimestamp();

        if (tokens.length === 0) {
            embed.addFields({ name: 'No tokens found', value: 'Add some tokens with `/ht add`!' });
        } else {
            const tokenList = await Promise.all(tokens.map(async (token, index) => {
                const categoryEmoji = this.getCategoryEmoji(token.category);
                const price = await this.getTokenPrice(token.contractAddress);
                
                // Format market caps with proper formatting
                const marketCapNow = token.marketCapNow 
                    ? `$${this.formatLargeNumber(token.marketCapNow)}`
                    : 'N/A';
                
                const marketCapFirstEntry = token.marketCapFirstEntry
                    ? `$${this.formatLargeNumber(token.marketCapFirstEntry)}`
                    : 'N/A';
                
                // Calculate growth percentage if both values exist
                let growthPercentage = '';
                if (token.marketCapNow && token.marketCapFirstEntry && token.marketCapFirstEntry > 0) {
                    const growth = ((token.marketCapNow - token.marketCapFirstEntry) / token.marketCapFirstEntry) * 100;
                    growthPercentage = ` (${growth > 0 ? '+' : ''}${growth.toFixed(2)}%)`;
                }
                
                let priceInfo = '';
                if (price) {
                    priceInfo = `\n   💰 **Price:** $${price.currentPrice.toFixed(7)}` +
                               `\n   📈 **24h Change:** ${price.priceChange['24h'].toFixed(2)}%` +
                               `\n   💧 **Liquidity:** $${price.liquidity.toLocaleString()}`;
                }

                return `**${index + 1}. ${categoryEmoji} ${token.name}** (${token.category})` +
                       `\n   📝 **Contract:** \`${token.contractAddress}\`` +
                       `${priceInfo}` +
                       `\n   📊 **Current Market Cap:** ${marketCapNow}` +
                       `\n   🚀 **Initial Market Cap:** ${marketCapFirstEntry}${growthPercentage}` +
                       (token.note ? `\n   📌 **Note:** ${token.note}` : '');
            }));
            
            embed.addFields({ name: 'Tokens', value: tokenList.join('\n\n') });
        }

        return embed;
    }

    // Helper method to format large numbers with K, M, B suffixes
    private formatLargeNumber(num: number): string {
        if (num >= 1_000_000_000) {
            return (num / 1_000_000_000).toFixed(2) + 'B';
        } else if (num >= 1_000_000) {
            return (num / 1_000_000).toFixed(2) + 'M';
        } else if (num >= 1_000) {
            return (num / 1_000).toFixed(2) + 'K';
        } else {
            return num.toLocaleString();
        }
    }

    private getCategoryEmoji(category: TokenCategory): string {
        const emojis: Record<TokenCategory, string> = {
            [TokenCategory.MEME]: '🐕',
            [TokenCategory.DEFI]: '💎',
            [TokenCategory.GAMING]: '🎮',
            [TokenCategory.LAYER1]: '⛓️',
            [TokenCategory.LAYER2]: '⚡',
            [TokenCategory.INFRASTRUCTURE]: '🏗️',
            [TokenCategory.AI]: '🤖',
            [TokenCategory.OTHER]: '🔮'
        };
        return emojis[category];
    }
} 