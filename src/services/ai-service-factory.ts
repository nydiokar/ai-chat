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
        console.log('[AIServiceFactory] Starting initialization with MCP enabled:', defaultConfig.discord.mcp.enabled);
        
        if (this.container) {
            throw new MCPError('Factory already initialized', ErrorType.INITIALIZATION_ERROR);
        }

        // Skip MCP initialization when disabled
        if (!defaultConfig.discord.mcp.enabled) {
            console.log('[AIServiceFactory] MCP is disabled, skipping initialization');
            this.container = null;
            this.toolManager = null;
            return;
        }

        try {
            console.log('[AIServiceFactory] Creating container...');
            if (configOrContainer instanceof MCPContainer) {
                this.container = configOrContainer;
            } else {
                this.container = new MCPContainer(configOrContainer);
            }
            
            console.log('[AIServiceFactory] Getting tool manager...');
            this.toolManager = this.container.getToolManager();
            
            // Refresh tool information but handle failures gracefully
            try {
                console.log('[AIServiceFactory] Refreshing tool information...');
                // Initial refresh to load tools
                await this.toolManager.refreshToolInformation();
                
                console.log('[AIServiceFactory] Getting available tools...');
                // Get available tools after refresh - even if some servers failed, 
                // we should still get tools from working ones
                const tools = await this.toolManager.getAvailableTools();
                console.log('[AIServiceFactory] Available tools:', tools);
                
                // Listen for tool refresh events from the ToolManager directly
                // This avoids redundant refresh since the ToolManager already listens to the server manager
                // and will emit events when tools change
                if ('on' in this.toolManager) {
                    (this.toolManager as any).on('tools.refreshed', () => {
                        console.log('[AIServiceFactory] Tools refreshed by tool manager');
                    });
                }
            } catch (error) {
                console.warn('[AIServiceFactory] Error during tool initialization:', error);
                console.warn('[AIServiceFactory] Some tools failed to load, but continuing with available tools');
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
        } catch (error) {
            console.error('[AIServiceFactory] Critical error during initialization:', error);
            throw new MCPError(
                'Failed to initialize AI service factory',
                ErrorType.INITIALIZATION_ERROR,
                { cause: error instanceof Error ? error : new Error(String(error)) }
            );
        }
    }

    /**
     * Create an AI service instance
     * @throws MCPError if factory not initialized
     */
    static create(model?: string): AIService {
        // When MCP is disabled, create a minimal OpenAI service
        if (!defaultConfig.discord.mcp.enabled) {
            const selectedModel = model || defaultConfig.defaultModel;
            if (selectedModel !== 'gpt') {
                throw new MCPError(
                    'Currently only OpenAI (gpt) is supported',
                    ErrorType.INVALID_MODEL
                );
            }
            // Create a minimal container just for OpenAI service
            const container = new MCPContainer(mcpConfig);
            return new OpenAIService(container);
        }

        if (!this.container || !this.toolManager) {
            throw new MCPError('Factory not initialized', ErrorType.INITIALIZATION_ERROR);
        }

        // For now, we only support OpenAI
        const selectedModel = model || defaultConfig.defaultModel;
        
        // Log model configuration at info level
        console.log('[AIServiceFactory] Model Configuration:');
        console.log(`  • Selected model: ${selectedModel}`);
        console.log(`  • Environment MODEL: ${process.env.MODEL}`);
        console.log(`  • Default config: ${defaultConfig.defaultModel}`);

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

