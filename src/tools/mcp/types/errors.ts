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