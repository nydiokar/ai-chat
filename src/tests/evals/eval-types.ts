import { ToolBehavior } from "./mocks/mock-tool-manager.js";
import { ToolDefinition } from "../../tools/mcp/types/tools.js";

/**
 * A single eval scenario that exercises the full ReAct engine loop.
 *
 * Scenarios are deterministic: the LLM is replaced by scripted YAML
 * responses and tools are replaced by scripted behaviors.  Assertions
 * run against the *runtime state* — trace, scratchpad, recovery events,
 * prompt contents — not just the final answer string.
 */
export interface EvalScenario {
  /** Human-readable name shown in test output */
  name: string;

  /** What capability this scenario validates */
  description: string;

  /** The user message that enters engine.process() */
  userMessage: string;

  /** Ordered list of raw LLM responses (YAML in code blocks) */
  llmResponses: string[];

  /** Tool definitions available to the agent in this scenario */
  tools: ToolDefinition[];

  /** Per-tool behavior sequences (keyed by tool name) */
  toolBehaviors: Record<string, ToolBehavior[]>;

  /** Max iterations override (default: 8) */
  maxIterations?: number;

  /**
   * Assertions that run after engine.process() completes.
   * Each function receives the EvalResult and throws on failure.
   */
  assertions: EvalAssertion[];

  /** Tags for filtering scenario suites (e.g. "recovery", "happy-path") */
  tags?: string[];
}

export interface EvalResult {
  /** The string returned by engine.process() */
  finalAnswer: string;

  /** How many times the mock LLM was called */
  llmCallCount: number;

  /** How many tool calls were made in total */
  toolCallCount: number;

  /** Tool calls broken down by name */
  toolCallsByName: Record<string, number>;

  /** All prompts that were sent to the LLM */
  promptsSent: readonly string[];

  /** All scratchpad summaries injected into prompts, in order */
  scratchpadSnapshots: (string | undefined)[];

  /** Tools listed in each prompt, in order */
  toolsInPrompts: string[][];

  /** Wall-clock duration of engine.process() in ms */
  durationMs: number;
}

export type EvalAssertion = (result: EvalResult) => void;

// ---- Helpers for building YAML responses ----

export function yamlAction(
  reasoning: string,
  plan: string,
  tool: string,
  params: Record<string, unknown>,
  purpose?: string,
): string {
  const purposeLine = purpose ? `\n  purpose: "${purpose}"` : "";
  const paramLines = Object.entries(params)
    .map(([k, v]) => `    ${k}: ${typeof v === "string" ? `"${v}"` : v}`)
    .join("\n");

  return [
    "```yaml",
    "thought:",
    `  reasoning: "${reasoning}"`,
    `  plan: "${plan}"`,
    "action:",
    `  tool: "${tool}"${purposeLine}`,
    "  params:",
    paramLines,
    "```",
  ].join("\n");
}

export function yamlConclusion(
  reasoning: string,
  plan: string,
  answer: string,
  explanation?: string,
): string {
  const explLine = explanation
    ? `\n  explanation: "${explanation}"`
    : "";

  return [
    "```yaml",
    "thought:",
    `  reasoning: "${reasoning}"`,
    `  plan: "${plan}"`,
    "conclusion:",
    `  final_answer: "${answer}"${explLine}`,
    "```",
  ].join("\n");
}

export function yamlAskUser(
  reasoning: string,
  plan: string,
  question: string,
  reason: string,
): string {
  return [
    "```yaml",
    "thought:",
    `  reasoning: "${reasoning}"`,
    `  plan: "${plan}"`,
    "ask_user:",
    `  question: "${question}"`,
    `  reason: "${reason}"`,
    "```",
  ].join("\n");
}

export function yamlRecover(
  reasoning: string,
  plan: string,
  strategy: string,
  reason: string,
): string {
  return [
    "```yaml",
    "thought:",
    `  reasoning: "${reasoning}"`,
    `  plan: "${plan}"`,
    "recover:",
    `  strategy: "${strategy}"`,
    `  reason: "${reason}"`,
    "```",
  ].join("\n");
}

// ---- Common tool definitions ----

export const TOOL_WEB_SEARCH: ToolDefinition = {
  name: "web_search",
  description: "Search the web for information",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
    },
    required: ["query"],
  },
};

export const TOOL_WEATHER: ToolDefinition = {
  name: "weather_lookup",
  description: "Get current weather for a city",
  inputSchema: {
    type: "object",
    properties: {
      city: { type: "string", description: "City name" },
    },
    required: ["city"],
  },
};

export const TOOL_DATETIME: ToolDefinition = {
  name: "datetime",
  description: "Get the current date and time",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
};

export const TOOL_CODE_SEARCH: ToolDefinition = {
  name: "code_search",
  description: "Search code repositories for patterns",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Code pattern to search" },
      language: { type: "string", description: "Programming language" },
    },
    required: ["query"],
  },
};
