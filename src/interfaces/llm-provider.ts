import { Input, Response } from '../types/common.js';
import { ToolDefinition } from '../tools/mcp/types/tools.js';

/**
 * Interface for LLM providers that handle raw API interactions
 */
export interface LLMProvider {
    /**
     * Generate a response from the LLM
     * @param message The user's input message
     * @param conversationHistory Optional conversation history
     * @param tools Optional tools that the LLM can use
     */
    generateResponse(
        message: string, 
        conversationHistory?: Input[],
        tools?: ToolDefinition[]
    ): Promise<Response>;

    /**
     * Get the model identifier
     */
    getModel(): string;

    /**
     * Set the system prompt for the model
     */
    setSystemPrompt(prompt: string): void;

    /**
     * Cleanup any resources
     */
    cleanup(): Promise<void>;
} 