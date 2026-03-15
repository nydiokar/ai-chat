import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import * as sinon from "sinon";
import { ReActToolHandler } from "../agents/react-tool-handler.js";
import { ToolExecutionResult } from "../tools/tool-chain/tool-chain-executor.js";
import { ReasoningStep } from "../interfaces/react-types.js";
import { IToolManager } from "../tools/mcp/interfaces/core.js";

describe("ReActToolHandler", () => {
  let toolHandler: ReActToolHandler;
  let mockToolManager: IToolManager;
  let mockToolExecutor: any;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    // Create a sinon sandbox for mocks
    sandbox = sinon.createSandbox();

    // Create mock implementations
    mockToolManager = {
      getAvailableTools: sandbox.stub(),
      executeTool: sandbox.stub(),
      registerTool: sandbox.stub(),
      getToolByName: sandbox.stub(),
      refreshToolInformation: sandbox.stub(),
    };

    mockToolExecutor = {
      execute: sandbox.stub(),
    };

    // Create the handler with mocked dependencies
    toolHandler = new ReActToolHandler(mockToolManager, mockToolExecutor);
  });

  afterEach(() => {
    // Restore all stubs
    sandbox.restore();
  });

  it("should get tool registry from tool manager", async () => {
    // Setup mock to return some tools
    const mockTools = [
      {
        name: "web_search",
        description: "Search the web",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "calculator",
        description: "Perform calculations",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ];

    (mockToolManager.getAvailableTools as sinon.SinonStub).resolves(mockTools);

    const registry = await toolHandler.getToolRegistry();

    sinon.assert.called(mockToolManager.getAvailableTools as sinon.SinonStub);
    expect(Object.keys(registry)).to.deep.equal(["web_search", "calculator"]);
    expect(typeof registry.web_search).to.equal("function");
    expect(typeof registry.calculator).to.equal("function");
  });

  it("should create tool execution functions that call the tool manager", async () => {
    // Setup mock to return some tools
    const mockTools = [
      {
        name: "web_search",
        description: "Search the web",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ];

    (mockToolManager.getAvailableTools as sinon.SinonStub).resolves(mockTools);

    const mockResult = {
      success: true,
      data: "search results",
    };

    (mockToolManager.executeTool as sinon.SinonStub).resolves(mockResult);

    const registry = await toolHandler.getToolRegistry();
    const result = await registry.web_search({ query: "test query" });

    sinon.assert.calledWith(
      mockToolManager.executeTool as sinon.SinonStub,
      "web_search",
      { query: "test query" },
    );
    expect(result).to.deep.equal(mockResult);
  });

  it("should execute tools with registry using tool executor", async () => {
    // Setup mock to return success result
    const mockResult = {
      success: true,
      data: "result data",
      metadata: { executionTime: 100, toolName: "test_tool" },
    };

    (mockToolExecutor.execute as sinon.SinonStub).resolves(mockResult);

    const action: ReasoningStep["action"] = {
      tool: "test_tool",
      params: { param1: "value1" },
    };

    const registry = {
      test_tool: async () => ({ success: true, data: "result data" }),
    };

    const result = await toolHandler.executeToolWithRegistry(
      action,
      registry,
      "user123",
    );

    sinon.assert.called(mockToolExecutor.execute as sinon.SinonStub);
    expect(result).to.deep.equal(mockResult);
  });

  it("should create observation step from result", () => {
    const formattedResult = "This is a formatted tool result";
    const step = toolHandler.createObservationStep(formattedResult);

    expect(step.observation).to.deep.include({
      kind: "partial",
      summary: formattedResult,
      result: formattedResult,
    });
    expect(step.isComplete).to.be.false;
    expect(step.stepId).to.match(/^obs_\d+$/);
    expect(typeof step.timestamp).to.equal("string");
  });

  it("should parse structured observations with important fields and sources", () => {
    const mockResult: ToolExecutionResult = {
      success: true,
      data: {
        title: "Example result",
        url: "https://example.com/article",
        summary: "Important grounded summary",
        details: ["alpha", "beta"],
      },
      metadata: { executionTime: 100, toolName: "web_search" },
    };

    const action: ReasoningStep["action"] = {
      tool: "web_search",
      purpose: "Find a relevant source",
      params: { query: "example query" },
    };

    const observation = toolHandler.parseToolObservation(mockResult, action);

    expect(observation.kind).to.equal("success");
    expect(observation.summary).to.equal("Important grounded summary");
    expect(observation.tool).to.equal("web_search");
    expect(observation.importantFields).to.deep.include({
      title: "Example result",
      url: "https://example.com/article",
    });
    expect(observation.sourceRefs).to.deep.equal(["https://example.com/article"]);
    expect(observation.result).to.include("Observation summary: Important grounded summary");
    expect(observation.result).to.include("Sources: https://example.com/article");
  });

  it("should format string result", () => {
    const mockResult: ToolExecutionResult = {
      success: true,
      data: "This is a string result",
      metadata: { executionTime: 100, toolName: "test_tool" },
    };

    const action: ReasoningStep["action"] = {
      tool: "test_tool",
      purpose: "Testing tool",
      params: { param1: "value1" },
    };

    const formatted = toolHandler.formatToolResult(mockResult, action);

    expect(formatted).to.include("Tool: test_tool");
    expect(formatted).to.include("Purpose: Testing tool");
    expect(formatted).to.include('Parameters: {"param1":"value1"}');
    expect(formatted).to.include("This is a string result");
  });

  it("should format array result", () => {
    const mockResult: ToolExecutionResult = {
      success: true,
      data: [1, 2, 3, 4, 5],
      metadata: { executionTime: 100, toolName: "test_tool" },
    };

    const action: ReasoningStep["action"] = {
      tool: "test_tool",
      params: {},
    };

    const formatted = toolHandler.formatToolResult(mockResult, action);

    expect(formatted).to.include("Tool: test_tool");
    expect(formatted).to.include("Observation summary: Tool test_tool returned 5 items.");
    expect(formatted).to.include('"count": 5');
    expect(formatted).to.include('"sample": 1');
  });

  it("should format object result", () => {
    const mockResult: ToolExecutionResult = {
      success: true,
      data: { key1: "value1", key2: "value2" },
      metadata: { executionTime: 100, toolName: "test_tool" },
    };

    const action: ReasoningStep["action"] = {
      tool: "test_tool",
      params: {},
    };

    const formatted = toolHandler.formatToolResult(mockResult, action);

    expect(formatted).to.include("Tool: test_tool");
    expect(formatted).to.include('"key1": "value1"');
    expect(formatted).to.include('"key2": "value2"');
  });

  it("should handle array of objects specially", () => {
    const mockResult: ToolExecutionResult = {
      success: true,
      data: [
        { id: 1, name: "Item 1" },
        { id: 2, name: "Item 2" },
      ],
      metadata: { executionTime: 100, toolName: "test_tool" },
    };

    const action: ReasoningStep["action"] = {
      tool: "test_tool",
      params: {},
    };

    const formatted = toolHandler.formatToolResult(mockResult, action);

    expect(formatted).to.include(
      "Observation summary: Tool test_tool returned 2 items.",
    );
    expect(formatted).to.include('"sample": {');
    expect(formatted).to.include('"id": 1');
    expect(formatted).to.include('"name": "Item 1"');
  });

  it("should handle failed results", () => {
    const mockResult: ToolExecutionResult = {
      success: false,
      error: new Error("Test error"),
      metadata: { executionTime: 100, toolName: "test_tool" },
    };

    const action: ReasoningStep["action"] = {
      tool: "test_tool",
      params: {},
    };

    const formatted = toolHandler.formatToolResult(mockResult, action);

    expect(formatted).to.include("Tool: test_tool");
    expect(formatted).to.include("Parameters: {}");
    expect(formatted).to.include("Error: Test error");
    expect(formatted).to.include("Recommendation:");
  });

  it("should parse failed results into grounded error observations", () => {
    const action: ReasoningStep["action"] = {
      tool: "test_tool",
      params: { query: "broken" },
    };

    const observation = toolHandler.parseErrorObservation(
      new Error("Test error"),
      action,
    );

    expect(observation.kind).to.equal("error");
    expect(observation.summary).to.equal(
      "Tool test_tool failed: Test error",
    );
    expect(observation.error?.message).to.equal("Test error");
    expect(observation.error?.kind).to.equal("unknown");
    expect(observation.result).to.include("Tool: test_tool");
    expect(observation.result).to.include("Recommendation:");
  });
});
