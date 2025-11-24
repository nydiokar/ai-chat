import { ToolDefinition } from "../tools/mcp/types/tools.js";
import { Input } from "../types/common.js";
import { ReasoningStep } from "./react-types.js";

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
    history?: Input[],
  ): Promise<string>;

  /**
   * Generate a simple prompt for direct interactions without reasoning
   * @returns Promise resolving to a simple prompt string
   */
  generateSimplePrompt?(): Promise<string>;

  /**
   * Generate a ReAct-specific prompt that encourages reasoning
   * @param input User input to reason about
   * @param steps Previous reasoning steps
   * @param tools Available tools
   * @param currentStep Current step number
   * @returns Promise resolving to a ReAct formatted prompt string
   */
  generateReActPrompt?(
    input: string,
    steps?: ReasoningStep[],
    tools?: ToolDefinition[],
    currentStep?: number,
  ): Promise<string>;

  /**
   * Generate a follow-up prompt after tool execution
   * @param originalMessage Original user query
   * @param steps Reasoning steps that led to this point
   * @param toolResult Result from tool execution
   * @returns Promise resolving to a follow-up prompt string
   */
  generateFollowUpPrompt?(
    originalMessage: string,
    steps: ReasoningStep[],
    toolResult: any,
  ): Promise<string>;

  /**
   * Estimates token count for a reasoning step
   * Useful for context management and preventing token limit issues
   * @param step The reasoning step to estimate tokens for
   * @returns Approximate token count for the step
   */
  estimateStepTokens?(step: ReasoningStep): number;

  /**
   * Estimates the total token count for a prompt with reasoning steps
   * @param input The user input
   * @param steps The reasoning steps to include
   * @param tools The available tools
   * @returns Approximate token count for the full prompt
   */
  estimatePromptTokens?(
    input: string,
    steps: ReasoningStep[],
    tools: ToolDefinition[],
  ): number;

  /**
   * Optimizes a list of reasoning steps to fit within a token limit
   * @param steps The full list of reasoning steps
   * @param maxTokens The maximum tokens to allow (approximate)
   * @returns A reduced list of steps that fits within the token limit
   */
  optimizeSteps?(steps: ReasoningStep[], maxTokens?: number): ReasoningStep[];
}
