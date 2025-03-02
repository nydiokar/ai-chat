import { expect } from 'chai';
import { DatabaseService } from './db-service.js';
import { MemoryRepository } from './memory/memory-repository.js';
import { TaskStatus, TaskPriority, DependencyType } from '../types/task.js';
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
    testConversationId = Math.floor(Math.random() * 1000); 
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
          tags: {},
          status: TaskStatus.OPEN
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
          tags: {},
          status: TaskStatus.OPEN
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
          tags: {},
          status: TaskStatus.OPEN
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

  describe('Task Dependencies and Memory', () => {
    let parentTaskId: number;
    let childTaskId: number;

    beforeEach(async () => {
      // Create parent task
      const parentTask = await dbService.prisma.task.create({
        data: {
          title: 'Parent Task',
          description: 'Testing task dependencies',
          creator: {
            connect: { id: testUserId }
          },
          conversation: {
            connect: { id: testConversationId }
          },
          priority: TaskPriority.HIGH,
          tags: {},
          status: TaskStatus.OPEN
        }
      });
      parentTaskId = parentTask.id;

      // Create child task
      const childTask = await dbService.prisma.task.create({
        data: {
          title: 'Child Task',
          description: 'Dependent on parent task',
          creator: {
            connect: { id: testUserId }
          },
          conversation: {
            connect: { id: testConversationId }
          },
          priority: TaskPriority.MEDIUM,
          tags: {},
          status: TaskStatus.OPEN
        }
      });
      childTaskId = childTask.id;

      // Create dependency relationship
      await dbService.prisma.taskDependency.create({
        data: {
          blockedTask: { connect: { id: childTaskId } },
          blockerTask: { connect: { id: parentTaskId } },
          dependencyType: DependencyType.BLOCKS
        }
      });
    });

    it('should maintain memory context across dependent tasks', async () => {
      // Add context to parent task
      await memoryRepo.saveContext({
        conversationId: testConversationId,
        topics: ['parent-task', 'dependency'],
        entities: ['task-dependency'],
        summary: 'Parent task context',
        timestamp: new Date(),
        messages: []
      });

      // Add context to child task
      await memoryRepo.saveContext({
        conversationId: testConversationId,
        topics: ['child-task', 'dependency'],
        entities: ['task-dependency'],
        summary: 'Child task context',
        timestamp: new Date(),
        messages: []
      });

      // Query memory for dependency-related contexts
      const result = await memoryRepo.queryMemory({
        topics: ['dependency']
      });

      expect(result).to.have.length(2);
      expect(result.some(r => (r.data as ConversationContext).topics.includes('parent-task'))).to.be.true;
      expect(result.some(r => (r.data as ConversationContext).topics.includes('child-task'))).to.be.true;
    });

    it('should propagate status changes through dependencies', async () => {
      // Update parent task status
      await dbService.prisma.task.update({
        where: { id: parentTaskId },
        data: { status: TaskStatus.COMPLETED }
      });

      // Add status change context
      await memoryRepo.saveContext({
        conversationId: testConversationId,
        topics: ['status-change', 'dependency'],
        entities: ['task-completion'],
        summary: 'Parent task completed',
        timestamp: new Date(),
        messages: []
      });

      // Query memory for status change context
      const result = await memoryRepo.queryMemory({
        topics: ['status-change']
      });

      expect(result).to.have.length(1);
      expect((result[0].data as ConversationContext).entities).to.include('task-completion');
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple simultaneous context updates', async () => {
      const updates = Array(5).fill(null).map((_, i) => 
        memoryRepo.saveContext({
          conversationId: testConversationId,
          topics: [`concurrent-${i}`],
          entities: ['concurrent-test'],
          summary: `Concurrent update ${i}`,
          timestamp: new Date(),
          messages: []
        })
      );

      const results = await Promise.all(updates);
      expect(results).to.have.length(5);
      results.forEach(result => {
        expect(result).to.have.property('id');
      });

      const contexts = await memoryRepo.getContextByConversation(testConversationId);
      expect(contexts.filter(c => 
        (c as ConversationContext).entities.includes('concurrent-test')
      )).to.have.length(5);
    });

    it('should maintain data consistency during concurrent task updates', async () => {
      const task = await dbService.prisma.task.create({
        data: {
          title: 'Concurrent Test Task',
          description: 'Testing concurrent updates',
          creator: {
            connect: { id: testUserId }
          },
          conversation: {
            connect: { id: testConversationId }
          },
          priority: TaskPriority.MEDIUM,
          tags: {},
          status: TaskStatus.OPEN
        }
      });

      const updates = [
        dbService.prisma.task.update({
          where: { id: task.id },
          data: { status: TaskStatus.IN_PROGRESS }
        }),
        memoryRepo.saveContext({
          conversationId: testConversationId,
          topics: ['concurrent-status'],
          entities: ['status-update'],
          summary: 'Status update during concurrent test',
          timestamp: new Date(),
          messages: []
        })
      ];

      await Promise.all(updates);

      const updatedTask = await dbService.prisma.task.findUnique({
        where: { id: task.id }
      });
      expect(updatedTask?.status).to.equal(TaskStatus.IN_PROGRESS);

      const contexts = await memoryRepo.getContextByConversation(testConversationId);
      expect(contexts.some(c => 
        (c as ConversationContext).topics.includes('concurrent-status')
      )).to.be.true;
    });
  });

  describe('Memory Cleanup', () => {
    it('should clean up memory contexts when task is deleted', async () => {
      // Create task with context
      const task = await dbService.prisma.task.create({
        data: {
          title: 'Cleanup Test Task',
          description: 'Testing memory cleanup',
          creator: {
            connect: { id: testUserId }
          },
          conversation: {
            connect: { id: testConversationId }
          },
          priority: TaskPriority.LOW,
          tags: {},
          status: TaskStatus.OPEN
        }
      });

      await memoryRepo.saveContext({
        conversationId: testConversationId,
        topics: ['cleanup-test'],
        entities: ['cleanup'],
        summary: 'Context for cleanup test',
        timestamp: new Date(),
        messages: []
      });

      // Get task's conversation ID before deletion
      if (task.conversationId === null) {
        throw new Error('Task has no conversation ID');
      }

      // Delete task and cleanup its contexts
      await dbService.prisma.task.delete({
        where: { id: task.id }
      });

      // Clean up contexts using both task ID and conversation ID
      await memoryRepo.cleanupTaskContexts(task.id, task.conversationId);

      // Wait a small amount of time for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify context is removed
      const result = await memoryRepo.queryMemory({
        topics: ['cleanup-test']
      });
      expect(result).to.have.length(0, 'Expected all task contexts to be cleaned up');
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
            tags: {},
            status: TaskStatus.OPEN
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

    it('should handle concurrent operation failures gracefully', async () => {
      const invalidTaskId = -1; // Non-existent task ID
      const contextPromise = memoryRepo.saveContext({
        conversationId: testConversationId,
        topics: ['error-handling'],
        entities: ['error-test'],
        summary: 'Testing error handling in concurrent operations',
        timestamp: new Date(),
        messages: []
      });
      
      try {
        await Promise.all([
          dbService.prisma.task.update({
            where: { id: invalidTaskId },
            data: { status: TaskStatus.IN_PROGRESS }
          }),
          contextPromise
        ]);
        expect.fail('Should have thrown an error');
      } catch (error) {
        // The task update should fail, but the context should be saved
        await contextPromise.catch(() => {}); // Ensure context promise completes

        // Clear the cache to get fresh data
        await memoryRepo.flushCache();
        
        // Context save should still succeed even if task update fails
        const contexts = await memoryRepo.getContextByConversation(testConversationId);
        const errorHandlingContexts = contexts.filter(c => 
          (c.topics as string[]).includes('error-handling')
        );
        expect(errorHandlingContexts).to.have.length(1, 'Expected error handling context to be saved');
      }
    });
  });
});
