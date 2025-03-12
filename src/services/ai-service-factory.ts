import { AIService } from '../types/ai-service.js';
import { OpenAIService } from './ai/openai.js';
import { MCPError, ErrorType } from '../types/errors.js';
import { defaultConfig } from '../utils/config.js';
import { MCPContainer, MCPConfig } from '../tools/mcp/migration/di/container.js';
import { mcpConfig } from '../tools/mcp/mcp_config.js';
import { IToolManager } from '../tools/mcp/migration/interfaces/core.js';

export class AIServiceFactory {
    private static container: MCPContainer | null = null;
    private static toolManager: IToolManager | null = null;

    /**
     * Initialize the factory with MCP configuration
     * Must be called before creating any services
     */
    static async initialize(configOrContainer: MCPConfig | MCPContainer = mcpConfig): Promise<void> {
        if (this.container) {
            throw new MCPError('Factory already initialized', ErrorType.INITIALIZATION_ERROR);
        }

        if (configOrContainer instanceof MCPContainer) {
            this.container = configOrContainer;
        } else {
            this.container = new MCPContainer(configOrContainer);
        }
        
        this.toolManager = this.container.getToolManager();
        
        // Ensure tools are loaded before proceeding
        await this.toolManager.refreshToolInformation();
        const tools = await this.toolManager.getAvailableTools();
        console.log('[AIServiceFactory] Initialized with tools:', tools.map(t => t.name));
    }

    /**
     * Create an AI service instance
     * @throws MCPError if factory not initialized
     */
    static create(model?: string): AIService {
        if (!this.container || !this.toolManager) {
            throw new MCPError('Factory not initialized', ErrorType.INITIALIZATION_ERROR);
        }

        // For now, we only support OpenAI
        const selectedModel = model || defaultConfig.defaultModel;
        console.warn(`[AIServiceFactory] Using model: ${selectedModel}`);
        console.warn(`[AIServiceFactory] Environment MODEL: ${process.env.MODEL}`);
        console.warn(`[AIServiceFactory] Default config model: ${defaultConfig.defaultModel}`);

        try {
            if (selectedModel !== 'gpt') {
                throw new MCPError(
                    'Currently only OpenAI (gpt) is supported',
                    ErrorType.INVALID_MODEL
                );
            }

            return new OpenAIService(this.container);
        } catch (error) {
            if (error instanceof MCPError) {
                throw error;
            }
            throw new MCPError(
                'Failed to create AI service',
                ErrorType.INITIALIZATION_ERROR,
                { cause: error instanceof Error ? error : new Error(String(error)) }
            );
        }
    }

    /**
     * Clean up factory resources
     */
    static cleanup(): void {
        this.container = null;
        this.toolManager = null;
    }

    /**
     * Get the tool manager instance
     * @throws MCPError if factory not initialized
     */
    static getToolManager(): IToolManager {
        if (!this.toolManager) {
            throw new MCPError('Factory not initialized', ErrorType.INITIALIZATION_ERROR);
        }
        return this.toolManager;
    }
}
