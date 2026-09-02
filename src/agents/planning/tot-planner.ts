import { LLMProvider } from "../../interfaces/llm-provider.js";
import { ToolDefinition } from "../../tools/mcp/types/tools.js";
import { getLogger } from "../../utils/shared-logger.js";
import type { Logger } from "winston";
import {
  PlanArtifact,
  SelectedTool,
  PlanStep,
  TaskComplexity,
} from "./plan-artifact.js";

/**
 * Tree-of-Thought planner that returns a structured PlanArtifact
 * This enforces the contract between planner and executor
 */
export class ToTPlanner {
  private readonly logger: Logger;
  private readonly timeout: number;
  private lastPlanArtifact: PlanArtifact | null = null;

  constructor(private readonly llm: LLMProvider) {
    this.logger = getLogger("ToTPlanner");
    this.timeout = parseInt(process.env.TOT_PLANNING_TIMEOUT_MS || "5000", 10);
  }

  /**
   * Main entry point: plan and return structured PlanArtifact
   */
  async plan(
    userQuery: string,
    allTools: ToolDefinition[],
  ): Promise<PlanArtifact> {
    const startTime = Date.now();

    try {
      const artifact = await Promise.race<PlanArtifact>([
        this.executePlanning(userQuery, allTools),
        this.createTimeout(),
      ]);

      const duration = Date.now() - startTime;
      this.logger.info("ToT planning completed", {
        duration,
        complexity: artifact.complexity,
        selectedTools: artifact.selected_tools.length,
        totalTools: allTools.length,
        steps: artifact.steps.length,
      });

      this.lastPlanArtifact = artifact;
      return artifact;
    } catch (error) {
      this.logger.error("ToT planning failed, using fallback plan", {
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });

      // Return a fallback plan that allows all tools with high limits
      return this.createFallbackPlan(allTools);
    }
  }

  public getLastPlanArtifact(): PlanArtifact | null {
    return this.lastPlanArtifact;
  }

  /**
   * Execute the planning process and build PlanArtifact
   */
  private async executePlanning(
    userQuery: string,
    allTools: ToolDefinition[],
  ): Promise<PlanArtifact> {
    // Assess complexity
    const complexity = this.assessComplexity(userQuery);

    // Ask LLM to create a plan
    const planResponse = await this.requestPlan(
      userQuery,
      allTools,
      complexity,
    );

    // Parse the response into a PlanArtifact
    const artifact = this.parsePlanResponse(planResponse, allTools, complexity);

    return artifact;
  }

  /**
   * Assess task complexity based on query characteristics
   */
  private assessComplexity(query: string): TaskComplexity {
    const length = query.length;
    const hasMultipleQuestions = (query.match(/\?/g) || []).length > 1;
    const complexKeywords =
      /multi-step|pipeline|architecture|orchestrate|complex|analyze.*and/i.test(
        query,
      );

    if (length < 50 && !hasMultipleQuestions && !complexKeywords) {
      return "low";
    } else if (length > 150 || hasMultipleQuestions || complexKeywords) {
      return "high";
    } else {
      return "medium";
    }
  }

  /**
   * Request a structured plan from the LLM
   */
  private async requestPlan(
    query: string,
    tools: ToolDefinition[],
    complexity: TaskComplexity,
  ): Promise<string> {
    const toolSummary = tools
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n");

    const prompt = `You are a task planner. Create a structured plan for this query.

Query: ${query}
Assessed complexity: ${complexity}

Available tools:
${toolSummary}

Create a plan with:
1. Rationale (why this approach)
2. Selected tools with max_calls limit (how many times each tool can be called)
3. Steps to execute

Respond with JSON:
{
  "rationale": "Brief explanation of the approach",
  "selected_tools": [
    {
      "name": "tool_name",
      "max_calls": 1,
      "purpose": "What this tool accomplishes"
    }
  ],
  "steps": [
    {
      "id": 1,
      "type": "tool",
      "tool": "tool_name",
      "input_hint": {"param": "example value"}
    },
    {
      "id": 2,
      "type": "answer",
      "instruction": "Summarize results and answer user"
    }
  ]
}

Guidelines:
- For simple queries: 1-3 tools, max_calls=1-3 (allow at least one follow-up call for verification)
- For complex queries: 2-4 tools, max_calls=1-4
- Always end with a step of type "answer"
- Keep max_calls realistic to prevent spam`;

    const response = await this.llm.generateResponse(prompt);
    return response.content;
  }

  /**
   * Parse LLM response into PlanArtifact
   */
  private parsePlanResponse(
    response: string,
    allTools: ToolDefinition[],
    complexity: TaskComplexity,
  ): PlanArtifact {
    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonText = response.trim();
      const match = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        jsonText = match[1].trim();
      }

      const parsed = JSON.parse(jsonText);

      // Validate and build PlanArtifact
      const selectedTools: SelectedTool[] = [];
      if (Array.isArray(parsed.selected_tools)) {
        for (const tool of parsed.selected_tools) {
          if (tool.name && typeof tool.max_calls === "number") {
            // Verify tool exists
            const exists = allTools.some((t) => t.name === tool.name);
            if (exists) {
              const bounded = Math.max(1, Math.min(tool.max_calls, 5)); // Cap at 5
              selectedTools.push({
                name: tool.name,
                max_calls: this.adjustMaxCalls(tool.name, bounded, allTools),
                purpose: tool.purpose || "Tool usage",
              });
            } else {
              this.logger.warn(
                `Tool ${tool.name} in plan does not exist, skipping`,
              );
            }
          }
        }
      }

      // If no valid tools, use fallback
      if (selectedTools.length === 0) {
        this.logger.warn("No valid tools in plan, using fallback");
        return this.createFallbackPlan(allTools);
      }

      const steps: PlanStep[] = [];
      if (Array.isArray(parsed.steps)) {
        for (const step of parsed.steps) {
          if (step.id && step.type) {
            steps.push({
              id: step.id,
              type: step.type,
              tool: step.tool,
              input_hint: step.input_hint,
              instruction: step.instruction,
            });
          }
        }
      }

      return {
        complexity,
        rationale: parsed.rationale || "Executing plan",
        selected_tools: selectedTools,
        steps,
      };
    } catch (error) {
      this.logger.error("Failed to parse plan response, using fallback", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.createFallbackPlan(allTools);
    }
  }

  /**
   * Create a fallback plan when planning fails
   */
  private createFallbackPlan(allTools: ToolDefinition[]): PlanArtifact {
    // Select up to 3 tools, prefer search/web tools
    const searchTools = allTools.filter((t) =>
      /search|web|brave/i.test(t.name + " " + t.description),
    );
    const selectedTools = (
      searchTools.length > 0 ? searchTools : allTools
    ).slice(0, 3);

    return {
      complexity: "medium",
      rationale:
        "Fallback plan: allowing multiple tools with reasonable limits",
      selected_tools: selectedTools.map((tool) => ({
        name: tool.name,
        max_calls: tool.name.toLowerCase().includes("search") ? 3 : 2,
        purpose: "General purpose tool",
      })),
      steps: [
        {
          id: 1,
          type: "tool",
          tool: selectedTools[0]?.name || "unknown",
        },
        {
          id: 2,
          type: "answer",
          instruction: "Summarize results and answer user",
        },
      ],
    };
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

  /**
   * Ensure research/web tools get at least 2 calls when reasonable
   */
  private adjustMaxCalls(
    toolName: string,
    proposed: number,
    allTools: ToolDefinition[],
  ): number {
    const lower = toolName.toLowerCase();
    const description = (
      allTools.find((t) => t.name === toolName)?.description || ""
    ).toLowerCase();
    const isSearch =
      lower.includes("search") ||
      lower.includes("web") ||
      description.includes("search");
    if (isSearch) {
      return Math.max(proposed, 2); // allow at least 2 uses for research
    }
    return proposed;
  }
}
