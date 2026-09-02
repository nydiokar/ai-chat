import { describe, it } from "mocha";
import { expect } from "chai";
import { ObservationParser } from "../agents/observation-parser.js";
import { ToolExecutionResult } from "../tools/tool-chain/tool-chain-executor.js";
import { ReasoningStep } from "../interfaces/react-types.js";

describe("ObservationParser", () => {
  const parser = new ObservationParser();

  it("extracts source refs and salient fields from array results", () => {
    const result: ToolExecutionResult = {
      success: true,
      data: [
        {
          title: "Doc 1",
          url: "https://example.com/doc-1",
          snippet: "First document",
        },
        {
          title: "Doc 2",
          url: "https://example.com/doc-2",
          snippet: "Second document",
        },
      ],
      metadata: { executionTime: 10, toolName: "web_search" },
    };

    const action: ReasoningStep["action"] = {
      tool: "web_search",
      params: { query: "docs" },
      purpose: "Gather sources",
    };

    const observation = parser.parseToolResult(result, action);

    expect(observation.kind).to.equal("success");
    expect(observation.summary).to.include("returned 2 items");
    expect(observation.importantFields).to.deep.equal({
      count: 2,
      sample: {
        title: "Doc 1",
        url: "https://example.com/doc-1",
        snippet: "First document",
      },
    });
    expect(observation.sourceRefs).to.deep.equal([
      "https://example.com/doc-1",
      "https://example.com/doc-2",
    ]);
  });

  it("uses structured url fields for search tools instead of regex scanning snippets", () => {
    const result: ToolExecutionResult = {
      success: true,
      data: [
        {
          title: "Result A",
          url: "https://example.com/a",
          snippet: "See also https://incidental.example.com/x for more info",
        },
        {
          title: "Result B",
          link: "https://example.com/b",
          snippet: "Another result",
        },
      ],
      metadata: { executionTime: 5, toolName: "web_search" },
    };

    const action: ReasoningStep["action"] = {
      tool: "web_search",
      params: { query: "test" },
    };

    const observation = parser.parseToolResult(result, action);

    // Should extract only the canonical url/link fields, not the incidental URL in the snippet
    expect(observation.sourceRefs).to.deep.equal([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("classifies errors by kind based on message content", () => {
    const cases: Array<{
      message: string;
      expectedKind: string;
    }> = [
      { message: "Request timed out after 30s", expectedKind: "timeout" },
      {
        message: "401 Unauthorized: invalid api key",
        expectedKind: "auth_error",
      },
      {
        message: "429 Too Many Requests: rate limit exceeded",
        expectedKind: "rate_limit",
      },
      { message: "No results found for query", expectedKind: "not_found" },
      { message: "Unexpected token in JSON", expectedKind: "parse_error" },
      { message: "Something went completely wrong", expectedKind: "unknown" },
    ];

    const action: ReasoningStep["action"] = {
      tool: "some_tool",
      params: {},
    };

    for (const { message, expectedKind } of cases) {
      const observation = parser.parseToolError(new Error(message), action);
      expect(observation.error?.kind).to.equal(
        expectedKind,
        `Expected kind "${expectedKind}" for message: "${message}"`,
      );
    }
  });

  it("non-search tools still extract URLs via regex fallback", () => {
    const result: ToolExecutionResult = {
      success: true,
      data: { report: "See https://example.com/report for details" },
      metadata: { executionTime: 5, toolName: "find_user" },
    };

    const action: ReasoningStep["action"] = {
      tool: "find_user",
      params: {},
    };

    const observation = parser.parseToolResult(result, action);
    expect(observation.sourceRefs).to.deep.equal([
      "https://example.com/report",
    ]);
  });

  it("preserves error kind even when action is missing", () => {
    const observation = parser.parseToolError(
      new Error("Request timed out after 30s"),
      undefined,
    );
    expect(observation.kind).to.equal("error");
    expect(observation.error?.kind).to.equal("timeout");
  });

  it("marks oversized rendered observations as truncated while preserving the raw preview", () => {
    const largeText = "x".repeat(2200);
    const result: ToolExecutionResult = {
      success: true,
      data: largeText,
      metadata: { executionTime: 10, toolName: "test_tool" },
    };

    const action: ReasoningStep["action"] = {
      tool: "test_tool",
      params: {},
    };

    const observation = parser.parseToolResult(result, action, 300);

    expect(observation.truncated).to.equal(true);
    expect(observation.result).to.include("[Result truncated.");
    expect(observation.rawPreview).to.be.a("string");
    expect(observation.summary.length).to.be.lessThan(170);
  });
});
