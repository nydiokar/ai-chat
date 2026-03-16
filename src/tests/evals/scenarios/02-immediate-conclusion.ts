import { expect } from "chai";
import {
  EvalScenario,
  yamlConclusion,
  TOOL_WEB_SEARCH,
} from "../eval-types.js";

/**
 * SCENARIO: Agent finishes immediately without using any tools.
 *
 * What this proves:
 * - The engine handles "finish" as a first-class outcome
 * - No tools are called when the agent doesn't need them
 * - Single LLM call is sufficient for immediate completion
 * - This is NOT the safety_stop fallback — it's a clean finish
 */
export const scenario: EvalScenario = {
  name: "Immediate conclusion without tools",
  description:
    "Agent recognizes it can answer a greeting directly and finishes without calling any tools.",
  tags: ["completion", "core"],

  userMessage: "Hello, how are you?",

  tools: [TOOL_WEB_SEARCH],

  toolBehaviors: {},

  llmResponses: [
    yamlConclusion(
      "This is a greeting, not a question that requires tools.",
      "Respond directly.",
      "Hello! I'm doing well, thank you for asking. How can I help you today?",
    ),
  ],

  assertions: [
    // 1. No tools were called
    (r) => {
      expect(r.toolCallCount).to.equal(0);
    },

    // 2. Only one LLM call
    (r) => {
      expect(r.llmCallCount).to.equal(1);
    },

    // 3. Answer is the greeting
    (r) => {
      expect(r.finalAnswer).to.include("Hello");
    },
  ],
};
