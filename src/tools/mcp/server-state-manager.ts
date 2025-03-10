import { EventEmitter } from 'events';
import { MCPClientService } from './mcp-client-service.js';
import { debug } from '../../utils/config.js';
import { MCPServerConfig } from '../../types/tools.js';
import { MCPError, ErrorType } from '../../types/errors.js';
import { Cleanable } from '../../types/cleanable.js';

export enum ServerState {
    STOPPED = 'STOPPED',
    STARTING = 'STARTING',
    RUNNING = 'RUNNING',
    PAUSED = 'PAUSED',
    ERROR = 'ERROR'
}

interface ServerInfo {
    id: string;
    state: ServerState;
    client: MCPClientService | null;
    lastActivity: number;
    errorCount: number;
    lastError?: Error;
}

export class ServerStateManager extends EventEmitter implements Cleanable {
    private servers: Map<string, ServerInfo> = new Map();
    private readonly IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    private readonly ERROR_THRESHOLD = 3;
    private readonly HEALTH_CHECK_INTERVAL = 60000; // 1 minute
    private readonly MAX_BACKOFF = 5 * 60 * 1000; // 5 minutes
    private cleanupInterval: NodeJS.Timeout | null = null;
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private readonly healthCheckBackoff: Map<string, number> = new Map();

    constructor() {
        super();
        this.startCleanupInterval();
        this.startHealthCheck();
    }

    /**
     * Internal method to register a server in the state manager
     */
    private registerServer(id: string, client: MCPClientService | null, state: ServerState = ServerState.RUNNING): void {
        this.servers.set(id, {
            id,
            state,
            client,
            lastActivity: Date.now(),
            errorCount: 0
        });
        this.emit('serverRegistered', id);
    }

    updateActivity(id: string): void {
        const server = this.servers.get(id);
        if (server) {
            server.lastActivity = Date.now();
            if (server.state === ServerState.PAUSED) {
                this.resumeServer(id);
            }
        }
    }

    async pauseServer(id: string): Promise<void> {
        const server = this.servers.get(id);
        if (server && server.state === ServerState.RUNNING) {
            debug(`Pausing server ${id} due to inactivity`);
            server.state = ServerState.PAUSED;
            // Optionally release some resources but keep minimal state
            this.emit('serverPaused', id);
        }
    }

    async resumeServer(id: string): Promise<void> {
        const server = this.servers.get(id);
        if (server && server.state === ServerState.PAUSED) {
            debug(`Resuming server ${id}`);
            try {
                if (server.client) {
                    await server.client.reconnect();
                }
                server.state = ServerState.RUNNING;
                server.lastActivity = Date.now();
                this.emit('serverResumed', id);
            } catch (error) {
                this.handleServerError(id, error as Error);
            }
        }
    }

    async stopServer(id: string): Promise<void> {
        const server = this.servers.get(id);
        if (server) {
            debug(`Stopping server ${id}`);
            try {
                if (server.client) {
                    await server.client.cleanup();
                }
                server.state = ServerState.STOPPED;
                this.emit('serverStopped', id);
            } catch (error) {
                this.handleServerError(id, error as Error);
            }
        }
    }

    getServerState(id: string): ServerState | null {
        return this.servers.get(id)?.state || null;
    }

    isServerActive(id: string): boolean {
        const server = this.servers.get(id);
        if (!server) return false;
        return server.state === ServerState.RUNNING &&
               Date.now() - server.lastActivity < this.IDLE_TIMEOUT;
    }

    getServerClient(id: string): MCPClientService | null {
        const server = this.servers.get(id);
        return server?.client || null;
    }

    private handleServerError(id: string, error: Error): void {
        const server = this.servers.get(id);
        if (server) {
            server.errorCount++;
            server.lastError = error;
            server.state = ServerState.ERROR;

            if (server.errorCount >= this.ERROR_THRESHOLD) {
                debug(`Server ${id} exceeded error threshold, stopping`);
                this.stopServer(id);
            }

            this.emit('serverError', { id, error });
        }
    }

    private startCleanupInterval(): void {
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const [id, server] of this.servers.entries()) {
                if (server.state === ServerState.RUNNING &&
                    now - server.lastActivity >= this.IDLE_TIMEOUT) {
                    this.pauseServer(id);
                }
            }
        }, 5 * 60 * 1000); // Check every 5 minutes
    }

    private startHealthCheck(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }

        this.healthCheckInterval = setInterval(async () => {
            for (const [id, server] of this.servers.entries()) {
                if (server.state !== ServerState.RUNNING) continue;

                try {
                    const client = server.client;
                    if (client) {
                        await client.listTools();
                        // Reset backoff on successful check
                        this.healthCheckBackoff.delete(id);
                    }
                } catch (error) {
                    const currentBackoff = this.healthCheckBackoff.get(id) || this.HEALTH_CHECK_INTERVAL;
                    const nextBackoff = Math.min(currentBackoff * 2, this.MAX_BACKOFF);
                    this.healthCheckBackoff.set(id, nextBackoff);

                    this.handleServerError(id, error instanceof Error ? error : new Error(String(error)));
                }
            }
        }, this.HEALTH_CHECK_INTERVAL);
    }

    async cleanup(): Promise<void> {
        // Clear intervals
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }

        // Stop all servers
        const stopPromises = Array.from(this.servers.keys()).map(id => this.stopServer(id));
        await Promise.all(stopPromises);

        // Clear all state
        this.servers.clear();
        this.healthCheckBackoff.clear();

        // Remove all event listeners
        this.removeAllListeners();
    }

    /**
     * Start a server with the given configuration
     * @throws MCPError if server initialization fails
     */
    async startServer(id: string, config: MCPServerConfig): Promise<MCPClientService> {
        const existingServer = this.servers.get(id);
        if (existingServer?.state === ServerState.RUNNING) {
            debug(`Server ${id} is already running`);
            return existingServer.client!;
        }

        debug(`Starting server ${id}...`);
        
        // Update server state to starting
        this.registerServer(id, null, ServerState.STARTING);

        try {
            // Create and initialize client
            const client = new MCPClientService(config);
            await client.initialize();

            // Update server info with running state
            this.registerServer(id, client, ServerState.RUNNING);

            debug(`Server ${id} started successfully`);
            this.emit('serverStarted', id);
            return client;
        } catch (error) {
            const serverError = error instanceof Error ? error : new Error(String(error));
            this.handleServerError(id, serverError);
            throw new MCPError(
                `Failed to start server ${id}`,
                ErrorType.SERVER_START_FAILED,
                { cause: serverError }
            );
        }
    }
} 