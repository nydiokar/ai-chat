import { ToolDefinition, ToolResponse, ToolHandler } from '../types/tools.js';
import { Server, ServerConfig, ServerState } from '../types/server.js';
import { EventEmitter } from 'events';
import { Resource, ResourceQuery, ResourceCreateParams, ResourceUpdateParams } from '../types/resources.js';
import { MCPErrorRecord, ErrorStats } from '../types/errors.js';

export interface IMCPClient {
    initialize(): Promise<void>;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    listTools(): Promise<ToolDefinition[]>;
    callTool(name: string, args: any): Promise<ToolResponse>;
    
    // Resource methods
    listResources(query?: ResourceQuery): Promise<Resource[]>;
    getResource(id: string): Promise<Resource>;
    createResource(params: ResourceCreateParams): Promise<Resource>;
    updateResource(id: string, params: ResourceUpdateParams): Promise<Resource>;
    deleteResource(id: string): Promise<void>;
}

export interface IToolManager {
    /**
     * Register a new tool with the manager
     */
    registerTool(name: string, handler: ToolHandler): void;
    
    /**
     * Get all available tools
     */
    getAvailableTools(): Promise<ToolDefinition[]>;
    
    /**
     * Get a specific tool by name
     */
    getToolByName(name: string): Promise<ToolDefinition | undefined>;
    
    /**
     * Execute a tool with given arguments
     */
    executeTool(name: string, args: any): Promise<ToolResponse>;

    /**
     * Refresh the tool information cache
     */
    refreshToolInformation(): Promise<void>;
}

/**
 * Interface for server management
 */
export interface IServerManager extends EventEmitter {
    hasServer(id: string): boolean;
    getServerIds(): string[];
    getServer(id: string): Server | undefined;
    startServer(id: string): Promise<Server>;
    stopServer(id: string): Promise<void>;
    restartServer(id: string): Promise<void>;
    registerServer(id: string, config: ServerConfig): Promise<void>;
    unregisterServer(id: string): Promise<void>;
    getServerStatus(id: string): Promise<ServerState>;
    getServerErrors(serverId: string): MCPErrorRecord[];
    getErrorStats(): Map<string, ErrorStats>;
    clearServerErrors(serverId: string): void;
    
    /**
     * Get all servers as a map - primarily for dashboard use
     */
    getAllServers(): Map<string, Server>;
} 