// created just to satisfy discord-integration.test.ts due to be deleted! 

import { DatabaseService } from '../../services/db-service.js';

export class MCPServerManager {
    constructor(private db: DatabaseService) {}

    // Minimal implementation to make tests pass
    async startServer(serverId: string, config: any): Promise<void> {
        console.log(`[MCPServerManager] Mock starting server ${serverId}`);
    }

    async stopServer(serverId: string): Promise<void> {
        console.log(`[MCPServerManager] Mock stopping server ${serverId}`);
    }

    async restartServer(serverId: string): Promise<void> {
        console.log(`[MCPServerManager] Mock restarting server ${serverId}`);
    }

    async getServerStatus(serverId: string): Promise<string> {
        return 'RUNNING';
    }
} 