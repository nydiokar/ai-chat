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
