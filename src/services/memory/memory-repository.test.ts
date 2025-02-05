import { expect } from 'chai';
import { MemoryRepository } from './memory-repository';
import { UserPreferences, ConversationContext, EntityRelationship, CommandUsagePattern } from '../../types/memory';
import { ConversationMessage } from '../../types/conversation';
import { Message } from '@prisma/client';

describe('MemoryRepository', () => {
  let repository: MemoryRepository;

  beforeEach(async () => {
    repository = MemoryRepository.getInstance();
  });

  afterEach(async () => {
    // Clean up the database after each test
    await repository.prisma.message.deleteMany();
    await repository.prisma.conversationContext.deleteMany();
    await repository.prisma.conversation.deleteMany();
    await repository.prisma.commandUsagePattern.deleteMany();
    await repository.prisma.userMemoryPreferences.deleteMany();
    await repository.prisma.user.deleteMany();
    await repository.close();
  });

  describe('User Preferences', () => {
    it('should save and retrieve user preferences', async () => {
      const userId = 'test-user-1';
      // Create user first
      await repository.createTestUser(userId);
      
      const testPrefs: UserPreferences = {
        id: 'test-prefs-1',
        userId,
        settings: {
          theme: 'dark',
          notifications: true
        },
        lastUpdated: new Date()
      };

      await repository.saveUserPreferences(testPrefs);
      const retrieved = await repository.getUserPreferences(testPrefs.userId);

      expect(retrieved).to.not.be.null;
      expect(retrieved!.settings).to.deep.equal(testPrefs.settings);
    });
  });

  describe('Conversation Context', () => {
    it('should save and retrieve conversation context', async () => {
      // Create conversation first
      await repository.createTestConversation(1);

      // Create message first, then link it
      const message = await repository.prisma.message.create({
        data: {
          id: 1,
          content: 'Test message',
          role: 'user',
          tokenCount: 10,
          conversationId: 1,
          discordUserId: null,
          discordUsername: null
        }
      });

      const testContext: Omit<ConversationContext, 'id'> = {
        conversationId: 1,
        topics: ['test', 'context'],
        entities: ['entity1', 'entity2'],
        summary: 'Test conversation summary',
        timestamp: new Date(),
        messages: [message]
      };

      const saved = await repository.saveContext(testContext);
      const contexts = await repository.getContextByConversation(testContext.conversationId);

      expect(contexts).to.have.length.greaterThan(0);
      expect(contexts[0].topics).to.deep.equal(testContext.topics);
      expect(contexts[0].entities).to.deep.equal(testContext.entities);
    });
  });

  describe('Entity Relationships', () => {
    it('should save and retrieve entity relationships', async () => {
      const relationship: Omit<EntityRelationship, 'id'> = {
        sourceId: 'entity1',
        targetId: 'entity2',
        relationType: 'related',
        strength: 0.8,
        lastUpdated: new Date()
      };

      await repository.saveRelationship(relationship);
      const relationships = await repository.getRelationships('entity1');

      expect(relationships).to.have.length.greaterThan(0);
      expect(relationships[0].sourceId).to.equal(relationship.sourceId);
      expect(relationships[0].targetId).to.equal(relationship.targetId);
      expect(relationships[0].strength).to.equal(relationship.strength);
    });

    it('should get related entities above strength threshold', async () => {
      const relationships = [
        {
          sourceId: 'entity1',
          targetId: 'entity2',
          relationType: 'related',
          strength: 0.8,
          lastUpdated: new Date()
        },
        {
          sourceId: 'entity1',
          targetId: 'entity3',
          relationType: 'related',
          strength: 0.3,
          lastUpdated: new Date()
        }
      ];

      for (const rel of relationships) {
        await repository.saveRelationship(rel);
      }

      const relatedEntities = await repository.getRelatedEntities('entity1', 0.5);
      expect(relatedEntities).to.have.length(1);
      expect(relatedEntities[0]).to.equal('entity2');
    });
  });

  describe('Command Usage Patterns', () => {
    it('should track command usage patterns', async () => {
      const userId = 'test-user-1';
      // Create user first
      await repository.createTestUser(userId);

      const pattern: Omit<CommandUsagePattern, 'id'> = {
        userId,
        commandName: 'test-command',
        frequency: 1,
        lastUsed: new Date(),
        successRate: 1.0,
        contexts: ['context1', 'context2']
      };

      await repository.updateCommandUsage(pattern);
      const patterns = await repository.getCommandUsagePatterns(pattern.userId);

      expect(patterns).to.have.length.greaterThan(0);
      expect(patterns[0].commandName).to.equal(pattern.commandName);
    });

    it('should increment frequency on repeated command usage', async () => {
      const userId = 'test-user-2';
      // Create user first
      await repository.createTestUser(userId);

      const pattern: Omit<CommandUsagePattern, 'id'> = {
        userId,
        commandName: 'repeated-command',
        frequency: 1,
        lastUsed: new Date(),
        successRate: 1.0,
        contexts: ['context1']
      };

      await repository.updateCommandUsage(pattern);
      await repository.updateCommandUsage(pattern);
      const patterns = await repository.getCommandUsagePatterns(pattern.userId);

      expect(patterns[0].frequency).to.equal(2);
    });
  });

  describe('Memory Querying', () => {
    it('should query memories with time-based decay', async () => {
      const testUserId = 'test-user-123';
      
      // Create required records first
      await repository.createTestUser(testUserId);
      await repository.createTestConversation(1);
      await repository.createTestConversation(2);

      // Create messages first
      const message1 = await repository.prisma.message.create({
        data: {
          id: 1,
          content: 'Test message 1',
          role: 'user',
          tokenCount: 10,
          conversationId: 1,
          discordUserId: testUserId,
          discordUsername: 'testuser'
        }
      });

      const message2 = await repository.prisma.message.create({
        data: {
          id: 2,
          content: 'Test message 2',
          role: 'user',
          tokenCount: 10,
          conversationId: 2,
          discordUserId: testUserId,
          discordUsername: 'testuser'
        }
      });

      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 14);

      const oldContext: Omit<ConversationContext, 'id'> = {
        conversationId: 1,
        topics: ['old', 'test'],
        entities: ['entity1'],
        summary: 'Old context',
        timestamp: oldDate,
        messages: [message1]
      };

      const newContext: Omit<ConversationContext, 'id'> = {
        conversationId: 2,
        topics: ['new', 'test'],
        entities: ['entity1'],
        summary: 'New context',
        timestamp: new Date(),
        messages: [message2]
      };

      await repository.saveContext(oldContext);
      await repository.saveContext(newContext);

      const results = await repository.queryMemory({
        userId: testUserId,
        topics: ['test'],
        entities: ['entity1']
      });

      expect(results).to.have.length(2);
      expect(results[0].score).to.be.greaterThan(results[1].score);
    });
  });
});
