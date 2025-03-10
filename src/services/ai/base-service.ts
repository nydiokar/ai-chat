import { ToolInformationProvider } from '../../types/tools.js';
import { SystemPromptGenerator } from '../../system-prompt-generator.js';
import { AIService, AIMessage, AIResponse } from '../../types/ai-service.js';
import { MCPServerManager } from '../../tools/mcp/mcp-server-manager.js';
import { 
    ChatCompletionMessageParam,
    ChatCompletionSystemMessageParam,
    ChatCompletionDeveloperMessageParam,
    ChatCompletionUserMessageParam,
    ChatCompletionAssistantMessageParam,
    ChatCompletionToolMessageParam
} from 'openai/resources/chat/completions.js';
import { ToolsHandler } from '../../tools/tools-handler.js';
import { DatabaseService } from '../../services/db-service.js';
import { Cleanable } from '../../types/cleanable.js';

export abstract class BaseAIService implements AIService, Cleanable {
    protected systemPrompt: string = '';
    protected toolsHandler: ToolsHandler;
    protected promptGenerator: SystemPromptGenerator;
    protected isO1Model: boolean = false;

    constructor(mcpManager: MCPServerManager) {
        // Create ToolsHandler with the MCPServerManager's clients
        this.toolsHandler = new ToolsHandler(
            mcpManager.getClients().map(client => ({
                id: client.serverConfig.id,
                client
            })),
            DatabaseService.getInstance()
        );
        
        // Create SystemPromptGenerator with ToolsHandler as the provider
        this.promptGenerator = new SystemPromptGenerator(this.toolsHandler);
    }

    abstract generateResponse(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse>;
    abstract processMessage(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse>;
    abstract getModel(): string;

    setSystemPrompt(prompt: string): void {
        this.systemPrompt = prompt;
    }

    setIsO1Model(isO1: boolean): void {
        this.isO1Model = isO1;
    }

    async cleanup(): Promise<void> {
        try {
            // Cleanup tools handler if it exists
            if (this.toolsHandler) {
                // Note: ToolsHandler doesn't implement Cleanable as it doesn't need cleanup
                // It's just a wrapper around MCPClientService which does implement Cleanable
            }
            
            // Reset state
            this.systemPrompt = '';
            this.isO1Model = false;
        } catch (error) {
            console.error('[BaseAIService] Cleanup failed:', error);
            throw error;
        }
    }

    protected async getSystemPrompt(): Promise<string> {
        if (!this.systemPrompt) {
            this.systemPrompt = await this.promptGenerator.generatePrompt();
        }
        return this.systemPrompt;
    }

    protected prepareMessages(
        systemPrompt: string,
        message: string,
        conversationHistory?: AIMessage[]
    ): ChatCompletionMessageParam[] {
        const messages: ChatCompletionMessageParam[] = [];

        // Add system/developer message based on model type
        if (this.isO1Model) {
            messages.push({
                role: 'developer',
                content: systemPrompt
            } as ChatCompletionDeveloperMessageParam);
        } else {
            messages.push({
                role: 'system',
                content: systemPrompt
            } as ChatCompletionSystemMessageParam);
        }

        // Add conversation history
        if (conversationHistory) {
            messages.push(...conversationHistory.map(msg => {
                switch (msg.role) {
                    case 'tool':
                        return {
                            role: 'tool',
                            content: msg.content,
                            tool_call_id: msg.tool_call_id || 'unknown'
                        } as ChatCompletionToolMessageParam;
                    case 'assistant':
                        return {
                            role: 'assistant',
                            content: msg.content
                        } as ChatCompletionAssistantMessageParam;
                    case 'user':
                        return {
                            role: 'user',
                            content: msg.content
                        } as ChatCompletionUserMessageParam;
                    case 'system':
                        return this.isO1Model ? 
                            {
                                role: 'developer',
                                content: msg.content
                            } as ChatCompletionDeveloperMessageParam :
                            {
                                role: 'system',
                                content: msg.content
                            } as ChatCompletionSystemMessageParam;
                    default:
                        return {
                            role: 'user',
                            content: msg.content
                        } as ChatCompletionUserMessageParam;
                }
            }));
        }

        // Add current message
        messages.push({
            role: 'user',
            content: message
        } as ChatCompletionUserMessageParam);

        return messages;
    }
}
