# Cache Migration Plan

## Stage 1: Core Tool Definition Caching
**Goal**: Cache tool definitions to avoid reloading/re-fetching on every server restart

### 1. Core Cache Types
```typescript
// src/types/cache/base.ts
interface ICache<T> {
    get(key: string): Promise<T | null>;
    set(key: string, value: T, ttl?: number): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
}

interface ICacheProvider extends ICache<any> {
    namespace: string;
    type: CacheType;
}

export enum CacheType {
    MEMORY = 'MEMORY',           // Short-lived, in-memory only
    PERSISTENT = 'PERSISTENT',   // File-based persistence
    SENSITIVE = 'SENSITIVE',     // Always in-memory, sanitized
    DISTRIBUTED = 'DISTRIBUTED'  // Redis/distributed cache
}
```

### 2. Tool Cache Implementation
```typescript
// src/services/cache/tool-cache.ts
interface CachedTool {
    name: string;
    schema: object;
    instructions?: string;
    metadata: {
        lastFetched: number;
        lastValidated: number;
        errorCount: number;
        version?: string;
    }
}

class ToolCache {
    // Methods for managing tool definitions
    async getTool(toolName: string): Promise<CachedTool | null>;
    async cacheTool(toolName: string, schema: object, instructions?: string): Promise<void>;
    async validateTool(toolName: string): Promise<boolean>;
    async invalidateTool(toolName: string): Promise<void>;
}
```

### Migration Steps:
1. ✅ Create base cache types
2. ✅ Implement tool definition caching
3. ✅ Add tool validation and error tracking
4. Remove old tool caching implementation
5. Delete LangChain-related files

## Stage 2: Command Parsing Cache
**Goal**: Optimize command parsing performance

### Command Cache Implementation
```typescript
// src/services/cache/command-cache.ts
interface ParsedCommand {
    action: string;
    parameters: any;
    metadata?: {
        lastUsed: number;
        usageCount: number;
        parseTime: number;
    }
}

class CommandCache extends CacheService {
    async getParsedCommand(input: string): Promise<ParsedCommand | null>;
    async setParsedCommand(input: string, command: ParsedCommand): Promise<void>;
}
```

## Stage 3: Session Cache
**Goal**: Optimize Discord service session handling

### Session Cache Implementation
```typescript
// src/services/cache/session-cache.ts
interface SessionData {
    conversation: DiscordCachedConversation;
    lastAccessed: number;
    metadata?: {
        messageCount: number;
        lastMessageTimestamp: number;
        hasActiveCommand: boolean;
    }
}
```

## Files to Delete
1. `src/tools/MCPLangChainTool.ts` - Remove LangChain integration
2. `src/tools/cache/tool-cache.ts` - Old implementation
3. `src/types/domain/cache.ts` - Moved to discord.ts
4. `src/types/services/cache.ts` - Consolidated in new structure

## Additional Caching Needs to Consider
1. **API Response Caching**:
   - Cache external API responses
   - Implement rate limiting
   - Track API usage metrics

2. **Configuration Caching**:
   - Server settings
   - User preferences
   - Environment-specific configs

3. **Error Cache**:
   - Track error patterns
   - Cache error responses
   - Error rate monitoring

## Testing Strategy
1. **Unit Tests**
   - Tool definition caching
   - Cache invalidation
   - Error handling
   - Metrics collection

2. **Integration Tests**
   - Tool loading with cache
   - Command parsing performance
   - Session management
   - Cache persistence across restarts

3. **Performance Metrics**
   - Cache hit rates
   - Tool loading times
   - Memory usage
   - Persistence overhead

## Success Criteria
1. ✅ Tool definitions persist across restarts
2. ✅ Reduced tool loading times
3. ✅ Proper error tracking and validation
4. ✅ Clear separation of cache types
5. ✅ Simplified caching architecture

## Critical Improvements

### 1. Cache Type Standardization
```typescript
export enum CacheType {
    MEMORY = 'MEMORY',           // Short-lived, in-memory only
    PERSISTENT = 'PERSISTENT',   // File-based persistence
    SENSITIVE = 'SENSITIVE',     // Always in-memory, sanitized
    DISTRIBUTED = 'DISTRIBUTED'  // Redis/distributed cache
}
```

### 2. Database Integration
- Separate database operations into interface
- Add cache-database sync strategies
- Implement cache-aside pattern
```typescript
interface ICachePersistence {
    sync(key: string, value: any): Promise<void>;
    load(key: string): Promise<any>;
    invalidate(key: string): Promise<void>;
}
```

### 3. Cache Provider Architecture
```typescript
interface ICacheProvider<T> {
    get(key: string): Promise<T | null>;
    set(key: string, value: T, ttl?: number): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
    getMetrics(): Promise<CacheMetrics>;
}

class RedisProvider implements ICacheProvider<any> { ... }
class FileProvider implements ICacheProvider<any> { ... }
class MemoryProvider implements ICacheProvider<any> { ... }
```

### 4. Cache Eviction & Cleanup
- Implement TTL-based eviction
- Add memory pressure monitoring
- Implement LRU eviction policy
- Add cache size limits

### 5. Cache Synchronization
- Add pub/sub for distributed cache updates
- Implement cache invalidation broadcasting
- Add versioning for cache entries
- Implement optimistic locking

## Implementation Priorities
1. Standardize CacheType usage across codebase
2. Consolidate tool cache implementations
3. Fix session cache persistence
4. Implement proper database integration
5. Add cache eviction policies
6. Add distributed cache support

## Monitoring & Maintenance
1. Add cache hit/miss ratio monitoring
2. Implement cache warming strategies
3. Add cache entry versioning
4. Implement cache consistency checks

## Additional Caching Needs to Consider
1. **API Response Caching**:
   - Cache external API responses
   - Implement rate limiting
   - Track API usage metrics

2. **Configuration Caching**:
   - Server settings
   - User preferences
   - Environment-specific configs

3. **Error Cache**:
   - Track error patterns
   - Cache error responses
   - Error rate monitoring

## Testing Strategy
1. **Unit Tests**
   - Tool definition caching
   - Cache invalidation
   - Error handling
   - Metrics collection

2. **Integration Tests**
   - Tool loading with cache
   - Command parsing performance
   - Session management
   - Cache persistence across restarts

3. **Performance Metrics**
   - Cache hit rates
   - Tool loading times
   - Memory usage
   - Persistence overhead

## Success Criteria
1. ✅ Tool definitions persist across restarts
2. ✅ Reduced tool loading times
3. ✅ Proper error tracking and validation
4. ✅ Clear separation of cache types
5. ✅ Simplified caching architecture 