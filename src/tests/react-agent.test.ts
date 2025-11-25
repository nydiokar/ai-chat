import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import { ReActAgent } from "../agents/react-agent.js";
import { ReActPromptGenerator } from "../prompt/react-prompt-generator.js";
import { MCPContainer } from "../tools/mcp/di/container.js";
import { AgentFactory } from "../agents/agent-factory.js";
import sinon from "sinon";

describe("ReActAgent", () => {
  let mockLLMProvider: any;
  let mockMemoryProvider: any;
  let mockToolManager: any;
  let mockContainer: any;
  let mockPromptGenerator: any;
  let mockLogger: any;
  let agent: any;

  beforeEach(async () => {
    // Create mocks
    mockLogger = {
      debug: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    mockLLMProvider = {
      generateResponse: sinon.stub().resolves({
        content: "Default response",
        tokenCount: 10,
        toolResults: [],
      }),
      setSystemPrompt: sinon.stub(),
      getModel: () => "test-model",
      cleanup: sinon.stub().resolves(),
    };

    mockMemoryProvider = {
      store: sinon.stub().resolves(),
      search: sinon.stub().resolves({ entries: [] }),
      initialize: sinon.stub().resolves(),
    };

    mockToolManager = {
      getAvailableTools: sinon.stub().resolves([
        {
          name: "test_tool",
          description: "A test tool",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        },
      ]),
      executeTool: sinon.stub().resolves({
        success: true,
        data: "Test tool result",
      }),
    };

    mockContainer = {
      getToolManager: () => mockToolManager,
    };

    mockPromptGenerator = {
      generatePrompt: sinon.stub().resolves("Test prompt"),
      generateSimplePrompt: sinon.stub().resolves("Simple prompt"),
      generateReActPrompt: sinon.stub().resolves("ReAct prompt"),
      generateFollowUpPrompt: sinon.stub().resolves("Follow-up prompt"),
    };

    // Create agent using AgentFactory (intended for testing)
    agent = await AgentFactory.createReActAgent(
      mockContainer as unknown as MCPContainer,
      mockLLMProvider,
      mockMemoryProvider,
      mockToolManager,
      mockPromptGenerator as unknown as ReActPromptGenerator,
      "Test Agent",
    );

    // @ts-ignore - Replace the logger with our mock
    agent.logger = mockLogger;
  });

  describe("processMessage", () => {
    it("should use simple mode for basic queries", async () => {
      // Setup
      const message = "Hello, how are you?";
      mockLLMProvider.generateResponse.resolves({
        content: "I am doing well, thank you!",
        tokenCount: 10,
        toolResults: [],
      });

      // Execute
      const result = await agent.processMessage(message);

      // Debug logs
      console.log(
        "System Prompt:",
        mockLLMProvider.setSystemPrompt.args[0]?.[0],
      );
      console.log("Response:", result);

      // Verify
      expect(result.content).to.equal("I am doing well, thank you!");
      expect(mockLLMProvider.setSystemPrompt.calledWith("Simple prompt")).to.be
        .true;
      expect(mockLLMProvider.generateResponse.calledOnce).to.be.true;
    });

    it("should execute a tool and return the result", async () => {
      // Setup for tool execution
      const message = "Use the test tool to fetch data";

      // Mock the ReActEngine to return the expected result
      // In a real scenario, the engine would execute the tool and return the final answer
      const mockEngine = {
        process: sinon
          .stub()
          .resolves("Here is the tool result: Test tool result"),
        getLastReasoningStep: sinon.stub().resolves(null),
        executeToolDirectly: sinon.stub().resolves("Test tool result"),
      };

      // Replace the engine in the agent
      // @ts-ignore - Replace the engine with our mock
      agent.engine = mockEngine;

      // Execute
      const result = await agent.processMessage(message);

      // Verify
      expect(result.content).to.include("Test tool result");
      expect(mockEngine.process.calledOnce).to.be.true;
      expect(mockEngine.process.calledWith(message, "default-user")).to.be.true;
      // ReActAgent doesn't return toolResults in the Response object
      expect(result.toolResults).to.have.length(0);
    });
  });

  describe("AgentFactory", () => {
    it("should create a ReAct agent with all dependencies", async () => {
      // Setup
      const factory = AgentFactory;
      mockPromptGenerator = new ReActPromptGenerator(mockToolManager);

      // Execute
      const agent = await factory.createReActAgent(
        mockContainer as unknown as MCPContainer,
        mockLLMProvider,
        mockMemoryProvider,
        mockToolManager,
        mockPromptGenerator,
        "Test Agent",
      );

      // Verify
      expect(agent).to.be.instanceOf(ReActAgent);
      expect(agent.id).to.be.a("string");
      expect(agent.name).to.equal("Test Agent");
    });
  });
});
