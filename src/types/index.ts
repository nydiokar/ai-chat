import { MCPServerConfig, ToolUsage, ToolUsageHistory } from "./tools.js";

export enum Role {
  user = 'user',
  assistant = 'assistant',
  system = 'system'
}

export enum Model {
  gpt = 'gpt',
  claude = 'claude',
  deepseek = 'deepseek',
  ollama = 'ollama'
}

export type MessageRole = keyof typeof Role;
export type AIModel = keyof typeof Model;

export interface MCPToolContext {
    lastRefreshed: Date;
    refreshCount: number;
    history: ToolUsageHistory[];
    patterns?: Record<string, {
        mostCommon: unknown[];
        uniqueValues: number;
    }>;
    currentArgs?: Record<string, unknown>;
    successRate?: number;
}

export { ToolUsage, ToolUsageHistory };

export interface Message {
  id: number;
  content: string;
  role: MessageRole;
  createdAt: Date;
  conversationId: number;
  tokenCount?: number | null;  // Allow null for Prisma compatibility
  discordUserId?: string | null;
  discordUsername?: string | null;
}

export interface Conversation {
  id: number;
  model: AIModel;
  title?: string;
  summary?: string;
  createdAt: Date;
  updatedAt: Date;
  tokenCount: number;
  discordGuildId?: string;
  discordChannelId?: string;
  messages: Message[];
  session?: Session;
}

export interface Session {
  id: number;
  conversationId: number;
  conversation: Conversation;
  discordUserId: string;
  createdAt: Date;
  lastActivity: Date;
  isActive: boolean;
}

export interface DiscordMessageContext {
  userId: string;
  username: string;
  guildId?: string;
  channelId?: string;  // Make channelId optional
}

export interface ConversationStats {
  totalConversations: number;
  totalMessages: number;
  modelDistribution: {
    model: AIModel;
    _count: number;
  }[];
  roleDistribution: {
    role: MessageRole;
    _count: number;
  }[];
}

export interface ExportedConversation {
  id: number;
  model: AIModel;
  createdAt: Date;
  messages: {
    role: MessageRole;
    content: string;
    createdAt: Date;
  }[];
}

export interface ImportConversation {
  model: AIModel;
  title?: string;
  summary?: string;
  messages: {
    role: MessageRole;
    content: string;
    tokenCount?: number;
  }[];
}

export interface MCPTool {
  name: string;
  description: string;
  server: MCPServerConfig;  // From mcp-config.ts
  inputSchema: any;
}

export interface ToolCallResult {
  content: Array<{ text: string }>;
}

export * from './task.js';
export * from './errors.js';

// Base configuration interface
export interface BaseConfig {
  maxContextMessages: number;
  maxMessageLength: number;
  debug: boolean;
  maxRetries: number;
  retryDelay: number;
  timeout: number;
  rateLimit: number;
}

export type MessageContext = DiscordMessageContext | CLIMessageContext;

export interface CLIMessageContext {
    channelId: string;
    userId: string;
    messageId: string;
    guildId?: string;
}
