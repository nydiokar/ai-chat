import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import sinon from 'sinon';
import { ReActPromptGenerator } from '../../prompt/react-prompt-generator.js';
import { ToolFormatter } from '../../tools/tool-formatter.js';
import { IToolManager } from '../../tools/mcp/interfaces/core.js';
import { ToolDefinition } from '../../tools/mcp/types/tools.js';
import { ReasoningStep } from '../../interfaces/react-types.js';

// Mock implementation of ToolManager
class MockToolManager implements IToolManager {
  private tools: ToolDefinition[] = [];
  
  constructor(mockTools: ToolDefinition[] = []) {
    this.tools = mockTools;
  }
  
  registerTool(name: string, handler: (args: any) => Promise<any>): void {
    // Mock implementation - store the handler but don't actually use it in the test
    this.tools.push({
      name,
      description: 'Mock generated tool',
      inputSchema: { type: 'object', properties: {}, required: [] }
    });
  }
  
  async getAvailableTools(): Promise<ToolDefinition[]> {
    return this.tools;
  }
  
  async getToolByName(name: string): Promise<ToolDefinition | undefined> {
    return this.tools.find(tool => tool.name === name);
  }
  
  async executeTool(name: string, args: any): Promise<any> {
    return { success: true, data: `Mock execution of ${name}` };
  }
  
  async refreshToolInformation(): Promise<void> {
    // Mock implementation, does nothing
    return;
  }
}

describe('ReActPromptGenerator', () => {
  let promptGenerator: ReActPromptGenerator;
  let toolManager: MockToolManager;
  let sandbox: sinon.SinonSandbox;
  
  // Mock tools for testing
  const mockTools: ToolDefinition[] = [
    {
      name: 'search',
      description: 'Search for information',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' }
        },
        required: ['query']
      }
    },
    {
      name: 'calculator',
      description: 'Perform calculations',
      inputSchema: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Math expression' }
        },
        required: ['expression']
      }
    }
  ];
  
  // Mock reasoning steps
  const mockSteps: ReasoningStep[] = [
    {
      stepId: 'thought_1',
      thought: {
        reasoning: 'I need to search for information',
        plan: 'Use the search tool'
      },
      timestamp: new Date().toISOString(),
      isComplete: false
    },
    {
      stepId: 'action_1',
      action: {
        tool: 'search',
        params: { query: 'test query' },
        purpose: 'Finding information'
      },
      timestamp: new Date().toISOString(),
      isComplete: false
    },
    {
      stepId: 'obs_1',
      observation: {
        result: 'Search result data'
      },
      timestamp: new Date().toISOString(),
      isComplete: false
    }
  ];
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    toolManager = new MockToolManager(mockTools);
    promptGenerator = new ReActPromptGenerator(toolManager);
  });
  
  afterEach(() => {
    sandbox.restore();
  });
  
  describe('formatTools integration', () => {
    it('should use ToolFormatter to format tools', async () => {
      // Create a spy on the toolFormatter.formatToolDescriptions method
      const formatSpy = sandbox.spy(
        (promptGenerator as any).toolFormatter, 
        'formatToolDescriptions'
      );
      
      // Call a method that should use formatTools internally
      await promptGenerator.generateReActPrompt('test query', [], mockTools);
      
      // Verify the spy was called with the mock tools
      expect(formatSpy.calledOnce).to.be.true;
      expect(formatSpy.firstCall.args[0]).to.deep.equal(mockTools);
    });
  });
  
  describe('generateReActPrompt', () => {
    it('should include formatted tools in the prompt', async () => {
      const prompt = await promptGenerator.generateReActPrompt('test query', [], mockTools);
      
      // Verify prompt contains tool names and descriptions
      expect(prompt).to.include('search');
      expect(prompt).to.include('Search for information');
      expect(prompt).to.include('calculator');
      expect(prompt).to.include('Perform calculations');
    });
    
    it('should include formatted reasoning steps in the prompt', async () => {
      const prompt = await promptGenerator.generateReActPrompt('test query', mockSteps, mockTools);
      
      // Verify prompt contains step information
      expect(prompt).to.include('I need to search for information');
      expect(prompt).to.include('Use the search tool');
      expect(prompt).to.include('Search result data');
    });
    
    it('should include appropriate guidance based on step count', async () => {
      // Test with no steps (initial prompt)
      const initialPrompt = await promptGenerator.generateReActPrompt('test query', [], mockTools);
      expect(initialPrompt).to.include('thinking about the problem');
      
      // Need to create a mock with an observation for this test
      // Create a mock with observation data
      const stepsWithObservation = [
        {
          stepId: 'thought_1',
          thought: {
            reasoning: 'I need to search for information',
            plan: 'Use the search tool'
          },
          timestamp: new Date().toISOString(),
          isComplete: false
        },
        {
          stepId: 'action_1',
          action: {
            tool: 'search',
            params: { query: 'test query' },
            purpose: 'Finding information'
          },
          timestamp: new Date().toISOString(),
          isComplete: false
        },
        {
          stepId: 'obs_1',
          observation: {
            result: 'Search result data'
          },
          timestamp: new Date().toISOString(),
          isComplete: false
        }
      ];
      
      // Test with steps that include an observation (follow-up prompt)
      const followUpPrompt = await promptGenerator.generateReActPrompt('test query', stepsWithObservation, mockTools);
      expect(followUpPrompt).to.include('Based on the observation above');
    });
  });
  
  describe('generateFollowUpPrompt', () => {
    it('should format tool results for follow-up prompts', async () => {
      const toolResult = {
        success: true,
        data: 'Test result data'
      };
      
      const prompt = await promptGenerator.generateFollowUpPrompt(
        'original question',
        mockSteps,
        toolResult
      );
      
      // Verify prompt contains result and context
      expect(prompt).to.include('Original query: original question');
      expect(prompt).to.include('Latest tool result:');
      expect(prompt).to.include('Test result data');
      expect(prompt).to.include('Previous steps summary:');
    });
  });
  
  describe('tool prioritization', () => {
    it('should prioritize search tools for search queries', async () => {
      // Add more tools for testing prioritization
      const expandedTools: ToolDefinition[] = [
        ...mockTools,
        {
          name: 'web_search',
          description: 'Search the web',
          inputSchema: {
            type: 'object',
            properties: { 
              query: { type: 'string' } 
            },
            required: ['query']
          }
        },
        {
          name: 'other_tool',
          description: 'Not a search tool',
          inputSchema: {
            type: 'object',
            properties: { 
              param: { type: 'string' } 
            },
            required: ['param']
          }
        }
      ];
      
      toolManager = new MockToolManager(expandedTools);
      promptGenerator = new ReActPromptGenerator(toolManager);
      
      const tools = await promptGenerator.getTools('search for information about cats');
      
      // Verify search tools are prioritized
      const searchIndices = tools
        .map((tool, index) => tool.name.includes('search') ? index : -1)
        .filter(index => index !== -1);
      
      const nonSearchIndices = tools
        .map((tool, index) => !tool.name.includes('search') ? index : -1)
        .filter(index => index !== -1);
      
      // All search tool indices should be less than all non-search indices
      searchIndices.forEach(searchIdx => {
        nonSearchIndices.forEach(nonSearchIdx => {
          expect(searchIdx).to.be.lessThan(nonSearchIdx);
        });
      });
    });
    
    it('should skip tool loading for basic greetings', async () => {
      const spy = sandbox.spy(toolManager, 'getAvailableTools');
      
      await promptGenerator.getTools('hello');
      
      // Tool manager should not be called for basic greetings
      expect(spy.called).to.be.false;
    });
  });
  
  describe('error handling', () => {
    it('should provide a fallback prompt on error', async () => {
      // Force an error by making the toolFormatter throw
      sandbox.stub((promptGenerator as any).toolFormatter, 'formatToolDescriptions')
        .throws(new Error('Test error'));
      
      // Should not throw but use fallback
      const prompt = await promptGenerator.generateReActPrompt('test query', [], mockTools);
      
      expect(prompt).to.include('helpful AI assistant');
      expect(prompt).to.include('test query');
    });
  });
}); 