import { AIService } from './ai/base-service.js';
import { OpenAIService } from './ai/openai.js';
import { AnthropicService } from './ai/anthropic.js';
import { MCPError, ErrorType } from '../types/errors.js';
import { handleError } from '../utils/error-handler.js';
import { DeepseekService } from './ai/deepseek.js';
import { OllamaService } from './ai/ollama.js';
import { defaultConfig } from '../utils/config.js';

export class AIServiceFactory {
    static create(model?: 'gpt' | 'claude' | 'deepseek' | 'ollama'): AIService {
        // Use provided model if available, otherwise use config default
        const selectedModel = model || defaultConfig.defaultModel;
        console.warn(`[AIServiceFactory] Using model: ${selectedModel}`);
        console.warn(`[AIServiceFactory] Environment MODEL: ${process.env.MODEL}`);
        console.warn(`[AIServiceFactory] Default config model: ${defaultConfig.defaultModel}`);

        try {
            switch (selectedModel) {
                case 'gpt':
                    return new OpenAIService();
                case 'claude':
                    return new AnthropicService();
                case 'deepseek':
                    return new DeepseekService();
                case 'ollama':
                    return new OllamaService();
                default:
                    throw new MCPError(ErrorType.INVALID_MODEL, `Invalid model type: ${selectedModel}`);
            }
        } catch (error) {
            return handleError(error);
        }
    }
}
