import { expect } from "chai";
import {
  EvalScenario,
  yamlAskUser,
  TOOL_WEB_SEARCH,
  TOOL_CODE_SEARCH,
} from "../eval-types.js";

/**
 * SCENARIO: Agent asks for clarification instead of guessing.
 *
 * What this proves:
 * - ask_user is a first-class completion outcome
 * - The engine terminates cleanly on ask_user (no further LLM calls)
 * - No tools are called before asking
 * - The question is surfaced as the final response
 */
export const scenario: EvalScenario = {
  name: "Ask user for clarification on ambiguous request",
  description:
    "Agent receives an ambiguous request and asks for clarification instead of guessing.",
  tags: ["ask-user", "completion", "core"],

  userMessage: "Analyze the repo",

  tools: [TOOL_WEB_SEARCH, TOOL_CODE_SEARCH],

  toolBehaviors: {},

  llmResponses: [
    yamlAskUser(
      "The user said 'analyze the repo' but didn't specify which repository or what kind of analysis.",
      "Ask for clarification before proceeding.",
      "Which repository would you like me to analyze, and what aspects should I focus on (code quality, dependencies, architecture)?",
      "The request is too ambiguous to proceed without risking wasted tool calls.",
    ),
  ],

  assertions: [
    // 1. No tools called
    (r) => {
      expect(r.toolCallCount).to.equal(0);
    },

    // 2. Single LLM call
    (r) => {
      expect(r.llmCallCount).to.equal(1);
    },

    // 3. Final answer IS the question (ask_user surfaces as the response)
    (r) => {
      expect(r.finalAnswer).to.include("repository");
    },

    // 4. The answer is not empty
    (r) => {
      expect(r.finalAnswer.length).to.be.greaterThan(10);
    },
  ],
};
