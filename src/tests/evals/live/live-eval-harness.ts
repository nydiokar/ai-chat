import { OpenAIProvider } from "../../../providers/openai.js";
import { ReActEngine } from "../../../agents/react-engine.js";
import { ReActPromptGenerator } from "../../../prompt/react-prompt-generator.js";
import { PromptRepository } from "../../../services/prompt/prompt-repository.js";
import { ToolChainExecutor } from "../../../tools/tool-chain/tool-chain-executor.js";
import { IToolManager } from "../../../tools/mcp/interfaces/core.js";
import {
  ToolDefinition,
  ToolResponse,
  ToolHandler,
} from "../../../tools/mcp/types/tools.js";
import { MockMemoryProvider } from "../mocks/mock-memory-provider.js";
import { defaultConfig } from "../../../utils/config.js";

// ---------------------------------------------------------------------------
// Live tool manager — real execution, pluggable handlers
// ---------------------------------------------------------------------------

export class LiveToolManager implements IToolManager {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly handlers = new Map<string, ToolHandler>();
  private readonly callLog: Array<{ tool: string; args: any; result: any }> = [];

  register(def: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(def.name, def);
    this.handlers.set(def.name, handler);
  }

  registerTool(name: string, handler: ToolHandler): void {
    this.handlers.set(name, handler);
  }

  async getAvailableTools(): Promise<ToolDefinition[]> {
    return Array.from(this.tools.values());
  }

  async getToolByName(name: string): Promise<ToolDefinition | undefined> {
    return this.tools.get(name);
  }

  async executeTool(name: string, args: any): Promise<ToolResponse> {
    const handler = this.handlers.get(name);
    if (!handler) {
      const resp: ToolResponse = { success: false, data: null, error: `Tool "${name}" not found` };
      this.callLog.push({ tool: name, args, result: resp });
      return resp;
    }
    try {
      const result = await handler(args);
      const resp: ToolResponse =
        result && typeof result === "object" && "success" in result
          ? result
          : { success: true, data: result };
      this.callLog.push({ tool: name, args, result: resp });
      return resp;
    } catch (err) {
      this.callLog.push({ tool: name, args, result: { error: String(err) } });
      throw err;
    }
  }

  async refreshToolInformation(): Promise<void> {}

  get calls() { return this.callLog; }
}

// ---------------------------------------------------------------------------
// Live scenario types
// ---------------------------------------------------------------------------

export interface LiveScenario {
  name: string;
  description: string;
  userMessage: string;
  maxIterations?: number;
  /** Register tools on the tool manager */
  setupTools: (tm: LiveToolManager) => void;
  /** Grade the final answer. Deterministic — no LLM-as-judge. */
  grade: (answer: string, meta: LiveResult) => { pass: boolean; reason: string };
}

export interface LiveResult {
  finalAnswer: string;
  durationMs: number;
  llmModel: string;
  toolCalls: Array<{ tool: string; args: any; result: any }>;
  toolCallCount: number;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runLiveScenario(
  scenario: LiveScenario,
): Promise<{ result: LiveResult; pass: boolean; reason: string }> {
  const config = { ...defaultConfig };
  config.openai.model = process.env.EVAL_MODEL || config.openai.model;
  config.openai.temperature = 0;

  const provider = new OpenAIProvider(config);
  const memory = new MockMemoryProvider();
  const toolManager = new LiveToolManager();
  const toolExecutor = new ToolChainExecutor();

  scenario.setupTools(toolManager);

  const promptRepository = new PromptRepository();
  const promptGenerator = new ReActPromptGenerator(toolManager, promptRepository);

  const engine = new ReActEngine(
    memory,
    provider,
    toolManager,
    toolExecutor,
    promptGenerator,
  );

  const start = Date.now();
  const finalAnswer = await engine.process(
    scenario.userMessage,
    "eval-user",
    [],
    scenario.maxIterations ?? 6,
  );
  const durationMs = Date.now() - start;

  const result: LiveResult = {
    finalAnswer,
    durationMs,
    llmModel: config.openai.model,
    toolCalls: [...toolManager.calls],
    toolCallCount: toolManager.calls.length,
  };

  const { pass, reason } = scenario.grade(finalAnswer, result);
  return { result, pass, reason };
}
