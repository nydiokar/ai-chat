import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCPTool, MCPToolContext } from "../../types/index.js";
import { MCPServerConfig } from "../../types/tools.js";
import { z } from "zod";
import { MCPError } from "../../types/errors.js";
import { defaultConfig } from "../../config/defaultConfig.js";


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
    private healthCheckInterval: NodeJS.Timer | undefined;

    constructor(config: MCPServerConfig) {
        this.config = config;
        // Only pass the environment variables specified in the config
        this.transport = new StdioClientTransport({
            command: this.config.command,
            args: this.config.args,
            env: this.config.env,
            stderr: 'inherit'
        });

        this.client = new Client({
            name: "mcp-client",
            version: "1.0.0"
        }, {
            capabilities: { tools: {} }
        });
    }

    async connect(): Promise<void> {
        try {
            if (this.isConnected) {
                return;
            }
            
            await this.client.connect(this.transport);
            await this.client.request({
                method: 'tools/list',
                params: {}
            }, ToolListResponseSchema);
            
            this.isConnected = true;
        } catch (error) {
            console.error('[MCPClientService] Connection failed:', 
                error instanceof Error ? error.message : 'Unknown error');
            throw error;
        }
    }

    async hasToolEnabled(toolName: string): Promise<boolean> {
        try {
            const tools = await this.listTools();
            return tools.some(tool => tool.name === toolName);
        } catch (error) {
            return false;
        }
    }

    async listTools(): Promise<MCPTool[]> {
        try {
            const tools = await this.client.request({
                method: 'tools/list',
                params: {}
            }, ToolListResponseSchema);
            
            return tools.tools.map(tool => ({
                name: tool.name,
                description: tool.description || '',
                inputSchema: tool.inputSchema,
                server: this.config
            }));
        } catch (error) {
            console.error(`[MCPClientService] Failed to list tools for ${this.config.name}:`, error);
            return [];
        }
    }

    async callTool(name: string, args: any, context?: MCPToolContext): Promise<string> {
        try {
            // Only log detailed args if in debug mode
            if (defaultConfig.discord.mcp.logLevel === 'debug') {
                const sanitizedArgs = this.sanitizeArgs(args);
                console.log(`[MCPClientService] Calling tool ${name} with args:`, sanitizedArgs);
            } else {
                console.log(`[MCPClientService] Calling tool ${name}`);
            }
            
            // Enhance arguments with context if available
            const enhancedArgs = context ? {
                ...args,
                _context: {
                    lastUsage: context.history?.[0],
                    successRate: context.successRate,
                    commonPatterns: context.patterns
                }
            } : args;

            const result = await this.client.request({
                method: 'tools/call',
                params: {
                    name,
                    arguments: enhancedArgs
                }
            }, ToolCallResponseSchema);
            
            // Only log result summary unless in debug mode
            if (defaultConfig.discord.mcp.logLevel === 'debug') {
                const sanitizedResult = this.sanitizeResult(result);
                console.log(`[MCPClientService] Tool result:`, sanitizedResult);
            } else {
                console.log(`[MCPClientService] Tool ${name} completed successfully`);
            }
            
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
        return this.callTool('brave_web_search', { 
            query: `${query} after:${new Date().toISOString().split('T')[0]}`,
            count,
            freshness: 'day'
        });
    }

    async localSearch(query: string, count: number = 5): Promise<string> {
        return this.callTool('brave_local_search', { query, count });
    }

    private startHealthCheck() {
        this.healthCheckInterval = setInterval(async () => {
            try {
                await this.listTools();
            } catch (error) {
                console.error('[MCPClientService] Health check failed:', error);
                await this.connect();
            }
        }, 30000); // Check every 30 seconds
    }

    async initialize(): Promise<void> {
        // Verify required environment variables
        if (this.config.env) {
            const missingEnvVars = Object.entries(this.config.env)
                .filter(([, value]) => !value);
            
            if (missingEnvVars.length > 0) {
                const vars = missingEnvVars.map(([key]) => key).join(', ');
                throw new Error(`Missing required environment variables: ${vars}`);
            }
        }

        console.log(`[MCPClientService] Initializing ${this.config.name}...`);
        
        try {
            // Attempt initial connection
            await this.connect();
            
            // Start health check only after successful initialization
            this.startHealthCheck();
        } catch (error) {
            console.error(`[MCPClientService] Failed to initialize ${this.config.name}:`, 
                error instanceof Error ? error.message : String(error));
            throw error;
        }
    }

    cleanup() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval as unknown as number);
        }
    }

    private sanitizeArgs(args: any): any {
        const sanitized = { ...args };
        const sensitiveFields = ['token', 'key', 'password', 'secret'];
        for (const field of sensitiveFields) {
            if (field in sanitized) {
                sanitized[field] = '[REDACTED]';
            }
        }
        return sanitized;
    }

    private sanitizeResult(result: any): any {
        const sanitized = JSON.parse(JSON.stringify(result));
        if (sanitized.content) {
            sanitized.content = sanitized.content.map((item: any) => ({
                ...item,
                text: item.text.substring(0, 100) + (item.text.length > 100 ? '...' : '')
            }));
        }
        return sanitized;
    }
}
