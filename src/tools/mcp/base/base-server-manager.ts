import { IServerManager } from '../interfaces/core.js';
import { Server, ServerState, ServerConfig } from '../types/server.js';
import { MCPError, ErrorType } from '../types/errors.js';
import { EventEmitter } from 'events';
import { injectable, inject } from 'inversify';
import { IMCPClient } from '../interfaces/core.js';
import { TYPES } from '../di/types.js';
import { Container } from 'inversify';

@injectable()
export class BaseServerManager extends EventEmitter implements IServerManager {
    protected servers: Map<string, Server>;
    protected clientsMap: Map<string, string>;
    protected container: Container;
    protected maxRetries = 2;  // Reduced from 3 to 2 attempts
    protected retryDelay = 2000;  // Reduced from 5000 to 2000ms (2 seconds)

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
        let lastError: Error | undefined;
        
        // If the server already exists, don't recreate it
        if (this.hasServer(id)) {
            const server = this.getServer(id);
            if (server && server.state === ServerState.RUNNING) {
                return; // Already running
            }
            
            // If it exists but is not running, update its state and continue
            if (server) {
                server.state = ServerState.STARTING;
                server.config = config; // Update config in case it changed
            }
        } else {
            // Create a new server instance
            const server: Server = {
                id: id,
                name: config.name || `Server ${id}`,
                version: '1.0.0',
                state: ServerState.STARTING,
                config,
                startTime: new Date(),
                retryCount: 0
            };
            
            this.servers.set(id, server);
        }

        const server = this.getServer(id);
        if (!server) {
            throw MCPError.serverNotFound();
        }

        // Reset retry count if this is a fresh start
        if (server.state !== ServerState.RETRYING) {
            server.retryCount = 0;
        }

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                // Add to clientsMap if not already there
                if (!this.clientsMap.has(id)) {
                    const clientId = `IMCPClient_${id}`;
                    this.clientsMap.set(id, clientId);
                    
                    try {
                        const { BaseMCPClient } = await import('../base/base-mcp-client.js');
                        const clientInstance = new BaseMCPClient(config, id);
                        this.container.bind<IMCPClient>(clientId).toConstantValue(clientInstance);
                    } catch (error) {
                        throw new Error(`Failed to initialize server ${id}: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }

                const clientId = this.clientsMap.get(id);
                if (!clientId) {
                    throw new Error(`No client configuration found for server ${id}`);
                }

                // Initialize the client
                const client = this.container.get<IMCPClient>(clientId);
                await client.initialize();
                await client.connect();

                // Update server state on success
                server.state = ServerState.RUNNING;
                server.lastError = undefined;
                server.retryCount = 0;
                this.emit('serverStarted', id);
                return;

            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                server.lastError = lastError;
                server.retryCount = (server.retryCount || 0) + 1;

                if (attempt < maxRetries) {
                    // Log retry attempt
                    console.log(`Server ${id} start failed (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${retryDelay/1000}s...`);
                    server.state = ServerState.RETRYING;
                    this.emit('serverRetrying', { id, attempt: attempt + 1, maxRetries: maxRetries });
                    
                    // Wait before retrying
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                } else {
                    // Final failure
                    server.state = ServerState.ERROR;
                    this.emit('serverError', { id: id, error: lastError });
                    
                    // Log failure but don't throw
                    console.error(`Server ${id} failed to start after ${maxRetries + 1} attempts. Server marked as ERROR state.`);
                    console.error('Last error:', lastError);
                    
                    // Don't throw the error - this prevents cascade failure
                    return;
                }
            }
        }
    }

    public async stopServer(id: string): Promise<void> {
        const server = this.getServer(id);
        if (!server) {
            throw MCPError.serverNotFound();
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
            server.state = ServerState.ERROR;
            server.lastError = error instanceof Error ? error : new Error(String(error));
            this.emit('serverError', { id: id, error: server.lastError });
            throw MCPError.serverStartFailed(server.lastError);
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