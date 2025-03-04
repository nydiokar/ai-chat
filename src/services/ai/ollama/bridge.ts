import { MCPServerManager } from '../../../tools/mcp/mcp-server-manager.js';
import { MCPToolConfig, MCPServerConfig } from '../../../types/tools.js';
import { Ollama } from 'ollama';

export interface BridgeResponse {
    content: string;
    toolResults: any[];
    tokenCount: number;
}

interface ExtendedMCPTool extends MCPToolConfig {
    server: MCPServerConfig;
    inputSchema: any;
}

export class OllamaBridge {
    private systemPrompt: string | null = null;
    private toolRegistry: Map<string, ExtendedMCPTool> = new Map();
    private ollamaClient: Ollama;

    constructor(
        private config: { baseUrl: string; model: string },
        private mcpManager?: MCPServerManager
    ) {
        this.ollamaClient = new Ollama({
            host: this.config.baseUrl
        });
    }

    setSystemPrompt(prompt: string | null) {
        this.systemPrompt = prompt;
    }

    registerTool(tool: ExtendedMCPTool) {
        if (tool.name.includes('brave') && tool.name.includes('search')) {
            this.toolRegistry.set(tool.name, {
                ...tool,
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'The search query string'
                        },
                        count: {
                            type: 'number',
                            description: 'Number of results to return',
                            default: 5
                        }
                    },
                    required: ['query']
                }
            });
        }
    }

    private async executeBraveSearch(query: string, count: number = 5): Promise<any> {
        const tool = this.toolRegistry.get('brave_web_search');
        if (!tool || !this.mcpManager) {
            throw new Error('Brave Search tool not available');
        }

        // Format the query as the MCP server expects
        const queryString = `brave_web_search ${JSON.stringify({ query, count })}`;

        return await this.mcpManager.executeToolQuery(
            tool.server.id,
            queryString,
            0 // conversationId, using 0 as default since we don't track conversations here
        );
    }

    async processMessage(
        message: string,
        history?: { role: string; content: string }[],
        tools?: ExtendedMCPTool[]
    ): Promise<BridgeResponse> {
        if (tools) {
            tools.forEach(tool => this.registerTool(tool));
        }

        console.log('[OllamaBridge] Processing message with tools:', 
            Array.from(this.toolRegistry.keys()));

        // First, try to get a response using function calling
        const response = await this.ollamaClient.chat({
            model: this.config.model,
            messages: [
                { role: 'system', content: this.systemPrompt || 'You are a helpful AI assistant.' },
                ...(history || []),
                { role: 'user', content: message }
            ],
            format: 'json',
            options: {
                temperature: 0.3
            }
        });

        console.log('[OllamaBridge] Initial response:', response);

        const toolResults = [];
        let finalContent = response.message?.content || '';

        try {
            const parsed = JSON.parse(finalContent);
            if (parsed.query) {
                const searchResult = await this.executeBraveSearch(
                    parsed.query,
                    parsed.count || 5
                );

                toolResults.push({
                    tool: 'brave_web_search',
                    result: searchResult,
                    tool_call_id: `search-${Date.now()}`
                });

                // Get a summary of the results
                const summary = await this.ollamaClient.chat({
                    model: this.config.model,
                    messages: [
                        { 
                            role: 'system', 
                            content: 'Summarize these search results clearly and concisely.' 
                        },
                        { 
                            role: 'user', 
                            content: JSON.stringify(searchResult) 
                        }
                    ]
                });

                finalContent = summary.message?.content || finalContent;
            }
        } catch (error) {
            console.error('[OllamaBridge] Error processing tool response:', error);
        }

        return {
            content: finalContent,
            toolResults,
            tokenCount: finalContent.length
        };
    }
}
