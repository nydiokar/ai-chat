import { EventEmitter } from 'events';
import { BaseMCPClient } from '../base/base-mcp-client.js';
import { ToolDefinition, ToolResponse } from '../types/tools.js';
import { ServerConfig } from '../types/server.js';
import { CacheStatus, HealthStatus } from '../types/status.js';

export class EnhancedMCPClient extends BaseMCPClient {
    private cache: Map<string, { value: any; timestamp: number }>;
    private healthMonitor: EventEmitter;
    private eventEmitter: EventEmitter;
    private lastHealthCheck: Date;
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    private readonly HEALTH_CHECK_INTERVAL = 60 * 1000; // 1 minute

    constructor(config: ServerConfig) {
        super(config);
        this.cache = new Map();
        this.healthMonitor = new EventEmitter();
        this.eventEmitter = new EventEmitter();
        this.lastHealthCheck = new Date();
        this.setupHealthMonitoring();
    }

    private setupHealthMonitoring(): void {
        setInterval(() => {
            this.checkHealth();
        }, this.HEALTH_CHECK_INTERVAL);
    }

    private async checkHealth(): Promise<void> {
        try {
            await super.connect();
            this.lastHealthCheck = new Date();
            this.healthMonitor.emit('health.ok');
        } catch (error) {
            this.healthMonitor.emit('health.error', error);
        }
    }

    public async listTools(): Promise<ToolDefinition[]> {
        const cacheKey = 'tools-list';
        const cachedTools = this.getCachedValue<ToolDefinition[]>(cacheKey);
        
        if (cachedTools) {
            return cachedTools;
        }

        const tools = await super.listTools();
        this.setCachedValue(cacheKey, tools);
        return tools;
    }

    public async callTool(name: string, args: any): Promise<ToolResponse> {
        this.eventEmitter.emit('tool.called', { name, args });
        
        try {
            const response = await super.callTool(name, args);
            this.eventEmitter.emit('tool.success', { name, response });
            return response;
        } catch (error) {
            this.eventEmitter.emit('tool.error', { name, error });
            throw error;
        }
    }

    public getCacheStatus(): CacheStatus {
        return {
            size: this.cache.size,
            lastCleanup: new Date(),
            ttl: this.CACHE_TTL
        };
    }

    public getHealthStatus(): HealthStatus {
        return {
            lastCheck: this.lastHealthCheck,
            status: 'OK',
            checkInterval: this.HEALTH_CHECK_INTERVAL
        };
    }

    public on(event: string, handler: (...args: any[]) => void): void {
        this.eventEmitter.on(event, handler);
    }

    private getCachedValue<T>(key: string): T | null {
        const cached = this.cache.get(key);
        if (!cached) return null;

        const { value, timestamp } = cached;
        if (Date.now() - timestamp > this.CACHE_TTL) {
            this.cache.delete(key);
            return null;
        }

        return value as T;
    }

    private setCachedValue<T>(key: string, value: T): void {
        this.cache.set(key, {
            value,
            timestamp: Date.now()
        });
    }
} 