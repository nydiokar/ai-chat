import { MCPToolResponse } from "./tools.js";

export type MessageRole = "function" | "user" | "assistant" | "system" | "tool" | "developer";

export interface AIMessage {
    role: MessageRole;
    content: string;
    name?: string;
    tool_call_id?: string;
}

export interface AIResponse {
    content: string;
    tokenCount: number | null;
    toolResults: MCPToolResponse[];
}

export interface AIService {
    generateResponse(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse>;
    processMessage(message: string, conversationHistory?: AIMessage[]): Promise<AIResponse>;
    getModel(): string;
    setSystemPrompt(prompt: string): void;
    cleanup(): Promise<void>;
}