import { PrismaClient, Prisma } from '@prisma/client';
import {
  UserPreferences,
  ConversationContext,
  EntityRelationship,
  CommandUsagePattern,
  MemoryQuery,
  ScoredMemory,
  MemoryPerformanceMetrics
} from '../../types/memory.js';
import NodeCache from 'node-cache';
import { performance } from 'perf_hooks';
import { getLogger } from '../../utils/shared-logger.js';

export class MemoryRepository {
  private _prisma: PrismaClient;
  private static instance: MemoryRepository;
  private readonly _logger;
  private _memoryCache: NodeCache;
  private _performanceMetrics: MemoryPerformanceMetrics;
  private readonly MAX_CACHE_SIZE = 1000;

  private constructor() {
    this._prisma = new PrismaClient();
    this._logger = getLogger('MemoryRepository');
    
    // Setup memory cache
    this._memoryCache = new NodeCache({ 
      stdTTL: 3600, // 1 hour default cache
      checkperiod: 600 // Check for expired keys every 10 minutes
    });

    // Initialize performance metrics
    this._performanceMetrics = {
      totalQueries: 0,
      averageQueryTime: 0,
      cacheHitRate: 0,
      lastResetTimestamp: new Date()
    };

    this._logger.info('Memory repository initialized', {
      cacheConfig: {
        ttl: 3600,
        checkPeriod: 600,
        maxSize: this.MAX_CACHE_SIZE
      }
    });
  }

  // Expose prisma for testing
  get prisma() {
    return this._prisma;
  }

  // Performance metrics getter
  get performanceMetrics(): MemoryPerformanceMetrics {
    return this._performanceMetrics;
  }

  public static getInstance(): MemoryRepository {
    if (!MemoryRepository.instance) {
      MemoryRepository.instance = new MemoryRepository();
    }
    return MemoryRepository.instance;
  }

  // Enhanced logging method
  private log(level: string, message: string, metadata?: any) {
    this._logger.log(level, message, metadata);
  }

  // User Preferences Management
  async saveUserPreferences(preferences: UserPreferences): Promise<UserPreferences> {
    const startTime = performance.now();
    
    try {
      // Check cache first
      const cacheKey = `user-prefs-${preferences.userId}`;
      const cachedPrefs = this._memoryCache.get<UserPreferences>(cacheKey);
      
      if (cachedPrefs) {
        this.log('debug', 'User preferences retrieved from cache', { userId: preferences.userId });
      }

      const savedPrefs = await this._prisma.userMemoryPreferences.upsert({
        where: { userId: preferences.userId },
        update: {
          settings: preferences.settings as Prisma.JsonObject,
          lastUpdated: new Date()
        },
        create: {
          id: preferences.id,
          userId: preferences.userId,
          settings: preferences.settings as Prisma.JsonObject,
          lastUpdated: new Date()
        }
      }) as UserPreferences;

      // Update cache
      this._memoryCache.set(cacheKey, savedPrefs);

      const endTime = performance.now();
      this._updatePerformanceMetrics(endTime - startTime);

      this.log('info', 'User preferences saved', { 
        userId: savedPrefs.userId, 
        timestamp: new Date().toISOString() 
      });

      return savedPrefs;
    } catch (error) {
      this.log('error', 'Failed to save user preferences', { 
        userId: preferences.userId, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  async getUserPreferences(userId: string): Promise<UserPreferences | null> {
    return this._prisma.userMemoryPreferences.findUnique({
      where: { userId }
    }) as Promise<UserPreferences | null>;
  }

  // Conversation Context Management
  async saveContext(context: Omit<ConversationContext, 'id'>): Promise<ConversationContext> {
    return this._prisma.conversationContext.create({
      data: {
        conversationId: context.conversationId,
        topics: JSON.stringify(context.topics),
        entities: JSON.stringify(context.entities),
        summary: context.summary,
        timestamp: context.timestamp,
        messages: {
          connect: context.messages.map(msg => ({ id: msg.id }))
        }
      },
      include: {
        messages: true,
        conversation: true
      }
    }) as Promise<ConversationContext>;
  }

  async updateContext(contextId: string, updates: Partial<ConversationContext>): Promise<ConversationContext> {
    return this._prisma.conversationContext.update({
      where: { id: contextId },
      data: {
        ...(updates.topics && { topics: JSON.stringify(updates.topics) }),
        ...(updates.entities && { entities: JSON.stringify(updates.entities) }),
        ...(updates.summary && { summary: updates.summary }),
        ...(updates.timestamp && { timestamp: updates.timestamp }),
        ...(updates.conversationId && { conversationId: updates.conversationId })
      },
      include: { messages: true }
    }) as Promise<ConversationContext>;
  }

  async getContextByConversation(conversationId: number): Promise<ConversationContext[]> {
    const contexts = await this._prisma.conversationContext.findMany({
      where: { conversationId },
      include: { messages: true },
      orderBy: { timestamp: 'desc' }
    });
    // Parse JSON arrays when returning contexts
    return contexts.map(context => ({
      ...context,
      topics: Array.isArray(context.topics) 
        ? context.topics 
        : JSON.parse(typeof context.topics === 'string' ? context.topics : JSON.stringify(context.topics)),
      entities: Array.isArray(context.entities)
        ? context.entities
        : JSON.parse(typeof context.entities === 'string' ? context.entities : JSON.stringify(context.entities))
    })) as ConversationContext[];
  }

  // Entity Relationship Management
  async saveRelationship(relationship: Omit<EntityRelationship, 'id'>): Promise<EntityRelationship> {
    return this._prisma.entityRelationship.upsert({
      where: {
        sourceId_targetId_relationType: {
          sourceId: relationship.sourceId,
          targetId: relationship.targetId,
          relationType: relationship.relationType
        }
      },
      update: {
        strength: relationship.strength,
        lastUpdated: new Date()
      },
      create: {
        sourceId: relationship.sourceId,
        targetId: relationship.targetId,
        relationType: relationship.relationType,
        strength: relationship.strength,
        lastUpdated: new Date()
      }
    }) as Promise<EntityRelationship>;
  }

  async getRelationships(entityId: string): Promise<EntityRelationship[]> {
    const relationships = await this._prisma.entityRelationship.findMany({
      where: {
        OR: [
          { sourceId: entityId },
          { targetId: entityId }
        ]
      },
      orderBy: { strength: 'desc' }
    });
    return relationships as EntityRelationship[];
  }

  async getRelatedEntities(entityId: string, minStrength = 0.5): Promise<string[]> {
    const relationships = await this.getRelationships(entityId);
    return relationships
      .filter(rel => rel.strength >= minStrength)
      .map(rel => rel.sourceId === entityId ? rel.targetId : rel.sourceId);
  }

  // Command Usage Pattern Management
  async updateCommandUsage(pattern: Omit<CommandUsagePattern, 'id'>): Promise<CommandUsagePattern> {
    return this._prisma.commandUsagePattern.upsert({
      where: {
        userId_commandName: {
          userId: pattern.userId,
          commandName: pattern.commandName
        }
      },
      update: {
        frequency: { increment: 1 },
        lastUsed: new Date(),
        successRate: pattern.successRate,
        contexts: pattern.contexts as Prisma.JsonArray
      },
      create: {
        userId: pattern.userId,
        commandName: pattern.commandName,
        frequency: 1,
        lastUsed: new Date(),
        successRate: pattern.successRate,
        contexts: pattern.contexts as Prisma.JsonArray
      }
    }) as Promise<CommandUsagePattern>;
  }

  async getCommandUsagePatterns(userId: string): Promise<CommandUsagePattern[]> {
    const patterns = await this._prisma.commandUsagePattern.findMany({
      where: { userId },
      orderBy: [
        { frequency: 'desc' },
        { lastUsed: 'desc' }
      ]
    });
    return patterns as CommandUsagePattern[];
  }

  // Memory Querying with Time-Based Decay
  private getDecayFactor(lastUpdated: Date): number {
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const weeksSinceUpdate = (Date.now() - lastUpdated.getTime()) / msPerWeek;
    return Math.pow(0.5, weeksSinceUpdate); // 50% decay per week
  }

  async queryMemory(query: MemoryQuery & { advanced?: { 
    minMessageCount?: number, 
    limit?: number, 
    sortBy?: string, 
    sortOrder?: 'asc' | 'desc' 
  }}): Promise<ScoredMemory[]> {
    const startTime = performance.now();
    const memories: ScoredMemory[] = [];
    const { topics, entities, timeRange, userId, advanced } = query;

    // Caching mechanism for complex queries
    const cacheKey = JSON.stringify(query);
    const cachedResult = this._memoryCache.get<ScoredMemory[]>(cacheKey);
    
    if (cachedResult) {
      this.log('debug', 'Memory query result retrieved from cache', { query });
      this._updateCacheHitRate(true);
      return cachedResult;
    }

    try {
      // Enhanced query building with advanced filtering
      // Build where conditions
      const conditions: Prisma.ConversationContextWhereInput[] = [];

      if (userId) {
        conditions.push({ messages: { some: { discordUserId: userId } } });
      }
      
      if (topics?.length) {
        conditions.push({ topics: { not: Prisma.JsonNull } });
      }
      
      if (entities?.length) {
        conditions.push({ entities: { not: Prisma.JsonNull } });
      }
      
      if (timeRange) {
        conditions.push({
          timestamp: {
            gte: timeRange.start,
            lte: timeRange.end
          }
        });
      }
      
      // Message count filtering will be handled after retrieving the contexts

      const where: Prisma.ConversationContextWhereInput = {
        AND: conditions
      };

      const prismaContexts = await this._prisma.conversationContext.findMany({
        where,
        include: { messages: true },
        // Optional sorting and limit for advanced queries
        ...(advanced?.limit ? { take: advanced.limit } : {}),
        ...(advanced?.sortBy ? { orderBy: { [advanced.sortBy]: advanced.sortOrder || 'desc' } } : {})
      });

      // Detailed context processing with enhanced scoring
      for (const context of prismaContexts) {
        // Skip contexts that don't meet the minimum message count requirement
        if (advanced?.minMessageCount && context.messages.length < advanced.minMessageCount) {
          continue;
        }
        const parsedTopics = typeof context.topics === 'string' 
          ? JSON.parse(context.topics) 
          : context.topics as string[];
        const parsedEntities = typeof context.entities === 'string' 
          ? JSON.parse(context.entities) 
          : context.entities as string[];

        const hasMatchingTopic = !topics?.length || topics.some(t => parsedTopics.includes(t));
        const hasMatchingEntity = !entities?.length || entities.some(e => parsedEntities.includes(e));

        if (hasMatchingTopic && hasMatchingEntity) {
          const transformedContext: ConversationContext = {
            id: context.id,
            conversationId: context.conversationId,
            topics: parsedTopics,
            entities: parsedEntities,
            summary: context.summary,
            timestamp: context.timestamp,
            messages: context.messages
          };

          const decayFactor = this.getDecayFactor(transformedContext.timestamp);
          const relevanceScore = this.calculateRelevanceScore(transformedContext, topics, entities);
          
          const scoredMemory: ScoredMemory = {
            id: transformedContext.id,
            score: relevanceScore * decayFactor,
            data: transformedContext,
            type: 'context',
            // Additional metadata for advanced querying
            metadata: {
              messageCount: transformedContext.messages.length,
              lastMessageTimestamp: transformedContext.messages[transformedContext.messages.length - 1]?.createdAt
            }
          };

          memories.push(scoredMemory);
        }
      }

      memories.sort((a, b) => b.score - a.score);
      // Add cache size check and eviction
      const stats = this._memoryCache.getStats();
      if (stats && stats.keys >= this.MAX_CACHE_SIZE) {
        // Evict oldest entries
        const keysToEvict = Array.from(this._memoryCache.keys()).slice(0, 100);
        keysToEvict.forEach(key => this._memoryCache.del(key));
      }

      // Cache the result
      this._memoryCache.set(cacheKey, memories);
      this._updateCacheHitRate(false);

      const endTime = performance.now();
      this._updatePerformanceMetrics(endTime - startTime);

      this.log('info', 'Memory query completed', { 
        queryParams: query, 
        resultCount: memories.length 
      });

      return memories;
    } catch (error) {
      this.log('error', 'Memory query failed', { 
        query, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  private calculateRelevanceScore(
    context: ConversationContext,
    queryTopics?: string[],
    queryEntities?: string[]
  ): number {
    let score = 1.0;  // Base score
    
    if (queryTopics?.length) {
      const matchingTopics = queryTopics.filter(t => context.topics.includes(t)).length;
      const topicMatchScore = matchingTopics / Math.max(queryTopics.length, context.topics.length);
      score *= (0.6 + 0.4 * topicMatchScore);  // Weight topic matches
    }
    
    if (queryEntities?.length) {
      const matchingEntities = queryEntities.filter(e => context.entities.includes(e)).length;
      const entityMatchScore = matchingEntities / Math.max(queryEntities.length, context.entities.length);
      score *= (0.6 + 0.4 * entityMatchScore);  // Weight entity matches
    }
    
    return score;
  }

  // Performance metrics update method
  private _updatePerformanceMetrics(queryTime: number) {
    this._performanceMetrics.totalQueries++;
    this._performanceMetrics.averageQueryTime = 
      (this._performanceMetrics.averageQueryTime * (this._performanceMetrics.totalQueries - 1) + queryTime) 
      / this._performanceMetrics.totalQueries;
  }

  // Cache hit rate tracking
  private _updateCacheHitRate(isHit: boolean) {
    // Simple moving average for cache hit rate
    const currentHitRate = this._performanceMetrics.cacheHitRate;
    this._performanceMetrics.cacheHitRate = 
      isHit 
      ? (currentHitRate * 0.9 + 0.1) 
      : (currentHitRate * 0.9);
  }

  // Memory cleanup mechanism
  async cleanupOldMemories(retentionDays: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    try {
      const deletedContexts = await this._prisma.conversationContext.deleteMany({
        where: {
          timestamp: {
            lt: cutoffDate
          }
        }
      });

      const deletedRelationships = await this._prisma.entityRelationship.deleteMany({
        where: {
          lastUpdated: {
            lt: cutoffDate
          }
        }
      });

      this.log('info', 'Memory cleanup completed', {
        deletedContexts: deletedContexts.count,
        deletedRelationships: deletedRelationships.count
      });

      return deletedContexts.count + deletedRelationships.count;
    } catch (error) {
      this.log('error', 'Memory cleanup failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  async close(): Promise<void> {
    await this._prisma.$disconnect();
  }

  // Clear all cache entries - useful for testing
  async flushCache(): Promise<void> {
    this._memoryCache.flushAll();
  }

  // Memory cleanup for deleted tasks
  async cleanupTaskContexts(taskId: number, conversationId?: number): Promise<void> {
    try {
      let targetConversationId = conversationId;
      
      // If conversationId not provided, try to get it from the task
      if (typeof targetConversationId === 'undefined') {
        const task = await this._prisma.task.findUnique({
          where: { id: taskId },
          select: { conversationId: true }
        });
        if (task?.conversationId) {
          targetConversationId = task.conversationId;
        }
      }

      if (typeof targetConversationId === 'number') {
        // Delete contexts associated with the conversation
        await this._prisma.conversationContext.deleteMany({
          where: { conversationId: targetConversationId }
        });

        // Clear cache entries related to this conversation
        const cacheKeys = Array.from(this._memoryCache.keys());
        for (const key of cacheKeys) {
          if (key.includes(String(targetConversationId))) {
            this._memoryCache.del(key);
          }
        }

        this.log('info', 'Task contexts cleaned up', { 
          taskId,
          conversationId: targetConversationId
        });

        // Reset query cache
        this._memoryCache.flushAll();
      }
    } catch (error) {
      this.log('error', 'Failed to cleanup task contexts', { 
        taskId, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  // Helper methods for testing
  async createTestUser(id: string) {
    return await this._prisma.user.create({
      data: {
        id,
        username: `test-user-${id}`,
        isActive: true
      }
    });
  }

  async createTestConversation(id: number) {
    return this._prisma.conversation.create({
      data: {
        id,
        model: 'gpt',
        tokenCount: 0
      }
    });
  }
}
