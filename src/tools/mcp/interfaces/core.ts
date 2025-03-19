import { ToolDefinition, ToolResponse, ToolHandler } from '../types/tools.js';
import { Server, ServerConfig, ServerState } from '../types/server.js';
import { EventEmitter } from 'events';

export interface IMCPClient {
    initialize(): Promise<void>;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    listTools(): Promise<ToolDefinition[]>;
    callTool(name: string, args: any): Promise<ToolResponse>;
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

export interface IServerManager extends EventEmitter {
    /**
     * Start a server with the given configuration
     */
    startServer(id: string, config: ServerConfig): Promise<void>;
    
    /**
     * Stop a running server
     */
    stopServer(id: string): Promise<void>;
    
    /**
     * Check if a server exists
     */
    hasServer(id: string): boolean;
    
    /**
     * Get all server IDs
     */
    getServerIds(): string[];
    
    /**
     * Get a server by its ID
     */
    getServer(id: string): Server | undefined;

    /**
     * Unregister and cleanup a server
     */
    unregisterServer(id: string): Promise<void>;
} 