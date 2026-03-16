import { expect } from "chai";
import {
  EvalScenario,
  yamlAction,
  yamlConclusion,
  TOOL_WEB_SEARCH,
} from "../eval-types.js";

/**
 * SCENARIO: Happy path — agent uses one tool, gets a result, concludes.
 *
 * What this proves:
 * - The full ReAct loop works: think -> act -> observe -> think -> finish
 * - Tool is called with the correct parameters
 * - Grounded observation is stored and available in the next prompt
 * - Scratchpad contains the fact from the observation
 * - The engine finishes cleanly without hitting MAX_STEPS
 */
export const scenario: EvalScenario = {
  name: "Happy path: single tool call and conclusion",
  description:
    "Agent searches the web for a factual question, gets a result, and finishes with a grounded answer.",
  tags: ["happy-path", "core"],

  userMessage: "What is the population of Bulgaria?",

  tools: [TOOL_WEB_SEARCH],

  toolBehaviors: {
    web_search: [
      {
        success: true,
        data: {
          summary: "Bulgaria has a population of approximately 6.5 million as of 2025.",
          url: "https://worldpopulation.info/bulgaria",
          title: "Bulgaria Population 2025",
        },
      },
    ],
  },

  llmResponses: [
    yamlAction(
      "The user wants Bulgaria's population. I need to search for current data.",
      "Search for Bulgaria population.",
      "web_search",
      { query: "Bulgaria population 2025" },
      "Find current population data",
    ),
    yamlConclusion(
      "The search returned that Bulgaria has approximately 6.5 million people.",
      "Provide the answer.",
      "Bulgaria has a population of approximately 6.5 million people as of 2025.",
      "Based on search results from worldpopulation.info",
    ),
  ],

  assertions: [
    // 1. Final answer is grounded in the tool result
    (r) => {
      expect(r.finalAnswer).to.include("6.5 million");
    },

    // 2. Exactly one tool call was made
    (r) => {
      expect(r.toolCallCount).to.equal(1);
    },

    // 3. The tool was web_search
    (r) => {
      expect(r.toolCallsByName["web_search"]).to.equal(1);
    },

    // 4. LLM was called exactly twice (action + conclusion)
    (r) => {
      expect(r.llmCallCount).to.equal(2);
    },

    // 5. Scratchpad in the second prompt contains the fact
    (r) => {
      const secondScratchpad = r.scratchpadSnapshots[1];
      expect(secondScratchpad).to.be.a("string");
      expect(secondScratchpad!).to.match(/bulgaria|6\.5|population/i);
    },

    // 6. Completed fast (no unnecessary iterations)
    (r) => {
      expect(r.durationMs).to.be.lessThan(2000);
    },
  ],
};
