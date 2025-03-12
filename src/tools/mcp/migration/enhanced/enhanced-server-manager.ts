import { BaseServerManager } from '../base/base-server-manager.js';
import { Server, ServerState, ServerEvent, ServerConfig } from '../types/server.js';
import { MCPError, ErrorType } from '../types/errors.js';
import { injectable, inject } from 'inversify';
import { Container } from 'inversify';

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

    constructor(
        @inject('ClientsMap') clientsMap: Map<string, string>,
        @inject('Container') container: Container
    ) {
        super(clientsMap, container);
        this.serverHistory = new Map();
        this.startHealthCheck();
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

    public override async startServer(id: string, config: ServerConfig): Promise<void> {
        try {
            await super.startServer(id, config);
            this.trackEvent(id, {
                id,
                timestamp: new Date(),
                type: 'start'
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
                await this.startServer(id, server.config);
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
} 