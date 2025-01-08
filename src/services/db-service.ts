import { PrismaClient, Prisma } from '@prisma/client';
import { AIModel, ConversationStats, Message, MessageRole, Model, Role, DiscordMessageContext } from '../types';
import { debug } from '../config';

class DatabaseError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'DatabaseError';
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

export class DatabaseService {
  private prisma: PrismaClient;
  private static instance: DatabaseService;
  private readonly MAX_TITLE_LENGTH = 100;
  private readonly MAX_SUMMARY_LENGTH = 500;

  private constructor() {
    this.prisma = new PrismaClient({
      log: ['error', 'warn'],
    });
  }

  private validateId(id: number): void {
    if (!Number.isInteger(id) || id <= 0) {
      throw new DatabaseError('Invalid ID provided');
    }
  }

  private validateContent(content: string): void {
    if (!content || content.trim().length === 0) {
      throw new DatabaseError('Content cannot be empty');
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
    throw new DatabaseError(`Database ${operation} failed: ${errorMessage}`, error);
  }

  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  // Add connection error handling
  async connect(): Promise<void> {
    try {
      await this.prisma.$connect();
    } catch (error) {
      console.error('Failed to connect to database:', error);
      throw error;
    }
  }

  async createConversation(
    model: keyof typeof Model,
    title?: string,
    summary?: string,
    discordContext?: DiscordMessageContext
  ): Promise<number> {
    try {
      if (title && title.length > this.MAX_TITLE_LENGTH) {
        throw new DatabaseError(`Title exceeds maximum length of ${this.MAX_TITLE_LENGTH}`);
      }
      if (summary && summary.length > this.MAX_SUMMARY_LENGTH) {
        throw new DatabaseError(`Summary exceeds maximum length of ${this.MAX_SUMMARY_LENGTH}`);
      }

      debug('Creating new conversation');
      const conversation = await this.prisma.conversation.create({
        data: {
          model: Model[model],
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
    content: string,
    role: keyof typeof Role,
    tokenCount?: number | null,
    discordContext?: DiscordMessageContext
  ): Promise<void> {
    try {
      this.validateId(conversationId);
      this.validateContent(content);

      debug(`Adding message to conversation ${conversationId}`);
      await this.prisma.$transaction(async (prisma: TransactionClient) => {
        const message = await prisma.message.create({
          data: {
            content,
            role: Role[role],
            conversationId,
            tokenCount,
            discordUserId: discordContext?.userId,
            discordUsername: discordContext?.username,
          },
        });

        if (discordContext) {
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

        if (tokenCount) {
          await prisma.conversation.update({
            where: { id: conversationId },
            data: {
              tokenCount: {
                increment: tokenCount
              },
              updatedAt: new Date(),
            },
          });
        }

        return message;
      });
    } catch (error) {
      throw new DatabaseError(`Failed to add message to conversation ${conversationId}`, error);
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
        },
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
      throw new DatabaseError(`Failed to update conversation ${id} metadata`, error);
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

  async getActiveSession(discordUserId: string, channelId: string) {
    debug(`Getting active session for user ${discordUserId} in channel ${channelId}`);
    const session = await this.prisma.session.findFirst({
      where: {
        discordUserId,
        isActive: true,
        conversation: {
          discordChannelId: channelId
        }
      },
      include: {
        conversation: {
          include: {
            messages: {
              orderBy: {
                createdAt: 'asc'
              }
            }
          }
        }
      }
    });
    return session;
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
      messages: conversation.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
      })),
    };
  }

  async importConversation(data: {
    model: 'gpt' | 'claude';
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
  }) {
    debug('Importing conversation');
    const conversation = await this.createConversation(data.model);
    
    for (const msg of data.messages) {
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
}
