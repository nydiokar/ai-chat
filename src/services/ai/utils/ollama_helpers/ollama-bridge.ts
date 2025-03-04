// ollama-bridge.ts
import ollama, { ChatRequest } from 'ollama';
import { MCPClientService } from "../../../../tools/mcp/mcp-client-service.js";
import { MCPTool } from "../../../../types/index.js";
import { OllamaMessage, OllamaToolCall, OllamaChatRequest, OllamaResponse } from "../../../../types/ollama.js";
import { OllamaToolAdapter } from "./ollama-tool-adapter.js";

/**
 * The OllamaBridge class handles sending messages to the Ollama API,
 * detecting tool calls, executing the corresponding MCP tools,
 * and then continuing the conversation until a final response is received.
 */
export class OllamaBridge {
    private model: string;
    private messages: OllamaMessage[] = [];
    private availableTools: MCPTool[] = [];

    constructor(
        model: string,
        _baseUrl: string,
        private mcpClients: Map<string, MCPClientService>
    ) {
        this.model = model;
    }

    public async updateAvailableTools(tools: MCPTool[]): Promise<void> {
        this.availableTools = tools;
        console.log('[OllamaBridge] Updated available tools:', this.availableTools.map(t => t.name));
    }

    private async executeToolCall(toolCall: OllamaToolCall): Promise<string> {
        console.log('[OllamaBridge] Executing tool call:', JSON.stringify(toolCall, null, 2));
        
        // Find the tool and validate
        const tool = this.availableTools.find(t => t.name === toolCall.function.name);
        if (!tool) {
            throw new Error(`Tool not found: ${toolCall.function.name}`);
        }

        // Validate the tool call
        if (!OllamaToolAdapter.validateToolCall(toolCall, this.availableTools)) {
            throw new Error(`Invalid tool call: ${toolCall.function.name}`);
        }

        // Find the appropriate client for this tool
        for (const [clientName, client] of this.mcpClients) {
            if (await client.hasToolEnabled(toolCall.function.name)) {
                console.log(`[OllamaBridge] Found tool in client ${clientName}`);
                const result = await client.callTool(toolCall.function.name, toolCall.function.arguments);
                return result;
            }
        }

        throw new Error(`No client found for tool: ${toolCall.function.name}`);
    }

    private convertToOllamaRequest(request: OllamaChatRequest): ChatRequest & { stream?: false } {
        return {
            model: request.model,
            messages: request.messages,
            stream: false,
            options: request.options,
            ...(request.tools && {
                tools: request.tools.map(tool => ({
                    type: tool.type,
                    function: {
                        ...tool.function,
                        parameters: {
                            ...tool.function.parameters,
                            required: tool.function.parameters.required || []
                        }
                    }
                }))
            })
        };
    }

    private async getOllamaResponse(request: OllamaChatRequest): Promise<OllamaResponse> {
        try {
            const ollamaRequest = this.convertToOllamaRequest(request);
            const response = await ollama.chat(ollamaRequest);
            
            if (!response || !response.message) {
                throw new Error('Invalid or empty response from Ollama');
            }
            
            return response as OllamaResponse;
        } catch (error) {
            console.error('[OllamaBridge] Error getting Ollama response:', error);
            throw error;
        }
    }

    public async processMessage(userMessage: string): Promise<string> {
        try {
            console.log('[OllamaBridge] Processing message:', userMessage.substring(0, 100) + '...');
            
            // Keep only last 10 messages to prevent context bloat
            if (this.messages.length > 10) {
                this.messages = this.messages.slice(-10);
            }
            
            this.messages.push({ role: "user", content: userMessage });

            // Prepare chat request
            const chatRequest: OllamaChatRequest = {
                model: this.model,
                messages: this.messages,
                stream: false,
                options: { temperature: 0.7 }
            };

            // Include all available tools
            if (this.availableTools.length > 0) {
                chatRequest.tools = OllamaToolAdapter.convertMCPToolsToOllama(this.availableTools);
            }

            const response = await this.getOllamaResponse(chatRequest);
            this.messages.push(response.message);

            // Handle tool calls if present
            const toolCalls = response.message.tool_calls;
            if (toolCalls && toolCalls.length > 0) {
                // Process each tool call in sequence
                for (const toolCall of toolCalls) {
                    const toolResult = await this.executeToolCall(toolCall);
                    this.messages.push({
                        role: "tool",
                        content: toolResult
                    });
                }

                // Get final response after all tool calls
                const finalResponse = await this.getOllamaResponse({
                    model: this.model,
                    messages: this.messages,
                    stream: false,
                    options: { temperature: 0.7 }
                });

                return finalResponse.message.content || 'No response content';
            }

            return response.message.content || 'No response content';
        } catch (error) {
            console.error('[OllamaBridge] Error in processMessage:', error);
            throw error;
        }
    }
}
