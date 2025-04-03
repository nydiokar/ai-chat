import { ToolDefinition } from '../tools/mcp/types/tools.js';

/**
 * Interface for prompt generators that create formatted prompts for LLMs
 */
export interface PromptGenerator {
  /**
   * Generate a formatted prompt incorporating the message and available tools
   * @param message The user's input message
   * @param tools Array of available tools that can be used
   * @returns Promise resolving to the formatted prompt string
   */
  generatePrompt(
    message: string, 
    tools: ToolDefinition[]
  ): Promise<string>;
} 