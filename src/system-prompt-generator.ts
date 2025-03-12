import { ToolDefinition, ToolResponse } from "./tools/mcp/migration/types/tools.js";
import { IToolManager } from "./tools/mcp/migration/interfaces/core.js";

export class SystemPromptGenerator {
    private readonly defaultIdentity = "You are Brony, an intelligent AI assistant.";
    private readonly toolUsageInstructions = `When using tools:
1. Explain your intention clearly and concisely
2. For search and information tools:
   - Summarize key points and remove duplicates
   - Present a clear, organized response
3. For action tools (GitHub, file operations, etc.):
   - Confirm completed actions
   - Report any issues encountered
   - Handle errors gracefully using provided hints
4. For code tools:
   - Explain significant changes
   - Note any important findings
5. For tool errors:
   - Check error hints for recovery suggestions
   - Try alternative approaches if available
   - Report unrecoverable errors clearly`;

    constructor(
        private toolProvider: IToolManager
    ) {}

    async generatePrompt(systemPrompt: string = "", message: string = ""): Promise<string> {
        // Ensure tools are refreshed before getting them
        await this.toolProvider.refreshToolInformation();
        const tools = await this.toolProvider.getAvailableTools();
        
        const promptParts = [
            systemPrompt || this.defaultIdentity,
            this.toolUsageInstructions
        ];

        if (tools.length > 0) {
            console.log('[SystemPromptGenerator] Available tools:', tools.map(t => t.name));
            promptParts.push(
                "\nAvailable Tools:",
                ...tools.map(tool => this.formatToolInfo(tool))
            );
        } else {
            console.warn('[SystemPromptGenerator] No tools available');
        }

        if (message && this.isToolUsageLikely(message)) {
            promptParts.push(
                "Note: This request might require tool usage. Consider the available tools and their capabilities. " +
                "Remember to handle errors gracefully and use hints when provided."
            );
        }

        return promptParts.join("\n\n");
    }

    private formatToolInfo(tool: ToolDefinition): string {
        const parts = [
            `Tool: ${tool.name}`,
            tool.description && `Description: ${tool.description}`
        ];

        // Format input schema for OpenAI
        if (tool.inputSchema) {
            parts.push('Input Schema:');
            parts.push(JSON.stringify(tool.inputSchema, null, 2));
        } else if (tool.parameters?.length > 0) {
            const schema = {
                type: 'object',
                properties: {} as Record<string, any>,
                required: [] as string[]
            };

            tool.parameters.forEach(param => {
                schema.properties[param.name] = {
                    type: param.type.toLowerCase(),
                    description: param.description
                };
                if (param.required) {
                    schema.required.push(param.name);
                }
            });

            parts.push('Input Schema:');
            parts.push(JSON.stringify(schema, null, 2));
        }

        if (tool.server) {
            parts.push(`Server: ${tool.server.name}`);
        }

        if (tool.enabled !== undefined) {
            parts.push(`Status: ${tool.enabled ? 'Enabled' : 'Disabled'}`);
        }

        return parts.filter(Boolean).join('\n');
    }

    private isToolUsageLikely(message: string): boolean {
        const toolKeywords = [
            'search', 'find', 'look up',
            'create', 'make', 'add',
            'update', 'change', 'modify',
            'delete', 'remove',
            'run', 'execute',
            'check', 'verify',
            'analyze', 'examine',
            'tool', 'function', 'command',
            'help', 'assist', 'automate'
        ];

        const lowercaseMessage = message.toLowerCase();
        return toolKeywords.some(keyword => 
            lowercaseMessage.includes(keyword.toLowerCase())
        ) || /\b(can|could|would|please)\b.*\b(help|do|perform|execute)\b/i.test(message);
    }
}