import { PrismaClient } from '@prisma/client';
import { EmbedBuilder } from 'discord.js';
import fetch from 'node-fetch';
import crypto from 'crypto';

export interface TokenPrice {
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
    // Direct token information fields
    url?: string;
    chainId?: string;
    iconUrl?: string;
    bannerUrl?: string;
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
                    return await this.processTokenPriceData({ pairs: solanaPairs }, contractAddress);
                } else if (url.includes('/tokens/') || url.includes('/pairs/')) {
                    if (!data.pairs || data.pairs.length === 0) {
                        console.warn(`No pairs found for token ${contractAddress} using ${url}`);
                        continue;
                    }
                    
                    console.log(`Found token ${contractAddress} with ${data.pairs.length} pairs using ${url}`);
                    return await this.processTokenPriceData(data, contractAddress);
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

            // Extract token profile information directly from the pair data
            const profile: TokenPrice = {
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
                liquidity: pair.liquidity?.usd || 0,
                url: pair.url || undefined,
                chainId: pair.chainId || undefined,
                iconUrl: pair.info?.imageUrl || undefined,
                bannerUrl: this.extractBannerImage(pair),
                description: pair.baseToken?.name || undefined,
                links: this.extractLinksFromPair(pair)
            };

            console.log(`Extracted profile from pair data:`, JSON.stringify(profile).substring(0, 200) + '...');

            return profile;
        } catch (error) {
            console.error(`Error processing token price data for ${contractAddress}:`, error);
            return null;
        }
    }

    private extractBannerImage(pair: any): string | undefined {
        // Check if there's a banner image in the pair data
        if (pair.info?.bannerImage) {
            return pair.info.bannerImage;
        }
        
        // If no banner image is available, we could potentially use a large version of the token image
        if (pair.info?.imageUrl) {
            return pair.info.imageUrl;
        }
        
        // As a fallback, we could check if there's a Twitter account and try to construct a banner URL
        if (pair.info?.socials && Array.isArray(pair.info.socials)) {
            const twitter = pair.info.socials.find((social: any) => 
                social.platform?.toLowerCase() === 'twitter' || social.platform?.toLowerCase() === 'x');
            
            if (twitter && twitter.handle) {
                // This is speculative - Twitter doesn't have a direct API for banner images without auth
                // But we could potentially use a service that provides this
                return undefined;
            }
        }
        
        return undefined;
    }

    // Helper method to extract links from pair data
    private extractLinksFromPair(pair: any): { type: string; label: string; url: string }[] {
        const links: { type: string; label: string; url: string }[] = [];
        
        // Add websites
        if (pair.info?.websites && Array.isArray(pair.info.websites)) {
            console.log(`Found ${pair.info.websites.length} websites in pair data`);
            pair.info.websites.forEach((website: any, index: number) => {
                console.log(`Website ${index}:`, JSON.stringify(website));
                if (website.url) {
                    links.push({
                        type: 'website',
                        label: 'Website',
                        url: website.url
                    });
                }
            });
        }
        
        // Add socials
        if (pair.info?.socials && Array.isArray(pair.info.socials)) {
            console.log(`Found ${pair.info.socials.length} social media links in pair data`);
            
            pair.info.socials.forEach((social: any, index: number) => {
                console.log(`Social ${index}:`, JSON.stringify(social));
                
                if (social.platform && social.handle) {
                    // Convert platform to URL based on common social media
                    let url = '';
                    let label = social.platform;
                    
                    switch (social.platform.toLowerCase()) {
                        case 'twitter':
                        case 'x':
                            url = social.handle.startsWith('http') ? social.handle : 
                                 (social.handle.startsWith('@') ? `https://twitter.com/${social.handle.substring(1)}` : `https://twitter.com/${social.handle}`);
                            label = 'Twitter';
                            break;
                        case 'telegram':
                            url = social.handle.startsWith('http') ? social.handle : 
                                 (social.handle.startsWith('@') ? `https://t.me/${social.handle.substring(1)}` : `https://t.me/${social.handle}`);
                            label = 'Telegram';
                            break;
                        case 'discord':
                            url = social.handle.startsWith('http') ? social.handle : 
                                 (social.handle.startsWith('https://discord.gg/') ? social.handle : `https://discord.gg/${social.handle}`);
                            label = 'Discord';
                            break;
                        case 'medium':
                            url = social.handle.startsWith('http') ? social.handle : `https://medium.com/${social.handle}`;
                            label = 'Medium';
                            break;
                        case 'github':
                            url = social.handle.startsWith('http') ? social.handle : `https://github.com/${social.handle}`;
                            label = 'GitHub';
                            break;
                        default:
                            // If we don't recognize the platform, use the handle as is if it's a URL
                            if (social.handle.startsWith('http')) {
                                url = social.handle;
                            } else {
                                // Try to construct a URL based on the platform name
                                url = `https://${social.platform.toLowerCase()}.com/${social.handle}`;
                            }
                    }
                    
                    console.log(`Converted social media: ${social.platform} -> ${label}: ${url}`);
                    
                    links.push({
                        type: social.platform.toLowerCase(),
                        label: label,
                        url: url
                    });
                }
            });
        }
        
        // Add DEX link
        if (pair.url) {
            links.push({
                type: 'dex',
                label: 'DexScreener',
                url: pair.url
            });
        }
        
        console.log(`Extracted ${links.length} links from pair data`);
        return links;
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
    
    async getTrendingTokens(chainId: string = 'solana', timeframe: '1h' | '24h' | '7d' | '30d' = '24h'): Promise<TokenPrice[]> {
        try {
            console.log(`Fetching trending tokens for ${chainId} with timeframe ${timeframe}`);
            
            // Map our timeframe format to DexScreener's format
            const dexScreenerTimeframe = timeframe === '1h' ? 'h1' : 
                                        timeframe === '24h' ? 'h24' : 
                                        timeframe === '7d' ? 'd7' : 'd30';
            
            // Fetch trending pairs from DexScreener
            const url = `${this.DEXSCREENER_API}/trending?chainIds=${chainId}`;
            console.log(`Fetching trending tokens from: ${url}`);
            
            const response = await this.enqueueRequest(() => fetch(url));
            
            if (!response.ok) {
                console.error(`DexScreener API error: ${response.status} ${response.statusText}`);
                return [];
            }
            
            const data = await response.json();
            
            if (!data.pairs || !Array.isArray(data.pairs) || data.pairs.length === 0) {
                console.warn(`No trending pairs found for ${chainId}`);
                return [];
            }
            
            console.log(`Found ${data.pairs.length} trending pairs for ${chainId}`);
            
            // Process each pair into our TokenPrice format
            const trendingTokens: TokenPrice[] = [];
            
            for (const pair of data.pairs) {
                try {
                    // Skip pairs without proper data
                    if (!pair.baseToken || !pair.priceUsd) continue;
                    
                    const marketCap = pair.marketCap || 0;
                    
                    const tokenPrice: TokenPrice = {
                        contractAddress: pair.baseToken.address,
                        name: pair.baseToken.name || 'Unknown',
                        symbol: pair.baseToken.symbol || 'Unknown',
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
                        liquidity: pair.liquidity?.usd || 0,
                        url: pair.url || undefined,
                        chainId: pair.chainId || undefined,
                        iconUrl: pair.info?.imageUrl || undefined,
                        bannerUrl: this.extractBannerImage(pair),
                        description: pair.baseToken?.name || undefined,
                        links: this.extractLinksFromPair(pair)
                    };
                    
                    trendingTokens.push(tokenPrice);
                } catch (error) {
                    console.error(`Error processing trending pair:`, error);
                }
            }
            
            // Sort by the requested timeframe and take top 10
            return trendingTokens
                .sort((a, b) => b.priceChange[timeframe] - a.priceChange[timeframe])
                .slice(0, 10);
        } catch (error) {
            console.error('Error fetching trending tokens:', error);
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
        if (price.iconUrl) {
            embed.setThumbnail(price.iconUrl);
        }
        
        // Add header image if available
        if (price.bannerUrl) {
            embed.setImage(price.bannerUrl);
        }
        
        // Add description if available
        if (price.description) {
            embed.setDescription(price.description);
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
        if (price.links && price.links.length > 0) {
            const linksList = price.links
                .map(link => `[${link.label || link.type}](${link.url})`)
                .join(' | ');
            
            embed.addFields({ name: 'Links', value: linksList });
        }
        
        return embed;
    }

    createTrendingEmbed(tokens: TokenPrice[], title: string = '🔥 Trending Tokens', description?: string): EmbedBuilder {
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setColor('#ff6b6b')
            .setDescription(description || (tokens.length ? 'Currently trending tokens' : 'No token data available'))
            .setTimestamp();

        tokens.forEach((token, index) => {
            embed.addFields({
                name: `${index + 1}. ${token.name} (${token.symbol})`,
                value: `💰 Price: $${token.currentPrice.toFixed(8)}\n` +
                       `📈 24h Change: ${token.priceChange['24h'] >= 0 ? '🟢' : '🔴'} ${token.priceChange['24h'].toFixed(2)}%\n` +
                       `💧 Liquidity: $${token.liquidity.toLocaleString()}\n` +
                       `📊 Volume: $${token.volume24h.toLocaleString()}\n` +
                       `💵 Market Cap: $${token.marketCap.toLocaleString()}\n` +
                       `🔗 [View on DexScreener](${token.url || `https://dexscreener.com/${token.chainId}/${token.pairAddress}`})`
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
} 