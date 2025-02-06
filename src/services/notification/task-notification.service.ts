import { TaskWithRelations, User } from '../../types/task.js';
import { DiscordService } from '../discord-service.js';

/**
 * TaskNotificationService handles notifications for task-related events
 * 
 * Supports multiple notification channels:
 * - Discord notifications (current implementation)
 * - Future extensibility for email, SMS, etc.
 */
export class TaskNotificationService {
  private static instance: TaskNotificationService;
  private discordService: DiscordService;

  private constructor() {
    this.discordService = DiscordService.getInstance();
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
    if (!task.assignee) return;

    const message = `🔄 New recurring task instance created:
Title: ${task.title}
Due: ${task.dueDate?.toLocaleDateString() ?? 'Not set'}
Description: ${task.description}`;

    await this.sendNotification(task.assignee, message);
  }

  /**
   * Sends a notification when a task is approaching its due date
   */
  async notifyTaskDueSoon(task: TaskWithRelations, daysUntilDue: number): Promise<void> {
    if (!task.assignee || !task.dueDate) return;

    const message = `⚠️ Task due in ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''}:
Title: ${task.title}
Due: ${task.dueDate.toLocaleDateString()}
Description: ${task.description}`;

    await this.sendNotification(task.assignee, message);
  }

  /**
   * Sends a notification when a task is completed
   */
  async notifyTaskCompleted(task: TaskWithRelations, completedBy: User): Promise<void> {
    if (!task.creator) return;

    const message = `✅ Task completed:
Title: ${task.title}
Completed by: ${completedBy.username}
Completion time: ${new Date().toLocaleString()}`;

    // Notify both creator and assignee (if different)
    await this.sendNotification(task.creator, message);
    if (task.assignee && task.assignee.id !== task.creator.id) {
      await this.sendNotification(task.assignee, message);
    }
  }

  /**
   * Sends a notification through available channels
   */
  private async sendNotification(user: User, message: string): Promise<void> {
    try {
      // Get user's notification preferences
      const discordChannelId = user.preferences?.discordChannelId;
      
      if (discordChannelId) {
        await this.discordService.sendMessage(discordChannelId, message);
      }
    } catch (error) {
      console.error('Failed to send notification:', error);
    }

  }
}
