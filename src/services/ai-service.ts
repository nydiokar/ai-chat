import { Message, MessageRole, Tool } from '../types/index.js';
import { validateInput, defaultConfig } from '../config.js';


const MAX_CONTEXT_MESSAGES = 10;
const MAX_TOKENS_PER_REQUEST = 4000;
const DEBUG = process.env.DEBUG === 'true';
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 50;

interface RateLimitTracker {
  requests: number;
  windowStart: number;
}

const rateLimiters: Record<'gpt' | 'claude', RateLimitTracker> = {
  gpt: { requests: 0, windowStart: Date.now() },
  claude: { requests: 0, windowStart: Date.now() }
};

function checkRateLimit(model: 'gpt' | 'claude'): void {
  const now = Date.now();
  const limiter = rateLimiters[model];
  
  if (now - limiter.windowStart > RATE_LIMIT_WINDOW) {
    limiter.requests = 0;
    limiter.windowStart = now;
  }
  
  if (limiter.requests >= MAX_REQUESTS_PER_WINDOW) {
    throw new Error(`Rate limit exceeded for ${model}. Please try again later.`);
  }
  
  limiter.requests++;
}

function estimateTokenCount(text: string): number {
  // Rough estimation: ~4 chars per token
  return Math.ceil(text.length / 4);
}

interface OpenAIResponse {
  choices: [{
    message: {
      content: string;
    };
  }];
  usage?: {
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
  };
}

interface AnthropicResponse {
  content: [{
    text: string;
  }];
  model: string;
  role: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AIMessage {
  role: MessageRole;
  content: string;
}

function isUserOrAssistant(role: MessageRole): role is 'user' | 'assistant' {
  return role === 'user' || role === 'assistant';
}

interface APIErrorResponse {
  error?: {
    message?: string;
  };
}

export interface AIService {
  generateResponse(
    prompt: string, 
    conversationHistory?: Message[],
    tools?: Tool[]): Promise<{ content: string; tokenCount: number | null }>;
  getModel(): 'gpt' | 'claude';
}

abstract class BaseAIService implements AIService {
  protected async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= defaultConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        if (error.message.includes('rate limit') && attempt < defaultConfig.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, defaultConfig.retryDelay * attempt));
          continue;
        }
        throw error;
      }
    }
    
    throw lastError || new Error('Operation failed after retries');
  }

  abstract generateResponse(prompt: string, conversationHistory?: Message[]): Promise<{ content: string; tokenCount: number | null }>;
  abstract getModel(): 'gpt' | 'claude';
}

export class OpenAIService extends BaseAIService {
  private apiKey: string;

  constructor() {
    super();
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not found in environment variables');
    }
    this.apiKey = apiKey;
  }

  private debug(message: string) {
    if (DEBUG) {
      console.log(`[OpenAI Debug] ${message}`);
    }
  }

  private validateResponse(data: unknown): data is OpenAIResponse {
    if (typeof data !== 'object' || data === null) return false;
    const response = data as any;
    return (
      Array.isArray(response.choices) &&
      response.choices.length > 0 &&
      typeof response.choices[0].message?.content === 'string'
    );
  }

  private getContextMessages(history?: Message[]): AIMessage[] {
    const messages: AIMessage[] = [];
    
    if (history) {
      const recentMessages = history.slice(-MAX_CONTEXT_MESSAGES);
      messages.push(...recentMessages
        .filter(msg => isUserOrAssistant(msg.role))
        .map(msg => ({
          role: msg.role,
          content: msg.content
        })));
    }

    return messages;
  }

  async generateResponse(prompt: string, conversationHistory?: Message[]): Promise<{ content: string; tokenCount: number | null }> {
    try {
      const validationError = validateInput(prompt);
      if (validationError) {
        throw new Error(validationError);
      }

      return await this.withRetry(async () => {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          signal: AbortSignal.timeout(30000),
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [
              ...this.getContextMessages(conversationHistory),
              { role: 'user' as const, content: prompt }
            ],
            temperature: 0.7,
          }),
        });

        if (!response.ok) {
          const error = await response.json() as APIErrorResponse;
          throw new Error(`API error: ${error.error?.message || response.statusText}`);
        }

        const data = await response.json();
        this.debug(`API Response: ${JSON.stringify(data)}`);

        if (!this.validateResponse(data)) {
          throw new Error('Invalid API response format');
        }

        const tokenCount = data.usage?.total_tokens || estimateTokenCount(data.choices[0].message.content);
        return {
          content: data.choices[0].message.content,
          tokenCount
        };
      });
    } catch (err: unknown) {
      const error = err as Error;
      const message = error?.message || 'Unknown error occurred';
      throw new Error(`OpenAI API error: ${message}`);
    }
  }

  getModel(): 'gpt' | 'claude' {
    return 'gpt';
  }
}

export class AnthropicService extends BaseAIService {
  private apiKey: string;

  constructor() {
    super();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Anthropic API key not found in environment variables');
    }
    this.apiKey = apiKey;
  }

  private debug(message: string) {
    if (DEBUG) {
      console.log(`[Anthropic Debug] ${message}`);
    }
  }

  private validateResponse(data: unknown): data is AnthropicResponse {
    if (typeof data !== 'object' || data === null) return false;
    const response = data as any;
    return (
      Array.isArray(response.content) &&
      response.content.length > 0 &&
      typeof response.content[0].text === 'string' &&
      typeof response.model === 'string' &&
      typeof response.role === 'string'
    );
  }

  private getContextMessages(history?: Message[]): AIMessage[] {
    const messages: AIMessage[] = [];
    
    if (history) {
      const recentMessages = history.slice(-MAX_CONTEXT_MESSAGES);
      messages.push(...recentMessages
        .filter(msg => isUserOrAssistant(msg.role))
        .map(msg => ({
          role: msg.role,
          content: msg.content
        })));
    }

    return messages;
  }

  async generateResponse(prompt: string, conversationHistory?: Message[]): Promise<{ content: string; tokenCount: number | null }> {
    try {
      const validationError = validateInput(prompt);
      if (validationError) {
        throw new Error(validationError);
      }

      return await this.withRetry(async () => {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          signal: AbortSignal.timeout(30000),
          body: JSON.stringify({
            model: 'claude-3-opus-20240229',
            messages: [
              ...this.getContextMessages(conversationHistory).map(msg => ({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: msg.content
              })),
              { role: 'user', content: prompt }
            ],
            max_tokens: 1000,
            temperature: 0.7,
          }),
        });

        if (!response.ok) {
          const error = await response.json() as APIErrorResponse;
          throw new Error(`API error: ${error.error?.message || response.statusText}`);
        }

        const data = await response.json();
        this.debug(`API Response: ${JSON.stringify(data)}`);

        if (!this.validateResponse(data)) {
          throw new Error('Invalid API response format');
        }

        const tokenCount = data.usage?.input_tokens 
          ? data.usage.input_tokens + data.usage.output_tokens
          : estimateTokenCount(data.content[0].text);
        
        return {
          content: data.content[0].text,
          tokenCount
        };
      });
    } catch (err: unknown) {
      const error = err as Error;
      const message = error?.message || 'Unknown error occurred';
      throw new Error(`Anthropic API error: ${message}`);
    }
  }

  getModel(): 'gpt' | 'claude' {
    return 'claude';
  }
}
