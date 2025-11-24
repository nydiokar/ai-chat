import { LLMProvider } from "../../interfaces/llm-provider.js";
import { ToolDefinition } from "../../tools/mcp/types/tools.js";
import { getLogger } from "../../utils/shared-logger.js";
import type { Logger } from "winston";
import yaml from "js-yaml";

/**
 * Simple Tree-of-Thought planner inspired by LightAgent
 * Does 3-stage planning and returns filtered tools
 */
export class ToTPlanner {
  private readonly logger: Logger;
  private readonly timeout: number;

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
      const result = await Promise.race([
        this.executePlanning(userQuery, allTools),
        this.createTimeout(),
      ]);

      const duration = Date.now() - startTime;
      this.logger.info("ToT planning completed", {
        duration,
        toolsFiltered: result.length,
        totalTools: allTools.length,
        efficiency: `${(((allTools.length - result.length) / allTools.length) * 100).toFixed(1)}%`,
      });

      return result;
    } catch (error) {
      this.logger.error("ToT planning failed, using all tools", {
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      return allTools; // Fallback to all tools
    }
  }

  /**
   * Execute the 3-stage planning process
   */
  private async executePlanning(
    userQuery: string,
    allTools: ToolDefinition[],
  ): Promise<ToolDefinition[]> {
    // Stage 1: Initial decomposition
    this.logger.debug("Stage 1: Problem decomposition");
    const stage1Response = await this.stage1Decompose(userQuery, allTools);

    // Stage 2: Reflection and refinement
    this.logger.debug("Stage 2: Reflection");
    const stage2Response = await this.stage2Reflect(
      userQuery,
      stage1Response,
      allTools,
    );

    // Stage 3: Tool extraction
    this.logger.debug("Stage 3: Tool filtering");
    const toolNames = await this.stage3ExtractTools(stage2Response, allTools);

    // Match tool names to actual tool definitions
    const filteredTools = this.matchTools(toolNames, allTools);

    // Sanity check: if we filtered too few or too many, use all tools
    if (filteredTools.length === 0) {
      this.logger.warn("No tools filtered, using all tools");
      return allTools;
    }

    if (filteredTools.length > allTools.length * 0.8) {
      this.logger.warn(
        "Filter ineffective (>80% tools kept), using all tools",
      );
      return allTools;
    }

    return filteredTools;
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
