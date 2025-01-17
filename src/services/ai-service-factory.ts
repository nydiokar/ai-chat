import { AIService, } from './ai/base-service.js';
import { OpenAIService } from './ai/openai-service.js';
import { AnthropicService } from './ai/anthropic-service.js';
import { MCPError, ErrorType } from '../types/errors.js';
import { handleError } from '../utils/error-handler.js';

export class AIServiceFactory {
    static create(model: 'gpt' | 'claude' = 'gpt'): AIService {
        try {
            switch (model) {
                case 'gpt':
                    return new OpenAIService();
                case 'claude':
                    return new AnthropicService();
                default:
                    throw new MCPError(ErrorType.INVALID_MODEL, `Invalid model type: ${model}`);
            }
        } catch (error) {
            return handleError(error);
        }
    }
} 