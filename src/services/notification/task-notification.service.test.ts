import { expect } from 'chai';
import sinon from 'sinon';
import { TaskNotificationService } from './task-notification.service.js';
import { DiscordService } from '../discord-service.js';
import { TaskWithRelations, TaskStatus, TaskPriority, User } from '../../types/task.js';

describe('TaskNotificationService', () => {
  let notificationService: TaskNotificationService;
  let discordServiceStub: sinon.SinonStubbedInstance<DiscordService>;

  beforeEach(() => {
    discordServiceStub = sinon.createStubInstance(DiscordService);
    (TaskNotificationService as any).instance = null;
    notificationService = TaskNotificationService.getInstance();
    (notificationService as any).discordService = discordServiceStub;
  });

  afterEach(() => {
    sinon.restore();
  });

  const mockUser: User = {
    id: 'user1',
    username: 'testuser',
    createdAt: new Date(),
    updatedAt: new Date(),
    isActive: true,
    preferences: {
      discordChannelId: 'channel123'
    }
  };

  const mockTask: TaskWithRelations = {
    id: 1,
    title: 'Test Task',
    description: 'Test Description',
    status: TaskStatus.OPEN,
    priority: TaskPriority.MEDIUM,
    createdAt: new Date(),
    updatedAt: new Date(),
    dueDate: new Date(),
    creatorId: mockUser.id,
    creator: mockUser,
    assignee: mockUser,
    tags: [],
    subTasks: [],
    history: []
  };

  describe('notifyTaskSpawned', () => {
    it('should send notification when task is spawned', async () => {
      await notificationService.notifyTaskSpawned(mockTask);

      expect(discordServiceStub.sendMessage.calledOnce).to.be.true;
      const message = discordServiceStub.sendMessage.firstCall.args[1];
      expect(message).to.include('New recurring task instance created');
      expect(message).to.include(mockTask.title);
    });

    it('should not send notification when assignee is missing', async () => {
      const taskWithoutAssignee = { ...mockTask, assignee: undefined };
      await notificationService.notifyTaskSpawned(taskWithoutAssignee);

      expect(discordServiceStub.sendMessage.called).to.be.false;
    });
  });

  describe('notifyTaskDueSoon', () => {
    it('should send notification about approaching due date', async () => {
      const daysUntilDue = 2;
      await notificationService.notifyTaskDueSoon(mockTask, daysUntilDue);

      expect(discordServiceStub.sendMessage.calledOnce).to.be.true;
      const message = discordServiceStub.sendMessage.firstCall.args[1];
      expect(message).to.include(`Task due in ${daysUntilDue} days`);
      expect(message).to.include(mockTask.title);
    });

    it('should handle singular day correctly', async () => {
      await notificationService.notifyTaskDueSoon(mockTask, 1);

      expect(discordServiceStub.sendMessage.calledOnce).to.be.true;
      const message = discordServiceStub.sendMessage.firstCall.args[1];
      expect(message).to.include('Task due in 1 day');
    });

    it('should not send notification when task has no due date', async () => {
      const taskWithoutDueDate = { ...mockTask, dueDate: undefined };
      await notificationService.notifyTaskDueSoon(taskWithoutDueDate, 1);

      expect(discordServiceStub.sendMessage.called).to.be.false;
    });
  });

  describe('notifyTaskCompleted', () => {
    it('should notify creator and assignee when task is completed', async () => {
      const completedBy = { 
        ...mockUser, 
        id: 'user2', 
        username: 'completer' 
      };

      const taskWithDifferentUsers = {
        ...mockTask,
        creatorId: 'user1',
        creator: mockUser,
        assignee: { 
          ...mockUser, 
          id: 'user3', 
          username: 'assignee',
          preferences: { discordChannelId: 'channel456' }
        }
      };

      await notificationService.notifyTaskCompleted(taskWithDifferentUsers, completedBy);

      expect(discordServiceStub.sendMessage.calledTwice).to.be.true;
      
      const creatorMessage = discordServiceStub.sendMessage.firstCall.args[1];
      expect(creatorMessage).to.include('Task completed');
      expect(creatorMessage).to.include(completedBy.username);
      expect(discordServiceStub.sendMessage.firstCall.args[0]).to.equal('channel123');

      const assigneeMessage = discordServiceStub.sendMessage.secondCall.args[1];
      expect(assigneeMessage).to.include('Task completed');
      expect(assigneeMessage).to.include(completedBy.username);
      expect(discordServiceStub.sendMessage.secondCall.args[0]).to.equal('channel456');
    });

    it('should send only one notification when creator and assignee are the same', async () => {
      await notificationService.notifyTaskCompleted(mockTask, mockUser);

      expect(discordServiceStub.sendMessage.calledOnce).to.be.true;
    });

    it('should handle missing Discord channel gracefully', async () => {
      const userWithoutDiscord = { ...mockUser, preferences: {} };
      const taskWithoutDiscord = { ...mockTask, creator: userWithoutDiscord };
      
      await notificationService.notifyTaskCompleted(taskWithoutDiscord, mockUser);
      
      expect(discordServiceStub.sendMessage.called).to.be.false;
    });
  });
});
