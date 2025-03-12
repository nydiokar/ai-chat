import Keyv from 'keyv';
import { KeyvFile } from 'keyv-file';
import { DatabaseService } from './db-service.js';
import { debug } from '../utils/config.js';

// Define the Keyv instance type
type KeyvInstance<T> = {
    get: (key: string) => Promise<T | undefined>;
    set: (key: string, value: T, ttl?: number) => Promise<void>;
    delete: (key: string) => Promise<boolean>;
    clear: () => Promise<void>;
    on: (event: string, handler: (err: Error) => void) => void;
};

// Define strict cache types for security
export enum CacheType {
    SENSITIVE = 'SENSITIVE',    // Always in-memory, never persisted
    PERSISTENT = 'PERSISTENT'   // Can be persisted to file
}

interface CacheConfig {
    type: CacheType;           // Required security level
    filename?: string;         // Only used if type is PERSISTENT
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

        // Only allow file storage for non-sensitive data
        const store = this.type === CacheType.PERSISTENT && config.filename ? 
            new KeyvFile({ filename: config.filename }) : 
            undefined;

        if (this.type === CacheType.SENSITIVE && config.filename) {
            debug('Warning: Ignoring filename for sensitive cache - data will be stored in memory only');
        }

        // Create cache instances with proper typing
        this.cache = new (Keyv as any)({
            ...defaultOptions,
            store,
            ttl: config.ttl || 1000 * 60 * 60 // 1 hour
        });

        this.longTermCache = new (Keyv as any)({
            ...defaultOptions,
            store,
            ttl: config.ttl || 1000 * 60 * 60 * 24 * 7 // 1 week
        });

        this.metricsCache = new (Keyv as any)({
            ...defaultOptions,
            namespace: `${defaultOptions.namespace}:metrics`,
            store,
            ttl: 1000 * 60 * 60 * 24 * 30 // 30 days
        });

        this.db = DatabaseService.getInstance();

        // Handle cache errors with proper typing
        this.cache.on('error', (err: Error) => console.error('Cache Error:', err));
        this.longTermCache.on('error', (err: Error) => console.error('Long Term Cache Error:', err));
        this.metricsCache.on('error', (err: Error) => console.error('Metrics Cache Error:', err));
    }

    public static getInstance(config: CacheConfig): CacheService {
        // Create a unique key combining namespace and type
        const key = `${config.namespace || 'default'}:${config.type}`;
        if (!this.instances.has(key)) {
            this.instances.set(key, new CacheService(config));
        }
        return this.instances.get(key)!;
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
        const sanitizedValue = this.sanitizeData(value);
        await this.cache.set(key, sanitizedValue, ttl);
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
