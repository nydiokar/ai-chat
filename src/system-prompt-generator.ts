import { MCPTool } from "./types/index.js";
import { MCPServerManager } from "./tools/mcp/mcp-server-manager.js";
import { PromptMiddleware } from "./services/prompt/prompt-middleware.js";
import { PromptRepository } from "./services/prompt/prompt-repository.js";
import { PromptContext, PromptType, ToolUsagePrompt } from "./types/prompts.js";
import { ToolsHandler } from "./tools/tools-handler.js";

export class SystemPromptGenerator {
    private readonly middleware: PromptMiddleware;
    private readonly repository: PromptRepository;
    private readonly defaultIdentity = "You are Brony, an intelligent AI assistant."

    constructor(
        private mcpManager: MCPServerManager,
        private toolsHandler: ToolsHandler
    ) {
        this.repository = new PromptRepository();
        this.middleware = new PromptMiddleware(this.repository);
        this.initializeToolPrompts();
    }

    private initializeToolPrompts(): void {
        const mcpToolPrompt: ToolUsagePrompt = {
            type: PromptType.TOOL_USAGE,
            content: `Tool Usage Guidelines:
- Format calls as: [Calling tool <name> with args <json>]
- Follow each tool's input schema requirements
- Handle errors appropriately`,
            priority: 2,
            tools: ['*'],
            usagePatterns: {
                bestPractices: ['Follow schema requirements'],
                commonErrors: ['Invalid formatting']
            },
            shouldApply: (context: PromptContext) => 
                context.tools !== undefined && context.tools.length > 0
        };
        
        this.repository.addPrompt(mcpToolPrompt);
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
                    if (context?.patterns) {
                        const patterns = Object.entries(context.patterns)
                            .map(([param, data]) => `${param}: ${(data as any).mostCommon?.[0]}`)
                            .filter(pattern => !pattern.includes('undefined'))
                            .join(', ');
                        contextInfo = patterns ? `\nCommon Usage: ${patterns}` : '';
                    }
                    
                    if (context?.history?.length) {
                        contextInfo += `\nUsage History: ${context.history.length} recent uses`;
                    }

                    return `Tool: ${tool.name}
Description: ${tool.description}
Input Schema: ${schema}${contextInfo ? '\n' + contextInfo : ''}`;
                });

                const results = await Promise.all(contextPromises);
                toolsContext.push(...results);
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

        // Only include tool information if the request suggests tool usage is needed
        const requestLower = (request || '').toLowerCase();
        const needsTools = requestLower.includes('search') || 
                          requestLower.includes('find') || 
                          requestLower.includes('github');

        const parts = [
            this.defaultIdentity,
            prompts,
            needsTools && tools.length > 0 ? '\nAvailable Tools:\n' + toolsContext.join('\n\n') : '',
            additionalContext
        ].filter(Boolean);

        return parts.join('\n\n');
    }
}
