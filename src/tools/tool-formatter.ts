import { ToolExecutionResult } from './tool-chain/tool-chain-executor.js';
import { ToolDefinition } from './mcp/types/tools.js';
import { ReasoningStep } from '../interfaces/react-types.js';
import { getLogger } from '../utils/shared-logger.js';
import type { Logger } from 'winston';

/**
 * Formats tool descriptions and results for more effective presentation to LLMs
 * Provides specialized formatting for different types of tool results
 */
export class ToolFormatter {
  private readonly logger: Logger;
  private readonly maxResultLength: number = 2000;
  
  constructor(maxResultLength: number = 2000) {
    this.logger = getLogger('ToolFormatter');
    this.maxResultLength = maxResultLength;
  }
  
  /**
   * Format a tool definition for inclusion in a prompt
   * @param tool The tool definition to format
   * @returns Formatted tool description
   */
  public formatToolDescription(tool: ToolDefinition): string {
    try {
      let formatted = `Tool: ${tool.name}\n`;
      formatted += `Description: ${tool.description}\n`;
      
      // Format parameters from inputSchema
      if (tool.inputSchema && tool.inputSchema.properties) {
        formatted += 'Parameters:\n';
        
        const { properties, required = [] } = tool.inputSchema;
        
        Object.entries(properties).forEach(([name, schema]) => {
          const isRequired = required.includes(name);
          const requiredText = isRequired ? ' (required)' : ' (optional)';
          const type = schema.type || 'any';
          const description = schema.description ? `: ${schema.description}` : '';
          
          formatted += `  - ${name}${requiredText}: ${type}${description}\n`;
        });
      }
      
      // Add version if available
      if (tool.version) {
        formatted += `Version: ${tool.version}\n`;
      }
      
      return formatted;
    } catch (error) {
      this.logger.error('Error formatting tool description', {
        error: error instanceof Error ? error.message : String(error),
        toolName: tool.name
      });
      // Fallback to basic formatting
      return `Tool: ${tool.name}\nDescription: ${tool.description}\n`;
    }
  }
  
  /**
   * Format multiple tool definitions
   * @param tools Array of tool definitions
   * @returns Formatted tools section for prompt
   */
  public formatToolDescriptions(tools: ToolDefinition[]): string {
    if (!tools || tools.length === 0) {
      return 'No tools available.';
    }
    
    return `Available Tools:\n\n${
      tools.map(tool => this.formatToolDescription(tool)).join('\n')
    }`;
  }
  
  /**
   * Format a tool execution result
   * @param result Tool execution result
   * @param action Reasoning step action
   * @returns Formatted result string
   */
  public formatToolResult(
    result: ToolExecutionResult, 
    action: ReasoningStep['action']
  ): string {
    if (!action) {
      this.logger.warn('Cannot format result without action details');
      return 'Tool execution completed, but action details are missing.';
    }
    
    try {
      if (!result || result.data === undefined) {
        return this.formatErrorResult(result?.error, action);
      }
      
      const data = result.data;
      let formattedResult: string;
      
      // Apply different formatting based on result type
      if (typeof data === 'string') {
        formattedResult = this.formatStringResult(data, action);
      } else if (Array.isArray(data)) {
        formattedResult = this.formatArrayResult(data, action);
      } else if (typeof data === 'object' && data !== null) {
        formattedResult = this.formatObjectResult(data, action);
      } else {
        formattedResult = String(data);
      }
      
      // Add execution metadata if available
      let executionContext = '';
      if (result.metadata) {
        executionContext = `Execution time: ${result.metadata.executionTime}ms\n`;
      }
      
      // Add tool context header
      const header = `Tool: ${action.tool}\n` +
                    `Purpose: ${action.purpose || 'Not specified'}\n` +
                    `Parameters: ${JSON.stringify(action.params || {})}\n` +
                    executionContext +
                    `Result:\n`;
      
      // Truncate to max length if needed
      let finalResult = header + formattedResult;
      if (finalResult.length > this.maxResultLength) {
        finalResult = finalResult.substring(0, this.maxResultLength) + 
                      `\n\n[Result truncated. Total length: ${finalResult.length} characters]`;
      }
      
      return finalResult;
    } catch (error) {
      this.logger.error('Error formatting tool result', {
        error: error instanceof Error ? error.message : String(error),
        action: JSON.stringify(action)
      });
      return `Error formatting tool result: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  
  /**
   * Format a string result
   */
  private formatStringResult(data: string, action: ReasoningStep['action']): string {
    if (!action) return data;
    
    // For search tools, apply special formatting
    if (action.tool.includes('search') || action.tool.includes('web')) {
      return this.formatSearchResult(data);
    }
    
    // For code, add appropriate code block formatting
    if (action.tool.includes('code') || action.tool.includes('generate') || action.tool.includes('complete')) {
      return '```\n' + data + '\n```';
    }
    
    return data;
  }
  
  /**
   * Format an array result with enhanced readability
   */
  private formatArrayResult(data: any[], action: ReasoningStep['action']): string {
    if (data.length === 0) return "Empty array []";
    
    // Check if array contains objects
    if (typeof data[0] === 'object' && data[0] !== null) {
      // Format as a list of objects
      return data.map((item, index) => {
        // Format each object with indentation
        const objStr = JSON.stringify(item, null, 2)
          .split('\n')
          .map(line => `  ${line}`)
          .join('\n');
        
        return `Item ${index + 1}:\n${objStr}`;
      }).join('\n\n');
    } else {
      // Format as a simple list
      return data.map((item, index) => 
        `${index + 1}. ${JSON.stringify(item)}`
      ).join('\n');
    }
  }
  
  /**
   * Format an object result
   */
  private formatObjectResult(data: object, action: ReasoningStep['action']): string {
    if (!action) return JSON.stringify(data, null, 2);
    
    // For API responses, try to format them more readably
    if (action.tool.includes('api') || action.tool.includes('fetch')) {
      return 'API Response:\n' + JSON.stringify(data, null, 2);
    }
    
    return JSON.stringify(data, null, 2);
  }
  
  /**
   * Format search results with special formatting
   */
  private formatSearchResult(data: string): string {
    // Split into results if it looks like multiple items
    if (data.includes('\n\n')) {
      const items = data.split('\n\n');
      return items.map((item, i) => `Search Result ${i + 1}:\n${item}`).join('\n\n');
    }
    return data;
  }
  
  /**
   * Format error results
   */
  public formatErrorResult(error: Error | undefined, action: ReasoningStep['action']): string {
    if (!action) {
      return `Error: ${error ? error.message : 'Unknown error occurred'}\n` +
             `Recommendation: Please try a different approach.`;
    }
    
    const errorMsg = error ? `Error: ${error.message}` : 'Tool returned no result.';
    
    return `Tool: ${action.tool}\n` +
          `Parameters: ${JSON.stringify(action.params || {})}\n` +
          `Result: ${errorMsg}\n\n` +
          `Recommendation: Consider trying a different approach or different parameters.`;
  }
} 