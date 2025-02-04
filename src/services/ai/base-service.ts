import { Message, MessageRole } from '../../types/index.js';
import { defaultConfig, debug } from '../../utils/config.js';
import { DatabaseService } from '../db-service.js';
import { MCPServerManager } from '../mcp/mcp-server-manager.js';
import { SystemPromptGenerator } from '../mcp/system-prompt-generator.js';
import { getMCPConfig } from '../../types/mcp-config.js';
import { aiRateLimiter } from './utils/rate-limiter.js';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { MCP_SERVER_IDS } from '../../types/mcp-config.js';

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
    getModel(): 'gpt' | 'claude' | 'deepseek';
    setSystemPrompt(prompt: string): void;
    cleanup(): Promise<void>;
}

export abstract class BaseAIService implements AIService {
    protected systemPrompt: string = '';
    protected mcpManager?: MCPServerManager;
    protected initPromise: Promise<void>;
    private initialized: boolean = false;

    constructor() {
        if (defaultConfig.discord.mcp.enabled) {
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
        if (this.initialized) {
            return;
        }

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
            this.initialized = true;
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
            // Get all configured servers in parallel
            const serverPromises = MCP_SERVER_IDS.map(id => this.mcpManager?.getServerByIds(id));
            const servers = (await Promise.all(serverPromises)).filter(Boolean);

            if (servers.length === 0) {
                return this.processWithoutTools(message, conversationHistory);
            }

            const contextMessages = this.getContextMessages(conversationHistory);
            
            // Get all tools from all servers
            const toolsPromises = servers.map(server => server?.listTools() || []);
            const allTools = (await Promise.all(toolsPromises)).flat();
            
            const functions = allTools.map(tool => ({
                name: tool.name,
                description: tool.description || '',
                parameters: tool.inputSchema
            }));

            const messages: ChatCompletionMessageParam[] = [
                { role: "system", content: this.systemPrompt },
                ...contextMessages,
                { role: "user", content: message }
            ];

            return this.handleToolBasedCompletion(messages, functions, servers);
        } catch (error) {
            console.error('Error processing message with tools:', error);
            return this.processWithoutTools(message, conversationHistory);
        }
    }

    protected async handleToolBasedCompletion(
        messages: ChatCompletionMessageParam[],
        functions: any[],
        servers: any[]
    ): Promise<AIResponse> {
        try {
            // Create a map of tool names to their respective servers
            const toolServerMap = new Map();
            for (const server of servers) {
                const tools = await server.listTools();
                tools.forEach((tool: any) => toolServerMap.set(tool.name, server));
            }

            const completion = await this.createChatCompletion({
                messages,
                tools: functions.map(fn => ({ type: 'function', function: fn })),
                tool_choice: 'auto',
                temperature: 0.7,
            });

            const response = completion.choices[0] as {
                message: ChatCompletionMessageParam & {
                    tool_calls?: Array<{
                        id: string;
                        function: { name: string; arguments: string }
                    }>
                };
                finish_reason: string;
            };
            let tokenCount = completion.usage?.total_tokens || 0;

            if (response.finish_reason === 'tool_calls' && 
                response.message && 
                'tool_calls' in response.message && 
                response.message.tool_calls) {
                const toolCalls = response.message.tool_calls;
                const toolResults = await Promise.all(
                    toolCalls.map(async (toolCall: any) => {
                        const server = toolServerMap.get(toolCall.function.name);
                        if (!server) {
                            throw new Error(`No server found for tool: ${toolCall.function.name}`);
                        }
                        
                        try {
                            const result = await server.callTool(
                                toolCall.function.name,
                                JSON.parse(toolCall.function.arguments)
                            );
                            return result;
                        } catch (error) {
                            console.error(`Error calling tool ${toolCall.function.name}:`, error);
                            return { error: `Failed to execute tool ${toolCall.function.name}` };
                        }
                    })
                );

                // Add tool results to messages
                messages.push(response.message);
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
                    content: typeof messageContent === 'string' ? messageContent : '',
                    toolResults,
                    tokenCount
                };
            }

            const messageContent = response.message.content;
            return {
                content: typeof messageContent === 'string' ? messageContent : '',
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
    }): Promise<{
        choices: Array<{
            message: ChatCompletionMessageParam;
            finish_reason: string;
        }>;
        usage?: {
            total_tokens: number;
        };
    }> {
        // Add tools information if provided
        let augmentedMessages = [...options.messages];
        if (options.tools) {
            const toolsDescription = `Available tools:\n${options.tools.map(tool => 
                `${tool.function.name}: ${tool.function.description}\nParameters: ${JSON.stringify(tool.function.parameters, null, 2)}\n`
            ).join('\n')}\n\n`;
            
            // Add tools info to system message if exists, or create new system message
            const systemMessageIndex = augmentedMessages.findIndex(msg => msg.role === 'system');
            if (systemMessageIndex >= 0) {
                augmentedMessages[systemMessageIndex] = {
                    ...augmentedMessages[systemMessageIndex],
                    content: `${augmentedMessages[systemMessageIndex].content}\n\n${toolsDescription}`
                };
            } else {
                augmentedMessages.unshift({
                    role: 'system',
                    content: toolsDescription
                });
            }
        }

        return this.makeApiCall(augmentedMessages, options.temperature || 0.7);
    }

    protected abstract makeApiCall(
        messages: ChatCompletionMessageParam[],
        temperature: number
    ): Promise<{
        choices: Array<{
            message: ChatCompletionMessageParam;
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
