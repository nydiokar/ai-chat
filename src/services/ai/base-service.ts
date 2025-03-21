import { AIService, AIMessage, AIResponse } from '../../types/ai-service.js';
import { IToolManager } from '../../tools/mcp/interfaces/core.js';
import { SystemPromptGenerator } from '../../system-prompt-generator.js';
import { MCPContainer } from '../../tools/mcp/di/container.js';
import { MCPError, ErrorType } from '../../tools/mcp/types/errors.js';

/**
 * Abstract base class for AI services
 * Provides common functionality and interface that specific implementations must follow
 */
export abstract class BaseAIService implements AIService {
    protected readonly toolManager: IToolManager;
    protected readonly promptGenerator: SystemPromptGenerator;
    protected systemPrompt: string = '';

    constructor(protected readonly container: MCPContainer) {
        // Container is already validated by AIServiceFactory
        this.toolManager = container.getToolManager();
        this.promptGenerator = new SystemPromptGenerator(this.toolManager);
    }

    /**
     * Generate a response for a given message
     * This is the main method that implementations must provide
     */
    abstract generateResponse(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse>;

    /**
     * Get the model identifier
     * Implementations should return their specific model identifier
     */
    abstract getModel(): string;

    /**
     * Process a message (delegates to generateResponse by default)
     * Implementations can override this if they need different processing logic
     */
    async processMessage(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse> {
        return this.generateResponse(message, conversationHistory);
    }

    /**
     * Set the system prompt
     */
    setSystemPrompt(prompt: string): void {
        this.validateState();
        this.systemPrompt = prompt;
    }

    /**
     * Cleanup resources
     */
    async cleanup(): Promise<void> {
        this.systemPrompt = '';
    }

    /**
     * Get the system prompt
     */
    protected async getSystemPrompt(): Promise<string> {
        this.validateState();
        if (!this.systemPrompt) {
            this.systemPrompt = await this.promptGenerator.generatePrompt();
        }
        return this.systemPrompt;
    }

    /**
     * Validate service state
     */
    protected validateState(): void {
        if (!this.toolManager || !this.promptGenerator) {
            throw MCPError.initializationFailed(
                new Error('AI service not properly initialized')
            );
        }
    }
}
