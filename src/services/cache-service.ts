import Keyv from 'keyv';
import { KeyvFile } from 'keyv-file';
import { DatabaseService } from './db-service.js';
import { debug } from '../utils/config.js';

interface CacheConfig {
    filename: string;
    namespace?: string;
    ttl?: number;
    sensitive?: boolean;
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
    private readonly sensitivePatterns = [
        /github_pat_[a-zA-Z0-9_]+/g,
        /ghp_[a-zA-Z0-9]{36}/g,
        /[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+@github\.com/g,
        /(access|api|auth|secret|token|key).*['"]\s*:\s*['"][a-zA-Z0-9_-]+['"]/gi
    ];

    private constructor(config: CacheConfig) {
        // Use memory store for sensitive data
        const store = config.sensitive ? new Map() : new KeyvFile({
            filename: config.filename
        });

        // Initialize cache with appropriate store
        this.cache = new Keyv({
            store,
            namespace: config.namespace || 'conversations',
            ttl: config.ttl || 24 * 60 * 60 * 1000 // Default 24h TTL
        });

        // Separate cache for metrics (always file-based as it doesn't contain sensitive data)
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

    // Sanitize data before caching
    private sanitizeData(data: any): any {
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

    // Modified set method to include sanitization
    public async set(key: string, value: any, ttl?: number): Promise<boolean> {
        const sanitizedValue = this.sanitizeData(value);
        return this.cache.set(key, sanitizedValue, ttl);
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
