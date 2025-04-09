import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { ReActAgent } from '../agents/react-agent.js';
import { ReActPromptGenerator } from '../prompt/react-prompt-generator.js';
import { MCPContainer } from '../tools/mcp/di/container.js';
import { AgentFactory } from '../agents/agent-factory.js';
import sinon from 'sinon';

describe('ReActAgent', () => {
  let mockLLMProvider: any;
  let mockMemoryProvider: any;
  let mockToolManager: any;
  let mockContainer: any;
  let mockPromptGenerator: any;
  let mockLogger: any;
  let agent: ReActAgent;

  beforeEach(() => {
    // Create mocks
    mockLogger = {
      debug: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub()
    };

    mockLLMProvider = {
      generateResponse: sinon.stub(),
      setSystemPrompt: sinon.stub(),
      getModel: () => 'test-model',
      cleanup: sinon.stub().resolves()
    };

    mockMemoryProvider = {
      store: sinon.stub().resolves(),
      search: sinon.stub().resolves({ entries: [] }),
      initialize: sinon.stub().resolves()
    };

    mockToolManager = {
      getAvailableTools: sinon.stub().resolves([
        {
          name: 'test_tool',
          description: 'A test tool',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' }
            },
            required: ['query']
          }
        }
      ]),
      executeTool: sinon.stub().resolves({
        success: true,
        data: 'Test tool result'
      })
    };

    mockContainer = {
      getToolManager: () => mockToolManager
    };

    mockPromptGenerator = {
      generatePrompt: sinon.stub().resolves('Test prompt'),
      generateSimplePrompt: sinon.stub().resolves('Simple prompt'),
      generateReActPrompt: sinon.stub().resolves('ReAct prompt'),
      generateFollowUpPrompt: sinon.stub().resolves('Follow-up prompt')
    };

    // Create agent with mocked logger
    agent = new ReActAgent(
      mockContainer as unknown as MCPContainer,
      mockLLMProvider,
      mockMemoryProvider,
      mockToolManager,
      mockPromptGenerator as unknown as ReActPromptGenerator
    );
    
    // @ts-ignore - Replace the logger with our mock
    agent.logger = mockLogger;
  });

  describe('processMessage', () => {
    it('should use simple mode for basic queries', async () => {
      // Setup
      const message = 'Hello, how are you?';
      mockLLMProvider.generateResponse.resolves({
        content: 'I am doing well, thank you!',
        tokenCount: 10,
        toolResults: []
      });

      // Execute
      const result = await agent.processMessage(message);

      // Debug logs
      console.log('System Prompt:', mockLLMProvider.setSystemPrompt.args[0]?.[0]);
      console.log('Response:', result);

      // Verify
      expect(result.content).to.equal('I am doing well, thank you!');
      expect(mockLLMProvider.setSystemPrompt.calledWith('Simple prompt')).to.be.true;
      expect(mockLLMProvider.generateResponse.calledOnce).to.be.true;
    });

    it('should execute a tool and return the result', async () => {
      // Setup for tool execution
      const message = 'Use the test tool to fetch data';
      mockLLMProvider.generateResponse.onFirstCall().resolves({
        content: 'Executing tool',
        tokenCount: 20,
        toolResults: [
          {
            success: true,
            data: 'Test tool result',
            metadata: {
              toolName: 'test_tool',
              toolCallId: 'call_123',
              arguments: JSON.stringify({ query: 'fetch data' })
            }
          }
        ]
      });

      // Mock the final response after tool execution
      mockLLMProvider.generateResponse.onSecondCall().resolves({
        content: 'Here is the tool result: Test tool result',
        tokenCount: 15,
        toolResults: []
      });

      try {
        // Execute
        const result = await agent.processMessage(message);

        // Debug logs
        console.log('System Prompt:', mockLLMProvider.setSystemPrompt.args[0]?.[0]);
        console.log('Response:', result);
        console.log('Tool Results:', mockToolManager.executeTool.args);
        console.log('LLM Calls:', mockLLMProvider.generateResponse.args.map((args: [string, any[], any[]]) => ({
          message: args[0],
          history: args[1],
          tools: args[2]
        })));

        // Verify
        expect(result.content).to.include('Test tool result');
        expect(mockToolManager.executeTool.calledOnce).to.be.true;
        expect(mockToolManager.executeTool.calledWith('test_tool', { query: 'fetch data' })).to.be.true;
        expect(mockMemoryProvider.store.calledOnce).to.be.true;
        expect(result.toolResults).to.have.length(1);
        expect(result.toolResults[0].data).to.equal('Test tool result');
      } catch (error: unknown) {
        console.error('Test error:', error);
        if (error instanceof Error) {
          console.error('Error stack:', error.stack);
        }
        throw error;
      }
    });
  });

  describe('AgentFactory', () => {
    it('should create a ReAct agent with all dependencies', async () => {
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
        'Test Agent'
      );
      
      // Verify
      expect(agent).to.be.instanceOf(ReActAgent);
      expect(agent.id).to.be.a('string');
      expect(agent.name).to.equal('Test Agent');
    });
  });
}); 