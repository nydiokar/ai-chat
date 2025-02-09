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

export interface TopicContext {
  name: string;
  confidence: number;
  firstMentioned: Date;
  lastMentioned: Date;
  messageReferences: string[];
}

export interface ContextScore {
  relevance: number;
  recency: number;
  topicContinuity: number;
  finalScore: number;
}

export interface ContextDecayParams {
  baseHalfLife: number;  // Base time in ms for score to decay by 50%
  topicMultiplier: number;  // Multiplier based on topic relevance
  interactionBoost: number;  // Boost factor for recent interactions
}

export interface ConversationMetadata {
  title?: string;
  summary?: string;
  model: keyof typeof Model;
  tokenCount: number;
}

export interface EntityReference {
  type: 'pronoun' | 'implicit' | 'explicit';
  sourceId: string;  // ID of the referencing message/context
  targetId: string;  // ID of the referenced entity/message
  confidence: number;
  context?: string;  // Surrounding context that helps understand the reference
  resolvedValue?: string;  // The actual entity being referenced
}

export interface ReferenceChain {
  id: string;
  references: EntityReference[];
  rootEntityId: string;  // The original entity being referenced
  lastUpdated: Date;
  conversationIds: number[];  // Conversations where this reference chain appears
}

export interface ReferenceVisualization {
  nodes: Array<{
    id: string;
    type: 'entity' | 'message' | 'context';
    label: string;
    data?: any;
  }>;
  edges: Array<{
    source: string;
    target: string;
    type: EntityReference['type'];
    confidence: number;
  }>;
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
