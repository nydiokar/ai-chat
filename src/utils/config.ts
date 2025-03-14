import { AIModel, Model } from '../types/index.js';

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
  defaultModel: (() => {
    const model = process.env.MODEL || 'gpt';
    console.warn('[Config] Resolved model:', model);
    if (!Object.values(Model).includes(model as AIModel)) {
      console.warn(`[Config] Invalid model ${model}, defaulting to gpt`);
      return 'gpt';
    }
    return model as AIModel;
  })(),
  messageHandling: {
    maxContextMessages: 7,  // Unified limit between OpenAI and Discord
    maxTokens: 4096,
    tokenBuffer: 1000,
    maxMessageLength: 8000
  },
  debug: process.env.DEBUG === 'true',
  logging: {
    level: (process.env.LOG_LEVEL || 'info') as 'error' | 'warn' | 'info' | 'debug',
    showTools: process.env.LOG_SHOW_TOOLS === 'true',
    showRequests: process.env.LOG_SHOW_REQUESTS === 'true'
  },
  maxRetries: 3,
  retryDelay: 1000,
  rateLimitDelay: 1000,
  openai: {
    model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo-0125',
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
      required.push('MCP_AUTH_TOKEN');
      
      // Validate MCP log level if specified
      const validLogLevels = ['error', 'warn', 'info', 'debug'];
      if (process.env.MCP_LOG_LEVEL && !validLogLevels.includes(process.env.MCP_LOG_LEVEL)) {
        throw new Error(`Invalid MCP_LOG_LEVEL. Must be one of: ${validLogLevels.join(', ')}`);
      }

      // Validate MCP server-specific environment variables
      if (process.env.MCP_GITHUB_ENABLED === 'true') {
        required.push('GITHUB_TOKEN');
      }
      if (process.env.MCP_BRAVE_ENABLED === 'true') {
        required.push('BRAVE_API_KEY');
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
