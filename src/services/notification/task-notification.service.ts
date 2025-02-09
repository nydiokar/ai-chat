import { TaskStatus, TaskWithRelations } from '../../types/task.js';
import { NotificationService } from './notification.service.js';
import { PrismaClient } from '@prisma/client';

/**
 * TaskNotificationService handles task-specific notifications
 * Determines what notifications to send for task-related events
 * Uses the core NotificationService for actual message delivery
 */
export class TaskNotificationService {
  private static instance: TaskNotificationService;
  private notificationService: NotificationService;
  private prisma: PrismaClient;

  private constructor() {
    this.notificationService = NotificationService.getInstance();
    this.prisma = new PrismaClient();
  }

  static getInstance(): TaskNotificationService {
    if (!TaskNotificationService.instance) {
      TaskNotificationService.instance = new TaskNotificationService();
    }
    return TaskNotificationService.instance;
  }

  /**
   * Sends a notification when a new task instance is spawned
   */
  async notifyTaskSpawned(task: TaskWithRelations): Promise<void> {
    if (!task.assigneeId) return;

    const message = `🔄 New recurring task instance created:
Title: ${task.title}
Due: ${task.dueDate?.toLocaleDateString() ?? 'Not set'}
Description: ${task.description}`;

    await this.notificationService.sendNotification(task.assigneeId, message);
  }

  /**
   * Sends a notification when a task is approaching its due date
   */
  async notifyTaskDueSoon(task: TaskWithRelations, daysUntilDue: number): Promise<void> {
    if (!task.assigneeId || !task.dueDate) return;

    const message = `⚠️ Task due in ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''}:
Title: ${task.title}
Due: ${task.dueDate.toLocaleDateString()}
Description: ${task.description}`;

    await this.notificationService.sendNotification(task.assigneeId, message);
  }

  /**
   * Sends a notification when a task is completed
   */
  async notifyTaskCompleted(task: TaskWithRelations): Promise<void> {
    if (!task.creatorId) return;

    const message = `✅ Task completed:
Title: ${task.title}
Completion time: ${new Date().toLocaleString()}`;

    // Notify both creator and assignee (if different)
    await this.notificationService.sendNotification(task.creatorId, message);
    if (task.assigneeId && task.assigneeId !== task.creatorId) {
      await this.notificationService.sendNotification(task.assigneeId, message);
    }

    // Notify users affected by task completion
    await this.notifyDependentTasks(task);
  }

  /**
   * Notifies users when their tasks are blocked or unblocked by dependency changes
   */
  async notifyDependencyStatusChange(task: TaskWithRelations, statusChanged: boolean): Promise<void> {
    // Get all tasks blocked by this one
    const blockedTasks = task.blocking || [];
    for (const dependency of blockedTasks) {
      const blockedTask = await this.prisma.task.findUnique({
        where: { id: dependency.blockedTaskId }
      });

      if (!blockedTask?.assigneeId) continue;

      const message = statusChanged 
        ? `🔓 Task "${task.title}" has been completed, unblocking your task #${dependency.blockedTaskId}`
        : `🔒 Task "${task.title}" is blocking your task #${dependency.blockedTaskId}`;

      await this.notificationService.sendNotification(blockedTask.assigneeId, message);

      if (dependency.dependencyType === 'PARALLEL') {
        // For parallel tasks, notify that they can work simultaneously
        await this.notificationService.sendNotification(
          blockedTask.assigneeId,
          `ℹ️ Task #${dependency.blockedTaskId} can be worked on in parallel with "${task.title}"`
        );
      }
    }
  }

  /**
   * Notifies users of tasks that are affected by a completed task
   */
  private async notifyDependentTasks(task: TaskWithRelations): Promise<void> {
    const blockedTasks = task.blocking || [];
    
    for (const dependency of blockedTasks) {
      let message = '';
      switch (dependency.dependencyType) {
        case 'BLOCKS':
          message = `🔓 Blocking task "${task.title}" has been completed. You can proceed with task #${dependency.blockedTaskId}`;
          break;
        case 'SEQUENTIAL':
          message = `⏩ Previous task "${task.title}" completed. Task #${dependency.blockedTaskId} is next in sequence`;
          break;
        case 'PARALLEL':
          message = `🔄 Related parallel task "${task.title}" has been completed`;
          break;
        case 'REQUIRED':
          message = `✔️ Required task "${task.title}" has been completed`;
          break;
      }

      if (message) {
        const blockedTask = await this.prisma.task.findUnique({
          where: { id: dependency.blockedTaskId }
        });

        if (blockedTask?.assigneeId) {
          await this.notificationService.sendNotification(blockedTask.assigneeId, message);
        }
      }
    }
  }

  /**
   * Tracks and notifies about task dependency health issues
   */
  async notifyHealthIssues(task: TaskWithRelations): Promise<void> {
    if (!task.assigneeId) return;

    // Check for approaching deadlines in dependent tasks
    const blockedTasks = task.blocking || [];
    for (const dependency of blockedTasks) {
      const blockedTask = await this.prisma.task.findUnique({
        where: { id: dependency.blockedTaskId }
      });

      if (blockedTask?.dueDate && blockedTask.assigneeId) {
        const daysUntilDue = Math.ceil((blockedTask.dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        
        if (daysUntilDue < 3 && task.status !== TaskStatus.COMPLETED) {
          const message = `⚠️ Task "${blockedTask.title}" is blocked and due in ${daysUntilDue} days`;
          await this.notificationService.sendNotification(blockedTask.assigneeId, message);
        }
      }
    }

    // Check for long-running blocked tasks
    if (task.status === TaskStatus.BLOCKED) {
      const blockedByTasks = task.blockedBy || [];
      for (const dependency of blockedByTasks) {
        if (dependency.dependencyType === 'BLOCKS') {
          const daysBlocked = Math.ceil((Date.now() - task.updatedAt.getTime()) / (1000 * 60 * 60 * 24));
          
          const blockerTask = await this.prisma.task.findUnique({
            where: { id: dependency.blockerTaskId }
          });
          
          if (daysBlocked > 7) {
            await this.notificationService.sendNotification(
              task.assigneeId,
              `🚫 Task has been blocked for ${daysBlocked} days by "${blockerTask?.title}"`
            );
          }
        }
      }
    }
  }

  /**
   * Analyzes and notifies about the impact of task status changes
   */
  async notifyImpactAnalysis(task: TaskWithRelations): Promise<void> {
    if (!task.assigneeId || !task.creatorId) return;

    const impactAnalysis = {
      blockedTasksCount: 0,
      criticalPathDelay: 0,
      affectedUsers: new Set<string>()
    };

    // Analyze impact on blocked tasks
    const blockedTasks = task.blocking || [];
    for (const dependency of blockedTasks) {
      impactAnalysis.blockedTasksCount++;
      
      const blockedTask = await this.prisma.task.findUnique({
        where: { id: dependency.blockedTaskId }
      });

      if (blockedTask?.assigneeId) {
        impactAnalysis.affectedUsers.add(blockedTask.assigneeId);
      }

      // Calculate potential delays based on dependency type
      if (dependency.dependencyType === 'BLOCKS' || dependency.dependencyType === 'SEQUENTIAL') {
        const potentialDelay = Math.ceil((Date.now() - task.updatedAt.getTime()) / (1000 * 60 * 60 * 24));
        impactAnalysis.criticalPathDelay = Math.max(impactAnalysis.criticalPathDelay, potentialDelay);
      }
    }

    // Generate and send impact report if there are affected tasks
    if (impactAnalysis.blockedTasksCount > 0) {
      const message = `📊 Impact Analysis for "${task.title}":
- Blocked Tasks: ${impactAnalysis.blockedTasksCount}
- Affected Users: ${impactAnalysis.affectedUsers.size}${impactAnalysis.criticalPathDelay > 0 ? `\n- Potential Critical Path Delay: ${impactAnalysis.criticalPathDelay} days` : ''}`;

      // Send to creator and assignee
      await this.notificationService.sendNotification(task.creatorId, message);
      if (task.assigneeId !== task.creatorId) {
        await this.notificationService.sendNotification(task.assigneeId, message);
      }
    }
  }

  // Clean up Prisma when the service is no longer needed
  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
