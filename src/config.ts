export interface Config {
  maxContextMessages: number;
  maxMessageLength: number;
  debug: boolean;
  maxRetries: number;
  retryDelay: number;
  rateLimitDelay: number;
  discord: {
    enabled: boolean;
    cleanupInterval: number;  // Hours before inactive sessions are cleaned up
    sessionTimeout: number;   // Hours before a session is considered inactive
  };
}

export const defaultConfig: Config = {
  maxContextMessages: 10,
  maxMessageLength: 4000,
  debug: process.env.DEBUG === 'true',
  maxRetries: 3,
  retryDelay: 1000,
  rateLimitDelay: 100,
  discord: {
    enabled: process.env.DISCORD_ENABLED === 'true',
    cleanupInterval: 24,     // Clean up sessions every 24 hours
    sessionTimeout: 1,       // Sessions inactive for 1 hour are closed
  },
};

export function sanitizeInput(input: string): string {
  return input
    .trim()
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
    .replace(/\u2028|\u2029/g, '\n'); // Replace line separators with newlines
}

export function validateInput(input: string, config: Config = defaultConfig): string | null {
  const sanitized = sanitizeInput(input);
  
  if (!sanitized) {
    return 'Input cannot be empty';
  }

  if (sanitized.length > config.maxMessageLength) {
    return `Input exceeds maximum length of ${config.maxMessageLength} characters`;
  }

  return null;
}

export function debug(message: string, config: Config = defaultConfig) {
  if (config.debug) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
  }
}

export function validateEnvironment(): void {
  const required = [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'DATABASE_URL'
  ];

  if (process.env.DISCORD_ENABLED === 'true') {
    required.push('DISCORD_TOKEN');
  }

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
