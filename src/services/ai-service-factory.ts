import { AIService } from './ai/base-service.js';
import { OpenAIService } from './ai/openai.js';
import { AnthropicService } from './ai/anthropic.js';
import { MCPError, ErrorType } from '../types/errors.js';
import { handleError } from '../utils/error-handler.js';
import { DeepseekService } from './ai/deepseek.js';

export class AIServiceFactory {
    static create(model: 'gpt' | 'claude' | 'deepseek' = 'gpt'): AIService {
        try {
            switch (model) {
                case 'gpt':
                    return new OpenAIService();
                case 'claude':
                    return new AnthropicService();
                case 'deepseek':
                    return new DeepseekService();
                default:
                    throw new MCPError(ErrorType.INVALID_MODEL, `Invalid model type: ${model}`);
            }
        } catch (error) {
            return handleError(error);
        }
    }
} 