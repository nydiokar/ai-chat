import { z } from 'zod';

// Core interfaces that don't depend on anything else
export interface MCPToolConfig {
    name: string;
    description: string;
}

export interface MCPServerConfig {
    id: string;
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    tools?: MCPToolConfig[];
}

export interface MCPConfig {
    mcpServers: Record<string, MCPServerConfig>;
}

export interface MCPToolResponse {
    content: Array<{
        type: string;
        text?: string;
        url?: string;
        metadata?: Record<string, unknown>;
    }>;
    isError?: boolean;
    hint?: string;
}

// Tool definitions with clear server requirements
export interface MCPTool {
    name: string;
    description: string;
    server: MCPServerConfig;
    inputSchema: z.ZodSchema;
}

export interface MCPToolDefinition extends MCPTool {
    handler: (args: any) => Promise<MCPToolResponse>;
    examples?: string[];
    metadata?: Record<string, unknown>;
}

// Database and usage related interfaces
export interface ToolUsage {
    id: number;
    toolId?: string;
    mcpToolId: string;  // Made required since it's needed for tracking
    input: Record<string, unknown>;
    output: string;
    error?: string;
    duration: number;
    status: string;
    createdAt: Date;
}

export interface ToolUsageHistory {
    args: Record<string, unknown>;
    result: string;
    timestamp: Date;
    success: boolean;
}

export interface MCPToolModel {
    id: string;
    serverId: string;
    name: string;
    description: string;
    isEnabled: boolean;
    createdAt: Date;
    updatedAt: Date;
}

// Type for database operations that include usage
export interface ToolWithUsage extends MCPToolConfig {
    id: string;
    usage: ToolUsage[];
}

export interface MCPToolContext {
    lastRefreshed: Date;
    refreshCount: number;
    history?: ToolUsageHistory[];
    patterns?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}

export interface ToolInformationProvider {
    getAvailableTools(): Promise<MCPToolDefinition[]>;
    getToolByName(name: string): Promise<MCPToolDefinition | undefined>;
    refreshToolInformation(): Promise<void>;
}

// Constants
export const MCP_SERVER_IDS = [
    'brave-search',
    'github'
] as const;