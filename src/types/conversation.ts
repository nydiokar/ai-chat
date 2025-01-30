import { Message, Conversation } from '@prisma/client';
import { Model, Role } from '../types/index.js';

export interface ConversationBranch extends Conversation {
    messages: Message[];
    children: ConversationBranch[];
}

export interface BranchContext {
    branchId?: string;
    parentMessageId?: string;
}

export interface ConversationMetadata {
    title?: string;
    summary?: string;
    model: keyof typeof Model;
    tokenCount: number;
}

export interface ConversationMessage {
    content: string;
    role: keyof typeof Role;
    tokenCount?: number;
    metadata?: {
        discordUserId?: string;
        discordUsername?: string;
    };
}
