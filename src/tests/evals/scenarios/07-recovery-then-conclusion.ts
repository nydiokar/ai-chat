import { expect } from "chai";
import {
  EvalScenario,
  yamlRecover,
  yamlConclusion,
  TOOL_WEB_SEARCH,
} from "../eval-types.js";

/**
 * SCENARIO: Agent explicitly recovers (changes strategy) then concludes.
 *
 * What this proves:
 * - The "recover" decision type works as a first-class runtime branch
 * - Recovery injects a guidance observation into the trace
 * - The scratchpad records the new strategy
 * - The agent can conclude after recovery without calling tools
 */
export const scenario: EvalScenario = {
  name: "Explicit recovery then conclusion",
  description:
    "Agent realizes its approach is wrong, issues a recover decision, then concludes with a revised answer.",
  tags: ["recovery", "core"],

  userMessage: "Explain the difference between REST and GraphQL",

  tools: [TOOL_WEB_SEARCH],

  toolBehaviors: {},

  llmResponses: [
    yamlRecover(
      "I was about to search the web but this is a conceptual question I can answer directly.",
      "Recover to direct answer instead of searching.",
      "Answer conceptual question directly without tool calls.",
      "Searching would waste a tool call on a question I have sufficient knowledge to answer.",
    ),
    yamlConclusion(
      "REST uses fixed endpoints while GraphQL uses a single endpoint with flexible queries.",
      "Provide a clear comparison.",
      "REST organizes APIs around resources with fixed endpoints (GET /users, POST /users), while GraphQL exposes a single endpoint where clients specify exactly what data they need using a query language. REST is simpler but can lead to over-fetching; GraphQL is more flexible but adds complexity.",
      "Based on established knowledge, no tool needed.",
    ),
  ],

  assertions: [
    // 1. No tools were called
    (r) => {
      expect(r.toolCallCount).to.equal(0);
    },

    // 2. Two LLM calls (recover + conclusion)
    (r) => {
      expect(r.llmCallCount).to.equal(2);
    },

    // 3. Final answer discusses REST and GraphQL
    (r) => {
      expect(r.finalAnswer).to.include("REST");
      expect(r.finalAnswer).to.include("GraphQL");
    },

    // 4. Scratchpad records the recovery strategy as the next best action
    (r) => {
      const secondScratchpad = r.scratchpadSnapshots[1];
      expect(secondScratchpad).to.be.a("string");
      expect(secondScratchpad!).to.match(/answer.*directly|next best action/i);
    },
  ],
};
