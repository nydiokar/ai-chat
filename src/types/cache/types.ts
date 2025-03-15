/**
 * Base types of caching strategies
 */
export enum CacheType {
    MEMORY = 'MEMORY',      // In-memory only, no persistence
    PERSISTENT = 'PERSISTENT', // File-based persistence
    SENSITIVE = 'SENSITIVE',  // For sensitive data, always in-memory
    SENSITIVE_ALWAYS = 'SENSITIVE_ALWAYS',  // Always in-memory, never persisted
    PERSISTENT_SHORT_LIVED = 'PERSISTENT_SHORT_LIVED',  // Can be persisted to file, short-lived memory cache
    MEMORY_SHORT_LIVED = 'MEMORY_SHORT_LIVED'          // Short-lived memory cache
}

/**
 * Common metadata for all cache entries
 */
export interface CacheMetadata {
    createdAt: number;
    lastAccessed: number;
    hits: number;
    size: number;
}

/**
 * Generic cache entry structure
 */
export interface CacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number;
    metadata?: {
        createdAt: number;
        lastAccessed: number;
        hits: number;
        size: number;
        toolName?: string;
        tags?: string[];
    };
}

/**
 * Cache metrics for monitoring and optimization
 */
export interface CacheMetrics {
    hits: number;
    misses: number;
    lastAccessed: Date;
    avgResponseTime?: number;
    errorCount: number;
    resultCacheHits?: number;
    resultCacheMisses?: number;
    lastError?: {
        message: string;
        timestamp: Date;
    };
}

export interface CacheStats {
    totalEntries: number;
    memoryUsage: number;
    hitRate: number;
    missRate: number;
    totalHits: number;
    totalMisses: number;
} 