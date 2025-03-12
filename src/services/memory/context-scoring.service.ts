import { ConversationContext, ContextScore, ContextDecayParams, TopicContext, ConversationMessage } from '../../types/memory.js';
import winston from 'winston';

export class ContextScoringService {
  private static instance: ContextScoringService;
  private _logger: winston.Logger;
  
  private readonly DEFAULT_DECAY_PARAMS: ContextDecayParams = {
    baseHalfLife: 24 * 60 * 60 * 1000, // 24 hours
    topicMultiplier: 1.5,
    interactionBoost: 1.2
  };

  private constructor() {
    this._logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({ filename: 'context-scoring.log' }),
        new winston.transports.Console()
      ]
    });
  }

  public static getInstance(): ContextScoringService {
    if (!ContextScoringService.instance) {
      ContextScoringService.instance = new ContextScoringService();
    }
    return ContextScoringService.instance;
  }

  /**
   * Calculate context relevance score based on multiple factors
   */
  public calculateContextScore(
    context: ConversationContext,
    currentTopics: string[],
    currentEntities: string[],
    decayParams: ContextDecayParams = this.DEFAULT_DECAY_PARAMS
  ): ContextScore {
    const now = new Date();
    
    // Calculate recency score using decay
    const timeDiff = now.getTime() - context.timestamp.getTime();
    const recency = Math.pow(0.5, timeDiff / decayParams.baseHalfLife);

    // Calculate topic relevance
    const topicRelevance = this.calculateTopicRelevance(
      context.topics,
      currentTopics
    );

    // Calculate topic continuity
    const topicContinuity = this.calculateTopicContinuity(
      context.topics,
      currentTopics
    );

    // Calculate weighted score
    let weightedScore = (
      recency * 0.3 +
      topicRelevance * 0.4 +
      topicContinuity * 0.3
    );

    // Apply topic multiplier but ensure score stays between 0-1
    const finalScore = Math.min(1, weightedScore * decayParams.topicMultiplier);

    return {
      relevance: topicRelevance,
      recency,
      topicContinuity,
      finalScore
    };
  }

  /**
   * Calculate relevance between two sets of topics
   */
  private calculateTopicRelevance(
    contextTopics: string[],
    currentTopics: string[]
  ): number {
    if (!currentTopics.length || !contextTopics.length) return 0;

    const matchingTopics = currentTopics.filter(topic =>
      contextTopics.includes(topic)
    ).length;

    return matchingTopics / Math.max(currentTopics.length, contextTopics.length);
  }

  /**
   * Calculate topic continuity score
   */
  private calculateTopicContinuity(
    previousTopics: string[],
    currentTopics: string[]
  ): number {
    if (!currentTopics.length || !previousTopics.length) return 0;

    const commonTopics = currentTopics.filter(topic =>
      previousTopics.includes(topic)
    ).length;

    const totalTopics = new Set([...currentTopics, ...previousTopics]).size;
    return commonTopics / totalTopics;
  }

  /**
   * Track topic transitions in a conversation
   */
  public trackTopicTransitions(
    messages: ConversationMessage[],
    currentTopics: string[]
  ): TopicContext[] {
    const topicContexts: Map<string, TopicContext> = new Map();

    // Process messages chronologically
    messages.forEach((message, index) => {
      currentTopics.forEach(topic => {
        const existingContext = topicContexts.get(topic);
        const messageId = `msg_${index}`; // Simplified message ID

        if (existingContext) {
          // Update existing topic context
          existingContext.lastMentioned = new Date();
          existingContext.messageReferences.push(messageId);
          existingContext.confidence = Math.min(
            1.0,
            existingContext.confidence + 0.1
          );
        } else {
          // Create new topic context
          topicContexts.set(topic, {
            name: topic,
            confidence: 0.5, // Initial confidence
            firstMentioned: new Date(),
            lastMentioned: new Date(),
            messageReferences: [messageId]
          });
        }
      });
    });

    return Array.from(topicContexts.values());
  }

  /**
   * Detect topic transitions between contexts
   */
  public detectTopicTransitions(
    previousContext: ConversationContext,
    currentContext: ConversationContext
  ): { added: string[]; removed: string[]; continued: string[] } {
    const added = currentContext.topics.filter(
      topic => !previousContext.topics.includes(topic)
    );
    const removed = previousContext.topics.filter(
      topic => !currentContext.topics.includes(topic)
    );
    const continued = currentContext.topics.filter(topic =>
      previousContext.topics.includes(topic)
    );

    this._logger.info('Topic transition detected', {
      added,
      removed,
      continued,
      timestamp: new Date().toISOString()
    });

    return { added, removed, continued };
  }

  /**
   * Get the most relevant contexts for the current conversation state
   */
  public getRelevantContexts(
    contexts: ConversationContext[],
    currentTopics: string[],
    currentEntities: string[],
    limit: number = 5
  ): ConversationContext[] {
    const scoredContexts = contexts
      .map(context => ({
        context,
        score: this.calculateContextScore(
          context,
          currentTopics,
          currentEntities
        ).finalScore
      }))
      .sort((a, b) => b.score - a.score);

    return scoredContexts.slice(0, limit).map(sc => sc.context);
  }
}
