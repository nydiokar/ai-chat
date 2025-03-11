export interface CacheStatus {
    size: number;
    lastCleanup: Date;
    ttl: number;
}

export interface HealthStatus {
    lastCheck: Date;
    status: 'OK' | 'ERROR';
    checkInterval: number;
} 