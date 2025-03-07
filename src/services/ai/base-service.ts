import { Message, MessageRole } from '../../types/index.js';
import { defaultConfig, debug } from '../../utils/config.js';
import { DatabaseService } from '../db-service.js';
import { MCPServerManager } from '../../tools/mcp/mcp-server-manager.js';
import { ToolsHandler } from '../../tools/tools-handler.js';
import { ChatCompletionMessageParam, ChatCompletionAssistantMessageParam } from 'openai/resources/chat/completions.js';

const MAX_CONTEXT_MESSAGES = defaultConfig.maxContextMessages;

export interface AIMessage {
    role: MessageRole;
    content: string;
}

export interface AIResponse {
    content: string;
    tokenCount: number | null;
    toolResults: any[];
}

export interface AIService {
    generateResponse(message: string, conversationHistory?: Message[]): Promise<AIResponse>;
    processMessage(message: string, conversationHistory?: Message[]): Promise<AIResponse>;
    getModel(): 'gpt' | 'claude' | 'deepseek' | 'ollama';
    setSystemPrompt(prompt: string): void;
    cleanup(): Promise<void>;
    injectMCPComponents(mcpManager: MCPServerManager, toolsHandler: ToolsHandler): void;
}

export abstract class BaseAIService implements AIService {
    protected systemPrompt: string = '';
    protected db: DatabaseService;
    protected mcpManager?: MCPServerManager;
    protected toolsHandler?: ToolsHandler;
    protected initPromise: Promise<void>;

    constructor() {
        this.db = DatabaseService.getInstance();
        this.initPromise = Promise.resolve();
    }

    abstract generateResponse(message: string, conversationHistory?: Message[]): Promise<AIResponse>;
    abstract processMessage(message: string, conversationHistory?: Message[]): Promise<AIResponse>;
    abstract getModel(): 'gpt' | 'claude' | 'deepseek' | 'ollama';

    setSystemPrompt(prompt: string): void {
        this.systemPrompt = prompt;
    }

    injectMCPComponents(mcpManager: MCPServerManager, toolsHandler: ToolsHandler): void {
        this.mcpManager = mcpManager;
        this.toolsHandler = toolsHandler;
    }

    async cleanup(): Promise<void> {
        if (this.mcpManager) {
            const serverIds = this.mcpManager.getServerIds();
            await Promise.all(serverIds.map(id => this.mcpManager!.stopServer(id)));
        }
    }

    protected getContextMessages(history?: Message[]): AIMessage[] {
        const messages: AIMessage[] = [];
        
        if (history) {
            const recentMessages = history.slice(-MAX_CONTEXT_MESSAGES);
            messages.push(...recentMessages
                .filter(msg => msg.role === 'user' || msg.role === 'assistant')
                .map(msg => ({
                    role: msg.role,
                    content: msg.content
                })));
        }

        return messages;
    }

    protected async processWithTools(
        message: string, 
        conversationHistory?: Message[],
        conversationId?: number
    ): Promise<AIResponse> {
        try {
            if (!this.mcpManager || !this.toolsHandler) {
                return this.processWithoutTools(message, conversationHistory);
            }

            const contextMessages = this.getContextMessages(conversationHistory);
            const messages: ChatCompletionMessageParam[] = [
                { role: "system", content: this.systemPrompt },
                ...contextMessages,
                { role: "user", content: message }
            ];

            return this.handleToolBasedCompletion(messages, [], this.toolsHandler, conversationId);
        } catch (error) {
            console.error('Error processing message with tools:', error);
            return this.processWithoutTools(message, conversationHistory);
        }
    }

    protected abstract handleToolBasedCompletion(
        messages: ChatCompletionMessageParam[],
        functions: any[],
        toolsHandler: ToolsHandler,
        conversationId?: number
    ): Promise<AIResponse>;

    protected abstract makeApiCall(
        messages: ChatCompletionMessageParam[],
        temperature: number
    ): Promise<{
        choices: Array<{
            message: ChatCompletionAssistantMessageParam;
            finish_reason: string;
        }>;
        usage?: {
            total_tokens: number;
        };
    }>;

    protected abstract processWithoutTools(
        message: string,
        conversationHistory?: Message[]
    ): Promise<AIResponse>;
}