import { expect } from "chai";
import {
  EvalScenario,
  yamlAction,
  yamlConclusion,
  TOOL_WEB_SEARCH,
  TOOL_WEATHER,
} from "../eval-types.js";

/**
 * SCENARIO: First tool fails, agent recovers with a different tool.
 *
 * What this proves:
 * - The engine doesn't crash on tool failures
 * - Grounded error observations are stored in the trace
 * - The scratchpad records the failure
 * - The agent can try a different tool after failure
 * - The final answer uses data from the second (successful) tool
 */
export const scenario: EvalScenario = {
  name: "Tool failure followed by successful recovery with alternate tool",
  description:
    "Weather tool fails, agent falls back to web_search and still delivers a grounded answer.",
  tags: ["recovery", "core"],

  userMessage: "What is the weather in Sofia right now?",

  tools: [TOOL_WEATHER, TOOL_WEB_SEARCH],

  toolBehaviors: {
    weather_lookup: [
      {
        success: false,
        error: "Service temporarily unavailable — timed out after 5000ms",
      },
    ],
    web_search: [
      {
        success: true,
        data: {
          summary: "Sofia, Bulgaria: 15°C, partly cloudy, wind 12 km/h",
          url: "https://weather.example.com/sofia",
        },
      },
    ],
  },

  llmResponses: [
    // Step 1: try the weather tool
    yamlAction(
      "User wants current weather in Sofia. I'll use the weather tool.",
      "Call weather_lookup for Sofia.",
      "weather_lookup",
      { city: "Sofia" },
      "Get current weather data",
    ),

    // Step 2: after seeing the failure, try web search instead
    yamlAction(
      "The weather tool failed with a timeout. I'll try web search as a fallback.",
      "Search the web for Sofia weather.",
      "web_search",
      { query: "Sofia Bulgaria current weather" },
      "Fallback weather lookup",
    ),

    // Step 3: conclude with the web search result
    yamlConclusion(
      "Web search returned Sofia weather: 15°C, partly cloudy.",
      "Provide the answer from the web search fallback.",
      "The current weather in Sofia is 15°C and partly cloudy, with winds at 12 km/h.",
      "Based on web search results after weather tool was unavailable.",
    ),
  ],

  assertions: [
    // 1. Final answer contains the actual weather data
    (r) => {
      expect(r.finalAnswer).to.include("15");
    },

    // 2. Weather tool was attempted
    (r) => {
      expect(r.toolCallsByName["weather_lookup"]).to.equal(1);
    },

    // 3. Web search was the fallback
    (r) => {
      expect(r.toolCallsByName["web_search"]).to.equal(1);
    },

    // 4. Three LLM calls total (attempt + fallback + conclusion)
    (r) => {
      expect(r.llmCallCount).to.equal(3);
    },

    // 5. Scratchpad should record the failure by the third prompt
    (r) => {
      const lastScratchpad = r.scratchpadSnapshots[r.scratchpadSnapshots.length - 1];
      expect(lastScratchpad).to.be.a("string");
      expect(lastScratchpad!).to.match(/fail|timeout|weather_lookup/i);
    },
  ],
};
