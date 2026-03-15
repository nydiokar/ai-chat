import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import { ReActStepParser } from "../agents/react-step-parser.js";

describe("ReActStepParser", () => {
  let parser: ReActStepParser;

  beforeEach(() => {
    parser = new ReActStepParser();
  });

  it("should parse YAML content inside code blocks", () => {
    const yamlResponse = `I'll analyze this step by step.

\`\`\`yaml
thought:
  reasoning: I need to understand the user's request.
  plan: First I'll search for relevant information, then analyze it.
\`\`\``;

    const result = parser.parseReasoningStep(yamlResponse);

    expect(result).to.not.be.null;
    expect(result?.thought).to.deep.include({
      reasoning: "I need to understand the user's request.",
      plan: "First I'll search for relevant information, then analyze it.",
    });
  });

  it("should parse action in YAML format", () => {
    const yamlAction = `I'll use a search tool to find information.

\`\`\`yaml
thought:
  reasoning: I need to search for current market data
  plan: Use the search tool
action:
  tool: web_search
  purpose: Find current data
  params:
    query: "latest market trends 2023"
\`\`\``;

    const result = parser.parseReasoningStep(yamlAction);

    expect(result).to.not.be.null;
    expect(result?.action).to.deep.include({
      tool: "web_search",
      purpose: "Find current data",
      params: {
        query: "latest market trends 2023",
      },
    });
  });

  it("should parse conclusion in YAML format", () => {
    const yamlConclusion = `Now I can provide a final answer.

\`\`\`yaml
conclusion:
  final_answer: Based on my analysis, the market is trending upward with a 5% increase over the last quarter.
  explanation: This is supported by the latest economic indicators and expert opinions.
\`\`\``;

    const result = parser.parseReasoningStep(yamlConclusion);

    expect(result).to.not.be.null;
    expect(result?.conclusion).to.deep.include({
      final_answer:
        "Based on my analysis, the market is trending upward with a 5% increase over the last quarter.",
      explanation:
        "This is supported by the latest economic indicators and expert opinions.",
    });
    expect(result?.isComplete).to.be.true;
  });

  it("should parse ask_user in YAML format", () => {
    const yamlAskUser = `I need clarification before proceeding.

\`\`\`yaml
thought:
  reasoning: I do not know which repository the user wants me to inspect.
  plan: Ask one focused question before using tools.
ask_user:
  question: Which repository should I inspect?
  reason: The task is ambiguous without a specific repository target.
\`\`\``;

    const result = parser.parseReasoningStep(yamlAskUser);

    expect(result).to.not.be.null;
    expect(result?.ask_user).to.deep.include({
      question: "Which repository should I inspect?",
      reason: "The task is ambiguous without a specific repository target.",
    });
    expect(result?.isComplete).to.be.true;
  });

  it("should parse text format with THOUGHT: prefix", () => {
    const textResponse = `THOUGHT: I need to research this topic more deeply before providing an answer.`;

    const result = parser.parseReasoningStep(textResponse);

    expect(result).to.not.be.null;
    expect(result?.thought).to.deep.include({
      reasoning:
        "I need to research this topic more deeply before providing an answer.",
      plan: "",
    });
  });

  it("should parse text format with ACTION: prefix", () => {
    const textResponse = `ACTION: web_search {
      "query": "climate change statistics 2023"
    }`;

    const result = parser.parseReasoningStep(textResponse);

    expect(result).to.not.be.null;
    expect(result?.action).to.deep.include({
      tool: "web_search",
      params: {
        query: "climate change statistics 2023",
      },
    });
  });

  it("should parse text format with FINAL_ANSWER: prefix", () => {
    const textResponse = `FINAL_ANSWER: The average global temperature has increased by 1.1°C since the pre-industrial era.`;

    const result = parser.parseReasoningStep(textResponse);

    expect(result).to.not.be.null;
    expect(result?.conclusion).to.deep.include({
      final_answer:
        "The average global temperature has increased by 1.1°C since the pre-industrial era.",
    });
    expect(result?.isComplete).to.be.true;
  });

  it("should parse text format with ASK_USER: prefix", () => {
    const textResponse = `ASK_USER: Which environment should I target for this deployment?`;

    const result = parser.parseReasoningStep(textResponse);

    expect(result).to.not.be.null;
    expect(result?.ask_user).to.deep.include({
      question: "Which environment should I target for this deployment?",
    });
    expect(result?.isComplete).to.be.true;
  });

  it("should interpret ask_user as an explicit runtime decision", () => {
    const result = parser.parseReasoningStep(`\`\`\`yaml
thought:
  reasoning: I am blocked on missing credentials.
  plan: Ask the user for the credential source.
ask_user:
  question: Where should I read the API key from?
  reason: I cannot authenticate without it.
\`\`\``);

    expect(result).to.not.be.null;
    const decision = parser.interpretDecision(result!);
    expect(decision).to.deep.equal({
      type: "ask_user",
      question: "Where should I read the API key from?",
      reason: "I cannot authenticate without it.",
      stepId: result!.stepId,
    });
  });

  it("should return null for unparseable content", () => {
    const invalidResponse = `This is just some random text without any structured format.`;

    const result = parser.parseReasoningStep(invalidResponse);

    expect(result).to.be.null;
  });
});
