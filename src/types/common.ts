import { ToolResponse } from "../tools/mcp/types/tools.js";

/**
 * Role of a message in a conversation
 */
export type MessageRole = "function" | "user" | "assistant" | "system" | "tool" | "developer";

/**
 * An input message in a conversation with the LLM
 */
export interface Input {
    role: MessageRole;
    content: string;
    name?: string;
    tool_call_id?: string;
}

/**
 * A response from an LLM or Agent
 */
export interface Response {
    content: string;
    tokenCount: number | null;
    toolResults: ToolResponse[];
} 