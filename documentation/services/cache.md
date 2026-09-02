# Cache Service

## Overview

Kanebra's caching system provides file-based persistent caching using Keyv with basic TTL support and security filtering.

## Architecture

### Advanced File-Based Caching

The cache system provides sophisticated file-based persistence with automatic rotation and size management:

```typescript
class CacheService {
  private readonly cache: ExtendedKeyv<any>;           // Main cache
  private readonly longTermCache: ExtendedKeyv<any>;   // Long-term storage
  private readonly metricsCache: ExtendedKeyv<CacheMetrics>; // Performance metrics

  // Features:
  // - Automatic file rotation when size limits exceeded
  // - Backup creation before rotation
  // - Security filtering for sensitive data
  // - TTL-based expiration
  // - Multiple cache namespaces
}
```

### Core Interfaces

```typescript
interface CacheProvider {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttl?: number): Promise<void>
  delete(key: string): Promise<boolean>
  clear(): Promise<void>
  has(key: string): Promise<boolean>
  getStats(): Promise<CacheStats>
}

interface CacheEntry<T = any> {
  key: string;
  value: T;
  expiresAt?: Date;
  createdAt: Date;
  lastAccessed: Date;
  accessCount: number;
  size: number;
}
```

## Cache Types and Strategies

### Memory Cache
```typescript
class MemoryCache implements CacheProvider {
  private store = new Map<string, CacheEntry>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (this.isExpired(entry)) {
      await this.delete(key);
      return null;
    }

    entry.lastAccessed = new Date();
    entry.accessCount++;
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const entry: CacheEntry<T> = {
      key,
      value,
      createdAt: new Date(),
      lastAccessed: new Date(),
      accessCount: 0,
      size: this.calculateSize(value)
    };

    if (ttl) {
      entry.expiresAt = new Date(Date.now() + ttl);
    }

    this.store.set(key, entry);
  }
}
```

### Specialized Caches

#### Command Cache
- Caches Discord command responses
- Reduces API calls for repeated commands
- User-specific cache isolation

#### API Response Cache
- Caches external API responses
- Implements rate limiting and backoff
- Handles API-specific cache headers

#### Query Result Cache
- Caches database query results
- Invalidates on data changes
- Supports complex query caching

## Cache Configuration

### TTL (Time To Live) Management

```typescript
interface CacheConfig {
  defaultTTL: number;        // Default expiration in milliseconds
  maxSize: number;          // Maximum cache size in bytes
  strategy: CacheStrategy;  // Eviction strategy
  compression?: boolean;    // Enable compression
}

enum CacheStrategy {
  LRU = 'LRU',      // Least Recently Used
  LFU = 'LFU',      // Least Frequently Used
  TTL = 'TTL',      // Time-based expiration
  SIZE = 'SIZE'     // Size-based eviction
}
```

### Environment Configuration

```env
# Cache settings
CACHE_ENABLED=true
CACHE_DEFAULT_TTL_MINUTES=60
CACHE_MAX_SIZE_MB=100
CACHE_STRATEGY=LRU
CACHE_COMPRESSION_ENABLED=true

# Specialized cache settings
COMMAND_CACHE_TTL_SECONDS=300
API_CACHE_TTL_SECONDS=600
QUERY_CACHE_TTL_SECONDS=1800
```

## Basic Features

### TTL Support
- Time-based expiration for cache entries
- Configurable default TTL per cache instance
- Automatic cleanup of expired entries

### File Persistence & Management
- Persistent storage using Keyv file adapter
- Cache survives application restarts
- Automatic file rotation when size limits exceeded (default 50MB)
- Backup creation before cache rotation (keeps last 3 backups)
- Configurable file locations and size thresholds

## Cache Invalidation

### Manual Invalidation
```typescript
class CacheManager {
  async invalidateUserCache(userId: string): Promise<void> {
    const keys = await this.getKeysByPattern(`user:${userId}:*`);
    await Promise.all(keys.map(key => this.delete(key)));
  }

  async invalidateCommandCache(command: string): Promise<void> {
    const key = `command:${command}`;
    await this.delete(key);
  }
}
```

### Automatic Invalidation
- Database change triggers
- API response cache headers
- Time-based expiration
- Memory pressure triggers

### Cache Tags
```typescript
interface CacheTags {
  add(key: string, tags: string[]): Promise<void>
  getByTag(tag: string): Promise<string[]>
  invalidateByTag(tag: string): Promise<void>
}

// Usage
await cacheTags.add('user:123:profile', ['user:123', 'profile']);
await cacheTags.invalidateByTag('user:123'); // Clears all user 123 cache
```

## Security Features

### Sensitive Data Filtering
- Automatic detection and filtering of sensitive patterns
- GitHub tokens, API keys, and credentials filtering
- Prevents accidental caching of secrets

## Data Serialization

### Compression
```typescript
class CompressedCache extends BaseCache {
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    const compressed = await this.compress(serialized);
    await super.set(key, compressed, ttl);
  }

  async get<T>(key: string): Promise<T | null> {
    const compressed = await super.get<string>(key);
    if (!compressed) return null;

    const decompressed = await this.decompress(compressed);
    return JSON.parse(decompressed) as T;
  }
}
```

### Serialization Strategies
- JSON for simple objects
- MessagePack for binary data
- Custom serializers for complex types
- Compression for large payloads

## Error Handling and Resilience

### Cache Failures
```typescript
class ResilientCache implements CacheProvider {
  async get<T>(key: string): Promise<T | null> {
    try {
      return await this.primaryCache.get<T>(key);
    } catch (error) {
      this.logger.warn('Primary cache failed, trying fallback', { error });
      try {
        return await this.fallbackCache.get<T>(key);
      } catch (fallbackError) {
        this.logger.error('Fallback cache also failed', { fallbackError });
        return null; // Cache miss, continue with normal flow
      }
    }
  }
}
```

### Circuit Breaker Pattern
- Automatic failover to fallback caches
- Circuit breaker for persistent failures
- Graceful degradation without cache

## Security Considerations

### Cache Poisoning Prevention
- Input validation and sanitization
- Secure key generation
- Access control and authentication

### Data Encryption
- Encryption at rest for sensitive cached data
- Secure key management
- Compliance with data protection regulations

## Integration with Services

### Database Query Caching
```typescript
class CachedDatabaseService {
  async query<T>(sql: string, params: any[]): Promise<T[]> {
    const cacheKey = this.generateCacheKey(sql, params);

    // Try cache first
    const cached = await this.cache.get<T[]>(cacheKey);
    if (cached) return cached;

    // Query database
    const result = await this.db.query<T>(sql, params);

    // Cache result
    await this.cache.set(cacheKey, result, this.getQueryTTL(sql));

    return result;
  }
}
```

### API Response Caching
```typescript
class CachedAPIService {
  async request<T>(endpoint: string, options: RequestOptions): Promise<T> {
    const cacheKey = this.generateRequestKey(endpoint, options);

    const cached = await this.cache.get<T>(cacheKey);
    if (cached) return cached;

    const response = await this.http.request<T>(endpoint, options);

    // Respect cache headers
    const ttl = this.parseCacheHeaders(response.headers);
    await this.cache.set(cacheKey, response.data, ttl);

    return response.data;
  }
}
```

## Testing Strategy

### Cache Testing
```typescript
describe('CacheService', () => {
  it('should store and retrieve values', async () => {
    await cache.set('test', 'value', 1000);
    const result = await cache.get('test');
    expect(result).to.equal('value');
  });

  it('should expire values after TTL', async () => {
    await cache.set('test', 'value', 100);
    await new Promise(resolve => setTimeout(resolve, 150));
    const result = await cache.get('test');
    expect(result).to.be.null;
  });

  it('should handle concurrent access', async () => {
    // Test thread safety
  });
});
```

### Performance Testing
- Cache hit rate testing
- Memory usage testing
- Concurrent access testing
- Large dataset testing

## Future Enhancements

### Distributed Caching
- Redis integration for multi-instance caching
- Cache clustering and replication
- Cross-region cache synchronization

### Advanced Features
- **Smart Prefetching**: Predictive cache loading
- **Cache Analytics**: Usage pattern analysis
- **Machine Learning**: Adaptive cache strategies
- **Multi-Level Caching**: L1/L2/L3 cache hierarchy

## Troubleshooting

### Common Issues

**High Memory Usage**:
- Check cache size limits and eviction policies
- Monitor cache entry sizes
- Review compression settings

**Low Hit Rate**:
- Analyze access patterns
- Adjust TTL settings
- Review cache key generation

**Slow Performance**:
- Check serialization overhead
- Monitor compression performance
- Review network latency for distributed cache

### Debug Commands

```bash
# View cache statistics
npm run cache:stats

# Clear all cache
npm run cache:clear

# Test cache performance
npm run cache:benchmark

# Monitor cache hit rates
npm run cache:monitor
```
