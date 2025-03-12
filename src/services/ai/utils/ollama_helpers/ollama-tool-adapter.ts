import { MCPTool } from '../../../../types/tools.js';
import { OllamaToolDefinition, OllamaToolCall } from '../../../../types/ollama.js';
import { z } from 'zod';

export class OllamaToolAdapter {
    static convertMCPToolToOllama(mcpTool: MCPTool): OllamaToolDefinition {
        if (process.env.DEBUG) {
            console.log(`[OllamaToolAdapter] Converting ${mcpTool.name} for Ollama format`);
        }

        // Get schema properties using Zod's internal API
        const schema = mcpTool.inputSchema;
        const schemaDefinition = (schema as any)._def;
        const properties: Record<string, any> = {};
        const required: string[] = [];

        if (schemaDefinition.typeName === 'ZodObject') {
            const shape = schemaDefinition.shape();
            Object.entries(shape).forEach(([key, value]) => {
                const zodType = value as z.ZodType;
                const fieldDef = (zodType as any)._def;
                properties[key] = {
                    type: fieldDef.typeName.replace('Zod', '').toLowerCase(),
                    description: zodType.description || ''
                };
                if (!('isOptional' in fieldDef)) {
                    required.push(key);
                }
            });
        }

        return {
            type: "function",
            function: {
                name: mcpTool.name,
                description: mcpTool.description || `Execute ${mcpTool.name} tool`,
                parameters: {
                    type: 'object',
                    properties,
                    required
                }
            }
        };
    }

    static convertMCPToolsToOllama(mcpTools: MCPTool[]): OllamaToolDefinition[] {
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

            // Parse schema definition
            const schemaDefinition = (tool.inputSchema as any)._def;
            const required: string[] = [];

            if (schemaDefinition.typeName === 'ZodObject') {
                const shape = schemaDefinition.shape();
                Object.entries(shape).forEach(([key, value]) => {
                    const zodType = value as z.ZodType;
                    const fieldDef = (zodType as any)._def;
                    if (!('isOptional' in fieldDef)) {
                        required.push(key);
                    }
                });
            }

            // Validate required fields
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
