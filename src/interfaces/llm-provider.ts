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
     * Optional method to get a final response after tool execution
     * @param originalMessage The original user message
     * @param toolResults Results from executed tools
     * @param conversationHistory Optional conversation history
     */
    getFinalResponse?(
        originalMessage: string,
        toolResults: {
            toolName: string;
            toolCallId: string;
            result: string;
            success: boolean;
        }[],
        conversationHistory?: Input[]
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