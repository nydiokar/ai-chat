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
  
  /**
   * Generate a simple prompt for direct interactions without reasoning
   * @returns Promise resolving to a simple prompt string
   */
  generateSimplePrompt?(): Promise<string>;
  
  /**
   * Generate a ReAct-specific prompt that encourages reasoning
   * @returns Promise resolving to a ReAct formatted prompt string
   */
  generateReActPrompt?(): Promise<string>;
  
  /**
   * Generate a follow-up prompt after tool execution
   * @param originalMessage Original user query
   * @param reasoning Extracted reasoning from initial response
   * @param toolCall Tool call information
   * @param toolResult Result from tool execution
   * @returns Promise resolving to a follow-up prompt string
   */
  generateFollowUpPrompt?(
    originalMessage: string,
    reasoning: string,
    toolCall: {name: string, parameters: any},
    toolResult: any
  ): Promise<string>;
} 