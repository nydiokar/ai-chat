import { AIModel } from '../index.js';

// Domain types for cached entities
export interface CachedMessage {
    content: string;
    role: string;
    createdAt: Date;
    id: number;
    conversationId: number;
    tokenCount: number | null;
    discordUserId: string | null;
    discordUsername: string | null;
    discordChannelId: string | null;
    discordGuildId: string | null;
    contextId: string | null;
    parentMessageId: number | null;
}

export interface CachedConversation {
    id: number;
    model: AIModel;
    messages: CachedMessage[];
    createdAt: Date;
    updatedAt: Date;
    discordGuildId?: string;
    discordChannelId?: string;
} 