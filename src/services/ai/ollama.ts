import { Message, MessageRole } from '../../types/index.js';
import { AIResponse, BaseAIService } from './base-service.js';
import { aiRateLimiter } from './utils/rate-limiter.js';
import { ChatCompletionMessageParam, ChatCompletionAssistantMessageParam } from 'openai/resources/chat/completions.js';
import OpenAI from 'openai';
import { debug } from '../../utils/config.js';
import { ToolsHandler } from '../../tools/tools-handler.js';
import { OllamaBridge } from './ollama/bridge.js';

export class OllamaService extends BaseAIService {
    private baseUrl: string;
    private modelName: string;
    private client: OpenAI;
    private bridge: OllamaBridge;
    private availableTools: any[] = [];
    private toolsInitialized: boolean = false;
    private toolsInitPromise: Promise<void>;

    constructor() {
        super();
        this.baseUrl = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
        this.modelName = (process.env.OLLAMA_MODEL || 'shrijayan/llama-2-7b-chat-q2k:latest').split('#')[0].trim();
        
        this.client = new OpenAI({
            baseURL: `${this.baseUrl}/v1`,
            apiKey: 'ollama',
        });
        
        this.bridge = new OllamaBridge({
            baseUrl: this.baseUrl,
            model: this.modelName
        });

        // Initialize tools with proper waiting for servers
        if (this.mcpManager) {
            this.toolsInitPromise = new Promise((resolve) => {
                // If servers are already ready, initialize immediately
                const serverIds = this.mcpManager?.getServerIds() || [];
                if (serverIds.length > 0) {
                    this.initializeTools().then(resolve);
                } else {
                    // Otherwise wait for servers to be ready
                    this.mcpManager?.once('serversReady', () => {
                        this.initializeTools().then(resolve);
                    });
                }
            });
        } else {
            this.toolsInitPromise = Promise.resolve();
        }
    }

    private async initializeTools(): Promise<void> {
        if (this.toolsInitialized) return;

        try {
            const serverIds = this.mcpManager?.getServerIds() || [];
            this.availableTools = [];

            for (const serverId of serverIds) {
                const server = this.mcpManager?.getServerByIds(serverId);
                if (server) {
                    const tools = await server.listTools();
                    this.availableTools.push(...tools);
                }
            }

            this.toolsInitialized = true;
        } catch (error) {
            console.error('[OllamaService] Failed to initialize tools:', error);
            throw error;
        }
    }

    async generateResponse(message: string, conversationHistory?: Message[]): Promise<AIResponse> {
        return this.processMessage(message, conversationHistory);
    }

    async processMessage(message: string, conversationHistory?: Message[]): Promise<AIResponse> {
        await this.initPromise;

        try {
            const conversationId = conversationHistory?.[0]?.conversationId;
            
            // Set system prompt on bridge
            this.bridge.setSystemPrompt(this.systemPrompt);
             
            if (this.mcpManager && this.messageNeedsSearch(message)) {
                console.log('Processing with tools...');
                return this.processWithTools(message, conversationHistory, conversationId);
            } else {
                console.log('Processing without tools because:', {
                    noMcpManager: !this.mcpManager,
                    doesntNeedSearch: !this.messageNeedsSearch(message)
                });
                return this.processWithoutTools(message, conversationHistory);
            }
        } catch (error) {
            console.error('Ollama Service Error:', error);
            return this.processWithoutTools(message, conversationHistory);
        }
    }
    
    private messageNeedsSearch(message: string): boolean {
        // Check if the message contains keywords that suggest a search is needed
        const searchKeywords = [
            'search', 'find', 'look up', 'latest', 'recent', 'news',
            'current', 'today', 'yesterday', 'this week', 'this month',
            'information about', 'tell me about', 'what is', 'who is',
            'where is', 'when did', 'how to'
        ];
        
        const timeKeywords = ['latest', 'recent', 'today', 'yesterday', 'this week'];
        const lowerMessage = message.toLowerCase();
        
        // Log the decision making process
        console.log('[OllamaService] Search analysis:', {
            message: lowerMessage,
            hasSearchKeyword: searchKeywords.some(keyword => lowerMessage.includes(keyword.toLowerCase())),
            hasTimeKeyword: timeKeywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()))
        });
        
        return searchKeywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()));
    }

    protected async makeApiCall(
        messages: ChatCompletionMessageParam[],
        temperature: number
    ): Promise<{
        choices: Array<{
            message: ChatCompletionAssistantMessageParam;
            finish_reason: string;
        }>;
        usage?: { total_tokens: number };
    }> {
        try {
            // Extract the last user message
            const lastUserMessage = messages
                .filter(m => m.role === 'user')
                .pop()?.content as string;

            // Convert messages to conversation history format
            const conversationHistory: Message[] = messages
                .filter(msg => msg.role !== 'system')
                .map((msg, index) => ({
                    id: index,
                    content: String(msg.content || ''),  // Convert any content type to string
                    role: msg.role as MessageRole,
                    createdAt: new Date(),
                    conversationId: 0
                }));

            // Use bridge to process message
            const result = await this.bridge.processMessage(
                lastUserMessage,
                conversationHistory
            );

            // Convert bridge response to match BaseAIService types
            return {
                choices: [{
                    message: {
                        role: 'assistant',
                        content: result.content
                    } as ChatCompletionAssistantMessageParam,
                    finish_reason: 'stop'
                }],
                usage: {
                    total_tokens: result.tokenCount || 0
                }
            };
        } catch (error) {
            console.error('[OllamaService] makeApiCall error:', error);
            throw error;
        }
    }

    protected async handleToolBasedCompletion(
        messages: ChatCompletionMessageParam[],
        functions: any[],
        toolsHandler: ToolsHandler,
        conversationId?: number
    ): Promise<AIResponse> {
        try {
            // Wait for tools initialization to complete
            await this.toolsInitPromise;

            let userMessage = '';
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === 'user') {
                    userMessage = String(messages[i].content || '');
                    break;
                }
            }
            
            const conversationHistory: Message[] = messages
                .filter(msg => msg.role !== 'system')
                .map((msg, index) => ({
                    id: index,
                    content: String(msg.content || ''),
                    role: msg.role as MessageRole,
                    createdAt: new Date(),
                    conversationId: conversationId || 0
                }));
            
            const result = await this.bridge.processMessage(
                userMessage,
                conversationHistory,
                toolsHandler,
                this.availableTools,
                conversationId
            );
            
            return {
                content: String(result.content || ''),
                tokenCount: result.tokenCount || null,
                toolResults: result.toolResults || []
            };
        } catch (error) {
            console.error('Error in handleToolBasedCompletion:', error);
            throw error;
        }
    }

    protected async processWithoutTools(
        message: string, 
        conversationHistory?: Message[]
    ): Promise<AIResponse> {
        aiRateLimiter.checkLimit(this.getModel());
        
        const contextMessages = this.getContextMessages(conversationHistory);
        const messages: ChatCompletionMessageParam[] = [
            { role: "system", content: this.systemPrompt },
            ...contextMessages,
            { role: "user", content: message }
        ];

        const result = await this.makeApiCall(messages, 0.7);

        return {
            content: String(result.choices[0]?.message?.content || ''),
            tokenCount: result.usage?.total_tokens || null,
            toolResults: []
        };
    }

    protected async processWithTools(
        message: string, 
        conversationHistory?: Message[],
        conversationId?: number
    ): Promise<AIResponse> {
        // Wait for tools initialization before processing
        await this.toolsInitPromise;
        return super.processWithTools(message, conversationHistory, conversationId);
    }

    getModel(): 'gpt' | 'claude' | 'deepseek' | 'ollama' {
        return 'ollama';
    }
}
