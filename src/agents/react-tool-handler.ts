import {
  GroundedObservation,
  ReasoningStep,
} from "../interfaces/react-types.js";
import {
  ToolChainExecutor,
  ToolExecutionResult,
} from "../tools/tool-chain/tool-chain-executor.js";
import { ToolChainConfigBuilder } from "../tools/tool-chain/tool-chain-config.js";
import { getLogger } from "../utils/shared-logger.js";
import type { Logger } from "winston";
import { IToolManager } from "../tools/mcp/interfaces/core.js";
import { ObservationParser } from "./observation-parser.js";

/**
 * Handles the execution of tools and formats their results
 * Separates tool execution logic from the main reasoning process
 */
export class ReActToolHandler {
  private readonly logger: Logger;
  private readonly VERBOSE_LOGGING =
    process.env.REACT_VERBOSE_LOGGING !== "false";
  private readonly MAX_RESULT_LENGTH = 2000;
  private readonly observationParser: ObservationParser;

  constructor(
    private readonly toolManager: IToolManager,
    private readonly toolExecutor: ToolChainExecutor,
  ) {
    this.logger = getLogger("ReActToolHandler");
    this.observationParser = new ObservationParser();
  }

  /**
   * Get the tool registry from the tool manager
   * This method handles compatibility with different tool manager implementations
   */
  public async getToolRegistry(): Promise<
    Record<string, (input: any) => Promise<any>>
  > {
    // Create a registry mapping tool names to execution functions
    const toolRegistry: Record<string, (input: any) => Promise<any>> = {};

    try {
      // Get available tools
      const tools = await this.toolManager.getAvailableTools();

      // Create execution functions for each tool
      tools.forEach((tool: any) => {
        toolRegistry[tool.name] = async (input: any) => {
          try {
            // Execute the tool directly via the tool manager
            const result = await this.toolManager.executeTool(tool.name, input);
            return result;
          } catch (error) {
            this.logger.error(`Failed to execute tool ${tool.name}`, {
              error: error instanceof Error ? error.message : String(error),
              input,
            });
            throw error;
          }
        };
      });

      return toolRegistry;
    } catch (error) {
      this.logger.error("Failed to get available tools", {
        error: error instanceof Error ? error.message : String(error),
      });
      // Return empty registry in case of error
      return toolRegistry;
    }
  }

  /**
   * Execute a tool with the registry
   */
  public async executeToolWithRegistry(
    action: ReasoningStep["action"],
    registry: Record<string, (input: any) => Promise<any>>,
    userId: string,
  ): Promise<ToolExecutionResult> {
    if (!action) {
      throw new Error("Cannot execute tool: action is undefined");
    }

    // Create tool chain config
    const chainConfig = new ToolChainConfigBuilder(`tool_exec_${Date.now()}`)
      .addTool({
        name: action.tool,
        parameters: action.params || {},
        maxRetries: 3,
        timeout: 30000,
      })
      .build();

    // Execute the tool using the existing tool executor
    return await this.toolExecutor.execute(chainConfig, registry, { userId });
  }

  /**
   * Helper method to create observation steps
   */
  public createObservationStep(
    observation: string | GroundedObservation,
  ): ReasoningStep {
    return {
      stepId: `obs_${Date.now()}`,
      observation:
        typeof observation === "string"
          ? this.observationParser.createRuntimeObservation(
              "partial",
              observation,
              this.MAX_RESULT_LENGTH,
            )
          : observation,
      isComplete: false,
      timestamp: new Date().toISOString(),
    };
  }

  public parseToolObservation(
    result: ToolExecutionResult,
    action: ReasoningStep["action"],
    maxLength: number = this.MAX_RESULT_LENGTH,
  ): GroundedObservation {
    return this.observationParser.parseToolResult(result, action, maxLength);
  }

  public parseErrorObservation(
    error: Error | undefined,
    action: ReasoningStep["action"],
    maxLength: number = this.MAX_RESULT_LENGTH,
  ): GroundedObservation {
    return this.observationParser.parseToolError(error, action, maxLength);
  }

  /**
   * Format tool execution result
   * @param result Tool execution result
   * @param action Reasoning step action
   * @param maxLength Maximum length for result formatting
   * @returns Formatted result string
   */
  public formatToolResult(
    result: ToolExecutionResult,
    action: ReasoningStep["action"],
    maxLength: number = this.MAX_RESULT_LENGTH,
  ): string {
    try {
      return this.parseToolObservation(result, action, maxLength).result;
    } catch (error) {
      this.logger.error("Error formatting tool result", {
        error: error instanceof Error ? error.message : String(error),
        action: JSON.stringify(action),
      });
      return `Error formatting tool result: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Format a string result
   */
  private formatStringResult(
    data: string,
    action: ReasoningStep["action"],
  ): string {
    if (!action) return data;

    // For search tools, apply special formatting
    if (action.tool.includes("search") || action.tool.includes("web")) {
      return this.formatSearchResult(data);
    }

    // For code, add appropriate code block formatting
    if (
      action.tool.includes("code") ||
      action.tool.includes("generate") ||
      action.tool.includes("complete")
    ) {
      return "```\n" + data + "\n```";
    }

    return data;
  }

  /**
   * Format an array result with enhanced readability
   */
  private formatArrayResult(
    data: any[],
    action: ReasoningStep["action"],
  ): string {
    void action;
    if (data.length === 0) return "Empty array []";

    // Check if array contains objects
    if (typeof data[0] === "object" && data[0] !== null) {
      // Format as a list of objects
      return data
        .map((item, index) => {
          // Format each object with indentation
          const objStr = JSON.stringify(item, null, 2)
            .split("\n")
            .map((line) => `  ${line}`)
            .join("\n");

          return `Item ${index + 1}:\n${objStr}`;
        })
        .join("\n\n");
    } else {
      // Format as a simple list
      return data
        .map((item, index) => `${index + 1}. ${JSON.stringify(item)}`)
        .join("\n");
    }
  }

  /**
   * Format an object result
   */
  private formatObjectResult(
    data: object,
    action: ReasoningStep["action"],
  ): string {
    if (!action) return JSON.stringify(data, null, 2);

    // For API responses, try to format them more readably
    if (action.tool.includes("api") || action.tool.includes("fetch")) {
      return "API Response:\n" + JSON.stringify(data, null, 2);
    }

    return JSON.stringify(data, null, 2);
  }

  /**
   * Format search results with special formatting
   */
  private formatSearchResult(data: string): string {
    // Split into results if it looks like multiple items
    if (data.includes("\n\n")) {
      const items = data.split("\n\n");
      return items
        .map((item, i) => `Search Result ${i + 1}:\n${item}`)
        .join("\n\n");
    }
    return data;
  }

  /**
   * Format error results
   */
  public formatErrorResult(
    error: Error | undefined,
    action: ReasoningStep["action"],
  ): string {
    return this.parseErrorObservation(error, action).result;
  }
}
