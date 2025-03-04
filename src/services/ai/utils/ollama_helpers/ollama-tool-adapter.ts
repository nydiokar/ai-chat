import { MCPTool } from '../../../../types';
import { OllamaToolDefinition, OllamaToolCall } from '../../../../types/ollama';

export class OllamaToolAdapter {
    static convertMCPToolToOllama(mcpTool: MCPTool): OllamaToolDefinition {
        return {
            type: "function",
            function: {
                name: mcpTool.name,
                description: mcpTool.description,
                parameters: {
                    type: "object",
                    properties: mcpTool.inputSchema.properties || {},
                    required: mcpTool.inputSchema.required || []
                }
            }
        };
    }

    static convertMCPToolsToOllama(mcpTools: MCPTool[]): OllamaToolDefinition[] {
        return mcpTools.map(tool => this.convertMCPToolToOllama(tool));
    }

    static validateToolCall(toolCall: OllamaToolCall, mcpTools: MCPTool[]): boolean {
        const tool = mcpTools.find(t => t.name === toolCall.function.name);
        if (!tool) return false;

        // Basic schema validation
        const schema = tool.inputSchema;
        if (schema.required) {
            const missingRequired = schema.required.filter(
                (field: string) => !(field in toolCall.function.arguments)
            );
            if (missingRequired.length > 0) return false;
        }

        return true;
    }
} 