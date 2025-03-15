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
            // Get the client for this server
            const clientId = this.clientsMap.get(id);
            if (!clientId) {
                throw new Error(`No client configuration found for server ${id}`);
            }

            // Initialize the client
            const client = this.container.get<IMCPClient>(clientId);
            await client.initialize();
            await client.connect();

            // Update server state
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
} 