import { Client, Events, GatewayIntentBits, Message as DiscordMessage, Partials, TextChannel, Message } from 'discord.js';
import { DatabaseService } from './db-service.js';
import { AIModel, DiscordMessageContext } from '../types/index.js';
import { AIService } from './ai/base-service.js';
import { AIServiceFactory } from './ai-service-factory.js';
import { TaskManager } from '../tasks/task-manager.js';
import { CommandParserService, CommandParserError } from '../utils/command-parser-service.js';
import { PerformanceMonitoringService } from './performance-monitoring.service.js';

import { debug, defaultConfig } from '../utils/config.js';
import { MCPError } from '../types/errors.js';

export class DiscordService {
  private client: Client;
  private db: DatabaseService;
  private static instance: DiscordService;
  private aiServices: Map<string, AIService> = new Map();
  private readonly maxContextMessages = 10;
  private readonly contextRefreshInterval = 30 * 60 * 1000;
  private contextSummaryTasks: Map<string, NodeJS.Timeout> = new Map();

  private constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this.db = DatabaseService.getInstance();
    this.setupEventHandlers();
  }

  public getClient(): Client {
    return this.client;
  }

  static getInstance(): DiscordService {
    if (!DiscordService.instance) {
      DiscordService.instance = new DiscordService();
    }
    return DiscordService.instance;
  }

private async handleTaskCommand(message: DiscordMessage, command: { action: string; parameters: any }) {
    const taskManager = TaskManager.getInstance();
    const performanceMonitoring = PerformanceMonitoringService.getInstance();

    try {
      switch (command.action) {
        case 'create': {
          const task = await taskManager.createTask({
            title: command.parameters.title,
            description: command.parameters.description,
            creatorId: message.author.id,
            tags: [],
          });
          await this.sendMessage(message.channel as TextChannel, 
            `✅ Task #${task.id} created: ${task.title}`, 
            message
          );
          break;
        }
        
        case 'stats': {
          const metrics = await performanceMonitoring.generatePerformanceDashboard();
          const taskMetrics = metrics.taskMetrics;

          let response = '```\nTask Performance Metrics:\n\n';
          
          // Overall stats
          response += `📊 Total Tasks: ${taskMetrics.totalTasks}\n`;
          response += `✅ Completion Rate: ${(taskMetrics.completionRate * 100).toFixed(1)}%\n`;
          response += `⏱️ Avg Completion Time: ${(taskMetrics.averageCompletionTime / (1000 * 60 * 60)).toFixed(1)} hours\n`;
          
          // Status breakdown
          response += '\nStatus Breakdown:\n';
          Object.entries(taskMetrics.tasksPerStatus).forEach(([status, count]) => {
            response += `${this.getStatusEmoji(status)} ${status}: ${count}\n`;
          });

          // Priority breakdown
          response += '\nPriority Distribution:\n';
          Object.entries(taskMetrics.tasksByPriority).forEach(([priority, count]) => {
            response += `${this.getPriorityEmoji(priority)} ${priority}: ${count}\n`;
          });

          // Active and overdue
          response += `\n📈 Active Tasks: ${taskMetrics.activeTasksCount}\n`;
          response += `⚠️ Overdue Tasks: ${taskMetrics.overdueTasksCount}\n`;
          
          response += '```';
          await this.sendMessage(message.channel as TextChannel, response, message);
          break;
        }

        case 'list': {
          const tasks = await taskManager.getUserTasks(message.author.id);
          let response = '```\nYour Tasks:\n\n';
          
          if (tasks.created.length === 0 && tasks.assigned.length === 0) {
              response += '📝 No tasks found.\n';
          } else {
              if (tasks.created.length > 0) {
                  response += '✨ Created by you:\n';
                  tasks.created.forEach(task => {
                      const formatDate = (date: Date | string) => {
                          return new Date(date).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric'
                          });
                      };

                      response += `#\n${task.id}. ${task.title}
    📋 What to do: ${task.description || 'No description provided'}
    ${this.getStatusEmoji(task.status)} Since ${formatDate(task.createdAt)}\n`;
                  });
              }
              
              if (tasks.assigned.length > 0) {
                  response += '\n�� Assigned to you:\n';
                  tasks.assigned.forEach(task => {
                      const formatDate = (date: Date | string) => {
                          return new Date(date).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric'
                          });
                      };

                      response += `\n${task.id}. ${task.title}
    📋 What to do: "${task.description || 'No description provided'}"
    ${this.getStatusEmoji(task.status)} Status since ${formatDate(task.createdAt)}\n`;
                  });
              }
          }
          response += '```';
          await this.sendMessage(message.channel as TextChannel, response, message);
          break;
        }

        case 'view': {
          const task = await taskManager.getTaskDetails(command.parameters.id);
          const response = this.formatTaskDetails(task);
          await this.sendMessage(message.channel as TextChannel, response, message);
          break;
        }

        case 'update': {
          await taskManager.updateTaskStatus(command.parameters.id, command.parameters.status, message.author.id);
          await this.sendMessage(message.channel as TextChannel, 
            `✅ Task #${command.parameters.id} status updated to ${command.parameters.status}`, 
            message
          );
          break;
        }

        case 'assign': {
          await taskManager.assignTask(command.parameters.id, command.parameters.assigneeId, message.author.id);
          await this.sendMessage(message.channel as TextChannel, 
            `✅ Task #${command.parameters.id} assigned to <@${command.parameters.assigneeId}>`, 
            message
          );
          break;
        }

        case 'delete': {
          await taskManager.deleteTask(command.parameters.id, message.author.id);
          await this.sendMessage(message.channel as TextChannel, 
            `✅ Task #${command.parameters.id} deleted`, 
            message
          );
          break;
        }

        default:
          await this.sendMessage(message.channel as TextChannel, 
            '❌ Unknown command. Try: create, list, view, update, assign, or delete', 
            message
          );
      }
    } catch (error) {
      await this.sendMessage(message.channel as TextChannel, 
        `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        message
      );
    }
  }

  private formatTaskDetails(task: any): string {
    let response = `**Task #${task.id}**\n`;
    response += `📌 **Title:** ${task.title}\n`;
    response += `🔄 **Status:** ${task.status}\n`;
    response += `📝 **Description:** ${task.description}\n`;
    response += `👤 **Created by:** <@${task.creatorId}>\n`;
    response += `👥 **Assigned to:** ${task.assigneeId ? `<@${task.assigneeId}>` : 'Unassigned'}\n`;
    
    if (task.history && task.history.length > 0) {
      response += '\n📋 **Recent History:**\n';
      task.history.slice(-3).forEach((entry: any) => {
        const timestamp = new Date(entry.createdAt).toLocaleString();
        response += `• ${timestamp}: ${this.formatHistoryEntry(entry)}\n`;
      });
    }

    return response;
  }

  private formatHistoryEntry(entry: any): string {
    switch (entry.action) {
      case 'CREATED':
        return 'Task created';
      case 'STATUS_CHANGED':
        return `Status changed from ${entry.oldValue} to ${entry.newValue}`;
      case 'ASSIGNED':
        return `Assigned to <@${entry.newValue}>`;
      case 'UNASSIGNED':
        return 'Unassigned';
      default:
        return entry.action;
    }
  }

  private setupEventHandlers() {
    this.client.on(Events.ClientReady, () => {
      debug(`Logged in as ${this.client.user?.tag}`);
    });

    this.client.on(Events.MessageCreate, async (message: DiscordMessage) => {
      // Handle natural language task commands
      if (!message.author.bot && 
          (message.content.toLowerCase().includes('task') || 
           message.content.startsWith('!'))) {
        try {
          const command = CommandParserService.getInstance().parse(message.content);
          switch (command.command) {
            case 'task':
              await this.handleTaskCommand(message, command);
              return;
          }
        } catch (error) {
          if (error instanceof CommandParserError) {
            await this.sendMessage(message.channel as TextChannel, error.message, message);
            return;
          }
          // If not a command parser error, continue to AI handling
        }
      }

      try {
        // Ignore messages from bots and messages that don't mention the bot
        if (message.author.bot || !message.mentions.has(this.client.user!)) {
          return;
        }

        // Ensure we have the required fields
        if (!message.channelId || !message.guildId) {
          console.error('Missing required message properties');
          return;
        }

        const discordContext: DiscordMessageContext = {
          guildId: message.guildId,
          channelId: message.channelId,
          userId: message.author.id,
          username: message.author.username,
        };

        // Handle AI conversation logic...
        let session = await this.db.getActiveSession(discordContext.userId, discordContext.channelId);
        let conversationId: number;
        let isNewSession = false;

        if (!session) {
          isNewSession = true;
          conversationId = await this.db.createConversation(
            defaultConfig.defaultModel,
            'New Conversation',
            'Starting a new conversation',
            discordContext
          );
        } else {
          conversationId = session.conversationId;
          const contextKey = `${discordContext.guildId}-${discordContext.channelId}-${discordContext.userId}`;
          if (!this.contextSummaryTasks.has(contextKey)) {
            const task = setTimeout(() => this.summarizeAndRefreshContext(conversationId), this.contextRefreshInterval);
            this.contextSummaryTasks.set(contextKey, task);
          }
        }

        const content = message.content.replace(/<@!\d+>/g, '').trim();
        await this.db.addMessage(conversationId, content, 'user', undefined, discordContext);

        const conversation = await this.db.getConversation(conversationId);
        const serviceKey = `${conversation.model}-${discordContext.channelId}`;
        const contextMessages = this.prepareContextMessages(conversation.messages, isNewSession);
        
        let service = this.aiServices.get(serviceKey);
        if (!service) {
          service = AIServiceFactory.create(conversation.model as 'gpt' | 'claude' | 'deepseek' | 'ollama');
          this.aiServices.set(serviceKey, service);
        }

        const result = await service.generateResponse(content, contextMessages.map(msg => ({
          ...msg,
          role: msg.role as "user" | "system" | "assistant"
        })));

        await this.db.addMessage(conversationId, result.content, 'assistant', result.tokenCount);
        await this.sendMessage(message.channel as TextChannel, result.content, message);

      } catch (error) {
        console.error('Error handling Discord message:', error);
        const errorMessage = error instanceof MCPError 
          ? `Error: ${error.message}`
          : 'Sorry, I encountered an error processing your message.';
        await this.sendMessage(message.channel as TextChannel, errorMessage, message);
      }
    });

    this.client.on(Events.Error, (error) => {
      console.error('Discord client error:', error);
    });
  }

  private prepareContextMessages(messages: any[], isNewSession: boolean) {
    if (isNewSession) {
      return [
        {
          role: 'system',
          content: 'You are a helpful assistant. Maintain context of the conversation and provide relevant responses.'
        },
        ...messages
      ];
    }

    const recentMessages = messages.slice(-this.maxContextMessages);
    
    if (messages.length > this.maxContextMessages && messages[0].conversation?.summary) {
      return [
        {
          role: 'system',
          content: `Previous context: ${messages[0].conversation.summary}\n\nYou are a helpful assistant. Maintain context of the conversation.`
        },
        ...recentMessages
      ];
    }

    return recentMessages;
  }

  private async summarizeAndRefreshContext(conversationId: number) {
    try {
      const conversation = await this.db.getConversation(conversationId);
      if (!conversation || conversation.messages.length <= this.maxContextMessages) return;

      const service = AIServiceFactory.create(conversation.model as 'gpt' | 'claude' | 'deepseek' | 'ollama');
      const oldMessages = conversation.messages.slice(0, -this.maxContextMessages);
      const summary = await service.generateResponse(
        "Please provide a brief summary of this conversation context that can be used to maintain continuity in future messages. Focus on key points and important details.",
        oldMessages.map(msg => ({
          ...msg,
          role: msg.role as "user" | "system" | "assistant"
        }))
      );

      await this.db.updateConversationMetadata(conversationId, {
        summary: summary.content
      });
    } catch (error) {
      console.error('Error summarizing conversation context:', error);
    }
  }

  async start(token: string) {
    try {
      await this.client.login(token);
    } catch (error) {
      console.error('Failed to start Discord client:', error);
      throw error;
    }
  }

  async stop() {
    try {
      for (const task of this.contextSummaryTasks.values()) {
        clearTimeout(task);
      }
      this.contextSummaryTasks.clear();

      for (const service of this.aiServices.values()) {
        await service.cleanup();
      }
      this.aiServices.clear();

      await this.client.destroy();
    } catch (error) {
      console.error('Error stopping Discord client:', error);
      throw error;
    }
  }

  public async sendMessage(channel: TextChannel, content: string, reference?: Message): Promise<void> {
    const MAX_LENGTH = 1900;
    
    if (content.length <= MAX_LENGTH) {
      await channel.send({
        content,
        reply: reference ? { messageReference: reference.id } : undefined
      });
      return;
    }

    const parts = this.splitMessage(content);
    
    await channel.send({
      content: parts[0],
      reply: reference ? { messageReference: reference.id } : undefined
    });

    for (let i = 1; i < parts.length; i++) {
      await channel.send({ content: parts[i] });
    }
  }

  private splitMessage(content: string): string[] {
    const MAX_LENGTH = 1900;
    const parts: string[] = [];
    let currentPart = '';

    const paragraphs = content.split('\n');

    for (const paragraph of paragraphs) {
      if (currentPart.length + paragraph.length + 1 <= MAX_LENGTH) {
        currentPart += (currentPart ? '\n' : '') + paragraph;
      } else {
        if (currentPart) {
          parts.push(currentPart);
        }
        if (paragraph.length > MAX_LENGTH) {
          const words = paragraph.split(' ');
          currentPart = '';
          for (const word of words) {
            if (currentPart.length + word.length + 1 <= MAX_LENGTH) {
              currentPart += (currentPart ? ' ' : '') + word;
            } else {
              parts.push(currentPart);
              currentPart = word;
            }
          }
        } else {
          currentPart = paragraph;
        }
      }
    }

    if (currentPart) {
      parts.push(currentPart);
    }

    return parts;
  }

  private getStatusEmoji(status: string): string {
    switch (status.toUpperCase()) {
        case 'OPEN':
            return '🟢 OPEN';
        case 'IN_PROGRESS':
            return '🔵 IN PROGRESS';
        case 'BLOCKED':
            return '🔴 BLOCKED';
        case 'COMPLETED':
            return '✅ COMPLETED';
        case 'CLOSED':
            return '⭕ CLOSED';
        default:
            return '❓';
    }
  }

  private getPriorityEmoji(priority: string): string {
    switch (priority.toUpperCase()) {
        case 'URGENT':
            return '🔥';
        case 'HIGH':
            return '⚡';
        case 'MEDIUM':
            return '⚪';
        case 'LOW':
            return '⚫';
        default:
            return '❓';
    }
  }
}
