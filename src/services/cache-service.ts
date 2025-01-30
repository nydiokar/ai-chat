import Keyv from 'keyv';
import { KeyvFile } from 'keyv-file';
import { DatabaseService } from './db-service.js';
import { debug } from '../config.js';
import { Message } from 'discord.js';

interface CacheConfig {
    filename: string;
    namespace?: string;
    ttl?: number;
}

interface CacheEntry<T> {
    data: T;
    expires: number;
    metadata?: {
        branch?: string;
        parent?: string;
    };
}

interface CacheMetrics {
    hits: number;
    misses: number;
    lastAccessed: Date;
}

interface BranchMetadata {
    created: Date;
    lastAccessed: Date;
    branch?: string;
    parent?: string;
}

interface ConversationBranch {
    id: string;
    parent?: string;
    children: string[];
    messages: Message[];
    metadata: BranchMetadata;
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
        metadata?: { branch?: string; parent?: string }, 
        ttl?: number
    ): Promise<boolean> {
        try {
            const entry: CacheEntry<T> = {
                data,
                expires: Date.now() + (ttl || (this.cache.opts?.ttl ?? 24 * 60 * 60 * 1000)),
                metadata
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

    async getBranch(branchId: string): Promise<ConversationBranch | null> {
        try {
            const branch = await this.cache.get(`branch:${branchId}`) as ConversationBranch;
            if (branch) {
                branch.metadata.lastAccessed = new Date();
                await this.cache.set(`branch:${branchId}`, branch);
            }
            return branch || null;
        } catch (error) {
            throw new CacheError(`Failed to get branch: ${branchId}`, error);
        }
    }

    async createBranch(parentId: string | null, messages: Message[]): Promise<ConversationBranch> {
        try {
            const branch: ConversationBranch = {
                id: crypto.randomUUID(),
                parent: parentId || undefined,
                children: [],
                messages,
                metadata: {
                    created: new Date(),
                    lastAccessed: new Date()
                }
            };

            if (parentId) {
                const parentBranch = await this.getBranch(parentId);
                if (parentBranch) {
                    parentBranch.children.push(branch.id);
                    await this.cache.set(`branch:${parentId}`, parentBranch);
                }
            }

            await this.cache.set(`branch:${branch.id}`, branch);
            return branch;
        } catch (error) {
            throw new CacheError('Failed to create branch', error);
        }
    }

    async updateBranchMessages(branchId: string, messages: Message[]): Promise<void> {
        try {
            const branch = await this.getBranch(branchId);
            if (!branch) {
                throw new CacheError(`Branch not found: ${branchId}`);
            }

            branch.messages = messages;
            branch.metadata.lastAccessed = new Date();
            await this.cache.set(`branch:${branchId}`, branch);
        } catch (error) {
            throw new CacheError(`Failed to update branch messages: ${branchId}`, error);
        }
    }

    async getBranchTree(rootBranchId: string): Promise<ConversationBranch[]> {
        try {
            const branches: ConversationBranch[] = [];
            const queue = [rootBranchId];

            while (queue.length > 0) {
                const branchId = queue.shift()!;
                const branch = await this.getBranch(branchId);
                
                if (branch) {
                    branches.push(branch);
                    queue.push(...branch.children);
                }
            }

            return branches;
        } catch (error) {
            throw new CacheError(`Failed to get branch tree: ${rootBranchId}`, error);
        }
    }

    async deleteBranch(branchId: string, recursive = true): Promise<void> {
        try {
            const branch = await this.getBranch(branchId);
            if (!branch) return;

            if (recursive) {
                for (const childId of branch.children) {
                    await this.deleteBranch(childId, true);
                }
            }

            if (branch.parent) {
                const parentBranch = await this.getBranch(branch.parent);
                if (parentBranch) {
                    parentBranch.children = parentBranch.children.filter(id => id !== branchId);
                    await this.cache.set(`branch:${branch.parent}`, parentBranch);
                }
            }

            await this.cache.delete(`branch:${branchId}`);
        } catch (error) {
            throw new CacheError(`Failed to delete branch: ${branchId}`, error);
        }
    }
}
