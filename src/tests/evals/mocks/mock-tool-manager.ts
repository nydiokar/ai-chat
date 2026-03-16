import { IToolManager } from "../../../tools/mcp/interfaces/core.js";
import {
  ToolDefinition,
  ToolResponse,
  ToolHandler,
} from "../../../tools/mcp/types/tools.js";

export interface ToolBehavior {
  success: boolean;
  data?: any;
  error?: string;
  /** Delay in ms to simulate latency (default: 0) */
  delay?: number;
}

/**
 * A scriptable tool manager for eval scenarios.
 *
 * Register tools with their definitions and a sequence of behaviors.
 * Each call to executeTool pops the next behavior for that tool.
 * If behaviors are exhausted, the last one is reused (sticky last).
 */
export class MockToolManager implements IToolManager {
  private readonly tools: Map<string, ToolDefinition> = new Map();
  private readonly behaviors: Map<string, ToolBehavior[]> = new Map();
  private readonly callLog: Array<{ tool: string; args: any; response: ToolResponse }> = [];

  registerToolWithBehavior(
    definition: ToolDefinition,
    behaviors: ToolBehavior[],
  ): void {
    this.tools.set(definition.name, definition);
    this.behaviors.set(definition.name, [...behaviors]);
  }

  // --- IToolManager implementation ---

  registerTool(_name: string, _handler: ToolHandler): void {}

  async getAvailableTools(): Promise<ToolDefinition[]> {
    return Array.from(this.tools.values());
  }

  async getToolByName(name: string): Promise<ToolDefinition | undefined> {
    return this.tools.get(name);
  }

  async executeTool(name: string, args: any): Promise<ToolResponse> {
    const queue = this.behaviors.get(name);
    if (!queue || queue.length === 0) {
      const response: ToolResponse = {
        success: false,
        data: null,
        error: `Tool "${name}" has no configured behavior in this eval scenario.`,
      };
      this.callLog.push({ tool: name, args, response });
      return response;
    }

    // Pop the next behavior; if only one left, keep it (sticky last)
    const behavior = queue.length > 1 ? queue.shift()! : queue[0];

    if (behavior.delay) {
      await new Promise((r) => setTimeout(r, behavior.delay));
    }

    if (!behavior.success) {
      const error = behavior.error ?? "Tool execution failed";
      // Throw like the real tool manager does on failure
      this.callLog.push({
        tool: name,
        args,
        response: { success: false, data: null, error },
      });
      throw new Error(error);
    }

    const response: ToolResponse = {
      success: true,
      data: behavior.data ?? null,
      metadata: { executionTime: behavior.delay ?? 5, toolName: name },
    };
    this.callLog.push({ tool: name, args, response });
    return response;
  }

  async refreshToolInformation(): Promise<void> {}

  // --- Inspection helpers ---

  get calls(): ReadonlyArray<{ tool: string; args: any; response: ToolResponse }> {
    return this.callLog;
  }

  callsTo(toolName: string): ReadonlyArray<{ args: any; response: ToolResponse }> {
    return this.callLog
      .filter((c) => c.tool === toolName)
      .map(({ args, response }) => ({ args, response }));
  }

  get totalCalls(): number {
    return this.callLog.length;
  }
}
