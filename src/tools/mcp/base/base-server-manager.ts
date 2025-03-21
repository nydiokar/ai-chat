import { IServerManager } from '../interfaces/core.js';
import { Server, ServerState, ServerConfig } from '../types/server.js';
import { MCPError } from '../types/errors.js';
import { EventEmitter } from 'events';
import { injectable, inject } from 'inversify';
import { IMCPClient } from '../interfaces/core.js';
import { Container } from 'inversify';

@injectable()
export class BaseServerManager extends EventEmitter implements IServerManager {
    protected servers: Map<string, Server>;
    protected clientsMap: Map<string, string>;
    protected container: Container;
    protected maxRetries = 2;
    protected retryDelay = 2000;

    constructor(
        @inject('ClientsMap') clientsMap: Map<string, string>,
        @inject('Container') container: Container
    ) {
        super();
        this.servers = new Map();
        this.clientsMap = clientsMap;
        this.container = container;
    }

    public async startServer(id: string, config: ServerConfig): Promise<void> {
        const maxRetries = config.maxRetries ?? this.maxRetries;
        const retryDelay = config.retryDelay ?? this.retryDelay;
        
        // If the server already exists and is running, don't restart it
        if (this.hasServer(id)) {
            const server = this.getServer(id);
            if (server?.state === ServerState.RUNNING) {
                return;
            }
        }

        // Create or update server instance
        const server: Server = {
            id,
            name: config.name,
            version: '1.0.0',
            state: ServerState.STARTING,
            config,
            startTime: new Date(),
            retryCount: 0
        };
        
        this.servers.set(id, server);

        try {
            // Create client if not exists
            if (!this.clientsMap.has(id)) {
                const clientId = `IMCPClient_${id}`;
                this.clientsMap.set(id, clientId);
                
                const { BaseMCPClient } = await import('../base/base-mcp-client.js');
                const clientInstance = new BaseMCPClient(config, id);
                this.container.bind<IMCPClient>(clientId).toConstantValue(clientInstance);
            }

            const clientId = this.clientsMap.get(id);
            if (!clientId) {
                throw new Error(`No client found for server ${id}`);
            }

            // Initialize and connect client
            const client = this.container.get<IMCPClient>(clientId);
            await client.initialize();
            await client.connect();

            // Update server state
            server.state = ServerState.RUNNING;
            this.emit('serverStarted', { 
                id, 
                timestamp: new Date(), 
                type: 'start'
            });
        } catch (error) {
            // Handle server failure without affecting other servers
            console.error(`Failed to start server ${id}:`, error);
            server.state = ServerState.ERROR;
            server.lastError = error instanceof Error ? error : new Error(String(error));
            
            // Emit error but don't throw - this prevents cascade failures
            this.emit('serverError', { 
                id, 
                timestamp: new Date(), 
                type: 'error', 
                error: server.lastError 
            });
            
            // Try to cleanup failed client
            try {
                const clientId = this.clientsMap.get(id);
                if (clientId) {
                    const client = this.container.get<IMCPClient>(clientId);
                    await client.disconnect();
                }
            } catch (cleanupError) {
                console.error(`Error cleaning up failed server ${id}:`, cleanupError);
            }
        }
    }

    public async stopServer(id: string): Promise<void> {
        const server = this.getServer(id);
        if (!server) {
            return; // Server doesn't exist, nothing to stop
        }

        try {
            server.state = ServerState.STOPPING;
            this.emit('serverStopping', id);
            
            // Get and disconnect the client
            const clientId = this.clientsMap.get(id);
            if (clientId) {
                const client = this.container.get<IMCPClient>(clientId);
                await client.disconnect();
            }

            server.state = ServerState.STOPPED;
            server.stopTime = new Date();
            this.emit('serverStopped', id);
        } catch (error) {
            // Handle stop failure without affecting other servers
            console.error(`Error stopping server ${id}:`, error);
            server.state = ServerState.ERROR;
            server.lastError = error instanceof Error ? error : new Error(String(error));
            this.emit('serverError', { id, timestamp: new Date(), type: 'error', error: server.lastError });
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
     * Register a new server and start it
     */
    public async registerServer(id: string, config: ServerConfig): Promise<void> {
        // Add to clientsMap if not already there
        if (!this.clientsMap.has(id)) {
            // Create unique identifier for this client
            const clientId = `IMCPClient_${id}`;
            
            // Register client ID mapping
            this.clientsMap.set(id, clientId);
            
            // Get the static container instance to bind the client
            try {
                // Create the client instance dynamically
                const { BaseMCPClient } = await import('../base/base-mcp-client.js');
                const clientInstance = new BaseMCPClient(config, id);
                
                // Bind the client with its unique ID
                this.container.bind<IMCPClient>(clientId).toConstantValue(clientInstance);
            } catch (error) {
                console.error(`Failed to dynamically create client for ${id}:`, error);
                throw new Error(`Failed to initialize server ${id}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        
        // Now start the server with the configuration
        await this.startServer(id, config);
    }
    
    /**
     * Restart a server that was previously started
     */
    public async restartServer(id: string): Promise<void> {
        const server = this.getServer(id);
        if (!server) {
            throw MCPError.serverNotFound();
        }
        
        // Only restart if it's not already running
        if (server.state !== ServerState.RUNNING) {
            await this.stopServer(id);
            await this.startServer(id, server.config);
        }
    }
} 