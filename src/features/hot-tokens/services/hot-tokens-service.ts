import { PrismaClient, TokenCategory, Prisma } from '@prisma/client';
import { HotToken, TokenUpdate, TokenListOptions } from '../types/token.js';
import { EmbedBuilder } from 'discord.js';
import { PriceTrackingService } from './price-tracking-service.js';

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
            category: token.category as TokenCategory
        };
    }

    async getTokenPrice(contractAddress: string) {
        return this.priceTrackingService.getTokenPrice(contractAddress);
    }

    async getTopPerformingTokens(timeframe: '1h' | '24h' | '7d' | '30d') {
        return this.priceTrackingService.getTopPerformingTokens(timeframe);
    }

    async setPriceAlert(contractAddress: string, targetPrice: number, condition: 'above' | 'below', userId: string) {
        return this.priceTrackingService.setPriceAlert(contractAddress, targetPrice, condition, userId);
    }

    async createPriceEmbed(price: any) {
        return this.priceTrackingService.createPriceEmbed(price);
    }

    async createTrendingEmbed(tokens: any[]) {
        return this.priceTrackingService.createTrendingEmbed(tokens);
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
                
                let priceInfo = '';
                if (price) {
                    priceInfo = `\n   💰 $${price.currentPrice.toFixed(6)} (24h: ${price.priceChange['24h'].toFixed(2)}%)\n` +
                               `   💧 Liquidity: $${price.liquidity.toLocaleString()}\n` +
                               `   📊 Volume: $${price.volume24h.toLocaleString()}`;
                }

                return `${index + 1}. ${categoryEmoji} **${token.name}**\n   \`${token.contractAddress}\`${priceInfo}\n   ${token.category}`;
            }));
            
            embed.addFields({ name: 'Tokens', value: tokenList.join('\n\n') });
        }

        return embed;
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