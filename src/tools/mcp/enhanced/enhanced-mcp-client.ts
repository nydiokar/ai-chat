import { EventEmitter } from 'events';
import { BaseMCPClient } from '../base/base-mcp-client.js';
import { ToolDefinition, ToolResponse } from '../types/tools.js';
import { ServerConfig } from '../types/server.js';
import { CacheStatus, HealthStatus } from '../types/status.js';
import { IMCPClient } from '../interfaces/core.js';
import { ClientMetrics } from '../types/metrics.js';

// Global registry to track which servers have polling set up
// This ensures we don't set up multiple intervals for the same server
const pollingServers = new Set<string>();

export class EnhancedMCPClient extends BaseMCPClient {
    private cache: Map<string, { value: any; timestamp: number }>;
    private healthMonitor: EventEmitter;
    private eventEmitter: EventEmitter = new EventEmitter();
    private lastHealthCheck: Date;
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    private readonly HEALTH_CHECK_INTERVAL = 60 * 1000; // 1 minute
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;
    private reconnectDelay: number = 1000; // Start with 1 second
    private reconnectTimer?: NodeJS.Timeout;
    private isReconnecting: boolean = false;
    private metrics: ClientMetrics;
    private toolsPollingInterval?: NodeJS.Timeout;
    private readonly TOOLS_REFRESH_INTERVAL = 30000; // 30 seconds

    constructor(config: ServerConfig, serverId: string) {
        super(config, serverId);
        this.cache = new Map();
        this.healthMonitor = new EventEmitter();
        this.lastHealthCheck = new Date();
        this.setupHealthMonitoring();
        this.setupNotificationHandlers();
        
        // Initialize metrics
        this.metrics = {
            requests: 0,
            errors: 0,
            toolCalls: 0,
            avgResponseTime: 0,
            responseTimeData: [],
            startTime: new Date(),
            lastUpdateTime: new Date(),
            successRate: 1.0,
            serverId: this.serverId
        };
    }

    private setupHealthMonitoring(): void {
        setInterval(() => {
            this.checkHealth();
        }, this.HEALTH_CHECK_INTERVAL);
    }
    
    /**
     * Set up notification handlers for MCP events
     * This uses polling since the SDK doesn't support notification handlers
     */
    private setupNotificationHandlers(): void {
        try {
            // We need to access the raw client from the MCP SDK
            if (!this.client) {
                console.log(`[${this.serverId}] No client available for polling setup`);
                return;
            }

            // Check if this server is already being polled using the global registry
            if (pollingServers.has(this.serverId)) {
                console.log(`[${this.serverId}] Tool polling already set up, skipping duplicate setup`);
                return;
            }

            // Set up tools polling on a regular interval
            const TOOLS_POLL_INTERVAL = 30000; // 30 seconds
            console.log(`[${this.serverId}] Setting up tools polling every ${TOOLS_POLL_INTERVAL/1000} seconds`);
            
            // Mark this server as having polling set up
            pollingServers.add(this.serverId);

            setInterval(async () => {
                try {
                    await this.refreshTools();
                } catch (error) {
                    console.warn(`[${this.serverId}] Error polling for tool changes:`, error);
                }
            }, TOOLS_POLL_INTERVAL);

            console.log(`[${this.serverId}] Tool polling setup complete`);
        } catch (error) {
            console.warn(`[${this.serverId}] Could not set up polling:`, error);
        }
    }

    /**
     * Poll for tool changes by refreshing the tools list and checking for differences
     */
    private async refreshTools(): Promise<void> {
        try {
            const cacheKey = 'tools-list';
            const cachedTools = this.getCachedValue<ToolDefinition[]>(cacheKey);
            
            // Get the latest tools
            const latestTools = await super.listTools();
            
            // If we have cached tools, check for changes
            if (cachedTools) {
                // Simple check - compare number of tools
                if (cachedTools.length !== latestTools.length) {
                    console.log(`[${this.serverId}] Tool count changed from ${cachedTools.length} to ${latestTools.length}`);
                    this.eventEmitter.emit('tools.changed', { serverId: this.serverId });
                } else {
                    // Check for tool name changes
                    const cachedNames = new Set(cachedTools.map(t => t.name));
                    const hasNewTools = latestTools.some(t => !cachedNames.has(t.name));
                    
                    if (hasNewTools) {
                        console.log(`[${this.serverId}] Tool names changed`);
                        this.eventEmitter.emit('tools.changed', { serverId: this.serverId });
                    }
                }
            }
            
            // Update the cache with latest tools
            this.setCachedValue(cacheKey, latestTools);
        } catch (error) {
            console.warn(`[${this.serverId}] Error refreshing tools:`, error);
        }
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

    /**
     * Track performance metrics for a tool call
     */
    async callTool(name: string, args: any): Promise<ToolResponse> {
        this.metrics.requests++;
        this.metrics.toolCalls++;
        this.metrics.lastUpdateTime = new Date();
        
        // Emit the original event
        this.emit('tool.called', { name, args });
        
        const startTime = performance.now();
        
        try {
            const response = await super.callTool(name, args);
            
            // Calculate response time and update metrics
            const responseTime = performance.now() - startTime;
            this.updateResponseTimeMetrics(responseTime);
            
            // Emit the original success event
            this.emit('tool.success', { name, response });
            
            return response;
        } catch (error) {
            this.metrics.errors++;
            
            // Update success rate
            this.metrics.successRate = this.metrics.requests === 0 ? 
                1.0 : (this.metrics.requests - this.metrics.errors) / this.metrics.requests;
            
            // Emit the original error event
            this.emit('tool.error', { name, error });
            
            throw error;
        }
    }

    /**
     * Update response time statistics
     */
    private updateResponseTimeMetrics(newTime: number): void {
        // Keep last 100 response times for moving average
        this.metrics.responseTimeData.push(newTime);
        if (this.metrics.responseTimeData.length > 100) {
            this.metrics.responseTimeData.shift();
        }
        
        // Calculate moving average
        this.metrics.avgResponseTime = this.metrics.responseTimeData.reduce(
            (sum, time) => sum + time, 0
        ) / this.metrics.responseTimeData.length;
        
        // Update success rate
        this.metrics.successRate = this.metrics.requests === 0 ? 
            1.0 : (this.metrics.requests - this.metrics.errors) / this.metrics.requests;
        
        // Emit metrics update event every 10 calls
        if (this.metrics.requests % 10 === 0) {
            this.emit('metrics.update', { ...this.metrics });
        }
    }

    /**
     * Get current metrics for this client
     */
    getMetrics(): ClientMetrics {
        return { ...this.metrics };
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

    public on(event: string, listener: (...args: any[]) => void): this {
        this.eventEmitter.on(event, listener);
        return this;
    }

    public once(event: string, listener: (...args: any[]) => void): this {
        this.eventEmitter.once(event, listener);
        return this;
    }

    public off(event: string, listener: (...args: any[]) => void): this {
        this.eventEmitter.off(event, listener);
        return this;
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

    /**
     * Connect to the server
     * This is an extended version of the base connect method that also
     * sets up notification handlers after connection
     */
    public async connect(): Promise<void> {
        try {
            console.log(`[${this.serverId}] Connecting enhanced client...`);
            
            // Reset reconnection state
            this.isReconnecting = false;
            
            // Call the base connect method to establish connection
            await super.connect();
            
            // Reset reconnection counters on successful connection
            this.reconnectAttempts = 0;
            this.reconnectDelay = 1000;
            
            // Emit connection established event
            this.emit('connection.established', { serverId: this.serverId });
            
            // Once connected, set up notification handlers
            this.setupNotificationHandlers();
            
            // Check if notifications are supported
            await this.checkNotificationSupport();
            
            console.log(`[${this.serverId}] Enhanced client connected successfully`);
        } catch (error) {
            console.error(`[${this.serverId}] Enhanced client connect error:`, error);
            this.handleConnectionError(error);
            throw error;
        }
    }

    /**
     * Check if the server supports notifications
     * This is just for diagnostic purposes
     */
    private async checkNotificationSupport(): Promise<void> {
        try {
            if (!this.client) return;
            
            // Get server capabilities if available
            const capabilities = (this.client as any).getServerCapabilities?.();
            
            if (capabilities) {
                console.log(`[${this.serverId}] Server capabilities:`, capabilities);
                
                // Log any tools capability 
                if (capabilities.tools) {
                    console.log(`[${this.serverId}] Server supports tools capability`);
                }
            } else {
                console.log(`[${this.serverId}] Server capabilities not available`);
            }
        } catch (error) {
            console.warn(`[${this.serverId}] Error checking capabilities:`, error);
        }
    }

    /**
     * Clean up resources when disconnecting
     */
    public async disconnect(): Promise<void> {
        // Clear any pending reconnect attempts
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        
        // Stop reconnection attempts
        this.isReconnecting = false;
        
        // Remove from polling registry when disconnecting
        pollingServers.delete(this.serverId);
        
        return super.disconnect();
    }

    private handleConnectionError(error: any): void {
        this.emit('connection.error', { 
            serverId: this.serverId, 
            error, 
            timestamp: new Date() 
        });
        
        // Don't attempt reconnect if we're intentionally disconnecting
        if (this.isReconnecting === false) {
            console.log(`Not attempting reconnect for ${this.serverId} as disconnection was intentional`);
            return;
        }
        
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            
            // Exponential backoff with jitter
            const jitter = Math.random() * 0.3 + 0.85; // 0.85-1.15 multiplier
            this.reconnectDelay = Math.min(
                this.reconnectDelay * 2 * jitter,
                60000 // Max 1 minute
            );
            
            console.log(`Reconnecting to ${this.serverId} in ${Math.round(this.reconnectDelay/1000)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            
            // Store the timer so we can cancel it if needed
            this.reconnectTimer = setTimeout(() => {
                this.emit('connection.reconnecting', { 
                    serverId: this.serverId,
                    attempt: this.reconnectAttempts,
                    maxAttempts: this.maxReconnectAttempts
                });
                
                this.isReconnecting = true;
                this.connect().catch(e => {
                    console.error(`Reconnection attempt failed for ${this.serverId}:`, e);
                });
            }, this.reconnectDelay);
        } else {
            this.isReconnecting = false;
            this.emit('connection.failed', { 
                serverId: this.serverId,
                attempts: this.reconnectAttempts,
                error
            });
            console.error(`Failed to connect to ${this.serverId} after ${this.reconnectAttempts} attempts`);
        }
    }

    protected emit(event: string, data: any): void {
        this.eventEmitter.emit(event, data);
    }
} 