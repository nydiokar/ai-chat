import { Client, Events, GatewayIntentBits, Message as DiscordMessage, Partials } from 'discord.js';
import { DatabaseService } from './db-service.js';
import { AIModel, DiscordMessageContext } from '../types/index.js';
import { AIService } from './ai/base-service.js';
import { AIServiceFactory } from './ai-service-factory.js';

import { debug } from '../config.js';
import { MCPError } from '../types/errors.js';

export class DiscordService {
  private client: Client;
  private db: DatabaseService;
  private static instance: DiscordService;
  private readonly defaultModel: AIModel = 'gpt';
  private aiServices: Map<string, AIService> = new Map();

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

  private setupEventHandlers() {
    this.client.on(Events.ClientReady, () => {
      debug(`Logged in as ${this.client.user?.tag}`);
    });

    this.client.on(Events.MessageCreate, async (message: DiscordMessage) => {
      try {
        // Ignore messages from bots and messages that don't mention the bot
        if (message.author.bot || !message.mentions.has(this.client.user!)) {
          return;
        }

        const discordContext: DiscordMessageContext = {
          guildId: message.guildId!,
          channelId: message.channelId,
          userId: message.author.id,
          username: message.author.username,
        };

        // Get or create session
        let session = await this.db.getActiveSession(discordContext.userId, discordContext.channelId);
        let conversationId: number;

        if (!session) {
          // Create new conversation and session
          conversationId = await this.db.createConversation(
            this.defaultModel,
            undefined,
            undefined,
            discordContext
          );
        } else {
          conversationId = session.conversationId;
        }

        // Remove bot mention from message
        const content = message.content.replace(/<@!\d+>/g, '').trim();

        // Add user message to conversation
        await this.db.addMessage(
          conversationId,
          content,
          'user',
          undefined,
          discordContext
        );

        // Get or create AI service based on model
        const conversation = await this.db.getConversation(conversationId);
        const serviceKey = `${conversation.model}-${discordContext.channelId}`;
        
        let service = this.aiServices.get(serviceKey);
        if (!service) {
          service = AIServiceFactory.create(conversation.model as 'gpt' | 'claude');
          this.aiServices.set(serviceKey, service);
        }

        // Generate AI response
        const result = await service.generateResponse(content, conversation.messages);

        // Add AI response to conversation
        await this.db.addMessage(
          conversationId,
          result.content,
          'assistant',
          result.tokenCount
        );

        // Send response to Discord
        await message.reply(result.content);

      } catch (error) {
        console.error('Error handling Discord message:', error);
        const errorMessage = error instanceof MCPError 
            ? `Error: ${error.message}`
            : 'Sorry, I encountered an error processing your message.';
        await message.reply(errorMessage);
      }
    });

    // Handle errors
    this.client.on(Events.Error, (error) => {
      console.error('Discord client error:', error);
    });
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
      // Cleanup all AI services
      for (const service of this.aiServices.values()) {
        await service.cleanup();
      }
      this.aiServices.clear();

      // Destroy Discord client
      await this.client.destroy();
    } catch (error) {
      console.error('Error stopping Discord client:', error);
      throw error;
    }
  }
}
