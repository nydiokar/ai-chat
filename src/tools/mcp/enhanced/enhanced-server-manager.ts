import { BaseServerManager } from '../base/base-server-manager.js';
import { ServerState, ServerEvent, ServerConfig, Server } from '../types/server.js';
import { MCPError } from '../types/errors.js';
import { injectable, inject } from 'inversify';
import { Container } from 'inversify';
import { EnhancedMCPClient } from './enhanced-mcp-client.js';
import { IMCPClient } from '../interfaces/core.js';
import { info, warn, error, debug } from '../../../utils/logger.js';
import { createLogContext, createErrorContext } from '../../../utils/log-utils.js';
import { z } from 'zod';

const COMPONENT = 'EnhancedServerManager';

// Server state validation schema
const ServerStateSchema = z.object({
    id: z.string(),
    state: z.nativeEnum(ServerState),
    config: z.object({
        host: z.string(),
        port: z.number()
    }).passthrough(),
    metrics: z.object({
        uptime: z.number(),
        errorCount: z.number(),
        restartCount: z.number()
    }).passthrough()
});

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
        
        info('Initializing Enhanced Server Manager', createLogContext(
            COMPONENT,
            'constructor',
            {
                healthCheckInterval: this.HEALTH_CHECK_INTERVAL,
                idleTimeout: this.IDLE_TIMEOUT,
                maxHistorySize: this.MAX_HISTORY_SIZE
            }
        ));

        this.startHealthCheck();
        this.setupEnhancedClientListeners();
    }

    private startHealthCheck(): void {
        if (this.healthCheckTimer) {
            debug('Health check already running', createLogContext(
                COMPONENT,
                'startHealthCheck',
                { status: 'skipped' }
            ));
            return;
        }

        this.healthCheckTimer = setInterval(() => {
            this.checkServerHealth().catch(err => {
                error('Health check failed', createErrorContext(
                    COMPONENT,
                    'startHealthCheck',
                    'System',
                    'HEALTH_CHECK_ERROR',
                    err
                ));
            });
        }, this.HEALTH_CHECK_INTERVAL);

        info('Health check started', createLogContext(
            COMPONENT,
            'startHealthCheck',
            { 
                intervalMs: this.HEALTH_CHECK_INTERVAL,
                status: 'running'
            }
        ));
    }

    /**
     * Set up event listeners for all enhanced clients
     * This ensures events are properly forwarded through the server manager
     */
    private setupEnhancedClientListeners(): void {
        this.updateManagedClients();
        
        this.on('serverStarted', () => this.updateManagedClients());
        this.on('serverStopped', () => this.updateManagedClients());

        debug('Event listeners configured', createLogContext(
            COMPONENT,
            'setupEnhancedClientListeners',
            { status: 'ready' }
        ));
    }
    
    /**
     * Update the managed clients list and set up event forwarding
     */
    private updateManagedClients(): void {
        try {
            const previousCount = this.managedClients.size;
            this.managedClients.clear();
            
            for (const [serverId, clientId] of this.clientsMap.entries()) {
                if (!this.container.isBound(clientId)) {
                    debug('Skipping unbound client', createLogContext(
                        COMPONENT,
                        'updateManagedClients',
                        { serverId, clientId, status: 'skipped' }
                    ));
                    continue;
                }
                
                try {
                    const client = this.container.get<IMCPClient>(clientId);
                    
                    if (client instanceof EnhancedMCPClient) {
                        this.managedClients.set(serverId, client);
                        this.setupClientEventForwarding(serverId, client);
                    }
                } catch (err) {
                    error('Client setup failed', createErrorContext(
                        COMPONENT,
                        'updateManagedClients',
                        'System',
                        'CLIENT_SETUP_ERROR',
                        err,
                        { serverId, clientId }
                    ));
                }
            }
            
            info('Managed clients updated', createLogContext(
                COMPONENT,
                'updateManagedClients',
                {
                    previousCount,
                    currentCount: this.managedClients.size,
                    delta: this.managedClients.size - previousCount
                }
            ));
        } catch (err) {
            error('Client management update failed', createErrorContext(
                COMPONENT,
                'updateManagedClients',
                'System',
                'UPDATE_ERROR',
                err
            ));
        }
    }

    private setupClientEventForwarding(serverId: string, client: EnhancedMCPClient): void {
        client.on('tools.changed', (data) => {
            this.emit('toolsChanged', {
                id: serverId,
                timestamp: new Date(),
                type: 'tools_changed',
                data
            });
        });
        
        client.on('resources.changed', (data) => {
            this.emit('resourcesChanged', {
                id: serverId,
                timestamp: new Date(),
                type: 'resources_changed',
                data
            });
        });
        
        debug('Client event forwarding configured', createLogContext(
            COMPONENT,
            'setupClientEventForwarding',
            { serverId, status: 'ready' }
        ));
    }

    private async checkServerHealth(): Promise<void> {
        const activeServers = Array.from(this.servers.entries())
            .filter(([_, server]) => server.state === ServerState.RUNNING);

        debug('Starting health check', createLogContext(
            COMPONENT,
            'checkServerHealth',
            { activeServers: activeServers.length }
        ));

        for (const [id, server] of activeServers) {
            const history = this.getServerHistory(id);
            const now = Date.now();
            const idleTime = now - history.metrics.lastActivity;

            try {
                const validationResult = ServerStateSchema.safeParse(server);
                
                if (!validationResult.success) {
                    warn('Server state validation failed', createLogContext(
                        COMPONENT,
                        'checkServerHealth',
                        {
                            serverId: id,
                            errors: validationResult.error.errors.map(e => e.message)
                        }
                    ));
                }

                if (idleTime > this.IDLE_TIMEOUT) {
                    warn('Server idle timeout reached', createLogContext(
                        COMPONENT,
                        'checkServerHealth',
                        {
                            serverId: id,
                            idleTime,
                            timeout: this.IDLE_TIMEOUT,
                            action: 'pause'
                        }
                    ));
                    await this.pauseServer(id);
                    continue;
                }

                if (history.metrics.errorCount > 5) {
                    warn('High error rate detected', createLogContext(
                        COMPONENT,
                        'checkServerHealth',
                        {
                            serverId: id,
                            errorCount: history.metrics.errorCount,
                            action: 'monitor'
                        }
                    ));
                }
            } catch (err) {
                error('Health check operation failed', createErrorContext(
                    COMPONENT,
                    'checkServerHealth',
                    'System',
                    'HEALTH_CHECK_ERROR',
                    err,
                    { serverId: id }
                ));
            }
        }
    }

    private initializeHistory(id: string): void {
        if (this.serverHistory.has(id)) {
            debug('Server history already exists', createLogContext(
                COMPONENT,
                'initializeHistory',
                { serverId: id, status: 'exists' }
            ));
            return;
        }

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

        debug('Server history initialized', createLogContext(
            COMPONENT,
            'initializeHistory',
            { serverId: id, status: 'created' }
        ));
    }

    private trackEvent(id: string, event: ServerEvent): void {
        const history = this.getServerHistory(id);
        history.events.unshift(event);

        // Trim history if needed
        if (history.events.length > this.MAX_HISTORY_SIZE) {
            const removed = history.events.splice(this.MAX_HISTORY_SIZE);
            debug('History trimmed', createLogContext(
                COMPONENT,
                'trackEvent',
                { 
                    serverId: id,
                    removedEvents: removed.length,
                    currentSize: history.events.length
                }
            ));
        }

        // Update metrics based on event type
        switch (event.type) {
            case 'error':
                history.metrics.errorCount++;
                history.metrics.lastError = event.error;
                break;
            case 'restart':
                history.metrics.restartCount++;
                break;
            case 'response':
                if (event.duration !== undefined) {
                    history.metrics.avgResponseTime = 
                        (history.metrics.avgResponseTime * (history.events.length - 1) + event.duration) / history.events.length;
                }
                break;
        }

        history.metrics.lastActivity = Date.now();
        
        debug('Event tracked', createLogContext(
            COMPONENT,
            'trackEvent',
            {
                serverId: id,
                eventType: event.type,
                metricsUpdated: true
            }
        ));
    }

    public override async startServer(id: string): Promise<Server> {
        info('Starting server', createLogContext(
            COMPONENT,
            'startServer',
            { serverId: id }
        ));

        try {
            const server = await super.startServer(id);
            this.initializeHistory(id);
            
            this.trackEvent(id, {
                type: 'start',
                timestamp: new Date(),
                data: { state: server.state }
            });

            info('Server started successfully', createLogContext(
                COMPONENT,
                'startServer',
                { 
                    serverId: id,
                    state: server.state,
                    status: 'success'
                }
            ));

            return server;
        } catch (err) {
            error('Failed to start server', createErrorContext(
                COMPONENT,
                'startServer',
                'System',
                'START_ERROR',
                err,
                { serverId: id }
            ));
            throw err;
        }
    }

    public async pauseServer(id: string): Promise<void> {
        info('Pausing server', createLogContext(
            COMPONENT,
            'pauseServer',
            { serverId: id }
        ));

        try {
            const server = this.servers.get(id);
            if (!server) {
                throw MCPError.serverNotFound(id);
            }

            if (server.state !== ServerState.RUNNING) {
                warn('Cannot pause server - invalid state', createLogContext(
                    COMPONENT,
                    'pauseServer',
                    { 
                        serverId: id,
                        currentState: server.state,
                        expectedState: ServerState.RUNNING
                    }
                ));
                return;
            }

            server.state = ServerState.PAUSED;
            this.trackEvent(id, {
                type: 'pause',
                timestamp: new Date(),
                data: { state: ServerState.PAUSED }
            });

            info('Server paused successfully', createLogContext(
                COMPONENT,
                'pauseServer',
                { 
                    serverId: id,
                    status: 'success'
                }
            ));
        } catch (err) {
            error('Failed to pause server', createErrorContext(
                COMPONENT,
                'pauseServer',
                'System',
                'PAUSE_ERROR',
                err,
                { serverId: id }
            ));
            throw err;
        }
    }

    public async resumeServer(id: string): Promise<void> {
        info('Resuming server', createLogContext(
            COMPONENT,
            'resumeServer',
            { serverId: id }
        ));

        try {
            const server = this.servers.get(id);
            if (!server) {
                throw MCPError.serverNotFound(id);
            }

            if (server.state !== ServerState.PAUSED) {
                warn('Cannot resume server - invalid state', createLogContext(
                    COMPONENT,
                    'resumeServer',
                    { 
                        serverId: id,
                        currentState: server.state,
                        expectedState: ServerState.PAUSED
                    }
                ));
                return;
            }

            server.state = ServerState.RUNNING;
            this.trackEvent(id, {
                type: 'resume',
                timestamp: new Date(),
                data: { state: ServerState.RUNNING }
            });

            info('Server resumed successfully', createLogContext(
                COMPONENT,
                'resumeServer',
                { 
                    serverId: id,
                    status: 'success'
                }
            ));
        } catch (err) {
            error('Failed to resume server', createErrorContext(
                COMPONENT,
                'resumeServer',
                'System',
                'RESUME_ERROR',
                err,
                { serverId: id }
            ));
            throw err;
        }
    }

    public override async unregisterServer(id: string): Promise<void> {
        info('Unregistering server', createLogContext(
            COMPONENT,
            'unregisterServer',
            { serverId: id }
        ));

        try {
            await super.unregisterServer(id);
            
            const clearedServers = this.serverHistory.delete(id);
            this.managedClients.delete(id);

            info('Server unregistered successfully', createLogContext(
                COMPONENT,
                'unregisterServer',
                { 
                    serverId: id,
                    clearedHistory: clearedServers,
                    status: 'success'
                }
            ));
        } catch (err) {
            error('Failed to unregister server', createErrorContext(
                COMPONENT,
                'unregisterServer',
                'System',
                'UNREGISTER_ERROR',
                err,
                { serverId: id }
            ));
            throw err;
        }
    }

    public cleanup(): void {
        info('Starting cleanup', createLogContext(
            COMPONENT,
            'cleanup'
        ));

        try {
            if (this.healthCheckTimer) {
                clearInterval(this.healthCheckTimer);
                this.healthCheckTimer = undefined;
                debug('Health check stopped', createLogContext(
                    COMPONENT,
                    'cleanup',
                    { healthCheckStopped: true }
                ));
            }

            this.serverHistory.clear();
            this.managedClients.clear();

            info('Cleanup completed', createLogContext(
                COMPONENT,
                'cleanup',
                { 
                    status: 'success',
                    clearedServers: true,
                    clearedClients: true
                }
            ));
        } catch (err) {
            error('Cleanup failed', createErrorContext(
                COMPONENT,
                'cleanup',
                'System',
                'CLEANUP_ERROR',
                err
            ));
        }
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
                debug('Reusing existing client', createLogContext(
                    COMPONENT,
                    'getClientFactory',
                    { serverId: id }
                ));
                return existingClient;
            }
            
            // Create a new enhanced client
            info('Creating new enhanced client', createLogContext(
                COMPONENT,
                'getClientFactory',
                { serverId: id }
            ));

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

    public getServerHistory(id: string): ServerHistory {
        this.initializeHistory(id);
        return this.serverHistory.get(id)!;
    }

    public getServerMetrics(id: string): ServerMetrics | undefined {
        return this.serverHistory.get(id)?.metrics;
    }
} 