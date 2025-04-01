import { PrismaClient, Prisma } from '@prisma/client';
import { AIModel, ConversationStats, MessageRole, Role, MessageContext } from '../types/index.js';
import { ToolResponse } from '../tools/mcp/types/tools.js';
import { MCPError } from '../types/errors.js';
import { debug, info, error, warn } from '../utils/logger.js';
import { DiscordContext } from '../types/discord.js';
import path from 'path';

export class DatabaseError extends Error {
  public cause?: any;

  constructor(message: string, cause?: any) {
    super(message);
    this.name = 'DatabaseError';
    this.cause = cause;
    
    // This is needed in TypeScript when extending Error
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }
}

interface PrismaError {
  code?: string;
  message?: string;
}

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

type FullTransactionClient = TransactionClient & {
  mCPServer: PrismaClient['mCPServer'];
  mCPTool: PrismaClient['mCPTool'];
  toolUsage: PrismaClient['toolUsage'];
};

export class DatabaseService {
  public readonly prisma: PrismaClient;
  private static instance: DatabaseService;
  private readonly MAX_TITLE_LENGTH = 100;
  private readonly MAX_SUMMARY_LENGTH = 500;

  protected constructor() {
    const env = process.env.NODE_ENV || 'development';
    
    // Configure database based on environment
    const dbConfig = {
      development: {
        provider: 'sqlite',
        url: `file:${path.resolve(process.cwd(), 'prisma/dev.db')}`
      },
      production: {
        provider: 'postgresql',
        url: process.env.DATABASE_URL || ''
      }
    };

    const config = dbConfig[env as keyof typeof dbConfig] || dbConfig.development;
    
    info({
      component: 'Database',
      message: 'Initializing PrismaClient',
      environment: env,
      config: {
        provider: config.provider,
        url: config.url.replace(/^.*\//, '.../')  // Hide full path for security
      }
    });
    
    this.prisma = new PrismaClient({
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'info' }
      ],
      datasources: {
        db: {
          url: config.url
        }
      }
    });

    // Set up Prisma event handlers
    (this.prisma as any).$on('error', (e: Prisma.LogEvent) => {
      error({
        component: 'Database',
        message: 'Prisma error',
        error: e
      });
    });

    (this.prisma as any).$on('warn', (e: Prisma.LogEvent) => {
      warn({
        component: 'Database',
        message: 'Prisma warning',
        warning: e
      });
    });

    (this.prisma as any).$on('info', (e: Prisma.LogEvent) => {
      info({
        component: 'Database',
        message: 'Prisma info',
        info: e
      });
    });

    // Log slow queries
    (this.prisma as any).$extends({
      query: {
        $allOperations: async ({ operation, model, args }: { 
          operation: string; 
          model: string | null; 
          args: Record<string, unknown>; 
        }, next: (args: Record<string, unknown>) => Promise<unknown>) => {
          const start = Date.now();
          const result = await next(args);
          const duration = Date.now() - start;
          
          if (duration > 100) { // Log queries that take more than 100ms
            warn({
              component: 'Database',
              message: 'Slow query detected',
              query: { operation, model, args },
              duration: `${duration}ms`
            });
          }
          
          return result;
        }
      }
    });
  }

  private validateId(id: number): void {
    if (!Number.isInteger(id) || id <= 0) {
      throw new DatabaseError('Invalid ID provided');
    }
  }

  private async handlePrismaError(error: unknown, operation: string): Promise<never> {
    const prismaError = error as PrismaError;
    if (prismaError.code) {
      if (prismaError.code === 'P2002') {
        throw new DatabaseError('Unique constraint violation');
      }
      if (prismaError.code === 'P2025') {
        throw new DatabaseError('Record not found');
      }
    }
    const errorMessage = prismaError.message || 'Unknown database error';
    throw new DatabaseError(`Database ${operation} failed: ${errorMessage}`, error as Error);
  }

  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  async disconnect(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      info({
        component: 'Database',
        message: 'Disconnected from database'
      });
    } catch (err) {
      error({
        component: 'Database',
        message: 'Failed to disconnect from database',
        error: err instanceof Error ? err : new Error(String(err))
      });
      throw err;
    }
  }

  async connect(): Promise<void> {
    try {
      await this.prisma.$connect();
      info({
        component: 'Database',
        message: 'Connected to database'
      });
    } catch (err) {
      error({
        component: 'Database',
        message: 'Failed to connect to database',
        error: err instanceof Error ? err : new Error(String(err))
      });
      throw err;
    }
  }

  async createConversation(
    model: AIModel,
    title?: string,
    summary?: string,
    discordContext?: DiscordContext
  ): Promise<number> {
    try {
      if (title && title.length > this.MAX_TITLE_LENGTH) {
        throw new DatabaseError(`Title exceeds maximum length of ${this.MAX_TITLE_LENGTH}`);
      }
      if (summary && summary.length > this.MAX_SUMMARY_LENGTH) {
        throw new DatabaseError(`Summary exceeds maximum length of ${this.MAX_SUMMARY_LENGTH}`);
      }

      // If we have Discord context, ensure the user exists
      if (discordContext?.userId) {
        const existingUser = await this.prisma.user.findUnique({
          where: { id: discordContext.userId }
        });
        
        if (!existingUser) {
          debug(`Creating user record for Discord user ${discordContext.userId}`);
          await this.prisma.user.create({
            data: {
              id: discordContext.userId,
              username: discordContext.username || `Discord User ${discordContext.userId}`,
              isActive: true,
              createdAt: new Date(),
              updatedAt: new Date()
            }
          });
        }
      }

      debug('Creating new conversation');
      const conversation = await this.prisma.conversation.create({
        data: {
          model,
          title,
          summary,
          tokenCount: 0,
          discordGuildId: discordContext?.guildId,
          discordChannelId: discordContext?.channelId,
          ...(discordContext && {
            session: {
              create: {
                discordUserId: discordContext.userId,
                isActive: true,
              },
            },
          }),
        },
      });
      return conversation.id;
    } catch (error) {
      return this.handlePrismaError(error, 'conversation creation');
    }
  }

  async addMessage(
    conversationId: number,
    content: string | ToolResponse,
    role: MessageRole,
    tokenCount?: number,
    context?: MessageContext
  ): Promise<void> {
    try {
      
      // First verify the conversation exists
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId }
      });

      if (!conversation) {
        debug(`Conversation ${conversationId} not found when trying to add message`);
        throw new DatabaseError(`Conversation ${conversationId} not found`);
      }

      const messageContent = typeof content === 'string' 
        ? content 
        : content.data?.content?.map((c: { text: string }) => c.text).filter(Boolean).join('\n') || JSON.stringify(content.data);

      await this.executePrismaOperation(async (prisma) => {
        await prisma.message.create({
          data: {
            conversationId,
            content: messageContent,
            role: Role[role],
            tokenCount,
            discordUserId: context?.userId,
            discordUsername: context?.username,
            discordGuildId: context?.guildId,
            discordChannelId: context?.channelId
          }
        });

        // Update session activity if context exists
        if (context) {
          await prisma.session.updateMany({
            where: { 
              conversationId,
              isActive: true 
            },
            data: { 
              lastActivity: new Date() 
            }
          });
        }

        // Update conversation token count if provided
        if (tokenCount) {
          await prisma.conversation.update({
            where: { id: conversationId },
            data: {
              tokenCount: {
                increment: tokenCount
              },
              updatedAt: new Date()
            }
          });
        }
      });
      debug(`Successfully added ${role} message to conversation ${conversationId}`);
    } catch (error) {
      throw MCPError.fromDatabaseError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async getConversation(id: number) {
    try {
      this.validateId(id);
      debug(`Retrieving conversation ${id}`);
      const conversation = await this.prisma.conversation.findUnique({
        where: { id },
        include: {
          messages: {
            orderBy: {
              createdAt: 'asc',
            },
          },
          session: true
        }
      });

      if (!conversation) {
        throw new DatabaseError(`Conversation ${id} not found`);
      }

      return conversation;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      return this.handlePrismaError(error, 'conversation retrieval');
    }
  }

  async listConversations(limit = 10) {
    debug(`Listing conversations with limit ${limit}`);
    return this.prisma.conversation.findMany({
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        messages: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });
  }

  async deleteConversation(id: number): Promise<void> {
    debug(`Deleting conversation ${id}`);
    await this.prisma.conversation.delete({
      where: { id },
    });
  }

  async cleanOldConversations(daysOld: number): Promise<number> {
    try {
      if (!Number.isInteger(daysOld) || daysOld <= 0) {
        throw new DatabaseError('Invalid days parameter');
      }

      debug(`Cleaning conversations older than ${daysOld} days`);
      const date = new Date();
      date.setDate(date.getDate() - daysOld);

      const result = await this.prisma.conversation.deleteMany({
        where: {
          createdAt: {
            lt: date,
          },
        },
      });

      return result.count;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      return this.handlePrismaError(error, 'conversation cleanup');
    }
  }

  async updateConversationMetadata(
    id: number,
    { title, summary }: { title?: string; summary?: string }
  ): Promise<void> {
    try {
      this.validateId(id);
      if (title && title.length > this.MAX_TITLE_LENGTH) {
        throw new DatabaseError(`Title exceeds maximum length of ${this.MAX_TITLE_LENGTH}`);
      }
      if (summary && summary.length > this.MAX_SUMMARY_LENGTH) {
        throw new DatabaseError(`Summary exceeds maximum length of ${this.MAX_SUMMARY_LENGTH}`);
      }

      await this.prisma.conversation.update({
        where: { id },
        data: {
          title,
          summary,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError(`Failed to update conversation ${id} metadata`, error as Error);
    }
  }

  async getStats(): Promise<ConversationStats> {
    const [totalConversations, totalMessages, modelGroups, roleGroups] = await Promise.all([
      this.prisma.conversation.count(),
      this.prisma.message.count(),
      this.prisma.conversation.groupBy({
        by: ['model'],
        _count: {
          _all: true
        }
      }),
      this.prisma.message.groupBy({
        by: ['role'],
        _count: {
          _all: true
        }
      })
    ]);

    const modelDistribution = modelGroups.map((group: any) => ({
      model: group.model as AIModel,
      _count: group._count._all
    }));

    const roleDistribution = roleGroups.map((group: any) => ({
      role: group.role as MessageRole,
      _count: group._count._all
    }));

    return {
      totalConversations,
      totalMessages,
      modelDistribution,
      roleDistribution
    };
  }

  async getActiveSession(userId: string, channelId?: string) {
    try {
      return await this.prisma.session.findFirst({
        where: {
          discordUserId: userId,
          ...(channelId && { conversation: { discordChannelId: channelId } }),
          isActive: true
        },
        include: {
          conversation: true
        },
        orderBy: {
          lastActivity: 'desc'
        }
      });
    } catch (error) {
      throw new DatabaseError('Failed to get active session', error as Error);
    }
  }

  async endSession(conversationId: number) {
    debug(`Ending session for conversation ${conversationId}`);
    await this.prisma.session.updateMany({
      where: {
        conversationId,
        isActive: true
      },
      data: {
        isActive: false,
        lastActivity: new Date()
      }
    });
  }

  async cleanInactiveSessions(hoursInactive: number) {
    debug(`Cleaning sessions inactive for ${hoursInactive} hours`);
    const date = new Date();
    date.setHours(date.getHours() - hoursInactive);

    await this.prisma.session.updateMany({
      where: {
        lastActivity: {
          lt: date
        },
        isActive: true
      },
      data: {
        isActive: false
      }
    });
  }

  async exportConversation(id: number) {
    debug(`Exporting conversation ${id}`);
    const conversation = await this.getConversation(id);
    if (!conversation) return null;

    return {
      id: conversation.id,
      model: conversation.model,
      createdAt: conversation.createdAt,
      messages: conversation.messages.map((msg: any) => ({
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
      })),
    };
  }

  async importConversation(data: {
    model: AIModel;
    messages: { role: MessageRole; content: string }[];
  }) {
    debug('Importing conversation');
    const conversation = await this.createConversation(data.model);
    
    for (const msg of data.messages) {
      if (msg.role === 'system') continue; // Skip system messages
      await this.addMessage(conversation, msg.content, msg.role);
    }

    return conversation;
  }

  async getDiscordConversations(guildId: string, channelId: string, limit = 10) {
    debug(`Getting Discord conversations for guild ${guildId} channel ${channelId}`);
    return this.prisma.conversation.findMany({
      where: {
        discordGuildId: guildId,
        discordChannelId: channelId
      },
      take: limit,
      orderBy: {
        createdAt: 'desc'
      },
      include: {
        messages: {
          orderBy: {
            createdAt: 'asc'
          }
        },
        session: true
      }
    });
  }

  // Add a protected method for transaction access
  protected async transaction<T>(
    fn: (prisma: TransactionClient) => Promise<T>
  ): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  // Add a method for MCP service to use
  async executePrismaOperation<T>(
    operation: (prisma: FullTransactionClient) => Promise<T>
  ): Promise<T> {
    return this.prisma.$transaction(operation as any) as Promise<T>;
  }

  async upsertCacheMetrics(data: {
    key: string;
    hits: number;
    misses: number;
    lastAccessed: Date;
  }): Promise<void> {
    try {
      debug(`Upserting cache metrics for key ${data.key}`);
      await this.prisma.cacheMetrics.upsert({
        where: { key: data.key },
        update: {
          hits: data.hits,
          misses: data.misses,
          lastAccessed: data.lastAccessed,
          updatedAt: new Date()
        },
        create: {
          key: data.key,
          hits: data.hits,
          misses: data.misses,
          lastAccessed: data.lastAccessed
        }
      });
    } catch (error) {
      throw new DatabaseError('Failed to upsert cache metrics', error as Error);
    }
  }

  async cleanOldCacheMetrics(daysOld: number): Promise<number> {
    try {
      if (!Number.isInteger(daysOld) || daysOld <= 0) {
        throw new DatabaseError('Invalid days parameter');
      }

      debug(`Cleaning cache metrics older than ${daysOld} days`);
      const date = new Date();
      date.setDate(date.getDate() - daysOld);

      const result = await this.prisma.cacheMetrics.deleteMany({
        where: {
          lastAccessed: {
            lt: date
          }
        }
      });

      return result.count;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError('Failed to clean old cache metrics', error as Error);
    }
  }
}
