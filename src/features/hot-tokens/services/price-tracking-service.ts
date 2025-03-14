import { PrismaClient } from '@prisma/client';
import { EmbedBuilder } from 'discord.js';
import fetch from 'node-fetch';
import crypto from 'crypto';

interface TokenPrice {
    contractAddress: string;
    name: string;
    symbol: string;
    currentPrice: number;
    priceChange: {
        '1h': number;
        '24h': number;
        '7d': number;
        '30d': number;
    };
    volume24h: number;
    marketCap: number;
    lastUpdated: Date;
    pairAddress: string;
    dexId: string;
    liquidity: number;
}

interface PriceAlert {
    id: string;
    contractAddress: string;
    targetPrice: number;
    condition: 'above' | 'below';
    userId: string;
    createdAt: Date;
    triggered: boolean;
}

type ChainId = 'ethereum' | 'bsc' | 'polygon' | 'arbitrum' | 'optimism';

export class PriceTrackingService {
    private readonly DEXSCREENER_API = 'https://api.dexscreener.com';
    private readonly requestQueue: Array<() => Promise<void>> = [];
    private isProcessingQueue = false;
    private lastRequestTime = 0;
    // Rate limit: 300 requests per minute = 1 request per 200ms
    private readonly RATE_LIMIT_DELAY = 200;

    constructor(private readonly prisma: PrismaClient) {}

    private async enqueueRequest<T>(request: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.requestQueue.push(async () => {
                try {
                    const now = Date.now();
                    const timeSinceLastRequest = now - this.lastRequestTime;
                    if (timeSinceLastRequest < this.RATE_LIMIT_DELAY) {
                        await new Promise(r => setTimeout(r, this.RATE_LIMIT_DELAY - timeSinceLastRequest));
                    }
                    this.lastRequestTime = Date.now();
                    const result = await request();
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });

            if (!this.isProcessingQueue) {
                this.processQueue();
            }
        });
    }

    private async processQueue() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        while (this.requestQueue.length > 0) {
            const request = this.requestQueue.shift();
            if (request) {
                await request();
            }
        }

        this.isProcessingQueue = false;
    }

    private async detectChainId(contractAddress: string): Promise<ChainId> {
        // Simple chain detection based on contract address format
        // This should be expanded based on your needs
        if (contractAddress.startsWith('0x')) {
            return 'ethereum'; // Default to Ethereum for 0x addresses
        }
        throw new Error('Unsupported chain address format');
    }

    async getTokenPrice(contractAddress: string): Promise<TokenPrice | null> {
        try {
            const chainId = await this.detectChainId(contractAddress);
            const response = await this.enqueueRequest(() => 
                fetch(`${this.DEXSCREENER_API}/tokens/v1/${chainId}/${contractAddress}`)
            );

            if (!response.ok) {
                console.error(`DexScreener API error: ${response.status} ${response.statusText}`);
                return null;
            }

            const data = await response.json();
            const pairs = Array.isArray(data) ? data : [];

            if (pairs.length === 0) {
                console.warn(`No pairs found for token ${contractAddress}`);
                return null;
            }

            // Get the most liquid pair
            const pair = pairs.sort((a, b) => b.liquidity.usd - a.liquidity.usd)[0];

            return {
                contractAddress,
                name: pair.baseToken.name,
                symbol: pair.baseToken.symbol,
                currentPrice: parseFloat(pair.priceUsd),
                priceChange: {
                    '1h': pair.priceChange?.h1 || 0,
                    '24h': pair.priceChange?.h24 || 0,
                    '7d': pair.priceChange?.h7d || 0,
                    '30d': pair.priceChange?.h30d || 0
                },
                volume24h: pair.volume?.h24 || 0,
                marketCap: pair.marketCap || 0,
                lastUpdated: new Date(pair.pairCreatedAt),
                pairAddress: pair.pairAddress,
                dexId: pair.dexId,
                liquidity: pair.liquidity?.usd || 0
            };
        } catch (error) {
            console.error('Error fetching token price:', error);
            return null;
        }
    }

    async getTopPerformingTokens(timeframe: '1h' | '24h' | '7d' | '30d'): Promise<TokenPrice[]> {
        try {
            const tokens = await this.prisma.$queryRawUnsafe<Array<{ contractAddress: string; name: string }>>(
                'SELECT contractAddress, name FROM HotToken'
            );

            const prices = await Promise.all(
                tokens.map(token => this.getTokenPrice(token.contractAddress))
            );
            
            return prices
                .filter((price): price is TokenPrice => price !== null)
                .sort((a, b) => b.priceChange[timeframe] - a.priceChange[timeframe])
                .slice(0, 10);
        } catch (error) {
            console.error('Error getting top performing tokens:', error);
            return [];
        }
    }

    async setPriceAlert(contractAddress: string, targetPrice: number, condition: 'above' | 'below', userId: string): Promise<PriceAlert | null> {
        try {
            const alert: PriceAlert = {
                id: crypto.randomUUID(),
                contractAddress,
                targetPrice,
                condition,
                userId,
                createdAt: new Date(),
                triggered: false
            };

            await this.prisma.$executeRawUnsafe(
                'INSERT INTO PriceAlert (id, contractAddress, targetPrice, condition, userId, triggered, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
                alert.id,
                alert.contractAddress,
                alert.targetPrice,
                alert.condition,
                alert.userId,
                alert.triggered,
                alert.createdAt
            );

            return alert;
        } catch (error) {
            console.error('Error setting price alert:', error);
            return null;
        }
    }

    async checkPriceAlerts(): Promise<void> {
        try {
            const alerts = await this.prisma.$queryRawUnsafe<PriceAlert[]>(
                'SELECT * FROM PriceAlert WHERE triggered = false'
            );

            for (const alert of alerts) {
                const price = await this.getTokenPrice(alert.contractAddress);
                if (!price) continue;

                const shouldTrigger = 
                    (alert.condition === 'above' && price.currentPrice >= alert.targetPrice) ||
                    (alert.condition === 'below' && price.currentPrice <= alert.targetPrice);

                if (shouldTrigger) {
                    await this.triggerAlert(alert, price);
                }
            }
        } catch (error) {
            console.error('Error checking price alerts:', error);
        }
    }

    createPriceEmbed(price: TokenPrice | null): EmbedBuilder {
        if (!price) {
            return new EmbedBuilder()
                .setTitle('❌ Price Data Unavailable')
                .setColor('#ff0000')
                .setDescription('Unable to fetch price data for this token.')
                .setTimestamp();
        }

        return new EmbedBuilder()
            .setTitle(`💰 ${price.name} (${price.symbol}) Price Info`)
            .setColor('#00ff00')
            .addFields(
                { name: 'Price', value: `$${price.currentPrice.toFixed(8)}`, inline: true },
                { name: 'Liquidity', value: `$${price.liquidity.toLocaleString()}`, inline: true },
                { name: '24h Volume', value: `$${price.volume24h.toLocaleString()}`, inline: true },
                { name: 'Price Changes', value: 
                    `1h: ${price.priceChange['1h'].toFixed(2)}%\n` +
                    `24h: ${price.priceChange['24h'].toFixed(2)}%\n` +
                    `7d: ${price.priceChange['7d'].toFixed(2)}%\n` +
                    `30d: ${price.priceChange['30d'].toFixed(2)}%`
                },
                { name: 'DEX Info', value: 
                    `Exchange: ${price.dexId.toUpperCase()}\n` +
                    `Pair: \`${price.pairAddress}\``
                }
            )
            .setTimestamp()
            .setFooter({ text: 'Data from DexScreener' });
    }

    createTrendingEmbed(tokens: TokenPrice[]): EmbedBuilder {
        const embed = new EmbedBuilder()
            .setTitle('🔥 Trending Hot Tokens')
            .setColor('#ff6b6b')
            .setDescription(tokens.length ? 'Top performing tokens from your watchlist' : 'No token data available')
            .setTimestamp();

        tokens.forEach((token, index) => {
            embed.addFields({
                name: `${index + 1}. ${token.name} (${token.symbol})`,
                value: `💰 Price: $${token.currentPrice.toFixed(8)}\n` +
                       `📈 24h Change: ${token.priceChange['24h'].toFixed(2)}%\n` +
                       `💧 Liquidity: $${token.liquidity.toLocaleString()}\n` +
                       `📊 Volume: $${token.volume24h.toLocaleString()}`
            });
        });

        return embed;
    }

    private async triggerAlert(alert: PriceAlert, price: TokenPrice): Promise<void> {
        try {
            await this.prisma.$executeRawUnsafe(
                'UPDATE PriceAlert SET triggered = true WHERE id = ?',
                alert.id
            );

            // Here you would send a Discord notification to the user
            // This would require integration with your Discord notification system
            console.log(`Alert triggered for ${price.name} at $${price.currentPrice}`);
        } catch (error) {
            console.error('Error triggering alert:', error);
        }
    }
} 