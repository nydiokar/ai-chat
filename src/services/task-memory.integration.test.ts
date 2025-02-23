import { expect } from 'chai';
import { DatabaseService } from './db-service.js';
import { MemoryRepository } from './memory/memory-repository.js';
import { TaskStatus, TaskPriority } from '../types/task.js';
import { PrismaClient } from '@prisma/client';
import { ConversationContext, MemoryQuery } from '../types/memory.js';

describe('Task-Memory Integration', () => {
  let dbService: DatabaseService;
  let memoryRepo: MemoryRepository;
  let testUserId: string;
  let testConversationId: number;

  before(async () => {
    // Initialize services
    dbService = DatabaseService.getInstance();
    memoryRepo = MemoryRepository.getInstance();

    // Create test user and conversation
    testUserId = 'test-user-' + Date.now();
    await memoryRepo.createTestUser(testUserId);

    // Create test conversation with a smaller number
    testConversationId = Math.floor(Math.random() * 1000000); // Use a smaller number
    // Or even simpler:
    // testConversationId = 1; // For testing, we just need a unique ID
    await memoryRepo.createTestConversation(testConversationId);
  });

  after(async () => {
    // Cleanup test data
    await dbService.prisma.task.deleteMany({
      where: {
        creator: { id: testUserId }
      }
    });
    await dbService.prisma.conversation.deleteMany({
      where: { id: testConversationId }
    });
    await dbService.prisma.user.delete({
      where: { id: testUserId }
    });

    // Close database connections
    await dbService.prisma.$disconnect();
    await memoryRepo.close();
  });

  describe('Task Creation with Memory Context', () => {
    it('should create a task and its conversation context', async () => {
      // Create a conversation context first
      const context = await memoryRepo.saveContext({
        conversationId: testConversationId,
        topics: ['testing', 'development'],
        entities: ['task', 'context'],
        summary: 'Test conversation context',
        timestamp: new Date(),
        messages: []
      });
      expect(context).to.have.property('id');

      // Create a task associated with the conversation
      const task = await dbService.prisma.task.create({
        data: {
          title: 'Integration Test Task',
          description: 'Testing task-memory integration',
          creator: {
            connect: { id: testUserId }
          },
          conversation: {
            connect: { id: testConversationId }
          },
          priority: TaskPriority.MEDIUM,
          tags: []
        },
        include: {
          conversation: {
            include: {
              contexts: true
            }
          }
        }
      });

      // Verify task was created and linked properly
      expect(task.conversationId).to.equal(testConversationId);
      
      // Verify context is accessible through task's conversation
      const contexts = await memoryRepo.getContextByConversation(testConversationId);
      expect(contexts).to.have.length.greaterThan(0);
      
      const typedContext = contexts[0] as ConversationContext;
      expect(typedContext.topics).to.include('testing');
    });

    it('should update conversation context when task status changes', async () => {

      // Create task
      const task = await dbService.prisma.task.create({
        data: {
          title: 'Status Update Task',
          description: 'Testing status updates',
          creator: {
            connect: { id: testUserId }
          },
          conversation: {
            connect: { id: testConversationId }
          },
          priority: TaskPriority.MEDIUM,
          tags: []
        }
      });

      // Update task status
      await dbService.prisma.task.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.IN_PROGRESS
        }
      });

      // Add new context reflecting status change
      await memoryRepo.saveContext({
        conversationId: testConversationId,
        topics: ['task', 'status', 'progress'],
        entities: ['task-status', 'in-progress'],
        summary: 'Task moved to in-progress',
        timestamp: new Date(),
        messages: []
      });

      // Verify contexts are updated
      const contexts = await memoryRepo.getContextByConversation(testConversationId);
      expect(contexts).to.have.length(2);
      const typedContext = contexts[0] as ConversationContext;
      expect(typedContext.topics).to.include('progress');
      expect(typedContext.entities).to.include('in-progress');
    });
  });

  describe('Memory Query Integration', () => {
    it('should find task-related memory contexts', async () => {
      // Create task with specific context
      const specificTopic = 'unique-test-topic-' + Date.now();
      
      // Create context first
      await memoryRepo.saveContext({
        conversationId: testConversationId,
        topics: [specificTopic, 'task'],
        entities: ['test-entity'],
        summary: 'Specific test context',
        timestamp: new Date(),
        messages: []
      });

      // Create task
      await dbService.prisma.task.create({
        data: {
          title: 'Memory Query Test Task',
          description: 'Testing memory queries',
          creator: {
            connect: { id: testUserId }
          },
          conversation: {
            connect: { id: testConversationId }
          },
          priority: TaskPriority.MEDIUM,
          tags: []
        }
      });

      // Query memory with specific topic
      const result = await memoryRepo.queryMemory({
        topics: [specificTopic]
      });

      expect(result).to.have.length.greaterThan(0);
      const typedMemory = result[0].data as ConversationContext;
      expect(typedMemory.topics).to.include(specificTopic);
      expect(result[0].type).to.equal('context');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing conversation gracefully', async () => {
      try {
        await dbService.prisma.task.create({
          data: {
            title: 'Error Test Task',
            description: 'Testing error handling',
            creator: {
              connect: { id: testUserId }
            },
            conversation: {
              connect: { id: 999 } // Non-existent conversation
            },
            priority: TaskPriority.MEDIUM,
            tags: []
          }
        });
        expect.fail('Should have thrown an error');
      } catch (err) {
        const error = err as Error;
        expect(error.message).to.include('No \'Conversation\' record');
      }
    });

    it('should handle invalid memory queries gracefully', async () => {
      try {
        await memoryRepo.queryMemory({
          topics: ['non-existent-topic']
        });
        // Should succeed with empty results rather than throwing
        // This is the expected behavior for queries that find no matches
      } catch (error) {
        expect.fail('Should not throw on empty results');
      }
    });
  });
});
