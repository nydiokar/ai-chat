import { PrismaClient } from '@prisma/client';
import { expect } from 'chai';
import { TaskManager } from '../../features/tasks/task-manager.js';
import { TaskStatus, TaskPriority, CreateTaskDTO } from '../../types/task.js';
import { TaskManagerError } from '../../features/tasks/task-manager.js';

describe('TaskManager Integration Tests', () => {
  let taskManager: TaskManager;
  let prisma: PrismaClient;
  let testUser1: { id: string; username: string };
  let testUser2: { id: string; username: string };

  before(async () => {
    // Initialize Prisma with test database
    prisma = new PrismaClient();
    taskManager = TaskManager.getInstance();

    // Create test users
    testUser1 = await prisma.user.create({
      data: {
        id: 'test-user-1',
        username: 'testuser1',
        isActive: true
      }
    });

    testUser2 = await prisma.user.create({
      data: {
        id: 'test-user-2',
        username: 'testuser2',
        isActive: true
      }
    });
  });

  after(async () => {
    // Clean up test data
    await prisma.task.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean tasks before each test
    await prisma.task.deleteMany();
  });

  describe('Task Creation', () => {
    it('should successfully create a task with basic information', async () => {
      const taskData: CreateTaskDTO = {
        title: 'Test Task',
        description: 'Test Description',
        creatorId: testUser1.id,
        priority: TaskPriority.MEDIUM,
        tags: ['test', 'integration']
      };

      const task = await taskManager.createTask(taskData);

      expect(task).to.include({
        title: taskData.title,
        description: taskData.description,
        creatorId: testUser1.id,
        status: TaskStatus.OPEN,
        priority: TaskPriority.MEDIUM
      });
      expect(task.id).to.be.a('number');
      expect(task.creator).to.include({
        id: testUser1.id,
        username: testUser1.username
      });
    });

    it('should create a task with an assignee', async () => {
      const task = await taskManager.createTask({
        title: 'Assigned Task',
        description: 'Task with assignee',
        creatorId: testUser1.id,
        assigneeId: testUser2.id,
        tags: []
      });

      expect(task.assigneeId).to.equal(testUser2.id);
      expect(task.assignee).to.include({
        id: testUser2.id,
        username: testUser2.username
      });
    });
  });

  describe('Task Status Updates', () => {
    let testTask: any;

    beforeEach(async () => {
      testTask = await taskManager.createTask({
        title: 'Status Test Task',
        description: 'Task for testing status updates',
        creatorId: testUser1.id,
        tags: []
      });
    });

    it('should allow creator to update task status', async () => {
      const updatedTask = await taskManager.updateTaskStatus(
        testTask.id,
        TaskStatus.IN_PROGRESS,
        testUser1.id
      );

      expect(updatedTask.status).to.equal(TaskStatus.IN_PROGRESS);
    });

    it('should allow assignee to update task status', async () => {
      // First assign the task
      await taskManager.assignTask(testTask.id, testUser2.id, testUser1.id);

      const updatedTask = await taskManager.updateTaskStatus(
        testTask.id,
        TaskStatus.IN_PROGRESS,
        testUser2.id
      );

      expect(updatedTask.status).to.equal(TaskStatus.IN_PROGRESS);
    });

    it('should not allow unauthorized users to update task status', async () => {
      try {
        await taskManager.updateTaskStatus(testTask.id, TaskStatus.IN_PROGRESS, 'unauthorized-user');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.be.instanceOf(TaskManagerError);
      }
    });
  });

  describe('Task Assignment', () => {
    let testTask: any;

    beforeEach(async () => {
      testTask = await taskManager.createTask({
        title: 'Assignment Test Task',
        description: 'Task for testing assignment',
        creatorId: testUser1.id,
        tags: []
      });
    });

    it('should allow creator to assign task', async () => {
      const updatedTask = await taskManager.assignTask(
        testTask.id,
        testUser2.id,
        testUser1.id
      );

      expect(updatedTask.assigneeId).to.equal(testUser2.id);
      expect(updatedTask.assignee).to.include({
        id: testUser2.id,
        username: testUser2.username
      });
    });

    it('should not allow non-creators to assign task', async () => {
      try {
        await taskManager.assignTask(testTask.id, testUser2.id, 'unauthorized-user');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.be.instanceOf(TaskManagerError);
      }
    });
  });

  describe('Task Listing', () => {
    beforeEach(async () => {
      // Create multiple tasks for testing list operations
      await Promise.all([
        taskManager.createTask({
          title: 'Task 1',
          description: 'First task',
          creatorId: testUser1.id,
          priority: TaskPriority.HIGH,
          tags: []
        }),
        taskManager.createTask({
          title: 'Task 2',
          description: 'Second task',
          creatorId: testUser1.id,
          assigneeId: testUser2.id,
          priority: TaskPriority.MEDIUM,
          tags: []
        }),
        taskManager.createTask({
          title: 'Task 3',
          description: 'Third task',
          creatorId: testUser2.id,
          priority: TaskPriority.LOW,
          tags: []
        })
      ]);
    });

    it('should list tasks with filters', async () => {
      const result = await taskManager.listTasks({
        creatorId: testUser1.id,
        priority: TaskPriority.HIGH
      });

      expect(result.tasks).to.have.lengthOf(1);
      expect(result.tasks[0].priority).to.equal(TaskPriority.HIGH);
      expect(result.tasks[0].creatorId).to.equal(testUser1.id);
    });

    it('should get tasks for specific user', async () => {
      const userTasks = await taskManager.getUserTasks(testUser1.id);

      expect(userTasks.created).to.have.lengthOf(2); // Tasks created by user1
      expect(userTasks.assigned).to.have.lengthOf(0); // Tasks assigned to user1
    });
  });

  describe('Task Deletion', () => {
    let testTask: any;

    beforeEach(async () => {
      testTask = await taskManager.createTask({
        title: 'Deletion Test Task',
        description: 'Task for testing deletion',
        creatorId: testUser1.id,
        tags: []
      });
    });

    it('should allow creator to delete task', async () => {
      await taskManager.deleteTask(testTask.id, testUser1.id);
      
      try {
        await taskManager.getTaskDetails(testTask.id);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.be.instanceOf(TaskManagerError);
      }
    });

    it('should not allow non-creators to delete task', async () => {
      try {
        await taskManager.deleteTask(testTask.id, testUser2.id);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.be.instanceOf(TaskManagerError);
      }
    });
  });
});