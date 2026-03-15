import { LLMProvider } from "../interfaces/llm-provider.js";
import { MemoryProvider, MemoryType } from "../interfaces/memory-provider.js";
import { IToolManager } from "../tools/mcp/interfaces/core.js";
import {
  AgentDecision,
  GroundedObservation,
  ReasoningStep,
} from "../interfaces/react-types.js";
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
import { ToTPlanner } from "./planning/tot-planner.js";
import { PlanArtifact, createPlanSummary } from "./planning/plan-artifact.js";

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
  private readonly MAX_STEPS = Number(process.env.REACT_MAX_STEPS) || 8;
  private readonly logger: Logger;
  private readonly VERBOSE_LOGGING =
    process.env.REACT_VERBOSE_LOGGING !== "false";
  private readonly stepParser: ReActStepParser;
  private readonly toolHandler: ReActToolHandler;
  private currentUserMessage: string | null = null;
  private currentPlan: PlanArtifact | null = null;
  private toolUsageCounts: Map<string, number> = new Map();

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
    this.currentPlan = null;
    this.toolUsageCounts.clear();

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

    // NEW: Tree-of-Thought Pre-Planning with PlanArtifact
    let toolsToUse: ToolDefinition[] = tools.availableTools;

    if (this.shouldUseTotPlanning()) {
      try {
        this.logger.info("Executing ToT planning");
        this.currentPlan = await this.totPlanner!.plan(
          userMessage,
          tools.availableTools,
        );

        // Extract only selected tools from the plan
        const selectedToolNames = this.currentPlan.selected_tools.map(
          (t) => t.name,
        );
        toolsToUse = tools.availableTools.filter((t) =>
          selectedToolNames.includes(t.name),
        );

        // Log the full plan for debugging
        this.logger.info("ToT Plan Created", {
          complexity: this.currentPlan.complexity,
          rationale: this.currentPlan.rationale,
          selectedTools: this.currentPlan.selected_tools.map(
            (t) => `${t.name} (max: ${t.max_calls}, purpose: ${t.purpose})`,
          ),
          steps: this.currentPlan.steps.map(
            (s) =>
              `${s.id}. ${s.type === "tool" ? `Use ${s.tool}` : s.instruction}`,
          ),
        });
      } catch (error) {
        this.logger.error("ToT planning error, falling back to all tools", {
          error: error instanceof Error ? error.message : String(error),
        });
        toolsToUse = tools.availableTools; // Fallback
        this.currentPlan = null;
      }
    } else {
      this.currentPlan = null;
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
      const prompt = await this.generateContextualPrompt(
        userMessage,
        optimizedSteps,
        toolsToUse, // Use filtered tools instead of all tools
        iterationCount,
      );

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
        if (!nextStep) {
          this.logger.warn(
            "Failed to parse LLM response, injecting format reminder",
          );

          // Add a strict reminder about YAML format
          const formatReminder = this.toolHandler.createObservationStep(
            "ERROR: Your response was not in the correct YAML format. You MUST respond using this exact structure:\n\n" +
              "```yaml\n" +
              "thought:\n" +
              '  reasoning: "Your analysis here"\n' +
              '  plan: "Your plan here"\n\n' +
              "# Choose ONE:\n" +
              "action:\n" +
              '  tool: "tool_name"\n' +
              "  params:\n" +
              "    param1: value1\n\n" +
              "# OR:\n" +
              "conclusion:\n" +
              '  final_answer: "Your complete answer with details"\n\n' +
              "# OR:\n" +
              "ask_user:\n" +
              '  question: "The focused clarification you need from the user"\n' +
              '  reason: "Why you need it"\n\n' +
              "# OR:\n" +
              "recover:\n" +
              '  strategy: "Your revised strategy"\n' +
              '  reason: "Why the previous approach should change"\n' +
              "```\n\n" +
              "Try again with proper YAML formatting.",
          );
          await trace.addStep(formatReminder);
          continue;
        }

        // Add step to the trace
        await trace.addStep(nextStep);

        // Log the step for debugging
        this.logVerbose("debug", `Added step: ${nextStep.stepId}`, {
          step: this.formatForDisplay(nextStep),
        });

        const decision = this.stepParser.interpretDecision(nextStep);
        if (!decision) {
          const invalidDecision = this.toolHandler.createObservationStep(
            "Invalid step: you must produce exactly one runtime decision: action, conclusion, or ask_user.",
          );
          await trace.addStep(invalidDecision);
          continue;
        }

        // Guard: if action is present but no tool specified, force clarification
        if (nextStep.action && !nextStep.action.tool) {
          const invalidAction = this.toolHandler.createObservationStep(
            "Invalid action: you must either call one of the available tools using 'action.tool' or provide a 'conclusion' grounded in the observations. Summaries/analysis without a tool should be expressed as a 'conclusion'.",
          );
          await trace.addStep(invalidAction);
          continue;
        }

        const decisionHandled = await this.handleDecision(
          decision,
          trace,
        );
        if (
          decisionHandled.type === "finish" ||
          decisionHandled.type === "ask_user"
        ) {
          break;
        }

        if (decisionHandled.type === "recover") {
          continue;
        }

        if (nextStep.action?.tool) {
          const requestedTool = nextStep.action.tool;

          // Validate tool is in allowed list (respects ToT filtering)
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

          // NEW: Enforce max_calls from plan
          if (this.currentPlan) {
            const currentUsage = this.toolUsageCounts.get(requestedTool) || 0;
            const toolLimit = this.currentPlan.selected_tools.find(
              (t) => t.name === requestedTool,
            );
            const maxCalls = toolLimit?.max_calls || 999;

            if (currentUsage >= maxCalls) {
              this.logger.warn(
                `Tool '${requestedTool}' has reached max_calls limit (${maxCalls}). Forcing conclusion.`,
                {
                  requestedTool,
                  currentUsage,
                  maxCalls,
                },
              );

              // Force LLM to conclude with what it has
              const limitObservation = this.toolHandler.createObservationStep(
                `You have already used ${requestedTool} ${currentUsage} times (limit: ${maxCalls}). You must now provide a final answer based on the information you've gathered.`,
              );
              await trace.addStep(limitObservation);
              continue; // Skip to next iteration, LLM should conclude
            }

            // Increment usage count
            this.toolUsageCounts.set(requestedTool, currentUsage + 1);
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
        trace.markComplete(fallbackResponse, {
          type: "safety_stop",
          reason: "maximum_iterations_reached",
        });
      }
    }

    // Return the final response
    const finalResponse = trace.getFinalResponse();
    this.currentUserMessage = null;
    this.currentPlan = null;
    this.toolUsageCounts.clear();
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
      .map((step) => step.observation!);

    const lastThought = steps[steps.length - 1]?.thought?.reasoning || "";
    const observationText = observations
      .slice(-2)
      .map((observation) => this.renderObservationForFallback(observation))
      .join("\n\n");

    // Create a reasonable fallback response
    return `I've been working on your request, but need more information. Based on what I've found so far:\n\n${observationText}\n\nMy current thinking is: ${lastThought}\n\nCould you provide more details or clarify your request?`;
  }

  private async handleDecision(
    decision: AgentDecision,
    trace: ReActTrace,
  ): Promise<AgentDecision> {
    if (decision.type === "finish") {
      trace.markComplete(decision.answer, {
        type: "finish",
        explanation: decision.explanation,
        stepId: decision.stepId,
      });
      this.logVerbose("info", "Reasoning complete with explicit finish");
      return decision;
    }

    if (decision.type === "ask_user") {
      trace.markComplete(decision.question, {
        type: "ask_user",
        question: decision.question,
        reason: decision.reason,
        stepId: decision.stepId,
      });
      this.logVerbose("info", "Reasoning complete with clarification request");
      return decision;
    }

    if (decision.type === "recover") {
      const recoveryObservation = this.toolHandler.createObservationStep(
        `Recovery requested.\nStrategy: ${decision.strategy}\nReason: ${decision.reason}\nNext step: revise your next action or conclude if you already have enough evidence.`,
      );
      await trace.addStep(recoveryObservation);
      this.logVerbose("info", "Recovery branch requested by model", {
        strategy: decision.strategy,
      });
      return decision;
    }

    return decision;
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
          content.length > maxLen
            ? content.substring(0, maxLen) + "…"
            : content;
        const divider = "-".repeat(60);
        this.logger.debug(
          [divider, "LLM RAW RESPONSE", divider, preview, divider].join("\n"),
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

      const groundedObservation = this.toolHandler.parseToolObservation(
        result,
        action,
      );
      const observationStep =
        this.toolHandler.createObservationStep(groundedObservation);

      // Add the observation to the trace
      await trace.addStep(observationStep);

      this.logVerbose("debug", `Added observation: ${observationStep.stepId}`, {
        observation: groundedObservation.summary,
        kind: groundedObservation.kind,
        sources: groundedObservation.sourceRefs,
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
        // Follow-up prompt generation is disabled to preserve consistent schema across turns.
      }
    } catch (error) {
      this.logger.error(`Error executing tool: ${tool}`, {
        error: String(error),
        params: JSON.stringify(params || {}),
      });

      // Create an error observation with formatted error message from the tool handler
      const errorObservation = this.toolHandler.parseErrorObservation(
        error instanceof Error ? error : new Error(String(error)),
        action,
      );
      const failureGuidance = this.buildToolFailureGuidance(
        tool,
        params || {},
        this.currentUserMessage,
      );
      if (failureGuidance) {
        errorObservation.result = `${errorObservation.result}\n\n${failureGuidance}`;
        errorObservation.summary = `${errorObservation.summary} Guidance: ${failureGuidance}`;
      }
      const observationStep = this.toolHandler.createObservationStep(
        errorObservation,
      );

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
        // Follow-up prompt generation is disabled to preserve consistent schema across turns.
      }
    }
  }

  private renderObservationForFallback(
    observation: GroundedObservation,
  ): string {
    const lines = [observation.summary];

    if (observation.sourceRefs && observation.sourceRefs.length > 0) {
      lines.push(`Sources: ${observation.sourceRefs.join(", ")}`);
    }

    if (observation.kind === "error" && observation.error?.message) {
      lines.push(`Error: ${observation.error.message}`);
    }

    return lines.join("\n");
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
      const budgetSummary = this.formatToolBudgets(tools);
      const augmentedInputSections: string[] = [];

      if (planSummary) {
        augmentedInputSections.push("Tree-of-Thought Plan:\n" + planSummary);
      }
      if (budgetSummary) {
        augmentedInputSections.push("Tool budgets:\n" + budgetSummary);
      }
      augmentedInputSections.push("User request: " + userMessage);

      const augmentedInput = augmentedInputSections.join("\n\n");

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
        const divider = "-".repeat(60);
        this.logger.debug(
          [divider, "CONTEXTUAL PROMPT", divider, promptPreview, divider].join(
            "\n",
          ),
        );
      }

      return prompt;
    } catch (error) {
      this.logger.error("Error generating contextual prompt", {
        error: String(error),
      });

      const fallbackPlan = this.formatTotPlanSummary();
      const fallbackHeader = fallbackPlan
        ? `Tree-of-Thought Plan:\n${fallbackPlan}\n\n`
        : "";

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
    if (!this.currentPlan) return null;

    const summary = createPlanSummary(this.currentPlan);

    const sections: string[] = [];

    // Add strategy/rationale
    sections.push(`Strategy: ${summary.strategy}`);

    // Add steps
    if (summary.steps.length > 0) {
      sections.push(`Steps:\n${summary.steps.join("\n")}`);
    }

    // Add tool limits
    const limitLines = Object.entries(summary.tool_limits)
      .map(([tool, limit]) => `- ${tool}: max ${limit} calls`)
      .join("\n");
    if (limitLines) {
      sections.push(`Tool limits:\n${limitLines}`);
    }

    return sections.join("\n\n");
  }

  /**
   * Render tool budgets with remaining calls to remind the model of limits
   */
  private formatToolBudgets(toolsInPrompt: ToolDefinition[]): string | null {
    if (!this.currentPlan) return null;

    const budgetLines: string[] = [];
    for (const tool of this.currentPlan.selected_tools) {
      // Only include tools that are currently offered in the prompt
      if (!toolsInPrompt.some((t) => t.name === tool.name)) continue;
      const used = this.toolUsageCounts.get(tool.name) || 0;
      budgetLines.push(
        `- ${tool.name}: ${used}/${tool.max_calls} calls used (purpose: ${tool.purpose})`,
      );
    }

    return budgetLines.length > 0 ? budgetLines.join("\n") : null;
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

    if (
      isRepoTool &&
      userMessage &&
      !/repo|branch|git|pull|issue/i.test(userMessage)
    ) {
      return `Guidance: ${toolName} is for repository management, but the user request (â€œ${userMessage}â€) did not ask for repository changes. Focus on research/search tools instead.`;
    }

    if (
      lowerTool.includes("github") &&
      params &&
      Object.keys(params).length > 0
    ) {
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
    const mentionsRepoWork =
      /github|repo|repository|branch|commit|pull\s?-?\s?request|issue\b|merge|pull\s?req|git\b|pr\b/.test(
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
