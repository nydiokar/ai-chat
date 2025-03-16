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
    profile?: TokenProfile | null;
}

interface TokenProfile {
    url?: string;
    chainId?: string;
    tokenAddress?: string;
    icon?: string;
    header?: string;
    description?: string;
    links?: {
        type: string;
        label: string;
        url: string;
    }[];
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

type ChainId = 'solana';

export class PriceTrackingService {
    private readonly DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';
    private readonly DEXSCREENER_PROFILES_API = 'https://api.dexscreener.com/token-profiles/latest/v1';
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

    async getTokenPrice(contractAddress: string): Promise<TokenPrice | null> {
        try {
            console.log(`Fetching price for Solana token: ${contractAddress}`);
            
            // For testing purposes, try a known working Solana token
            if (contractAddress === 'test') {
                return await this.testKnownSolanaToken();
            }
            
            // Try different URL formats for Solana tokens - prioritize search endpoint
            const urls = [
                `${this.DEXSCREENER_API}/search?q=${contractAddress}`,
                `${this.DEXSCREENER_API}/tokens/${contractAddress}`,
                `${this.DEXSCREENER_API}/pairs/solana/${contractAddress}`
            ];
            
            console.log(`Testing API endpoints for ${contractAddress}`);
            
            for (const url of urls) {
                console.log(`Trying URL: ${url}`);
                
                const response = await this.enqueueRequest(() => fetch(url));
                
                if (!response.ok) {
                    console.error(`DexScreener API error for ${url}: ${response.status} ${response.statusText}`);
                    continue;
                }
                
                const data = await response.json();
                
                if (url.includes('/search')) {
                    if (!data.pairs || data.pairs.length === 0) {
                        console.warn(`No search results found for token ${contractAddress}`);
                        continue;
                    }
                    
                    // Filter for Solana pairs
                    const solanaPairs = data.pairs.filter((pair: any) => pair.chainId === 'solana');
                    if (solanaPairs.length === 0) {
                        console.warn(`No Solana pairs found in search results for ${contractAddress}`);
                        continue;
                    }
                    
                    console.log(`Found ${solanaPairs.length} Solana pairs for ${contractAddress} using search`);
                    const tokenPrice = await this.processTokenPriceData({ pairs: solanaPairs }, contractAddress);
                    
                    // Fetch token profile if price data was found
                    if (tokenPrice) {
                        tokenPrice.profile = await this.getTokenProfile(contractAddress);
                    }
                    
                    return tokenPrice;
                } else if (url.includes('/tokens/') || url.includes('/pairs/')) {
                    if (!data.pairs || data.pairs.length === 0) {
                        console.warn(`No pairs found for token ${contractAddress} using ${url}`);
                        continue;
                    }
                    
                    console.log(`Found token ${contractAddress} with ${data.pairs.length} pairs using ${url}`);
                    const tokenPrice = await this.processTokenPriceData(data, contractAddress);
                    
                    // Fetch token profile if price data was found
                    if (tokenPrice) {
                        tokenPrice.profile = await this.getTokenProfile(contractAddress);
                    }
                    
                    return tokenPrice;
                }
            }
            
            console.error(`All API endpoints failed for token ${contractAddress}`);
            return null;
        } catch (error) {
            console.error('Error fetching token price:', error);
            return null;
        }
    }
    
    private async processTokenPriceData(data: any, contractAddress: string): Promise<TokenPrice | null> {
        try {
            // Get the most liquid pair
            const pair = data.pairs.sort((a: any, b: any) => 
                (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
            )[0];

            if (!pair) {
                console.warn(`No valid pair data found for ${contractAddress}`);
                return null;
            }

            const marketCap = pair.marketCap || 0;
            console.log(`Processing token data for ${contractAddress}:`, {
                name: pair.baseToken?.name || 'Unknown',
                symbol: pair.baseToken?.symbol || 'Unknown',
                price: pair.priceUsd || 'Unknown',
                marketCap: marketCap
            });

            // Update marketCap in the database
            if (marketCap > 0) {
                try {
                    // Check if the token exists
                    const token = await this.prisma.hotToken.findUnique({
                        where: { contractAddress }
                    });
                    
                    if (token) {
                        console.log(`Token found in database: ${contractAddress}`);
                        
                        // If this is the first time we're getting market cap data
                        if (token.marketCapFirstEntry === null) {
                            console.log(`Setting initial market cap for ${contractAddress} to ${marketCap}`);
                            await this.prisma.hotToken.update({
                                where: { contractAddress },
                                data: { 
                                    marketCapFirstEntry: marketCap,
                                    marketCapNow: marketCap
                                }
                            });
                        } else {
                            // Just update the current market cap
                            console.log(`Updating current market cap for ${contractAddress} from ${token.marketCapNow} to ${marketCap}`);
                            await this.prisma.hotToken.update({
                                where: { contractAddress },
                                data: { marketCapNow: marketCap }
                            });
                        }
                    } else {
                        console.warn(`Token ${contractAddress} not found in database, cannot update market cap`);
                    }
                } catch (error) {
                    console.error('Error updating market cap:', error);
                }
            } else {
                console.warn(`No market cap data available for ${contractAddress}`);
            }

            return {
                contractAddress,
                name: pair.baseToken?.name || 'Unknown',
                symbol: pair.baseToken?.symbol || 'Unknown',
                currentPrice: parseFloat(pair.priceUsd) || 0,
                priceChange: {
                    '1h': pair.priceChange?.h1 || 0,
                    '24h': pair.priceChange?.h24 || 0,
                    '7d': pair.priceChange?.d7 || 0,
                    '30d': pair.priceChange?.d30 || 0
                },
                volume24h: pair.volume?.h24 || 0,
                marketCap: marketCap,
                lastUpdated: new Date(pair.pairCreatedAt || Date.now()),
                pairAddress: pair.pairAddress || '',
                dexId: pair.dexId || '',
                liquidity: pair.liquidity?.usd || 0
            };
        } catch (error) {
            console.error(`Error processing token price data for ${contractAddress}:`, error);
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

        const embed = new EmbedBuilder()
            .setTitle(`💰 ${price.name} (${price.symbol}) Price Info`)
            .setColor('#00ff00')
            .setTimestamp()
            .setFooter({ text: 'Data from DexScreener' });
            
        // Add token icon if available
        if (price.profile?.icon) {
            embed.setThumbnail(price.profile.icon);
        }
        
        // Add header image if available
        if (price.profile?.header) {
            embed.setImage(price.profile.header);
        }
        
        // Add description if available
        if (price.profile?.description) {
            embed.setDescription(price.profile.description);
        }
        
        // Add price and market data fields
        embed.addFields(
            { name: 'Price', value: `$${price.currentPrice.toFixed(8)}`, inline: true },
            { name: 'Liquidity', value: `$${price.liquidity.toLocaleString()}`, inline: true },
            { name: '24h Volume', value: `$${price.volume24h.toLocaleString()}`, inline: true },
            { name: 'Price Changes', value: 
                `1h: ${price.priceChange['1h'].toFixed(2)}%\n` +
                `24h: ${price.priceChange['24h'].toFixed(2)}%\n` +
                `7d: ${price.priceChange['7d'].toFixed(2)}%\n` +
                `30d: ${price.priceChange['30d'].toFixed(2)}%`
            },
            { name: 'Market Cap', value: `$${price.marketCap.toLocaleString()}`, inline: true },
            { name: 'DEX Info', value: 
                `Exchange: ${price.dexId.toUpperCase()}\n` +
                `Pair: \`${price.pairAddress}\``
            }
        );
        
        // Add links if available
        if (price.profile?.links && price.profile.links.length > 0) {
            const linksList = price.profile.links
                .map(link => `[${link.label || link.type}](${link.url})`)
                .join(' | ');
            
            embed.addFields({ name: 'Links', value: linksList });
        }
        
        return embed;
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
                       `📊 Volume: $${token.volume24h.toLocaleString()}\n` +
                       `💵 Market Cap: $${token.marketCap.toLocaleString()}`
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

    private async testKnownSolanaToken(): Promise<TokenPrice | null> {
        try {
            // Test with a known Solana token (SOL)
            const knownTokens = [
                'So11111111111111111111111111111111111111112', // SOL
                'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
                'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'  // BONK
            ];
            
            for (const token of knownTokens) {
                console.log(`Testing with known Solana token: ${token}`);
                
                // Try different URL formats
                const urls = [
                    `${this.DEXSCREENER_API}/pairs/solana/${token}`,
                    `${this.DEXSCREENER_API}/search?q=${token}`,
                    `${this.DEXSCREENER_API}/tokens/${token}`
                ];
                
                for (const url of urls) {
                    console.log(`Trying URL for known token: ${url}`);
                    
                    const response = await this.enqueueRequest(() => fetch(url));
                    
                    if (!response.ok) {
                        console.error(`DexScreener API error for known token: ${response.status} ${response.statusText}`);
                        continue;
                    }
                    
                    const data = await response.json();
                    console.log(`API response for known token:`, JSON.stringify(data).substring(0, 200) + '...');
                    
                    if (data.pairs && data.pairs.length > 0) {
                        console.log(`Found ${data.pairs.length} pairs for known token using ${url}`);
                        console.log(`First pair data:`, JSON.stringify(data.pairs[0]).substring(0, 200) + '...');
                        return this.processTokenPriceData(data, token);
                    }
                }
            }
            
            console.error(`Failed to fetch data for any known Solana token`);
            return null;
        } catch (error) {
            console.error('Error testing known Solana token:', error);
            return null;
        }
    }

    async getTokenProfile(contractAddress: string): Promise<TokenProfile | null> {
        try {
            console.log(`Fetching token profile for ${contractAddress}`);
            
            const response = await this.enqueueRequest(() => 
                fetch(`${this.DEXSCREENER_PROFILES_API}?tokenAddress=${contractAddress}`)
            );
            
            if (!response.ok) {
                console.error(`Token profile API error: ${response.status} ${response.statusText}`);
                return null;
            }
            
            const data = await response.json();
            console.log(`Token profile data:`, JSON.stringify(data).substring(0, 200) + '...');
            
            // The API returns an array of profiles
            if (Array.isArray(data) && data.length > 0) {
                // Try to find a matching profile by comparing addresses case-insensitively
                const normalizedContractAddress = contractAddress.toLowerCase();
                
                for (const profile of data) {
                    if (profile.tokenAddress && profile.tokenAddress.toLowerCase() === normalizedContractAddress) {
                        console.log(`Found exact matching profile for ${contractAddress}`);
                        return profile;
                    }
                }
                
                // If no exact match, just use the first profile
                console.log(`Using first available profile for ${contractAddress}`);
                return data[0];
            }
            
            console.warn(`No profile data found for token ${contractAddress}`);
            return null;
        } catch (error) {
            console.error('Error fetching token profile:', error);
            return null;
        }
    }
} 