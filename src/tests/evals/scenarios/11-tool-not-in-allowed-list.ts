import { expect } from "chai";
import {
  EvalScenario,
  yamlAction,
  yamlConclusion,
  TOOL_WEB_SEARCH,
} from "../eval-types.js";

/**
 * SCENARIO: Agent requests a tool that isn't in the allowed list.
 *
 * What this proves:
 * - Tool filtering works — the engine blocks calls to unlisted tools
 * - An error observation is injected telling the agent what tools ARE available
 * - The agent recovers and either uses an available tool or concludes
 * - This validates the guardrails layer
 */
export const scenario: EvalScenario = {
  name: "Blocked tool call triggers error and agent adapts",
  description:
    "Agent tries to call a tool not in the filtered list, gets an error, then concludes.",
  tags: ["guardrails", "tool-filtering", "core"],

  userMessage: "What is the weather in Paris?",

  tools: [TOOL_WEB_SEARCH], // weather_lookup is NOT in the list

  toolBehaviors: {
    web_search: [
      {
        success: true,
        data: { summary: "Paris weather: 18°C, sunny" },
      },
    ],
  },

  llmResponses: [
    // Agent tries to call weather_lookup which isn't available
    yamlAction(
      "User wants weather. Let me use the weather tool.",
      "Call weather lookup.",
      "weather_lookup",
      { city: "Paris" },
    ),

    // After seeing the error, uses web_search instead
    yamlAction(
      "Weather tool is not available. I'll use web search instead.",
      "Search for Paris weather.",
      "web_search",
      { query: "Paris current weather" },
      "Fallback to web search",
    ),

    // Conclude with the result
    yamlConclusion(
      "Got Paris weather from web search: 18°C and sunny.",
      "Provide the answer.",
      "The weather in Paris is currently 18°C and sunny.",
    ),
  ],

  assertions: [
    // 1. weather_lookup was NOT executed (blocked by filter)
    (r) => {
      expect(r.toolCallsByName["weather_lookup"]).to.be.undefined;
    },

    // 2. web_search WAS executed as fallback
    (r) => {
      expect(r.toolCallsByName["web_search"]).to.equal(1);
    },

    // 3. Final answer contains weather data
    (r) => {
      expect(r.finalAnswer).to.include("18");
    },

    // 4. Three LLM calls total (blocked tool + fallback + conclusion)
    (r) => {
      expect(r.llmCallCount).to.equal(3);
    },
  ],
};
