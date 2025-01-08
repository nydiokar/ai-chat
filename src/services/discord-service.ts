import { Client, Events, GatewayIntentBits, Message as DiscordMessage, Partials } from 'discord.js';
import { DatabaseService } from './db-service';
import { AIModel, DiscordMessageContext } from '../types';
import { OpenAIService, AnthropicService } from './ai-service';
import { debug } from '../config';

export class DiscordService {
  private client: Client;
  private db: DatabaseService;
  private static instance: DiscordService;
  private readonly defaultModel: AIModel = 'gpt';

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

        // Get AI service based on model
        const conversation = await this.db.getConversation(conversationId);
        const service = conversation.model === 'gpt' 
          ? new OpenAIService() 
          : new AnthropicService();

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
        await message.reply('Sorry, I encountered an error processing your message.');
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
      await this.client.destroy();
    } catch (error) {
      console.error('Error stopping Discord client:', error);
      throw error;
    }
  }
}
