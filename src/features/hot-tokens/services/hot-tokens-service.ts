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
            .setColor('#FC46AA')
            .setDescription(`Total tokens: ${tokens.length}`)
            .setTimestamp();

        if (tokens.length === 0) {
            embed.addFields({ name: 'No tokens found', value: 'Add some tokens with `/ht add`!' });
        } else {
            // Process each token individually
            for (const [index, token] of tokens.entries()) {
                const categoryEmoji = this.getCategoryEmoji(token.category);
                const price = await this.getTokenPrice(token.contractAddress);
                
                const marketCapNow = token.marketCapNow 
                    ? `$${this.formatLargeNumber(token.marketCapNow)}`
                    : 'N/A';
                
                const marketCapFirstEntry = token.marketCapFirstEntry
                    ? `$${this.formatLargeNumber(token.marketCapFirstEntry)}`
                    : 'N/A';
                
                let growthPercentage = '';
                if (token.marketCapNow && token.marketCapFirstEntry && token.marketCapFirstEntry > 0) {
                    const growth = ((token.marketCapNow - token.marketCapFirstEntry) / token.marketCapFirstEntry) * 100;
                    growthPercentage = ` (${growth > 0 ? '+' : ''}${growth.toFixed(2)}%)`;
                }
                
                const firstSeen = this.formatTimeAgo(token.firstSeen);
                
                let priceInfo = '';
                let links = '';
                const linkArr = [];
                
                if (price) {
                    priceInfo = `\n   💰 **Price:** $${price.currentPrice.toFixed(7)}` +
                               `\n   📈 **24h Change:** ${price.priceChange['24h'].toFixed(2)}%` +
                               `\n   💧 **Liquidity:** $${price.liquidity.toLocaleString()}`;
                }

                if (price?.url) {
                    linkArr.push(`[📊](${price.url})`);
                }
                if (price?.links) {
                    for (const link of (price.links as Array<{ type: string; url: string }>)) {
                        switch(link.type.toLowerCase()) {
                            case 'website':
                                linkArr.push(`[🌐](${link.url})`);
                                break;
                            case 'twitter':
                            case 'x':
                                linkArr.push(`[𝕏](${link.url})`);
                                break;
                            case 'telegram':
                                linkArr.push(`[💬](${link.url})`);
                                break;
                        }
                    }
                }
                if (linkArr.length > 0) {
                    links = `\n   🔗 **Links:** ${linkArr.join(' ')}`;
                }

                const content = `**${index + 1}. ${categoryEmoji} ${token.name} ${price?.symbol ? `($${price.symbol})` : ''}**` +
                               `\n   ⌛ **First seen:** ${firstSeen}` +
                               `\n   📋 **Category:** [${token.category}]` +
                               `\n   📊 **Current MC:** ${marketCapNow}` +
                               `\n   🚀 **Initial MC:** ${marketCapFirstEntry}${growthPercentage}` +
                               `\n   📈 **24h Change:** ${price?.priceChange['24h'].toFixed(2)}%` +
                               `\n   💰 **Price:** $${price?.currentPrice.toFixed(7)}` +
                               `\n   💧 **Liquidity:** $${price?.liquidity.toLocaleString()}` +
                               `\n   📝 **Contract:** \`${token.contractAddress}\`` +
                               `${links}` +
                               (token.note ? `\n   📌 **Note:** ${token.note}` : '');

                embed.addFields({ 
                    name: index === 0 ? 'Tokens' : '‎',  // Use zero-width space for empty names
                    value: content,
                    inline: false 
                });
            }
        }

        return embed;
    }

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

    private formatTimeAgo(date: Date): string {
        const now = new Date();
        const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
        
        if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
        const diffInMinutes = Math.floor(diffInSeconds / 60);
        if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
        const diffInHours = Math.floor(diffInMinutes / 60);
        if (diffInHours < 24) return `${diffInHours}h ago`;
        const diffInDays = Math.floor(diffInHours / 24);
        if (diffInDays < 30) return `${diffInDays}d ago`;
        const diffInMonths = Math.floor(diffInDays / 30);
        if (diffInMonths < 12) return `${diffInMonths}mo ago`;
        return `${Math.floor(diffInMonths / 12)}y ago`;
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
