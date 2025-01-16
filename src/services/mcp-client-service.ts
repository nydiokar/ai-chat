import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Tool, ToolCallResult } from "../types/index.js";
import { MCPServerConfig } from "../types/mcp-config.js";
import { z } from "zod";
import { MCPError } from "../types/errors.js";

// Define response schemas
const ToolListResponseSchema = z.object({
    tools: z.array(z.object({
        name: z.string(),
        description: z.string().optional(),
        inputSchema: z.any()
    }))
});

const ToolCallResponseSchema = z.object({
    content: z.array(z.object({
        text: z.string()
    }))
});

export class MCPClientService {
    private client: Client;
    private transport: StdioClientTransport;
    private isConnected: boolean = false;

    constructor(config: MCPServerConfig) {
        this.transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: config.env
        });

        this.client = new Client({
            name: "mcp-client",
            version: "1.0.0"
        }, {
            capabilities: { tools: {} }
        });
    }

    async connect(): Promise<void> {
        if (this.isConnected) return;
        await this.client.connect(this.transport);
        this.isConnected = true;
    }

    async listTools(): Promise<Tool[]> {
        const response = await this.client.request({
            method: 'tools/list',
            params: {}
        }, ToolListResponseSchema);

        return response.tools.map(tool => ({
            name: tool.name,
            description: tool.description || '',
            inputSchema: tool.inputSchema
        }));
    }

    async callTool(name: string, args: any): Promise<string> {
        try {
            const result = await this.client.request({
                method: 'tools/call',
                params: {
                    name,
                    arguments: args
                }
            }, ToolCallResponseSchema);
            
            if ('error' in result) {
                throw MCPError.toolExecutionFailed(result.error);
            }
            
            return result.content[0]?.text || '';
        } catch (error) {
            throw MCPError.toolExecutionFailed(error);
        }
    }

    async cleanup(): Promise<void> {
        if (this.isConnected) {
            await this.client.close();
            this.isConnected = false;
        }
    }
} 