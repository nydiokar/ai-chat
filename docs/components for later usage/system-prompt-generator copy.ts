// complext system prompt generator which is intended to be used at scale - this is a work in progress
// do not use, delete or modify 

import { MCPTool } from "../../types/index.js";
import { MCPServerManager } from "../../tools/mcp/mcp-server-manager.js";
import { PromptMiddleware } from "./prompt-middleware.js";
import { PromptRepository } from "./prompt-repository.js";
import { PromptContext, PromptType, ToolUsagePrompt, BehavioralPrompt, BasePrompt } from "../../types/prompts.js";
import { ToolsHandler } from "../../tools/tools-handler.js";

export class SystemPromptGenerator {
    private readonly middleware: PromptMiddleware;
    private readonly repository: PromptRepository;
    private readonly defaultIdentity = "You are Brony, an intelligent AI assistant.";

    constructor(
        private mcpManager: MCPServerManager,
        private toolsHandler: ToolsHandler
    ) {
        this.repository = new PromptRepository();
        this.middleware = new PromptMiddleware(this.repository);
        this.initializePrompts();
    }

    private initializePrompts(): void {
        // Base behavioral prompt
        const behavioralPrompt: BehavioralPrompt = {
            type: PromptType.BEHAVIORAL,
            content: `Maintain a professional and clear communication style.
- Use concise language
- Provide structured responses
- Stay focused on the task
- Be direct but courteous`,
            priority: 1,
            tone: 'professional',
            style: {
                formatting: 'concise',
                language: 'formal'
            },
            shouldApply: () => true
        };

        // Tool usage prompt
        const toolUsagePrompt: ToolUsagePrompt = {
            type: PromptType.TOOL_USAGE,
            content: `When using tools:
1. Always explain your intention before using a tool
2. Use the exact tool name as specified
3. Verify input parameters match the schema
4. Handle errors gracefully
5. Report results clearly`,
            priority: 2,
            tools: ['*'],
            usagePatterns: {
                bestPractices: ['Follow schema requirements'],
                commonErrors: ['Invalid formatting']
            },
            shouldApply: (context: PromptContext) => 
                context.tools !== undefined && context.tools.length > 0
        };

        this.repository.addPrompt(behavioralPrompt);
        this.repository.addPrompt(toolUsagePrompt);
    }

    async generatePrompt(additionalContext: string = "", request?: string): Promise<string> {
        // Analyze the request first
        const requestType = request ? 
            await this.middleware.analyzeRequestType(request) : 'general';
        
        // Only gather tools if needed based on request analysis
        const tools = requestType === 'tool_usage' ? 
            await this.gatherRelevantTools(request) : [];

        // Create context for prompt selection
        const context: PromptContext = {
            requestType,
            complexity: request ? await this.middleware.analyzeComplexity(request) : 'low',
            tools: tools.map(t => t.name)
        };

        // Get base prompts from repository
        const basePrompts = await this.repository.getPrompts(context);
        
        // Combine prompt components
        const promptParts = [
            this.defaultIdentity,
            ...basePrompts.map((p: BasePrompt) => p.content)
        ];

        // Add tool-specific information if needed
        if (tools.length > 0) {
            promptParts.push(
                "\nAvailable Tools:",
                ...tools.map(tool => this.formatToolInfo(tool))
            );
        }

        if (additionalContext) {
            promptParts.push(additionalContext);
        }

        return promptParts.join("\n\n");
    }

    private async gatherRelevantTools(request?: string): Promise<MCPTool[]> {
        if (!request) return [];

        const allTools: MCPTool[] = [];
        const serverIds = this.mcpManager.getServerIds();
        
        for (const serverId of serverIds) {
            try {
                const server = this.mcpManager.getServerByIds(serverId);
                if (server) {
                    const serverTools = await server.listTools();
                    if (serverTools) {
                        // Get tool context and usage patterns if available
                        const enhancedTools = await Promise.all(
                            serverTools.map(async tool => {
                                const context = await this.toolsHandler.getToolContext(tool.name);
                                return {
                                    ...tool,
                                    context
                                };
                            })
                        );
                        allTools.push(...enhancedTools);
                    }
                }
            } catch (error) {
                console.error(`Error getting tools for server ${serverId}:`, error);
            }
        }

        // Use middleware to help determine tool relevance
        return allTools.filter(tool => this.isToolRelevant(tool, request));
    }

    private formatToolInfo(tool: MCPTool): string {
        const parts = [
            `Tool: ${tool.name}`,
            tool.description && `Description: ${tool.description}`
        ];

        // Only include schema if it's not a standard schema
        if (tool.inputSchema && !this.isStandardSchema(tool.inputSchema)) {
            parts.push(`Input Schema: ${JSON.stringify(tool.inputSchema, null, 2)}`);
        }

        // Add usage patterns if available
        if (tool.context?.patterns) {
            const patterns = Object.entries(tool.context.patterns)
                .map(([param, data]) => `${param}: ${(data as any).mostCommon?.[0]}`)
                .filter(pattern => pattern && !pattern.includes('undefined'))
                .join(', ');
            
            if (patterns) {
                parts.push(`Common Usage: ${patterns}`);
            }
        }

        return parts.filter(Boolean).join('\n');
    }

    private isToolRelevant(tool: MCPTool, request: string): boolean {
        const keywords = request.toLowerCase().split(/\s+/);
        const toolText = `${tool.name} ${tool.description}`.toLowerCase();
        
        // Direct keyword match
        if (keywords.some(keyword => toolText.includes(keyword))) {
            return true;
        }

        // Category-based matching
        const toolCategories = {
            search: ['search', 'find', 'look', 'query'],
            github: ['github', 'repo', 'issue', 'pull', 'commit'],
            local: ['local', 'nearby', 'around'],
            web: ['web', 'internet', 'online', 'website']
        };

        return Object.entries(toolCategories).some(([category, indicators]) => {
            if (tool.name.toLowerCase().includes(category)) {
                return indicators.some(indicator => request.toLowerCase().includes(indicator));
            }
            return false;
        });
    }

    private isStandardSchema(schema: any): boolean {
        const standardProps = ['owner', 'repo', 'title', 'body', 'name', 'description'];
        if (typeof schema !== 'object' || !schema.properties) {
            return false;
        }
        
        const schemaProps = Object.keys(schema.properties);
        return standardProps.every(prop => schemaProps.includes(prop));
    }
}