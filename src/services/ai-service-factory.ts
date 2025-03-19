import { AIService } from '../types/ai-service.js';
import { OpenAIService } from './ai/openai.js';
import { MCPError, ErrorType } from '../types/errors.js';
import { defaultConfig } from '../utils/config.js';
import { MCPContainer, MCPConfig } from '../tools/mcp/di/container.js';
import { mcpConfig } from '../mcp_config.js';
import { IToolManager } from '../tools/mcp/interfaces/core.js';

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
        
        // Refresh tool information but handle failures gracefully
        try {
            await this.toolManager.refreshToolInformation();
            // Get available tools after refresh - even if some servers failed, we should still get tools from working ones
            const tools = await this.toolManager.getAvailableTools();
            console.log('[AIServiceFactory] Initialized with tools:', tools.map(t => t.name));
        } catch (error) {
            console.warn('Some tools failed to load, but continuing with available tools:', error);
            // Try to get any available tools even after partial failure
            try {
                const tools = await this.toolManager.getAvailableTools();
                if (tools.length > 0) {
                    console.log('[AIServiceFactory] Recovered with partial tools:', tools.map(t => t.name));
                } else {
                    console.warn('[AIServiceFactory] No tools available after recovery attempt');
                }
            } catch (toolError) {
                console.error('[AIServiceFactory] Failed to get any tools:', toolError);
            }
        }
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
