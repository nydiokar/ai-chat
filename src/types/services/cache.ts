// Cache service configuration and metrics types
export enum CacheType {
    SENSITIVE = 'SENSITIVE',    // Always in-memory, never persisted
    PERSISTENT = 'PERSISTENT'   // Can be persisted to file
}

export interface CacheConfig {
    type: CacheType;           // Required security level
    filename?: string;         // Only used if type is PERSISTENT
    namespace?: string;
    ttl?: number;
    writeDelay?: number;      // Delay in ms between writes to disk
    serialize?: (data: any) => string;
    deserialize?: (text: string) => any;
}

export interface CacheEntry<T> {
    data: T;
    expires: number;
}

export interface CacheMetrics {
    hits: number;
    misses: number;
    lastAccessed: Date;
}

// Type for Keyv instance
export type KeyvInstance<T> = {
    get: (key: string) => Promise<T | undefined>;
    set: (key: string, value: T, ttl?: number) => Promise<void>;
    delete: (key: string) => Promise<boolean>;
    clear: () => Promise<void>;
    on: (event: string, handler: (err: Error) => void) => void;
}; 