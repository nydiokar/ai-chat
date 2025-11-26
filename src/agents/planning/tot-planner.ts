import { LLMProvider } from "../../interfaces/llm-provider.js";
import { ToolDefinition } from "../../tools/mcp/types/tools.js";
import { getLogger } from "../../utils/shared-logger.js";
import type { Logger } from "winston";
import yaml from "js-yaml";


/**
 * Simple Tree-of-Thought planner inspired by LightAgent
 * Does 3-stage planning and returns filtered tools
 */
export interface ToTPlanContext {
  decomposition?: Array<{ step: string; tools?: string[] }>;
  strategy?: string;
  refinedSteps?: string[];
  refinedTools?: string[];
}

interface ToTPlanningOutcome {
  tools: ToolDefinition[];
  plan: ToTPlanContext | null;
}

export class ToTPlanner {
  private readonly logger: Logger;
  private readonly timeout: number;
  private lastPlan: ToTPlanContext | null = null;

  constructor(private readonly llm: LLMProvider) {
    this.logger = getLogger("ToTPlanner");
    this.timeout = parseInt(process.env.TOT_PLANNING_TIMEOUT_MS || "5000", 10);
  }

  /**
   * Main entry point: plan and filter tools
   * Returns filtered tools or all tools if planning fails
   */
  async planAndFilter(
    userQuery: string,
    allTools: ToolDefinition[],
  ): Promise<ToolDefinition[]> {
    const startTime = Date.now();

    try {
      // Execute with timeout
      const result = await Promise.race<ToTPlanningOutcome>([
        this.executePlanning(userQuery, allTools),
        this.createTimeout(),
      ]);

      const duration = Date.now() - startTime;
      this.logger.info("ToT planning completed", {
        duration,
        toolsFiltered: result.tools.length,
        totalTools: allTools.length,
        efficiency: `${(((allTools.length - result.tools.length) / allTools.length) * 100).toFixed(1)}%`,
      });

      this.lastPlan = this.hasPlanContent(result.plan) ? result.plan : null;
      return result.tools;
    } catch (error) {
      this.logger.error("ToT planning failed, using all tools", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        duration: Date.now() - startTime,
      });
      this.lastPlan = null;
      return allTools; // Fallback to all tools
    }
  }

  public getLastPlan(): ToTPlanContext | null {
    return this.lastPlan;
  }

  /**
   * Execute the 3-stage planning process
   */
  private async executePlanning(
    userQuery: string,
    allTools: ToolDefinition[],
  ): Promise<ToTPlanningOutcome> {
    // Stage 1: Initial decomposition
    this.logger.debug("Stage 1: Problem decomposition");
    const stage1Response = await this.stage1Decompose(userQuery, allTools);
    const planContext: ToTPlanContext = this.parseDecomposition(stage1Response);

    // Stage 2: Reflection and refinement
    this.logger.debug("Stage 2: Reflection");
    const stage2Response = await this.stage2Reflect(
      userQuery,
      stage1Response,
      allTools,
    );
    const refinedUpdates = this.parseRefinedPlan(stage2Response);
    Object.assign(planContext, refinedUpdates);

    // Stage 3: Tool extraction
    this.logger.debug("Stage 3: Tool filtering");
    const toolNames = await this.stage3ExtractTools(stage2Response, allTools);

    // Match tool names to actual tool definitions
    const filteredTools = this.matchTools(toolNames, allTools);

    // Sanity check: if we filtered too few or too many, use all tools
    if (filteredTools.length === 0) {
      this.logger.warn("No tools filtered, using all tools");
      return { tools: allTools, plan: planContext };
    }

    if (filteredTools.length > allTools.length * 0.8) {
      this.logger.warn("Filter ineffective (>80% tools kept), using all tools");
      return { tools: allTools, plan: planContext };
    }

    return { tools: filteredTools, plan: planContext };
  }

  /**
   * Stage 1: Decompose the problem
   */
  private async stage1Decompose(
    query: string,
    tools: ToolDefinition[],
  ): Promise<string> {
    const toolSummary = tools
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n");

    const prompt = `Analyze this query and break it into sub-problems.

Query: ${query}

Available tools:
${toolSummary}

Respond with YAML:
\`\`\`yaml
decomposition:
  - step: "What to do first"
    tools: ["tool_name"]
  - step: "What to do next"
    tools: ["tool_name"]
strategy: "Overall approach"
\`\`\``;

    const response = await this.llm.generateResponse(prompt);
    return response.content;
  }

  /**
   * Stage 2: Reflect and refine
   */
  private async stage2Reflect(
    query: string,
    stage1Output: string,
    tools: ToolDefinition[],
  ): Promise<string> {
    const toolNames = tools.map((t) => t.name).join(", ");

    const prompt = `Review and refine this plan. Ensure all tools mentioned actually exist.

Query: ${query}

Initial plan:
${stage1Output}

Available tools: ${toolNames}

Provide refined YAML:
\`\`\`yaml
refined_plan:
  steps:
    - "Step 1"
    - "Step 2"
  tools_needed: ["tool1", "tool2"]
\`\`\``;

    const response = await this.llm.generateResponse(prompt);
    return response.content;
  }

  /**
   * Stage 3: Extract tool names as JSON
   */
  private async stage3ExtractTools(
    stage2Output: string,
    tools: ToolDefinition[],
  ): Promise<string[]> {
    const toolNames = tools.map((t) => t.name).join(", ");

    const prompt = `Extract the exact tools needed from this plan.

Plan:
${stage2Output}

Available tools: ${toolNames}

Respond with JSON only (no markdown):
{"tools": ["tool1", "tool2"]}`;

    const response = await this.llm.generateResponse(prompt);

    try {
      // Parse JSON (handle markdown code blocks)
      let jsonText = response.content.trim();
      const match = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        jsonText = match[1].trim();
      }

      const parsed = JSON.parse(jsonText);
      return Array.isArray(parsed.tools)
        ? parsed.tools.map((t: any) => String(t).trim())
        : [];
    } catch (error) {
      this.logger.error("Failed to parse tool list", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Match tool names to actual ToolDefinition objects
   */
  private matchTools(
    toolNames: string[],
    allTools: ToolDefinition[],
  ): ToolDefinition[] {
    const toolMap = new Map<string, ToolDefinition>();
    allTools.forEach((tool) => {
      toolMap.set(tool.name.toLowerCase(), tool);
    });

    const matched: ToolDefinition[] = [];
    const notFound: string[] = [];

    for (const name of toolNames) {
      const normalized = name.toLowerCase();
      const tool = toolMap.get(normalized);
      if (tool) {
        matched.push(tool);
      } else {
        notFound.push(name);
      }
    }

    if (notFound.length > 0) {
      this.logger.warn("Some tools not found (hallucinated)", { notFound });
    }

    return matched;
  }

  private safeParseYaml<T>(raw: string): T | null {
    if (!raw) return null;
    let text = raw.trim();
    const match = text.match(/```(?:yaml)?\s*([\s\S]*?)```/i);
    if (match) {
      text = match[1].trim();
    }

    try {
      const parsed = yaml.load(text);
      return (parsed ?? null) as T | null;
    } catch (error) {
      this.logger.warn("Failed to parse YAML during planning", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private parseDecomposition(response: string): ToTPlanContext {
    const plan: ToTPlanContext = {};
    const parsed = this.safeParseYaml<any>(response);
    if (!parsed || typeof parsed !== "object") {
      return plan;
    }

    if (Array.isArray((parsed as any).decomposition)) {
      plan.decomposition = (parsed as any).decomposition
        .map((item: any) => ({
          step: typeof item?.step === "string" ? item.step : "",
          tools: Array.isArray(item?.tools)
            ? item.tools.map((t: any) => String(t)).filter(Boolean)
            : undefined,
        }))
        .filter((item: any) => item.step);
    }

    if (parsed && typeof (parsed as any).strategy === "string") {
      plan.strategy = (parsed as any).strategy;
    }

    return plan;
  }

  private parseRefinedPlan(response: string): Partial<ToTPlanContext> {
    const parsed = this.safeParseYaml<any>(response);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const result: Partial<ToTPlanContext> = {};
    const refined = (parsed as any).refined_plan;
    if (refined) {
      if (Array.isArray(refined.steps)) {
        result.refinedSteps = refined.steps
          .map((step: any) => String(step))
          .filter((step: string) => !!step);
      }

      if (Array.isArray(refined.tools_needed)) {
        result.refinedTools = refined.tools_needed
          .map((tool: any) => String(tool))
          .filter((tool: string) => !!tool);
      }
    }

    return result;
  }

  private hasPlanContent(plan: ToTPlanContext | null): boolean {
    if (!plan) return false;
    return Boolean(
      (plan.decomposition && plan.decomposition.length > 0) ||
        plan.strategy ||
        (plan.refinedSteps && plan.refinedSteps.length > 0) ||
        (plan.refinedTools && plan.refinedTools.length > 0),
    );
  }

  /**
   * Create timeout promise
   */
  private createTimeout(): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Planning timeout after ${this.timeout}ms`));
      }, this.timeout);
    });
  }
}
