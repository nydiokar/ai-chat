import { IMCPClient } from '../interfaces/core.js';
import { ToolDefinition, ToolResponse } from '../types/tools.js';
import { ServerConfig } from '../types/server.js';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCPError } from '../types/errors.js';
import { z } from 'zod';
import { injectable, inject } from 'inversify';

@injectable()
export class BaseMCPClient implements IMCPClient {
    protected client: Client;
    protected transport: StdioClientTransport;
    protected isConnected: boolean = false;
    protected serverId: string;

    constructor(config: ServerConfig, serverId: string) {
        this.serverId = serverId;
        this.transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: config.env,
            stderr: 'inherit'
        });

        this.client = new Client({
            ...config,
            name: config.name || 'mcp-base-client',
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
            description: z.string(),
            inputSchema: z.any(),
            version: z.string().optional(),
            parameters: z.array(z.object({
                name: z.string(),
                type: z.string(),
                description: z.string(),
                required: z.boolean().optional()
            })).optional()
        });

        const ResponseSchema = z.union([
            z.array(ToolSchema),
            z.object({
                tools: z.array(ToolSchema)
            }),
            z.any()
        ]);

        try {
            // Get raw response without logging
            const response = await this.client.request({
                method: 'tools/list',
                params: {}
            }, ResponseSchema);

            let tools;
            if (Array.isArray(response)) {
                tools = response;
            } else if (response && typeof response === 'object' && 'tools' in response) {
                tools = response.tools;
            } else {
                console.error('[DEBUG] Unexpected response format');
                tools = [];
            }
            
            return tools.map((tool: z.infer<typeof ToolSchema>) => ({
                name: tool.name,
                description: tool.description || '',
                version: tool.version || '1.0.0',
                parameters: tool.parameters || [],
                inputSchema: tool.inputSchema // Include the inputSchema!
            }));
        } catch (error) {
            console.error('[DEBUG] Error in listTools:', error);
            throw error;
        }
    }

    public async callTool(name: string, args: any): Promise<ToolResponse> {
        try {
            const result = await this.client.request({
                method: 'tools/call',
                params: {
                    name,
                    arguments: args
                }
            }, z.any());

            // Transform the response to match our expected format
            const response: ToolResponse = {
                success: true,
                data: result,
                metadata: {}
            };

            return response;
        } catch (error) {
            throw MCPError.toolExecutionFailed(error instanceof Error ? error : new Error(String(error)));
        }
    }
}