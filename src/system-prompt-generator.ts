import { ToolDefinition } from "./tools/mcp/types/tools.js";
import { IToolManager } from "./tools/mcp/interfaces/core.js";
import { ToolCache } from "./services/cache/specialized/tool-cache.js";
import { debug } from "./utils/config.js";

export class SystemPromptGenerator {
    private readonly defaultIdentity = "You are Brony, an intelligent AI assistant.";
    private readonly toolUsageInstructions = `When using tools:
1. Explain your intention clearly and concisely
2. For search and information tools:
   - Summarize key points and remove duplicates
3. For action tools (GitHub, file operations, etc.):
   - Confirm completed actions
   - Handle errors gracefully
4. For code tools:
   - Explain significant changes
5. For tool errors:
   - Try alternative approaches if available`;

    private toolCache: ToolCache;

    constructor(
        private toolProvider: IToolManager
    ) {
        this.toolCache = ToolCache.getInstance();
    }

    async generatePrompt(systemPrompt: string = "", message: string = ""): Promise<string> {
        const relevantTools = await this.getRelevantTools(message);
        
        const promptParts = [
            systemPrompt || this.defaultIdentity,
            this.getMinimalInstructions(relevantTools)
        ];

        if (relevantTools.length > 0) {
            promptParts.push(
                "\nRelevant Tools:",
                ...relevantTools.map(tool => this.formatMinimalToolInfo(tool))
            );
        }

        return promptParts.join("\n\n");
    }

    private async getRelevantTools(message: string): Promise<ToolDefinition[]> {
        try {
            // Try cache first
            const cachedTools = await this.toolCache.get<ToolDefinition[]>('relevantTools', message);
            if (cachedTools) {
                debug('Using cached tools');
                return cachedTools;
            }

            // Get fresh tools if not in cache
            await this.toolProvider.refreshToolInformation();
            const allTools = await this.toolProvider.getAvailableTools();
            
            const relevantTools = this.filterRelevantTools(allTools, message);
            
            // Cache the filtered tools
            await this.toolCache.set('relevantTools', message, relevantTools, {
                ttl: 5 * 60,  // 5 minutes
                tags: ['tools', 'relevance']
            });
            
            return relevantTools;
        } catch (error) {
            debug(`Error getting relevant tools: ${error instanceof Error ? error.message : String(error)}`);
            // Fallback to getting tools directly without caching
            await this.toolProvider.refreshToolInformation();
            const allTools = await this.toolProvider.getAvailableTools();
            return this.filterRelevantTools(allTools, message);
        }
    }

    private filterRelevantTools(tools: ToolDefinition[], message: string): ToolDefinition[] {
        if (!message) return tools;
        
        const keywords = this.extractKeywords(message);
        return tools
            .filter(tool => this.isToolRelevant(tool, keywords))
            .slice(0, 5); // Limit to 5 most relevant tools
    }

    private extractKeywords(message: string): Set<string> {
        const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'with']);
        return new Set(
            message.toLowerCase()
                .split(/\s+/)
                .filter(word => word.length > 2 && !stopWords.has(word))
        );
    }

    private isToolRelevant(tool: ToolDefinition, keywords: Set<string>): boolean {
        const toolText = `${tool.name} ${tool.description || ''}`.toLowerCase();
        return Array.from(keywords).some(keyword => toolText.includes(keyword));
    }

    private getMinimalInstructions(tools: ToolDefinition[]): string {
        if (tools.length === 0) return this.toolUsageInstructions;
        
        // Only include relevant sections based on tool types
        const sections: string[] = [];
        const hasSearchTools = tools.some(t => t.name.includes('search'));
        const hasActionTools = tools.some(t => t.name.includes('create') || t.name.includes('update'));
        const hasCodeTools = tools.some(t => t.name.includes('code') || t.name.includes('file'));

        sections.push("When using tools:");
        if (hasSearchTools) sections.push("- Summarize search results concisely");
        if (hasActionTools) sections.push("- Confirm completed actions");
        if (hasCodeTools) sections.push("- Explain code changes briefly");
        sections.push("- Handle errors gracefully");

        return sections.join('\n');
    }

    private formatMinimalToolInfo(tool: ToolDefinition): string {
        const parts = [`Tool: ${tool.name}`];
        
        if (tool.description) {
            parts.push(`Description: ${tool.description}`);
        }

        // Only include minimal schema information
        if (tool.parameters?.length > 0) {
            const requiredParams = tool.parameters
                .filter(p => p.required)
                .map(p => p.name)
                .join(', ');
            if (requiredParams) {
                parts.push(`Required: ${requiredParams}`);
            }
        }

        return parts.join('\n');
    }
}