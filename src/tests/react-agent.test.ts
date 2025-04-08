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
  let agent: ReActAgent;

  beforeEach(() => {
    // Create mocks
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

    // Create agent
    agent = new ReActAgent(
      mockContainer as unknown as MCPContainer,
      mockLLMProvider,
      mockMemoryProvider,
      mockToolManager,
      mockPromptGenerator as unknown as ReActPromptGenerator
    );
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

      // Verify
      expect(result.content).to.equal('I am doing well, thank you!');
      expect(mockLLMProvider.setSystemPrompt.calledWith('Simple prompt')).to.be.true;
      expect(mockLLMProvider.generateResponse.calledOnce).to.be.true;
    });

    it('should use ReAct mode for complex queries', async () => {
      // Setup for complex query
      const message = 'Research the latest advancements in artificial intelligence and create a summary';
      
      // Setup first response with tool call
      mockLLMProvider.generateResponse.onFirstCall().resolves({
        content: 'I need to search for information',
        tokenCount: 20,
        toolResults: [
          {
            success: false, // Not executed yet
            data: '',
            metadata: {
              toolName: 'test_tool',
              toolCallId: 'call_123',
              arguments: JSON.stringify({ query: 'AI advancements 2023' })
            }
          }
        ]
      });

      // Setup second response after tool call
      mockLLMProvider.generateResponse.onSecondCall().resolves({
        content: 'Based on my research, AI has advanced significantly in 2023.',
        tokenCount: 30,
        toolResults: []
      });

      // Execute
      const result = await agent.processMessage(message);

      // Verify
      expect(result.content).to.equal('Based on my research, AI has advanced significantly in 2023.');
      expect(mockLLMProvider.setSystemPrompt.calledWith('ReAct prompt')).to.be.true;
      expect(mockToolManager.executeTool.calledOnce).to.be.true;
      expect(mockMemoryProvider.store.calledThrice).to.be.true;
    });
  });

  describe('AgentFactory', () => {
    it('should create a ReAct agent with all dependencies', async () => {
      // Setup
      const factory = AgentFactory;
      
      // Execute
      const agent = await factory.createReActAgent(
        mockContainer as unknown as MCPContainer,
        mockLLMProvider,
        mockMemoryProvider,
        mockToolManager
      );
      
      // Verify
      expect(agent).to.be.instanceOf(ReActAgent);
      expect(agent.id).to.be.a('string');
      expect(agent.name).to.equal('ReAct Agent');
    });
  });
}); 