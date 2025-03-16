# Cache Architecture

## Overview
The caching system is built on three main pillars:
1. **Core Cache Service** - Built on Keyv for persistence
2. **Specialized Caches** - Purpose-built caches for specific features
3. **Cache Providers** - Implementations for different storage types

## 1. Core Cache Layer

### CacheService (`src/services/cache/cache-service.ts`)
- **Purpose**: Main caching service using Keyv
- **Features**:
  - Multiple storage backends (Memory, File, Redis)
  - Built-in persistence
  - Metrics tracking
  - Error handling
  - Data sanitization for sensitive data
- **Usage**:
```typescript
const cache = CacheService.getInstance({
    type: CacheType.PERSISTENT,
    namespace: 'my-cache',
    filename: 'cache.json'
});
```

### Cache Types
```typescript
enum CacheType {
    MEMORY = 'MEMORY',           // In-memory only
    PERSISTENT = 'PERSISTENT',   // File-based persistence
    SENSITIVE = 'SENSITIVE'      // For sensitive data (with sanitization)

}
```

## 2. Specialized Caches

### ToolCache (`src/services/cache/specialized/tool-cache.ts`)
- **Purpose**: Caches tool definitions and results
- **Features**:
  - Memory usage monitoring
  - Smart cleanup strategies
  - Cache hit/miss tracking
  - Multiple caching strategies (replace, increment, max)
  - Automatic cleanup of least used entries
- **Usage**:
```typescript
const toolCache = ToolCache.getInstance();
await toolCache.set('toolName', input, result, {
    ttl: 300,
    tags: ['category'],
    strategy: 'increment'
});
```

### SessionCache (in Discord Service)
- **Purpose**: Manages Discord conversation sessions
- **Location**: Integrated in `src/types/discord.ts`
- **Features**:
  - Persistent session storage
  - Conversation state management
  - Message history tracking

## 3. Cache Providers

### MemoryProvider (`src/services/cache/providers/memory-provider.ts`) !!! THIS MIGHT BE INCORECT; CURRENTLY USING KYEV IN services/cache/cache-service.ts
- **Purpose**: In-memory caching implementation
- **Features**:
  - Fast access
  - TTL support
  - Namespace isolation
  - Built-in metrics
  - Automatic cleanup

## Cache Flow Examples

### 1. Tool Caching Flow
```typescript
// 1. Try to get from cache
const result = await toolCache.get('myTool', input);
if (result) return result;

// 2. If miss, compute and cache
const newResult = await computeExpensiveOperation();
await toolCache.set('myTool', input, newResult, {
    ttl: 300,
    tags: ['computation']
});
```

### 2. Session Caching Flow
```typescript
const session = await SessionCache.getInstance(provider);
await session.set(conversationId, {
    messages: [],
    model: 'gpt-4',
    createdAt: new Date()
});
```

## Memory Management

### Automatic Cleanup Strategies
1. **Usage-Based**:
   - Tracks hit rates
   - Removes least used entries
   - Maintains memory limits

2. **TTL-Based**:
   - Automatic expiration
   - Configurable per cache entry

3. **Memory-Based**:
   - Monitors heap usage
   - Triggers cleanup at 90% threshold
   - Selective cleanup before full clear

## Metrics and Monitoring

### Available Metrics
- Hit/Miss rates
- Memory usage
- Response times
- Error counts
- Entry counts

### Monitoring
- Automatic performance logging
- Memory usage alerts
- Cache effectiveness tracking

## Best Practices

1. **Cache Selection**:
   - Use `CacheService` for general purpose caching
   - Use specialized caches for specific features
   - Consider persistence needs when choosing cache type

2. **Key Generation**:
   - Use consistent key patterns
   - Include version/namespace
   - Consider input size limits

3. **Error Handling**:
   - Always handle cache failures gracefully
   - Provide fallback mechanisms
   - Log cache errors appropriately

4. **Memory Management**:
   - Set appropriate TTLs
   - Monitor memory usage
   - Use cleanup strategies

## Future Improvements

1. **Planned Features**:
   - Redis provider implementation
   - More granular invalidation
   - Cache warming strategies
   - Better metrics visualization

2. **Performance Optimizations**:
   - Batch operations
   - Compression for large values
   - Smarter cleanup algorithms

## Integration Points

### System Prompt Generator
- Uses `ToolCache` for caching relevant tools
- Implements smart caching strategies
- Handles cache misses gracefully

### Discord Service
- Uses `SessionCache` for conversation management
- Implements persistent storage
- Handles sensitive data appropriately 