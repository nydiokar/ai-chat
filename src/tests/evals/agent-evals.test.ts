import { describe, it } from "mocha";
import { expect } from "chai";
import { evaluateScenario } from "./eval-harness.js";
import { EvalScenario } from "./eval-types.js";

// Import all scenarios
import { scenario as happyPath } from "./scenarios/01-happy-path-with-tool.js";
import { scenario as immediateConclude } from "./scenarios/02-immediate-conclusion.js";
import { scenario as askUser } from "./scenarios/03-ask-user-clarification.js";
import { scenario as toolFailureRecovery } from "./scenarios/04-tool-failure-recovery.js";
import { scenario as fatalError } from "./scenarios/05-fatal-error-stops-immediately.js";
import { scenario as repeatedFailures } from "./scenarios/06-repeated-failures-block.js";
import { scenario as recoveryConclusion } from "./scenarios/07-recovery-then-conclusion.js";
import { scenario as scratchpadAccum } from "./scenarios/08-scratchpad-accumulation.js";
import { scenario as maxSteps } from "./scenarios/09-max-steps-safety-stop.js";
import { scenario as unparseableLlm } from "./scenarios/10-unparseable-llm-response.js";
import { scenario as blockedTool } from "./scenarios/11-tool-not-in-allowed-list.js";

const ALL_SCENARIOS: EvalScenario[] = [
  happyPath,
  immediateConclude,
  askUser,
  toolFailureRecovery,
  fatalError,
  repeatedFailures,
  recoveryConclusion,
  scratchpadAccum,
  maxSteps,
  unparseableLlm,
  blockedTool,
];

describe("Agent Runtime Evals", function () {
  // These are integration-level tests that run the full engine loop
  this.timeout(10000);

  for (const scenario of ALL_SCENARIOS) {
    it(`[${(scenario.tags ?? []).join(",")}] ${scenario.name}`, async () => {
      const { result, passed, error } = await evaluateScenario(scenario);

      if (!passed) {
        // Print diagnostic info before failing
        console.log("\n--- EVAL DIAGNOSTIC ---");
        console.log(`Scenario: ${scenario.name}`);
        console.log(`Final answer: ${result.finalAnswer.substring(0, 200)}`);
        console.log(`LLM calls: ${result.llmCallCount}`);
        console.log(`Tool calls: ${result.toolCallCount}`);
        console.log(`Tool calls by name:`, result.toolCallsByName);
        console.log(`Duration: ${result.durationMs}ms`);
        console.log(
          `Scratchpad snapshots: ${result.scratchpadSnapshots.length}`,
        );
        if (result.scratchpadSnapshots.length > 0) {
          const last =
            result.scratchpadSnapshots[result.scratchpadSnapshots.length - 1];
          console.log(
            `Last scratchpad:\n${last?.substring(0, 300) ?? "(undefined)"}`,
          );
        }
        console.log("--- END DIAGNOSTIC ---\n");
      }

      expect(passed, error ?? "Unknown eval failure").to.be.true;
    });
  }
});

// Summary test — ensures we have meaningful coverage
describe("Eval Coverage", () => {
  it("covers all critical agent capabilities", () => {
    const requiredTags = [
      "happy-path",
      "completion",
      "ask-user",
      "recovery",
      "anti-loop",
      "scratchpad",
      "safety",
      "resilience",
      "guardrails",
    ];

    const coveredTags = new Set(ALL_SCENARIOS.flatMap((s) => s.tags ?? []));

    for (const tag of requiredTags) {
      expect(
        coveredTags.has(tag),
        `Missing eval coverage for capability: "${tag}"`,
      ).to.be.true;
    }
  });

  it("has at least 10 scenarios", () => {
    expect(ALL_SCENARIOS.length).to.be.at.least(10);
  });
});
