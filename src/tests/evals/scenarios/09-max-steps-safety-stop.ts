import { expect } from "chai";
import {
  EvalScenario,
  yamlAction,
  TOOL_WEB_SEARCH,
} from "../eval-types.js";

/**
 * SCENARIO: Agent hits MAX_STEPS and gets a safety_stop fallback.
 *
 * What this proves:
 * - The engine does not run forever
 * - When MAX_STEPS is reached without a conclusion, a fallback response is generated
 * - The fallback response is not empty (contains partial reasoning)
 * - This is the last line of defense — it should never happen in practice
 *   if recovery policy is working, but it must work as a guarantee
 */
export const scenario: EvalScenario = {
  name: "MAX_STEPS safety stop produces a fallback response",
  description:
    "Agent keeps searching without concluding. After maxIterations, engine generates a fallback.",
  tags: ["safety", "completion", "core"],

  userMessage: "Tell me everything about the history of computing",

  maxIterations: 3, // Low limit to trigger safety stop quickly

  tools: [TOOL_WEB_SEARCH],

  toolBehaviors: {
    web_search: [
      { success: true, data: { summary: "Babbage invented the analytical engine in 1837" } },
      { success: true, data: { summary: "Turing published On Computable Numbers in 1936" } },
      { success: true, data: { summary: "ENIAC was built in 1945" } },
    ],
  },

  llmResponses: [
    yamlAction(
      "This is a broad topic. Let me start searching.",
      "Search for early computing history.",
      "web_search",
      { query: "history of computing early" },
    ),
    yamlAction(
      "Got early history. Need more about mid-century.",
      "Search for Turing and mid-century.",
      "web_search",
      { query: "Turing computing history" },
    ),
    yamlAction(
      "Got Turing info. Need post-war era.",
      "Search for ENIAC and early computers.",
      "web_search",
      { query: "ENIAC first computers" },
    ),
    // Would keep going but hits max_steps
    yamlAction(
      "Need more data",
      "Keep searching",
      "web_search",
      { query: "IBM mainframe history" },
    ),
  ],

  assertions: [
    // 1. Engine stopped at max iterations
    (r) => {
      expect(r.llmCallCount).to.be.at.most(3);
    },

    // 2. Fallback response is not empty
    (r) => {
      expect(r.finalAnswer.length).to.be.greaterThan(20);
    },

    // 3. Fallback response contains partial information from observations
    (r) => {
      // The fallback should reference what the agent found
      expect(r.finalAnswer).to.match(/working|found|request|information/i);
    },
  ],
};
