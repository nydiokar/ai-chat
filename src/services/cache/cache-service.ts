import { Keyv } from 'keyv';
import { KeyvFile } from 'keyv-file';
import { DatabaseService } from '../db-service.js';
import { debug, info } from '../../utils/logger.js';
import type { CacheConfig } from '../../types/cache/base.js';
import { CacheType } from '../../types/cache/types.js';
import { CacheMetrics } from '../../types/cache/types.js';
import fs from 'fs';
import path from 'path';

// Extended Keyv interface to include store
interface ExtendedKeyv<T> extends Keyv<T> {
    store: {
        entries?: () => Promise<[string, { expires: number; value: T }][]>;
    };
}

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
    private readonly cache: ExtendedKeyv<any>;
    private readonly longTermCache: ExtendedKeyv<any>;
    private readonly metricsCache: ExtendedKeyv<CacheMetrics>;
    private readonly db: DatabaseService;
    private readonly type: CacheType;
    private readonly maxFileSize: number = 50 * 1024 * 1024; // 50MB default max file size
    private readonly rotationCheckInterval: number = 60 * 60 * 1000; // Check every hour
    private rotationTimer?: NodeJS.Timeout;
    private readonly cacheFile: string;
    private readonly sensitivePatterns = [
        /github_pat_[a-zA-Z0-9_]+/g,
        /ghp_[a-zA-Z0-9]{36}/g,
        /[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+@github\.com/g,
        /(access|api|auth|secret|token|key).*['"]\s*:\s*['"][a-zA-Z0-9_-]+['"]/gi
    ];

    private constructor(config: CacheConfig) {
        this.type = config.type;
        this.cacheFile = config.filename || '';
        
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

            // Create cache instances
            this.cache = new Keyv({
                ...defaultOptions,
                store,
                namespace: `${defaultOptions.namespace}:data`
            }) as ExtendedKeyv<any>;

            this.longTermCache = new Keyv({
                ...defaultOptions,
                store,
                namespace: `${defaultOptions.namespace}:long-term`
            }) as ExtendedKeyv<any>;

            this.metricsCache = new Keyv({
                ...defaultOptions,
                store,
                namespace: `${defaultOptions.namespace}:metrics`
            }) as ExtendedKeyv<CacheMetrics>;

            // Set up error handlers
            this.cache.on('error', this.handleCacheError.bind(this, 'main'));
            this.longTermCache.on('error', this.handleCacheError.bind(this, 'long-term'));
            this.metricsCache.on('error', this.handleCacheError.bind(this, 'metrics'));

            this.db = DatabaseService.getInstance();

            // Start cache rotation checks if using file storage
            if (this.type === CacheType.PERSISTENT && config.filename) {
                this.startRotationChecks();
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            debug(`Failed to initialize cache: ${err.message}`);
            if (err.stack) debug(err.stack);
            throw new CacheError('Failed to initialize cache service', err);
        }
    }

    private handleCacheError(cacheType: string, err: Error): void {
        debug(`Cache error in ${cacheType} cache: ${err.message}`);
        if (err.stack) debug(err.stack);
    }

    private startRotationChecks(): void {
        // Clear any existing timer
        if (this.rotationTimer) {
            clearInterval(this.rotationTimer);
        }

        // Start periodic checks
        this.rotationTimer = setInterval(async () => {
            await this.checkAndRotateCache();
        }, this.rotationCheckInterval);

        // Initial check
        void this.checkAndRotateCache();
    }

    private async checkAndRotateCache(): Promise<void> {
        if (!this.cacheFile) {
            return;
        }

        try {
            const stats = await fs.promises.stat(this.cacheFile);
            if (stats.size > this.maxFileSize) {
                const backupPath = `${this.cacheFile}.${Date.now()}.bak`;
                
                // Create backup of current cache
                await fs.promises.copyFile(this.cacheFile, backupPath);
                
                // Clear the current cache
                await this.clear();
                
                // Keep only the last 3 backups
                const dir = path.dirname(this.cacheFile);
                const base = path.basename(this.cacheFile);
                const backups = (await fs.promises.readdir(dir))
                    .filter(file => file.startsWith(base) && file.endsWith('.bak'))
                    .sort()
                    .reverse();
                
                // Remove old backups
                for (const backup of backups.slice(3)) {
                    await fs.promises.unlink(path.join(dir, backup))
                        .catch(err => debug(`Failed to remove old backup ${backup}: ${err.message}`));
                }

                info(`Cache file rotated. Size was ${Math.round(stats.size / 1024 / 1024)}MB`);
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            debug(`Cache rotation check failed: ${err.message}`);
            if (err.stack) debug(err.stack);
        }
    }

    private async clear(): Promise<void> {
        try {
            await this.cache.clear();
            await this.longTermCache.clear();
            await this.metricsCache.clear();
            debug('Cache cleared successfully');
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            debug(`Failed to clear cache: ${err.message}`);
            if (err.stack) debug(err.stack);
            throw new CacheError('Failed to clear cache', err);
        }
    }

    private async cleanExpiredEntries(): Promise<void> {
        if (!this.cache.store?.entries || !this.longTermCache.store?.entries) {
            debug('Store does not support entries() method, skipping cleanup');
            return;
        }

        try {
            const now = Date.now();
            const entries = await this.cache.store.entries();
            const longTermEntries = await this.longTermCache.store.entries();

            // Process entries from both caches
            for (const [key, { expires }] of entries) {
                if (expires && expires < now) {
                    await this.cache.delete(key);
                }
            }

            for (const [key, { expires }] of longTermEntries) {
                if (expires && expires < now) {
                    await this.longTermCache.delete(key);
                }
            }

            debug('Cache cleanup completed');
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            debug(`Error during cache cleanup: ${err.message}`);
            if (err.stack) debug(err.stack);
        }
    }

    public async cleanup(): Promise<void> {
        if (this.rotationTimer) {
            clearInterval(this.rotationTimer);
        }

        await this.cleanExpiredEntries();
        await this.checkAndRotateCache();
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
                lastAccessed: new Date(),
                errorCount: 0
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
