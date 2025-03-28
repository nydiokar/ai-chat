import { redactSensitiveInfo } from './security.js';

export interface LogContext {
  component: string;    // Service/class name
  operation: string;    // Method/function name
  serverId?: string;    // For server operations
  requestId?: string;   // For request tracing
  instanceId?: string;  // For multi-instance deployments
  intervalMs?: number;  // For interval tasks
  timeoutMs?: number;   // For timeout configurations
  envPath?: string;     // Path to environment file
  environment?: string; // Environment (dev/prod)
  
  // OpenAI specific properties
  model?: string;       // OpenAI model being used
  temperature?: number; // Model temperature
  maxRetries?: number; // API retry configuration
  messageLength?: number; // Length of input message
  historyLength?: number; // Length of conversation history
  responseLength?: number; // Length of generated response
  tokenCount?: number;    // Total tokens used
  cached?: boolean;      // Whether response was cached
  tool?: string;         // Tool being executed
  success?: boolean;     // Tool execution success
  successfulTools?: number; // Number of successful tool executions

  // Config specific properties
  provider?: string;     // AI provider name
  defaultProvider?: string; // Default AI provider
  defaultModel?: string;  // Default model for provider
  host?: string;         // Host configuration
  logLevel?: string;     // Logging level
  missing?: string[];    // Missing configuration items
  features?: Record<string, boolean>; // Feature flags
  inputLength?: number;  // Length of input
  maxLength?: number;    // Maximum allowed length
  sanitized?: boolean;   // Whether input was sanitized

  // MCP-specific properties
  healthCheckInterval?: number;
  toolsRefreshInterval?: number;
  maxReconnectAttempts?: number;
  previousCount?: number;
  currentCount?: number;
  timeSinceLastCheck?: number;
  previousAttempts?: number;
  reconnectAttempts?: number;
  attempt?: number;
  backoffDelay?: number;
  params?: string;
  responseTime?: number;
  avgResponseTime?: number;
  successRate?: number;
 
  key?: string;

  previousRequests?: number;
  previousErrors?: number;

  // Server Manager specific properties
  idleTimeout?: number;
  maxHistorySize?: number;
  maxSize?: number;
  clientId?: string;
  clientCount?: number;
  idleTime?: number;
  timeout?: number;
  uptime?: number;
  restartCount?: number;
  eventCount?: number;
  clearedServers?: boolean;
  healthCheckStopped?: boolean;
  state?: string;
  error?: Error | unknown;  // Changed to support both string and Error objects
  currentState?: string;    // Added for state tracking
  expectedState?: string;   // Added for state validation

  // Tool Handler specific properties
  maxErrorHistory?: number;
  refreshInterval?: number;
  cacheKey?: string;
  cacheSize?: number;
  historySize?: number;
  maxErrors?: number;
  usageCount?: number;
  avgExecutionTime?: number;
  toolName?: string;
  toolCount?: number;
  errorCount?: number;
  age?: number;
  ttl?: number;
  args?: string;
  duration?: number;

  // MCP Client specific properties
  shouldReconnect?: boolean;
  maxAttempts?: number;
  attempts?: number;

  // Enhanced logging properties
  status?: string;
  result?: string;
  final?: boolean;
  hasTools?: boolean;
  hasResources?: boolean;
  hasEvents?: boolean;
  connectionRestored?: boolean;
  event?: string;
  action?: string;
  serverCount?: number;
  cacheStatus?: string;

  // Additional Server Manager metrics
  delta?: number;
  activeServers?: number;
  errors?: string[];
  removedEvents?: number;
  currentSize?: number;
  eventType?: string;
  metricsUpdated?: boolean;
  clearedClients?: boolean;

  // New properties
  errorCategory?: 'System' | 'MCP';
  errorType?: string;
  clearedHistory?: boolean;
  name?: string;
  hasParams?: boolean;
  queryLength?: number;
  capabilities?: Record<string, unknown>;

  // Tool execution context
  toolCallId?: string;
  resultSummary?: string;

  // Performance metrics
  totalTokens?: number;

  // Other context
  [key: string]: any;
}

export interface ErrorLogContext extends Omit<LogContext, 'error'> {
  errorCategory: 'MCP' | 'System';  // Simplified categories
  errorType: string;                // Maps to MCPError.type for MCP errors
  error: Error | unknown;           // The actual error object
}

export type ErrorSource = 'System' | 'MCP' | 'Tool' | 'API';

/**
 * Creates a standardized context object for logging
 */
export const createLogContext = (
  component: string,
  operation: string,
  extra: Partial<LogContext> = {}
): LogContext => ({
  component,
  operation,
  ...extra
});

/**
 * Creates a standardized error context object for logging
 */
export const createErrorContext = (
  component: string,
  operation: string,
  errorCategory: ErrorLogContext['errorCategory'],
  errorType: string,
  error: Error | unknown,
  extra: Partial<Omit<LogContext, 'component' | 'operation'>> = {}
): ErrorLogContext => ({
  component,
  operation,
  errorCategory,
  errorType,
  error,
  ...extra
});

/**
 * Formats an error for logging, including relevant context
 */
export const formatError = (error: Error | unknown, context?: Partial<LogContext>) => {
  const errorObj = error instanceof Error ? error : new Error(String(error));
  
  return redactSensitiveInfo({
    message: errorObj.message,
    name: errorObj.name,
    stack: process.env.NODE_ENV === 'development' ? errorObj.stack : undefined,
    ...context
  });
};

/**
 * Timing decorator for measuring operation duration
 */
export function logTiming(component: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const start = performance.now();
      try {
        const result = await originalMethod.apply(this, args);
        const duration = performance.now() - start;
        
        // We'll integrate this with the logger in the next step
        return result;
      } catch (error) {
        const duration = performance.now() - start;
        throw error;
      }
    };

    return descriptor;
  };
} 