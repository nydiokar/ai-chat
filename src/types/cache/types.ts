/**
 * Base types of caching strategies
 * Simplified to essential types based on actual usage patterns
 */
export enum CacheType {
    MEMORY = 'MEMORY',      // In-memory only, no persistence
    PERSISTENT = 'PERSISTENT', // File-based persistence
    SENSITIVE = 'SENSITIVE'  // For sensitive data, always in-memory with sanitization
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
 * Generic cache entry structure with additional schema-specific fields
 */
export interface CacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number;
    metadata: {
        createdAt: number;
        lastAccessed: number;
        hits: number;
        size: number;
        isSchema?: boolean;    // Identifier for tool schema entries
        toolName?: string;
        tags?: string[];
        compressed?: boolean;  // Flag for compressed data
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
