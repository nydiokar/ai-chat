import { MCPTool } from "./types/index.js";
import { MCPServerManager } from "./tools/mcp/mcp-server-manager.js";
import { PromptMiddleware } from "./services/prompt/prompt-middleware.js";
import { PromptRepository } from "./services/prompt/prompt-repository.js";
import { PromptContext, PromptType, ToolUsagePrompt } from "./types/prompts.js";
import { ToolsHandler } from "./tools/tools-handler.js";

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
        this.initializeToolPrompts();
    }

    private initializeToolPrompts(): void {
        const toolPrompt: ToolUsagePrompt = {
            type: PromptType.TOOL_USAGE,
            content: `When using tools:
1. Always explain intention before use
2. Format calls as: [Calling tool <name> with args <json>]
3. Use exact tool names
4. Handle errors appropriately`,
            priority: 2,
            tools: ['*'],
            usagePatterns: {
                bestPractices: ['Verify tools before use', 'Use specific tools first'],
                commonErrors: ['Incorrect formatting', 'Missing args']
            },
            shouldApply: (context: PromptContext) => 
                context.tools !== undefined && context.tools.length > 0
        };
        
        this.repository.addPrompt(toolPrompt);
    }

    async generatePrompt(additionalContext: string = "", request?: string): Promise<string> {
        // Gather available tools
        const tools: MCPTool[] = [];
        const serverIds = this.mcpManager.getServerIds();
        
        for (const serverId of serverIds) {
            try {
                const server = this.mcpManager.getServerByIds(serverId);
                if (server) {
                    const serverTools = await server.listTools();
                    tools.push(...(serverTools || []));
                }
            } catch (error) {
                console.error(`Error getting tools for server ${serverId}:`, error);
            }
        }

        // Generate tool context if tools available
        const toolsContext: string[] = [];
        if (tools.length > 0) {
            try {
                // Use ToolsHandler to get tool contexts with caching and persistence
                const contextPromises = tools.map(async tool => {
                    const context = await this.toolsHandler.getToolContext(tool.name);
                    const schema = JSON.stringify(tool.inputSchema, null, 2);
                    
                    let contextInfo = '';
                    if (context) {
                        const successRate = context.successRate ?? 1;
                        contextInfo = `\nUsage Patterns:
- Success Rate: ${(successRate * 100).toFixed(1)}%
${context.patterns ? Object.entries(context.patterns)
    .map(([param, data]) => `- Common ${param} values: ${(data as any).mostCommon?.slice(0, 2)?.join(', ') || 'No common values'}`)
    .join('\n') : ''}`;
                    }

                    return `Tool: ${tool.name}
Description: ${tool.description}
Input Schema: ${schema}${contextInfo}`;
                });

                const results = await Promise.allSettled(contextPromises);
                results.forEach((result, index) => {
                    if (result.status === 'fulfilled') {
                        toolsContext.push(result.value);
                    } else {
                        console.error(`Failed to get context for tool ${tools[index].name}:`, result.reason);
                        // Add minimal tool info as fallback
                        toolsContext.push(`Tool: ${tools[index].name}
Description: ${tools[index].description}`);
                    }
                });
            } catch (error) {
                console.error('[SystemPromptGenerator] Error getting tool contexts:', error);
            }
        }

        // Build prompt context and get appropriate prompts
        const prompts = await this.middleware.processRequest(request || '', {
            requestType: request ? await this.middleware.analyzeRequestType(request) : undefined,
            tools: tools.map(t => t.name),
            complexity: request ? await this.middleware.analyzeComplexity(request) : 'low'
        });

        // Combine all parts
        const parts = [
            this.defaultIdentity,
            prompts,
            tools.length > 0 ? '\nAvailable Tools:\n' + toolsContext.join('\n\n') : 'No tools available.',
            additionalContext
        ].filter(Boolean);

        return parts.join('\n\n');
    }
}
