import { IMCPClient, IToolManager } from '../interfaces/core.js';
import { ToolDefinition, ToolResponse, ToolHandler } from '../types/tools.js';
import { inject, injectable } from 'inversify';
import { TYPES } from '../di/types.js';
import { Container } from 'inversify';
import { ServerConfig } from '../types/server.js';

// Utility function to redact sensitive information
function redactSensitiveInfo(obj: any): any {
    if (!obj) return obj;
    
    const sensitiveKeys = [
        'token', 'key', 'password', 'secret', 'auth', 'credential',
        'GITHUB_PERSONAL_ACCESS_TOKEN', 'OPENAI_API_KEY'
    ];
    
    if (typeof obj === 'string') {
        // Check if the string looks like a token/key (long string with special chars)
        if (obj.length > 20 && /[A-Za-z0-9_\-\.]+/.test(obj)) {
            return '[REDACTED]';
        }
        return obj;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => redactSensitiveInfo(item));
    }
    
    if (typeof obj === 'object') {
        const redacted = { ...obj };
        for (const [key, value] of Object.entries(redacted)) {
            if (sensitiveKeys.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
                redacted[key] = '[REDACTED]';
            } else if (typeof value === 'object') {
                redacted[key] = redactSensitiveInfo(value);
            }
        }
        return redacted;
    }
    
    return obj;
}

@injectable()
export class BaseToolManager implements IToolManager {
    protected clientsMap: Map<string, IMCPClient>;
    protected toolsCache: Map<string, ToolDefinition>;
    protected handlers: Map<string, ToolHandler>;
    protected serverConfigs: Map<string, ServerConfig>;

    constructor(
        @inject('ClientsMap') clientsMap: Map<string, string>, 
        @inject('Container') container: Container,
        @inject('ServerConfigs') serverConfigs: Map<string, ServerConfig>
    ) {
        this.clientsMap = new Map();
        this.serverConfigs = serverConfigs;
        for (const [serverId, clientId] of clientsMap.entries()) {
            this.clientsMap.set(serverId, container.get<IMCPClient>(clientId));
        }
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
        const tool = await this.getToolByName(name);
        if (!tool) {
            throw new Error(`Tool ${name} not found`);
        }

        // First try local handler
        const handler = this.handlers.get(name);
        if (handler) {
            return handler(args);
        }
        
        // Get the correct client for this tool
        const client = this.clientsMap.get(tool.server?.id || '');
        if (!client) {
            throw new Error(`No client found for server ${tool.server?.id}`);
        }
        
        // Execute with the correct client
        return client.callTool(name, args);
    }

    public async refreshToolInformation(): Promise<void> {
        console.log('[BaseToolManager] Refreshing tool information...');
        this.toolsCache.clear();
        
        // Get tools from all clients
        for (const [serverId, client] of this.clientsMap.entries()) {
            try {
                console.log(`[BaseToolManager] Loading tools from server ${serverId}...`);
                const tools = await client.listTools();
                
                const serverConfig = this.serverConfigs.get(serverId);
                if (!serverConfig) {
                    console.error(`[BaseToolManager] No server config found for ${serverId}`);
                    continue;
                }
                
                for (const tool of tools) {
                    // Redact sensitive info from server config
                    const safeServerConfig = redactSensitiveInfo(serverConfig);
                    
                    this.toolsCache.set(tool.name, {
                        ...tool,
                        // Ensure we have all required fields
                        name: tool.name,
                        description: tool.description || '',
                        version: tool.version || '1.0.0',
                        parameters: tool.parameters || [],
                        enabled: tool.enabled !== false,
                        server: safeServerConfig,
                        inputSchema: tool.inputSchema
                    });
                }
                
                console.log(`[BaseToolManager] Loaded ${tools.length} tools from server ${serverId}`);
                // Log the first tool's schema for debugging with sensitive info redacted
                const firstTool = tools[0];
                if (firstTool) {
                    console.log(`[BaseToolManager] Sample tool schema for ${firstTool.name}:`, 
                        JSON.stringify(redactSensitiveInfo({
                            parameters: firstTool.parameters,
                            inputSchema: firstTool.inputSchema,
                            rawTool: firstTool
                        }), null, 2)
                    );
                }
            } catch (error) {
                console.error(`[BaseToolManager] Error loading tools from server ${serverId}:`, error);
            }
        }
        
        console.log('[BaseToolManager] Tool cache updated with', this.toolsCache.size, 'total tools');
    }
} 