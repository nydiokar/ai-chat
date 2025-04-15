import { Input, Response } from '../types/common.js';
import { ToolDefinition, ToolResponse } from '../tools/mcp/types/tools.js';
import { ReasoningStep } from './react-types.js';

// Re-export ReasoningStep as ThoughtProcess for backward compatibility
// This allows existing code to still work while we transition to the new interface
export type ThoughtProcess = ReasoningStep;

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
    processMessage(message: string, conversationHistory?: Input[]): Promise<Response>;

    /**
     * Execute a tool and process its result
     */
    executeTool(tool: ToolDefinition, args: Record<string, unknown>): Promise<ToolResponse>;

    /**
     * Cleanup any resources used by the agent
     */
    cleanup(): Promise<void>;

    // Debug mode methods
    setDebugMode(enabled: boolean): void;
    
    /**
     * Get the last reasoning step
     * This provides insight into the agent's reasoning process for debugging
     */
    getLastThoughtProcess(): ReasoningStep | null;
} 