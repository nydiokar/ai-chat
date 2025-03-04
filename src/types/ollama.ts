import { Message } from './index.js';

export interface OllamaMessage {
    role: string;
    content: string;
    tool_calls?: OllamaToolCall[];
}

// specific for ollama tools function
export interface OllamaTool {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, any>;
        required?: string[];
    };
}

export interface OllamaToolCall {
    id?: string;
    function: {
        name: string;
        arguments: Record<string, any>;
    };
}

export interface OllamaToolDefinition {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: "object";
            properties: Record<string, any>;
            required?: string[];
        };
    };
}

export interface OllamaResponse {
    model: string;
    created_at: Date;
    message: {
        role: string;
        content: string;
        tool_calls?: OllamaToolCall[];
    };
    done: boolean;
    done_reason?: string;
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
}

export interface OllamaChatRequest {
    model: string;
    messages: OllamaMessage[];
    stream?: boolean;
    options?: {
        temperature?: number;
    };
    tools?: OllamaToolDefinition[];
}

export interface OllamaToolResult {
    content: string;
    error?: string;
} 