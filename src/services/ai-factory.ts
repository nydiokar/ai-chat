import { Agent } from '../interfaces/agent.js';
import { OpenAIProvider } from '../providers/openai.js';
import { ReActAgent } from '../agents/react-agent.js';
import { ReActPromptGenerator } from '../prompt/react-prompt-generator.js';
import { MCPContainer, MCPConfig } from '../tools/mcp/di/container.js';
import { MCPError, ErrorType } from '../types/errors.js';
import { info, error, debug, warn } from '../utils/logger.js';
import { createLogContext, createErrorContext } from '../utils/log-utils.js';
import { mcpConfig } from '../mcp_config.js';
import { defaultConfig } from '../utils/config.js';
import { IToolManager } from '../tools/mcp/interfaces/core.js';

export class AIFactory {
    private static container: MCPContainer | null = null;
    private static toolManager: IToolManager | null = null;
    
    /**
     * Initialize the factory with MCP configuration
     * Must be called before creating any agents
     */
    static async initialize(configOrContainer: MCPConfig | MCPContainer = mcpConfig): Promise<void> {
        if (this.container) {
            throw new MCPError(
                'AIFactory already initialized', 
                ErrorType.INITIALIZATION_ERROR
            );
        }
        
        if (configOrContainer instanceof MCPContainer) {
            this.container = configOrContainer;
        } else {
            this.container = new MCPContainer(configOrContainer);
        }

        this.toolManager = this.container.getToolManager();
        
        // Log initialization
        debug('AIFactory initialized', createLogContext(
            'AIFactory',
            'initialize',
            { environment: process.env.NODE_ENV || 'development' }
        ));

        // Initial tool refresh with error recovery
        try {
            // Initial refresh to load tools
            await this.toolManager.refreshToolInformation();
            
            // Get available tools after refresh
            const tools = await this.toolManager.getAvailableTools();
            info('Tools loaded successfully', createLogContext(
                'AIFactory',
                'initialize',
                { toolCount: tools.length }
            ));

            // Listen for tool refresh events
            if ('on' in this.toolManager) {
                (this.toolManager as any).on('tools.refreshed', () => {
                    debug('Tools refreshed by tool manager', createLogContext(
                        'AIFactory',
                        'toolRefresh',
                        {}
                    ));
                });
            }
        } catch (err) {
            warn('Some tools failed to load, attempting recovery', createLogContext(
                'AIFactory',
                'initialize',
                { error: err instanceof Error ? err.message : String(err) }
            ));

            // Try to get any available tools even after partial failure
            try {
                const tools = await this.toolManager.getAvailableTools();
                if (tools.length > 0) {
                    info('Recovered with partial tools', createLogContext(
                        'AIFactory',
                        'initialize',
                        { recoveredToolCount: tools.length }
                    ));
                } else {
                    warn('No tools available after recovery attempt', createLogContext(
                        'AIFactory',
                        'initialize',
                        {}
                    ));
                }
            } catch (toolError) {
                error('Failed to get any tools', createErrorContext(
                    'AIFactory',
                    'initialize',
                    'System',
                    'TOOL_REFRESH_ERROR',
                    toolError
                ));
            }
        }
    }

    /**
     * Create an agent with optional model and name
     */
    static create(model?: string, agentName?: string): Agent {
        if (!this.container || !this.toolManager) {
            throw new MCPError(
                'AIFactory not initialized',
                ErrorType.INITIALIZATION_ERROR
            );
        }
        
        try {
            // Log creation attempt
            info('Creating agent', createLogContext(
                'AIFactory',
                'create',
                { 
                    model: model || defaultConfig.openai.model,
                    agentName: agentName || 'ReAct Agent' 
                }
            ));

            // Validate model configuration
            const selectedModel = model || defaultConfig.openai.model;
            
            // Ensure we use a valid OpenAI model name
            const config = { ...defaultConfig };
            config.openai.model = selectedModel === 'gpt' || selectedModel === 'openai' ? defaultConfig.openai.model : selectedModel;
            
            debug('Model configuration', createLogContext(
                'AIFactory',
                'create',
                {
                    selectedModel: config.openai.model,
                    envModel: process.env.MODEL,
                    defaultModel: defaultConfig.openai.model
                }
            ));
            
            // Create provider with config
            const provider = new OpenAIProvider(config);
            
            // Create prompt generator
            const promptGenerator = new ReActPromptGenerator();
            
            // Create and return agent
            return new ReActAgent(
                this.container,
                provider,
                promptGenerator,
                agentName // Pass custom name if provided
            ) as Agent;
        } catch (err) {
            // Handle errors
            error('Failed to create agent', createErrorContext(
                'AIFactory',
                'create',
                'System',
                'INITIALIZATION_ERROR',
                err
            ));
            
            throw new MCPError(
                'Failed to create agent',
                ErrorType.INITIALIZATION_ERROR,
                { cause: err instanceof Error ? err : new Error(String(err)) }
            );
        }
    }

    /**
     * Clean up factory resources
     */
    static cleanup(): void {
        this.container = null;
        this.toolManager = null;
        
        debug('AIFactory cleaned up', createLogContext(
            'AIFactory',
            'cleanup',
            {}
        ));
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

