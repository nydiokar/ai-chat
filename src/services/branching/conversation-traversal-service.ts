/**
 * @fileoverview Manages conversation branching and traversal functionality.
 * This service enables creating and managing conversation branches, similar to Git branches.
 * It supports features like forking conversations, tracking message ancestry, and managing branch relationships.
 */

import { DatabaseService } from '../db-service.js';
import { debug } from '../../utils/config.js';
import crypto from 'crypto';

/**
 * Custom error class for handling conversation traversal operations.
 * Provides detailed context about what went wrong during branching operations.
 */
export class ConversationTraversalError extends Error {
    constructor(message: string, public cause?: unknown) {
        super(message);
        this.name = 'ConversationTraversalError';
        Object.setPrototypeOf(this, ConversationTraversalError.prototype);
    }
}

/**
 * Service responsible for managing conversation branches and message traversal.
 * Implements the Singleton pattern to ensure consistent state management.
 */
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

    /**
     * Retrieves all messages for a specific conversation.
     * @param conversationId - Unique identifier of the conversation
     * @returns Array of messages in the conversation
     * @throws ConversationTraversalError if retrieval fails
     */
    async getMessagesForConversation(conversationId: number) {
        try {
            debug(`Getting messages for conversation ${conversationId}`);
            const conversation = await this.db.getConversation(conversationId);
            return conversation.messages;
        } catch (error) {
            throw new ConversationTraversalError(`Failed to get messages for conversation ${conversationId}`, error);
        }
    }

    /**
     * Creates a new conversation branch from an existing conversation.
     * Copies messages up to the parent message to maintain conversation context.
     * 
     * @param sourceConversationId - ID of the conversation to branch from
     * @param parentMessageId - Message ID where the branch should start
     * @param title - Optional title for the new branch
     * @returns Object containing new branch details (conversationId, branchId, parentMessageId)
     * @throws ConversationTraversalError if branch creation fails
     */
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

    /**
     * Determines if a message is part of the ancestry path leading to a target message.
     * Used to identify which messages should be included when creating a new branch.
     * 
     * @param messages - Array of all messages in the conversation
     * @param messageId - ID of the message to check
     * @param targetParentId - ID of the target ancestor message
     * @returns boolean indicating if the message is in the branch path
     * @private
     */
    private isMessageInBranchPath(messages: any[], messageId: string | number, targetParentId: string): boolean {
        // Convert IDs to strings for comparison
        const currentId = messageId.toString();
        const targetId = targetParentId.toString();
        
        // Start from the target message and work backwards
        let currentMessage = messages.find(m => m.id.toString() === currentId);
        if (!currentMessage) {
            return false;
        }

        // Build a map of message IDs in the ancestry path from target back to root
        const ancestryPath = new Set<string>();
        let message = messages.find(m => m.id.toString() === targetId);
        while (message) {
            ancestryPath.add(message.id.toString());
            if (!message.parentMessageId) break;
            message = messages.find(m => m.id.toString() === message.parentMessageId.toString());
        }

        // Check if the current message is in the ancestry path
        return ancestryPath.has(currentId);
    }

    /**
     * Retrieves all branches created from a specific conversation.
     * Includes branch metadata like creation time and title.
     * 
     * @param conversationId - ID of the conversation to get branches for
     * @returns Array of branch information including IDs and metadata
     * @throws ConversationTraversalError if branch retrieval fails
     */
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

    /**
     * Retrieves the parent branch information for a given conversation.
     * Used for navigating the branch hierarchy and maintaining relationships.
     * 
     * @param conversationId - ID of the conversation to find parent for
     * @returns Parent branch information or null if conversation has no parent
     * @throws ConversationTraversalError if parent lookup fails
     */
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
