import winston from 'winston';
import { format } from 'winston';
const { combine, timestamp, printf, colorize } = format;

// Color scheme for different log levels
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
  tool: 'magenta'
};

// Add colors to winston
winston.addColors(colors);

// Custom format for OpenAI debug logs to make them more concise
const openAIFormat = format((info: winston.Logform.TransformableInfo): winston.Logform.TransformableInfo => {
  const message = info.message as string;
  if (typeof message === 'string' && message.includes('OpenAI:DEBUG')) {
    // Extract only essential information from OpenAI debug logs
    if (message.includes('request')) {
      const modelMatch = message.match(/model: '([^']+)'/);
      const model = modelMatch ? modelMatch[1] : 'unknown';
      
      // Try to extract tool calls if present
      const toolChoice = message.includes('tool_choice: \'auto\'') ? ' (auto)' : '';
      
      info.message = `🤖 Request → ${model}${toolChoice}`;
    } else if (message.includes('response')) {
      // Only show status code and important response data
      const statusMatch = message.match(/response (\d+)/);
      const status = statusMatch ? statusMatch[1] : 'unknown';
      
      // Try to extract finish_reason if present
      const finishMatch = message.match(/"finish_reason":\s*"([^"]+)"/);
      const finish = finishMatch ? finishMatch[1] : '';
      
      // Extract token usage if present
      const tokensMatch = message.match(/"total_tokens":\s*(\d+)/);
      const tokens = tokensMatch ? ` [${tokensMatch[1]} tokens]` : '';
      
      info.message = `🤖 Response ← ${status}${finish ? ` (${finish})` : ''}${tokens}`;
    } else {
      // Skip other OpenAI debug messages
      info.level = 'silent';
    }
  } else if (info.component === 'OpenAI') {
    // Format our custom OpenAI logs
    const { event, ...details } = info;
    switch (event) {
      case 'tool_execution':
        info.message = `🔧 Executing ${details.tool}`;
        break;
      case 'tool_result':
        info.message = `🔧 ${details.tool}: ${details.success ? '✓' : '✗'} ${
          details.success ? JSON.stringify(details.data) : details.error
        }`;
        break;
      case 'tool_error':
        info.message = `🔧 Error in ${details.tool}: ${details.error}`;
        break;
      case 'tool_result_formatted':
        info.message = `🔧 Result: ${details.result}`;
        break;
    }
  }
  return info;
});

// Custom format for initialization and config logs
const initFormat = format((info: winston.Logform.TransformableInfo): winston.Logform.TransformableInfo => {
  const message = info.message as string;
  if (typeof message === 'string') {
    // Skip detailed environment and config logs during initialization
    if (message.includes('[MCP Config]') && !message.includes('initialization complete')) {
      info.level = 'silent';
    }
    // Make initialization logs more concise
    if (message.includes('Starting bot instance:')) {
      info.message = '\n=== Starting Discord Bot ===\n';
    }
    // Clean up database connection logs
    if (message.includes('Initializing PrismaClient')) {
      info.message = '🔌 Connecting to database...';
    }
    if (message.includes('Connected to database')) {
      info.message = '✓ Database connected';
    }
    // Clean up MCP container logs
    if (message.startsWith('MCPContainer:')) {
      info.level = 'silent';
    }
    // Format tool loading logs
    if (message.includes('Successfully loaded') && message.includes('tools')) {
      const [server, count] = message.match(/\[(.*?)\].*?(\d+)/)?.slice(1) || [];
      info.message = `✓ ${server}: ${count} tools loaded`;
      info.level = 'info';
    }
  }
  return info;
});

// Custom format for pretty printing objects
const prettyPrint = format((info: winston.Logform.TransformableInfo): winston.Logform.TransformableInfo => {
  if (typeof info.message === 'object' && info.message !== null) {
    try {
      // Only stringify top-level properties to keep it concise
      const simplified = Object.keys(info.message).reduce((acc: any, key) => {
        const value = (info.message as any)[key];
        acc[key] = typeof value === 'object' ? '[Object]' : value;
        return acc;
      }, {});
      info.message = JSON.stringify(simplified);
    } catch (e) {
      info.message = '[Circular]';
    }
  }
  return info;
});

// Create different formats for different environments
const developmentFormat = combine(
  timestamp({ format: 'HH:mm:ss' }), // Simplified timestamp
  initFormat(),
  openAIFormat(),
  prettyPrint(),
  colorize({ all: true }),
  printf((info) => {
    const { level, message, timestamp } = info;
    // Skip silent messages
    if (level === 'silent') return '';
    
    // Special formatting for tool executions
    if (level === 'tool') {
      return `\n${message}\n`;
    }
    
    const separator = '┃';
    const levelPad = level.padEnd(7);
    const prefix = `${timestamp} ${separator} ${levelPad} ${separator}`;
    
    // Add newlines for certain types of messages
    if (typeof message === 'string' && (
      message.includes('===') || 
      message.startsWith('✓') ||
      message.startsWith('🔌') ||
      message.startsWith('🤖')
    )) {
      return `\n${prefix} ${message}\n`;
    }
    
    return `${prefix} ${message}`;
  })
);

const productionFormat = combine(
  timestamp(),
  openAIFormat(),
  prettyPrint(),
  printf((info) => {
    const { level, message, timestamp } = info;
    return JSON.stringify({ timestamp, level, message });
  })
);

// Create the logger
const logger = winston.createLogger({
  level: 'debug',
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    tool: 4
  },
  format: process.env.NODE_ENV === 'production' ? productionFormat : developmentFormat,
  transports: [
    new winston.transports.Console({
      level: 'debug',
      handleExceptions: true
    }),
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error'
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log'
    })
  ]
});

// Convenience methods with proper typing
export const debug = (message: string | object) => logger.debug(message);
export const info = (message: string | object) => logger.info(message);
export const warn = (message: string | object) => logger.warn(message);
export const error = (message: string | object, err?: Error) => {
  if (err) {
    logger.error({ message, error: { message: err.message } }); // Removed stack trace for conciseness
  } else {
    logger.error(message);
  }
};

export default logger;