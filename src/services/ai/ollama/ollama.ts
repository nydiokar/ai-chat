import { Message, Role } from '../../types/index.js';
import { AIResponse, BaseAIService } from './base-service.js';
import { ChatCompletionAssistantMessageParam, ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { aiRateLimiter } from './utils/rate-limiter.js';
import { Ollama } from 'ollama';
import { debug } from '../../utils/config.js';

interface BraveSearchArgs {
    query: string;
    count?: number | string;
}

export class OllamaService extends BaseAIService {
    private ollama: Ollama;
    private toolsInitialized: boolean = false;
    private toolsInitPromise: Promise<void>;
    private availableTools: {
        type: 'function';
        function: {
            name: string;
            description: string;
            parameters: {
                type: string;
                properties: {
                    [key: string]: {
                        type: string;
                        description: string;
                    };
                };
                required: string[];
            };
        };
    }[] = [];

    constructor() {
        super();
        
        this.ollama = new Ollama({
            host: process.env.OLLAMA_HOST || 'http://localhost:11434'
        });

        this.toolsInitPromise = this.initializeTools();
    }

    private async initializeTools(): Promise<void> {
        try {
            await this.initPromise;

            if (!this.mcpManager) {
                throw new Error('MCP Manager not initialized');
            }

            debug('[OllamaService] Initializing tools...');

            const braveServer = this.mcpManager.getServerByIds('brave-search');
            if (!braveServer) {
                throw new Error('Brave Search server not available');
            }

            // Add Brave Search tool
            this.availableTools.push({
                type: 'function',
                function: {
                    name: 'brave_web_search',
                    description: 'Search the web using Brave Search',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description: 'The search query string'
                            },
                            count: {
                                type: 'string',
                                description: 'Number of results to return (default: 5)'
                            }
                        },
                        required: ['query']
                    }
                }
            });

            debug(`[OllamaService] Registered Brave Search tool`);
            this.toolsInitialized = true;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error during tool initialization';
            console.error('[OllamaService] Failed to initialize tools:', message);
            throw new Error(message);
        }
    }

    private parseFunctionArguments(args: string): BraveSearchArgs {
        try {
            const parsed = JSON.parse(args);
            if (typeof parsed !== 'object' || !parsed.query) {
                throw new Error('Invalid arguments format');
            }
            return {
                query: String(parsed.query),
                count: parsed.count
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to parse arguments';
            throw new Error(`Invalid tool arguments: ${message}`);
        }
    }

    private async executeBraveSearch(args: BraveSearchArgs): Promise<any> {
        if (!this.mcpManager) {
            throw new Error('MCP Manager not initialized');
        }

        const serverId = 'brave-search';
        const toolName = 'brave_web_search';
        const convId = Math.floor(Date.now() / 1000); // Unix timestamp as conversation ID

        // Just send the search query directly
        return await this.mcpManager.executeToolQuery(
            serverId,
            toolName,
            convId
        );
    }

    protected async processWithoutTools(
        message: string,
        history?: Message[]
    ): Promise<AIResponse> {
        aiRateLimiter.checkLimit(this.getModel());

        await this.toolsInitPromise;

        const messages = [
            ...(history || []).map(msg => ({
                role: msg.role === Role.assistant ? 'assistant' : 'user',
                content: msg.content
            })),
            { role: 'user', content: message }
        ];

        try {
            debug('[OllamaService] Sending request:', { message, toolCount: this.availableTools.length });

            const response = await this.ollama.chat({
                model: process.env.OLLAMA_MODEL || 'llama3.1:8b-instruct-q8_0',
                messages,
                tools: this.availableTools,
                format: 'json',
                options: {
                    temperature: 0.7
                }
            });

            debug('[OllamaService] Got response:', response.message);

            let content = response.message.content;
            const toolResults = [];

            if (response.message.tool_calls?.length) {
                for (const toolCall of response.message.tool_calls) {
                    try {
                        const args = this.parseFunctionArguments(toolCall.function.arguments);
                        const result = await this.executeBraveSearch(args);

                        debug('[OllamaService] Tool execution result:', result);

                        toolResults.push({
                            tool: toolCall.function.name,
                            result,
                            tool_call_id: `tc_${Date.now()}`
                        });

                        messages.push(response.message);
                        messages.push({
                            role: 'tool',
                            content: JSON.stringify(result)
                        });
                    } catch (error) {
                        const message = error instanceof Error ? error.message : 'Unknown error';
                        console.error('[OllamaService] Tool execution error:', message);
                    }
                }

                if (toolResults.length > 0) {
                    const finalResponse = await this.ollama.chat({
                        model: process.env.OLLAMA_MODEL || 'llama3.1:8b-instruct-q8_0',
                        messages: [
                            ...messages,
                            {
                                role: 'user',
                                content: 'Summarize these search results clearly and concisely.'
                            }
                        ]
                    });

                    content = finalResponse.message.content;
                }
            }

            return {
                content,
                toolResults,
                tokenCount: content.length
            };

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('[OllamaService] Error:', message);
            throw new Error(message);
        }
    }

    protected async makeApiCall(
        messages: ChatCompletionMessageParam[],
        temperature: number
    ) {
        await this.toolsInitPromise;

        const response = await this.processWithoutTools(
            messages[messages.length - 1].content as string,
            messages.slice(0, -1).map(m => ({
                role: m.role,
                content: m.content as string
            })) as Message[]
        );

        const assistantMessage: ChatCompletionAssistantMessageParam = {
            role: 'assistant',
            content: response.content,
            tool_calls: response.toolResults.map(tr => ({
                id: tr.tool_call_id,
                type: 'function',
                function: {
                    name: tr.tool,
                    arguments: JSON.stringify(tr.result)
                }
            }))
        };

        return {
            choices: [{
                message: assistantMessage,
                finish_reason: 'stop'
            }],
            usage: response.tokenCount ? { total_tokens: response.tokenCount } : undefined
        };
    }

    async processMessage(message: string, history?: Message[]): Promise<AIResponse> {
        return this.processWithoutTools(message, history);
    }

    async generateResponse(message: string, history?: Message[]): Promise<AIResponse> {
        return this.processWithoutTools(message, history);
    }

    getModel(): 'gpt' | 'claude' | 'deepseek' | 'ollama' {
        return 'ollama';
    }
}
