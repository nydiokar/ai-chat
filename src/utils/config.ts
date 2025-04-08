import { AIModel } from '../types/index.js';
import { info, warn, error } from './logger.js';
import { createLogContext, createErrorContext } from './log-utils.js';

const COMPONENT = 'ConfigService';

// Define AI providers and their models
export const AIProviders = {
  OPENAI: 'openai',
  ANTHROPIC: 'claude',
  OLLAMA: 'ollama'
} as const;

// Cache for AI provider selection
let cachedProvider: AIModel | null = null;

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
  // Return cached provider if available
  if (cachedProvider) {
    return cachedProvider;
  }

  const provider = process.env.MODEL || AIProviders.OPENAI;
  
  if (!Object.values(AIProviders).includes(provider as any)) {
    warn('Invalid AI provider specified', createLogContext(
      COMPONENT,
      'getAIProvider',
      {
        provider,
        defaultProvider: AIProviders.OPENAI
      }
    ));
    cachedProvider = AIProviders.OPENAI as AIModel;
    return cachedProvider;
  }
  
  info('AI provider selected', createLogContext(
    COMPONENT,
    'getAIProvider',
    { provider }
  ));
  
  cachedProvider = provider as AIModel;
  return cachedProvider;
}

function getOpenAIModel(currentProvider: AIModel): string {
  // Only configure OpenAI model if we're using OpenAI
  if (currentProvider !== AIProviders.OPENAI) {
    info('Non-OpenAI provider, using default model', createLogContext(
      COMPONENT,
      'getOpenAIModel',
      {
        provider: currentProvider,
        defaultModel: modelConfig.development.default
      }
    ));
    return modelConfig.development.default;
  }

  const env = process.env.NODE_ENV || 'development';
  const envConfig = modelConfig[env as keyof typeof modelConfig];
  const configuredModel = process.env.OPENAI_MODEL;

  // If valid model specified in env, use it
  if (configuredModel && envConfig.options.includes(configuredModel as any)) {
    info('Using configured OpenAI model', createLogContext(
      COMPONENT,
      'getOpenAIModel',
      {
        model: configuredModel,
        environment: env
      }
    ));
    return configuredModel;
  }

  // Otherwise use default for environment
  info('Using default OpenAI model for environment', createLogContext(
    COMPONENT,
    'getOpenAIModel',
    {
      model: envConfig.default,
      environment: env
    }
  ));
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
    timeout?: number;  // Timeout in milliseconds for API requests
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
    maxRetries: Number(process.env.OPENAI_MAX_RETRIES) || 3,
    timeout: Number(process.env.OPENAI_TIMEOUT) || 60000  // Default 60s timeout
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
  const context = createLogContext(COMPONENT, 'validateEnvironment');
  
  // Only validate DATABASE_URL by default
  const required = ['DATABASE_URL'];
  
  // Check for model-specific API keys only if they're being used
  const model = process.env.MODEL || 'openai';

  if (model === 'openai') required.push('OPENAI_API_KEY');
  if (model === 'claude') required.push('ANTHROPIC_API_KEY');
  // Ollama runs locally, so we don't require API keys but can optionally set host
  if (model === 'ollama') {
    process.env.OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';  // Explicitly use IPv4
    process.env.OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2.latest';
    info('Configured Ollama settings', createLogContext(
      COMPONENT,
      'validateEnvironment',
      {
        host: process.env.OLLAMA_HOST,
        model: process.env.OLLAMA_MODEL
      }
    ));
  }
  
  // Validate Discord and MCP if Discord is enabled
  if (process.env.DISCORD_ENABLED === 'true') {
    required.push('DISCORD_TOKEN');
    
    // Only validate MCP if Discord is enabled and MCP is explicitly enabled
    if (process.env.MCP_ENABLED === 'true') {
      info('MCP enabled for Discord', createLogContext(
        COMPONENT,
        'validateEnvironment',
        {
          logLevel: process.env.MCP_LOG_LEVEL || 'info'
        }
      ));
      
      // Validate MCP log level if specified
      const validLogLevels = ['error', 'warn', 'info', 'debug'];
      if (process.env.MCP_LOG_LEVEL && !validLogLevels.includes(process.env.MCP_LOG_LEVEL)) {
        error('Invalid MCP log level', createErrorContext(
          COMPONENT,
          'validateEnvironment',
          'System',
          'CONFIG_ERROR',
          new Error(`Invalid MCP_LOG_LEVEL. Must be one of: ${validLogLevels.join(', ')}`),
          { logLevel: process.env.MCP_LOG_LEVEL }
        ));
        throw new Error(`Invalid MCP_LOG_LEVEL. Must be one of: ${validLogLevels.join(', ')}`);
      }
    }
  }
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    error('Missing required environment variables', createErrorContext(
      COMPONENT,
      'validateEnvironment',
      'System',
      'CONFIG_ERROR',
      new Error(`Missing required environment variables: ${missing.join(', ')}`),
      { missing }
    ));
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  info('Environment validation successful', createLogContext(
    COMPONENT,
    'validateEnvironment',
    {
      model,
      environment: process.env.NODE_ENV || 'development',
      features: {
        discord: process.env.DISCORD_ENABLED === 'true',
        mcp: process.env.MCP_ENABLED === 'true'
      }
    }
  ));
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
    warn('Empty input received', createLogContext(
      COMPONENT,
      'validateInput',
      { inputLength: input.length }
    ));
    return 'Input cannot be empty';
  }

  if (sanitized.length > config.messageHandling.maxMessageLength) {
    warn('Input exceeds maximum length', createLogContext(
      COMPONENT,
      'validateInput',
      {
        inputLength: sanitized.length,
        maxLength: config.messageHandling.maxMessageLength
      }
    ));
    return `Input exceeds maximum length of ${config.messageHandling.maxMessageLength} characters`;
  }

  info('Input validation successful', createLogContext(
    COMPONENT,
    'validateInput',
    {
      inputLength: sanitized.length,
      sanitized: sanitized !== input
    }
  ));

  return null;
}
