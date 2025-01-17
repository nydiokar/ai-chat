import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCPTool } from "../../types/index.js";
import { MCPServerConfig } from "../../types/mcp-config.js";
import { z } from "zod";
import { MCPError } from "../../types/errors.js";

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
    private config: MCPServerConfig;

    constructor(config: MCPServerConfig) {
        this.config = config;
        this.transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: {
                // Filter out undefined values from process.env
                ...Object.entries(process.env).reduce((acc, [key, value]) => {
                    if (value !== undefined) {
                        acc[key] = value;
                    }
                    return acc;
                }, {} as Record<string, string>),
                ...config.env // Override with config-specific environment
            }
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

    async listTools(): Promise<MCPTool[]> {
        try {
            console.log('[MCPClientService] Requesting tools list');
            const response = await this.client.request({
                method: 'tools/list',
                params: {}
            }, ToolListResponseSchema);

            console.log('[MCPClientService] Raw tools response:', JSON.stringify(response.tools, null, 2));

            const tools = response.tools.map(tool => ({
                name: tool.name,
                description: tool.description || '',
                inputSchema: tool.inputSchema,
                server: this.config
            }));

            console.log('[MCPClientService] Mapped tools:', tools.map(t => t.name));
            return tools;
        } catch (error) {
            console.error('[MCPClientService] Error listing tools:', error);
            throw error;
        }
    }

    async callTool(name: string, args: any): Promise<string> {
        try {
            console.log(`[MCPClientService] Calling tool ${name} with args:`, args);
            const result = await this.client.request({
                method: 'tools/call',
                params: {
                    name,
                    arguments: args
                }
            }, ToolCallResponseSchema);
            console.log(`[MCPClientService] Tool result:`, result);
            
            if ('error' in result) {
                throw MCPError.toolExecutionFailed(result.error);
            }
            
            return result.content[0]?.text || '';
        } catch (error) {
            throw MCPError.toolExecutionFailed(error);
        }
    }

    // Brave Search specific methods
    async webSearch(query: string, count: number = 10): Promise<string> {
        return this.callTool('brave_web_search', { query, count });
    }

    async localSearch(query: string, count: number = 5): Promise<string> {
        return this.callTool('brave_local_search', { query, count });
    }

    async cleanup(): Promise<void> {
        if (this.isConnected) {
            await this.client.close();
            this.isConnected = false;
        }
    }
}
