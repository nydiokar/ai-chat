import { IMCPClient } from '../interfaces/core.js';
import { ToolDefinition, ToolResponse } from '../types/tools.js';
import { ServerConfig } from '../types/server.js';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCPError } from '../types/errors.js';
import { z } from 'zod';

export class BaseMCPClient implements IMCPClient {
    protected client: Client;
    protected transport: StdioClientTransport;
    protected isConnected: boolean = false;

    constructor(config: ServerConfig) {
        this.transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: config.env,
            stderr: 'inherit'
        });

        this.client = new Client({
            name: 'mcp-base-client',
            version: '1.0.0'
        });
    }

    public async initialize(): Promise<void> {
        await this.connect();
    }

    public async connect(): Promise<void> {
        if (this.isConnected) return;
        
        await this.client.connect(this.transport);
        this.isConnected = true;
    }

    public async disconnect(): Promise<void> {
        if (!this.isConnected) return;
        
        await this.transport.close();
        this.isConnected = false;
    }

    public async listTools(): Promise<ToolDefinition[]> {
        const ToolSchema = z.object({
            name: z.string(),
            description: z.string().optional(),
            version: z.string().optional(),
            parameters: z.array(z.object({
                name: z.string(),
                type: z.string(),
                description: z.string(),
                required: z.boolean().optional()
            })).optional()
        });

        const response = await this.client.request({
            method: 'tools/list',
            params: {}
        }, z.array(ToolSchema));

        return response.map(tool => ({
            name: tool.name,
            description: tool.description || '',
            version: tool.version || '1.0.0',
            parameters: tool.parameters || []
        }));
    }

    public async callTool(name: string, args: any): Promise<ToolResponse> {
        try {
            const result = await this.client.request({
                method: 'tools/call',
                params: {
                    name,
                    arguments: args
                }
            }, z.object({
                success: z.boolean(),
                data: z.any(),
                error: z.string().optional(),
                metadata: z.record(z.any()).optional()
            }));

            return {
                success: result.success,
                data: result.data ?? null,
                error: result.error,
                metadata: result.metadata
            };
        } catch (error) {
            throw MCPError.toolExecutionFailed(error instanceof Error ? error : new Error(String(error)));
        }
    }
}