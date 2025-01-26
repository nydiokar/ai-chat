// MCP specific errors
export enum ErrorType {
    TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
    TOOL_NOT_ENABLED = 'TOOL_NOT_ENABLED',
    TOOL_EXECUTION_FAILED = 'TOOL_EXECUTION_FAILED',
    MISSING_PARAMETER = 'MISSING_PARAMETER',
    CONNECTION_FAILED = 'CONNECTION_FAILED',
    DATABASE_ERROR = 'DATABASE_ERROR',
    API_ERROR = 'API_ERROR',
    RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
    SERVER_START_FAILED = 'SERVER_START_FAILED',
    INVALID_MODEL = 'INVALID_MODEL',
    SERVER_NOT_FOUND = 'SERVER_NOT_FOUND'
}

export class MCPError extends Error {
    constructor(
        public type: ErrorType,
        message: string,
        public details?: any
    ) {
        super(message);
        this.name = 'MCPError';
    }

    static toolNotFound(toolName: string): MCPError {
        return new MCPError(
            ErrorType.TOOL_NOT_FOUND,
            `Tool not found: ${toolName}`
        );
    }

    static toolExecutionFailed(error: any): MCPError {
        return new MCPError(
            ErrorType.TOOL_EXECUTION_FAILED,
            `Tool execution failed: ${error.message || error}`,
            error
        );
    }

    static missingParameter(toolName: string): MCPError {
        return new MCPError(
            ErrorType.MISSING_PARAMETER,
            `Missing parameter for tool: ${toolName}`
        );
    }

    static invalidModel(model: string): MCPError {
        return new MCPError(
            ErrorType.INVALID_MODEL,
            `Invalid model type: ${model}`
        );
    }

    static rateLimitExceeded(model: string): MCPError {
        return new MCPError(
            ErrorType.RATE_LIMIT_EXCEEDED,
            `Rate limit exceeded for ${model}`
        );
    }

    static apiError(model: string, error: any): MCPError {
        return new MCPError(
            ErrorType.API_ERROR,
            `${model} API error: ${error.message || 'Unknown error'}`,
            error
        );
    }

    static fromDatabaseError(error: Error): MCPError {
        return new MCPError(
            ErrorType.DATABASE_ERROR,
            error.message,
            error instanceof Error ? error : undefined
        );
    }
    static serverNotFound(serverId: string): MCPError {
        return new MCPError(
            ErrorType.SERVER_NOT_FOUND,
            `Server ${serverId} not found`
        );
    }

    static toolNotEnabled(toolName: string, serverId: string): MCPError {
        return new MCPError(
            ErrorType.TOOL_NOT_ENABLED,
            `Tool ${toolName} is not enabled on server ${serverId}`
        );
    }
}
