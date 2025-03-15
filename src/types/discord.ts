import { Message } from 'discord.js';
import { AIModel } from './index.js';
import { UnifiedCache, ICacheProvider } from './cache/base.js';
import { CacheType } from './cache/types.js';

export interface CommandHandler {
    action: string;
    handler: (message: Message, params: any) => Promise<void>;
}

export interface DiscordContext {
    channelId: string;
    userId: string;
    username: string;
    guildId: string;
}

/**
 * Cache types for Discord-specific data
 */
export interface DiscordCachedMessage {
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

export interface DiscordCachedConversation {
    id: number;
    model: AIModel;
    messages: DiscordCachedMessage[];
    createdAt: Date;
    updatedAt: Date;
    discordGuildId?: string;
    discordChannelId?: string;
}

/**
 * Session data structure for Discord conversations
 */
export interface DiscordSessionData {
    conversation: DiscordCachedConversation;
    lastAccessed: number;
    metadata?: {
        messageCount: number;
        lastMessageTimestamp: number;
        hasActiveCommand: boolean;
    };
} 

/**
 * Specialized cache for Discord session management
 */
export class SessionCache extends UnifiedCache<DiscordSessionData> {
    private static instance: SessionCache;

    private constructor(provider: ICacheProvider) {
        super(provider, {
            namespace: 'discord-sessions',
            type: CacheType.PERSISTENT,
            ttl: 60 * 60 * 1000 // 1 hour default TTL
        });
    }

    public static getInstance(provider: ICacheProvider): SessionCache {
        if (!SessionCache.instance) {
            SessionCache.instance = new SessionCache(provider);
        }
        return SessionCache.instance;
    }

    async getSession(channelId: string): Promise<DiscordSessionData | null> {
        return this.get(channelId);
    }

    async setSession(channelId: string, data: DiscordSessionData): Promise<void> {
        await this.set(channelId, data);
    }

    async get(key: string): Promise<DiscordSessionData | null> {
        return this.provider.get(key);
    }

    async set(key: string, value: DiscordSessionData, ttl?: number): Promise<void> {
        await this.provider.set(key, value, ttl || this.options.ttl);
    }

    async invalidateSession(channelId: string): Promise<void> {
        await this.delete(channelId);
    }
} 