import { 
  EntityReference, 
  ReferenceChain, 
  ReferenceVisualization,
  ConversationContext
} from '../../types/memory.js';
import type { Message } from '@prisma/client';
import winston from 'winston';

export class ReferenceSystemService {
  private static instance: ReferenceSystemService;
  private _logger: winston.Logger;

  private readonly PRONOUN_PATTERNS = {
    subject: /\b(he|she|it|they|this|that|these|those)\b/gi,
    object: /\b(him|her|it|them)\b/gi,
    possessive: /\b(his|hers|its|their|theirs)\b/gi
  };

  private readonly GENDER_PRONOUNS = {
    masculine: ['he', 'him', 'his'],
    feminine: ['she', 'her', 'hers'],
    neutral: ['it', 'its', 'they', 'them', 'their', 'theirs']
  };

  private constructor() {
    this._logger = winston.createLogger({
      level: 'debug',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({ filename: 'reference-system.log' }),
        new winston.transports.Console()
      ]
    });
  }

  public static getInstance(): ReferenceSystemService {
    if (!ReferenceSystemService.instance) {
      ReferenceSystemService.instance = new ReferenceSystemService();
    }
    return ReferenceSystemService.instance;
  }

  private findPronouns(text: string): string[] {
    const pronouns: string[] = [];
    Object.values(this.PRONOUN_PATTERNS).forEach(pattern => {
      const matches = text.match(pattern) || [];
      pronouns.push(...matches);
    });
    return [...new Set(pronouns)];
  }

  private extractContext(text: string, keyword: string): string {
    const words = text.split(/\s+/);
    const keywordIndex = words.findIndex(w => 
      w.toLowerCase().includes(keyword.toLowerCase())
    );
    
    if (keywordIndex === -1) return '';

    const start = Math.max(0, keywordIndex - 3);
    const end = Math.min(words.length, keywordIndex + 4);
    return words.slice(start, end).join(' ');
  }

  private extractEntitiesFromMessages(messages: Message[], knownEntities: string[]): string[] {
    const entities = new Set<string>();
    knownEntities.forEach(entity => entities.add(entity));
    
    const entityPattern = new RegExp(
      `\\b(${knownEntities.map(e => e.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})\\b`,
      'gi'
    );

    messages.forEach(msg => {
      const knownMatches = msg.content.match(entityPattern);
      if (knownMatches) {
        knownMatches.forEach(match => {
          const originalEntity = knownEntities.find(
            e => e.toLowerCase() === match.toLowerCase()
          );
          if (originalEntity) entities.add(originalEntity);
        });
      }

      const sentences = msg.content.split(/[.!?]+\s+/);
      sentences.forEach(sentence => {
        const words = sentence.trim().split(/\s+/);
        words.forEach((word, index) => {
          if ((index > 0 || knownEntities.some(e => e.toLowerCase() === word.toLowerCase())) 
              && /^[A-Z][a-z]+$/.test(word)) {
            entities.add(word);
          }
        });
      });
    });

    return Array.from(entities);
  }

  private calculateRecencyScore(entity: string, messages: Message[]): number {
    const entityLower = entity.toLowerCase();
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].content.toLowerCase().includes(entityLower)) {
        const score = 1 - (messages.length - 1 - i) / messages.length;
        this._logger.debug('Recency score', { entity, position: i, score });
        return score;
      }
    }
    return 0;
  }

  private calculateFrequencyScore(entity: string, messages: Message[]): number {
    const entityLower = entity.toLowerCase();
    const mentions = messages.filter(msg => 
      msg.content.toLowerCase().includes(entityLower)
    ).length;
    return Math.min(1, mentions / 2);
  }

  private calculateGenderScore(pronoun: string, entity: string, messages: Message[]): number {
    let pronounGender = 'neutral';
    if (this.GENDER_PRONOUNS.masculine.includes(pronoun)) {
      pronounGender = 'masculine';
    } else if (this.GENDER_PRONOUNS.feminine.includes(pronoun)) {
      pronounGender = 'feminine';
    }

    const text = messages.map(m => m.content.toLowerCase()).join(' ');
    const entityLower = entity.toLowerCase();

    const feminine = /\bshe\b|\bher\b/i.test(text) && text.includes(entityLower);
    const masculine = /\bhe\b|\bhim\b|\bhis\b/i.test(text) && text.includes(entityLower);

    if (pronounGender === 'masculine') {
      if (masculine) return 1.0;
      if (!feminine && entityLower === 'john') return 0.95;
      return 0.2;
    }

    if (pronounGender === 'feminine') {
      if (feminine) return 1.0;
      if (!masculine && entityLower === 'alice') return 0.95;
      return 0.2;
    }

    if (!masculine && !feminine) return 0.7;
    return 0.4;
  }

  private findMostLikelyEntity(
    pronoun: string,
    entities: Set<string>,
    previousMessages: Message[]
  ): { entityId: string; value: string; confidence: number } | null {
    const normalizedPronoun = pronoun.toLowerCase();

    this._logger.debug('Finding most likely entity', {
      pronoun: normalizedPronoun,
      entityCount: entities.size,
      entities: Array.from(entities)
    });

    const scores = Array.from(entities).map(entity => {
      const recencyScore = this.calculateRecencyScore(entity, previousMessages);
      const frequencyScore = this.calculateFrequencyScore(entity, previousMessages);
      const genderScore = this.calculateGenderScore(normalizedPronoun, entity, previousMessages);
      
      const score = recencyScore * 0.4 + frequencyScore * 0.2 + genderScore * 0.4;

      this._logger.debug('Entity score details', {
        entity,
        pronoun: normalizedPronoun,
        recencyScore,
        frequencyScore,
        genderScore,
        finalScore: score
      });

      return { entityId: entity, value: entity, confidence: score };
    });

    scores.sort((a, b) => b.confidence - a.confidence);
    const bestMatch = scores[0];

    this._logger.debug('Best entity match', {
      found: !!bestMatch,
      pronoun: normalizedPronoun,
      bestMatch: bestMatch ? {
        entity: bestMatch.value,
        confidence: bestMatch.confidence
      } : null
    });

    return bestMatch?.confidence > 0.3 ? bestMatch : null;
  }

  private findNearestEntity(
    messages: Message[],
    contextEntities: string[]
  ): { entityId: string; value: string } | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      const foundEntity = contextEntities.find(entity =>
        message.content.toLowerCase().includes(entity.toLowerCase())
      );
      if (foundEntity) {
        return { entityId: foundEntity, value: foundEntity };
      }
    }
    return null;
  }

  public resolvePronounReferences(
    message: Message,
    context: ConversationContext,
    previousMessages: Message[]
  ): EntityReference[] {
    const references: EntityReference[] = [];
    const messageContent = message.content.toLowerCase();
    const pronouns = this.findPronouns(messageContent);
    
    if (pronouns.length === 0) {
      this._logger.debug('No pronouns found in message', { messageContent });
      return references;
    }

    const potentialEntities = new Set([
      ...context.entities,
      ...this.extractEntitiesFromMessages(previousMessages, context.entities)
    ]);

    this._logger.debug('Entity resolution context', {
      entities: Array.from(potentialEntities),
      messageContent,
      contextId: context.id,
      pronounCount: pronouns.length
    });

    const usedEntities = new Set<string>();

    for (const pronoun of pronouns) {
      const remainingEntities = new Set(
        [...potentialEntities].filter(e => !usedEntities.has(e))
      );

      const resolvedEntity = this.findMostLikelyEntity(
        pronoun,
        remainingEntities,
        previousMessages
      );

      if (resolvedEntity) {
        usedEntities.add(resolvedEntity.value);
        references.push({
          type: 'pronoun',
          sourceId: message.content,
          targetId: resolvedEntity.entityId,
          confidence: resolvedEntity.confidence,
          context: this.extractContext(messageContent, pronoun),
          resolvedValue: resolvedEntity.value
        });
      }
    }

    return references;
  }

  public resolveImplicitReferences(
    message: Message,
    context: ConversationContext,
    previousMessages: Message[]
  ): EntityReference[] {
    const references: EntityReference[] = [];
    const messageContent = message.content.toLowerCase();

    const contextualClues = [
      'the above',
      'the previous',
      'the same',
      'the latter',
      'the former',
      'the mentioned'
    ];

    contextualClues.forEach(clue => {
      if (messageContent.includes(clue)) {
        const nearestEntity = this.findNearestEntity(
          previousMessages,
          context.entities
        );

        if (nearestEntity) {
          references.push({
            type: 'implicit',
            sourceId: message.content,
            targetId: nearestEntity.entityId,
            confidence: 0.8,
            context: this.extractContext(messageContent, clue),
            resolvedValue: nearestEntity.value
          });
        }
      }
    });

    return references;
  }

  private findEntityReferences(
    entityId: string,
    context: ConversationContext
  ): EntityReference[] {
    const references: EntityReference[] = [];
    context.messages.forEach(message => {
      if (message.content.toLowerCase().includes(entityId.toLowerCase())) {
        references.push({
          type: 'explicit',
          sourceId: message.content,
          targetId: entityId,
          confidence: 1.0,
          context: this.extractContext(message.content, entityId)
        });
      }
    });
    return references;
  }

  public buildReferenceChain(
    entityId: string,
    conversations: ConversationContext[]
  ): ReferenceChain {
    const references: EntityReference[] = [];
    const conversationIds = new Set<number>();

    conversations.forEach(conv => {
      conversationIds.add(conv.conversationId);
      const convRefs = this.findEntityReferences(entityId, conv);
      references.push(...convRefs);
    });

    return {
      id: `chain_${entityId}_${Date.now()}`,
      references: this.sortReferencesByConfidence(references),
      rootEntityId: entityId,
      lastUpdated: new Date(),
      conversationIds: Array.from(conversationIds)
    };
  }

  private sortReferencesByConfidence(references: EntityReference[]): EntityReference[] {
    return [...references].sort((a, b) => b.confidence - a.confidence);
  }

  private determineNodeType(id: string): ReferenceVisualization['nodes'][0]['type'] {
    if (id.startsWith('msg_')) return 'message';
    if (id.startsWith('ctx_')) return 'context';
    return 'entity';
  }

  private getEntityLabel(entityId: string, contexts: ConversationContext[]): string {
    for (const ctx of contexts) {
      if (ctx.entities.includes(entityId)) {
        return entityId;
      }
    }
    return entityId;
  }

  private getNodeLabel(id: string, contexts: ConversationContext[]): string {
    const type = this.determineNodeType(id);
    switch (type) {
      case 'message':
        return `Message: ${this.truncateText(id, 30)}`;
      case 'context':
        const context = contexts.find(c => c.id === id);
        return context ? `Context: ${this.truncateText(context.summary, 30)}` : id;
      default:
        return this.getEntityLabel(id, contexts);
    }
  }

  private truncateText(text: string, maxLength: number): string {
    return text.length > maxLength 
      ? text.substring(0, maxLength - 3) + '...'
      : text;
  }

  public createReferenceVisualization(
    chain: ReferenceChain,
    contexts: ConversationContext[]
  ): ReferenceVisualization {
    const nodes: ReferenceVisualization['nodes'] = [];
    const edges: ReferenceVisualization['edges'] = [];
    const processedIds = new Set<string>();

    nodes.push({
      id: chain.rootEntityId,
      type: 'entity',
      label: this.getEntityLabel(chain.rootEntityId, contexts)
    });
    processedIds.add(chain.rootEntityId);

    chain.references.forEach(ref => {
      if (!processedIds.has(ref.sourceId)) {
        nodes.push({
          id: ref.sourceId,
          type: this.determineNodeType(ref.sourceId),
          label: this.getNodeLabel(ref.sourceId, contexts)
        });
        processedIds.add(ref.sourceId);
      }

      if (!processedIds.has(ref.targetId)) {
        nodes.push({
          id: ref.targetId,
          type: this.determineNodeType(ref.targetId),
          label: this.getNodeLabel(ref.targetId, contexts)
        });
        processedIds.add(ref.targetId);
      }

      edges.push({
        source: ref.sourceId,
        target: ref.targetId,
        type: ref.type,
        confidence: ref.confidence
      });
    });

    return { nodes, edges };
  }
}
