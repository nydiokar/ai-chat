import { v4 as uuidv4 } from "uuid";
import { MemoryProvider, MemoryType } from "../interfaces/memory-provider.js";
import { CompletionOutcome, ReasoningStep } from "../interfaces/react-types.js";
import { getLogger } from "../utils/shared-logger.js";
import type { Logger } from "winston";

/**
 * Manages reasoning state and history for a ReAct reasoning session
 */
export class ReActTrace {
  private readonly sessionId: string;
  private readonly logger: Logger;
  private steps: ReasoningStep[] = [];
  private isComplete: boolean = false;
  private finalResponse: string = "";
  private completionOutcome: CompletionOutcome | null = null;

  /**
   * Creates a new ReActTrace instance
   * @param memoryProvider The memory provider for persistence
   * @param userId The user ID for memory context
   */
  constructor(
    private readonly memoryProvider: MemoryProvider,
    private readonly userId: string,
  ) {
    this.sessionId = uuidv4();
    this.logger = getLogger("ReActTrace");
  }

  /**
   * Gets the unique session ID for this trace
   */
  public getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Gets the user ID associated with this trace
   */
  public getUserId(): string {
    return this.userId;
  }

  /**
   * Adds a reasoning step to the trace
   * @param step The reasoning step to add
   * @param saveToMemory Whether to persist the step to memory
   */
  public async addStep(
    step: ReasoningStep,
    saveToMemory: boolean = true,
  ): Promise<void> {
    this.steps.push(step);

    if (saveToMemory) {
      await this.saveToMemory(step);
    }
  }

  /**
   * Gets all reasoning steps in the trace
   */
  public getSteps(): ReadonlyArray<ReasoningStep> {
    return [...this.steps];
  }

  /**
   * Gets the most recent reasoning step
   */
  public getLastStep(): ReasoningStep | null {
    if (this.steps.length === 0) return null;
    return this.steps[this.steps.length - 1];
  }

  /**
   * Loads previous reasoning steps from memory
   */
  public async loadFromMemory(): Promise<ReasoningStep[]> {
    try {
      const memories = await this.memoryProvider.search({
        userId: this.userId,
        types: [MemoryType.THOUGHT_PROCESS],
        metadata: { sessionId: this.sessionId },
        sortBy: "timestamp",
        sortDirection: "asc",
      });

      this.steps = memories.entries.map((entry) => entry.content.step);
      return [...this.steps];
    } catch (error) {
      this.logger.error("Failed to load reasoning steps from memory", {
        error: String(error),
        userId: this.userId,
        sessionId: this.sessionId,
      });
      return [];
    }
  }

  /**
   * Saves a reasoning step to memory
   * @param step The step to save
   */
  private async saveToMemory(step: ReasoningStep): Promise<void> {
    try {
      await this.memoryProvider.storeThoughtProcess(step, this.userId, {
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error("Failed to save reasoning step to memory", {
        error: String(error),
        userId: this.userId,
        sessionId: this.sessionId,
        stepId: step.stepId,
      });
    }
  }

  /**
   * Optimizes steps for context window management
   * @param maxTokens The maximum number of tokens to include
   * @returns Optimized array of reasoning steps
   */
  public optimizeSteps(maxTokens: number = 4000): ReasoningStep[] {
    // If we have few steps, just return all of them
    if (this.steps.length <= 3) return [...this.steps];

    // Always include the first step (initial user query)
    const firstStep = this.steps[0];

    // Always include the last 2 steps for recency
    const lastSteps = this.steps.slice(-2);

    // If we still have too many tokens, gradually prune middle steps
    // This is a simple approach - could be enhanced with intelligent pruning
    let middleSteps = this.steps.slice(1, -2);

    // For now, just include all middle steps - in a real implementation,
    // we would calculate token counts and intelligently prune

    return [firstStep, ...middleSteps, ...lastSteps];
  }

  /**
   * Marks the reasoning trace as complete with a final response
   * @param response The final response to the user
   */
  public markComplete(
    response: string,
    outcome: Omit<CompletionOutcome, "response"> = { type: "finish" },
  ): void {
    this.isComplete = true;
    this.finalResponse = response;
    this.completionOutcome = {
      ...outcome,
      response,
    };
  }

  /**
   * Checks if the reasoning process is complete
   */
  public isReasoningComplete(): boolean {
    return this.isComplete;
  }

  /**
   * Gets the final response from reasoning
   */
  public getFinalResponse(): string {
    return this.finalResponse;
  }

  /**
   * Gets the completion outcome for the current trace.
   */
  public getCompletionOutcome(): CompletionOutcome | null {
    return this.completionOutcome ? { ...this.completionOutcome } : null;
  }

  /**
   * Extract topics from all reasoning steps
   * This is a placeholder for more advanced topic extraction
   */
  public extractTopics(): string[] {
    const allText = this.steps.flatMap((step) => {
      const texts: string[] = [];

      // Extract thought texts
      if (step.thought) {
        if (step.thought.reasoning) texts.push(step.thought.reasoning);
        if (step.thought.plan) texts.push(step.thought.plan);
      }

      // Extract tool names and parameters as topics
      if (step.action) {
        texts.push(step.action.tool);
        if (step.action.params) {
          texts.push(JSON.stringify(step.action.params));
        }
      }

      // Extract observation results
      if (step.observation) {
        if (step.observation.summary) {
          texts.push(step.observation.summary);
        }
        if (step.observation.result) {
          texts.push(String(step.observation.result));
        }
        if (step.observation.sourceRefs?.length) {
          texts.push(step.observation.sourceRefs.join(" "));
        }
      }

      return texts;
    });

    // This is a very simple approach - in practice, you'd use NLP
    // to extract meaningful topics
    return [
      ...new Set(
        allText
          .join(" ")
          .split(/\s+/)
          .filter((word) => word.length > 4)
          .slice(0, 20),
      ),
    ];
  }
}
