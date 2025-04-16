import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import { ToolFormatter } from '../../tools/tool-formatter.js';
import { ToolDefinition } from '../../tools/mcp/types/tools.js';
import { ReasoningStep } from '../../interfaces/react-types.js';
import { ToolExecutionResult } from '../../tools/tool-chain/tool-chain-executor.js';

describe('ToolFormatter', () => {
  let formatter: ToolFormatter;
  
  beforeEach(() => {
    formatter = new ToolFormatter(2000);
  });
  
  describe('formatToolDescription', () => {
    it('should format a basic tool definition correctly', () => {
      const toolDef: ToolDefinition = {
        name: 'testTool',
        description: 'A test tool for unit testing',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query'
            }
          },
          required: ['query']
        }
      };
      
      const result = formatter.formatToolDescription(toolDef);
      
      expect(result).to.include('Tool: testTool');
      expect(result).to.include('Description: A test tool for unit testing');
      expect(result).to.include('query (required): string: The search query');
    });
    
    it('should handle optional parameters correctly', () => {
      const toolDef: ToolDefinition = {
        name: 'complexTool',
        description: 'A complex test tool',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Required parameter'
            },
            limit: {
              type: 'number',
              description: 'Optional parameter'
            }
          },
          required: ['query']
        }
      };
      
      const result = formatter.formatToolDescription(toolDef);
      
      expect(result).to.include('query (required)');
      expect(result).to.include('limit (optional)');
    });
    
    it('should include version information if available', () => {
      const toolDef: ToolDefinition = {
        name: 'versionedTool',
        description: 'A tool with version',
        version: '1.2.3',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      };
      
      const result = formatter.formatToolDescription(toolDef);
      
      expect(result).to.include('Version: 1.2.3');
    });
  });
  
  describe('formatToolDescriptions', () => {
    it('should format multiple tools correctly', () => {
      const tools: ToolDefinition[] = [
        {
          name: 'tool1',
          description: 'First tool',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          }
        },
        {
          name: 'tool2',
          description: 'Second tool',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      ];
      
      const result = formatter.formatToolDescriptions(tools);
      
      expect(result).to.include('Available Tools:');
      expect(result).to.include('Tool: tool1');
      expect(result).to.include('Tool: tool2');
    });
    
    it('should handle empty tool list', () => {
      const result = formatter.formatToolDescriptions([]);
      
      expect(result).to.equal('No tools available.');
    });
  });
  
  describe('formatToolResult', () => {
    const mockAction = {
      tool: 'testTool',
      purpose: 'testing',
      params: { query: 'test' }
    };
    
    it('should format string result correctly', () => {
      const result: ToolExecutionResult = {
        success: true,
        data: 'This is a string result',
        metadata: {
          executionTime: 100,
          toolName: 'testTool'
        }
      };
      
      const formatted = formatter.formatToolResult(result, mockAction);
      
      expect(formatted).to.include('Tool: testTool');
      expect(formatted).to.include('Purpose: testing');
      expect(formatted).to.include('This is a string result');
      expect(formatted).to.include('Execution time: 100ms');
    });
    
    it('should format array result correctly', () => {
      const result: ToolExecutionResult = {
        success: true,
        data: ['item1', 'item2', 'item3'],
        metadata: {
          executionTime: 150,
          toolName: 'testTool'
        }
      };
      
      const formatted = formatter.formatToolResult(result, mockAction);
      
      expect(formatted).to.include('1. "item1"');
      expect(formatted).to.include('2. "item2"');
      expect(formatted).to.include('3. "item3"');
    });
    
    it('should format object result correctly', () => {
      const result: ToolExecutionResult = {
        success: true,
        data: { key1: 'value1', key2: 'value2' },
        metadata: {
          executionTime: 120,
          toolName: 'testTool'
        }
      };
      
      const formatted = formatter.formatToolResult(result, mockAction);
      
      expect(formatted).to.include('"key1": "value1"');
      expect(formatted).to.include('"key2": "value2"');
    });
    
    it('should apply special formatting for search tools', () => {
      const searchAction = {
        tool: 'search',
        purpose: 'searching',
        params: { query: 'test' }
      };
      
      const result: ToolExecutionResult = {
        success: true,
        data: 'Result 1\n\nResult 2\n\nResult 3',
        metadata: {
          executionTime: 200,
          toolName: 'search'
        }
      };
      
      const formatted = formatter.formatToolResult(result, searchAction);
      
      expect(formatted).to.include('Search Result 1:');
      expect(formatted).to.include('Search Result 2:');
      expect(formatted).to.include('Search Result 3:');
    });
    
    it('should format error results correctly', () => {
      const result: ToolExecutionResult = {
        success: false,
        data: undefined,
        error: new Error('Test error'),
        metadata: {
          executionTime: 50,
          toolName: 'testTool'
        }
      };
      
      const formatted = formatter.formatToolResult(result, mockAction);
      
      expect(formatted).to.include('Error: Test error');
      expect(formatted).to.include('Recommendation:');
    });
    
    it('should handle missing action gracefully', () => {
      const result: ToolExecutionResult = {
        success: true,
        data: 'Test data',
        metadata: {
          executionTime: 100,
          toolName: 'unknown'
        }
      };
      
      const formatted = formatter.formatToolResult(result, undefined);
      
      expect(formatted).to.include('action details are missing');
    });
  });
}); 