import { IMCPClient, IToolManager } from '../interfaces/core.js';
import { ToolDefinition, ToolResponse, ToolHandler } from '../types/tools.js';

export class BaseToolManager implements IToolManager {
    protected client: IMCPClient;
    protected toolsCache: Map<string, ToolDefinition>;
    protected handlers: Map<string, ToolHandler>;

    constructor(client: IMCPClient) {
        this.client = client;
        this.toolsCache = new Map();
        this.handlers = new Map();
    }

    public registerTool(name: string, handler: ToolHandler): void {
        this.handlers.set(name, handler);
    }

    public async getAvailableTools(): Promise<ToolDefinition[]> {
        if (this.toolsCache.size === 0) {
            await this.refreshToolInformation();
        }
        return Array.from(this.toolsCache.values());
    }

    public async getToolByName(name: string): Promise<ToolDefinition | undefined> {
        if (this.toolsCache.size === 0) {
            await this.refreshToolInformation();
        }
        return this.toolsCache.get(name);
    }

    public async executeTool(name: string, args: any): Promise<ToolResponse> {
        // First try local handler
        const handler = this.handlers.get(name);
        if (handler) {
            return handler(args);
        }
        
        // Fall back to remote execution
        return this.client.callTool(name, args);
    }

    public async refreshToolInformation(): Promise<void> {
        const tools = await this.client.listTools();
        this.toolsCache.clear();
        
        for (const tool of tools) {
            this.toolsCache.set(tool.name, tool);
        }
    }
} 