import { MCPTool } from "../../types/index.js";
import { MCPServerManager } from "./mcp-server-manager.js";

export class SystemPromptGenerator {
    private readonly defaultSystemPrompt = `You are Brony, an intelligent AI assistant with access to various tools to help answer queries effectively.
    When you need to use a tool, format your response exactly like this: [Calling tool <tool-name> with args <json-args>]

    CRITICAL INSTRUCTIONS:
    1. ALWAYS execute the tool immediately after explaining what you're going to do
    2. DO NOT stop at just explaining - you must include the tool call in your response
    3. Format tool calls exactly as shown in the examples - no variations allowed
    4. After explaining your intent, IMMEDIATELY follow with the tool call on the next line
    5. ALWAYS check if there's a specific tool for your task before falling back to search

    Example correct responses:
    "I'll get the details of issue #123 from the repository.
    [Calling tool get_issue with args {"repository": "owner/repo", "issue_number": 123}]"

    "Since there's no specific tool for this, I'll search the web for information.
    [Calling tool brave_web_search with args {"query": "latest news", "count": 5}]"

    Example incorrect response (DO NOT DO THIS):
    "I can look that up for you." (WRONG - missing tool call)

    Important:
    1. Always explain what you're going to do before using a tool
    2. IMMEDIATELY follow with the tool call - no exceptions
    3. After getting tool results, explain them clearly to the user
    4. Use proper JSON format for arguments as shown in the examples
    5. Only use available tools
    6. Tool selection priority:
       - First try to use specific tools designed for the task (e.g., GitHub tools for repo operations)
       - Only use search tools when no specific tool exists for the task
       - Use brave_web_search for general web queries when no better tool is available
    7. Format your responses in a Discord-friendly way:
       - Use clear sections with headings when appropriate
       - Break long responses into readable chunks
       - Use bullet points for lists of information
    8. IMPORTANT: Always use the exact tool names as listed in "Available Tools" below`;

    constructor(private mcpManager: MCPServerManager) {}

    async generatePrompt(additionalContext: string = ""): Promise<string> {
        const allTools: MCPTool[] = [];
        
        // Wait for tools to be initialized
        await new Promise(resolve => setTimeout(resolve, 1000));

        const serverIds = this.mcpManager.getServerIds();
        console.log(`[SystemPromptGenerator] Found servers:`, serverIds);
        
        for (const serverId of serverIds) {
            try {
                const server = this.mcpManager.getServerByIds(serverId);
                if (server) {
                    const serverTools = await server.listTools();
                    if (serverTools && serverTools.length > 0) {
                        allTools.push(...serverTools);
                        console.log(`[SystemPromptGenerator] Found ${serverTools.length} tools for server ${serverId}:`, 
                            serverTools.map(t => t.name));
                    }
                }
            } catch (error) {
                console.error(`[SystemPromptGenerator] Error getting tools for server ${serverId}:`, error);
            }
        }

        if (allTools.length === 0) {
            console.warn('[SystemPromptGenerator] No tools found from any server');
            return `${this.defaultSystemPrompt}\n\nNo tools are currently available.`;
        }

        const toolsContext = await Promise.all(allTools.map(async tool => {
            const schema = JSON.stringify(tool.inputSchema, null, 2);
            const server = this.mcpManager.getServerByIds(tool.server.name);
            
            let contextInfo = '';
            if (server) {
                const toolHandler = this.mcpManager.getToolsHandler(tool.server.name);
                if (toolHandler) {
                    try {
                        const context = await toolHandler.getToolContext(tool.name);
                        if (context) {
                            const successRate = context.successRate ?? 1; // Default to 100% if no data
                            contextInfo = `\nUsage Patterns:
- Success Rate: ${(successRate * 100).toFixed(1)}%
${context.patterns ? Object.entries(context.patterns).map(([param, data]) => 
`- Common ${param} values: ${(data as any).mostCommon?.slice(0, 2)?.join(', ') || 'No common values'}`
).join('\n') : ''}`;
                        }
                    } catch (error) {
                        console.warn(`[SystemPromptGenerator] Failed to get context for tool ${tool.name}:`, error);
                    }
                }
            }

            return `Tool: ${tool.name}
Description: ${tool.description}
Input Schema: ${schema}${contextInfo}`;
        }));

        const prompt = `${this.defaultSystemPrompt}

Available Tools:
${toolsContext.join('\n\n')}

When using tools:
1. Consider their success rates and common usage patterns
2. Prefer well-performing tools over those with low success rates
3. Use common parameter values when appropriate

${additionalContext}`.trim();

        return prompt;
    }
}
