import { ReasoningStep } from "../interfaces/react-types.js";

/**
 * Interface for the ReAct Engine
 */
export interface IReActEngine {
  /**
   * Run the reasoning process with the given prompt
   */
  run(prompt: string): Promise<string>;

  /**
   * Get the current reasoning steps
   */
  getReasoningSteps(): ReasoningStep[];

  /**
   * Set override results for testing
   */
  setOverrideResults(overrides: Record<string, any>): void;
}
