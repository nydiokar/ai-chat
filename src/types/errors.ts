// MCP specific errors
export enum ErrorType {
    TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
    TOOL_NOT_ENABLED = 'TOOL_NOT_ENABLED',
    TOOL_EXECUTION_FAILED = 'TOOL_EXECUTION_FAILED',
    TOOL_CONTEXT_REFRESH_FAILED = 'TOOL_CONTEXT_REFRESH_FAILED',
    MISSING_PARAMETER = 'MISSING_PARAMETER',
    CONNECTION_FAILED = 'CONNECTION_FAILED',
    DATABASE_ERROR = 'DATABASE_ERROR',
    API_ERROR = 'API_ERROR',
    RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
    SERVER_START_FAILED = 'SERVER_START_FAILED',
    SERVER_RELOAD_FAILED = 'SERVER_RELOAD_FAILED',
    INVALID_MODEL = 'INVALID_MODEL',
    SERVER_NOT_FOUND = 'SERVER_NOT_FOUND',
    INITIALIZATION_ERROR = 'INITIALIZATION_ERROR',
    TOOL_ERROR = 'TOOL_ERROR',
    VALIDATION_ERROR = 'VALIDATION_ERROR',
    QUERY_ERROR = 'QUERY_ERROR',
    UNKNOWN_ERROR = 'UNKNOWN_ERROR',
    CACHE_ERROR = 'CACHE_ERROR',
    PROCESSING_ERROR = 'PROCESSING_ERROR',
    INVALID_INPUT = 'INVALID_INPUT'
}

export class MCPError extends Error {
    constructor(
        message: string,
        public type: ErrorType = ErrorType.UNKNOWN_ERROR,
        public options?: { cause?: Error }
    ) {
        super(message);
        this.name = 'MCPError';
    }

    static toolNotFound(toolName: string): MCPError {
        return new MCPError(
            `Tool not found: ${toolName}`,
            ErrorType.TOOL_NOT_FOUND
        );
    }

    static toolExecutionFailed(error: Error): MCPError {
        return new MCPError(
            error.message || 'Tool execution failed',
            ErrorType.TOOL_ERROR,
            { cause: error }
        );
    }

    static missingParameter(toolName: string): MCPError {
        return new MCPError(
            `Missing parameter for tool: ${toolName}`,
            ErrorType.MISSING_PARAMETER
        );
    }

    static invalidModel(model: string): MCPError {
        return new MCPError(
            `Invalid model type: ${model}`,
            ErrorType.INVALID_MODEL
        );
    }

    static rateLimitExceeded(model: string): MCPError {
        return new MCPError(
            `Rate limit exceeded for ${model}`,
            ErrorType.RATE_LIMIT_EXCEEDED
        );
    }

    static apiError(model: string, error: any): MCPError {
        return new MCPError(
            `${model} API error: ${error.message || 'Unknown error'}`,
            ErrorType.API_ERROR,
            { cause: error }
        );
    }

    static fromDatabaseError(error: Error): MCPError {
        return new MCPError(
            error.message,
            ErrorType.DATABASE_ERROR,
            { cause: error }
        );
    }

    static serverNotFound(serverId: string): MCPError {
        return new MCPError(
            `Server ${serverId} not found`,
            ErrorType.SERVER_NOT_FOUND
        );
    }

    static toolNotEnabled(toolName: string, serverId: string): MCPError {
        return new MCPError(
            `Tool ${toolName} is not enabled on server ${serverId}`,
            ErrorType.TOOL_NOT_ENABLED
        );
    }

    static initializationFailed(error: Error): MCPError {
        return new MCPError(
            'Failed to initialize tools',
            ErrorType.INITIALIZATION_ERROR,
            { cause: error }
        );
    }

    static validationFailed(error: Error): MCPError {
        return new MCPError(
            error.message || 'Validation failed',
            ErrorType.VALIDATION_ERROR,
            { cause: error }
        );
    }

    static queryError(message: string): MCPError {
        return new MCPError(message, ErrorType.QUERY_ERROR);
    }
}
