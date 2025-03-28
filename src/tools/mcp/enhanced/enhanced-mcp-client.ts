import { EventEmitter } from 'events';
import { BaseMCPClient } from '../base/base-mcp-client.js';
import { ToolDefinition, ToolResponse } from '../types/tools.js';
import { ServerConfig } from '../types/server.js';
import { CacheStatus, HealthStatus } from '../types/status.js';
import { IMCPClient } from '../interfaces/core.js';
import { ClientMetrics } from '../types/metrics.js';
import { info, warn, error, debug } from '../../../utils/logger.js';
import { createLogContext, createErrorContext } from '../../../utils/log-utils.js';
import { MCPError, ErrorType } from '../types/errors.js';
import { z } from 'zod';

const COMPONENT = 'EnhancedMCPClient';

// Define health status values if not already defined in types
const HEALTH_STATUS = {
    HEALTHY: 'HEALTHY',
    UNHEALTHY: 'UNHEALTHY'
} as const;

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
    private metrics: ClientMetrics;
    private toolsPollingInterval?: NodeJS.Timeout;
    private readonly TOOLS_REFRESH_INTERVAL = 30000; // 30 seconds
    private shouldReconnect: boolean = true;
    private baseReconnectDelay: number = 1000;
    private maxReconnectDelay: number = 60000; // 1 minute

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

        info('Enhanced MCP Client initialized', createLogContext(
            COMPONENT,
            'constructor',
            {
                serverId: this.serverId,
                healthCheckInterval: this.HEALTH_CHECK_INTERVAL,
                toolsRefreshInterval: this.TOOLS_REFRESH_INTERVAL,
                maxReconnectAttempts: this.maxReconnectAttempts
            }
        ));
    }

    private setupHealthMonitoring(): void {
        setInterval(() => {
            this.checkHealth();
        }, this.HEALTH_CHECK_INTERVAL);

        debug('Health monitoring setup', createLogContext(
            COMPONENT,
            'setupHealthMonitoring',
            {
                serverId: this.serverId,
                intervalMs: this.HEALTH_CHECK_INTERVAL
            }
        ));
    }
    
    /**
     * Set up notification handlers for MCP events
     * This uses polling since the SDK doesn't support notification handlers
     */
    private setupNotificationHandlers(): void {
        try {
            // We need to access the raw client from the MCP SDK
            if (!this.client) {
                warn('No client available for polling setup', createLogContext(
                    COMPONENT,
                    'setupNotificationHandlers',
                    { serverId: this.serverId }
                ));
                return;
            }

            // Check if this server is already being polled using the global registry
            if (pollingServers.has(this.serverId)) {
                debug('Tool polling already set up', createLogContext(
                    COMPONENT,
                    'setupNotificationHandlers',
                    { serverId: this.serverId }
                ));
                return;
            }

            // Set up tools polling on a regular interval
            const TOOLS_POLL_INTERVAL = 30000; // 30 seconds
            info('Setting up tools polling', createLogContext(
                COMPONENT,
                'setupNotificationHandlers',
                {
                    serverId: this.serverId,
                    intervalMs: TOOLS_POLL_INTERVAL
                }
            ));
            
            // Mark this server as having polling set up
            pollingServers.add(this.serverId);

            setInterval(async () => {
                try {
                    await this.refreshTools();
                } catch (err) {
                    error('Error polling for tool changes', createErrorContext(
                        COMPONENT,
                        'setupNotificationHandlers',
                        'System',
                        'POLLING_ERROR',
                        err,
                        { serverId: this.serverId }
                    ));
                }
            }, TOOLS_POLL_INTERVAL);

            info('Tool polling setup complete', createLogContext(
                COMPONENT,
                'setupNotificationHandlers',
                { serverId: this.serverId }
            ));
        } catch (err) {
            error('Could not set up polling', createErrorContext(
                COMPONENT,
                'setupNotificationHandlers',
                'System',
                'SETUP_ERROR',
                err,
                { serverId: this.serverId }
            ));
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
                    info('Tool count changed', createLogContext(
                        COMPONENT,
                        'refreshTools',
                        {
                            serverId: this.serverId,
                            previousCount: cachedTools.length,
                            currentCount: latestTools.length
                        }
                    ));
                    this.eventEmitter.emit('tools.changed', { serverId: this.serverId });
                } else {
                    // Check for tool name changes
                    const cachedNames = new Set(cachedTools.map(t => t.name));
                    const hasNewTools = latestTools.some(t => !cachedNames.has(t.name));
                    
                    if (hasNewTools) {
                        info('Tool names changed', createLogContext(
                            COMPONENT,
                            'refreshTools',
                            {
                                serverId: this.serverId,
                                toolCount: latestTools.length
                            }
                        ));
                        this.eventEmitter.emit('tools.changed', { serverId: this.serverId });
                    }
                }
            }
            
            // Update the cache with latest tools
            this.setCachedValue(cacheKey, latestTools);
        } catch (err) {
            error('Error refreshing tools', createErrorContext(
                COMPONENT,
                'refreshTools',
                'System',
                'REFRESH_ERROR',
                err,
                { serverId: this.serverId }
            ));
        }
    }

    private async checkHealth(): Promise<void> {
        const now = new Date();
        const timeSinceLastCheck = now.getTime() - this.lastHealthCheck.getTime();

        try {
            await this.listTools();
            this.lastHealthCheck = now;
            
            const wasReconnecting = this.reconnectAttempts > 0;
            if (wasReconnecting) {
                this.reconnectAttempts = 0;
                this.reconnectDelay = this.baseReconnectDelay;
            }

            info('Health status', createLogContext(
                COMPONENT,
                'checkHealth',
                {
                    serverId: this.serverId,
                    status: HEALTH_STATUS.HEALTHY,
                    timeSinceLastCheck,
                    connectionRestored: wasReconnecting,
                    previousAttempts: wasReconnecting ? this.reconnectAttempts : undefined
                }
            ));

            this.healthMonitor.emit('health.status', { 
                status: HEALTH_STATUS.HEALTHY,
                serverId: this.serverId,
                timestamp: now
            });
        } catch (err) {
            error('Health status', createErrorContext(
                COMPONENT,
                'checkHealth',
                'System',
                'HEALTH_CHECK_ERROR',
                err,
                {
                    serverId: this.serverId,
                    status: HEALTH_STATUS.UNHEALTHY,
                    timeSinceLastCheck,
                    reconnectAttempts: this.reconnectAttempts,
                    maxReconnectAttempts: this.maxReconnectAttempts
                }
            ));

            this.healthMonitor.emit('health.status', {
                status: HEALTH_STATUS.UNHEALTHY,
                serverId: this.serverId,
                timestamp: now,
                error: err
            });

            await this.handleReconnect();
        }
    }

    private async handleReconnect(): Promise<void> {
        if (!this.shouldReconnect) return;

        this.reconnectAttempts++;
        
        try {
            await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
            await this.connect();
            
            info('Reconnection status', createLogContext(
                COMPONENT,
                'handleReconnect',
                {
                    serverId: this.serverId,
                    status: 'success',
                    attempt: this.reconnectAttempts
                }
            ));
            
            this.reconnectAttempts = 0;
            this.reconnectDelay = this.baseReconnectDelay;
        } catch (err) {
            const isMaxAttempts = this.reconnectAttempts >= this.maxReconnectAttempts;
            
            error('Reconnection status', createErrorContext(
                COMPONENT,
                'handleReconnect',
                'MCP',
                isMaxAttempts ? 'MAX_RECONNECT_ATTEMPTS' : 'RECONNECT_ERROR',
                err,
                {
                    serverId: this.serverId,
                    attempt: this.reconnectAttempts,
                    maxAttempts: this.maxReconnectAttempts,
                    backoffDelay: Math.round(this.reconnectDelay/1000),
                    final: isMaxAttempts
                }
            ));

            if (isMaxAttempts) {
                this.shouldReconnect = false;
                return;
            }

            this.reconnectDelay = Math.min(
                this.reconnectDelay * 2,
                this.maxReconnectDelay
            );
            
            await this.handleReconnect();
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
        return {
            ...this.metrics,
            lastUpdateTime: new Date()
        };
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

    public getCachedValue<T>(key: string): T | null {
        const cached = this.cache.get(key);
        const now = Date.now();
        
        if (!cached) {
            debug('Cache operation', createLogContext(
                COMPONENT,
                'getCachedValue',
                {
                    serverId: this.serverId,
                    key,
                    result: 'miss'
                }
            ));
            return null;
        }

        if (now - cached.timestamp > this.CACHE_TTL) {
            this.cache.delete(key);
            debug('Cache operation', createLogContext(
                COMPONENT,
                'getCachedValue',
                {
                    serverId: this.serverId,
                    key,
                    result: 'expired',
                    age: now - cached.timestamp,
                    ttl: this.CACHE_TTL
                }
            ));
            return null;
        }

        return cached.value;
    }

    public setCachedValue<T>(key: string, value: T): void {
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
            info('Connecting to MCP server', createLogContext(
                COMPONENT,
                'connect',
                { serverId: this.serverId }
            ));

            await super.connect();
            
            info('Connected successfully', createLogContext(
                COMPONENT,
                'connect',
                { serverId: this.serverId }
            ));
        } catch (err) {
            error('Connection failed', createErrorContext(
                COMPONENT,
                'connect',
                'System',
                'CONNECTION_ERROR',
                err,
                { serverId: this.serverId }
            ));
            throw err;
        }
    }

    /**
     * Check if the server supports notifications
     * This is just for diagnostic purposes
     */
    private async checkNotificationSupport(): Promise<void> {
        try {
            if (!this.client) return;
            
            // Use the standard client interface to check capabilities
            const hasTools = await this.listTools().then(() => true).catch(() => false);
            const hasResources = await this.listResources().then(() => true).catch(() => false);
            
            debug('Server capabilities checked', createLogContext(
                COMPONENT,
                'checkNotificationSupport',
                {
                    serverId: this.serverId,
                    hasTools,
                    hasResources,
                    status: 'completed'
                }
            ));
        } catch (err) {
            error('Failed to check notification support', createErrorContext(
                COMPONENT,
                'checkNotificationSupport',
                'System',
                'CAPABILITIES_ERROR',
                err,
                { serverId: this.serverId }
            ));
        }
    }

    /**
     * Clean up resources when disconnecting
     */
    public async disconnect(): Promise<void> {
        try {
            info('Disconnecting from MCP server', createLogContext(
                COMPONENT,
                'disconnect',
                { serverId: this.serverId }
            ));

            // Clear any pending reconnect timers
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = undefined;
            }

            // Clear polling interval
            if (this.toolsPollingInterval) {
                clearInterval(this.toolsPollingInterval);
                this.toolsPollingInterval = undefined;
            }

            // Remove from polling registry
            pollingServers.delete(this.serverId);

            await super.disconnect();
            
            info('Disconnected successfully', createLogContext(
                COMPONENT,
                'disconnect',
                { serverId: this.serverId }
            ));
        } catch (err) {
            error('Disconnect failed', createErrorContext(
                COMPONENT,
                'disconnect',
                'System',
                'DISCONNECT_ERROR',
                err,
                { serverId: this.serverId }
            ));
            throw err;
        }
    }

    private handleConnectionError(error: any): void {
        error('Connection error occurred', createErrorContext(
            COMPONENT,
            'handleConnectionError',
            'MCP',
            'CONNECTION_ERROR',
            error,
            {
                serverId: this.serverId,
                attempt: this.reconnectAttempts,
                maxAttempts: this.maxReconnectAttempts
            }
        ));

        if (this.shouldReconnect) {
            this.handleReconnect().catch(err => {
                error('Reconnection handling failed', createErrorContext(
                    COMPONENT,
                    'handleConnectionError',
                    'MCP',
                    'RECONNECT_HANDLER_ERROR',
                    err,
                    {
                        serverId: this.serverId,
                        attempt: this.reconnectAttempts,
                        maxAttempts: this.maxReconnectAttempts
                    }
                ));
            });
        }
    }

    protected emit(event: string, data: any): void {
        this.eventEmitter.emit(event, data);
    }

    public resetMetrics(): void {
        info('Resetting metrics', createLogContext(
            COMPONENT,
            'resetMetrics',
            {
                serverId: this.serverId,
                previousRequests: this.metrics.requests,
                previousErrors: this.metrics.errors
            }
        ));

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
} 