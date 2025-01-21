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

    Example correct response:
    "I'll search for the latest news about Trump.
    [Calling tool brave_web_search with args {"query": "latest Trump news", "count": 5}]"

    Example incorrect response (DO NOT DO THIS):
    "I can search for the latest news about Trump." (WRONG - missing tool call)

    Important:
    1. Always explain what you're going to do before using a tool
    2. IMMEDIATELY follow with the tool call - no exceptions
    3. After getting tool results, explain them clearly to the user
    4. Use proper JSON format for arguments as shown in the examples
    5. Only use available tools
    6. For search-related queries:
       - Use brave_web_search for general web queries, news, and information
       - When using search tools, summarize the results in a clear, concise way
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

        const toolsContext = allTools
            .map(tool => {
                const schema = JSON.stringify(tool.inputSchema, null, 2);
                return `Tool: ${tool.name}
Description: ${tool.description}
Input Schema: ${schema}`;
            })
            .join('\n\n');

        return `${this.defaultSystemPrompt}

Available Tools:
${toolsContext}

${additionalContext}`.trim();
    }
}
