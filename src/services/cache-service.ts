import Keyv from 'keyv';
import { KeyvFile } from 'keyv-file';
import { DatabaseService } from './db-service.js';
import { debug } from '../utils/config.js';

interface CacheConfig {
    filename: string;
    namespace?: string;
    ttl?: number;
}

interface CacheEntry<T> {
    data: T;
    expires: number;
}

interface CacheMetrics {
    hits: number;
    misses: number;
    lastAccessed: Date;
}


export class CacheError extends Error {
    constructor(message: string, public cause?: unknown) {
        super(message);
        this.name = 'CacheError';
        Object.setPrototypeOf(this, CacheError.prototype);
    }
}

export class CacheService {
    private static instance: CacheService;
    private readonly cache: Keyv;
    private readonly metricsCache: Keyv;
    private readonly db: DatabaseService;

    private constructor(config: CacheConfig) {
        // Initialize file-based Keyv cache
        this.cache = new Keyv({
            store: new KeyvFile({
                filename: config.filename
            }),
            namespace: config.namespace || 'conversations',
            ttl: config.ttl || 24 * 60 * 60 * 1000 // Default 24h TTL
        });

        // Separate cache for metrics
        this.metricsCache = new Keyv({
            store: new KeyvFile({
                filename: config.filename + '.metrics'
            }),
            namespace: 'metrics'
        });

        this.db = DatabaseService.getInstance();

        // Handle cache errors
        this.cache.on('error', (err: Error) => console.error('Cache Error:', err));
        this.metricsCache.on('error', (err: Error) => console.error('Metrics Cache Error:', err));
    }

    static getInstance(config?: CacheConfig): CacheService {
        if (!CacheService.instance) {
            if (!config) {
                throw new CacheError('CacheService must be initialized with config first');
            }
            CacheService.instance = new CacheService(config);
        }
        return CacheService.instance;
    }

    private async updateMetrics(key: string, hit: boolean): Promise<void> {
        try {
            const existingMetrics = (await this.metricsCache.get(key)) as CacheMetrics | undefined;
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

    async get<T>(key: string): Promise<T | null> {
        try {
            const cached = await this.cache.get(key) as CacheEntry<T>;
            
            if (cached) {
                debug(`Cache hit for key: ${key}`);
                await this.updateMetrics(key, true);
                return cached.data;
            }

            debug(`Cache miss for key: ${key}`);
            await this.updateMetrics(key, false);
            return null;
        } catch (error) {
            throw new CacheError(`Failed to get cache entry: ${key}`, error);
        }
    }

    async set<T>(
        key: string, 
        data: T, 
        ttl?: number
    ): Promise<boolean> {
        try {
            const entry: CacheEntry<T> = {
                data,
                expires: Date.now() + (ttl || (this.cache.opts?.ttl ?? 24 * 60 * 60 * 1000)),
            };

            return await this.cache.set(key, entry, ttl);
        } catch (error) {
            throw new CacheError(`Failed to set cache entry: ${key}`, error);
        }
    }

    async delete(key: string): Promise<boolean> {
        try {
            return await this.cache.delete(key);
        } catch (error) {
            throw new CacheError(`Failed to delete cache entry: ${key}`, error);
        }
    }

    async clear(): Promise<void> {
        try {
            await this.cache.clear();
            await this.metricsCache.clear();
        } catch (error) {
            throw new CacheError('Failed to clear cache', error);
        }
    }

    async getMetrics(key: string): Promise<CacheMetrics | null> {
        try {
            const metrics = await this.metricsCache.get(key) as CacheMetrics | undefined;
            return metrics || null;
        } catch (error) {
            throw new CacheError(`Failed to get metrics for key: ${key}`, error);
        }
    }
}
