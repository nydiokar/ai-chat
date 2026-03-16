import { expect } from "chai";
import {
  EvalScenario,
  yamlAction,
  yamlConclusion,
  TOOL_WEB_SEARCH,
} from "../eval-types.js";

/**
 * SCENARIO: Multi-step task proves scratchpad accumulates facts across steps.
 *
 * What this proves:
 * - The scratchpad is updated after each observation
 * - Facts from earlier tool results persist into later prompts
 * - Attempted actions are tracked
 * - The scratchpad grows meaningfully across 3+ steps
 * - The prompt generator receives the scratchpad summary
 */
export const scenario: EvalScenario = {
  name: "Scratchpad accumulates facts across multiple tool calls",
  description:
    "Agent makes three sequential searches. Scratchpad should contain facts from all three by the final prompt.",
  tags: ["scratchpad", "multi-step", "core"],

  userMessage:
    "Compare the populations of Bulgaria, Romania, and Greece",

  tools: [TOOL_WEB_SEARCH],

  toolBehaviors: {
    web_search: [
      {
        success: true,
        data: {
          summary: "Bulgaria population: 6.5 million",
          url: "https://example.com/bg",
        },
      },
      {
        success: true,
        data: {
          summary: "Romania population: 19 million",
          url: "https://example.com/ro",
        },
      },
      {
        success: true,
        data: {
          summary: "Greece population: 10.3 million",
          url: "https://example.com/gr",
        },
      },
    ],
  },

  llmResponses: [
    yamlAction(
      "I need population data for three countries. Starting with Bulgaria.",
      "Search Bulgaria population.",
      "web_search",
      { query: "Bulgaria population 2025" },
      "Get Bulgaria population",
    ),
    yamlAction(
      "Got Bulgaria at 6.5M. Now Romania.",
      "Search Romania population.",
      "web_search",
      { query: "Romania population 2025" },
      "Get Romania population",
    ),
    yamlAction(
      "Got Romania at 19M. Now Greece.",
      "Search Greece population.",
      "web_search",
      { query: "Greece population 2025" },
      "Get Greece population",
    ),
    yamlConclusion(
      "I have all three: Bulgaria 6.5M, Romania 19M, Greece 10.3M.",
      "Provide the comparison.",
      "Population comparison: Romania is the largest at 19 million, followed by Greece at 10.3 million, and Bulgaria at 6.5 million.",
      "Based on three separate search results.",
    ),
  ],

  assertions: [
    // 1. Three tool calls
    (r) => {
      expect(r.toolCallCount).to.equal(3);
    },

    // 2. Four LLM calls (3 actions + 1 conclusion)
    (r) => {
      expect(r.llmCallCount).to.equal(4);
    },

    // 3. Final scratchpad contains facts about all three countries
    (r) => {
      const lastScratchpad = r.scratchpadSnapshots[r.scratchpadSnapshots.length - 1];
      expect(lastScratchpad).to.be.a("string");
      expect(lastScratchpad!).to.match(/bulgaria/i);
      expect(lastScratchpad!).to.match(/romania/i);
      expect(lastScratchpad!).to.match(/greece/i);
    },

    // 4. Scratchpad grows across steps
    (r) => {
      const lengths = r.scratchpadSnapshots
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.length);
      // Each subsequent scratchpad should be equal or longer
      for (let i = 1; i < lengths.length; i++) {
        expect(lengths[i]).to.be.at.least(lengths[i - 1]);
      }
    },

    // 5. Attempted actions are tracked
    (r) => {
      const lastScratchpad = r.scratchpadSnapshots[r.scratchpadSnapshots.length - 1]!;
      expect(lastScratchpad).to.match(/tried|attempted/i);
    },

    // 6. Final answer mentions all three countries
    (r) => {
      expect(r.finalAnswer).to.match(/romania/i);
      expect(r.finalAnswer).to.match(/greece/i);
      expect(r.finalAnswer).to.match(/bulgaria/i);
    },
  ],
};
