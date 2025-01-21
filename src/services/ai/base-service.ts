import { Message, MessageRole } from '../../types/index.js';
import { defaultConfig, debug } from '../../config.js';
import { DatabaseService } from '../db-service.js';
import { MCPServerManager } from '../mcp/mcp-server-manager.js';
import { SystemPromptGenerator } from '../mcp/system-prompt-generator.js';
import { getMCPConfig } from '../../types/mcp-config.js';
import { aiRateLimiter } from './utils/rate-limiter.js';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';

const MAX_CONTEXT_MESSAGES = defaultConfig.maxContextMessages;

export interface AIMessage {
    role: MessageRole;
    content: string;
}

export interface AIResponse {
    content: string;
    tokenCount: number | null;
}

export interface AIService {
    generateResponse(message: string, conversationHistory?: Message[]): Promise<AIResponse>;
    processMessage(message: string, conversationHistory?: Message[]): Promise<AIResponse>;
    setSystemPrompt(prompt: string): void;
    cleanup(): Promise<void>;
}

export abstract class BaseAIService implements AIService {
    protected systemPrompt: string = '';
    protected mcpManager?: MCPServerManager;
    protected initPromise: Promise<void>;

    constructor() {
        if (defaultConfig.mcp.enabled) {
            const db = DatabaseService.getInstance();
            this.mcpManager = new MCPServerManager(db, this);
            this.initPromise = this.initializeMCP();
        } else {
            this.initPromise = Promise.resolve();
        }
    }

    abstract generateResponse(message: string, conversationHistory?: Message[]): Promise<AIResponse>;
    abstract processMessage(message: string, conversationHistory?: Message[]): Promise<AIResponse>;
    abstract getModel(): 'gpt' | 'claude' | 'deepseek';

    setSystemPrompt(prompt: string): void {
        this.systemPrompt = prompt;
    }

    async cleanup(): Promise<void> {
        if (this.mcpManager) {
            const serverIds = this.mcpManager.getServerIds();
            await Promise.all(serverIds.map(id => this.mcpManager!.stopServer(id)));
        }
    }

    protected async initializeMCP(): Promise<void> {
        try {
            const config = getMCPConfig();
            for (const [serverId, serverConfig] of Object.entries(config.mcpServers)) {
                try {
                    await this.mcpManager?.startServer(serverId, serverConfig);
                    debug(`MCP Server started: ${serverId}`);
                } catch (serverError) {
                    console.error(`Failed to start MCP server ${serverId}:`, serverError);
                }
            }
        } catch (error) {
            console.error('Failed to initialize MCP:', error);
        }
    }

    protected async getToolsContext(): Promise<string> {
        if (!this.mcpManager) {
            console.log('No MCP Manager initialized');
            return '';
        }
        
        const promptGenerator = new SystemPromptGenerator(this.mcpManager);
        const prompt = await promptGenerator.generatePrompt(
            'Additional Instructions:\n' +
            '1. When handling search results:\n' +
            '   - For web searches: Extract and summarize the most relevant information\n' +
            '   - For local searches: Format business details in an easy-to-read structure\n' +
            '   - Use markdown formatting for better Discord display\n' +
            '   - Keep responses concise but informative\n\n' +
            '2. Response Format Examples:\n' +
            '   For Web Search:\n' +
            '   ```\n' +
            '   🔍 Search Results:\n' +
            '   • [Title of result]\n' +
            '     Summary: Brief explanation\n' +
            '     Link: URL\n' +
            '   ```\n\n' +
            '   ```'
        );
        
        debug(`Generated Tools Context: ${prompt}`, defaultConfig);
        return prompt;
    }

    protected async withRetry<T>(operation: () => Promise<T>): Promise<T> {
        let lastError: Error | null = null;
        
        for (let attempt = 1; attempt <= defaultConfig.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error: any) {
                lastError = error;
                if (error.message.includes('rate limit') && attempt < defaultConfig.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, defaultConfig.retryDelay * attempt));
                    continue;
                }
                throw error;
            }
        }
        
        throw lastError || new Error('Operation failed after retries');
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

    protected async processWithTools(message: string, conversationHistory?: Message[]): Promise<AIResponse> {
        aiRateLimiter.checkLimit(this.getModel());
        
        try {
            const server = await this.mcpManager?.getServerByIds('brave-search');
            if (!server) {
                return this.processWithoutTools(message, conversationHistory);
            }

            const contextMessages = this.getContextMessages(conversationHistory);
            const tools = await server.listTools();
            const functions = tools.map(tool => ({
                name: tool.name,
                description: tool.description || '',
                parameters: tool.inputSchema
            }));

            const messages: ChatCompletionMessageParam[] = [
                { role: "system", content: this.systemPrompt },
                ...contextMessages,
                { role: "user", content: message }
            ];

            return this.handleToolBasedCompletion(messages, functions, server);
        } catch (error) {
            console.error('Error processing message with tools:', error);
            return this.processWithoutTools(message, conversationHistory);
        }
    }

    protected abstract handleToolBasedCompletion(
        messages: ChatCompletionMessageParam[],
        functions: any[],
        server: any
    ): Promise<AIResponse>;

    protected abstract processWithoutTools(
        message: string,
        conversationHistory?: Message[]
    ): Promise<AIResponse>;
}
