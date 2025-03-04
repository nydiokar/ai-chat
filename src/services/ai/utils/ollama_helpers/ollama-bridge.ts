// ollama-bridge.ts
import ollama, { Message, ChatResponse } from 'ollama';
import { MCPClientService } from "../../../../tools/mcp/mcp-client-service.js";
import { MCPTool } from "../../../../types/index.js";
import { OllamaToolDefinition, OllamaToolCall } from "../../../../types/ollama.js";
import { OllamaToolAdapter } from "./ollama-tool-adapter.js";

/**
 * The OllamaBridge class handles sending messages to the Ollama API,
 * detecting tool calls, executing the corresponding MCP tools,
 * and then continuing the conversation until a final response is received.
 */
export class OllamaBridge {
    private model: string;
    private messages: Message[] = [];
    private availableTools: MCPTool[] = [];

    constructor(
        model: string,
        _baseUrl: string,
        private mcpClients: Map<string, MCPClientService>
    ) {
        this.model = model;
    }

    public async updateAvailableTools(tools: MCPTool[]): Promise<void> {
        // Filter to only include the web_search tool
        const webSearchTool = tools.find(t => t.name === 'brave_web_search');
        if (!webSearchTool) {
            throw new Error('brave_web_search tool not found');
        }
        
        this.availableTools = [webSearchTool];
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
            console.log(`[OllamaBridge] Checking client ${clientName} for tool ${toolCall.function.name}`);
            if (await client.hasToolEnabled(toolCall.function.name)) {
                console.log(`[OllamaBridge] Found tool in client ${clientName}`);
                const result = await client.callTool(toolCall.function.name, toolCall.function.arguments);
                return result;
            }
        }

        throw new Error(`No client found for tool: ${toolCall.function.name}`);
    }

    private cleanMessageHistory() {
        // Keep only last 10 messages to prevent context bloat
        if (this.messages.length > 10) {
            this.messages = this.messages.slice(-10);
        }
    }

    private logSafely(message: string, data?: any) {
        if (data) {
            // Remove sensitive data and truncate long content
            const safeData = JSON.parse(JSON.stringify(data));
            if (safeData.messages) {
                safeData.messages = `[${safeData.messages.length} messages]`;
            }
            if (safeData.content && typeof safeData.content === 'string' && safeData.content.length > 100) {
                safeData.content = safeData.content.substring(0, 100) + '...';
            }
            console.log(`[OllamaBridge] ${message}:`, safeData);
        } else {
            console.log(`[OllamaBridge] ${message}`);
        }
    }

    private async getOllamaResponse(request: any): Promise<ChatResponse> {
        try {
            // Ensure we're not streaming and make the request
            const response = await ollama.chat(request) as unknown as ChatResponse;
            
            if (!response || !response.message) {
                throw new Error('No response from Ollama');
            }
            
            return response;
        } catch (error) {
            console.error('[OllamaBridge] Error getting Ollama response:', error);
            throw error;
        }
    }

    public async processMessage(userMessage: string): Promise<string> {
        try {
            this.logSafely('Processing message', { content: userMessage });
            
            // Clean history before adding new message
            this.cleanMessageHistory();
            
            // Add the user message to the conversation
            this.messages.push({ role: "user", content: userMessage });

            // Only include tools if the message might need them
            const mightNeedTools = userMessage.toLowerCase().includes('search') || 
                                 userMessage.toLowerCase().includes('find') ||
                                 userMessage.toLowerCase().includes('look up');

            // Basic chat request
            const chatRequest: {
                model: string;
                messages: Message[];
                stream: boolean;
                options: { temperature: number };
                tools?: OllamaToolDefinition[];
            } = {
                model: this.model,
                messages: this.messages,
                stream: false,
                options: {
                    temperature: 0.7,
                }
            };

            // Only add tools if we might need them
            if (mightNeedTools) {
                this.logSafely('Including tools for this request');
                const toolDefinitions = OllamaToolAdapter.convertMCPToolsToOllama(this.availableTools);
                chatRequest.tools = toolDefinitions;
            }

            this.logSafely('Sending request to Ollama', chatRequest);
            const response = await this.getOllamaResponse(chatRequest);
            this.logSafely('Received response from Ollama', response);

            if (!response || !response.message) {
                console.error('[OllamaBridge] Invalid response from Ollama:', response);
                throw new Error('Invalid response from Ollama API');
            }

            // Add assistant's response to conversation history
            this.messages.push(response.message);

            // Check if the response includes a tool call
            if (response.message.tool_calls && response.message.tool_calls.length > 0) {
                this.logSafely('Tool calls detected', response.message.tool_calls);
                
                for (const toolCall of response.message.tool_calls) {
                    const toolResult = await this.executeToolCall(toolCall);
                    
                    // Add tool response to conversation
                    this.messages.push({
                        role: "tool",
                        content: toolResult
                    });

                    // Clean history before final response
                    this.cleanMessageHistory();

                    // Get final response after tool use
                    const finalRequest = {
                        model: this.model,
                        messages: this.messages,
                        stream: false,
                        options: {
                            temperature: 0.7,
                        }
                    };

                    this.logSafely('Getting final response', finalRequest);
                    const finalResponse = await this.getOllamaResponse(finalRequest);

                    if (!finalResponse || !finalResponse.message) {
                        console.error('[OllamaBridge] Invalid final response from Ollama:', finalResponse);
                        throw new Error('Invalid final response from Ollama API');
                    }

                    return finalResponse.message.content || 'No response content';
                }
            }

            return response.message.content || 'No response content';
        } catch (error) {
            console.error('Error in processMessage:', error);
            throw error;
        }
    }
}
