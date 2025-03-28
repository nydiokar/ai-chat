import { MCPError } from '../types/errors.js';
import { error as logError } from './logger.js';
import { createErrorContext } from './log-utils.js';

const COMPONENT = 'ErrorHandler';

export function handleError(err: unknown): never {
    if (err instanceof MCPError) {
        // Log MCP-specific errors with their type and context
        logError('MCP operation failed', createErrorContext(
            COMPONENT,
            'handleError',
            'MCP',
            err.type,
            err
        ));
    } else {
        // Log unexpected errors
        logError('Unexpected error occurred', createErrorContext(
            COMPONENT,
            'handleError',
            'System',
            'UNKNOWN',
            err instanceof Error ? err : new Error(String(err))
        ));
    }
    
    // Re-throw the error after logging
    throw err;
} 