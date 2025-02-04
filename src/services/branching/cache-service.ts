/**
 * @fileoverview Implements a caching layer for conversation branches and messages.
 * Provides performance optimization through file-based caching using Keyv.
 * Includes metrics tracking and branch relationship management.
 */

import Keyv from 'keyv';
import { KeyvFile } from 'keyv-file';
import { DatabaseService } from '../db-service.js';
import { debug } from '../../utils/config.js';
import { Message } from 'discord.js';

/**
 * Configuration options for the cache service
 */
interface CacheConfig {
    filename: string;
    namespace?: string;
    ttl?: number;
}

/**
 * Generic structure for cached items with metadata
 * @template T The type of data being cached
 */
interface CacheEntry<T> {
    data: T;
    expires: number;
    metadata?: {
        branch?: string;
        parent?: string;
    };
}

/**
 * Metrics for monitoring cache performance
 */
interface CacheMetrics {
    hits: number;
    misses: number;
    lastAccessed: Date;
}

/**
 * Metadata associated with conversation branches
 */
interface BranchMetadata {
    created: Date;
    lastAccessed: Date;
    branch?: string;
    parent?: string;
}

/**
 * Structure representing a conversation branch with messages and metadata
 */
interface ConversationBranch {
    id: string;
    parent?: string;
    children: string[];
    messages: Message[];
    metadata: BranchMetadata;
}

/**
 * Custom error class for cache-related operations
 */
export class CacheError extends Error {
    constructor(message: string, public cause?: unknown) {
        super(message);
        this.name = 'CacheError';
        Object.setPrototypeOf(this, CacheError.prototype);
    }
}

/**
 * Service managing cache operations for conversation branches
 * Implements file-based caching with metrics tracking and error handling
 */
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

    /**
     * Updates cache metrics for monitoring and optimization
     * @param key - Cache key being accessed
     * @param hit - Whether the access was a cache hit
     * @private
     */
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

    /**
     * Retrieves a value from cache with type safety
     * @template T Type of cached value
     * @param key Cache key to retrieve
     * @returns Promise resolving to cached value or null if not found
     * @throws CacheError if retrieval fails
     */
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

    /**
     * Stores a value in cache with optional metadata and TTL
     * @template T Type of value to cache
     * @param key Cache key
     * @param data Value to store
     * @param metadata Optional metadata about the cached item
     * @param ttl Optional time-to-live in milliseconds
     * @returns Promise resolving to boolean indicating success
     * @throws CacheError if storage fails
     */
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

    /**
     * Creates a new conversation branch in cache
     * Handles parent-child relationships and ensures data consistency
     * 
     * @param parentId Optional ID of parent branch
     * @param messages Initial messages for the branch
     * @returns Promise resolving to the created branch
     * @throws CacheError if branch creation fails
     */
    async createBranch(parentId: string | null, messages: Message[]): Promise<ConversationBranch> {
        try {
            // First, verify parent exists if provided
            let parentBranch: ConversationBranch | null = null;
            if (parentId) {
                parentBranch = await this.getBranch(parentId);
                if (!parentBranch) {
                    throw new CacheError(`Parent branch not found: ${parentId}`);
                }
            }

            // Create new branch
            const branchId = crypto.randomUUID();
            const branch: ConversationBranch = {
                id: branchId,
                parent: parentId || undefined,
                children: [],
                messages,
                metadata: {
                    created: new Date(),
                    lastAccessed: new Date()
                }
            };

            // Save new branch
            const branchSaved = await this.cache.set(`branch:${branchId}`, branch);
            if (!branchSaved) {
                throw new CacheError('Failed to save branch');
            }

            // Update parent's children list
            if (parentBranch) {
                parentBranch.children = [...parentBranch.children, branchId];
                const parentUpdated = await this.cache.set(`branch:${parentId}`, parentBranch);
                if (!parentUpdated) {
                    // Rollback branch creation if parent update fails
                    await this.cache.delete(`branch:${branchId}`);
                    throw new CacheError('Failed to update parent branch');
                }
            }

            // Re-fetch and return the branch to ensure consistency
            const finalBranch = await this.getBranch(branchId);
            if (!finalBranch) {
                throw new CacheError('Failed to retrieve created branch');
            }

            return finalBranch;
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
