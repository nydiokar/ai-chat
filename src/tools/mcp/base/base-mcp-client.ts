import { IMCPClient } from '../interfaces/core.js';
import { ToolDefinition, ToolResponse } from '../types/tools.js';
import { ServerConfig } from '../types/server.js';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCPError } from '../types/errors.js';
import { injectable, inject } from 'inversify';
import { 
    CallToolResultSchema,
    ListToolsResultSchema,
    ListResourcesResultSchema
} from "@modelcontextprotocol/sdk/types.js";
import { 
    Resource, 
    ResourceQuery,
    ResourceCreateParams, 
    ResourceUpdateParams 
} from '../types/resources.js';

@injectable()
export class BaseMCPClient implements IMCPClient {
    protected client: Client;
    protected transport: StdioClientTransport;
    protected isConnected: boolean = false;
    protected serverId: string;

    constructor(config: ServerConfig, serverId: string) {
        this.serverId = serverId;
        
        // Use default stdio configuration
        this.transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: config.env,
            stderr: 'inherit'  // Use default 'inherit' which is known to work
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
        try {
            if (!this.isConnected) {
                console.warn(`[${this.serverId}] Client not connected, attempting to connect...`);
                await this.connect();
            }

            // Get raw response
            const response = await this.client.request({
                method: 'tools/list',
                params: {}
            }, ListToolsResultSchema);  // Using SDK's schema for validation

            let tools: any[] = [];
            if (Array.isArray(response)) {
                tools = response;
            } else if (response && typeof response === 'object' && 'tools' in response) {
                tools = response.tools;
            } else {
                console.error('[DEBUG] Unexpected response format');
            }
            
            // Convert to ToolDefinition format
            return tools.map((tool: any) => ({
                name: tool.name,
                description: tool.description || '',
                version: tool.version || '1.0.0',
                inputSchema: {
                    type: 'object',
                    properties: tool.inputSchema?.properties || {},
                    required: tool.inputSchema?.required || []
                },
                metadata: tool.metadata || {}
            }));
        } catch (error) {
            console.error('[DEBUG] Error in listTools:', error);
            throw error;
        }
    }

    public async callTool(name: string, args: any): Promise<ToolResponse> {
        try {
            if (!this.isConnected) {
                console.warn(`[${this.serverId}] Client not connected, attempting to connect...`);
                await this.connect();
            }

            // Use the SDK's CallToolResultSchema directly for validation
            const result = await this.client.request({
                method: 'tools/call',
                params: {
                    name,
                    arguments: args
                }
            }, CallToolResultSchema);

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

    /**
     * List resources with optional filtering
     * This is a placeholder implementation until the servers fully support resources
     */
    public async listResources(query?: ResourceQuery): Promise<Resource[]> {
        if (!this.isConnected) {
            throw MCPError.initializationFailed(new Error('Client not connected'));
        }
        
        console.warn(`[${this.serverId}] Resource methods are not fully implemented yet`);
        return [];
    }
    
    /**
     * Get a specific resource by ID
     * This is a placeholder implementation until the servers fully support resources
     */
    public async getResource(id: string): Promise<Resource> {
        if (!this.isConnected) {
            throw MCPError.initializationFailed(new Error('Client not connected'));
        }
        
        console.warn(`[${this.serverId}] Resource methods are not fully implemented yet`);
        throw MCPError.toolNotFound(new Error(`Resource ${id} not found`));
    }
    
    /**
     * Create a new resource
     * This is a placeholder implementation until the servers fully support resources
     */
    public async createResource(params: ResourceCreateParams): Promise<Resource> {
        if (!this.isConnected) {
            throw MCPError.initializationFailed(new Error('Client not connected'));
        }
        
        console.warn(`[${this.serverId}] Resource methods are not fully implemented yet`);
        throw MCPError.toolExecutionFailed(new Error('Resource creation not supported'));
    }
    
    /**
     * Update an existing resource
     * This is a placeholder implementation until the servers fully support resources
     */
    public async updateResource(id: string, params: ResourceUpdateParams): Promise<Resource> {
        if (!this.isConnected) {
            throw MCPError.initializationFailed(new Error('Client not connected'));
        }
        
        console.warn(`[${this.serverId}] Resource methods are not fully implemented yet`);
        throw MCPError.toolExecutionFailed(new Error('Resource update not supported'));
    }
    
    /**
     * Delete a resource
     * This is a placeholder implementation until the servers fully support resources
     */
    public async deleteResource(id: string): Promise<void> {
        if (!this.isConnected) {
            throw MCPError.initializationFailed(new Error('Client not connected'));
        }
        
        console.warn(`[${this.serverId}] Resource methods are not fully implemented yet`);
        throw MCPError.toolExecutionFailed(new Error(`Resource deletion not supported for ${id}`));
    }
}