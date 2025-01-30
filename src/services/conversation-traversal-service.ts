import { DatabaseService } from './db-service.js';
import { debug } from '../config.js';
import crypto from 'crypto';

export class ConversationTraversalError extends Error {
    constructor(message: string, public cause?: unknown) {
        super(message);
        this.name = 'ConversationTraversalError';
        Object.setPrototypeOf(this, ConversationTraversalError.prototype);
    }
}

export class ConversationTraversalService {
    private static instance: ConversationTraversalService;
    private readonly db: DatabaseService;

    private constructor() {
        this.db = DatabaseService.getInstance();
    }

    static getInstance(): ConversationTraversalService {
        if (!ConversationTraversalService.instance) {
            ConversationTraversalService.instance = new ConversationTraversalService();
        }
        return ConversationTraversalService.instance;
    }

    async getMessagesForConversation(conversationId: number) {
        try {
            debug(`Getting messages for conversation ${conversationId}`);
            const conversation = await this.db.getConversation(conversationId);
            return conversation.messages;
        } catch (error) {
            throw new ConversationTraversalError(`Failed to get messages for conversation ${conversationId}`, error);
        }
    }

    async createBranch(
        sourceConversationId: number,
        parentMessageId: string,
        title?: string
    ) {
        try {
            debug(`Creating branch from conversation ${sourceConversationId} at message ${parentMessageId}`);
            
            // Get the source conversation to copy its properties
            const sourceConversation = await this.db.getConversation(sourceConversationId);
            const branchId = crypto.randomUUID();

            // Create new conversation as a branch
            const newConversationId = await this.db.createConversation(
                sourceConversation.model as any, // Cast needed due to enum type
                title || `Branch of ${sourceConversation.title || 'Conversation'}`,
                sourceConversation.summary || undefined,
                {
                    branchId,
                    parentMessageId,
                }
            );

            // Copy messages up to the parent message
            const messagesToCopy = sourceConversation.messages.reduce((acc: any[], msg: any) => {
                if (this.isMessageInBranchPath(sourceConversation.messages, msg.id, parentMessageId)) {
                    acc.push(msg);
                }
                return acc;
            }, []);

            // Add messages to the new branch
            for (const msg of messagesToCopy) {
                await this.db.addMessage(
                    newConversationId,
                    msg.content,
                    msg.role as any, // Cast needed due to enum type
                    msg.tokenCount
                );
            }

            return {
                conversationId: newConversationId,
                branchId,
                parentMessageId
            };
        } catch (error) {
            throw new ConversationTraversalError(
                `Failed to create branch from conversation ${sourceConversationId}`,
                error
            );
        }
    }

    private isMessageInBranchPath(messages: any[], messageId: string, targetParentId: string): boolean {
        let currentId = messageId;
        
        while (currentId) {
            if (currentId === targetParentId) {
                return true;
            }
            const message = messages.find(m => m.id === currentId);
            if (!message) {
                break;
            }
            currentId = message.parentMessageId;
        }
        
        return false;
    }

    async getBranches(conversationId: number) {
        try {
            debug(`Getting branches for conversation ${conversationId}`);
            const conversation = await this.db.getConversation(conversationId);
            
            // Convert message IDs to strings
            const messageIds = conversation.messages.map(m => m.id.toString());

            // Get all conversations that branch from this one
            const branches = await this.db.prisma.conversation.findMany({
                where: {
                    branchId: {
                        not: null
                    },
                    // Either directly branched from a message in this conversation
                    OR: [
                        {
                            parentMessageId: {
                                in: messageIds // Use the string array here
                            }
                        }
                    ]
                },
                select: {
                    id: true,
                    branchId: true,
                    parentMessageId: true,
                    title: true,
                    createdAt: true
                }
            });

            return branches;
        } catch (error) {
            throw new ConversationTraversalError(`Failed to get branches for conversation ${conversationId}`, error);
        }
    }

    async getParentBranch(conversationId: number) {
        try {
            debug(`Getting parent branch for conversation ${conversationId}`);
            const conversation = await this.db.getConversation(conversationId);
            
            if (!conversation.parentMessageId) {
                return null;
            }

            // Find the conversation containing the parent message
            const parentConversation = await this.db.prisma.conversation.findFirst({
                where: {
                    messages: {
                        some: {
                            id: Number(conversation.parentMessageId)
                        }
                    }
                },
                select: {
                    id: true,
                    branchId: true,
                    title: true,
                    messages: {
                        where: {
                            id: Number(conversation.parentMessageId)
                        }
                    }
                }
            });

            return parentConversation;
        } catch (error) {
            throw new ConversationTraversalError(`Failed to get parent branch for conversation ${conversationId}`, error);
        }
    }
}
