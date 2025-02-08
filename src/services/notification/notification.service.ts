import { DiscordService } from '../discord-service.js';
import { PrismaClient } from '@prisma/client';

export interface NotificationChannel {
  type: string;
  id: string;
}

/**
 * Core notification service that handles sending notifications through various channels
 * based on user preferences stored in memory
 */
export class NotificationService {
  private static instance: NotificationService;
  private discordService: DiscordService;
  private prisma: PrismaClient;

  private constructor() {
    this.discordService = DiscordService.getInstance();
    this.prisma = new PrismaClient();
  }

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Gets user's notification preferences from memory system
   */
  private async getUserMemoryPreferences(userId: string): Promise<{ settings: any } | null> {
    const prefs = await this.prisma.userMemoryPreferences.findUnique({
      where: { userId }
    });
    return prefs;
  }

  /**
   * Sends a notification to a user through their preferred channels
   */
  async sendNotification(userId: string, message: string): Promise<void> {
    try {
      const memoryPrefs = await this.getUserMemoryPreferences(userId);
      
      // Check memory preferences first
      if (memoryPrefs?.settings?.notifications) {
        const notifSettings = memoryPrefs.settings.notifications;
        
        // Send through Discord if configured in memory preferences
        if (notifSettings.discord?.enabled && notifSettings.discord.channelId) {
          await this.discordService.sendMessage(notifSettings.discord.channelId, message);
          return;
        }
      }

      // Fallback to user preferences if no memory preferences are set
      const user = await this.prisma.user.findUnique({
        where: { id: userId }
      });

      // Check legacy user preferences
      if (user?.preferences && typeof user.preferences === 'object') {
        const prefs = user.preferences as any;
        if (prefs.discordChannelId) {
          await this.discordService.sendMessage(prefs.discordChannelId, message);
        }
      }

      // Future: Add other notification channels (SMS, email, etc.)
      
    } catch (error) {
      console.error('Failed to send notification:', error);
    }
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
