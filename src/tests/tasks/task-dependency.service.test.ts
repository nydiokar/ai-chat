import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { PrismaClient } from '@prisma/client';
import { TaskDependencyService } from '../../tasks/task-dependency.service.js';
import { DependencyType, TaskPriority, TaskStatus } from '../../types/task.js';

describe('TaskDependencyService', () => {
  let prisma: PrismaClient;
  let taskDependencyService: TaskDependencyService;
  let testTask1: any;
  let testTask2: any;
  let testUser: any;

  beforeEach(async () => {
    prisma = new PrismaClient();
    taskDependencyService = new TaskDependencyService(prisma);

    // First create a test user
    testUser = await prisma.user.create({
      data: {
        id: 'test-user',
        username: 'Test User',
        isActive: true
      }
    });

    // Then create test tasks with valid user reference
    testTask1 = await prisma.task.create({
      data: {
        title: 'Test Task 1',
        description: 'Test Description 1',
        status: TaskStatus.OPEN,
        priority: TaskPriority.MEDIUM,
        creatorId: testUser.id,
        tags: {},
        metadata: {},
      }
    });

    testTask2 = await prisma.task.create({
      data: {
        title: 'Test Task 2',
        description: 'Test Description 2',
        status: TaskStatus.OPEN,
        priority: TaskPriority.MEDIUM,
        creatorId: testUser.id,
        tags: {},
        metadata: {},
      }
    });
  });

  afterEach(async () => {
    // Clean up test data in correct order due to foreign key constraints
    await prisma.taskHistory.deleteMany();
    await prisma.taskDependency.deleteMany();
    await prisma.task.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  describe('addDependency', () => {
    it('should successfully create a dependency between tasks', async () => {
      const dependency = await taskDependencyService.addDependency(
        testTask1.id,
        testTask2.id,
        testUser.id,
        DependencyType.BLOCKS
      );

      expect(dependency).to.exist;
      expect(dependency.blockedTaskId).to.equal(testTask1.id);
      expect(dependency.blockerTaskId).to.equal(testTask2.id);
      expect(dependency.dependencyType).to.equal(DependencyType.BLOCKS);
    });

    it('should automatically set blocked status on dependent task', async () => {
      await taskDependencyService.addDependency(
        testTask1.id,
        testTask2.id,
        testUser.id,
        DependencyType.BLOCKS
      );

      const updatedTask = await prisma.task.findUnique({
        where: { id: testTask1.id }
      });

      expect(updatedTask?.status).to.equal(TaskStatus.BLOCKED);
    });

    it('should prevent circular dependencies', async () => {
      await taskDependencyService.addDependency(
        testTask1.id,
        testTask2.id,
        testUser.id,
        DependencyType.BLOCKS
      );

      try {
        await taskDependencyService.addDependency(
          testTask2.id,
          testTask1.id,
          testUser.id,
          DependencyType.BLOCKS
        );
        expect.fail('Should have thrown circular dependency error');
      } catch (error: any) {
        expect(error.message).to.include('circular dependency');
      }
    });
  });

  describe('removeDependency', () => {
    it('should successfully remove a dependency', async () => {
      // First create a dependency
      await taskDependencyService.addDependency(
        testTask1.id,
        testTask2.id,
        testUser.id,
        DependencyType.BLOCKS
      );

      // Then remove it
      await taskDependencyService.removeDependency(testTask1.id, testTask2.id, testUser.id);

      // Verify it's gone
      const dependencies = await taskDependencyService.getDependencies(testTask1.id);
      expect(dependencies.blockedBy).to.have.length(0);
    });

    it('should update task status when last blocker is removed', async () => {
      // Add dependency
      await taskDependencyService.addDependency(
        testTask1.id,
        testTask2.id,
        testUser.id,
        DependencyType.BLOCKS
      );

      // Remove dependency
      await taskDependencyService.removeDependency(testTask1.id, testTask2.id, testUser.id);

      // Check task status
      const task = await prisma.task.findUnique({
        where: { id: testTask1.id }
      });

      expect(task?.status).to.equal(TaskStatus.OPEN);
    });
  });

  describe('propagateStatusUpdate', () => {
    it('should unblock dependent tasks when blocker is completed', async () => {
      // Create dependency
      await taskDependencyService.addDependency(
        testTask2.id,
        testTask1.id,
        testUser.id,
        DependencyType.BLOCKS
      );

      // Complete blocker task
      await prisma.task.update({
        where: { id: testTask2.id },
        data: { status: TaskStatus.COMPLETED }
      });

      // Propagate the status update
      await taskDependencyService.propagateStatusUpdate(testTask2.id);

      // Check blocked task status
      const task = await prisma.task.findUnique({
        where: { id: testTask1.id }
      });

      expect(task?.status).to.equal(TaskStatus.OPEN);
    });

    it('should handle sequential task dependencies correctly', async () => {
      const task3 = await prisma.task.create({
        data: {
          title: 'Test Task 3',
          description: 'Test Description 3',
          status: TaskStatus.OPEN,
          priority: TaskPriority.MEDIUM,
          creatorId: testUser.id,
          tags: {},
          metadata: {},
        }
      });

      // Create sequential dependencies: task1 -> task2 -> task3
      await taskDependencyService.addDependency(
        testTask2.id,
        testTask1.id,
        testUser.id,
        DependencyType.SEQUENTIAL
      );
      await taskDependencyService.addDependency(
        task3.id,
        testTask2.id,
        testUser.id,
        DependencyType.SEQUENTIAL
      );

      // Validate sequential order
      let canStart = await taskDependencyService.validateSequentialOrder(task3.id);
      expect(canStart).to.be.false;

      // Complete first task
      await prisma.task.update({
        where: { id: testTask1.id },
        data: { status: TaskStatus.COMPLETED }
      });
      await taskDependencyService.propagateStatusUpdate(testTask1.id);

      // Second task should still be blocked by sequential order
      let status = await taskDependencyService.canStartTask(task3.id);
      expect(status.canStart).to.be.false;
      expect(status.blockedBy).to.have.lengthOf(1);

      // Complete second task
      await prisma.task.update({
        where: { id: testTask2.id },
        data: { status: TaskStatus.COMPLETED }
      });
      await taskDependencyService.propagateStatusUpdate(testTask2.id);

      // Now third task should be able to start
      canStart = await taskDependencyService.validateSequentialOrder(task3.id);
      expect(canStart).to.be.true;
    });

    it('should handle parallel task dependencies correctly', async () => {
      const task3 = await prisma.task.create({
        data: {
          title: 'Test Task 3',
          description: 'Test Description 3',
          status: TaskStatus.OPEN,
          priority: TaskPriority.MEDIUM,
          creatorId: testUser.id,
          tags: {},
          metadata: {},
        }
      });

      // Create parallel dependencies: task3 depends on task1 and task2 in parallel
      await taskDependencyService.addDependency(
        task3.id,
        testTask1.id,
        testUser.id,
        DependencyType.PARALLEL
      );
      await taskDependencyService.addDependency(
        task3.id,
        testTask2.id,
        testUser.id,
        DependencyType.PARALLEL
      );

      // Initially task3 should be blocked but can be worked on in parallel with others
      let status = await taskDependencyService.canStartTask(task3.id);
      expect(status.canStart).to.be.true; // Can start because it's parallel

      // Complete first dependency
      await prisma.task.update({
        where: { id: testTask1.id },
        data: { status: TaskStatus.COMPLETED }
      });
      await taskDependencyService.propagateStatusUpdate(testTask1.id);

      // Task should still be in progress since one parallel task is still incomplete
      const task = await prisma.task.findUnique({
        where: { id: task3.id }
      });
      expect(task?.status).not.to.equal(TaskStatus.BLOCKED);
    });
  });

  describe('canStartTask', () => {
    it('should correctly identify when a task can start based on dependency type', async () => {
      // Create tasks with different dependency types
      const sequential = await prisma.task.create({
        data: {
          title: 'Sequential Task',
          description: 'Must be done in sequence',
          status: TaskStatus.OPEN,
          priority: TaskPriority.MEDIUM,
          creatorId: testUser.id,
          tags: {},
          metadata: {},
        }
      });

      const parallel = await prisma.task.create({
        data: {
          title: 'Parallel Task',
          description: 'Can be done in parallel',
          status: TaskStatus.OPEN,
          priority: TaskPriority.MEDIUM,
          creatorId: testUser.id,
          tags: {},
          metadata: {},
        }
      });

      // Add dependencies
      await taskDependencyService.addDependency(
        sequential.id,
        testTask1.id,
        testUser.id,
        DependencyType.SEQUENTIAL
      );

      await taskDependencyService.addDependency(
        parallel.id,
        testTask2.id,
        testUser.id,
        DependencyType.PARALLEL
      );

      // Check sequential task
      let sequentialStatus = await taskDependencyService.canStartTask(sequential.id);
      expect(sequentialStatus.canStart).to.be.false;
      expect(sequentialStatus.blockedBy).to.have.lengthOf(1);

      // Check parallel task
      let parallelStatus = await taskDependencyService.canStartTask(parallel.id);
      expect(parallelStatus.canStart).to.be.true;
      expect(parallelStatus.blockedBy).to.have.lengthOf(0);
    });
  });
});
