import { expect } from 'chai';
import { ContextScoringService } from '../../../services/performance/context-scoring.service.js';
import { ConversationContext, ConversationMessage } from '../../../types/memory.js';

describe('ContextScoringService', () => {
  let service: ContextScoringService;

  beforeEach(() => {
    service = ContextScoringService.getInstance();
  });

  describe('calculateContextScore', () => {
    it('should calculate accurate relevance scores', () => {
      const context: ConversationContext = {
        id: '1',
        conversationId: 1,
        topics: ['typescript', 'testing', 'nodejs'],
        entities: ['mocha', 'chai'],
        summary: 'Discussion about testing',
        timestamp: new Date(),
        messages: []
      };

      const currentTopics = ['typescript', 'testing'];
      const currentEntities = ['mocha'];

      const score = service.calculateContextScore(
        context,
        currentTopics,
        currentEntities
      );

      expect(score.finalScore).to.be.within(0, 1);
      expect(score.relevance).to.be.greaterThan(0.5); // High relevance expected
      expect(score.recency).to.equal(1); // Recent context
    });

    it('should apply decay to older contexts', () => {
      const oldContext: ConversationContext = {
        id: '1',
        conversationId: 1,
        topics: ['typescript', 'testing'],
        entities: ['mocha'],
        summary: 'Old discussion',
        timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000), // 48 hours old
        messages: []
      };

      const currentTopics = ['typescript', 'testing'];
      const currentEntities = ['mocha'];

      const score = service.calculateContextScore(
        oldContext,
        currentTopics,
        currentEntities
      );

      expect(score.recency).to.be.lessThan(0.5); // Significant decay expected
    });
  });

  describe('trackTopicTransitions', () => {
    it('should track topic transitions across messages', () => {
      const messages: ConversationMessage[] = [
        {
          content: 'Let\'s discuss TypeScript',
          role: 'user',
          tokenCount: 10,
        },
        {
          content: 'How about testing?',
          role: 'user',
          tokenCount: 8,
        }
      ];

      const currentTopics = ['typescript', 'testing'];

      const transitions = service.trackTopicTransitions(messages, currentTopics);

      expect(transitions).to.have.lengthOf(2);
      expect(transitions[0].name).to.equal('typescript');
      expect(transitions[1].name).to.equal('testing');
      expect(transitions[0].messageReferences).to.have.lengthOf(2);
    });

    it('should maintain topic confidence scores', () => {
      const messages: ConversationMessage[] = Array(5).fill({
        content: 'Message about TypeScript',
        role: 'user',
        tokenCount: 10,
      });

      const currentTopics = ['typescript'];

      const transitions = service.trackTopicTransitions(messages, currentTopics);

      expect(transitions[0].confidence).to.be.greaterThan(0.5);
    });
  });

  describe('detectTopicTransitions', () => {
    it('should detect added and removed topics', () => {
      const previousContext: ConversationContext = {
        id: '1',
        conversationId: 1,
        topics: ['typescript', 'javascript'],
        entities: [],
        summary: 'Previous context',
        timestamp: new Date(),
        messages: []
      };

      const currentContext: ConversationContext = {
        id: '2',
        conversationId: 1,
        topics: ['typescript', 'testing'],
        entities: [],
        summary: 'Current context',
        timestamp: new Date(),
        messages: []
      };

      const transitions = service.detectTopicTransitions(
        previousContext,
        currentContext
      );

      expect(transitions.added).to.deep.equal(['testing']);
      expect(transitions.removed).to.deep.equal(['javascript']);
      expect(transitions.continued).to.deep.equal(['typescript']);
    });
  });

  describe('getRelevantContexts', () => {
    it('should return most relevant contexts first', () => {
      const contexts: ConversationContext[] = [
        {
          id: '1',
          conversationId: 1,
          topics: ['typescript', 'testing'],
          entities: ['mocha'],
          summary: 'Recent relevant context',
          timestamp: new Date(),
          messages: []
        },
        {
          id: '2',
          conversationId: 1,
          topics: ['python', 'django'],
          entities: ['pytest'],
          summary: 'Recent unrelated context',
          timestamp: new Date(),
          messages: []
        },
        {
          id: '3',
          conversationId: 1,
          topics: ['typescript', 'testing'],
          entities: ['mocha'],
          summary: 'Old relevant context',
          timestamp: new Date(Date.now() - 72 * 60 * 60 * 1000), // 72 hours old
          messages: []
        }
      ];

      const currentTopics = ['typescript', 'testing'];
      const currentEntities = ['mocha'];

      const relevantContexts = service.getRelevantContexts(
        contexts,
        currentTopics,
        currentEntities,
        2
      );

      expect(relevantContexts).to.have.lengthOf(2);
      expect(relevantContexts[0].id).to.equal('1'); // Most recent and relevant
      expect(relevantContexts[1].id).to.equal('3'); // Old but relevant
    });

    it('should handle multi-topic contexts', () => {
      const contexts: ConversationContext[] = [
        {
          id: '1',
          conversationId: 1,
          topics: ['typescript', 'testing', 'nodejs', 'express'],
          entities: ['mocha', 'chai', 'supertest'],
          summary: 'Complex context',
          timestamp: new Date(),
          messages: []
        },
        {
          id: '2',
          conversationId: 1,
          topics: ['typescript'],
          entities: ['tsc'],
          summary: 'Simple context',
          timestamp: new Date(),
          messages: []
        }
      ];

      const currentTopics = ['typescript', 'testing', 'express'];
      const currentEntities = ['mocha', 'supertest'];

      const relevantContexts = service.getRelevantContexts(
        contexts,
        currentTopics,
        currentEntities
      );

      expect(relevantContexts[0].id).to.equal('1');
      expect(relevantContexts[1].id).to.equal('2');
    });
  });
});
