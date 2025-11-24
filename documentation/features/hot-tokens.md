# Hot Tokens (Cryptocurrency Tracking)

## Overview

The Hot Tokens feature provides a curated database of cryptocurrency tokens with manual tracking and Discord command integration for token management and information display.

## Features

### Real-Time Price Tracking
- Integration with DexScreener API for live cryptocurrency data
- Automatic price fetching for tracked tokens
- Price change monitoring and historical tracking
- Volume and market cap data aggregation

### Discord Integration
- Discord commands for token information
- Token listing and search capabilities
- Category-based token browsing

### Basic Price Tracking
- Manual price updates for tracked tokens
- Market cap monitoring
- Token metadata management

## Architecture

### Service Components

```typescript
// Core tracking service
class HotTokensService {
  async getTokenPrice(symbol: string): Promise<TokenPrice>
  async getMarketOverview(): Promise<MarketOverview>
  async trackPriceAlerts(userId: string, alerts: PriceAlert[]): Promise<void>
}

// Price tracking and aggregation
class PriceTrackingService {
  async fetchFromExchanges(symbol: string): Promise<ExchangeData[]>
  async aggregatePrices(data: ExchangeData[]): Promise<TokenPrice>
  async detectTrends(prices: PriceData[]): Promise<TrendAnalysis>
}
```

### Data Structures

```typescript
interface Token {
  id: number;
  symbol: string;
  name: string;
  category: TokenCategory;
  marketCap: number;
  price: number;
  change24h: number;
  volume24h: number;
}

interface PriceAlert {
  tokenId: number;
  userId: string;
  targetPrice: number;
  condition: 'above' | 'below';
  isActive: boolean;
}

enum TokenCategory {
  DEFI = 'DEFI',
  NFT = 'NFT',
  GAMING = 'GAMING',
  INFRASTRUCTURE = 'INFRASTRUCTURE',
  MEME = 'MEME'
}
```

## Discord Commands

### Available Commands

**Price Queries**:
```
/price BTC        # Get Bitcoin price
/price ETH USDT   # Get ETH price in USD
/prices           # Show top 10 cryptocurrencies
```

**Market Overview**:
```
/market           # Market overview and trending
/trending         # Currently trending tokens
/category defi    # Tokens by category
```

**Alerts**:
```
/alert BTC > 50000  # Alert when BTC > $50k
/alerts            # List active alerts
/alert remove 1    # Remove alert by ID
```

## Data Sources

### Exchange Integrations
- **CoinGecko**: Primary price and market data
- **CoinMarketCap**: Alternative data source
- **Binance API**: Real-time trading data
- **Coinbase Pro**: Institutional price feeds

### Data Aggregation Strategy
```typescript
class DataAggregator {
  async aggregateTokenData(symbol: string): Promise<AggregatedData> {
    const sources = await Promise.allSettled([
      coinGeckoAPI.getPrice(symbol),
      coinMarketCapAPI.getPrice(symbol),
      binanceAPI.getPrice(symbol)
    ]);

    return this.weightedAverage(sources);
  }
}
```

## Advanced Features

### Price Alert System
- Set price alerts for specific thresholds
- Above/below price conditions with target prices
- Automatic notifications via Discord DMs
- Alert management and tracking system

### Token Database Management
- Curated database of tracked tokens
- Category-based organization (DeFi, NFT, Gaming, Infrastructure, etc.)
- Manual token addition with contract addresses
- Community token flagging and metadata storage

## Caching and Performance

### Data Caching Strategy
- Price data cached for 60 seconds
- Market overview cached for 5 minutes
- Historical data cached for 1 hour

### Rate Limiting
- API call throttling per exchange
- User request rate limiting
- Alert frequency controls

## Database Schema

### Core Tables
```sql
-- Cryptocurrency tokens
CREATE TABLE Token (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  category TokenCategory NOT NULL,
  createdAt TIMESTAMP DEFAULT NOW()
);

-- Price tracking
CREATE TABLE TokenPrice (
  id SERIAL PRIMARY KEY,
  tokenId INTEGER REFERENCES Token(id),
  price DECIMAL(20,8) NOT NULL,
  volume24h DECIMAL(20,2),
  marketCap DECIMAL(25,2),
  timestamp TIMESTAMP DEFAULT NOW()
);

-- User alerts
CREATE TABLE PriceAlert (
  id SERIAL PRIMARY KEY,
  userId VARCHAR(20) NOT NULL,
  tokenId INTEGER REFERENCES Token(id),
  targetPrice DECIMAL(20,8) NOT NULL,
  condition VARCHAR(10) NOT NULL,
  isActive BOOLEAN DEFAULT TRUE,
  createdAt TIMESTAMP DEFAULT NOW()
);
```

## Configuration

### Environment Variables
```env
# CoinGecko API (free tier available)
COINGECKO_API_KEY=your_coingecko_key

# CoinMarketCap API (paid)
CMC_API_KEY=your_cmc_key

# Binance API (free)
BINANCE_API_KEY=your_binance_key

# Alert settings
ALERT_CHECK_INTERVAL=60  # seconds
MAX_ALERTS_PER_USER=10
ALERT_COOLDOWN=300      # seconds between alerts
```

### Feature Flags
```env
HOT_TOKENS_ENABLED=true
PRICE_ALERTS_ENABLED=true
TREND_ANALYSIS_ENABLED=true
```

## Error Handling

### API Failure Resilience
- Automatic fallback between data sources
- Graceful degradation when APIs are unavailable
- Data freshness indicators

### Rate Limit Management
- Exponential backoff for rate-limited requests
- Request queuing and prioritization
- Circuit breaker pattern for persistent failures

## Testing Strategy

### Unit Tests
```typescript
describe('HotTokensService', () => {
  it('should fetch token price from primary API', async () => {
    // Test primary API integration
  });

  it('should fallback to secondary API on failure', async () => {
    // Test API fallback logic
  });

  it('should trigger price alerts correctly', async () => {
    // Test alert triggering logic
  });
});
```

### Integration Tests
- End-to-end price fetching workflows
- Alert notification delivery
- Database persistence and retrieval

## Monitoring and Analytics

### Key Metrics
- API response times and success rates
- Alert delivery success rate
- User engagement with price commands
- Data freshness and accuracy

### Performance Monitoring
- Price update frequency tracking
- Alert processing latency
- Database query performance

## Security Considerations

### API Key Protection
- Encrypted storage of API credentials
- Key rotation procedures
- Access logging for sensitive operations

### Data Validation
- Input sanitization for user commands
- Price data validation and anomaly detection
- SQL injection prevention

## Future Enhancements

### Planned Features
- **Portfolio Tracking**: User portfolio management
- **Technical Analysis**: Chart patterns and indicators
- **News Integration**: Cryptocurrency news and sentiment
- **DeFi Integration**: Yield farming and liquidity tracking
- **Mobile Notifications**: Push notifications for alerts

### Advanced Analytics
- **Predictive Modeling**: Price prediction algorithms
- **Correlation Analysis**: Token relationship mapping
- **Risk Assessment**: Volatility and risk metrics
- **Arbitrage Detection**: Cross-exchange price discrepancies

## Troubleshooting

### Common Issues

**Price Data Unavailable**:
- Check API key validity and quotas
- Verify internet connectivity
- Review API service status

**Alerts Not Triggering**:
- Verify alert configuration and thresholds
- Check notification permissions
- Review alert processing logs

**Slow Performance**:
- Monitor API rate limits
- Check caching effectiveness
- Review database query performance

### Debug Commands

```bash
# Test price fetching
npm run tokens:test-price

# Check alert system
npm run tokens:test-alerts

# Monitor API health
npm run tokens:health-check

# View cached data
npm run tokens:cache-status
```
