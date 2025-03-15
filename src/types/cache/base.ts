import { CacheType } from './types.js';

/**
 * Base interface for all cache operations
 */
export interface ICache<T> {
    get(key: string): Promise<T | null>;
    set(key: string, value: T, ttl?: number): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
}

/**
 * Configuration for cache instances
 */
export interface CacheConfig {
    type: CacheType;           // Required security level
    filename?: string;         // Only used if type is PERSISTENT
    namespace?: string;
    ttl?: number;
    writeDelay?: number;      // Delay in ms between writes to disk
    serialize?: (data: any) => string;
    deserialize?: (text: string) => any;
}

/**
 * Type for Keyv instance
 */
export type KeyvInstance<T> = {
    get: (key: string) => Promise<T | undefined>;
    set: (key: string, value: T, ttl?: number) => Promise<void>;
    delete: (key: string) => Promise<boolean>;
    clear: () => Promise<void>;
    on: (event: string, handler: (err: Error) => void) => void;
};

/**
 * Base interface for cache providers
 * Providers handle the actual storage mechanism (memory, file, redis, etc)
 */
export interface ICacheProvider extends ICache<any> {
    readonly namespace: string;
    readonly type: CacheType;
    getNamespacedKey(key: string): string;
}

/**
 * Abstract base class for all specialized caches
 * Provides common functionality and enforces consistent interface
 */
export abstract class UnifiedCache<T> implements ICache<T> {
    constructor(
        protected readonly provider: ICacheProvider,
        protected readonly options: CacheConfig
    ) {}

    abstract get(key: string): Promise<T | null>;
    abstract set(key: string, value: T, ttl?: number): Promise<void>;
    
    async delete(key: string): Promise<void> {
        await this.provider.delete(key);
    }

    async clear(): Promise<void> {
        await this.provider.clear();
    }

    protected getNamespacedKey(key: string): string {
        return this.provider.getNamespacedKey(key);
    }
} 