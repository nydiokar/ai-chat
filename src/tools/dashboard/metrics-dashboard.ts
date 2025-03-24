import { EventEmitter } from 'events';
import { IServerManager } from '../mcp/interfaces/core.js';
import { EnhancedMCPClient } from '../mcp/enhanced/enhanced-mcp-client.js';
import { Server, ServerState } from '../mcp/types/server.js';
import { ClientMetrics, ServerMetrics } from '../mcp/types/metrics.js';
import { MCPErrorRecord } from '../mcp/types/errors.js';

/**
 * Dashboard service that collects and exposes metrics from all servers and clients
 */
export class MetricsDashboard extends EventEmitter {
    private serverManager: IServerManager;
    private serverMetrics: Map<string, ServerMetrics> = new Map();
    private updateInterval: NodeJS.Timeout | null = null;
    private readonly UPDATE_FREQUENCY = 15000; // 15 seconds (increased from 5 seconds)
    private _lastMetricsCount = 0;
    private _lastDiscoveredCount = 0;
    private _refreshCount = 0; // Track number of refreshes
    private readonly POLL_FREQUENCY = 30000; // 30 seconds (increased from 5 seconds)
    private pollInterval: NodeJS.Timeout | null = null;

    constructor(serverManager: IServerManager) {
        super();
        this.serverManager = serverManager;
        this.setup();
    }

    /**
     * Setup the dashboard to poll server metrics at regular intervals
     */
    private setup(): void {
        // Do an initial discovery and set up metrics
        this.discoverServers();
        
        // Set up event listeners for server state changes
        this.setupEventListeners();
        
        // Set up polling of server metrics
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }
        this.pollInterval = setInterval(() => {
            this.discoverServers();
            this.refreshAllMetrics();
        }, this.POLL_FREQUENCY);
    }

    /**
     * Set up event listeners for server state changes
     */
    private setupEventListeners(): void {
        if (!this.serverManager) {
            return;
        }
        
        // Listen for both old and new event naming formats
        // Server state changes
        this.serverManager.on('server-state-change', (serverId: string, state: ServerState) => {
            this.refreshServerMetrics(serverId);
        });
        
        this.serverManager.on('server.state.changed', (event: any) => {
            if (event && event.id) {
                this.refreshServerMetrics(event.id);
            }
        });
        
        // Server registration
        this.serverManager.on('server-registered', (serverId: string) => {
            this.discoverServers();
            this.refreshServerMetrics(serverId);
        });
        
        // Server errors
        this.serverManager.on('server.error', (error: any) => {
            if (error && error.serverId) {
                this.refreshServerMetrics(error.serverId);
            }
        });
        
        // Server restart/start/stop events
        this.serverManager.on('server.restarted', (event: any) => {
            if (event && event.id) {
                this.refreshServerMetrics(event.id);
            }
        });
        
        this.serverManager.on('serverStarted', (event: any) => {
            if (event && event.id) {
                this.refreshServerMetrics(event.id);
                this.setupClientMetricsListeners(event.id);
            }
        });
        
        this.serverManager.on('serverStopped', (id: string) => {
            this.refreshServerMetrics(id);
        });
    }

    /**
     * Initialize dashboard by listening to server manager events
     */
    private setupClientMetricsListeners(serverId: string, silent: boolean = false): void {
        // This is a simplified version that doesn't rely on internal implementation details
        try {
            const server = this.serverManager.getServer(serverId);
            if (!server) return;

            // If we have access to the EnhancedMCPClient, we can set up listeners
            // This may not be possible with just the interface, but we'll keep the code
            // for reference when we have access to the implementation
            if (!silent) {
                console.log(`Set up metrics listeners for client ${serverId} (metadata tracking only)`);
            }
        } catch (error) {
            console.error(`Error setting up client metrics listeners for ${serverId}:`, error);
        }
    }

    private getServersDirectly(): Map<string, Server> {
        try {
            // Use the new interface method if available
            if (typeof this.serverManager.getAllServers === 'function') {
                return this.serverManager.getAllServers();
            }
            
            // Fallback to old method for backward compatibility
            const manager = this.serverManager as any;
            if (manager.servers && manager.servers instanceof Map) {
                console.log(`[MetricsDashboard] Found servers map with ${manager.servers.size} servers: ${Array.from(manager.servers.keys()).join(', ')}`);
                return manager.servers;
            }
            
            // If we found the servers property but couldn't access it directly, try more direct property access
            for (const propName of Object.getOwnPropertyNames(this.serverManager)) {
                const prop = (this.serverManager as any)[propName];
                if (prop instanceof Map && propName.toLowerCase().includes('server')) {
                    const serverMap = prop as Map<string, any>;
                    console.log(`[MetricsDashboard] Accessing server map via ${propName}, found ${serverMap.size} servers: ${Array.from(serverMap.keys()).join(', ')}`);
                    
                    // Convert to a standard Map<string, Server>
                    const result = new Map<string, Server>();
                    for (const [key, value] of serverMap.entries()) {
                        result.set(key, value);
                    }
                    
                    return result;
                }
            }
        } catch (error) {
            console.error('[MetricsDashboard] Error accessing servers:', error);
        }
        return new Map();
    }

    /**
     * Discover servers from the server manager
     * This tries multiple approaches to find all servers
     */
    private discoverServers(): void {
        // First try direct access to the servers Map (most reliable)
        const serversMap = this.getServersDirectly();
        const directServerIds = Array.from(serversMap.keys());
        
        // Track all discovered servers for deduplication
        const discoveredServers = new Set<string>();
        
        // Only log available methods when no servers found and first few discovery attempts
        let logMethods = false;
        if (directServerIds.length === 0 && this._lastDiscoveredCount === 0) {
            logMethods = true;
            // Debug all available methods on serverManager to help diagnose issues
            const managerMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(this.serverManager))
                .filter(prop => typeof (this.serverManager as any)[prop] === 'function');
                
            if (logMethods) {
                console.log(`[MetricsDashboard] No servers found via standard methods. Available methods: ${managerMethods.join(', ')}`);
            }
        }
        
        // Only log if there's been a change
        if (directServerIds.length > 0 && directServerIds.length !== this._lastDiscoveredCount) {
            console.log(`[MetricsDashboard] Found ${directServerIds.length} servers via direct access`);
        }
        
        if (directServerIds.length > 0) {
            // Process each server from the direct map
            for (const serverId of directServerIds) {
                discoveredServers.add(serverId);
                const server = serversMap.get(serverId);
                if (server) {
                    this.initializeServerMetrics(serverId, server);
                    // Don't log every setup, it's too verbose
                    this.setupClientMetricsListeners(serverId, true);
                }
            }
        } else {
            // If direct access failed, try interface methods
            const serverIds = this.serverManager.getServerIds();
            
            if (serverIds.length > 0 && serverIds.length !== this._lastDiscoveredCount) {
                console.log(`[MetricsDashboard] Found ${serverIds.length} servers via interface methods`);
            }
            
            // Add servers from the interface
            for (const serverId of serverIds) {
                if (!discoveredServers.has(serverId)) {
                    discoveredServers.add(serverId);
                    const server = this.serverManager.getServer(serverId);
                    if (server) {
                        this.initializeServerMetrics(serverId, server);
                    } else {
                        this.refreshServerMetrics(serverId);
                    }
                    // Don't log every setup, it's too verbose
                    this.setupClientMetricsListeners(serverId, true);
                }
            }
        }
        
        // Only log when server count changes or on initial discovery
        if (discoveredServers.size !== this._lastDiscoveredCount) {
            if (discoveredServers.size > 0) {
                console.log(`[MetricsDashboard] Discovered ${discoveredServers.size} servers: ${Array.from(discoveredServers).join(', ')}`);
            } else {
                console.log(`[MetricsDashboard] No servers discovered. This might indicate an issue with the server manager integration.`);
            }
            this._lastDiscoveredCount = discoveredServers.size;
        }
    }

    /**
     * Initialize metrics for a server
     */
    private initializeServerMetrics(serverId: string, server: any): void {
        // Skip if we already have metrics for this server
        if (this.serverMetrics.has(serverId)) {
            return;
        }
        
        // Extract server state if available
        const state = server?.state || 'UNKNOWN';
        
        // Create basic metrics entry with available information
        const metrics: ServerMetrics = {
            serverId: serverId,
            restartCount: server?.restartCount || 0,
            uptime: 0,
            lastStartTime: server?.startTime || new Date(),
            isHealthy: state === 'RUNNING',
            connectionState: state === 'RUNNING' ? 'connected' : 'disconnected',
            toolCount: 0,
            errorCount: 0,
            successRate: 1.0
        };
        
        // Try to get client metrics if available
        if (server?.client) {
            try {
                // Use any to avoid type checking
                const client = server.client as any;
                
                // Try to get metrics if available
                if (typeof client.getMetrics === 'function') {
                    const clientMetrics = client.getMetrics();
                    if (clientMetrics) {
                        metrics.clientMetrics = clientMetrics;
                    }
                }
                
                // Try to get tool count if available
                if (client.cache && client.cache instanceof Map) {
                    const toolsList = client.cache.get('tools-list');
                    if (Array.isArray(toolsList)) {
                        metrics.toolCount = toolsList.length;
                    }
                }
            } catch (error) {
                // Only log on actual errors
                if (error instanceof Error && error.message !== 'Not found') {
                    console.warn(`[MetricsDashboard] Error getting client metrics: ${error.message}`);
                }
            }
        }
        
        // Store the initial metrics
        this.serverMetrics.set(serverId, metrics);
    }

    /**
     * Stop metrics collection
     */
    public stop(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    /**
     * Refresh metrics for all servers
     */
    private refreshAllMetrics(): void {
        // Try discovery again to catch any new servers
        this.discoverServers();
        
        // Refresh existing metrics
        const serverIds = Array.from(this.serverMetrics.keys());
        
        // Only log if we have servers to refresh
        if (serverIds.length > 0) {
            console.log(`[MetricsDashboard] Refreshing metrics for ${serverIds.length} servers`);
        }
        
        for (const serverId of serverIds) {
            this.refreshServerMetrics(serverId);
        }
        
        // Only log changes in metrics count
        if (this.serverMetrics.size !== this._lastMetricsCount) {
            console.log(`[MetricsDashboard] Metrics updated, current count: ${this.serverMetrics.size}`);
            this._lastMetricsCount = this.serverMetrics.size;
        }
        
        this.emit('metrics.updated', this.getAllMetrics());
    }

    /**
     * Refresh metrics for a specific server
     */
    private refreshServerMetrics(serverId: string): void {
        const server = this.serverManager.getServer(serverId);
        if (!server) {
            // Only log removal if we previously had metrics for this server
            if (this.serverMetrics.has(serverId)) {
                console.log(`[MetricsDashboard] Server ${serverId} not found, removing metrics`);
                // Server was removed, remove its metrics
                this.serverMetrics.delete(serverId);
                this.emit('metrics.server.removed', serverId);
            }
            return;
        }

        // Calculate server metrics (without excessive logging)
        const metrics: ServerMetrics = this.calculateServerMetrics(server);
        
        // Store the updated metrics
        this.serverMetrics.set(serverId, metrics);
        
        // Emit event for this specific server's metrics
        this.emit('metrics.server.updated', { serverId, metrics });
    }

    /**
     * Update client metrics when they change
     */
    private updateClientMetrics(serverId: string, clientMetrics: ClientMetrics): void {
        const serverMetrics = this.serverMetrics.get(serverId);
        if (!serverMetrics) return;

        // Update the client metrics part of server metrics
        serverMetrics.clientMetrics = clientMetrics;
        
        // Re-calculate success rate and other metrics
        if (clientMetrics.requests > 0) {
            serverMetrics.successRate = (clientMetrics.requests - clientMetrics.errors) / clientMetrics.requests;
        }

        // Save the updated metrics
        this.serverMetrics.set(serverId, serverMetrics);
        
        // Emit event for this specific client's metrics
        this.emit('metrics.client.updated', { serverId, metrics: clientMetrics });
    }

    /**
     * Calculate metrics for a server
     */
    private calculateServerMetrics(server: Server): ServerMetrics {
        const existingMetrics = this.serverMetrics.get(server.id);
        
        // Connection state based on server state
        let connectionState: 'connected' | 'disconnected' | 'connecting' | 'error';
        switch (server.state) {
            case ServerState.RUNNING:
                connectionState = 'connected';
                break;
            case ServerState.STARTING:
            case ServerState.RESTARTING:
                connectionState = 'connecting';
                break;
            case ServerState.ERROR:
                connectionState = 'error';
                break;
            default:
                connectionState = 'disconnected';
        }

        // Calculate uptime if available
        let uptime = 0;
        if (server.startTime) {
            const endTime = server.stopTime || new Date();
            uptime = endTime.getTime() - server.startTime.getTime();
        }

        // Get error count - this may not be available through the interface
        const errorCount = 0; // Simplified placeholder
        
        return {
            serverId: server.id,
            restartCount: server.restartCount || 0,
            uptime,
            lastStartTime: server.startTime || new Date(),
            isHealthy: server.state === ServerState.RUNNING,
            connectionState,
            toolCount: 0, // Will be updated when we implement tool tracking
            errorCount,
            clientMetrics: existingMetrics?.clientMetrics,
            successRate: existingMetrics?.successRate || 1.0
        };
    }

    /**
     * Get all server metrics
     */
    public getAllMetrics(): Map<string, ServerMetrics> {
        return new Map(this.serverMetrics);
    }

    /**
     * Get metrics for a specific server
     */
    public getServerMetrics(serverId: string): ServerMetrics | undefined {
        return this.serverMetrics.get(serverId);
    }

    /**
     * Get the server manager instance
     */
    public getServerManager(): IServerManager {
        return this.serverManager;
    }

    /**
     * Get a formatted HTML report of all server metrics
     */
    public generateHtmlReport(): string {
        console.log(`[MetricsDashboard] Generating HTML report for ${this.serverMetrics.size} servers`);
        
        let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>MCP Server Dashboard</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .dashboard { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 20px; }
                .server-card { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
                .server-header { display: flex; justify-content: space-between; align-items: center; }
                .server-title { margin: 0; font-size: 18px; }
                .status { padding: 4px 8px; border-radius: 4px; font-size: 14px; font-weight: bold; }
                .status.running { background-color: #d4edda; color: #155724; }
                .status.error { background-color: #f8d7da; color: #721c24; }
                .status.connecting { background-color: #fff3cd; color: #856404; }
                .status.disconnected { background-color: #e2e3e5; color: #383d41; }
                .metrics-section { margin-top: 16px; }
                .metrics-table { width: 100%; border-collapse: collapse; }
                .metrics-table td { padding: 6px; border-bottom: 1px solid #eee; }
                .metrics-table td:first-child { font-weight: bold; width: 50%; }
                .chart-container { height: 200px; margin-top: 16px; }
                .no-data { text-align: center; padding: 30px; background: #f8f9fa; border-radius: 8px; }
                .tools-list { font-size: 12px; color: #666; margin-top: 10px; }
                .server-info { color: #666; font-size: 12px; margin-top: 8px; padding: 8px; background: #f8f9fa; border-radius: 4px; }
            </style>
            <meta http-equiv="refresh" content="10">
        </head>
        <body>
            <h1>MCP Server Dashboard</h1>
            <p>Last updated: ${new Date().toLocaleString()}</p>
            <div class="server-info">
                <strong>Server Manager Info:</strong> Tracking ${this.serverMetrics.size} servers, ${this.serverManager.getServerIds().length} servers available via API
            </div>
        `;

        // Get all server IDs from both the manager and our metrics
        const managerServerIds = this.serverManager.getServerIds() || [];
        const metricServerIds = Array.from(this.serverMetrics.keys());
        
        // Combine and deduplicate server IDs
        const allServerIds = [...new Set([...managerServerIds, ...metricServerIds])];
        
        console.log(`[MetricsDashboard] Server IDs from manager: ${managerServerIds.length}, from metrics: ${metricServerIds.length}, combined: ${allServerIds.length}`);
        
        // Debug info in the dashboard
        html += `
        <div class="server-info">
            <strong>Debug Info:</strong> Manager server IDs: ${JSON.stringify(managerServerIds)}, 
            Metrics server IDs: ${JSON.stringify(metricServerIds)}
        </div>
        `;
        
        if (allServerIds.length === 0) {
            // No servers found at all
            html += `
            <div class="no-data">
                <h2>No MCP Servers Found</h2>
                <p>There are currently no MCP servers configured or running.</p>
                <p>Server IDs from manager: ${JSON.stringify(managerServerIds)}</p>
                <p>Metrics count: ${this.serverMetrics.size}</p>
                <p>If servers should be running, check server manager implementation.</p>
            </div>
            `;
        } else {
            // Create server cards section
            html += `<div class="dashboard">`;
            
            for (const serverId of allServerIds) {
                // Get server from manager if possible
                const server = this.serverManager.getServer(serverId);
                // Get metrics if available
                const metrics = this.serverMetrics.get(serverId);
                
                // Determine server state
                let state = 'UNKNOWN';
                let stateClass = 'disconnected';
                
                if (server) {
                    state = server.state || 'UNKNOWN';
                    if (state === 'RUNNING') stateClass = 'running';
                    else if (state === 'ERROR') stateClass = 'error';
                    else if (state === 'STARTING' || state === 'RESTARTING') stateClass = 'connecting';
                } else if (metrics) {
                    state = metrics.connectionState.toUpperCase();
                    if (metrics.connectionState === 'connected') stateClass = 'running';
                    else if (metrics.connectionState === 'error') stateClass = 'error';
                    else if (metrics.connectionState === 'connecting') stateClass = 'connecting';
                }
                
                html += `
                <div class="server-card">
                    <div class="server-header">
                        <h3 class="server-title">${serverId}</h3>
                        <span class="status ${stateClass}">${state}</span>
                    </div>
                    <div class="server-info">
                        Server object available: ${server ? 'Yes' : 'No'}, 
                        Metrics available: ${metrics ? 'Yes' : 'No'}
                    </div>
                    <div class="metrics-section">
                        <table class="metrics-table">
                            <tr>
                                <td>Status</td>
                                <td>${metrics?.isHealthy ? 'Healthy' : (server?.state === 'RUNNING' ? 'Running' : 'Not Healthy')}</td>
                            </tr>
                `;
                
                // Add server info if available
                if (server) {
                    html += `
                            <tr>
                                <td>Start Time</td>
                                <td>${server.startTime ? server.startTime.toLocaleString() : 'N/A'}</td>
                            </tr>
                            <tr>
                                <td>Uptime</td>
                                <td>${server.startTime ? this.formatDuration(new Date().getTime() - server.startTime.getTime()) : 'N/A'}</td>
                            </tr>
                            <tr>
                                <td>Restart Count</td>
                                <td>${server.restartCount || 0}</td>
                            </tr>
                            <tr>
                                <td>Server State</td>
                                <td>${server.state || 'UNKNOWN'}</td>
                            </tr>
                    `;
                    
                    // Try to get tools count
                    try {
                        const client = (server as any).client;
                        if (client && client.cache) {
                            const toolsList = client.cache.get('tools-list');
                            if (toolsList && Array.isArray(toolsList)) {
                                html += `
                                        <tr>
                                            <td>Available Tools</td>
                                            <td>${toolsList.length}</td>
                                        </tr>
                                        <tr>
                                            <td colspan="2">
                                                <div class="tools-list">
                                                    ${toolsList.slice(0, 10).map((t: any) => t.name || t).join(', ')}
                                                    ${toolsList.length > 10 ? '...' : ''}
                                                </div>
                                            </td>
                                        </tr>
                                    `;
                            }
                        }
                    } catch (error) {
                        // Ignore errors accessing tools
                        html += `
                            <tr>
                                <td>Tool Access Error</td>
                                <td>Could not access tools: ${(error as Error).message}</td>
                            </tr>
                        `;
                    }
                } else {
                    html += `
                        <tr>
                            <td>Server Object</td>
                            <td>Not available via getServer()</td>
                        </tr>
                    `;
                }
                
                // Add metrics if available
                if (metrics) {
                    if (!server) { // Don't duplicate info if we already showed server data
                        html += `
                            <tr>
                                <td>Uptime</td>
                                <td>${this.formatDuration(metrics.uptime)}</td>
                            </tr>
                            <tr>
                                <td>Tool Count</td>
                                <td>${metrics.toolCount || 'Unknown'}</td>
                            </tr>
                            <tr>
                                <td>Restart Count</td>
                                <td>${metrics.restartCount}</td>
                            </tr>
                        `;
                    }
                    
                    html += `
                        <tr>
                            <td>Error Count</td>
                            <td>${metrics.errorCount || 0}</td>
                        </tr>
                    `;
                
                    // Add client metrics if available
                    if (metrics.clientMetrics) {
                        const cm = metrics.clientMetrics;
                        html += `
                            <tr>
                                <td>Success Rate</td>
                                <td>${((metrics.successRate || 1.0) * 100).toFixed(1)}%</td>
                            </tr>
                            <tr>
                                <td>Total Requests</td>
                                <td>${cm.requests}</td>
                            </tr>
                            <tr>
                                <td>Tool Calls</td>
                                <td>${cm.toolCalls}</td>
                            </tr>
                            <tr>
                                <td>Errors</td>
                                <td>${cm.errors}</td>
                            </tr>
                            <tr>
                                <td>Avg Response Time</td>
                                <td>${cm.avgResponseTime.toFixed(0)} ms</td>
                            </tr>
                        `;
                    }
                } else {
                    html += `
                        <tr>
                            <td>Metrics</td>
                            <td>Not available</td>
                        </tr>
                    `;
                }
                
                html += `
                        </table>
                    </div>
                </div>
                `;
            }
            
            html += `</div>`;
        }

        html += `
        </body>
        </html>
        `;

        return html;
    }
    
    /**
     * Format a duration in milliseconds to a human-readable string
     */
    private formatDuration(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) {
            return `${days}d ${hours % 24}h`;
        } else if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    /**
     * Manually register a server with the dashboard
     * This can be used when automatic discovery fails
     */
    public registerServer(serverId: string, server?: Server): void {
        console.log(`[MetricsDashboard] Manually registering server: ${serverId}`);
        
        // First try using the provided server object
        if (server) {
            this.initializeServerMetrics(serverId, server);
            this.setupClientMetricsListeners(serverId);
            return;
        }
        
        // Try to get server from manager
        try {
            const serverObj = this.serverManager.getServer(serverId);
            
            if (serverObj) {
                console.log(`[MetricsDashboard] Found server ${serverId} via getServer method`);
                this.initializeServerMetrics(serverId, serverObj);
                this.setupClientMetricsListeners(serverId);
                return;
            } else {
                console.log(`[MetricsDashboard] Server ${serverId} not found via getServer method`);
            }
            
            // Try to get direct access to servers map
            const serversMap = this.getServersDirectly();
            const mapServer = serversMap.get(serverId);
            
            if (mapServer) {
                console.log(`[MetricsDashboard] Found server ${serverId} via direct map access`);
                this.initializeServerMetrics(serverId, mapServer);
                this.setupClientMetricsListeners(serverId);
                return;
            } else {
                console.log(`[MetricsDashboard] Server ${serverId} not found in direct map access`);
            }
            
            // Last resort: check if server exists but isn't accessible properly
            const serverIds = this.serverManager.getServerIds();
            if (serverIds.includes(serverId)) {
                console.log(`[MetricsDashboard] Server ${serverId} exists in getServerIds but can't be accessed via getServer`);
            }
            
            // Try to inspect the server manager to see what methods are available
            const manager = this.serverManager as any;
            const managerProps = Object.getOwnPropertyNames(manager);
            console.log(`[MetricsDashboard] Server manager properties: ${managerProps.join(', ')}`);
            
            // Create a minimal server metrics object as fallback
            this.serverMetrics.set(serverId, {
                serverId: serverId,
                restartCount: 0,
                uptime: 0,
                lastStartTime: new Date(),
                isHealthy: false,
                connectionState: 'disconnected',
                toolCount: 0,
                errorCount: 0,
                successRate: 1.0
            });
            console.log(`[MetricsDashboard] Created minimal metrics for manually registered server: ${serverId}`);
            
        } catch (error) {
            console.error(`[MetricsDashboard] Error manually registering server ${serverId}:`, error);
            
            // Create a minimal server metrics object even after error
            this.serverMetrics.set(serverId, {
                serverId: serverId,
                restartCount: 0,
                uptime: 0,
                lastStartTime: new Date(),
                isHealthy: false,
                connectionState: 'error',
                toolCount: 0,
                errorCount: 1,
                successRate: 0
            });
        }
        
        // Always attempt to refresh metrics
        this.refreshServerMetrics(serverId);
    }

    /**
     * Force a refresh of all discovered servers
     */
    public forceRefresh(): void {
        console.log(`[MetricsDashboard] Forcing refresh of all servers...`);
        this.discoverServers();
        this.refreshAllMetrics();
    }
}