import { CacheService, CacheType } from '../cache-service.js';
import { ToolDefinition } from '../../../tools/mcp/types/tools.js';
import { debug } from '../../../utils/config.js';
import crypto from 'crypto';
import winston from 'winston';
import zlib from 'zlib';
import { promisify } from 'util';

const compress = promisify(zlib.gzip);
const decompress = promisify(zlib.gunzip);

export interface ToolCacheOptions {
    ttl?: number;
    namespace?: string;
    tags?: string[];
    strategy?: 'replace' | 'increment' | 'max';
    isSchema?: boolean;   // Flag for schema entries
    compress?: boolean;   // Enable compression for large entries
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
        totalQueries: 0,
        schemaHits: 0,
        schemaMisses: 0
    };

    private readonly memoryLimit = 256; // MB
    private readonly checkPeriod = 600; // 10 minutes
    private readonly SCHEMA_TTL = 24 * 60 * 60; // 24 hours for schemas
    private readonly COMPRESSION_THRESHOLD = 1024; // Compress if larger than 1KB

    private constructor() {
        this.cacheService = CacheService.getInstance({
            type: CacheType.PERSISTENT,
            namespace: 'tool-cache',
            ttl: 5 * 60, // 5 minutes default TTL
            filename: 'tool-cache.json'
        });

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

        this.setupCacheMonitoring();
    }

    public static getInstance(): ToolCache {
        if (!ToolCache.instance) {
            ToolCache.instance = new ToolCache();
        }
        return ToolCache.instance;
    }

    private generateCacheKey(toolName: string, input: any, tags?: string[], isSchema: boolean = false): string {
        const data = {
            tool: toolName,
            input: isSchema ? 'schema' : (typeof input === 'string' ? input.slice(0, 100) : input),
            tags: tags?.sort(),
            type: isSchema ? 'schema' : 'data'
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

    private async compressData(data: any): Promise<Buffer> {
        const jsonString = JSON.stringify(data);
        return compress(jsonString);
    }

    private async decompressData<T>(buffer: Buffer): Promise<T> {
        const jsonString = (await decompress(buffer)).toString();
        return JSON.parse(jsonString);
    }

    async getSchema<T extends ToolDefinition>(toolName: string): Promise<T | undefined> {
        try {
            const key = this.generateCacheKey(toolName, null, undefined, true);
            const entry = await this.cacheService.get<{
                compressed: boolean;
                data: Buffer | T;
            }>(key);

            this.stats.totalQueries++;
            
            if (!entry) {
                this.stats.schemaMisses++;
                debug(`Schema cache miss for tool: ${toolName}`);
                return undefined;
            }

            this.stats.schemaHits++;
            debug(`Schema cache hit for tool: ${toolName}`);
            
            if (entry.compressed) {
                return await this.decompressData<T>(entry.data as Buffer);
            }
            return entry.data as T;
        } catch (error) {
            debug(`Schema cache get error: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
    }

    async get<T>(toolName: string, input: any, tags?: string[]): Promise<T | undefined> {
        try {
            const key = this.generateCacheKey(toolName, input, tags);
            const entry = await this.cacheService.get<{
                compressed: boolean;
                data: Buffer | T;
            }>(key);

            this.stats.totalQueries++;

            if (!entry) {
                this.stats.misses++;
                debug(`Tool cache miss for tool: ${toolName}`);
                return undefined;
            }

            this.stats.hits++;
            debug(`Tool cache hit for tool: ${toolName}`);
            
            if (entry.compressed) {
                return await this.decompressData<T>(entry.data as Buffer);
            }
            return entry.data as T;

        } catch (error) {
            debug(`Tool cache get error: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
    }

    async setSchema<T extends ToolDefinition>(toolName: string, value: T): Promise<void> {
        try {
            const key = this.generateCacheKey(toolName, null, undefined, true);
            const size = this.calculateObjectSize(value);

            let entry: { compressed: boolean; data: Buffer | T };
            
            if (size > this.COMPRESSION_THRESHOLD) {
                const compressed = await this.compressData(value);
                entry = { compressed: true, data: compressed };
            } else {
                entry = { compressed: false, data: value };
            }

            await this.cacheService.set(key, entry, this.SCHEMA_TTL);
            debug(`Cached schema for tool: ${toolName}`);
        } catch (error) {
            debug(`Schema cache set error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async set<T>(toolName: string, input: any, value: T, options: ToolCacheOptions = {}): Promise<void> {
        try {
            const key = this.generateCacheKey(toolName, input, options.tags);
            const size = this.calculateObjectSize(value);

            if (this.getCurrentMemoryUsage() + size > this.memoryLimit * 1024 * 1024) {
                await this.cleanup();
            }

            let entry: { compressed: boolean; data: Buffer | T };
            
            if ((size > this.COMPRESSION_THRESHOLD && options.compress !== false) || options.compress) {
                const compressed = await this.compressData(value);
                entry = { compressed: true, data: compressed };
            } else {
                entry = { compressed: false, data: value };
            }

            const ttl = options.isSchema ? this.SCHEMA_TTL : options.ttl;
            await this.cacheService.set(key, entry, ttl);
            debug(`Cached ${options.isSchema ? 'schema' : 'result'} for tool: ${toolName}`);
        } catch (error) {
            debug(`Cache set error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async invalidateSchema(toolName: string): Promise<void> {
        const key = this.generateCacheKey(toolName, null, undefined, true);
        await this.cacheService.delete(key);
    }

    private async cleanup(): Promise<void> {
        try {
            const stats = await this.getStats();
            
            if (stats.hitRate < 0.5) {
                this.logger.info('Low hit rate detected, performing selective cleanup');
                await this.invalidateUnusedEntries();
            }
            
            if (this.getCurrentMemoryUsage() > this.memoryLimit * 1024 * 1024 * 0.9) {
                this.logger.warn('Memory still high after selective cleanup, clearing non-schema cache');
                await this.clearNonSchemaEntries();
            }
        } catch (error) {
            debug(`Cleanup error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async invalidateUnusedEntries(): Promise<void> {
        try {
            const metrics = await this.cacheService.getMetrics('*');
            if (!metrics) return;

            const entriesWithMetrics = Object.entries(metrics)
                .map(([key, value]) => ({
                    key,
                    hits: value?.hits || 0,
                    lastAccessed: value?.lastAccessed || new Date(0),
                    isSchema: key.includes(':schema:')
                }))
                .filter(entry => !entry.isSchema); // Don't remove schema entries

            if (entriesWithMetrics.length === 0) return;

            entriesWithMetrics.sort((a, b) => {
                if (a.hits !== b.hits) return a.hits - b.hits;
                return a.lastAccessed.getTime() - b.lastAccessed.getTime();
            });

            const entriesToRemove = entriesWithMetrics
                .slice(0, Math.floor(entriesWithMetrics.length * 0.2))
                .map(entry => entry.key);

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

    private async clearNonSchemaEntries(): Promise<void> {
        // TODO: Implement selective clearing of non-schema entries
        // For now, we'll preserve schema entries during cleanup
        this.resetStats();
    }

    private setupCacheMonitoring(): void {
        // Use a shorter interval in development mode
        const monitoringInterval = process.env.NODE_ENV === 'production' 
            ? this.checkPeriod * 1000  // 10 minutes in production
            : 60 * 1000;               // 1 minute in development
        
        if (process.env.NODE_ENV !== 'test') {
            setInterval(async () => {
                const stats = await this.getStats();
                this.logger.info('Cache Performance', {
                    ...stats,
                    timestamp: new Date().toISOString(),
                    environment: process.env.NODE_ENV || 'development'
                });

                if (this.getCurrentMemoryUsage() > this.memoryLimit * 1024 * 1024 * 0.9) {
                    await this.cleanup();
                }
            }, monitoringInterval);
        }
    }

    async getStats(): Promise<ToolCacheStats> {
        // Get the actual count of entries from the cache file
        let totalEntries = 0;
        try {
            // Read the cache file directly to count entries
            const fs = await import('fs/promises');
            const path = await import('path');
            const cacheFilePath = path.resolve('tool-cache.json');
            
            if (await fs.access(cacheFilePath).then(() => true).catch(() => false)) {
                const cacheContent = await fs.readFile(cacheFilePath, 'utf8');
                const cacheData = JSON.parse(cacheContent);
                totalEntries = cacheData?.value?.cache?.length || 0;
            }
        } catch (error) {
            debug(`Error counting cache entries: ${error instanceof Error ? error.message : String(error)}`);
        }
        
        return {
            totalEntries,
            memoryUsage: this.getCurrentMemoryUsage(),
            hitRate: this.stats.hits / (this.stats.totalQueries || 1),
            missRate: this.stats.misses / (this.stats.totalQueries || 1),
            totalHits: this.stats.hits + this.stats.schemaHits,
            totalMisses: this.stats.misses + this.stats.schemaMisses
        };
    }

    private resetStats(): void {
        this.stats = {
            hits: 0,
            misses: 0,
            totalQueries: 0,
            schemaHits: 0,
            schemaMisses: 0
        };
    }

    async invalidate(toolName?: string, tags?: string[]): Promise<void> {
        if (toolName) {
            const key = this.generateCacheKey(toolName, '*', tags);
            await this.cacheService.delete(key);
        } else {
            await this.clearNonSchemaEntries();
        }
    }

    async getMetrics(toolName: string): Promise<any> {
        return this.cacheService.getMetrics(toolName);
    }
}
