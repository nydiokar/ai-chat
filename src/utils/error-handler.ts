import { MCPError } from '../types/errors.js';

export function handleError(error: unknown): never {
    if (error instanceof MCPError) {
        // Log the error with its type
        console.error(`[${error.type}] ${error.message}`);
    } else {
        console.error('Unexpected error:', error);
    }
    throw error;
} 