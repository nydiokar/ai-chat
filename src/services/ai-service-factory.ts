import { AIService } from '../types/ai-service.js';
import { OpenAIService } from './ai/openai.js';
import { AnthropicService } from './ai/anthropic.js';
import { MCPError, ErrorType } from '../types/errors.js';
import { handleError } from '../utils/error-handler.js';
import { OllamaService } from './ai/ollama.js';
import { defaultConfig } from '../utils/config.js';
import { ToolInformationProvider } from '../types/tools.js';
import { MCPServerManager } from '../tools/mcp/mcp-server-manager.js';

export class AIServiceFactory {
    static create(model?: 'gpt' | 'claude' | 'ollama', toolProvider?: ToolInformationProvider): AIService {
        // Use provided model if available, otherwise use config default
        const selectedModel = model || defaultConfig.defaultModel;
        console.warn(`[AIServiceFactory] Using model: ${selectedModel}`);
        console.warn(`[AIServiceFactory] Environment MODEL: ${process.env.MODEL}`);
        console.warn(`[AIServiceFactory] Default config model: ${defaultConfig.defaultModel}`);

        try {
            // Cast toolProvider to MCPServerManager if it exists
            const mcpManager = toolProvider as MCPServerManager;

            switch (selectedModel) {
                case 'gpt':
                    return new OpenAIService(mcpManager);
                case 'claude':
                    return new AnthropicService(mcpManager);
                case 'ollama':
                    return new OllamaService(mcpManager);
                default:
                    throw new MCPError(ErrorType.INVALID_MODEL, `Invalid model type: ${selectedModel}`);
            }
        } catch (error) {
            return handleError(error);
        }
    }
}
