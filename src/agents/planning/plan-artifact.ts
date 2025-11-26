/**
 * Structured plan artifact interface
 * This is the contract between the ToT Planner and the ReAct Executor
 */

/**
 * A selected tool with usage constraints
 */
export interface SelectedTool {
  /** Tool name that must match a ToolDefinition */
  name: string;
  /** Maximum number of times this tool can be called during execution */
  max_calls: number;
  /** Why this tool was selected and what it should accomplish */
  purpose: string;
}

/**
 * A step in the execution plan
 */
export interface PlanStep {
  /** Unique step identifier */
  id: number;
  /** Step type: tool call or answer formulation */
  type: "tool" | "answer";
  /** Tool name if type is "tool" */
  tool?: string;
  /** Input hint for the tool (example parameters, not strict requirements) */
  input_hint?: Record<string, any>;
  /** Instruction for answer step if type is "answer" */
  instruction?: string;
}

/**
 * Task complexity assessment
 */
export type TaskComplexity = "trivial" | "low" | "medium" | "high";

/**
 * The structured plan artifact returned by ToT planner
 * This is what gets passed to the ReAct executor
 */
export interface PlanArtifact {
  /** Assessed complexity of the task */
  complexity: TaskComplexity;
  /** Why this plan was chosen */
  rationale: string;
  /** Selected tools with their usage limits */
  selected_tools: SelectedTool[];
  /** Suggested execution steps (flexible, not rigid) */
  steps: PlanStep[];
}

/**
 * Compressed plan summary for ReAct prompt
 */
export interface PlanSummary {
  /** High-level strategy in 1-2 sentences */
  strategy: string;
  /** Simplified step list */
  steps: string[];
  /** Tool names with limits for quick reference */
  tool_limits: Record<string, number>;
}

/**
 * Helper to create a compressed summary from a plan artifact
 */
export function createPlanSummary(plan: PlanArtifact): PlanSummary {
  const toolLimits: Record<string, number> = {};
  for (const tool of plan.selected_tools) {
    toolLimits[tool.name] = tool.max_calls;
  }

  const stepDescriptions = plan.steps.map((step) => {
    if (step.type === "tool") {
      return `${step.id}) Use ${step.tool} to gather information`;
    } else {
      return `${step.id}) ${step.instruction || "Formulate answer"}`;
    }
  });

  return {
    strategy: plan.rationale,
    steps: stepDescriptions,
    tool_limits: toolLimits,
  };
}

/**
 * Bypass plan for trivial queries that don't need ToT planning
 */
export function createBypassPlan(
  toolName: string,
  purpose: string,
): PlanArtifact {
  return {
    complexity: "trivial",
    rationale: `Simple query that can be handled with ${toolName}`,
    selected_tools: [
      {
        name: toolName,
        max_calls: 1,
        purpose,
      },
    ],
    steps: [
      {
        id: 1,
        type: "tool",
        tool: toolName,
        input_hint: {},
      },
      {
        id: 2,
        type: "answer",
        instruction: "Summarize the results and answer the user",
      },
    ],
  };
}
