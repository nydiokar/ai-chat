import ollama, { ChatRequest } from 'ollama';
import { IMCPClient } from "../../../tools/mcp/interfaces/core.js";
import { ToolDefinition } from "../../../tools/mcp/types/tools.js";
import { OllamaMessage, OllamaToolCall, OllamaChatRequest, OllamaResponse, OllamaRole, OllamaToolDefinition } from "../../../types/ollama.js";
import { OllamaToolAdapter } from "./ollama-tool-adapter.js";
import { ReActPromptGenerator } from "../../../prompt/react-prompt-generator.js";
import { IToolManager } from "../../../tools/mcp/interfaces/core.js";

export class OllamaBridge {
    private model: string;
    private messages: OllamaMessage[] = [];
    private availableTools: Map<string, ToolDefinition> = new Map();
    private convertedTools: Map<string, OllamaToolDefinition> = new Map();
    private promptGenerator: ReActPromptGenerator;

    constructor(
        model: string,
        private endpoint: string,
        private clients: Map<string, IMCPClient>,
        private toolManager: IToolManager
    ) {
        this.model = model;
        this.promptGenerator = new ReActPromptGenerator(this.toolManager);
    }

    private convertTool(tool: ToolDefinition): OllamaToolDefinition {
        const converted: OllamaToolDefinition = {
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: {
                    type: 'object',
                    properties: tool.inputSchema.properties,
                    required: tool.inputSchema.required
                }
            }
        };
        return converted;
    }

    public async updateAvailableTools(tools: ToolDefinition[]): Promise<void> {
        this.availableTools = new Map(tools.map(tool => [tool.name, tool]));
        this.convertedTools.clear();
        for (const tool of tools) {
            const converted = this.convertTool(tool);
            this.convertedTools.set(tool.name, converted);
        }
    }

    private async executeToolCall(toolCall: OllamaToolCall): Promise<string> {
        const tool = this.availableTools.get(toolCall.function.name);
        if (!tool) throw new Error(`Tool not found: ${toolCall.function.name}`);

        if (!OllamaToolAdapter.validateToolCall(toolCall, [tool])) {
            throw new Error(`Invalid tool call: ${toolCall.function.name}`);
        }

        // Try each client until one successfully executes the tool
        for (const [clientName, client] of this.clients.entries()) {
            try {
                const result = await client.callTool(toolCall.function.name, toolCall.function.arguments);
                return JSON.stringify(result);
            } catch (error) {
                console.warn(`Client ${clientName} failed to execute tool: ${error}`);
                continue;
            }
        }

        throw new Error(`No client could execute tool: ${toolCall.function.name}`);
    }

    private async getRelevantToolsFromPromptGenerator(message: string): Promise<ToolDefinition[]> {
        // Get all available tools since ReActPromptGenerator will handle tool selection
        return Array.from(this.availableTools.values());
    }

    private getConvertedTool(tool: ToolDefinition): OllamaToolDefinition {
        const converted = this.convertedTools.get(tool.name);
        if (!converted) {
            const newConverted = this.convertTool(tool);
            this.convertedTools.set(tool.name, newConverted);
            return newConverted;
        }
        return converted;
    }

    private async convertToOllamaRequest(request: OllamaChatRequest): Promise<ChatRequest & { stream?: false }> {
        const userMessage = request.messages[request.messages.length - 1].content;
        const relevantTools = await this.getRelevantToolsFromPromptGenerator(userMessage);
        
        // Get ReAct formatted prompt
        const systemPrompt = await this.promptGenerator.generatePrompt(userMessage, relevantTools);

        const messages = request.messages;
        if (!messages.find(m => m.role === "system")) {
            messages.unshift({
                role: "system",
                content: systemPrompt
            });
        }

        return {
            model: request.model,
            messages,
            stream: false,
            options: { temperature: 0.5 },
            tools: relevantTools.length > 0 
                ? relevantTools.map(tool => this.getConvertedTool(tool))
                : undefined
        };
    }

    private async getOllamaResponse(request: OllamaChatRequest): Promise<OllamaResponse> {
        try {
            const response = await ollama.chat(await this.convertToOllamaRequest(request)) as any;
            if (!response?.message) throw new Error('Invalid response');

            return {
                model: response.model || this.model,
                created_at: new Date().toISOString(),
                message: {
                    role: response.message.role as OllamaRole,
                    content: response.message.content,
                    tool_calls: response.message.tool_calls
                },
                done: true
            };
        } catch (error) {
            console.error('[OllamaBridge] Error:', error);
            throw error;
        }
    }

    public async processMessage(userMessage: string): Promise<string> {
        try {
            if (this.messages.length > 10) {
                this.messages = this.messages.slice(-10);
            }
            
            this.messages.push({
                role: "user",
                content: userMessage
            });

            const response = await this.getOllamaResponse({
                model: this.model,
                messages: this.messages,
                stream: false,
                options: { temperature: 0.5 }
            });

            this.messages.push(response.message);

            if (response.message.tool_calls?.length) {
                for (const toolCall of response.message.tool_calls) {
                    const result = await this.executeToolCall(toolCall);
                    this.messages.push({
                        role: "tool",
                        content: result
                    });

                    const finalResponse = await this.getOllamaResponse({
                        model: this.model,
                        messages: this.messages,
                        stream: false,
                        options: { temperature: 0.5 }
                    });

                    return finalResponse.message.content || 'No response content';
                }
            }

            return response.message.content || 'No response content';
        } catch (error) {
            console.error('[OllamaBridge] Error:', error);
            throw error;
        }
    }
}
