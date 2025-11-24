import { AIModel, MessageRole } from "./base.js";

export interface BaseConfig {
  maxContextMessages: number;
  maxMessageLength: number;
  debug: boolean;
  maxRetries: number;
  retryDelay: number;
  timeout: number;
  rateLimit: number;
}

export interface MessageContext {
  userId: string;
  username?: string;
  guildId?: string;
  channelId?: string;
  messageId?: string;
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
