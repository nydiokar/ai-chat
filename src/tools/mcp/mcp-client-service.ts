// Temporary mock implementation to satisfy dependencies
import { ToolDefinition } from './types/tools.js';

export interface MCPServerConfig {
    id: string;
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
}

export class MCPClientService {
    constructor(private config: MCPServerConfig) {}

    async initialize(): Promise<void> {
        console.log('[MCPClientService] Mock initialization');
    }

    async cleanup(): Promise<void> {
        console.log('[MCPClientService] Mock cleanup');
    }

    async listTools(): Promise<ToolDefinition[]> {
        return [];
    }

    async callTool(name: string, args: any): Promise<any> {
        console.log(`[MCPClientService] Mock calling tool ${name}`);
        return { success: true, data: 'Mock response' };
    }

    async hasToolEnabled(toolName: string): Promise<boolean> {
        return true;
    }

    async getStatus(): Promise<string> {
        return 'RUNNING';
    }
} 