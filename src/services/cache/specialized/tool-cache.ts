import { CacheService, CacheType } from '../cache-service.js';
import { ToolDefinition } from '../../../tools/mcp/types/tools.js';
import { debug } from '../../../utils/config.js';
import crypto from 'crypto';
import winston from 'winston';

export interface ToolCacheOptions {
    ttl?: number;
    namespace?: string;
    tags?: string[];
    strategy?: 'replace' | 'increment' | 'max';
}

export interface ToolCacheStats {
    totalEntries: number;
    memoryUsage: number;
    hitRate: number;
    missRate: number;
    totalHits: number;
    totalMisses: number;
}

export class ToolCache {
    private static instance: ToolCache;
    private cacheService: CacheService;
    private logger: winston.Logger;
    private stats = {
        hits: 0,
        misses: 0,
        totalQueries: 0
    };

    private readonly memoryLimit = 256; // MB
    private readonly checkPeriod = 600; // 10 minutes

    private constructor() {
        this.cacheService = CacheService.getInstance({
            type: CacheType.PERSISTENT,
            namespace: 'tool-cache',
            ttl: 5 * 60, // 5 minutes default TTL
            filename: 'tool-cache.json'
        });

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

        // Setup monitoring
        this.setupCacheMonitoring();
    }

    public static getInstance(): ToolCache {
        if (!ToolCache.instance) {
            ToolCache.instance = new ToolCache();
        }
        return ToolCache.instance;
    }

    private generateCacheKey(toolName: string, input: any, tags?: string[]): string {
        const data = {
            tool: toolName,
            input: typeof input === 'string' ? input.slice(0, 100) : input,
            tags: tags?.sort() // Sort tags for consistent keys
        };
        return crypto
            .createHash('sha256')
            .update(JSON.stringify(data))
            .digest('hex');
    }

    private getCurrentMemoryUsage(): number {
        return process.memoryUsage().heapUsed;
    }

    private calculateObjectSize(obj: any): number {
        try {
            return Buffer.byteLength(JSON.stringify(obj), 'utf8');
        } catch {
            return 0;
        }
    }

    async get<T>(toolName: string, input: any, tags?: string[]): Promise<T | undefined> {
        try {
            const key = this.generateCacheKey(toolName, input, tags);
            const result = await this.cacheService.get<T>(key);
            
            // Update stats
            this.stats.totalQueries++;
            if (result !== undefined) {
                this.stats.hits++;
                debug('Cache hit for tool: ' + toolName);
            } else {
                this.stats.misses++;
                debug('Cache miss for tool: ' + toolName);
            }

            return result;
        } catch (error) {
            debug(`Tool cache get error: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
    }

    async set<T>(toolName: string, input: any, value: T, options: ToolCacheOptions = {}): Promise<void> {
        try {
            const key = this.generateCacheKey(toolName, input, options.tags);
            const entrySize = this.calculateObjectSize(value);

            // Check memory limit
            if (this.getCurrentMemoryUsage() + entrySize > this.memoryLimit * 1024 * 1024) {
                this.logger.warn('Cache memory limit exceeded', {
                    toolName,
                    entrySize,
                    currentMemory: this.getCurrentMemoryUsage()
                });
                await this.cleanup(); // Try to free up space
            }

            // Handle different cache strategies
            if (options.strategy) {
                const existing = await this.cacheService.get<T>(key);
                if (existing !== undefined) {
                    let finalValue = value;
                    switch (options.strategy) {
                        case 'increment':
                            if (typeof value === 'number' && typeof existing === 'number') {
                                finalValue = (existing + value) as T;
                            }
                            break;
                        case 'max':
                            if (typeof value === 'number' && typeof existing === 'number') {
                                finalValue = Math.max(existing, value) as T;
                            }
                            break;
                    }
                    value = finalValue;
                }
            }

            await this.cacheService.set(key, value, options.ttl);
            debug(`Cached tool result: ${toolName}`);
        } catch (error) {
            debug(`Tool cache set error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async cleanup(): Promise<void> {
        try {
            const stats = await this.getStats();
            
            // If hit rate is low, try smart cleanup first
            if (stats.hitRate < 0.5) {
                this.logger.info('Low hit rate detected, performing selective cleanup');
                await this.invalidateUnusedEntries();
            }
            
            // If memory is still high, clear everything
            if (this.getCurrentMemoryUsage() > this.memoryLimit * 1024 * 1024 * 0.9) {
                this.logger.warn('Memory still high after selective cleanup, clearing all cache');
                await this.cacheService.clear();
                this.resetStats();
            }
        } catch (error) {
            debug(`Cleanup error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async invalidateUnusedEntries(): Promise<void> {
        try {
            // Get all keys from cache service metrics
            const metrics = await this.cacheService.getMetrics('*');
            if (!metrics) return;

            interface EntryMetrics {
                key: string;
                hits: number;
                lastAccessed: Date;
            }

            const entriesWithMetrics: EntryMetrics[] = Object.entries(metrics)
                .map(([key, value]) => ({
                    key,
                    hits: value?.hits || 0,
                    lastAccessed: value?.lastAccessed || new Date(0)
                }));

            if (entriesWithMetrics.length === 0) return;

            // Sort by least hits and oldest access
            entriesWithMetrics.sort((a: EntryMetrics, b: EntryMetrics) => {
                if (a.hits !== b.hits) return a.hits - b.hits;
                return a.lastAccessed.getTime() - b.lastAccessed.getTime();
            });

            // Remove bottom 20% of entries
            const entriesToRemove = entriesWithMetrics
                .slice(0, Math.floor(entriesWithMetrics.length * 0.2))
                .map((entry: EntryMetrics) => entry.key);

            for (const key of entriesToRemove) {
                await this.cacheService.delete(key);
            }

            this.logger.info('Selective cache cleanup completed', {
                totalEntries: entriesWithMetrics.length,
                removedEntries: entriesToRemove.length
            });
        } catch (error) {
            debug(`Selective cleanup error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private setupCacheMonitoring(): void {
        if (process.env.NODE_ENV !== 'test') {
            setInterval(async () => {
                const stats = await this.getStats();
                this.logger.info('Cache Performance', stats);

                // Auto cleanup if memory usage is high
                if (this.getCurrentMemoryUsage() > this.memoryLimit * 1024 * 1024 * 0.9) { // 90% of limit
                    await this.cleanup();
                }
            }, this.checkPeriod * 1000);
        }
    }

    async getStats(): Promise<ToolCacheStats> {
        return {
            totalEntries: 0, // We'll need to implement this with Keyv
            memoryUsage: this.getCurrentMemoryUsage(),
            hitRate: this.stats.hits / (this.stats.totalQueries || 1),
            missRate: this.stats.misses / (this.stats.totalQueries || 1),
            totalHits: this.stats.hits,
            totalMisses: this.stats.misses
        };
    }

    private resetStats(): void {
        this.stats = {
            hits: 0,
            misses: 0,
            totalQueries: 0
        };
    }

    async invalidate(toolName?: string, tags?: string[]): Promise<void> {
        // TODO: Implement selective invalidation based on toolName and tags
        // For now, we'll just clear everything as before
        await this.cacheService.clear();
        this.resetStats();
    }

    async getMetrics(toolName: string): Promise<any> {
        return this.cacheService.getMetrics(toolName);
    }
} 