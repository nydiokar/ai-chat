import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Tool, ToolCallResult } from "../types/index.js";
import { MCPServerConfig } from "../types/mcp-config.js";

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
        const response = await this.client.listTools();
        return response.tools.map(tool => ({
            name: tool.name,
            description: tool.description || '',
            inputSchema: tool.inputSchema
        }));
    }

    async callTool(name: string, args: any): Promise<string> {
        const result = await this.client.callTool({ name, arguments: args }) as ToolCallResult;
        return result.content[0]?.text || '';
    }

    async cleanup(): Promise<void> {
        if (this.isConnected) {
            await this.client.close();
            this.isConnected = false;
        }
    }
} 