import { MCPTool } from '../../../types';
import { OllamaToolDefinition } from '../../../types/ollama';

export interface ToolResponse {
    formatted: string;
    raw: any;
}

export interface MCPToolAdapter {
    // Convert tool for Ollama's function calling format
    convertToOllamaFormat(tool: MCPTool): OllamaToolDefinition;
    
    // Format the response from the tool
    formatResponse(response: string): ToolResponse;
    
    // Validate tool call arguments
    validateArgs(args: any, schema: any): boolean;
}

export abstract class BaseToolAdapter implements MCPToolAdapter {
    convertToOllamaFormat(tool: MCPTool): OllamaToolDefinition {
        return {
            type: "function",
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema
            }
        };
    }

    abstract formatResponse(response: string): ToolResponse;
    
    validateArgs(args: any, schema: any): boolean {
        if (!schema.required) return true;
        
        return schema.required.every((field: string) => 
            field in args && args[field] !== undefined
        );
    }

    protected parseResponse(response: string): any {
        const parsed = JSON.parse(response);
        if (parsed.content?.[0]?.text) {
            return JSON.parse(parsed.content[0].text);
        }
        return parsed;
    }
}
