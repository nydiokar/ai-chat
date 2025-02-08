import { expect } from 'chai';
import sinon from 'sinon';
import { TaskSpawningService } from './task-spawning.service.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { RecurrencePatternService } from './recurrence-pattern.service.js';
import { 
  TaskWithRelations, 
  RecurrencePattern, 
  RecurrenceType, 
  TaskStatus,
  TaskHistoryAction,
  CreateTaskDTO,
  TaskPriority
} from '../../types/task.js';

describe('TaskSpawningService', () => {
  let taskSpawningService: TaskSpawningService;
  let taskRepositoryStub: sinon.SinonStubbedInstance<TaskRepository>;
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    // Freeze time to a specific date
    clock = sinon.useFakeTimers(new Date(2025, 1, 1).getTime());

    // Create a stub for TaskRepository
    taskRepositoryStub = sinon.createStubInstance(TaskRepository);
    
    // Reset the singleton instance
    (TaskSpawningService as any).instance = null;
    taskSpawningService = TaskSpawningService.getInstance();
    
    // Replace the real repository with the stub
    (taskSpawningService as any).taskRepository = taskRepositoryStub;
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  describe('spawnTaskInstance', () => {
    it('should create a new task instance with correct properties', async () => {
      // Prepare a parent task
      const parentTask: TaskWithRelations = {
        id: 1,
        title: 'Test Recurring Task',
        description: 'A task that recurs',
        status: TaskStatus.OPEN,
        priority: TaskPriority.MEDIUM, 
        blockedBy: [], // Add missing dependency arrays
        blocking: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        creatorId: 'user1',
        assigneeId: 'user2',
        tags: [],
        metadata: {},

        creator: {
          id: 'user1',
          username: 'creator',
          createdAt: new Date(),
          updatedAt: new Date(),
          isActive: true
        },
        assignee: {
          id: 'user2',
          username: 'assignee',
          createdAt: new Date(),
          updatedAt: new Date(),
          isActive: true
        },
        subTasks: [],
        history: [],
      };

      const occurrenceDate = new Date(2025, 1, 15);

      // Stub the createTask method
      const expectedTaskInstance: CreateTaskDTO = {
        title: `${parentTask.title} - ${occurrenceDate.toLocaleDateString()}`,
        description: parentTask.description,
        creatorId: parentTask.creatorId,
        assigneeId: parentTask.assigneeId,
        priority: parentTask.priority,
        dueDate: occurrenceDate,
        parentTaskId: parentTask.id,
        tags: parentTask.tags as string[],
        metadata: {
          ...parentTask.metadata,
          originalTaskId: parentTask.id,
          occurrenceDate: occurrenceDate.toISOString()
        }
      };

      const newTask: TaskWithRelations = {
        id: 2,
        status: TaskStatus.OPEN,
        createdAt: new Date(),
        title: expectedTaskInstance.title,
        description: expectedTaskInstance.description,
        creatorId: expectedTaskInstance.creatorId,
        assigneeId: expectedTaskInstance.assigneeId,
        priority: expectedTaskInstance.priority as TaskPriority ,
        dueDate: expectedTaskInstance.dueDate,
        parentTaskId: expectedTaskInstance.parentTaskId,
        tags: expectedTaskInstance.tags as Record<string, any>,
        metadata: expectedTaskInstance.metadata,
        blockedBy: [], // Add missing dependency arrays
        blocking: [],
        updatedAt: new Date(),
        creator: parentTask.creator,

        assignee: parentTask.assignee,
        subTasks: [],
        history: []
      };

      taskRepositoryStub.createTask.resolves(newTask);
      taskRepositoryStub.addTaskHistory.resolves();

      // Call the method
      const result = await taskSpawningService.spawnTaskInstance(parentTask, occurrenceDate);

      // Assertions
      expect(taskRepositoryStub.createTask.calledOnceWith(sinon.match(expectedTaskInstance))).to.be.true;
      expect(taskRepositoryStub.addTaskHistory.calledOnce).to.be.true;
      expect(result).to.deep.equal(newTask);
    });
  });

  describe('processRecurringTasks', () => {
    it('should spawn tasks for due recurring tasks', async () => {
      // Prepare a recurring task
      const recurringTask: TaskWithRelations = {
        id: 1,
        title: 'Daily Recurring Task',
        description: 'A task that recurs daily',
        status: TaskStatus.OPEN,
        priority: TaskPriority.MEDIUM,
        blockedBy: [], // Add missing dependency arrays
        blocking: [],
        createdAt: new Date(),
        tags: [],
        updatedAt: new Date(),
        creatorId: 'user1',

        metadata: {
          recurrencePattern: {
            type: RecurrenceType.DAILY,
            interval: 1
          }
        },
        creator: {
          id: 'user1',
          username: 'creator',
          createdAt: new Date(),
          updatedAt: new Date(),
          isActive: true
        },
        subTasks: [],
        history: [],
      };

      // Add these new stubs for RecurrencePatternService
      sinon.stub(RecurrencePatternService, 'shouldSpawnTask').returns(true);
      sinon.stub(RecurrencePatternService, 'getNextOccurrence').returns(new Date(2025, 2, 1)); // March 1st, 2025

      // Stub the methods
      taskRepositoryStub.listTasks.resolves({ 
        tasks: [recurringTask], 
        total: 1 
      });
      taskRepositoryStub.listTasks.withArgs(sinon.match({ parentTaskId: 1 })).resolves({ 
        tasks: [], 
        total: 0 
      });

      const spawnStub = sinon.stub(taskSpawningService, 'spawnTaskInstance').resolves();

      // Call the method
      await taskSpawningService.processRecurringTasks();

      // Assertions
      expect(spawnStub.calledOnce).to.be.true;
      expect((RecurrencePatternService.shouldSpawnTask as sinon.SinonStub).calledOnce).to.be.true;
      expect((RecurrencePatternService.getNextOccurrence as sinon.SinonStub).calledOnce).to.be.true;
    });
  });

  describe('completeTaskInstance', () => {
    it('should complete a task and log history', async () => {
      const taskId = 1;
      const userId = 'user1';

      const completedTask: TaskWithRelations = {
        id: taskId,
        title: 'Test Task',
        description: 'A task to complete',
        status: TaskStatus.COMPLETED,
        priority: TaskPriority.MEDIUM,
        blockedBy: [], // Add missing dependency arrays
        blocking: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        tags: [],
        completedAt: new Date(),
        creatorId: userId,

        creator: {
          id: userId,
          username: 'user',
          createdAt: new Date(),
          updatedAt: new Date(),
          isActive: true
        },
        subTasks: [],
        history: []
      };

      taskRepositoryStub.updateTask.resolves(completedTask);
      taskRepositoryStub.addTaskHistory.resolves();

      // Call the method
      const result = await taskSpawningService.completeTaskInstance(taskId, userId);

      // Assertions
      expect(taskRepositoryStub.updateTask.calledOnceWith(taskId, { status: TaskStatus.COMPLETED })).to.be.true;
      expect(taskRepositoryStub.addTaskHistory.calledOnce).to.be.true;
      expect(result).to.deep.equal(completedTask);
    });
  });
});
