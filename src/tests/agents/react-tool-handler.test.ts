import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import sinon from 'sinon';
import { ReActToolHandler } from '../../agents/react-tool-handler.js';
import { IToolManager } from '../../tools/mcp/interfaces/core.js';
import { ToolChainExecutor } from '../../tools/tool-chain/tool-chain-executor.js';
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

// Mock implementation of ToolChainExecutor
class MockToolChainExecutor extends ToolChainExecutor {
  constructor() {
    super();
  }
  
  async execute(config: any, registry: any, context: any): Promise<any> {
    const toolName = config.tools[0]?.name || 'unknown';
    return {
      success: true,
      data: `Mock execution result for ${toolName}`,
      metadata: {
        executionTime: 100,
        toolName
      }
    };
  }
}

describe('ReActToolHandler', () => {
  let toolHandler: ReActToolHandler;
  let toolManager: MockToolManager;
  let toolExecutor: MockToolChainExecutor;
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
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    toolManager = new MockToolManager(mockTools);
    toolExecutor = new MockToolChainExecutor();
    toolHandler = new ReActToolHandler(toolManager, toolExecutor);
  });
  
  afterEach(() => {
    sandbox.restore();
  });
  
  describe('formatToolResult', () => {
    it('should format string result correctly', () => {
      const action = {
        tool: 'testTool',
        params: { query: 'test query' },
        purpose: 'testing'
      };
      
      const result = {
        success: true,
        data: 'This is a string result',
        metadata: {
          executionTime: 100,
          toolName: 'testTool'
        }
      };
      
      const formatted = toolHandler.formatToolResult(result, action);
      
      expect(formatted).to.include('Tool: testTool');
      expect(formatted).to.include('Purpose: testing');
      expect(formatted).to.include('This is a string result');
      expect(formatted).to.include('Execution time: 100ms');
    });
    
    it('should format array result correctly', () => {
      const action = {
        tool: 'testTool',
        params: { query: 'test query' }
      };
      
      const result = {
        success: true,
        data: ['item1', 'item2', 'item3'],
        metadata: {
          executionTime: 150,
          toolName: 'testTool'
        }
      };
      
      const formatted = toolHandler.formatToolResult(result, action);
      
      expect(formatted).to.include('1. "item1"');
      expect(formatted).to.include('2. "item2"');
      expect(formatted).to.include('3. "item3"');
    });
    
    it('should format search results with special formatting', () => {
      const action = {
        tool: 'search',
        params: { query: 'test query' }
      };
      
      const result = {
        success: true,
        data: 'Result 1\n\nResult 2\n\nResult 3',
        metadata: {
          executionTime: 200,
          toolName: 'search'
        }
      };
      
      const formatted = toolHandler.formatToolResult(result, action);
      
      expect(formatted).to.include('Search Result 1:');
      expect(formatted).to.include('Search Result 2:');
      expect(formatted).to.include('Search Result 3:');
    });
    
    it('should format error results correctly', () => {
      const action = {
        tool: 'testTool',
        params: { query: 'test query' }
      };
      
      const result = {
        success: false,
        data: undefined,
        error: new Error('Test error'),
        metadata: {
          executionTime: 50,
          toolName: 'testTool'
        }
      };
      
      const formatted = toolHandler.formatToolResult(result, action);
      
      expect(formatted).to.include('Error: Test error');
      expect(formatted).to.include('Recommendation:');
    });
    
    it('should handle missing action gracefully', () => {
      const result = {
        success: true,
        data: 'Test data',
        metadata: {
          executionTime: 100,
          toolName: 'unknown'
        }
      };
      
      const formatted = toolHandler.formatToolResult(result, undefined);
      
      expect(formatted).to.include('action details are missing');
    });
  });
  
  describe('getToolRegistry', () => {
    it('should create a registry with all available tools', async () => {
      const registry = await toolHandler.getToolRegistry();
      
      expect(Object.keys(registry)).to.have.length(2);
      expect(registry).to.have.property('search');
      expect(registry).to.have.property('calculator');
      expect(typeof registry.search).to.equal('function');
    });
    
    it('should handle errors when getting tools', async () => {
      // Force an error in getAvailableTools
      sandbox.stub(toolManager, 'getAvailableTools').throws(new Error('Test error'));
      
      const registry = await toolHandler.getToolRegistry();
      
      // Should return an empty registry on error
      expect(Object.keys(registry)).to.have.length(0);
    });
  });
  
  describe('executeToolWithRegistry', () => {
    it('should execute a tool using the tool chain executor', async () => {
      const executeSpy = sandbox.spy(toolExecutor, 'execute');
      
      const action = {
        tool: 'search',
        params: { query: 'test query' }
      };
      
      const registry = {
        search: async (params: any) => ({ success: true, data: 'search result' })
      };
      
      await toolHandler.executeToolWithRegistry(action, registry, 'user123');
      
      expect(executeSpy.calledOnce).to.be.true;
      const configArg = executeSpy.firstCall.args[0];
      expect(configArg.tools[0].name).to.equal('search');
    });
    
    it('should throw an error when action is undefined', async () => {
      const registry = {};
      
      try {
        await toolHandler.executeToolWithRegistry(undefined, registry, 'user123');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.include('action is undefined');
      }
    });
  });
  
  describe('createObservationStep', () => {
    it('should create a properly formatted observation step', () => {
      const result = 'Test observation result';
      
      const step = toolHandler.createObservationStep(result);
      
      expect(step.stepId).to.include('obs_');
      expect(step.observation).to.exist;
      expect(step.observation!.result).to.equal(result);
      expect(step.isComplete).to.be.false;
      expect(step.timestamp).to.exist;
    });
  });
}); 