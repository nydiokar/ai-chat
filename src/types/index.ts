export enum Role {
  user = 'user',
  assistant = 'assistant',
  system = 'system'
}

export enum Model {
  gpt = 'gpt',
  claude = 'claude'
}

export type MessageRole = keyof typeof Role;
export type AIModel = keyof typeof Model;

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
  guildId: string;
  channelId: string;
  userId: string;
  username: string;
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
