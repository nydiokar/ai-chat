import { BaseServerManager } from '../base/base-server-manager.js';
import { ServerState, ServerEvent, ServerConfig, Server } from '../types/server.js';
import { MCPError } from '../types/errors.js';
import { injectable, inject } from 'inversify';
import { Container } from 'inversify';
import { EnhancedMCPClient } from './enhanced-mcp-client.js';
import { IMCPClient } from '../interfaces/core.js';

interface ServerMetrics {
    uptime: number;
    restartCount: number;
    errorCount: number;
    lastError?: Error;
    avgResponseTime: number;
    lastActivity: number;
}

interface ServerHistory {
    events: ServerEvent[];
    metrics: ServerMetrics;
}

@injectable()
export class EnhancedServerManager extends BaseServerManager {
    private serverHistory: Map<string, ServerHistory>;
    private readonly MAX_HISTORY_SIZE = 100;
    private readonly IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    private readonly HEALTH_CHECK_INTERVAL = 60 * 1000; // 1 minute
    private healthCheckTimer?: NodeJS.Timeout;
    private managedClients: Map<string, EnhancedMCPClient> = new Map();

    constructor(
        @inject('ClientsMap') clientsMap: Map<string, string>,
        @inject('Container') container: Container
    ) {
        super(clientsMap, container);
        this.serverHistory = new Map();
        this.startHealthCheck();
        this.setupEnhancedClientListeners();
    }

    /**
     * Set up event listeners for all enhanced clients
     * This ensures events are properly forwarded through the server manager
     */
    private setupEnhancedClientListeners(): void {
        // Initial setup for any existing clients
        this.updateManagedClients();
        
        // Listen for server changes to update client mappings
        this.on('serverStarted', () => this.updateManagedClients());
        this.on('serverStopped', () => this.updateManagedClients());
    }
    
    /**
     * Update the managed clients list and set up event forwarding
     */
    private updateManagedClients(): void {
        try {
            // Clear all previous clients
            this.managedClients.clear();
            
            // Find all client IDs
            for (const [serverId, clientId] of this.clientsMap.entries()) {
                try {
                    // Skip if not bound
                    if (!this.container.isBound(clientId)) continue;
                    
                    // Get the client instance
                    const client = this.container.get<IMCPClient>(clientId);
                    
                    // Only track enhanced clients
                    if (client instanceof EnhancedMCPClient) {
                        this.managedClients.set(serverId, client);
                        
                        // Set up event forwarding
                        client.on('tools.changed', (data) => {
                            console.log(`Enhanced server manager forwarding tools.changed from ${serverId}`);
                            this.emit('toolsChanged', {
                                id: serverId,
                                timestamp: new Date(),
                                type: 'tools_changed',
                                data
                            });
                        });
                        
                        client.on('resources.changed', (data) => {
                            console.log(`Enhanced server manager forwarding resources.changed from ${serverId}`);
                            this.emit('resourcesChanged', {
                                id: serverId,
                                timestamp: new Date(),
                                type: 'resources_changed',
                                data
                            });
                        });
                        
                        console.log(`Enhanced server manager tracking client for ${serverId}`);
                    }
                } catch (error) {
                    console.error(`Error setting up client listeners for ${serverId}:`, error);
                }
            }
            
            console.log(`Enhanced server manager tracking ${this.managedClients.size} clients`);
        } catch (error) {
            console.error('Error updating managed clients:', error);
        }
    }

    private startHealthCheck(): void {
        this.healthCheckTimer = setInterval(() => {
            this.checkServerHealth();
        }, this.HEALTH_CHECK_INTERVAL);
    }

    private async checkServerHealth(): Promise<void> {
        for (const [id, server] of this.servers.entries()) {
            if (server.state === ServerState.RUNNING) {
                const history = this.getServerHistory(id);
                const now = Date.now();

                // Check for idle timeout
                if (now - history.metrics.lastActivity > this.IDLE_TIMEOUT) {
                    await this.pauseServer(id);
                    continue;
                }

                // Check error rate
                if (history.metrics.errorCount > 5) {
                    this.emit('serverWarning', {
                        id,
                        message: 'High error rate detected',
                        metrics: history.metrics
                    });
                }
            }
        }
    }

    private initializeHistory(id: string): void {
        if (!this.serverHistory.has(id)) {
            this.serverHistory.set(id, {
                events: [],
                metrics: {
                    uptime: 0,
                    restartCount: 0,
                    errorCount: 0,
                    avgResponseTime: 0,
                    lastActivity: Date.now()
                }
            });
        }
    }

    private trackEvent(id: string, event: ServerEvent): void {
        this.initializeHistory(id);
        const history = this.serverHistory.get(id)!;

        // Add event to history
        history.events.push(event);
        if (history.events.length > this.MAX_HISTORY_SIZE) {
            history.events = history.events.slice(-this.MAX_HISTORY_SIZE);
        }

        // Update metrics
        const metrics = history.metrics;
        switch (event.type) {
            case 'start':
                metrics.restartCount++;
                break;
            case 'error':
                metrics.errorCount++;
                metrics.lastError = event.error;
                break;
            case 'stop':
                // Update uptime if we have a start time
                const server = this.servers.get(id);
                if (server?.startTime) {
                    metrics.uptime += Date.now() - server.startTime.getTime();
                }
                break;
        }

        metrics.lastActivity = Date.now();
    }

    /**
     * Enhanced implementation of the startServer method
     * Overrides the base implementation to add event tracking
     */
    public override async startServer(id: string): Promise<Server> {
        try {
            const server = await super.startServer(id);
            this.trackEvent(id, {
                id,
                timestamp: new Date(),
                type: 'start'
            });
            return server;
        } catch (error) {
            this.trackEvent(id, {
                id,
                timestamp: new Date(),
                type: 'error',
                error: error instanceof Error ? error : new Error(String(error))
            });
            throw error;
        }
    }

    public override async stopServer(id: string): Promise<void> {
        try {
            await super.stopServer(id);
            this.trackEvent(id, {
                id,
                timestamp: new Date(),
                type: 'stop'
            });
        } catch (error) {
            this.trackEvent(id, {
                id,
                timestamp: new Date(),
                type: 'error',
                error: error instanceof Error ? error : new Error(String(error))
            });
            throw error;
        }
    }

    public async pauseServer(id: string): Promise<void> {
        const server = this.getServer(id);
        if (!server) {
            throw MCPError.serverNotFound();
        }

        if (server.state === ServerState.RUNNING) {
            server.state = ServerState.PAUSED;
            this.trackEvent(id, {
                id,
                timestamp: new Date(),
                type: 'pause'
            });
            this.emit('serverPaused', id);
        }
    }

    public async resumeServer(id: string): Promise<void> {
        const server = this.getServer(id);
        if (!server) {
            throw MCPError.serverNotFound();
        }

        if (server.state === ServerState.PAUSED) {
            try {
                await this.startServer(id);
                this.trackEvent(id, {
                    id,
                    timestamp: new Date(),
                    type: 'resume'
                });
                this.emit('serverResumed', id);
            } catch (error) {
                this.trackEvent(id, {
                    id,
                    timestamp: new Date(),
                    type: 'error',
                    error: error instanceof Error ? error : new Error(String(error))
                });
                throw error;
            }
        }
    }

    public getServerHistory(id: string): ServerHistory {
        this.initializeHistory(id);
        return this.serverHistory.get(id)!;
    }

    public getServerMetrics(id: string): ServerMetrics | undefined {
        return this.serverHistory.get(id)?.metrics;
    }

    public override async unregisterServer(id: string): Promise<void> {
        await super.unregisterServer(id);
        this.serverHistory.delete(id);
    }

    public cleanup(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = undefined;
        }
        this.serverHistory.clear();
    }

    /**
     * Get a client for a server ID
     */
    protected getClient(id: string): IMCPClient | undefined {
        const clientId = this.clientsMap.get(id);
        if (clientId && this.container.isBound(clientId)) {
            return this.container.get<IMCPClient>(clientId);
        }
        return undefined;
    }

    /**
     * Create a client for the specified server
     * This method is called by the base server manager
     */
    protected override getClientFactory(): (config: ServerConfig, id: string) => IMCPClient {
        return (config: ServerConfig, id: string): IMCPClient => {
            // Check if we already have a client for this server
            const existingClient = this.getClient(id);
            
            if (existingClient) {
                console.log(`[EnhancedServerManager] Reusing existing client for ${id}`);
                return existingClient;
            }
            
            // Create a new enhanced client
            console.log(`[EnhancedServerManager] Creating new enhanced client for ${id}`);
            const enhancedClient = new EnhancedMCPClient(config, id);
            
            // Generate client ID if needed
            const clientId = this.clientsMap.get(id) || `IMCPClient_${id}`;
            
            // Store in the map and container
            this.clientsMap.set(id, clientId);
            this.container.bind<IMCPClient>(clientId).toConstantValue(enhancedClient);
            
            // Add to managed clients
            this.managedClients.set(id, enhancedClient);
            
            return enhancedClient;
        };
    }
} 