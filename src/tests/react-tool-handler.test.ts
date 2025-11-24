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

    expect(step.observation).to.deep.equal({ result: formattedResult });
    expect(step.isComplete).to.be.false;
    expect(step.stepId).to.match(/^obs_\d+$/);
    expect(typeof step.timestamp).to.equal("string");
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
    expect(formatted).to.include("1. 1");
    expect(formatted).to.include("2. 2");
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

    expect(formatted).to.include("Item 1:");
    expect(formatted).to.include("Item 2:");
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
});
