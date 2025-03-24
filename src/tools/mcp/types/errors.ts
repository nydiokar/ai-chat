import { v4 as uuidv4 } from 'uuid';

/**
 * Structured error record for MCP-related errors
 */
export interface MCPErrorRecord {
    /** Unique identifier for the error instance */
    id: string;
    /** When the error occurred */
    timestamp: Date;
    /** Human-readable error message */
    message: string;
    /** Component/module that generated the error */
    source: string;
    /** Associated server ID if applicable */
    serverId?: string;
    /** Additional error details or context */
    details?: any;
    /** Error stack trace if available */
    stack?: string;
}

/**
 * Statistics about a particular error type
 */
export interface ErrorStats {
    /** How many times this error has occurred */
    count: number;
    /** When this error was first seen */
    firstSeen: Date;
    /** When this error was most recently seen */
    lastSeen: Date;
    /** Set of sources that have reported this error */
    sources: Set<string>;
}

/**
 * Create a new structured MCP error record
 */
export function createMCPErrorRecord(
    message: string,
    serverId?: string,
    error?: Error | unknown
): MCPErrorRecord {
    return {
        id: uuidv4(),
        timestamp: new Date(),
        message,
        source: error instanceof Error ? error.name : 'Unknown',
        serverId,
        details: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
    };
}

export enum ErrorType {
    SERVER_NOT_FOUND = 'SERVER_NOT_FOUND',
    SERVER_START_FAILED = 'SERVER_START_FAILED',
    SERVER_RELOAD_FAILED = 'SERVER_RELOAD_FAILED',
    TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
    TOOL_EXECUTION_FAILED = 'TOOL_EXECUTION_FAILED',
    TOOL_TRACKING_FAILED = 'TOOL_TRACKING_FAILED',
    VALIDATION_FAILED = 'VALIDATION_FAILED',
    INITIALIZATION_FAILED = 'INITIALIZATION_FAILED'
}

interface ErrorOptions {
    cause?: Error;
}

export class MCPError extends Error {
    public readonly cause?: Error;

    constructor(
        message: string,
        public readonly type: ErrorType = ErrorType.INITIALIZATION_FAILED,
        options?: ErrorOptions
    ) {
        super(message);
        this.cause = options?.cause;
        this.name = 'MCPError';
    }

    static serverNotFound(error?: Error): MCPError {
        return new MCPError(
            error?.message || 'Server not found',
            ErrorType.SERVER_NOT_FOUND,
            { cause: error }
        );
    }

    static serverStartFailed(error: Error): MCPError {
        return new MCPError(
            `Server start failed: ${error.message}`,
            ErrorType.SERVER_START_FAILED,
            { cause: error }
        );
    }

    static serverReloadFailed(error: Error): MCPError {
        return new MCPError(
            `Server reload failed: ${error.message}`,
            ErrorType.SERVER_RELOAD_FAILED,
            { cause: error }
        );
    }

    static toolNotFound(error?: Error): MCPError {
        return new MCPError(
            error?.message || 'Tool not found',
            ErrorType.TOOL_NOT_FOUND,
            { cause: error }
        );
    }

    static toolExecutionFailed(error: Error): MCPError {
        return new MCPError(
            `Tool execution failed: ${error.message}`,
            ErrorType.TOOL_EXECUTION_FAILED,
            { cause: error }
        );
    }

    static toolTrackingFailed(error: Error): MCPError {
        return new MCPError(
            `Tool tracking failed: ${error.message}`,
            ErrorType.TOOL_TRACKING_FAILED,
            { cause: error }
        );
    }

    static validationFailed(error: Error): MCPError {
        return new MCPError(
            `Validation failed: ${error.message}`,
            ErrorType.VALIDATION_FAILED,
            { cause: error }
        );
    }

    static initializationFailed(error: Error): MCPError {
        return new MCPError(
            `Initialization failed: ${error.message}`,
            ErrorType.INITIALIZATION_FAILED,
            { cause: error }
        );
    }
} 