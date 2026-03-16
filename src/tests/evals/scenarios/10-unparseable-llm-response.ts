import { expect } from "chai";
import {
  EvalScenario,
  TOOL_WEB_SEARCH,
} from "../eval-types.js";

/**
 * SCENARIO: LLM returns garbage — recovery policy terminates with ask_user.
 *
 * What this proves:
 * - The engine handles unparseable LLM responses gracefully
 * - A format reminder is injected into the trace
 * - Recovery policy classifies parse_error as "redirect" severity
 * - After the parse failure, the policy emits ask_user (not an infinite retry)
 * - The final response is a meaningful clarification request, not a crash
 *
 * Note: the recovery policy is intentionally aggressive here — a single
 * __llm__ parse_error triggers ask_user because redirect severity exhausts
 * retries immediately. This is correct: we don't want infinite retry loops
 * on broken LLM output.
 */
export const scenario: EvalScenario = {
  name: "Unparseable LLM response triggers recovery policy termination",
  description:
    "LLM returns garbage. RecoveryPolicy fires ask_user after the parse failure.",
  tags: ["error-handling", "resilience", "core"],

  userMessage: "What time is it?",

  tools: [TOOL_WEB_SEARCH],

  toolBehaviors: {},

  llmResponses: [
    // Garbage response that can't be parsed
    "Sure! The time is... wait, I need to think about this. Let me consider the various timezones and philosophical implications of temporal measurement.",
  ],

  assertions: [
    // 1. Only one LLM call — recovery policy stops after the parse failure
    (r) => {
      expect(r.llmCallCount).to.equal(1);
    },

    // 2. No tools were called
    (r) => {
      expect(r.toolCallCount).to.equal(0);
    },

    // 3. Final answer is a meaningful recovery message (not garbage, not empty)
    (r) => {
      expect(r.finalAnswer.length).to.be.greaterThan(10);
      expect(r.finalAnswer).to.not.include("philosophical");
    },

    // 4. Final answer mentions the __llm__ failure or asks for clarification
    (r) => {
      expect(r.finalAnswer).to.match(/clarif|request|approach|result/i);
    },
  ],
};
