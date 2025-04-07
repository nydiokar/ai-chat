import { ToolDefinition } from '../../../tools/mcp/types/tools.js';
import { OllamaToolDefinition, OllamaToolCall } from '../../../types/ollama.js';

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

    static validateToolCall(toolCall: OllamaToolCall, availableTools: ToolDefinition[]): boolean {
        const tool = availableTools.find(t => t.name === toolCall.function.name);
        if (!tool) return false;

        try {
            // Ensure arguments is an object
            const args = toolCall.function.arguments;
            
            // Basic validation that all required parameters are present
            const requiredParams = tool.inputSchema.required || [];
            return requiredParams.every(param => args.hasOwnProperty(param));
        } catch {
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
