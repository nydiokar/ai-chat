import { BaseAIService, AIResponse } from './base-service.js';
import { Message } from '../../types/index.js';
import { OllamaBridge } from './utils/ollama_helpers/ollama-bridge.js';
import { MCPClientService } from '../../tools/mcp/mcp-client-service.js';
import { ChatCompletionMessageParam, ChatCompletionAssistantMessageParam } from 'openai/resources/chat/completions.js';

export class OllamaService extends BaseAIService {
    private bridge!: OllamaBridge; // Using definite assignment assertion

    constructor() {
        super();
        this.initPromise = this.initialize();
    }

    private async initialize(): Promise<void> {
        await super.initializeMCP();
        
        if (!this.mcpManager) {
            throw new Error('MCPManager not initialized');
        }

        // Create a map of all available MCP clients
        const clients = new Map<string, MCPClientService>();
        const serverIds = this.mcpManager.getServerIds();
        
        for (const serverId of serverIds) {
            const client = this.mcpManager.getServerByIds(serverId);
            if (client) {
                clients.set(serverId, client);
            }
        }

        // Initialize the bridge with all available clients
        this.bridge = new OllamaBridge(
            "llama3.2:latest",
            "http://127.0.0.1:11434",
            clients
        );

        // Update available tools
        const tools = await Promise.all(
            Array.from(clients.values()).map(client => client.listTools())
        );
        await this.bridge.updateAvailableTools(tools.flat());
    }

    public getModel(): 'gpt' | 'claude' | 'deepseek' | 'ollama' {
        return 'ollama';
    }

    protected async makeApiCall(
        messages: ChatCompletionMessageParam[],
        temperature: number
    ): Promise<{
        choices: Array<{
            message: ChatCompletionAssistantMessageParam;
            finish_reason: string;
        }>;
        usage?: { total_tokens: number; };
    }> {
        // Convert OpenAI format messages to Ollama format
        const ollamaMessages = messages.map(msg => ({
            role: msg.role,
            content: msg.content as string
        }));

        const response = await this.bridge.processMessage(ollamaMessages[ollamaMessages.length - 1].content);

        return {
            choices: [{
                message: {
                    role: 'assistant',
                    content: response
                },
                finish_reason: 'stop'
            }],
            usage: {
                total_tokens: 0 // Ollama doesn't provide token counts
            }
        };
    }

    public async processMessage(message: string, conversationHistory?: Message[]): Promise<AIResponse> {
        await this.initPromise;

        if (this.toolsHandler) {
            return this.processWithTools(message, conversationHistory);
        }

        return this.processWithoutTools(message, conversationHistory);
    }

    protected async processWithoutTools(
        message: string,
        conversationHistory?: Message[]
    ): Promise<AIResponse> {
        const response = await this.bridge.processMessage(message);
        return {
            content: response,
            tokenCount: null,
            toolResults: []
        };
    }

    public async generateResponse(message: string, conversationHistory?: Message[]): Promise<AIResponse> {
        return this.processMessage(message, conversationHistory);
    }
} 