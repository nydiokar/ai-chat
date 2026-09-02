export enum Role {
  user = "user",
  assistant = "assistant",
  system = "system",
  function = "function",
  tool = "tool",
  developer = "developer",
}

export const Model = {
  gpt: "gpt",
  claude: "claude",
  ollama: "ollama",
} as const;

export type AIModel = (typeof Model)[keyof typeof Model];
export type MessageRole = keyof typeof Role;

export interface Message {
  id: number;
  content: string;
  role: MessageRole;
  createdAt: Date;
  conversationId: number;
  tokenCount?: number | null; // Allow null for Prisma compatibility
  discordUserId?: string | null;
  discordUsername?: string | null;
  name?: string; // For function messages
  tool_call_id?: string; // For tool messages
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
