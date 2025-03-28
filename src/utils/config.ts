import { AIModel, Model } from '../types/index.js';

// Define AI providers and their models
export const AIProviders = {
  OPENAI: 'gpt',
  ANTHROPIC: 'claude',
  OLLAMA: 'ollama'
} as const;

// Define available OpenAI models
export const OpenAIModels = {
  GPT4: 'gpt-4-0125-preview',
  GPT35Turbo: 'gpt-3.5-turbo-0125',
  GPT35Turbo16k: 'gpt-3.5-turbo-16k',
  GPT4oMini: 'gpt-4o-mini-2024-07-18',
  GPT4o: 'gpt-4o-2024-08-06',
} as const;

// Model configuration by environment
export const modelConfig = {
  development: {
    default: OpenAIModels.GPT35Turbo,
    fallback: OpenAIModels.GPT35Turbo,
    options: [OpenAIModels.GPT35Turbo, OpenAIModels.GPT35Turbo16k, OpenAIModels.GPT4oMini, OpenAIModels.GPT4o],
  },
  production: {
    default: OpenAIModels.GPT4oMini,
    fallback: OpenAIModels.GPT35Turbo,
    options: Object.values(OpenAIModels),
  },
} as const;

// Helper functions for model selection
function getAIProvider(): AIModel {
  const provider = process.env.MODEL || AIProviders.OPENAI;
  
  if (!Object.values(AIProviders).includes(provider as any)) {
    console.warn(`[Config] Invalid provider ${provider}, defaulting to ${AIProviders.OPENAI}`);
    return AIProviders.OPENAI as AIModel;
  }
  
  return provider as AIModel;
}

function getOpenAIModel(currentProvider: AIModel): string {
  // Only configure OpenAI model if we're using OpenAI
  if (currentProvider !== AIProviders.OPENAI) {
    return modelConfig.development.default; // Fallback value, won't be used
  }

  const env = process.env.NODE_ENV || 'development';
  const envConfig = modelConfig[env as keyof typeof modelConfig];
  const configuredModel = process.env.OPENAI_MODEL;

  // If valid model specified in env, use it
  if (configuredModel && envConfig.options.includes(configuredModel as any)) {
    return configuredModel;
  }

  // Otherwise use default for environment
  return envConfig.default;
}

// Base configuration interface
export interface BaseConfig {
  debug: boolean;
  logging: {
    level: 'error' | 'warn' | 'info' | 'debug';
    showTools: boolean;
    showRequests: boolean;
  };
  maxRetries: number;
  retryDelay: number;
  rateLimitDelay: number;
  defaultModel: AIModel;
  messageHandling: {
    maxContextMessages: number;
    maxTokens: number;
    tokenBuffer: number;
    maxMessageLength: number;
  };
  openai: {
    model: string;
    temperature: number;
    maxRetries: number;
  };
  discord: {
    enabled: boolean;
    cleanupInterval: number;  // Hours before inactive sessions are cleaned up
    sessionTimeout: number;   // Hours before a session is considered inactive
    mcp: {  // MCP under Discord since it should only be used there
      enabled: boolean;
      authToken?: string;
      logLevel?: 'error' | 'warn' | 'info' | 'debug';
    };
  };
}

export const defaultConfig: BaseConfig = {
  defaultModel: getAIProvider(),
  messageHandling: {
    maxContextMessages: 3,  // Unified limit between OpenAI and Discord
    maxTokens: 4096,
    tokenBuffer: 1000,
    maxMessageLength: 8000
  },
  debug: process.env.DEBUG === 'true',
  logging: {
    level: (process.env.LOG_LEVEL || 'debug') as 'error' | 'warn' | 'info' | 'debug',
    showTools: process.env.LOG_SHOW_TOOLS === 'true',  // Just check if true, no default override
    showRequests: process.env.LOG_SHOW_REQUESTS === 'true'  // Just check if true, no default override
  },
  maxRetries: 3,
  retryDelay: 1000,
  rateLimitDelay: 1000,
  openai: {
    model: getOpenAIModel(getAIProvider()),
    temperature: Number(process.env.OPENAI_TEMPERATURE) || 0.7,
    maxRetries: Number(process.env.OPENAI_MAX_RETRIES) || 3
  },
  discord: {
    enabled: process.env.DISCORD_ENABLED === 'true',
    cleanupInterval: Number(process.env.DISCORD_CLEANUP_INTERVAL) || 24,
    sessionTimeout: Number(process.env.DISCORD_SESSION_TIMEOUT) || 12,
    mcp: {
      enabled: process.env.MCP_ENABLED === 'true',
      authToken: process.env.MCP_AUTH_TOKEN,
      logLevel: (process.env.MCP_LOG_LEVEL || 'info') as 'error' | 'warn' | 'info' | 'debug'
    }
  }
};

export function validateEnvironment(): void {
  // Only validate DATABASE_URL by default
  const required = ['DATABASE_URL'];
  
  // Check for model-specific API keys only if they're being used
  const model = process.env.MODEL || 'gpt';

  if (model === 'gpt') required.push('OPENAI_API_KEY');
  if (model === 'claude') required.push('ANTHROPIC_API_KEY');
  // Ollama runs locally, so we don't require API keys but can optionally set host
  if (model === 'ollama') {
    process.env.OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';  // Explicitly use IPv4
    process.env.OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2.latest';
  }
  
  // Validate Discord and MCP if Discord is enabled
  if (process.env.DISCORD_ENABLED === 'true') {
    required.push('DISCORD_TOKEN');
    
    // Only validate MCP if Discord is enabled and MCP is explicitly enabled
    if (process.env.MCP_ENABLED === 'true') {
      
      // Validate MCP log level if specified
      const validLogLevels = ['error', 'warn', 'info', 'debug'];
      if (process.env.MCP_LOG_LEVEL && !validLogLevels.includes(process.env.MCP_LOG_LEVEL)) {
        throw new Error(`Invalid MCP_LOG_LEVEL. Must be one of: ${validLogLevels.join(', ')}`);
      }
    }
  }
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

export function sanitizeInput(input: string): string {
  return input
    .trim()
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
    .replace(/\u2028|\u2029/g, '\n'); // Replace line separators with newlines
}

export function validateInput(input: string, config: BaseConfig = defaultConfig): string | null {
  const sanitized = sanitizeInput(input);
  
  if (!sanitized) {
    return 'Input cannot be empty';
  }

  if (sanitized.length > config.messageHandling.maxMessageLength) {
    return `Input exceeds maximum length of ${config.messageHandling.maxMessageLength} characters`;
  }

  return null;
}

export function debug(message: string, config: BaseConfig = defaultConfig) {
  if (config.debug) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
  }
}
