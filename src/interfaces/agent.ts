import { Message, Response } from '../types/common.js';
import { ToolDefinition, ToolResponse } from '../tools/mcp/types/tools.js';

/**
 * Interface for reasoning agents that use LLM providers
 */
export interface Agent {
    /**
     * Unique identifier for the agent
     */
    readonly id: string;

    /**
     * Human-readable name of the agent
     */
    readonly name: string;

    /**
     * Process a message using the ReAct pattern
     * This involves reasoning about the message, taking actions with tools if needed,
     * and generating a response
     */
    processMessage(message: string, conversationHistory?: Message[]): Promise<Response>;

    /**
     * Execute a tool and process its result
     */
    executeTool(tool: ToolDefinition, args: Record<string, unknown>): Promise<ToolResponse>;

    /**
     * Cleanup any resources used by the agent
     */
    cleanup(): Promise<void>;
} 