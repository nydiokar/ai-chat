import { ToolDefinition } from '../../../../tools/mcp/types/tools.js';
import { OllamaToolDefinition, OllamaToolCall } from '../../../../types/ollama.js';
import { z } from 'zod';

export class OllamaToolAdapter {
    static convertMCPToolToOllama(tool: ToolDefinition): OllamaToolDefinition {
        if (process.env.DEBUG) {
            console.log(`[OllamaToolAdapter] Converting ${tool.name} for Ollama format`);
        }

        return {
            type: "function",
            function: {
                name: tool.name,
                description: tool.description || `Execute ${tool.name} tool`,
                parameters: {
                    type: 'object',
                    properties: tool.inputSchema.properties,
                    required: tool.inputSchema.required
                }
            }
        };
    }

    static convertMCPToolsToOllama(tools: ToolDefinition[]): OllamaToolDefinition[] {
        return tools.map(tool => this.convertMCPToolToOllama(tool));
    }

    static validateToolCall(toolCall: OllamaToolCall, tools: ToolDefinition[]): boolean {
        const tool = tools.find(t => t.name === toolCall.function.name);
        if (!tool) {
            console.error(`[OllamaToolAdapter] Tool not found: ${toolCall.function.name}`);
            return false;
        }

        try {
            // Ensure arguments are an object
            const args = typeof toolCall.function.arguments === 'string' 
                ? JSON.parse(toolCall.function.arguments) 
                : toolCall.function.arguments;

            // Use inputSchema directly for validation
            const required = tool.inputSchema.required;
            const missingFields = required.filter(field => !(field in args));
            
            if (missingFields.length > 0) {
                console.error(`[OllamaToolAdapter] Missing required fields: ${missingFields.join(', ')}`);
                return false;
            }

            // Store normalized arguments
            toolCall.function.arguments = args;
            return true;
        } catch (error) {
            console.error('[OllamaToolAdapter] Validation error:', error);
            return false;
        }
    }

    static parseToolResult(result: string): Record<string, any> {
        try {
            const data = JSON.parse(result);
            // Parse MCP server response format if present
            if (data.content?.[0]?.text) {
                return JSON.parse(data.content[0].text);
            }
            // Otherwise return raw data
            return data;
        } catch {
            // If parsing fails, wrap raw result in content object
            return { content: result };
        }
    }
}
