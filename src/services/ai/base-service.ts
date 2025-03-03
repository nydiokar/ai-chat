import { Message, MessageRole } from '../../types/index.js';
import { defaultConfig, debug } from '../../utils/config.js';
import { DatabaseService } from '../db-service.js';
import { MCPServerManager } from '../../tools/mcp/mcp-server-manager.js';
import { ToolsHandler } from '../../tools/tools-handler.js';
import { getMCPConfig } from '../../types/tools.js';
import { aiRateLimiter } from './utils/rate-limiter.js';
import { ChatCompletionMessageParam, ChatCompletionAssistantMessageParam } from 'openai/resources/chat/completions.js';
import { MCPClientService } from '../../tools/mcp/mcp-client-service.js';
import { SystemPromptGenerator } from '../../system-prompt-generator.js';

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
}

export abstract class BaseAIService implements AIService {
    protected systemPrompt: string = '';
    protected mcpManager?: MCPServerManager;
    protected promptGenerator?: SystemPromptGenerator;
    protected toolsHandler?: ToolsHandler;
    protected initPromise: Promise<void>;
    private initialized: boolean = false;

    constructor() {
        // Check both Discord MCP and general MCP_ENABLED flag
        if (defaultConfig.discord.mcp.enabled || process.env.MCP_ENABLED === 'true') {
            const db = DatabaseService.getInstance();
            this.mcpManager = new MCPServerManager(db, this);
            this.initPromise = this.initializeMCP();
        } else {
            this.initPromise = Promise.resolve();
        }
    }

    abstract generateResponse(message: string, conversationHistory?: Message[]): Promise<AIResponse>;
    abstract processMessage(message: string, conversationHistory?: Message[]): Promise<AIResponse>;
    abstract getModel(): 'gpt' | 'claude' | 'deepseek' | 'ollama';

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
        if (this.initialized) {1
            return;
        }

        try {
            const config = await getMCPConfig();
            
            if (!this.mcpManager) {
                throw new Error('MCPManager not initialized');
            }

            // Initialize each server through MCPServerManager
            await Promise.all(Object.entries(config.mcpServers).map(
                async ([id, serverConfig]) => {
                    await this.mcpManager!.startServer(id, serverConfig);
                    debug(`MCP Server started: ${id}`);
                }
            ));

            // Get initialized clients from MCPServerManager
            const serverClients = Object.entries(config.mcpServers)
                .map(([id]) => ({
                    id,
                    client: this.mcpManager!.getServerByIds(id)
                }))
                .filter((item): item is { id: string; client: MCPClientService } => 
                    item.client !== undefined
                );

            debug(`Found ${serverClients.length} initialized MCP clients`);

            if (serverClients.length > 0 && this.mcpManager) {
                this.toolsHandler = new ToolsHandler(serverClients, this, DatabaseService.getInstance());
                this.promptGenerator = new SystemPromptGenerator(this.mcpManager, this.toolsHandler);
                debug('Initialized ToolsHandler and PromptGenerator');
            } else {
                debug('No successful clients or missing MCPManager - skipping tool initialization');
            }

            this.initialized = true;
        } catch (error) {
            console.error('Failed to initialize MCP:', error);
            throw error;
        }
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

    protected async processWithTools(
        message: string, 
        conversationHistory?: Message[],
        conversationId?: number
    ): Promise<AIResponse> {
        try {
            if (!this.mcpManager || !this.promptGenerator) {
                return this.processWithoutTools(message, conversationHistory);
            }
           
            // Get context-aware system prompt with tool information
            const enhancedPrompt = await this.promptGenerator.generatePrompt(
                this.systemPrompt,
                message
            );
            
            console.log('Enhanced prompt:', enhancedPrompt);

            const contextMessages = this.getContextMessages(conversationHistory);
            const messages: ChatCompletionMessageParam[] = [
                { role: "system", content: enhancedPrompt },
                ...contextMessages,
                { role: "user", content: message }
            ];

            // Process with OpenAI-style tool calls
            if (!this.toolsHandler) {
                throw new Error('ToolsHandler not initialized');
            }
            return this.handleToolBasedCompletion(messages, [], this.toolsHandler, conversationId);
        } catch (error) {
            console.error('Error processing message with tools:', error);
            return this.processWithoutTools(message, conversationHistory);
        }
    }

    protected async handleToolBasedCompletion(
        messages: ChatCompletionMessageParam[],
        functions: any[],
        toolsHandler: ToolsHandler,
        conversationId?: number
    ): Promise<AIResponse> {
        try {
            // Log available functions
            console.debug('Available functions:', functions);

            const completion = await this.createChatCompletion({
                messages,
                tools: functions.map(fn => ({ type: 'function', function: fn })),
                tool_choice: 'auto',
                temperature: 0.7,
            });

            const responseMessage = completion.choices[0].message as ChatCompletionAssistantMessageParam;
            let tokenCount = completion.usage?.total_tokens || 0;

            if (responseMessage?.tool_calls?.length) {
                const toolCalls = responseMessage.tool_calls;
                console.debug('Tool calls received:', toolCalls);
                
                const toolResults = await Promise.all(
                    toolCalls.map(async toolCall => {
                        try {
                            const toolQuery = `[Calling tool ${toolCall.function.name} with args ${toolCall.function.arguments}]`;
                            console.debug('Processing tool query:', toolQuery);
                            const result = await toolsHandler.processQuery(toolQuery, conversationId ?? 0);
                            console.debug('Tool result:', result);
                            return result;
                        } catch (error) {
                            console.error(`Error calling tool ${toolCall.function.name}:`, error);
                            return { error: `Failed to execute tool ${toolCall.function.name}` };
                        }
                    })
                );

                // Log the results being sent back to the LLM
                console.debug('Tool results being sent to LLM:', toolResults);

                // Add tool results to messages
                messages.push(responseMessage);
                messages.push({
                    role: 'tool',
                    content: JSON.stringify(toolResults),
                    tool_call_id: toolCalls[0].id
                });

                // Get final response
                const finalCompletion = await this.createChatCompletion({
                    messages,
                    temperature: 0.7,
                });

                tokenCount += finalCompletion.usage?.total_tokens || 0;
                const messageContent = finalCompletion.choices[0].message.content;

                return {
                    content: String(messageContent || ''),
                    toolResults,
                    tokenCount
                };
            }

            return {
                content: String(responseMessage.content || ''),
                toolResults: [],
                tokenCount
            };
        } catch (error) {
            console.error('Error in handleToolBasedCompletion:', error);
            throw error;
        }
    }

    protected async createChatCompletion(options: {
        messages: ChatCompletionMessageParam[];
        tools?: { type: 'function'; function: any }[];
        tool_choice?: 'auto' | 'none';
        temperature?: number;
    }) {
        return this.makeApiCall(options.messages, options.temperature || 0.7);
    }

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
