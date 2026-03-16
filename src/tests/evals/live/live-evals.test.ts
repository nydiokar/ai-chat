import { describe, it, before } from "mocha";
import { expect } from "chai";
import { runLiveScenario } from "./live-eval-harness.js";
import { ALL_LIVE_SCENARIOS } from "./live-scenarios.js";

/**
 * LIVE AGENT EVALS
 *
 * These tests call a REAL LLM (OpenAI) with REAL tools.
 * They cost tokens. They are slow. They are the real test.
 *
 * Run with:
 *   npm run test:evals:live
 *
 * Set EVAL_MODEL to override the model:
 *   EVAL_MODEL=gpt-4o-mini npm run test:evals:live
 *
 * Each scenario:
 *   1. Builds a real ReActEngine with a real OpenAI provider
 *   2. Gives it real tools (datetime, calculator)
 *   3. Sends a real question
 *   4. Grades the answer programmatically (no human, no LLM-as-judge)
 *   5. Pass or fail — did the agent get the right answer?
 */

describe("Live Agent Evals", function () {
  // These call real APIs — need generous timeout
  this.timeout(120_000);

  before(function () {
    if (!process.env.OPENAI_API_KEY) {
      console.log(
        "\n  *** OPENAI_API_KEY not set — skipping live evals ***\n",
      );
      this.skip();
    }
  });

  // Track results for summary
  const results: Array<{
    name: string;
    pass: boolean;
    reason: string;
    durationMs: number;
    toolCalls: number;
    model: string;
  }> = [];

  for (const scenario of ALL_LIVE_SCENARIOS) {
    it(scenario.name, async function () {
      const { result, pass, reason } = await runLiveScenario(scenario);

      results.push({
        name: scenario.name,
        pass,
        reason,
        durationMs: result.durationMs,
        toolCalls: result.toolCallCount,
        model: result.llmModel,
      });

      if (!pass) {
        console.log("\n--- LIVE EVAL FAILURE ---");
        console.log(`Scenario: ${scenario.name}`);
        console.log(`Reason: ${reason}`);
        console.log(`Answer: ${result.finalAnswer.substring(0, 300)}`);
        console.log(`Tool calls: ${result.toolCallCount}`);
        console.log(
          `Tools used: ${result.toolCalls.map((c) => c.tool).join(", ") || "none"}`,
        );
        console.log(`Duration: ${result.durationMs}ms`);
        console.log(`Model: ${result.llmModel}`);
        console.log("--- END ---\n");
      }

      expect(pass, reason).to.be.true;
    });
  }

  after(function () {
    if (results.length === 0) return;

    const passed = results.filter((r) => r.pass).length;
    const total = results.length;
    const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
    const totalToolCalls = results.reduce((sum, r) => sum + r.toolCalls, 0);

    console.log("\n╔══════════════════════════════════════════════════╗");
    console.log("║           LIVE EVAL SCORECARD                    ║");
    console.log("╠══════════════════════════════════════════════════╣");
    console.log(`║  Model:      ${results[0]?.model.padEnd(36)}║`);
    console.log(`║  Score:      ${`${passed}/${total} passed`.padEnd(36)}║`);
    console.log(`║  Duration:   ${`${(totalDuration / 1000).toFixed(1)}s total`.padEnd(36)}║`);
    console.log(`║  Tool calls: ${`${totalToolCalls} total`.padEnd(36)}║`);
    console.log("╠══════════════════════════════════════════════════╣");

    for (const r of results) {
      const icon = r.pass ? "PASS" : "FAIL";
      const line = `${icon}  ${r.name.substring(0, 40).padEnd(40)} ${(r.durationMs / 1000).toFixed(1)}s`;
      console.log(`║  ${line.padEnd(48)}║`);
    }

    console.log("╚══════════════════════════════════════════════════╝\n");
  });
});
