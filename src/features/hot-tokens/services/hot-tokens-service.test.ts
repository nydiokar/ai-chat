import { expect } from 'chai';
import { PrismaClient, TokenCategory } from '@prisma/client';
import { HotTokensService } from './hot-tokens-service.js';
import { PriceTrackingService } from '../services/price-tracking-service.js';
import type { HotToken } from '../types/token.js';
import sinon from 'sinon';
import { EmbedBuilder } from 'discord.js';

// DexScreener API types
interface DexScreenerPair {
    chainId: string;
    dexId: string;
    pairAddress: string;
    baseToken: {
        address: string;
        name: string;
        symbol: string;
    };
    priceUsd: string;
    priceChange: {
        h1: number;
        h24: number;
        h7d: number;
        h30d: number;
    };
    liquidity: {
        usd: number;
    };
    volume: {
        h24: number;
    };
    marketCap: number;
}

interface DexScreenerResponse {
    pairs: DexScreenerPair[];
}

type MockPriceDataMap = {
    [key: string]: DexScreenerResponse;
};

describe('HotTokensService', () => {
    let prisma: PrismaClient;
    let service: HotTokensService;
    let priceTrackingStub: sinon.SinonStubbedInstance<PriceTrackingService>;

    // Create realistic mock price data matching DexScreener API
    const mockPriceDataMap: MockPriceDataMap = {
        '0x6982508145454ce325ddbe47a25d4ec3d2311933': {
            pairs: [{
                chainId: 'ethereum',
                dexId: 'uniswap',
                pairAddress: '0x1234567890abcdef',
                baseToken: {
                    address: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
                    name: 'Pepe',
                    symbol: 'PEPE'
                },
                priceUsd: '0.00000123',
                priceChange: {
                    h1: 15.2,
                    h24: -8.6,
                    h7d: 105.5,
                    h30d: -20.1
                },
                liquidity: {
                    usd: 2500000
                },
                volume: {
                    h24: 8500000
                },
                marketCap: 12000000
            }]
        },
        '0x912ce59144191c1204e64559fe8253a0e49e6548': {
            pairs: [{
                chainId: 'ethereum',
                dexId: 'binance',
                pairAddress: '0xdef9876543210abcd',
                baseToken: {
                    address: '0x912ce59144191c1204e64559fe8253a0e49e6548',
                    name: 'Arbitrum',
                    symbol: 'ARB'
                },
                priceUsd: '1.85',
                priceChange: {
                    h1: 0.5,
                    h24: 2.3,
                    h7d: 15.5,
                    h30d: 45.2
                },
                liquidity: {
                    usd: 85000000
                },
                volume: {
                    h24: 125000000
                },
                marketCap: 2350000000
            }]
        },
        '0x514910771af9ca656af840dff83e8264ecf986ca': {
            pairs: [{
                chainId: 'ethereum',
                dexId: 'pancakeswap',
                pairAddress: '0xabcd1234567890ef',
                baseToken: {
                    address: '0x514910771af9ca656af840dff83e8264ecf986ca',
                    name: 'Chainlink',
                    symbol: 'LINK'
                },
                priceUsd: '15.73',
                priceChange: {
                    h1: -0.8,
                    h24: 3.2,
                    h7d: -5.5,
                    h30d: 12.8
                },
                liquidity: {
                    usd: 150000000
                },
                volume: {
                    h24: 285000000
                },
                marketCap: 8900000000
            }]
        }
    };

    const testTokens = [
        {
            name: 'Pepe',
            contractAddress: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
            category: TokenCategory.MEME,
            note: 'Popular meme token with high volatility',
            isCommunity: true,
            marketCapNow: 12000000,
            marketCapFirstEntry: 5000000,
            meta: { launchDate: '2023-04-14' }
        },
        {
            name: 'Arbitrum',
            contractAddress: '0x912ce59144191c1204e64559fe8253a0e49e6548',
            category: TokenCategory.LAYER2,
            note: 'Leading Ethereum L2 solution',
            isCommunity: false,
            marketCapNow: 2350000000,
            marketCapFirstEntry: 1800000000,
            meta: { tvl: '15.2B' }
        },
        {
            name: 'Chainlink',
            contractAddress: '0x514910771af9ca656af840dff83e8264ecf986ca',
            category: TokenCategory.INFRASTRUCTURE,
            note: 'Oracle network with widespread adoption',
            isCommunity: false,
            marketCapNow: 8900000000,
            marketCapFirstEntry: 8200000000,
            meta: { integrations: 1250 }
        }
    ] satisfies Omit<HotToken, 'id' | 'firstSeen'>[];

    beforeEach(async () => {
        prisma = new PrismaClient();
        priceTrackingStub = sinon.createStubInstance(PriceTrackingService);
        
        // Setup dynamic stub behaviors with DexScreener API format
        priceTrackingStub.getTokenPrice.callsFake(async (address) => {
            const data = mockPriceDataMap[address];
            if (!data || !data.pairs.length) return null;

            const pair = data.pairs[0];
            return {
                contractAddress: pair.baseToken.address,
                name: pair.baseToken.name,
                symbol: pair.baseToken.symbol,
                currentPrice: parseFloat(pair.priceUsd),
                priceChange: {
                    '1h': pair.priceChange.h1,
                    '24h': pair.priceChange.h24,
                    '7d': pair.priceChange.h7d,
                    '30d': pair.priceChange.h30d
                },
                volume24h: pair.volume.h24,
                marketCap: pair.marketCap,
                lastUpdated: new Date(),
                pairAddress: pair.pairAddress,
                dexId: pair.dexId,
                liquidity: pair.liquidity.usd
            };
        });

        priceTrackingStub.getTopPerformingTokens.callsFake(async (timeframe) => {
            const timeframeMap = {
                '1h': 'h1',
                '24h': 'h24',
                '7d': 'h7d',
                '30d': 'h30d'
            };
            
            const allPrices = await Promise.all(
                Object.keys(mockPriceDataMap).map(addr => priceTrackingStub.getTokenPrice(addr))
            );
            
            return allPrices
                .filter((p): p is NonNullable<typeof p> => p !== null)
                .sort((a, b) => b.priceChange[timeframe] - a.priceChange[timeframe])
                .slice(0, 10);
        });

        // Setup embed creation stubs
        priceTrackingStub.createPriceEmbed.callsFake((price) => {
            return new EmbedBuilder()
                .setTitle(`💰 ${price?.name || 'N/A'} (${price?.symbol || 'N/A'}) Price Info`)
                .setColor('#00ff00')
                .addFields(
                    { name: 'Price', value: `$${price?.currentPrice.toFixed(6) || 'N/A'}`, inline: true },
                    { name: 'Volume', value: `$${price?.volume24h.toLocaleString() || 'N/A'}`, inline: true }
                );
        });

        priceTrackingStub.createTrendingEmbed.callsFake((tokens) => {
            const embed = new EmbedBuilder()
                .setTitle('🔥 Trending Hot Tokens')
                .setColor('#ff6b6b')
                .setDescription('Top performing tokens from your watchlist');

            tokens.forEach((token, index) => {
                embed.addFields({
                    name: `${index + 1}. ${token.name} (${token.symbol})`,
                    value: `💰 Price: $${token.currentPrice.toFixed(6)}\n` +
                           `📈 24h Change: ${token.priceChange['24h'].toFixed(2)}%`
                });
            });

            return embed;
        });

        // Create service with stubbed price tracking
        service = new HotTokensService(prisma);
        // @ts-ignore - Replace the real price tracking service with our stub
        service.priceTrackingService = priceTrackingStub;

        // Clean up any existing data
        await prisma.$executeRaw`DELETE FROM PriceAlert`;
        await prisma.$executeRaw`DELETE FROM HotToken`;
    });

    afterEach(async () => {
        sinon.restore();
        await prisma.$disconnect();
    });

    describe('Token Management', () => {
        it('should add multiple tokens and list them', async () => {
            // Add all test tokens
            for (const token of testTokens) {
                const result = await service.addToken(token);
                console.log(`Added token: ${token.name}`, {
                    id: result.id,
                    name: result.name,
                    contractAddress: result.contractAddress,
                    category: result.category
                });
                expect(result).to.have.property('id');
                expect(result.name).to.equal(token.name);
                expect(result.contractAddress).to.equal(token.contractAddress);
            }

            // List all tokens
            const tokens = await service.listTokens();
            console.log('Listed all tokens:', tokens.map(t => ({
                name: t.name,
                category: t.category,
                isCommunity: t.isCommunity
            })));
            expect(tokens).to.have.length(3);
            const tokenNames = tokens.map(t => t.name);
            expect(tokenNames).to.include('Pepe');
            expect(tokenNames).to.include('Arbitrum');
            expect(tokenNames).to.include('Chainlink');
        });

        it('should filter tokens by category', async () => {
            // Add all test tokens
            for (const token of testTokens) {
                await service.addToken(token);
            }

            // List MEME tokens
            const memeTokens = await service.listTokens({ category: TokenCategory.MEME });
            console.log('MEME category tokens:', memeTokens.map(t => ({
                name: t.name,
                category: t.category
            })));
            expect(memeTokens).to.have.length(1);
            expect(memeTokens[0].name).to.equal('Pepe');

            // List LAYER2 tokens
            const layer2Tokens = await service.listTokens({ category: TokenCategory.LAYER2 });
            console.log('LAYER2 category tokens:', layer2Tokens.map(t => ({
                name: t.name,
                category: t.category
            })));
            expect(layer2Tokens).to.have.length(1);
            expect(layer2Tokens[0].name).to.equal('Arbitrum');
        });

        it('should update token information', async () => {
            // Add a token
            const token = await service.addToken(testTokens[0]);
            console.log('Original token:', {
                name: token.name,
                note: token.note
            });

            // Update the token
            const update = {
                name: 'Updated Pepe',
                note: 'Updated note'
            };
            const updated = await service.updateToken(token.contractAddress, update);
            expect(updated).to.be.true;

            // Verify the update
            const tokens = await service.listTokens();
            console.log('Updated token:', {
                name: tokens[0].name,
                note: tokens[0].note
            });
            expect(tokens[0].name).to.equal('Updated Pepe');
            expect(tokens[0].note).to.equal('Updated note');
        });

        it('should remove a token', async () => {
            // Add a token
            const token = await service.addToken(testTokens[0]);
            console.log('Added token for removal:', {
                name: token.name,
                contractAddress: token.contractAddress
            });

            // Remove the token
            const removed = await service.removeToken(token.contractAddress);
            expect(removed).to.be.true;

            // Verify the token is gone
            const tokens = await service.listTokens();
            console.log('Remaining tokens after removal:', tokens.length);
            expect(tokens).to.have.length(0);
        });

        it('should handle invalid token updates gracefully', async () => {
            const result = await service.updateToken('0xInvalidAddress', {
                name: 'Invalid Token'
            });
            expect(result).to.be.false;
        });

        it('should maintain token metadata during updates', async () => {
            const token = await service.addToken(testTokens[0]);
            const update = {
                note: 'Updated note'
            };
            await service.updateToken(token.contractAddress, update);
            
            const updated = (await service.listTokens())[0];
            expect(updated.meta).to.deep.equal(testTokens[0].meta);
            expect(updated.marketCapFirstEntry).to.equal(testTokens[0].marketCapFirstEntry);
        });
    });

    describe('Price Tracking', () => {
        it('should fetch token prices', async () => {
            // Add a token
            const token = await service.addToken(testTokens[0]);
            console.log('Added token for price check:', {
                name: token.name,
                contractAddress: token.contractAddress
            });

            // Get price info
            const price = await service.getTokenPrice(token.contractAddress);
            console.log('Fetched price data:', {
                name: price?.name,
                price: price?.currentPrice,
                volume: price?.volume24h,
                liquidity: price?.liquidity
            });
            expect(price).to.not.be.null;
            if (price) {
                expect(price).to.have.property('currentPrice');
                expect(price).to.have.property('liquidity');
                expect(price).to.have.property('volume24h');
            }
        });

        it('should set and check price alerts', async () => {
            // Add a token
            const token = await service.addToken(testTokens[0]);
            console.log('Added token for alert:', {
                name: token.name,
                contractAddress: token.contractAddress
            });

            // Set a price alert
            const alert = await service.setPriceAlert(
                token.contractAddress,
                0.0001,
                'above',
                'test-user-id'
            );
            console.log('Created price alert:', {
                id: alert?.id,
                targetPrice: alert?.targetPrice,
                condition: alert?.condition,
                triggered: alert?.triggered
            });
            expect(alert).to.not.be.null;
            if (alert) {
                expect(alert.contractAddress).to.equal(token.contractAddress);
                expect(alert.targetPrice).to.equal(0.0001);
                expect(alert.condition).to.equal('above');
                expect(alert.triggered).to.be.false;
            }
        });

        it('should get top performing tokens', async () => {
            // Add all test tokens
            for (const token of testTokens) {
                await service.addToken(token);
            }

            // Get top performing tokens
            const topTokens = await service.getTopPerformingTokens('24h');
            console.log('Top performing tokens:', topTokens.map(t => ({
                name: t.name,
                price: t.currentPrice,
                change24h: t.priceChange['24h']
            })));
            expect(topTokens).to.be.an('array');
            if (topTokens.length > 0) {
                expect(topTokens[0]).to.have.property('priceChange');
                expect(topTokens[0].priceChange).to.have.property('24h');
            }
        });

        it('should handle non-existent token prices', async () => {
            const price = await service.getTokenPrice('0xNonExistentToken');
            expect(price).to.be.null;
        });

        it('should return correct price changes for different timeframes', async () => {
            const token = await service.addToken(testTokens[0]);
            const price = await service.getTokenPrice(token.contractAddress);
            
            expect(price).to.not.be.null;
            if (price) {
                expect(price.priceChange).to.have.all.keys(['1h', '24h', '7d', '30d']);
                expect(price.priceChange['24h']).to.equal(mockPriceDataMap[token.contractAddress].pairs[0].priceChange.h24);
            }
        });

        it('should sort top performing tokens correctly', async () => {
            // Add all test tokens
            for (const token of testTokens) {
                await service.addToken(token);
            }

            const timeframes: ('1h' | '24h' | '7d' | '30d')[] = ['1h', '24h', '7d', '30d'];
            
            for (const timeframe of timeframes) {
                const topTokens = await service.getTopPerformingTokens(timeframe);
                console.log(`Top performers (${timeframe}):`, topTokens.map(t => ({
                    name: t.name,
                    change: t.priceChange[timeframe]
                })));
                
                // Verify sorting
                const changes = topTokens.map(t => t.priceChange[timeframe]);
                const sortedChanges = [...changes].sort((a, b) => b - a);
                expect(changes).to.deep.equal(sortedChanges);
            }
        });

        it('should handle multiple price alerts for the same token', async () => {
            const token = await service.addToken(testTokens[0]);
            
            const alerts = await Promise.all([
                service.setPriceAlert(token.contractAddress, 0.000001, 'above', 'user1'),
                service.setPriceAlert(token.contractAddress, 0.000002, 'below', 'user2')
            ]);
            
            expect(alerts).to.have.length(2);
            expect(alerts[0]?.condition).to.equal('above');
            expect(alerts[1]?.condition).to.equal('below');
        });
    });

    describe('Discord Embeds', () => {
        it('should create list embed', async () => {
            // Add all test tokens
            for (const token of testTokens) {
                await service.addToken(token);
            }

            // Get tokens and create embed
            const tokens = await service.listTokens();
            const embed = await service.createListEmbed(tokens);
            
            console.log('List Embed Title:', embed.data.title);
            console.log('List Embed Fields:', embed.data.fields?.length);
            
            expect(embed.data.title).to.equal('🔥 Hot Tokens List');
            expect(embed.data.fields).to.have.length.greaterThan(0);
            expect(embed.data.description).to.include(`Total tokens: ${tokens.length}`);
        });

        it('should create price embed', async () => {
            // Add a token and get its price
            const token = await service.addToken(testTokens[0]);
            const price = await service.getTokenPrice(token.contractAddress);

            console.log('Price Data:', price);
            
            if (!price) {
                throw new Error('Price data should not be null');
            }

            const embed = await service.createPriceEmbed(price);
            
            console.log('Price Embed Title:', embed.data.title);
            console.log('Price Embed Fields:', embed.data.fields?.map(f => f.name));
            
            expect(embed.data.title).to.include(price.name);
            expect(embed.data.fields).to.have.length.greaterThan(0);
            expect(embed.data.fields?.[0]).to.have.property('name', 'Price');
            expect(embed.data.color).to.equal(0x00ff00);
        });

        it('should create trending embed', async () => {
            // Add all tokens and get top performers
            for (const token of testTokens) {
                await service.addToken(token);
            }

            const topTokens = await service.getTopPerformingTokens('24h');
            console.log('Top Tokens:', topTokens);
            
            const embed = await service.createTrendingEmbed(topTokens);
            
            console.log('Trending Embed Title:', embed.data.title);
            console.log('Trending Embed Fields:', embed.data.fields?.map(f => f.name));
            
            expect(embed.data.title).to.equal('🔥 Trending Hot Tokens');
            expect(embed.data.fields).to.have.length.greaterThan(0);
            expect(embed.data.description).to.equal('Top performing tokens from your watchlist');
            expect(embed.data.color).to.equal(0xff6b6b);
        });

        it('should format numbers appropriately in embeds', async () => {
            const token = await service.addToken(testTokens[1]); // Arbitrum with large numbers
            const price = await service.getTokenPrice(token.contractAddress);
            
            if (!price) throw new Error('Price data should not be null');
            
            const embed = await service.createPriceEmbed(price);
            const priceField = embed.data.fields?.find(f => f.name === 'Price');
            const volumeField = embed.data.fields?.find(f => f.name === 'Volume');
            
            expect(priceField?.value).to.include('$1.85');
            expect(volumeField?.value).to.include('125,000,000');
        });

        it('should handle tokens with missing price data in list embed', async () => {
            await service.addToken(testTokens[0]);
            priceTrackingStub.getTokenPrice.resolves(null); // Simulate missing price data
            
            const tokens = await service.listTokens();
            const embed = await service.createListEmbed(tokens);
            
            expect(embed.data.fields).to.have.length.greaterThan(0);
            const fieldContent = embed.data.fields?.[0].value || '';
            expect(fieldContent).to.include('Price data unavailable');
        });

        it('should create trending embed with proper sorting and formatting', async () => {
            for (const token of testTokens) {
                await service.addToken(token);
            }

            const topTokens = await service.getTopPerformingTokens('24h');
            const embed = await service.createTrendingEmbed(topTokens);
            
            // Verify proper ordering and formatting
            const fields = embed.data.fields || [];
            expect(fields[0].name).to.include('1.');
            expect(fields[0].value).to.include('%');
            expect(fields[0].value).to.include('$');
        });
    });
}); 