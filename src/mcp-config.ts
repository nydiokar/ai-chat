// Base configuration interface
export interface BaseConfig {
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

export interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  timeout?: number;  // Startup timeout in milliseconds
  retries?: number;  // Number of connection retries
}

export interface MCPToolConfig {
  allowedUsers?: string[];  // Discord user IDs that can use this tool
  rateLimit?: {
    requests: number;
    windowMs: number;
  };
}

export interface MCPConfig {
  enabled: boolean;
  servers: Record<string, MCPServerConfig>;
  tools?: Record<string, MCPToolConfig>;
  maxConcurrentServers?: number;
  serverStartupTimeout?: number;  // Global default timeout
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
}

export const defaultMCPConfig: MCPConfig = {
  enabled: process.env.MCP_ENABLED === 'true',
  maxConcurrentServers: 5,
  serverStartupTimeout: 30000,  // 30 seconds
  logLevel: (process.env.MCP_LOG_LEVEL as MCPConfig['logLevel']) || 'info',
  servers: {
    local: {
      command: 'mcp-server',
      args: ['--config', './mcp-config.json'],
      timeout: 10000,  // 10 seconds
      retries: 3,
      env: {
        MCP_AUTH_TOKEN: process.env.MCP_AUTH_TOKEN || '',
      },
    },
    npm: {
      command: 'npx',
      args: ['mcp-server', 'start'],
      timeout: 15000,  // 15 seconds
      retries: 2,
      env: {
        MCP_AUTH_TOKEN: process.env.MCP_AUTH_TOKEN || '',
      },
    },
  },
  tools: {
    // Default tool configurations
    default: {
      rateLimit: {
        requests: 100,
        windowMs: 60000,  // 1 minute
      },
    },
  },
};