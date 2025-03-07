// Base interfaces to match our system types
interface BaseMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
}

interface BaseTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: Record<string, any>;
            required: string[];
        };
    };
}

// Ollama-specific types
export interface OllamaMessage extends BaseMessage {
    images?: string[];
    tool_calls?: Array<{
        function: {
            name: string;
            arguments: Record<string, any>;  // Always an object, never a string
        };
    }>;
}

export interface OllamaResponse {
    model: string;
    created_at: string;  // Keep as string to match Ollama's format
    message: OllamaMessage;
    done: boolean;
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
}

export interface OllamaToolCall {
    function: {
        name: string;
        arguments: Record<string, any>;  // Always an object
    };
}

export interface OllamaChatRequest {
    model: string;
    messages: OllamaMessage[];
    format?: string;
    options?: Record<string, any>;
    template?: string;
    context?: number[];
    stream?: boolean;
    tools?: OllamaToolDefinition[];
}

export interface OllamaToolDefinition extends BaseTool {
    function: {
        name: string;
        description: string;  // Required
        parameters: {
            type: string;
            properties: Record<string, any>;
            required: string[];  // Always present
        };
    };
}

export type OllamaRole = 'system' | 'user' | 'assistant' | 'tool';

export interface OllamaCompletionChoice {
    message: OllamaMessage;
    finish_reason: string;
}
