import { ReActEngine } from "../../agents/react-engine.js";
import { ToolChainExecutor } from "../../tools/tool-chain/tool-chain-executor.js";
import { MockLLMProvider } from "./mocks/mock-llm-provider.js";
import { MockToolManager } from "./mocks/mock-tool-manager.js";
import { MockMemoryProvider } from "./mocks/mock-memory-provider.js";
import { MockPromptGenerator } from "./mocks/mock-prompt-generator.js";
import { EvalScenario, EvalResult } from "./eval-types.js";

/**
 * Runs a single eval scenario against the real ReActEngine with mock
 * dependencies. Returns a structured result for assertions.
 */
export async function runScenario(scenario: EvalScenario): Promise<EvalResult> {
  // Wire up mocks
  const llm = new MockLLMProvider(scenario.llmResponses);
  const toolManager = new MockToolManager();
  const memory = new MockMemoryProvider();
  const promptGenerator = new MockPromptGenerator();
  const toolExecutor = new ToolChainExecutor(); // unused — engine calls toolManager directly

  // Register tools and their behaviors
  for (const tool of scenario.tools) {
    const behaviors = scenario.toolBehaviors[tool.name] ?? [
      { success: true, data: "default mock data" },
    ];
    toolManager.registerToolWithBehavior(tool, behaviors);
  }

  // Build the real engine
  const engine = new ReActEngine(
    memory,
    llm,
    toolManager,
    toolExecutor,
    promptGenerator,
  );

  // Run
  const start = Date.now();
  const finalAnswer = await engine.process(
    scenario.userMessage,
    "eval-user",
    [],
    scenario.maxIterations ?? 8,
  );
  const durationMs = Date.now() - start;

  // Collect results
  const toolCallsByName: Record<string, number> = {};
  for (const call of toolManager.calls) {
    toolCallsByName[call.tool] = (toolCallsByName[call.tool] ?? 0) + 1;
  }

  const result: EvalResult = {
    finalAnswer,
    llmCallCount: llm.callCount,
    toolCallCount: toolManager.totalCalls,
    toolCallsByName,
    promptsSent: llm.receivedPrompts,
    scratchpadSnapshots: promptGenerator.prompts.map((p) => p.scratchpadSummary),
    toolsInPrompts: promptGenerator.prompts.map((p) =>
      p.tools.map((t) => t.name),
    ),
    durationMs,
  };

  return result;
}

/**
 * Runs a scenario and executes all assertions.
 * Throws the first assertion failure with context.
 */
export async function evaluateScenario(
  scenario: EvalScenario,
): Promise<{ result: EvalResult; passed: boolean; error?: string }> {
  const result = await runScenario(scenario);

  for (let i = 0; i < scenario.assertions.length; i++) {
    try {
      scenario.assertions[i](result);
    } catch (err) {
      return {
        result,
        passed: false,
        error: `Assertion ${i + 1} failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return { result, passed: true };
}
