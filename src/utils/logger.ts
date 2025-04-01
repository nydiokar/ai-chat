import winston from 'winston';
import path from 'path';
import chalk from 'chalk';

// Define log levels with proper severity ordering
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4
} as const;

type LogLevel = keyof typeof levels;

// Define colors for different log levels and components
const colors: Record<LogLevel, string> = {
  error: 'red',
  warn: 'yellow',
  info: 'cyan',
  debug: 'blue',
  trace: 'gray'
};

const componentColors: Record<string, string> = {
  'OpenAIService': 'magenta',
  'DiscordBot': 'green',
  'Database': 'blue',
  'Cache': 'yellow',
  'default': 'white'
};

winston.addColors(colors);

interface LogEntry {
  level: string;
  message: unknown;
  timestamp?: string;
  component?: string;
  operation?: string;
  context?: Record<string, unknown>;
  error?: {
    message?: string;
    stack?: string;
  };
}

// Simplify common objects for cleaner logging
const simplifyObject = (obj: any): any => {
  if (!obj || typeof obj !== 'object') return obj;
  
  // Handle OpenAI response
  if (obj.choices?.[0]?.message) {
    return {
      content: obj.choices[0].message.content,
      tokens: obj.usage?.total_tokens || 'unknown',
      model: obj.model
    };
  }

  // Handle OpenAI request
  if (obj.model?.includes('gpt-')) {
    return {
      model: obj.model,
      messages: obj.messages?.map((m: any) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {})
      })),
      tools: obj.tools?.map((t: any) => ({
        type: t.type,
        function: {
          name: t.function.name,
          description: t.function.description
        }
      })),
      temperature: obj.temperature
    };
  }

  // Handle database operations
  if (obj.component === 'Database') {
    return obj.message;
  }

  // For AIServiceFactory config, make it one line
  if (obj.message === 'Model Configuration:') {
    return `Model: ${obj.model || 'unknown'}, Env: ${obj.environment || 'unknown'}`;
  }

  // Remove noisy fields
  const cleaned = { ...obj };
  delete cleaned.stack;
  delete cleaned.config;
  delete cleaned.headers;
  delete cleaned.authorization;
  delete cleaned['set-cookie'];
  
  return cleaned;
};

// Filter out noisy debug logs
const filterNoisyLogs = winston.format((info) => {
  // Only filter out HTTP headers and rate limit info
  if (typeof info.message === 'string' && 
     (info.message.includes('x-ratelimit') ||
      info.message.includes('content-type-options'))) {
    return false;
  }
  return info;
});

// Add colors to level
const colorLevel = winston.format((info) => {
  info.colorLevel = (chalk as any)[colors[info.level as LogLevel] || 'white'](info.level.toUpperCase().padEnd(5));
  return info;
});

// Structured log format for console output
const structuredConsoleFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  colorLevel(),
  filterNoisyLogs(),
  winston.format.printf((info: LogEntry & { colorLevel?: string }) => {
    // Format date and time
    const date = info.timestamp ? new Date(info.timestamp) : new Date();
    const timeStr = date.toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });

    // Get component color
    const componentColor = info.component ? 
      componentColors[info.component] || componentColors.default :
      componentColors.default;

    // Format component and operation
    const comp = info.component ? 
      (chalk as any)[componentColor](`[${info.component}]`) : '';
    const op = info.operation ? 
      chalk.dim(`(${info.operation})`) : '';

    // Format message
    let msg = '';
    if (typeof info.message === 'object' && info.message !== null) {
      if ((info.message as any)?.choices?.[0]?.message) {
        // OpenAI response
        const choice = (info.message as any).choices[0];
        const tokens = (info.message as any).usage;
        const tokenInfo = tokens ? 
          `Total: ${chalk.yellow(tokens.total_tokens)} (Prompt: ${chalk.blue(tokens.prompt_tokens)}, Completion: ${chalk.green(tokens.completion_tokens)})` : '';
        
        // Include tool calls if present
        const toolCalls = choice.message.tool_calls || [];
        const toolsUsed = toolCalls.length ? 
          `\n  Tool used: ${chalk.magenta(toolCalls[0].function.name)}` : '';
        
        msg = `Token usage - ${tokenInfo}${toolsUsed}`;
      } else if ((info.message as any)?.model?.includes('gpt-')) {
        // OpenAI request
        const message = info.message as any;
        msg = `Creating completion with ${chalk.yellow(message.tools?.length || 0)} tools`;
      } else {
        // Other objects - keep it simple
        msg = JSON.stringify(info.message)
          .replace(/{"([^"]+)":/g, '$1:')
          .replace(/,"/g, ', ')
          .replace(/"/g, "'");
      }
    } else {
      msg = String(info.message);
    }

    // Add context if present
    const ctx = info.context ? 
      chalk.dim(` ${JSON.stringify(info.context)}`) : '';

    // Add error if present
    const err = info.error ? 
      `\n${chalk.red('Error:')} ${info.error.message}${
        info.error.stack ? `\n${chalk.dim(info.error.stack)}` : ''
      }` : '';

    // Combine all parts
    return `${chalk.dim(timeStr)} ${info.colorLevel} ${comp}${op} ${msg}${ctx}${err}`;
  })
);

// JSON format for file logging (more concise than console)
const structuredFileFormat = winston.format.combine(
  winston.format.timestamp(),
  filterNoisyLogs(),
  winston.format.printf((info: LogEntry) => {
    const simplified = {
      ...info,
      message: simplifyObject(info.message),
      context: simplifyObject(info.context)
    };
    return JSON.stringify(simplified);
  })
);

// Create logs directory based on environment
const env = process.env.NODE_ENV || 'development';
const logDir = path.join(process.cwd(), 'logs', env);

// Configure transports with proper log levels and formatting
const transports = [
  // Console transport - human readable, colored output
    new winston.transports.Console({
      level: 'debug',
    format: structuredConsoleFormat,
    handleExceptions: true,
    handleRejections: true
  }),
  
  // Main log file - all logs except debug
  new winston.transports.File({
    filename: path.join(logDir, 'combined.log'),
    level: 'info',
    format: structuredFileFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5
  }),

  // Error log file - only errors
    new winston.transports.File({ 
    filename: path.join(logDir, 'error.log'),
    level: 'error',
    format: structuredFileFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5
  }),

  // Debug log file - everything including debug
    new winston.transports.File({ 
    filename: path.join(logDir, 'debug.log'),
    level: 'debug',
    format: structuredFileFormat,
    maxsize: 10485760, // 10MB
    maxFiles: 3
  })
];

// Create the logger with proper configuration
const logger = winston.createLogger({
  levels,
  transports,
  exitOnError: false,
  handleExceptions: true,
  handleRejections: true
});

// Type for log context
export interface LogContext {
  component?: string;
  operation?: string;
  [key: string]: unknown;
}

// Helper functions with proper typing
export const trace = (message: unknown, context?: LogContext): void => {
  logger.log('trace', { message, ...context });
};

export const debug = (message: unknown, context?: LogContext): void => {
  logger.debug({ message, ...context });
};

export const info = (message: unknown, context?: LogContext): void => {
  logger.info({ message, ...context });
};

export const warn = (message: unknown, context?: LogContext): void => {
  logger.warn({ message, ...context });
};

export const error = (message: unknown, errorOrContext?: Error | LogContext): void => {
  const context: LogContext = {};
  
  if (errorOrContext instanceof Error) {
    context.error = {
        message: errorOrContext.message,
      stack: errorOrContext.stack,
      name: errorOrContext.name
    };
  } else if (errorOrContext) {
    Object.assign(context, errorOrContext);
  }
  
  logger.error({ message, ...context });
};

export default logger;