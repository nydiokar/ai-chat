import { Message } from 'discord.js';

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