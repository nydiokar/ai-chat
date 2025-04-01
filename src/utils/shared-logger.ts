import logger from './logger.js';
import type { Logger } from 'winston';

// Cache logger instances by component to avoid recreation
const loggerCache = new Map<string, Logger>();

/**
 * Get a logger instance for a specific component.
 * This ensures all logging goes through our main configured logger
 * instead of creating independent logger instances.
 */
export function getLogger(component: string): Logger {
    // Return cached logger if it exists
    if (loggerCache.has(component)) {
        return loggerCache.get(component)!;
    }

    // Create a new logger instance that wraps the main logger
    const componentLogger = Object.assign(Object.create(logger), {
        error: (message: any, ...args: any[]) => 
            logger.error(message, { component, ...(args[0] || {}) }),
        warn: (message: any, ...args: any[]) => 
            logger.warn(message, { component, ...(args[0] || {}) }),
        info: (message: any, ...args: any[]) => 
            logger.info(message, { component, ...(args[0] || {}) }),
        debug: (message: any, ...args: any[]) => 
            logger.debug(message, { component, ...(args[0] || {}) }),
        // Inherit all other methods from the main logger
        log: logger.log.bind(logger),
        levels: logger.levels,
        level: logger.level,
        exitOnError: logger.exitOnError,
        transports: logger.transports,
        silent: logger.silent,
        format: logger.format
    }) as Logger;

    // Cache the logger instance
    loggerCache.set(component, componentLogger);
    return componentLogger;
}

// Export the main logger as default for direct use
export default logger;