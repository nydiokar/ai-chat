import { MCPTool } from '../../../../types';
import { OllamaToolDefinition, OllamaToolCall } from '../../../../types/ollama_types.js';

export class OllamaToolAdapter {
    static convertMCPToolToOllama(mcpTool: MCPTool): OllamaToolDefinition {
        if (!mcpTool || !mcpTool.name) {
            throw new Error('Invalid MCPTool: missing required properties');
        }

        if (process.env.DEBUG === 'true') {
            console.log(`[OllamaToolAdapter] Converting ${mcpTool.name} for Ollama format`);
        }

        // Ensure we have basic schema properties with proper validation
        const parameters = {
            type: 'object',
            properties: {},
            required: []
        };

        // Safely extract and validate input schema
        if (mcpTool.inputSchema) {
            if (mcpTool.inputSchema.properties) {
                parameters.properties = mcpTool.inputSchema.properties;
            }
            if (Array.isArray(mcpTool.inputSchema.required)) {
                parameters.required = mcpTool.inputSchema.required;
            }
        }

        // Validate the converted schema
        try {
            JSON.stringify(parameters); // Ensure it's valid JSON
        } catch (error) {
            console.error(`[OllamaToolAdapter] Invalid schema for tool ${mcpTool.name}:`, error);
            throw new Error(`Invalid schema for tool ${mcpTool.name}`);
        }

        return {
            type: "function",
            function: {
                name: mcpTool.name,
                description: mcpTool.description || `Execute ${mcpTool.name} tool`,
                parameters
            }
        };
    }

    static convertMCPToolsToOllama(mcpTools: MCPTool[]): OllamaToolDefinition[] {
        if (process.env.DEBUG === 'true') {
            console.log(`[OllamaToolAdapter] Converting ${mcpTools.length} tools`);
        }
        return mcpTools.map(tool => this.convertMCPToolToOllama(tool));
    }

    static validateToolCall(toolCall: OllamaToolCall, mcpTools: MCPTool[]): boolean {
        const tool = mcpTools.find(t => t.name === toolCall.function.name);
        if (!tool) {
            console.error(`[OllamaToolAdapter] Tool not found: ${toolCall.function.name}`);
            return false;
        }

        try {
            // Ensure arguments are an object
            const args = typeof toolCall.function.arguments === 'string' 
                ? JSON.parse(toolCall.function.arguments) 
                : toolCall.function.arguments;

            // Validate required fields
            const required = tool.inputSchema.required || [];
            const missingFields = required.filter((field: string) => !(field in args));
            
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
