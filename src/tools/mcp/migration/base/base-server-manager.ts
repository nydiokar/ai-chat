import { IServerManager } from '../interfaces/core.js';
import { Server, ServerState, ServerConfig } from '../types/server.js';
import { MCPError, ErrorType } from '../types/errors.js';
import { EventEmitter } from 'events';

export class BaseServerManager extends EventEmitter implements IServerManager {
    protected servers: Map<string, Server>;

    constructor() {
        super();
        this.servers = new Map();
    }

    public async startServer(id: string, config: ServerConfig): Promise<void> {
        if (this.hasServer(id)) {
            throw MCPError.serverStartFailed(new Error(`Server with ID ${id} already exists`));
        }

        const server: Server = {
            id: id,
            name: `Server ${id}`,
            version: '1.0.0',
            state: ServerState.STARTING,
            config,
            startTime: new Date()
        };

        this.servers.set(id, server);

        try {
            // Basic server startup logic
            server.state = ServerState.RUNNING;
            this.emit('serverStarted', id);
        } catch (error) {
            server.state = ServerState.ERROR;
            server.lastError = error instanceof Error ? error : new Error(String(error));
            this.emit('serverError', { id: id, error: server.lastError });
            throw MCPError.serverStartFailed(server.lastError);
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
            
            // Basic server shutdown logic
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
        const server = this.getServer(id);
        if (!server) {
            throw MCPError.serverNotFound();
        }

        if (server.state === ServerState.RUNNING) {
            await this.stopServer(id);
        }

        this.servers.delete(id);
        this.emit('serverUnregistered', id);
    }
} 