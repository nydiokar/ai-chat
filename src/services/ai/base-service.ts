import { AIService, AIMessage, AIResponse } from '../../types/ai-service.js';
import { IToolManager } from '../../tools/mcp/migration/interfaces/core.js';
import { SystemPromptGenerator } from '../../system-prompt-generator.js';
import { MCPContainer } from '../../tools/mcp/migration/di/container.js';
import { Cleanable } from '../../types/cleanable.js';
import { MCPError, ErrorType } from '../../types/errors.js';

export abstract class BaseAIService implements AIService, Cleanable {
    protected systemPrompt: string = '';
    protected toolManager!: IToolManager;
    protected promptGenerator!: SystemPromptGenerator;

    constructor(protected readonly container: MCPContainer) {
        this.initializeService();
    }

    private initializeService(): void {
        try {
            // Get tool manager from container
            this.toolManager = this.container.getToolManager();
            
            // Create system prompt generator with tool manager
            this.promptGenerator = new SystemPromptGenerator(this.toolManager);
        } catch (error) {
            throw new MCPError(
                'Failed to initialize AI service',
                ErrorType.INITIALIZATION_ERROR,
                { cause: error instanceof Error ? error : new Error(String(error)) }
            );
        }
    }

    abstract generateResponse(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse>;
    abstract getModel(): string;

    setSystemPrompt(prompt: string): void {
        this.validateState();
        this.systemPrompt = prompt;
    }

    async cleanup(): Promise<void> {
        this.systemPrompt = '';
        // Container cleanup is handled by the factory
    }

    protected async getSystemPrompt(): Promise<string> {
        this.validateState();
        if (!this.systemPrompt) {
            this.systemPrompt = await this.promptGenerator.generatePrompt();
        }
        return this.systemPrompt;
    }

    async processMessage(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse> {
        this.validateState();
        return this.generateResponse(message, conversationHistory);
    }

    protected validateState(): void {
        if (!this.toolManager) {
            throw new MCPError('Tool manager not initialized', ErrorType.INITIALIZATION_ERROR);
        }
        if (!this.promptGenerator) {
            throw new MCPError('Prompt generator not initialized', ErrorType.INITIALIZATION_ERROR);
        }
    }
}
