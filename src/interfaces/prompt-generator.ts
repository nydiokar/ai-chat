import { ToolDefinition } from '../tools/mcp/types/tools.js';
import { Input } from '../types/common.js';

/**
 * Interface for prompt generators that create formatted prompts for LLMs
 */
export interface PromptGenerator {
  /**
   * Generate a formatted prompt incorporating the message and available tools
   * @param input The user's input message
   * @param tools Array of available tools that can be used
   * @param history Optional conversation history
   * @returns Promise resolving to the formatted prompt string
   */
  generatePrompt(
    input: string, 
    tools: ToolDefinition[],
    history?: Input[]
  ): Promise<string>;
} 