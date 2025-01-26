import { Client, Events, GatewayIntentBits, Message as DiscordMessage, Partials, TextChannel, Message } from 'discord.js';
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
          service = AIServiceFactory.create(conversation.model as 'gpt' | 'claude' | 'deepseek');
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
        await this.sendMessage(message.channel as TextChannel, result.content, message);

      } catch (error) {
        console.error('Error handling Discord message:', error);
        const errorMessage = error instanceof MCPError 
            ? `Error: ${error.message}`
            : 'Sorry, I encountered an error processing your message.';
        await this.sendMessage(message.channel as TextChannel, errorMessage, message);
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

  protected async sendMessage(channel: TextChannel, content: string, reference?: Message): Promise<void> {
    // Split message if it's longer than Discord's limit
    const MAX_LENGTH = 1900; // Leaving some buffer for safety
    
    if (content.length <= MAX_LENGTH) {
        await channel.send({
            content,
            reply: reference ? { messageReference: reference.id } : undefined
        });
        return;
    }

    // Split long messages
    const parts = this.splitMessage(content);
    
    // Send first part with reference
    await channel.send({
        content: parts[0],
        reply: reference ? { messageReference: reference.id } : undefined
    });

    // Send remaining parts
    for (let i = 1; i < parts.length; i++) {
        await channel.send({ content: parts[i] });
    }
  }

  private splitMessage(content: string): string[] {
    const MAX_LENGTH = 1900; // Leaving some buffer for safety
    const parts: string[] = [];
    let currentPart = '';

    // Split by paragraphs first
    const paragraphs = content.split('\n');

    for (const paragraph of paragraphs) {
        if (currentPart.length + paragraph.length + 1 <= MAX_LENGTH) {
            currentPart += (currentPart ? '\n' : '') + paragraph;
        } else {
            if (currentPart) {
                parts.push(currentPart);
            }
            // If a single paragraph is too long, split it by words
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
}
