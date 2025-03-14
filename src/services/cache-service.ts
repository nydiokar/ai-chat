import Keyv from 'keyv';
import { KeyvFile } from 'keyv-file';
import { DatabaseService } from './db-service.js';
import { debug } from '../utils/config.js';
import type { 
    CacheConfig, 
    CacheMetrics,
    KeyvInstance 
} from '../types/services/cache.js';
import { CacheType } from '../types/services/cache.js';

export { CacheType };

export class CacheError extends Error {
    constructor(message: string, public cause?: unknown) {
        super(message);
        this.name = 'CacheError';
        Object.setPrototypeOf(this, CacheError.prototype);
    }
}

export class CacheService {
    private static instances: Map<string, CacheService> = new Map();
    private readonly cache: KeyvInstance<any>;
    private readonly longTermCache: KeyvInstance<any>;
    private readonly metricsCache: KeyvInstance<CacheMetrics>;
    private readonly db: DatabaseService;
    private readonly type: CacheType;
    private readonly sensitivePatterns = [
        /github_pat_[a-zA-Z0-9_]+/g,
        /ghp_[a-zA-Z0-9]{36}/g,
        /[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+@github\.com/g,
        /(access|api|auth|secret|token|key).*['"]\s*:\s*['"][a-zA-Z0-9_-]+['"]/gi
    ];

    private constructor(config: CacheConfig) {
        this.type = config.type;
        const defaultOptions = {
            namespace: config.namespace || 'mcp',
            ttl: config.ttl || 1000 * 60 * 60 // 1 hour default TTL
        };

        try {
            // Initialize store based on type
            let store;
            if ((this.type === CacheType.PERSISTENT || this.type === CacheType.SENSITIVE) && config.filename) {
                store = new KeyvFile({
                    filename: config.filename,
                    writeDelay: config.writeDelay || 100,
                    serialize: (data: any) => JSON.stringify({
                        value: data,
                        expires: Date.now() + (config.ttl || defaultOptions.ttl)
                    }),
                    deserialize: (text: string) => {
                        const parsed = JSON.parse(text);
                        return parsed.value;
                    }
                });
            }

            // Create cache instances with proper typing and error handling
            const cacheInstance = new Keyv({
                ...defaultOptions,
                store,  // Pass store directly without undefined check
                namespace: `${defaultOptions.namespace}:data`
            });

            // Verify store is properly initialized
            if (!cacheInstance.store) {
                throw new Error('Cache store not properly initialized');
            }

            this.cache = cacheInstance as unknown as KeyvInstance<any>;

            const longTermCacheInstance = new Keyv({
                ...defaultOptions,
                store,  // Pass store directly without undefined check
                namespace: `${defaultOptions.namespace}:long-term`
            });
            this.longTermCache = longTermCacheInstance as unknown as KeyvInstance<any>;

            const metricsCacheInstance = new Keyv({
                ...defaultOptions,
                store,  // Pass store directly without undefined check
                namespace: `${defaultOptions.namespace}:metrics`
            });
            this.metricsCache = metricsCacheInstance as unknown as KeyvInstance<CacheMetrics>;

            // Set up error handlers with more detailed logging
            this.cache.on('error', err => {
                debug(`Cache error in main cache: ${err.message}`);
                if (err.stack) debug(err.stack);
            });

            this.longTermCache.on('error', err => {
                debug(`Cache error in long-term cache: ${err.message}`);
                if (err.stack) debug(err.stack);
            });

            this.metricsCache.on('error', err => {
                debug(`Cache error in metrics cache: ${err.message}`);
                if (err.stack) debug(err.stack);
            });

            this.db = DatabaseService.getInstance();
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            debug(`Failed to initialize cache: ${err.message}`);
            if (err.stack) debug(err.stack);
            throw new CacheError('Failed to initialize cache service', err);
        }
    }

    public static getInstance(config: CacheConfig): CacheService {
        try {
            // Create a unique key combining namespace and type
            const key = `${config.namespace || 'default'}:${config.type}`;
            
            if (!this.instances.has(key)) {
                const instance = new CacheService(config);
                this.instances.set(key, instance);
            }
            
            const instance = this.instances.get(key);
            if (!instance) {
                throw new Error('Failed to get cache instance');
            }
            
            return instance;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            debug(`Failed to get cache instance: ${err.message}`);
            throw new CacheError('Failed to get cache instance', err);
        }
    }

    private async updateMetrics(key: string, hit: boolean): Promise<void> {
        try {
            const existingMetrics = await this.metricsCache.get(key);
            const metrics: CacheMetrics = existingMetrics || {
                hits: 0,
                misses: 0,
                lastAccessed: new Date()
            };

            if (hit) {
                metrics.hits++;
            } else {
                metrics.misses++;
            }
            metrics.lastAccessed = new Date();

            await this.metricsCache.set(key, metrics);

            // Periodically sync metrics to database
            if ((metrics.hits + metrics.misses) % 100 === 0) {
                await this.db.upsertCacheMetrics({
                    key,
                    hits: metrics.hits,
                    misses: metrics.misses,
                    lastAccessed: metrics.lastAccessed
                });
            }
        } catch (error) {
            throw new CacheError('Failed to update cache metrics', error);
        }
    }

    async get<T>(key: string): Promise<T | undefined> {
        try {
            const value = await this.cache.get(key);
            await this.updateMetrics(key, value !== undefined);
            return value;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            debug(`Cache get error for key ${key}: ${err.message}`);
            if (err.stack) debug(err.stack);
            throw new CacheError(`Failed to get cache entry: ${key}`, error);
        }
    }

    // Sanitize data before caching - now always applied for sensitive caches
    private sanitizeData(data: any): any {
        // Always sanitize if it's a sensitive cache
        if (this.type !== CacheType.SENSITIVE) {
            return data;
        }

        if (typeof data === 'string') {
            // Replace sensitive patterns with [REDACTED]
            let sanitized = data;
            this.sensitivePatterns.forEach(pattern => {
                sanitized = sanitized.replace(pattern, '[REDACTED]');
            });
            return sanitized;
        }
        
        if (Array.isArray(data)) {
            return data.map(item => this.sanitizeData(item));
        }
        
        if (typeof data === 'object' && data !== null) {
            const sanitized: any = {};
            for (const [key, value] of Object.entries(data)) {
                sanitized[key] = this.sanitizeData(value);
            }
            return sanitized;
        }
        
        return data;
    }

    public async set(key: string, value: any, ttl?: number): Promise<void> {
        try {
            const sanitizedValue = this.sanitizeData(value);
            await this.cache.set(key, sanitizedValue, ttl);
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            debug(`Cache set error for key ${key}: ${err.message}`);
            if (err.stack) debug(err.stack);
            throw new CacheError(`Failed to set cache entry: ${key}`, error);
        }
    }

    async delete(key: string): Promise<boolean> {
        return this.cache.delete(key);
    }

    async clear(): Promise<void> {
        await this.cache.clear();
        await this.metricsCache.clear();
    }

    async getMetrics(key: string): Promise<CacheMetrics | null> {
        try {
            const metrics = await this.metricsCache.get(key);
            return metrics || null;
        } catch (error) {
            throw new CacheError(`Failed to get metrics for key: ${key}`, error);
        }
    }

    async setLongTerm(key: string, value: any, ttl?: number): Promise<void> {
        await this.longTermCache.set(key, value, ttl);
    }

    async getLongTerm<T>(key: string): Promise<T | undefined> {
        return this.longTermCache.get(key);
    }

    async deleteLongTerm(key: string): Promise<boolean> {
        return this.longTermCache.delete(key);
    }

    async clearLongTerm(): Promise<void> {
        await this.longTermCache.clear();
    }
}
