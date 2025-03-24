import { IServerManager } from '../interfaces/core.js';
import { Server, ServerState, ServerConfig } from '../types/server.js';
import { MCPError, MCPErrorRecord, ErrorStats, createMCPErrorRecord } from '../types/errors.js';
import { EventEmitter } from 'events';
import { injectable, inject } from 'inversify';
import { IMCPClient } from '../interfaces/core.js';
import { Container } from 'inversify';

@injectable()
export class BaseServerManager extends EventEmitter implements IServerManager {
    protected servers: Map<string, Server> = new Map();
    protected clientsMap: Map<string, string> = new Map();
    protected container: Container;
    protected maxRetries = 2;
    protected retryDelay = 2000;

    // Error tracking
    protected errors: Map<string, MCPErrorRecord[]> = new Map();
    protected errorStats: Map<string, ErrorStats> = new Map();

    constructor(
        @inject('ClientsMap') clientsMap: Map<string, string>,
        @inject('Container') container: Container
    ) {
        super();
        this.clientsMap = clientsMap;
        this.container = container;
    }

    /**
     * Append an error message to the server's error log
     * This preserves previous error context instead of replacing it
     * and adds structured error tracking
     */
    protected appendError(id: string, error: Error | string): void {
        const server = this.getServer(id);
        if (!server) return;
        
        const errorMsg = error instanceof Error ? error.message : error;
        
        // Update the server's lastError field (existing behavior)
        if (server.lastError) {
            // If we already have an error, append this one with a timestamp
            const timestamp = new Date().toISOString();
            const previousError = server.lastError.message || String(server.lastError);
            const newErrorMessage = `${previousError}\n[${timestamp}] ${errorMsg}`;
            server.lastError = new Error(newErrorMessage);
        } else {
            server.lastError = error instanceof Error ? error : new Error(errorMsg);
        }
        
        // Create structured error record
        const errorObj = createMCPErrorRecord(
            errorMsg,
            id,
            error instanceof Error ? error : new Error(errorMsg)
        );
        
        // Store the full error
        if (!this.errors.has(id)) {
            this.errors.set(id, []);
        }
        this.errors.get(id)?.push(errorObj);
        
        // Limit stored errors to most recent 100
        const serverErrors = this.errors.get(id);
        if (serverErrors && serverErrors.length > 100) {
            this.errors.set(id, serverErrors.slice(-100));
        }
        
        // Update error stats
        const errorKey = `${id}:${errorMsg}`;
        if (!this.errorStats.has(errorKey)) {
            this.errorStats.set(errorKey, {
                count: 0,
                firstSeen: errorObj.timestamp,
                lastSeen: errorObj.timestamp,
                sources: new Set()
            });
        }
        
        const stats = this.errorStats.get(errorKey);
        if (stats) {
            stats.count++;
            stats.lastSeen = errorObj.timestamp;
            stats.sources.add(errorObj.source);
        }
        
        // Emit error event (also update existing code to use this format)
        this.emit('server.error', errorObj);
    }

    /**
     * Set up event handlers for MCP notifications
     * This sets up handlers to refresh data when it changes on the server
     */
    protected setupNotificationHandlers(id: string, client: IMCPClient): void {
        // Now we're relying on the EnhancedMCPClient to handle notifications directly
        // This method is still here for backward compatibility or future extensions
        // No need to duplicate notification handlers already set up in the client
        console.log(`Server manager is aware of server ${id}, but notifications are handled by the client`);
    }

    /**
     * Start or restart a server
     */
    public async startServer(id: string): Promise<Server> {
        const server = this.getServer(id);
        if (!server) {
            throw new Error(`Server not found: ${id}`);
        }

        // Update server state
        server.state = ServerState.STARTING;
        server.startTime = new Date();
        server.stopTime = undefined;
        
        // Fire state changed event
        this.emit('server.state.changed', { id, state: server.state });

        try {
            // Try to reuse an existing client if available
            if (server.client) {
                console.log(`Reusing existing client for ${id}`);
                
                try {
                    // Check if client is already connected; if not, initialize it
                    const client = server.client;
                    
                    // We need to ensure the client is initialized
                    await client.initialize();
                    
                    console.log(`Initialized existing client for ${id}`);
                    
                    // Update server state to running
                    server.state = ServerState.RUNNING;
                    this.emit('server.state.changed', { id, state: server.state });
                    
                    return server;
                } catch (error) {
                    // Log the error but continue with creating a new client
                    console.error(`Error reusing client for ${id}, will create new one: ${error}`);
                    
                    // Clean up the existing client
                    try {
                        await server.client.disconnect();
                    } catch (disconnectError) {
                        console.warn(`Error disconnecting client for ${id}: ${disconnectError}`);
                    }
                    
                    // Clear the client reference
                    server.client = null;
                    
                    // Clear client binding from container to ensure clean state
                    const clientId = this.clientsMap.get(id);
                    if (clientId && this.container.isBound(clientId)) {
                        try {
                            this.container.unbind(clientId);
                            console.log(`Unbound client ${clientId} from container for clean restart`);
                        } catch (unbindError) {
                            console.warn(`Error unbinding client ${clientId}: ${unbindError}`);
                        }
                    }
                }
            }

            // Create a new client
            const config = { ...server.config };
            const clientFactory = this.getClientFactory();
            server.client = clientFactory(config, id);

            // Initialize the client
            await server.client.initialize();
            
            // Server is now running
            server.state = ServerState.RUNNING;
            this.emit('server.state.changed', { id, state: server.state });
            this.emit('serverStarted', { id, server });
            
            return server;
        } catch (error) {
            // Update server state to error
            server.state = ServerState.ERROR;
            server.error = error instanceof Error ? error : new Error(String(error));
            
            // Fire error event
            this.emit('server.error', { 
                error: server.error, 
                serverId: id,
                message: `Error starting server ${id}: ${server.error.message}`
            });
            
            // Rethrow the error
            throw server.error;
        }
    }

    public async stopServer(id: string): Promise<void> {
        const server = this.getServer(id);
        if (!server) {
            return; // Server doesn't exist, nothing to stop
        }

        try {
            server.state = ServerState.STOPPING;
            this.emit('server.state.changed', { id, state: server.state });
            this.emit('serverStopping', id);
            
            // Get and disconnect the client
            const clientId = this.clientsMap.get(id);
            if (clientId && this.container.isBound(clientId)) {
                try {
                    const client = this.container.get<IMCPClient>(clientId);
                    await client.disconnect();
                    console.log(`Successfully disconnected client for server ${id}`);
                } catch (disconnectError) {
                    console.error(`Error disconnecting client for server ${id}:`, disconnectError);
                    // Continue with server stop even if disconnect fails
                }
            }
            
            // If server has a direct client reference, ensure it's disconnected too
            if (server.client) {
                try {
                    await server.client.disconnect();
                    console.log(`Successfully disconnected direct client reference for server ${id}`);
                } catch (directDisconnectError) {
                    console.error(`Error disconnecting direct client for server ${id}:`, directDisconnectError);
                    // Continue with server stop even if disconnect fails
                }
                
                // Clear the client reference
                server.client = null;
            }

            server.state = ServerState.STOPPED;
            server.stopTime = new Date();
            this.emit('server.state.changed', { id, state: server.state });
            this.emit('serverStopped', id);
        } catch (error) {
            // Handle stop failure without affecting other servers
            console.error(`Error stopping server ${id}:`, error);
            server.state = ServerState.ERROR;
            server.lastError = error instanceof Error ? error : new Error(String(error));
            this.emit('server.state.changed', { id, state: server.state });
            this.emit('server.error', { 
                error: server.lastError, 
                serverId: id,
                message: `Error stopping server ${id}: ${server.lastError.message}`
            });
        }
    }

    public hasServer(id: string): boolean {
        return this.servers.has(id);
    }

    public getServerIds(): string[] {
        return Array.from(this.servers.keys());
    }

    public getServer(id: string): Server | undefined {
        return this.servers.get(id);
    }

    public async unregisterServer(id: string): Promise<void> {
        await this.stopServer(id);
        
        // Clean up container bindings
        const clientId = this.clientsMap.get(id);
        if (clientId && this.container.isBound(clientId)) {
            this.container.unbind(clientId);
        }
        
        this.clientsMap.delete(id);
        this.servers.delete(id);
        this.emit('serverUnregistered', id);
    }

    /**
     * Get the current status of a server
     */
    public async getServerStatus(id: string): Promise<ServerState> {
        const server = this.getServer(id);
        if (!server) {
            throw MCPError.serverNotFound();
        }
        return server.state;
    }
    
    /**
     * Register a new server with the manager
     */
    public async registerServer(id: string, config: ServerConfig): Promise<void> {
        if (this.hasServer(id)) {
            console.log(`Server ${id} already registered, updating config`);
            const server = this.getServer(id)!;
            server.config = config;
            return;
        }
        
        console.log(`Registering server ${id}`);
        
        // Create the server object first
        const server: Server = {
            id,
            name: config.name || id,
            version: '1.0.0',
            state: ServerState.STOPPED,
            config,
            startTime: undefined,
            stopTime: undefined
        };
        
        // Add to the servers map
        this.servers.set(id, server);
        
        // Now we can attempt to start it
        try {
            await this.startServer(id);
        } catch (error) {
            console.error(`Error starting newly registered server ${id}:`, error);
            // Don't rethrow - the server is registered but failed to start
        }
    }
    
    /**
     * Restart a server by shutting it down and starting it again
     */
    public async restartServer(serverId: string): Promise<void> {
        // Check if server exists
        const server = this.servers.get(serverId);
        if (!server) {
            console.error(`Cannot restart server ${serverId}: Server not found`);
            throw new Error(`Server ${serverId} not found`);
        }
        
        // Increment restart count for metrics
        server.restartCount = (server.restartCount || 0) + 1;
        
        // Track original configuration for restart
        const config = server.config;
        
        try {
            // Update server state
            console.log(`Restarting server ${serverId}`);
            server.state = ServerState.RESTARTING;
            this.emit('server.state.changed', { id: serverId, state: ServerState.RESTARTING });
            this.emit('server-state-change', serverId, ServerState.RESTARTING);
            
            // Try to properly stop the server first with a timeout
            try {
                await Promise.race([
                    this.stopServer(serverId),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Stop timeout')), 5000))
                ]);
            } catch (stopError) {
                console.warn(`Warning: Error stopping server ${serverId} during restart, continuing anyway:`, stopError);
                // Don't rethrow, we'll still try to restart
            }
            
            // Add a delay to ensure clean shutdown
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Perform extra cleanup to avoid StdioClientTransport already started issue
            if (server.client) {
                try {
                    console.log(`Forcefully disconnecting client for ${serverId} before restart`);
                    
                    // Try to disconnect at the transport level
                    if ((server.client as any)._transport && typeof (server.client as any)._transport.stop === 'function') {
                        try {
                            await (server.client as any)._transport.stop();
                            console.log(`Stopped transport for ${serverId}`);
                        } catch (transportError) {
                            console.warn(`Warning: Error stopping transport for ${serverId}:`, transportError);
                        }
                    }
                    
                    // Force client to null
                    const clientId = `IMCPClient_${serverId}`;
                    if (this.container.isBound(clientId)) {
                        console.log(`Unbound client ${clientId} from container for clean restart`);
                        this.container.unbind(clientId);
                    }
                    
                    // Remove from clientsMap as well
                    if (this.clientsMap && this.clientsMap.has(serverId)) {
                        this.clientsMap.delete(serverId);
                        console.log(`Removed client from clientsMap for ${serverId}`);
                    }
                    
                    // Force server client to null
                    server.client = null;
                    console.log(`Reset server.client to null for ${serverId}`);
                } catch (cleanupError) {
                    console.warn(`Warning: Error during client cleanup for ${serverId}:`, cleanupError);
                }
            }
            
            // Update state and trigger restart
            server.state = ServerState.STARTING;
            this.emit('server.state.changed', { id: serverId, state: ServerState.STARTING });
            this.emit('server-state-change', serverId, ServerState.STARTING);
            
            // Pause before restarting
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Start the server with original config
            const success = await this.startServer(serverId);
            
            if (success) {
                console.log(`Server ${serverId} restarted successfully`);
                this.emit('server.restarted', { id: serverId, success: true });
            } else {
                throw new Error(`Failed to start server ${serverId} during restart`);
            }
        } catch (error) {
            // Update server state to error and emit event
            console.error(`Error restarting server ${serverId}:`, error);
            server.state = ServerState.ERROR;
            this.emit('server.state.changed', { id: serverId, state: ServerState.ERROR });
            this.emit('server-state-change', serverId, ServerState.ERROR);
            this.emit('server.restarted', { id: serverId, success: false, error });
            this.emit('server.error', { serverId, error });
            throw error; // Rethrow the error to comply with interface
        }
    }

    /**
     * Get errors for a specific server
     */
    public getServerErrors(serverId: string): MCPErrorRecord[] {
        return this.errors.get(serverId) || [];
    }
    
    /**
     * Get error statistics
     */
    public getErrorStats(): Map<string, ErrorStats> {
        return new Map(this.errorStats);
    }
    
    /**
     * Clear errors for a specific server
     */
    public clearServerErrors(serverId: string): void {
        this.errors.delete(serverId);
        
        // Remove related stats
        for (const key of this.errorStats.keys()) {
            if (key.startsWith(`${serverId}:`)) {
                this.errorStats.delete(key);
            }
        }
        
        this.emit('server.errors.cleared', { serverId });
    }

    /**
     * Get a client factory function that creates clients for servers
     * This is a helper method used by startServer
     */
    protected getClientFactory(): (config: ServerConfig, id: string) => IMCPClient {
        return (config: ServerConfig, id: string): IMCPClient => {
            // Try to use existing client id from the map if available
            const clientId = this.clientsMap.get(id);
            
            // If we have a bound client, return it
            if (clientId && this.container.isBound(clientId)) {
                return this.container.get<IMCPClient>(clientId);
            }
            
            // Otherwise create a new base client
            const { BaseMCPClient } = require('./base-mcp-client.js');
            const client = new BaseMCPClient(config, id);
            
            // Generate client ID if needed
            const newClientId = clientId || `IMCPClient_${id}`;
            
            // Store in the map
            this.clientsMap.set(id, newClientId);
            
            // Bind in the container
            this.container.bind<IMCPClient>(newClientId).toConstantValue(client);
            
            return client;
        };
    }

    /**
     * Get all servers as a map
     */
    public getAllServers(): Map<string, Server> {
        return new Map(this.servers);
    }
} 