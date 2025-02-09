import NodeCache from 'node-cache';
import crypto from 'crypto';
import winston from 'winston';

export interface CacheConfig {
  defaultTTL?: number;
  checkPeriod?: number;
  maxKeys?: number;
  memoryLimit?: number;
}

export interface CacheEntry<T> {
  data: T;
  metadata: {
    createdAt: number;
    lastAccessed: number;
    hits: number;
    size: number;
    toolName: string;
    tags?: string[];
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

export class ToolCacheService {
  private cache: NodeCache;
  private logger: winston.Logger;
  private config: Required<CacheConfig>;
  private stats: {
    hits: number;
    misses: number;
    totalQueries: number;
  };

  constructor(config: CacheConfig = {}) {
    // Default configuration
    this.config = {
      defaultTTL: config.defaultTTL || 3600, // 1 hour default
      checkPeriod: config.checkPeriod || 600, // 10 minutes
      maxKeys: config.maxKeys || 1000, // Maximum number of cache entries
      memoryLimit: config.memoryLimit || 256 // MB
    };

    this.cache = new NodeCache({
      stdTTL: this.config.defaultTTL,
      checkperiod: this.config.checkPeriod,
      useClones: false // Improve performance by not cloning objects
    });

    // Initialize stats tracking
    this.stats = {
      hits: 0,
      misses: 0,
      totalQueries: 0
    };

    // Setup logging
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({ filename: 'tool-cache.log' }),
        new winston.transports.Console()
      ]
    });

    // Setup periodic cache monitoring
    this.setupCacheMonitoring();
  }

  // Generate a consistent cache key
  private generateCacheKey(toolName: string, input: any, tags?: string[]): string {
    const inputString = JSON.stringify(input);
    const tagString = tags ? tags.sort().join(',') : '';
    return crypto
      .createHash('sha256')
      .update(`${toolName}:${inputString}:${tagString}`)
      .digest('hex');
  }

  // Calculate object size in bytes
  private calculateObjectSize(obj: any): number {
    try {
      return Buffer.byteLength(JSON.stringify(obj), 'utf8');
    } catch {
      return 0;
    }
  }

  // Get current memory usage
  private getCurrentMemoryUsage(): number {
    return process.memoryUsage().heapUsed;
  }

  // Cache a tool result with advanced options
  set<T>(
    toolName: string, 
    input: any, 
    result: T, 
    options: { 
      ttl?: number; 
      tags?: string[];
      strategy?: 'replace' | 'increment' | 'max'
    } = {}
  ): boolean {
    const { 
      ttl = this.config.defaultTTL, 
      tags = [],
      strategy = 'replace'
    } = options;

    const cacheKey = this.generateCacheKey(toolName, input, tags);
    const entrySize = this.calculateObjectSize(result);

    // Check memory limit
    if (this.getCurrentMemoryUsage() + entrySize > this.config.memoryLimit * 1024 * 1024) {
      this.logger.warn('Cache memory limit exceeded', { 
        toolName, 
        currentMemory: this.getCurrentMemoryUsage(),
        limit: this.config.memoryLimit * 1024 * 1024 
      });
      return false;
    }

    // Existing entry handling based on strategy
    const existingEntry = this.cache.get<CacheEntry<T>>(cacheKey);
    let finalResult = result;

    if (existingEntry) {
      switch (strategy) {
        case 'increment':
          // For numeric results, increment
          if (typeof result === 'number' && typeof existingEntry.data === 'number') {
            finalResult = (existingEntry.data + result) as T;
          }
          break;
        case 'max':
          // For numeric results, take the maximum
          if (typeof result === 'number' && typeof existingEntry.data === 'number') {
            finalResult = Math.max(existingEntry.data as number, result as number) as T;
          }
          break;
        default:
          // 'replace' strategy - overwrite existing entry
          break;
      }
    }

    const cacheEntry: CacheEntry<T> = {
      data: finalResult,
      metadata: {
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        hits: 0,
        size: entrySize,
        toolName,
        tags
      }
    };

    // Store in cache with TTL
    return this.cache.set(cacheKey, cacheEntry, ttl);
  }

  // Retrieve a cached result
  get<T>(toolName: string, input: any, tags?: string[]): T | undefined {
    const cacheKey = this.generateCacheKey(toolName, input, tags);
    const entry = this.cache.get<CacheEntry<T>>(cacheKey);

    // Update stats
    this.stats.totalQueries++;
    if (entry) {
      this.stats.hits++;
      
      // Update entry metadata
      if (entry.metadata) {
        entry.metadata.hits++;
        entry.metadata.lastAccessed = Date.now();
      }
    } else {
      this.stats.misses++;
    }

    return entry?.data;
  }

  // Remove entries by tool name or tags
  invalidate(options: { 
    toolName?: string; 
    tags?: string[] 
  }): number {
    const { toolName, tags } = options;
    let removedCount = 0;

    this.cache.keys().forEach(key => {
      const entry = this.cache.get(key) as CacheEntry<any>;
      
      // Check if entry matches invalidation criteria
      const matchToolName = !toolName || entry.metadata.toolName === toolName;
      const matchTags = !tags || 
        (entry.metadata.tags && 
         tags.some(tag => entry.metadata.tags?.includes(tag)));

      if (matchToolName && matchTags) {
        this.cache.del(key);
        removedCount++;
      }
    });

    this.logger.info('Cache invalidation', { 
      toolName, 
      tags, 
      removedCount 
    });

    return removedCount;
  }

  // Setup periodic cache monitoring
  private setupCacheMonitoring() {
    if (process.env.NODE_ENV !== 'test') {
      // Log cache stats periodically in non-test environments
      setInterval(() => {
        const stats = this.getStats();
        this.logger.info('Cache Performance', stats);

        // Optional: Implement cleanup if hit rate is low and entries exist
        if (stats.hitRate < 0.5 && stats.totalEntries > 0) {
          this.logger.warn('Low cache hit rate, performing cleanup');
          this.invalidateUnusedEntries();
        }
      }, this.config.checkPeriod * 1000);
    }
  }

  // Get current cache statistics
  getStats(): CacheStats {
    return {
      totalEntries: this.cache.keys().length,
      memoryUsage: this.getCurrentMemoryUsage(),
      hitRate: this.stats.hits / (this.stats.totalQueries || 1),
      missRate: this.stats.misses / (this.stats.totalQueries || 1),
      totalHits: this.stats.hits,
      totalMisses: this.stats.misses
    };
  }

  // Cleanup unused or least recently used entries
  private invalidateUnusedEntries() {
    const now = Date.now();
    const entriesWithTimestamp = this.cache.keys()
      .map(key => {
        const entry = this.cache.get(key) as CacheEntry<any>;
        return { 
          key, 
          lastAccessed: entry.metadata.lastAccessed,
          hits: entry.metadata.hits
        };
      })
      .sort((a, b) => {
        // Sort by least hits and oldest access
        if (a.hits !== b.hits) return a.hits - b.hits;
        return a.lastAccessed - b.lastAccessed;
      });

    // Remove bottom 20% of entries
    const entriesToRemove = entriesWithTimestamp
      .slice(0, Math.floor(entriesWithTimestamp.length * 0.2))
      .map(entry => entry.key);

    entriesToRemove.forEach(key => this.cache.del(key));

    this.logger.info('Cleanup of unused cache entries', {
      totalEntries: entriesWithTimestamp.length,
      removedEntries: entriesToRemove.length
    });
  }

  // Clear entire cache
  clear(): void {
    this.cache.flushAll();
    this.stats = {
      hits: 0,
      misses: 0,
      totalQueries: 0
    };
    this.logger.info('Cache completely cleared');
  }
}
