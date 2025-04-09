import { expect } from 'chai';
import sinon from 'sinon';
import { TaskNotificationService } from '../../features/tasks/task-notification.service.js';
import { NotificationService } from '../../services/notification.service.js';
import { TaskWithRelations, TaskStatus, TaskPriority, DependencyType } from '../../types/task.js';
import { PrismaClient } from '@prisma/client';

describe('TaskNotificationService', () => {
  let notificationService: TaskNotificationService;
  let notificationServiceStub: sinon.SinonStubbedInstance<NotificationService>;
  let prismaStub: sinon.SinonStubbedInstance<PrismaClient>;

  beforeEach(() => {
    notificationServiceStub = sinon.createStubInstance(NotificationService);
    const findUniqueTaskStub = sinon.stub();
    const disconnectStub = sinon.stub().resolves();

    prismaStub = {
      task: {
        findUnique: findUniqueTaskStub,
      },
      $disconnect: disconnectStub,
    } as any;

    findUniqueTaskStub.resolves(null);

    (TaskNotificationService as any).instance = null;
    notificationService = TaskNotificationService.getInstance();
    (notificationService as any).notificationService = notificationServiceStub;
    (notificationService as any).prisma = prismaStub;
  });

  afterEach(() => {
    sinon.restore();
  });

  const mockTask: TaskWithRelations = {
    id: 1,
    title: 'Test Task',
    description: 'Test Description',
    status: TaskStatus.OPEN,
    priority: TaskPriority.MEDIUM,
    createdAt: new Date(),
    updatedAt: new Date(),
    dueDate: new Date(),
    creatorId: 'user1',
    creator: {
      id: 'user1',
      username: 'testuser',
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true
    },
    assigneeId: 'user1',
    assignee: {
      id: 'user1',
      username: 'testuser',
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true
    },
    tags: {},
    subTasks: [],
    history: [],
    blockedBy: [],
    blocking: []
  };

  describe('notifyTaskSpawned', () => {
    it('should send notification when task is spawned', async () => {
      await notificationService.notifyTaskSpawned(mockTask);
      expect(notificationServiceStub.sendNotification.calledOnce).to.be.true;
      const message = notificationServiceStub.sendNotification.firstCall.args[1];
      expect(message).to.include('New recurring task instance created');
      expect(message).to.include(mockTask.title);
    });
  });

  describe('notifyDependencyStatusChange', () => {
    it('should notify about unblocked tasks when task is completed', async () => {
      const blockedTask = {
        ...mockTask,
        id: 2,
        assigneeId: 'user2'
      };

      (prismaStub.task.findUnique as sinon.SinonStub).resolves(blockedTask);

      const taskWithDependencies = {
        ...mockTask,
        blocking: [{
          id: 1,
          blockedTaskId: 2,
          blockerTaskId: 1,
          dependencyType: DependencyType.BLOCKS,
          createdAt: new Date(),
          updatedAt: new Date()
        }]
      };

      await notificationService.notifyDependencyStatusChange(taskWithDependencies, true);

      expect(notificationServiceStub.sendNotification.calledOnce).to.be.true;
      const message = notificationServiceStub.sendNotification.firstCall.args[1];
      expect(message).to.include('unblocking your task');
    });

    it('should notify about parallel tasks', async () => {
      const blockedTask = {
        ...mockTask,
        id: 2,
        assigneeId: 'user2'
      };

      (prismaStub.task.findUnique as sinon.SinonStub).resolves(blockedTask);

      const taskWithParallel = {
        ...mockTask,
        blocking: [{
          id: 1,
          blockedTaskId: 2,
          blockerTaskId: 1,
          dependencyType: DependencyType.PARALLEL,
          createdAt: new Date(),
          updatedAt: new Date()
        }]
      };

      await notificationService.notifyDependencyStatusChange(taskWithParallel, false);

      expect(notificationServiceStub.sendNotification.calledTwice).to.be.true;
      const message = notificationServiceStub.sendNotification.secondCall.args[1];
      expect(message).to.include('can be worked on in parallel');
    });
  });

  describe('notifyHealthIssues', () => {
    it('should identify and notify about approaching deadlines', async () => {
      const blockedTask = {
        ...mockTask,
        id: 2,
        dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
        assigneeId: 'user2'
      };

      (prismaStub.task.findUnique as sinon.SinonStub).resolves(blockedTask);

      const taskWithBlocking = {
        ...mockTask,
        status: TaskStatus.OPEN,
        blocking: [{
          id: 1,
          blockedTaskId: 2,
          blockerTaskId: 1,
          dependencyType: DependencyType.BLOCKS,
          createdAt: new Date(),
          updatedAt: new Date()
        }]
      };

      await notificationService.notifyHealthIssues(taskWithBlocking);

      expect(notificationServiceStub.sendNotification.calledOnce).to.be.true;
      const message = notificationServiceStub.sendNotification.firstCall.args[1];
      expect(message).to.include('blocked and due in 2 days');
    });

    it('should identify and notify about long-running blocked tasks', async () => {
      const oneWeekAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      const blockerTask = { ...mockTask, title: 'Blocker Task' };
      
      const taskToCheck = {
        ...mockTask,
        status: TaskStatus.BLOCKED,
        updatedAt: oneWeekAgo,
        blockedBy: [{
          id: 1,
          blockedTaskId: 1,
          blockerTaskId: 2,
          dependencyType: DependencyType.BLOCKS,
          createdAt: new Date(),
          updatedAt: new Date()
        }]
      };

      (prismaStub.task.findUnique as sinon.SinonStub).resolves(blockerTask);

      await notificationService.notifyHealthIssues(taskToCheck);

      expect(notificationServiceStub.sendNotification.calledOnce).to.be.true;
      const message = notificationServiceStub.sendNotification.firstCall.args[1];
      expect(message).to.include('has been blocked for 8 days');
    });
  });

  describe('notifyImpactAnalysis', () => {
    it('should analyze and notify about task impact', async () => {
      const blockedTask = {
        ...mockTask,
        id: 2,
        assigneeId: 'user2'
      };

      (prismaStub.task.findUnique as sinon.SinonStub)
        .withArgs(sinon.match({ where: { id: 2 } }))
        .resolves(blockedTask);

      const taskWithDependencies = {
        ...mockTask,
        blocking: [{
          id: 1,
          blockedTaskId: 2,
          blockerTaskId: 1,
          dependencyType: DependencyType.BLOCKS,
          createdAt: new Date(),
          updatedAt: new Date()
        }]
      };

      await notificationService.notifyImpactAnalysis(taskWithDependencies);

      expect(notificationServiceStub.sendNotification.calledOnce).to.be.true;
      const message = notificationServiceStub.sendNotification.firstCall.args[1];
      expect(message).to.include('Impact Analysis');
      expect(message).to.include('Blocked Tasks: 1');
      expect(message).to.include('Affected Users: 1');
    });
  });

  describe('cleanup', () => {
    it('should disconnect from Prisma when cleaned up', async () => {
      await notificationService.cleanup();
      expect(prismaStub.$disconnect.calledOnce).to.be.true;
    });
  });
});
