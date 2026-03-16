import { expect } from "chai";
import {
  EvalScenario,
  yamlAction,
  TOOL_WEB_SEARCH,
  TOOL_WEATHER,
  TOOL_CODE_SEARCH,
} from "../eval-types.js";

/**
 * SCENARIO: Three consecutive tool failures trigger the block directive.
 *
 * What this proves:
 * - RecoveryPolicy tracks consecutive failures across different tools
 * - After MAX_CONSECUTIVE_FAILURES (3), the policy emits "block"
 * - The engine terminates and surfaces a clarification message
 * - The agent does NOT spin in an infinite retry loop
 * - This is the anti-loop guarantee the audit demanded
 */
export const scenario: EvalScenario = {
  name: "Three consecutive failures trigger block — no retry loops",
  description:
    "Agent tries three different tools, all fail. RecoveryPolicy blocks the run.",
  tags: ["recovery", "anti-loop", "core"],

  userMessage: "Find me information about quantum computing advances",

  tools: [TOOL_WEB_SEARCH, TOOL_WEATHER, TOOL_CODE_SEARCH],

  toolBehaviors: {
    web_search: [
      { success: false, error: "Connection refused — network error" },
    ],
    weather_lookup: [
      { success: false, error: "Service not available" },
    ],
    code_search: [
      { success: false, error: "Index offline — cannot query" },
    ],
  },

  llmResponses: [
    yamlAction(
      "Let me search the web for quantum computing advances.",
      "Use web search.",
      "web_search",
      { query: "quantum computing advances 2026" },
    ),
    yamlAction(
      "Web search failed. Let me try code search for research papers.",
      "Try code search.",
      "code_search",
      { query: "quantum computing" },
    ),
    yamlAction(
      "Code search also failed. Last resort — weather tool.",
      "Try weather as a heuristic.",
      "weather_lookup",
      { city: "quantum" },
    ),
    // This should never be reached
    yamlAction(
      "Still trying",
      "Keep going",
      "web_search",
      { query: "quantum" },
    ),
  ],

  assertions: [
    // 1. Engine stopped before exhausting all LLM responses
    (r) => {
      expect(r.llmCallCount).to.be.lessThanOrEqual(3);
    },

    // 2. Final response is not empty and asks for help
    (r) => {
      expect(r.finalAnswer.length).to.be.greaterThan(10);
    },

    // 3. Final response mentions failures or asks for clarification
    (r) => {
      expect(r.finalAnswer).to.match(/fail|clarif|approach|context/i);
    },
  ],
};
