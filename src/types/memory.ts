import type { Message } from '@prisma/client';
import { Model, Role } from './index.js';

export interface UserPreferences {
  id: string;
  userId: string;
  settings: {
    [key: string]: any;
  };
  lastUpdated: Date;
}

export interface ConversationContext {
  id: string;
  conversationId: number;
  topics: string[];
  entities: string[];
  summary: string;
  timestamp: Date;
  messages: Message[];
}

export interface EntityRelationship {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: string;
  strength: number;
  lastUpdated: Date;
}

export interface CommandUsagePattern {
  id: string;
  userId: string;
  commandName: string;
  frequency: number;
  lastUsed: Date;
  successRate: number;
  contexts: string[];
}

export interface MemoryQuery {
  userId?: string;
  contextIds?: string[];
  topics?: string[];
  entities?: string[];
  timeRange?: {
    start: Date;
    end: Date;
  };
  limit?: number;
}

export interface ScoredMemory {
  id: string;
  score: number;
  data: ConversationContext | EntityRelationship | CommandUsagePattern;
  type: 'context' | 'relationship' | 'command';
  metadata?: {
    messageCount?: number;
    lastMessageTimestamp?: Date;
    [key: string]: any;
  };
}

export interface MemoryPerformanceMetrics {
  totalQueries: number;
  averageQueryTime: number;
  cacheHitRate: number;
  lastResetTimestamp: Date;
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
