import { AIService, OpenAIService, AnthropicService } from './ai-service.js';

export class AIServiceFactory {
    static create(model: 'gpt' | 'claude' = 'gpt'): AIService {
        switch (model) {
            case 'gpt':
                return new OpenAIService();
            case 'claude':
                return new AnthropicService();
            default:
                return new OpenAIService();
        }
    }
} 