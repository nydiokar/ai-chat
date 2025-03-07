import { AIService } from './ai/base-service.js';
import { OpenAIService } from './ai/openai.js';
import { AnthropicService } from './ai/anthropic.js';
import { MCPError, ErrorType } from '../types/errors.js';
import { handleError } from '../utils/error-handler.js';
import { DeepseekService } from './ai/deepseek.js';
import { OllamaService } from './ai/ollama.js';
import { defaultConfig } from '../utils/config.js';
import { MCPServerManager } from '../tools/mcp/mcp-server-manager.js';
import { DatabaseService } from './db-service.js';
import { ToolsHandler } from '../tools/tools-handler.js';
import { MCPClientService } from '../tools/mcp/mcp-client-service.js';

export class AIServiceFactory {
    private static mcpManager: MCPServerManager | null = null;
    private static toolsHandler: ToolsHandler | null = null;

    private static async initializeMCPComponents(): Promise<void> {
        if (!AIServiceFactory.mcpManager) {
            const db = DatabaseService.getInstance();
            AIServiceFactory.mcpManager = new MCPServerManager(db);
            await AIServiceFactory.mcpManager.initialize();
            
            // Initialize ToolsHandler after MCPServerManager is ready
            const serverClients = AIServiceFactory.mcpManager.getServerIds()
                .map(id => ({
                    id,
                    client: AIServiceFactory.mcpManager!.getServerByIds(id)
                }))
                .filter((item): item is { id: string; client: MCPClientService } => 
                    item.client !== undefined);

            AIServiceFactory.toolsHandler = new ToolsHandler(db, serverClients, null);
        }
    }

    static async create(model?: 'gpt' | 'claude' | 'deepseek' | 'ollama'): Promise<AIService> {
        // Initialize MCP components if needed
        if (defaultConfig.discord.mcp.enabled || process.env.MCP_ENABLED === 'true') {
            await AIServiceFactory.initializeMCPComponents();
        }

        // Always use config model, ignore input parameter
        const selectedModel = defaultConfig.defaultModel;
        console.warn(`[AIServiceFactory] Input model: ${model}`);

        try {
            let service: AIService;
            switch (selectedModel) {
                case 'gpt':
                    service = new OpenAIService();
                    break;
                case 'claude':
                    service = new AnthropicService();
                    break;
                case 'deepseek':
                    service = new DeepseekService();
                    break;
                case 'ollama':
                    service = new OllamaService();
                    break;
                default:
                    throw new MCPError(ErrorType.INVALID_MODEL, `Invalid model type: ${selectedModel}`);
            }

            // Inject the singleton MCP components
            if (AIServiceFactory.mcpManager && AIServiceFactory.toolsHandler) {
                service.injectMCPComponents(AIServiceFactory.mcpManager, AIServiceFactory.toolsHandler);
            }

            return service;
        } catch (error) {
            return handleError(error);
        }
    }
}
