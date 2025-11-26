import { LLMProvider } from "../interfaces/llm-provider.js";
import { MemoryProvider, MemoryType } from "../interfaces/memory-provider.js";
import { IToolManager } from "../tools/mcp/interfaces/core.js";
import { ReasoningStep } from "../interfaces/react-types.js";
import {
  ToolChainExecutor,
  ToolExecutionResult,
} from "../tools/tool-chain/tool-chain-executor.js";
import { getLogger } from "../utils/shared-logger.js";
import type { Logger } from "winston";
import { PromptGenerator } from "../interfaces/prompt-generator.js";
import { ToolDefinition, ToolResponse } from "../tools/mcp/types/tools.js";
import { ReActStepParser } from "./react-step-parser.js";
import { ReActToolHandler } from "./react-tool-handler.js";
import { ReActTrace } from "./react-trace.js";
import { ToTPlanner, ToTPlanContext } from "./planning/tot-planner.js";

// Adapter function to convert ToolResponse to ToolExecutionResult
function adaptToolResponse(response: ToolResponse): ToolExecutionResult {
  // Create a properly typed metadata object with required fields
  let typedMetadata: ToolExecutionResult["metadata"] = undefined;

  if (response.metadata) {
    typedMetadata = {
      executionTime: response.metadata.executionTime || 0,
      toolName: response.metadata.toolName || "unknown",
    };
  }

  return {
    success: response.success,
    data: response.data,
    error: response.error ? new Error(response.error) : undefined,
    metadata: typedMetadata,
  };
}

/**
 * Core engine implementing the ReAct (Reasoning + Action) pattern
 * Orchestrates the process of reasoning steps, tool execution, and memory persistence
 */
export class ReActEngine {
  private readonly MAX_STEPS = 8;
  private readonly logger: Logger;
  private readonly VERBOSE_LOGGING =
    process.env.REACT_VERBOSE_LOGGING !== "false";
  private readonly stepParser: ReActStepParser;
  private readonly toolHandler: ReActToolHandler;
  private pendingFollowUpPrompt: string | null = null;
  private currentUserMessage: string | null = null;
  private ungroundedConclusionAttempts = 0;
  private readonly MAX_UNGROUNDED_ATTEMPTS = 2;
  private currentTotPlan: ToTPlanContext | null = null;

  constructor(
    private readonly memory: MemoryProvider,
    private readonly llm: LLMProvider,
    private readonly toolManager: IToolManager,
    toolExecutor: ToolChainExecutor,
    private readonly promptGenerator: PromptGenerator,
    private readonly totPlanner?: ToTPlanner,
  ) {
    this.logger = getLogger("ReActEngine");
    this.stepParser = new ReActStepParser();
    this.toolHandler = new ReActToolHandler(toolManager, toolExecutor);
  }

  // Helper method to handle verbose logging
  private logVerbose(
    level: "info" | "debug",
    message: string,
    context?: any,
  ): void {
    if (!this.VERBOSE_LOGGING) return;

    if (level === "info") {
      this.logger.info(message, context);
    } else {
      this.logger.debug(message, context);
    }
  }

  // Helper to format simplified YAML for display
  private formatForDisplay(obj: any): string {
    if (typeof obj !== "object" || obj === null) {
      return String(obj);
    }

    let result = "";

    // Handle thought
    if (obj.thought) {
      result += "Thought:\n";
      if (obj.thought.reasoning) {
        const reasoning =
          obj.thought.reasoning.length > 100
            ? obj.thought.reasoning.substring(0, 100) + "..."
            : obj.thought.reasoning;
        result += `  Reasoning: ${reasoning}\n`;
      }
      if (obj.thought.plan) {
        result += `  Plan: ${obj.thought.plan}\n`;
      }
    }

    // Handle action
    if (obj.action) {
      result += "Action:\n";
      result += `  Tool: ${obj.action.tool}\n`;
      result += `  Parameters: ${JSON.stringify(obj.action.params || {})}\n`;
    }

    // Handle conclusion
    if (obj.conclusion) {
      result += "Conclusion:\n";
      const answer =
        obj.conclusion.final_answer.length > 100
          ? obj.conclusion.final_answer.substring(0, 100) + "..."
          : obj.conclusion.final_answer;
      result += `  Answer: ${answer}\n`;
    }

    return result;
  }

  /**
   * Process a user message and execute the ReAct loop
   * @param userMessage The message from the user to process
   * @param userId The ID of the user for memory context
   * @param previousSteps Optional array of previous reasoning steps
   * @param maxIterations Maximum number of iterations before forcing completion
   * @returns The final thought process after completing the reasoning
   */
  public async process(
    userMessage: string,
    userId: string,
    previousSteps: ReasoningStep[] = [],
    maxIterations: number = this.MAX_STEPS,
  ): Promise<string> {
    // Create a reasoning trace to track all steps and manage state
    const trace = new ReActTrace(this.memory, userId);
    this.currentUserMessage = userMessage;
    this.ungroundedConclusionAttempts = 0;
    this.currentTotPlan = null;

    // Add previous steps to the trace if provided
    if (previousSteps.length > 0) {
      for (const step of previousSteps) {
        await trace.addStep(step, false); // Don't save again to memory
      }
    }

    // Counter for tracking iterations
    let iterationCount = 0;

    // Get available tools and registry
    const tools = await this.prepareTools();

    // Log start of reasoning process
    this.logger.info(
      `Processing user message: "${userMessage.substring(0, 50)}${userMessage.length > 50 ? "..." : ""}"`,
    );
    this.logVerbose("debug", "Available tools", {
      count: tools.availableTools.length,
      tools: tools.availableTools.map((t) => t.name).join(", "),
    });

    // NEW: Tree-of-Thought Pre-Planning (Simple!)
    let toolsToUse: ToolDefinition[] = tools.availableTools;

    if (this.shouldUseTotPlanning()) {
      try {
        this.logger.info("Executing ToT planning");
        toolsToUse = await this.totPlanner!.planAndFilter(
          userMessage,
          tools.availableTools,
        );
        this.currentTotPlan = this.totPlanner!.getLastPlan();
      } catch (error) {
        this.logger.error("ToT planning error, falling back to all tools", {
          error: error instanceof Error ? error.message : String(error),
        });
        toolsToUse = tools.availableTools; // Fallback
        this.currentTotPlan = null;
      }
    } else {
      this.currentTotPlan = null;
    }

    toolsToUse = this.filterToolsForQuery(
      userMessage,
      toolsToUse,
      tools.availableTools,
    );

    // Main ReAct loop - use MAX_STEPS to limit iterations
    while (!trace.isReasoningComplete() && iterationCount < maxIterations) {
      iterationCount++;
      this.logger.debug(`ReAct iteration ${iterationCount}/${maxIterations}`);

      // Generate prompt with appropriate context using optimized steps
      const optimizedSteps = trace.optimizeSteps();
      let prompt: string;
      if (this.pendingFollowUpPrompt) {
        prompt = this.pendingFollowUpPrompt;
        this.pendingFollowUpPrompt = null;
      } else {
        prompt = await this.generateContextualPrompt(
          userMessage,
          optimizedSteps,
          toolsToUse, // Use filtered tools instead of all tools
          iterationCount,
        );
      }

      // Debug: Log filtered tools being sent to LLM
      if (process.env.REACT_VERBOSE_LOGGING === "true") {
        this.logger.debug(`Iteration ${iterationCount} - Tools in prompt`, {
          toolNames: toolsToUse.map((t) => t.name),
          toolCount: toolsToUse.length,
        });
      }

      try {
        // Get LLM response and parse reasoning step
        const nextStep = await this.getLLMReasoningStep(prompt);
        if (!nextStep) continue;

        // Add step to the trace
        await trace.addStep(nextStep);

        // Log the step for debugging
        this.logVerbose("debug", `Added step: ${nextStep.stepId}`, {
          step: this.formatForDisplay(nextStep),
        });

        // Check if step has conclusion (should end reasoning)
        if (nextStep.conclusion?.final_answer) {
          if (this.isConclusionGrounded(nextStep.conclusion.final_answer, trace)) {
            trace.markComplete(nextStep.conclusion.final_answer);
            this.ungroundedConclusionAttempts = 0;
            this.logVerbose("info", "Reasoning complete with grounded conclusion");
            break; // Exit the loop immediately
          }

          if (this.ungroundedConclusionAttempts < this.MAX_UNGROUNDED_ATTEMPTS) {
            this.ungroundedConclusionAttempts += 1;
            const reminder = this.buildUngroundedConclusionReminder(trace);
            const reminderObservation =
              this.toolHandler.createObservationStep(reminder);
            await trace.addStep(reminderObservation);

            if (
              this.promptGenerator.generateFollowUpPrompt &&
              this.currentUserMessage
            ) {
              try {
                const stepsSnapshot = [...trace.getSteps()] as ReasoningStep[];
                this.pendingFollowUpPrompt =
                  await this.promptGenerator.generateFollowUpPrompt(
                    this.currentUserMessage,
                    stepsSnapshot,
                    reminder,
                  );
              } catch (followUpError) {
                this.logger.error(
                  "Failed to generate grounding follow-up prompt",
                  {
                    error:
                      followUpError instanceof Error
                        ? followUpError.message
                        : String(followUpError),
                  },
                );
              }
            }

            continue;
          } else {
            this.logger.warn(
              "Accepting ungrounded conclusion after multiple retries",
              {
                attempts: this.ungroundedConclusionAttempts,
              },
            );
            trace.markComplete(nextStep.conclusion.final_answer);
            break;
          }
        }

        // Handle tool execution only if no conclusion
        if (nextStep.action?.tool) {
          // Validate tool is in allowed list (respects ToT filtering)
          const requestedTool = nextStep.action.tool;
          const isAllowed = toolsToUse.some((t) => t.name === requestedTool);

          if (!isAllowed) {
            this.logger.warn(
              `LLM requested tool '${requestedTool}' which is not in the filtered tool list. Skipping execution.`,
              {
                requestedTool,
                allowedTools: toolsToUse.map((t) => t.name),
              },
            );

            // Add error observation instead of executing
            const errorObservation = this.toolHandler.createObservationStep(
              `Error: Tool '${requestedTool}' is not available. Available tools: ${toolsToUse.map((t) => t.name).join(", ")}`,
            );
            await trace.addStep(errorObservation);
            continue; // Skip to next iteration
          }

          await this.executeToolAndStoreResult(nextStep.action, trace);
        }
      } catch (error) {
        await this.handleProcessingError(error, trace, iterationCount);
      }

      // Check for max iterations reached
      if (iterationCount >= maxIterations && !trace.isReasoningComplete()) {
        const fallbackResponse = this.generateFallbackResponse(
          trace.getSteps(),
        );
        trace.markComplete(fallbackResponse);
      }
    }

    // Return the final response
    const finalResponse = trace.getFinalResponse();
    this.pendingFollowUpPrompt = null;
    this.currentUserMessage = null;
    this.ungroundedConclusionAttempts = 0;
    this.currentTotPlan = null;
    return finalResponse;
  }

  /**
   * Prepares tools and registry for the reasoning process
   * @returns Object containing available tools and tool registry
   */
  private async prepareTools(): Promise<{
    availableTools: ToolDefinition[];
    registry: Record<string, (input: any) => Promise<any>>;
  }> {
    const availableTools = await this.toolManager.getAvailableTools();
    const registry = await this.toolHandler.getToolRegistry();
    return { availableTools, registry };
  }

  /**
   * Generate a fallback response when the reasoning process hits the iteration limit
   * @param steps The reasoning steps collected so far
   * @returns A reasonable fallback response
   */
  private generateFallbackResponse(
    steps: ReadonlyArray<ReasoningStep>,
  ): string {
    // Extract useful information from the steps
    const observations = steps
      .filter((step) => step.observation?.result)
      .map((step) => step.observation!.result);

    const lastThought = steps[steps.length - 1]?.thought?.reasoning || "";

    // Create a reasonable fallback response
    return `I've been working on your request, but need more information. Based on what I've found so far:\n\n${observations
      .slice(-2)
      .join(
        "\n\n",
      )}\n\nMy current thinking is: ${lastThought}\n\nCould you provide more details or clarify your request?`;
  }

  /**
   * Execute a tool directly outside of the reasoning process
   * @param toolName The name of the tool to execute
   * @param params The parameters for the tool
   * @returns The result of the tool execution
   */
  public async executeToolDirectly(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<any> {
    return await this.toolManager.executeTool(toolName, params);
  }

  /**
   * Gets a reasoning step from the LLM
   * @param prompt The prompt to send to the LLM
   * @returns A parsed reasoning step or null if parsing failed
   */
  private async getLLMReasoningStep(
    prompt: string,
  ): Promise<ReasoningStep | null> {
    try {
      const llmResponse = await this.llm.generateResponse(prompt);
      if (this.VERBOSE_LOGGING) {
        const content = llmResponse?.content ?? "";
        const maxLen = 2000;
        const preview =
          content.length > maxLen ? content.substring(0, maxLen) + "…" : content;
        const divider = "-".repeat(60);
        this.logger.debug(
          [
            divider,
            "LLM RAW RESPONSE",
            divider,
            preview,
            divider,
          ].join("\n"),
        );
      }
      if (!llmResponse || !llmResponse.content) {
        this.logger.error("LLM returned empty response");
        return null;
      }

      // Parse the response into a reasoning step
      return this.stepParser.parseReasoningStep(llmResponse.content);
    } catch (error) {
      this.logger.error("Error getting reasoning step from LLM", {
        error: String(error),
      });
      return null;
    }
  }

  /**
   * Execute a tool and store the result in the trace
   * @param action The tool action to execute
   * @param trace The reasoning trace
   */
  private async executeToolAndStoreResult(
    action: ReasoningStep["action"],
    trace: ReActTrace,
  ): Promise<void> {
    if (!action) return;

    const { tool, params } = action;

    this.logger.info(`Executing tool: ${tool}`, {
      params: JSON.stringify(params || {}),
    });

    try {
      // Execute the tool using the tool manager
      const toolResponse = await this.toolManager.executeTool(
        tool,
        params || {},
      );

      // Convert ToolResponse to ToolExecutionResult for compatibility
      const result = adaptToolResponse(toolResponse);

      // Format the result using the tool handler for better readability
      const formattedResult = this.toolHandler.formatToolResult(result, action);

      // Create an observation step with the result
      const observationStep =
        this.toolHandler.createObservationStep(formattedResult);

      // Add the observation to the trace
      await trace.addStep(observationStep);

      this.logVerbose("debug", `Added observation: ${observationStep.stepId}`, {
        observation:
          formattedResult.substring(0, 100) +
          (formattedResult.length > 100 ? "..." : ""),
      });

      // Store the tool execution in memory for analytics
      await this.storeToolExecution(
        tool,
        params || {},
        result,
        true,
        trace.getUserId(),
      );

      if (
        this.promptGenerator.generateFollowUpPrompt &&
        this.currentUserMessage
      ) {
        try {
          const stepsSnapshot = [...trace.getSteps()] as ReasoningStep[];
          this.pendingFollowUpPrompt =
            await this.promptGenerator.generateFollowUpPrompt(
              this.currentUserMessage,
              stepsSnapshot,
              formattedResult,
            );
        } catch (followUpError) {
          this.logger.error("Failed to generate follow-up prompt", {
            error:
              followUpError instanceof Error
                ? followUpError.message
                : String(followUpError),
          });
        }
      }
    } catch (error) {
      this.logger.error(`Error executing tool: ${tool}`, {
        error: String(error),
        params: JSON.stringify(params || {}),
      });

      // Create an error observation with formatted error message from the tool handler
      let errorMessage = this.toolHandler.formatErrorResult(
        error instanceof Error ? error : new Error(String(error)),
        action,
      );
      const failureGuidance = this.buildToolFailureGuidance(
        tool,
        params || {},
        this.currentUserMessage,
      );
      if (failureGuidance) {
        errorMessage = `${errorMessage}\n\n${failureGuidance}`;
      }
      const observationStep =
        this.toolHandler.createObservationStep(errorMessage);

      // Add the error observation to the trace
      await trace.addStep(observationStep);

      // Store the failed tool execution in memory
      await this.storeToolExecution(
        tool,
        params || {},
        null,
        false,
        trace.getUserId(),
        String(error),
      );

      if (
        this.promptGenerator.generateFollowUpPrompt &&
        this.currentUserMessage
      ) {
        try {
          const stepsSnapshot = [...trace.getSteps()] as ReasoningStep[];
          this.pendingFollowUpPrompt =
            await this.promptGenerator.generateFollowUpPrompt(
              this.currentUserMessage,
              stepsSnapshot,
              observationStep.observation?.result || "",
            );
        } catch (followUpError) {
          this.logger.error("Failed to generate follow-up prompt", {
            error:
              followUpError instanceof Error
                ? followUpError.message
                : String(followUpError),
          });
        }
      }
    }
  }

  /**
   * Handles errors in the processing loop
   * @param error The error that occurred
   * @param trace The reasoning trace
   * @param iterationCount The current iteration count
   */
  private async handleProcessingError(
    error: any,
    trace: ReActTrace,
    iterationCount: number,
  ): Promise<void> {
    this.logger.error(
      `Error in processing loop (iteration ${iterationCount})`,
      {
        error: String(error),
      },
    );

    try {
      // Create an error observation to guide the LLM
      const errorMessage = `There was an error: ${String(error)}. Please try a different approach.`;
      const observationStep =
        this.toolHandler.createObservationStep(errorMessage);

      // Add the error observation to the trace
      await trace.addStep(observationStep);
    } catch (secondaryError) {
      this.logger.error("Error creating error observation step", {
        error: String(secondaryError),
      });
    }
  }

  /**
   * Stores a tool execution in memory for analytics
   * @param tool The tool that was executed
   * @param params The parameters used
   * @param result The result of the execution
   * @param success Whether the execution was successful
   * @param userId The user ID
   * @param errorMessage Optional error message
   */
  private async storeToolExecution(
    tool: string,
    params: Record<string, any>,
    result: ToolExecutionResult | null,
    success: boolean,
    userId: string,
    errorMessage?: string,
  ): Promise<boolean> {
    try {
      // Store tool usage in memory
      await this.memory.store({
        userId,
        type: MemoryType.TOOL_USAGE,
        content: {
          tool,
          params,
          result: result
            ? {
                success: result.success,
                // Store a trimmed version of the data to avoid huge entries
                data:
                  typeof result.data === "string"
                    ? result.data.substring(0, 1000)
                    : JSON.stringify(result.data).substring(0, 1000),
                metadata: result.metadata,
              }
            : null,
          success,
          errorMessage,
        },
        metadata: {
          timestamp: new Date().toISOString(),
        },
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to store tool execution", {
        error: String(error),
        tool,
        userId,
      });

      return false;
    }
  }

  /**
   * Generates a contextual prompt for the LLM
   * @param userMessage The user message
   * @param steps The reasoning steps to include
   * @param tools The available tools
   * @param currentStep The current step number
   * @returns A formatted prompt
   */
  private async generateContextualPrompt(
    userMessage: string,
    steps: ReasoningStep[],
    tools: ToolDefinition[],
    currentStep: number,
  ): Promise<string> {
    try {
      const planSummary = this.formatTotPlanSummary();
      const augmentedInput = planSummary
        ? "Tree-of-Thought Plan:\n" + planSummary + "\n\nUser request: " + userMessage
        : userMessage;

      let prompt: string;
      if (this.promptGenerator.generateReActPrompt) {
        prompt = await this.promptGenerator.generateReActPrompt(
          augmentedInput,
          steps,
          tools,
          currentStep,
        );
      } else {
        prompt = await this.promptGenerator.generatePrompt(
          augmentedInput,
          tools,
        );
      }

      if (this.VERBOSE_LOGGING) {
        const maxLen = 2000;
        const promptPreview =
          prompt.length > maxLen ? `${prompt.substring(0, maxLen)}…` : prompt;
        const divider = '-'.repeat(60);
        this.logger.debug(
          [
            divider,
            'CONTEXTUAL PROMPT',
            divider,
            promptPreview,
            divider,
          ].join('\n'),
        );
      }

      return prompt;
    } catch (error) {
      this.logger.error('Error generating contextual prompt', {
        error: String(error),
      });

      const fallbackPlan = this.formatTotPlanSummary();
      const fallbackHeader = fallbackPlan
        ? `Tree-of-Thought Plan:\n${fallbackPlan}\n\n`
        : '';

      return `${fallbackHeader}You are a helpful AI assistant. The user has requested: "${userMessage}".
      
Previous steps: ${JSON.stringify(steps, null, 2)}

Available tools: ${JSON.stringify(
        tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        })),
        null,
        2,
      )}

Please provide the next step in reasoning or a final answer.`;
    }
  }

  /**
   * Gets the last reasoning step for a user
   * This is kept for backward compatibility
   * @param userId The user ID
   */
  public async getLastReasoningStep(
    userId: string,
  ): Promise<ReasoningStep | null> {
    try {
      const memories = await this.memory.search({
        userId,
        types: [MemoryType.THOUGHT_PROCESS],
        sortBy: "timestamp",
        sortDirection: "desc",
        limit: 1,
      });

      if (memories.entries.length === 0) {
        return null;
      }

      return memories.entries[0].content.step;
    } catch (error) {
      this.logger.error("Error retrieving last reasoning step", {
        error: String(error),
        userId,
      });

      return null;
    }
  }

  /**
   * Formats the latest Tree-of-Thought plan for prompt injection
   */
  private formatTotPlanSummary(): string | null {
    if (!this.currentTotPlan) return null;

    const sections: string[] = [];

    if (
      this.currentTotPlan.decomposition &&
      this.currentTotPlan.decomposition.length > 0
    ) {
      const lines = this.currentTotPlan.decomposition.map((item, index) => {
        const tools =
          item.tools && item.tools.length > 0
            ? ` (tools: ${item.tools.join(", ")})`
            : "";
        return `${index + 1}. ${item.step}${tools}`;
      });
      sections.push(lines.join("\n"));
    }

    if (this.currentTotPlan.strategy) {
      sections.push(`Strategy: ${this.currentTotPlan.strategy}`);
    }

    if (
      this.currentTotPlan.refinedSteps &&
      this.currentTotPlan.refinedSteps.length > 0
    ) {
      const lines = this.currentTotPlan.refinedSteps.map(
        (step, index) => `${index + 1}. ${step}`,
      );
      sections.push(`Refined steps:\n${lines.join("\n")}`);
    }

    if (
      this.currentTotPlan.refinedTools &&
      this.currentTotPlan.refinedTools.length > 0
    ) {
      sections.push(
        `Focused tools: ${this.currentTotPlan.refinedTools.join(", ")}`,
      );
    }

    if (sections.length === 0) {
      return null;
    }

    return sections.join("\n\n");
  }
  /**
   * Check if ToT planning should be used
   */
  private shouldUseTotPlanning(): boolean {
    return (
      this.totPlanner !== undefined &&
      process.env.ENABLE_TOT_PLANNING === "true"
    );
  }

  private isConclusionGrounded(
    finalAnswer: string,
    trace: ReActTrace,
  ): boolean {
    const observationText = this.getLastObservation(trace);
    if (!observationText) {
      return true;
    }

    const observationUrls =
      observationText.match(/https?:\/\/\S+/gi)?.map((url) => url.trim()) || [];

    if (observationUrls.length > 0) {
      return observationUrls.some((url) => finalAnswer.includes(url));
    }

    const normalizedObservation = observationText.toLowerCase();
    const normalizedAnswer = finalAnswer.toLowerCase();
    const keywords =
      normalizedObservation.match(/\b[a-z0-9]{5,}\b/g)?.slice(0, 5) || [];

    if (keywords.length <= 2) {
      return true;
    }

    return keywords.some((keyword) => normalizedAnswer.includes(keyword));
  }

  private getLastObservation(trace: ReActTrace): string | null {
    const steps = trace.getSteps();
    for (let i = steps.length - 1; i >= 0; i--) {
      const observation = steps[i].observation?.result;
      if (observation) {
        return observation;
      }
    }
    return null;
  }

  private buildUngroundedConclusionReminder(trace: ReActTrace): string {
    const observation = this.getLastObservation(trace);
    const snippet =
      observation && observation.length > 400
        ? `${observation.substring(0, 400)}...`
        : observation || "No observation available.";

        
    return [
      "Reminder: Your last response did not cite the most recent tool result.",
      "You must reference and cite the latest observation before concluding.",
      `Latest observation snippet:\n${snippet}`,
    ].join("\n\n");
  }

  private buildToolFailureGuidance(
    toolName: string,
    params: Record<string, unknown>,
    userMessage: string | null,
  ): string | null {
    const lowerTool = toolName.toLowerCase();
    const isRepoTool =
      lowerTool.includes("repo") ||
      lowerTool.includes("branch") ||
      lowerTool.includes("issue") ||
      lowerTool.includes("commit") ||
      lowerTool.includes("pull");

    if (isRepoTool && userMessage && !/repo|branch|git|pull|issue/i.test(userMessage)) {
      return `Guidance: ${toolName} is for repository management, but the user request (â€œ${userMessage}â€) did not ask for repository changes. Focus on research/search tools instead.`;
    }

    if (lowerTool.includes("github") && params && Object.keys(params).length > 0) {
      return `Guidance: ${toolName} requires valid GitHub metadata. Double-check repository names or switch back to information-gathering tools since the request appears informational.`;
    }

    return null;
  }

  private filterToolsForQuery(
    userMessage: string,
    candidateTools: ToolDefinition[],
    allTools: ToolDefinition[],
  ): ToolDefinition[] {
    const uniqueTools = new Map<string, ToolDefinition>();
    for (const tool of candidateTools) {
      if (!uniqueTools.has(tool.name)) {
        uniqueTools.set(tool.name, tool);
      }
    }
    candidateTools = Array.from(uniqueTools.values());

    if (candidateTools.length === 0) {
      return this.selectDefaultResearchTools(allTools);
    }

    const normalizedQuery = userMessage.toLowerCase();
    const mentionsRepoWork = /github|repo|repository|branch|commit|pull\s?-?\s?request|issue\b|merge|pull\s?req|git\b|pr\b/.test(
      normalizedQuery,
    );

    let filteredTools = candidateTools;
    if (!mentionsRepoWork) {
      filteredTools = candidateTools.filter(
        (tool) => !this.isRepositoryManagementTool(tool),
      );
    }

    if (filteredTools.length === 0) {
      this.logger.info(
        "All filtered tools were repository-management related; falling back to research tools",
        { userMessage },
      );
      filteredTools = this.selectDefaultResearchTools(allTools);
    }

    const limitedTools = filteredTools.slice(0, 6);
    if (limitedTools.length !== candidateTools.length) {
      this.logger.debug("Tool list filtered for current query", {
        original: candidateTools.map((t) => t.name),
        filtered: limitedTools.map((t) => t.name),
      });
    }

    return limitedTools;
  }

  private selectDefaultResearchTools(
    tools: ToolDefinition[],
  ): ToolDefinition[] {
    const researchTools = tools.filter((tool) => this.isResearchTool(tool));
    if (researchTools.length > 0) {
      return researchTools.slice(0, 6);
    }
    return tools.slice(0, 6);
  }

  private isRepositoryManagementTool(tool: ToolDefinition): boolean {
    const repoKeywords = [
      "repo",
      "repository",
      "branch",
      "commit",
      "pull_request",
      "pull-request",
      "pull request",
      "issue",
      "merge",
      "push",
      "fork",
      "deployment",
      "deploy",
      "release",
    ];

    const name = tool.name.toLowerCase();
    const description = (tool.description || "").toLowerCase();
    return repoKeywords.some(
      (keyword) =>
        name.includes(keyword) || description.includes(keyword.toLowerCase()),
    );
  }

  private isResearchTool(tool: ToolDefinition): boolean {
    const name = tool.name.toLowerCase();
    const description = (tool.description || "").toLowerCase();
    return (
      name.includes("search") ||
      name.includes("web") ||
      name.includes("weather") ||
      name.includes("datetime") ||
      description.includes("search") ||
      description.includes("news") ||
      description.includes("weather")
    );
  }
}


