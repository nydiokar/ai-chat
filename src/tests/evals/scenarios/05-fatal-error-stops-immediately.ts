import { expect } from "chai";
import {
  EvalScenario,
  yamlAction,
  TOOL_WEB_SEARCH,
} from "../eval-types.js";

/**
 * SCENARIO: Fatal error (auth) triggers immediate stop via RecoveryPolicy.
 *
 * What this proves:
 * - RecoveryPolicy classifies auth_error as fatal
 * - The engine stops after a single failure (no retry loop)
 * - The final response surfaces a meaningful ask_user message
 * - Only one LLM call is made (the one that chose the tool)
 */
export const scenario: EvalScenario = {
  name: "Fatal auth error stops agent immediately",
  description:
    "Tool returns a 401 auth error. RecoveryPolicy blocks immediately, no retry.",
  tags: ["recovery", "fatal", "core"],

  userMessage: "Search for the latest news about AI",

  tools: [TOOL_WEB_SEARCH],

  toolBehaviors: {
    web_search: [
      {
        success: false,
        error: "401 Unauthorized: invalid api key provided",
      },
    ],
  },

  llmResponses: [
    yamlAction(
      "User wants latest AI news. I'll search the web.",
      "Search for AI news.",
      "web_search",
      { query: "latest AI news 2026" },
      "Find recent AI news",
    ),
    // This should never be reached — engine should stop after the fatal error
    yamlAction(
      "Trying again",
      "Search again",
      "web_search",
      { query: "AI news" },
    ),
  ],

  assertions: [
    // 1. Only one LLM call (no retry after fatal error)
    (r) => {
      expect(r.llmCallCount).to.equal(1);
    },

    // 2. Only one tool attempt
    (r) => {
      expect(r.toolCallCount).to.equal(1);
    },

    // 3. Final response is not empty
    (r) => {
      expect(r.finalAnswer.length).to.be.greaterThan(10);
    },

    // 4. Final response mentions auth/credentials/web_search
    (r) => {
      expect(r.finalAnswer).to.match(/auth|credential|web_search|api.?key/i);
    },
  ],
};
