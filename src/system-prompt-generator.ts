import { MCPToolDefinition } from "./types/index.js";
import { ToolInformationProvider } from "./types/tools.js";

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
        private toolProvider: ToolInformationProvider
    ) {}

    async generatePrompt(systemPrompt: string = "", message: string = ""): Promise<string> {
        const tools = await this.toolProvider.getAvailableTools();
        
        const promptParts = [
            systemPrompt || this.defaultIdentity,
            this.toolUsageInstructions
        ];

        if (tools.length > 0) {
            promptParts.push(
                "\nAvailable Tools:",
                ...tools.map(tool => this.formatToolInfo(tool))
            );
        }

        if (message && this.isToolUsageLikely(message)) {
            promptParts.push(
                "Note: This request might require tool usage. Consider the available tools and their capabilities. " +
                "Remember to handle errors gracefully and use hints when provided."
            );
        }

        return promptParts.join("\n\n");
    }

    private formatToolInfo(tool: MCPToolDefinition): string {
        const parts = [
            `Tool: ${tool.name}`,
            tool.description && `Description: ${tool.description}`
        ];

        if (tool.inputSchema) {
            try {
                const schemaStr = tool.inputSchema.toString();
                if (schemaStr.length < 500) {
                    parts.push(`Schema: ${schemaStr}`);
                } else {
                    // For large schemas, just show a simplified version
                    parts.push('Schema: [Complex schema - see documentation for details]');
                }
            } catch (error) {
                console.error('Error formatting tool schema:', error);
                parts.push('Schema: [Schema information unavailable]');
            }
        }

        if (tool.examples?.length) {
            parts.push('Examples:');
            tool.examples.slice(0, 2).forEach(example => {
                parts.push(`- ${example}`);
            });
        }

        if (tool.metadata) {
            const relevantMetadata = this.filterRelevantMetadata(tool.metadata);
            if (Object.keys(relevantMetadata).length > 0) {
                parts.push('Additional Info:');
                Object.entries(relevantMetadata).forEach(([key, value]) => {
                    parts.push(`- ${key}: ${value}`);
                });
            }
        }

        return parts.filter(Boolean).join('\n');
    }

    private filterRelevantMetadata(metadata: Record<string, unknown>): Record<string, string> {
        const relevantKeys = ['usage', 'limitations', 'permissions', 'version'];
        return Object.entries(metadata)
            .filter(([key]) => relevantKeys.includes(key))
            .reduce((acc, [key, value]) => {
                acc[key] = typeof value === 'string' ? value : JSON.stringify(value);
                return acc;
            }, {} as Record<string, string>);
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