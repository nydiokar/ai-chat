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

export const enum ErrorType {
    // System errors
    INVALID_CONFIG = 'INVALID_CONFIG',
    CONNECTION_ERROR = 'CONNECTION_ERROR',
    SETUP_ERROR = 'SETUP_ERROR',
    POLLING_ERROR = 'POLLING_ERROR',
    REFRESH_ERROR = 'REFRESH_ERROR',
    HEALTH_CHECK_ERROR = 'HEALTH_CHECK_ERROR',
    DISCONNECT_ERROR = 'DISCONNECT_ERROR',
    CAPABILITIES_ERROR = 'CAPABILITIES_ERROR',
    INITIALIZATION_FAILED = 'INITIALIZATION_FAILED',
    VALIDATION_FAILED = 'VALIDATION_FAILED',
    
    // MCP errors
    PROTOCOL_ERROR = 'PROTOCOL_ERROR',
    AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
    SERVER_ERROR = 'SERVER_ERROR',
    SERVER_NOT_FOUND = 'SERVER_NOT_FOUND',
    INVALID_STATE = 'INVALID_STATE',
    SERVER_START_FAILED = 'SERVER_START_FAILED',
    SERVER_RELOAD_FAILED = 'SERVER_RELOAD_FAILED',
    MAX_RECONNECT_ATTEMPTS = 'MAX_RECONNECT_ATTEMPTS',
    RECONNECT_ERROR = 'RECONNECT_ERROR',
    RECONNECT_HANDLER_ERROR = 'RECONNECT_HANDLER_ERROR',
    
    // Tool errors
    TOOL_ERROR = 'TOOL_ERROR',
    TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
    TOOL_EXECUTION_ERROR = 'TOOL_EXECUTION_ERROR',
    TOOL_EXECUTION_FAILED = 'TOOL_EXECUTION_FAILED',
    TOOL_TRACKING_ERROR = 'TOOL_TRACKING_ERROR',
    TOOL_TRACKING_FAILED = 'TOOL_TRACKING_FAILED',
    TOOL_REGISTRATION_ERROR = 'TOOL_REGISTRATION_ERROR',
    TOOL_VALIDATION_ERROR = 'TOOL_VALIDATION_ERROR'
}

export class MCPError extends Error {
    constructor(
        public readonly type: ErrorType,
        message: string,
        public readonly cause?: Error
    ) {
        super(message);
        this.name = 'MCPError';
    }

    static serverNotFound(id?: string): MCPError {
        return new MCPError(ErrorType.SERVER_NOT_FOUND, `Server ${id || ''} not found`);
    }

    static serverStartFailed(error: Error): MCPError {
        return new MCPError(ErrorType.SERVER_START_FAILED, `Server start failed: ${error.message}`, error);
    }

    static serverReloadFailed(error: Error): MCPError {
        return new MCPError(ErrorType.SERVER_RELOAD_FAILED, `Server reload failed: ${error.message}`, error);
    }

    static toolNotFound(error?: Error): MCPError {
        return new MCPError(ErrorType.TOOL_NOT_FOUND, error?.message || 'Tool not found', error);
    }

    static toolExecutionFailed(error: Error): MCPError {
        return new MCPError(ErrorType.TOOL_EXECUTION_FAILED, `Tool execution failed: ${error.message}`, error);
    }

    static toolTrackingFailed(error: Error): MCPError {
        return new MCPError(ErrorType.TOOL_TRACKING_FAILED, `Tool tracking failed: ${error.message}`, error);
    }

    static validationFailed(error: Error): MCPError {
        return new MCPError(ErrorType.VALIDATION_FAILED, `Validation failed: ${error.message}`, error);
    }

    static initializationFailed(error: Error): MCPError {
        return new MCPError(ErrorType.INITIALIZATION_FAILED, `Initialization failed: ${error.message}`, error);
    }
} 