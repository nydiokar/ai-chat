import { assert } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { ConversationTraversalService } from './conversation-traversal-service.js';
import { DatabaseService } from '../db-service.js';
import { Message, Model, Role } from '../../types/index.js';
import { Prisma } from '@prisma/client';

describe('ConversationTraversalService', () => {
    let traversalService: ConversationTraversalService;
    let db: DatabaseService;
    let conversationId: number;
    let testMessages: Message[] = [];

    beforeEach(async () => {
        db = DatabaseService.getInstance();
        traversalService = ConversationTraversalService.getInstance();
        testMessages = [];

        // Create a test conversation
        conversationId = await db.createConversation(Model.gpt);
    });

    afterEach(async () => {
        // Clean up test data
        try {
            await db.prisma.message.deleteMany({
                where: { conversationId }
            });
            await db.prisma.conversation.delete({
                where: { id: conversationId }
            });
        } catch (error) {
            console.warn('Error cleaning up test data:', error);
        }
    });

    describe('Message Traversal', () => {
        it('should correctly get messages for conversation', async () => {
            // Add test messages
            await db.addMessage(conversationId, 'Hello', Role.user);
            await db.addMessage(conversationId, 'Hi there', Role.assistant);
            
            const messages = await traversalService.getMessagesForConversation(conversationId);
            
            assert.equal(messages.length, 2);
            assert.equal(messages[0].content, 'Hello');
            assert.equal(messages[1].content, 'Hi there');
        });
    });

    describe('Branch Creation', () => {
        it('should create a new branch from existing conversation', async () => {
            // Create initial message
            const rootMessage = await db.prisma.message.create({
                data: {
                    conversationId,
                    content: 'Initial message',
                    role: Role.user
                }
            });

            // Create child message using unchecked create input
            const childMessage = await db.prisma.message.create({
                data: {
                    conversationId,
                    content: 'First response',
                    role: Role.assistant,
                    parentMessageId: rootMessage.id
                } as Prisma.MessageUncheckedCreateInput
            });
            
            // Verify the child message is correctly linked to parent
            assert.equal(childMessage.parentMessageId, rootMessage.id);
            assert.equal(childMessage.content, 'First response');
            
            // Create branch from the child message
            const branch = await traversalService.createBranch(
                conversationId,
                childMessage.id.toString(),
                'Test Branch'
            );
            
            assert.exists(branch.conversationId);
            assert.exists(branch.branchId);
            assert.equal(branch.parentMessageId, childMessage.id.toString());
            
            // Verify branch includes both messages since we're branching from the child
            const branchMessages = await traversalService.getMessagesForConversation(branch.conversationId);
            assert.equal(branchMessages.length, 2, 'Branch should include root and child messages');
            assert.equal(branchMessages[0].content, 'Initial message');
            assert.equal(branchMessages[1].content, 'First response');
            
            // Verify original conversation is unchanged
            const originalMessages = await traversalService.getMessagesForConversation(conversationId);
            assert.equal(originalMessages.length, 2);
            assert.equal(originalMessages[0].content, 'Initial message');
            assert.equal(originalMessages[1].content, 'First response');
        });

        it('should create branch from root message', async () => {
            // Create initial message
            const rootMessage = await db.prisma.message.create({
                data: {
                    conversationId,
                    content: 'Initial message',
                    role: Role.user
                }
            });

            // Create child message
            const childMessage = await db.prisma.message.create({
                data: {
                    conversationId,
                    content: 'First response',
                    role: Role.assistant,
                    parentMessageId: rootMessage.id
                } as Prisma.MessageUncheckedCreateInput
            });
            
            // Create branch from root message
            const branch = await traversalService.createBranch(
                conversationId,
                rootMessage.id.toString(),
                'Root Branch'
            );
            
            // Verify branch only includes root message when branching from root
            const branchMessages = await traversalService.getMessagesForConversation(branch.conversationId);
            assert.equal(branchMessages.length, 1, 'Branch from root should only include root message');
            assert.equal(branchMessages[0].content, 'Initial message');
        });
    });

    describe('Branch Navigation', () => {
        it('should correctly get branches for a conversation', async () => {
            // Create initial message
            const message = await db.prisma.message.create({
                data: {
                    conversationId,
                    content: 'Root message',
                    role: Role.user
                }
            });
            
            // Create two branches
            const branch1 = await traversalService.createBranch(
                conversationId,
                message.id.toString(),
                'Branch 1'
            );
            
            const branch2 = await traversalService.createBranch(
                conversationId,
                message.id.toString(),
                'Branch 2'
            );
            
            const branches = await traversalService.getBranches(conversationId);
            
            assert.equal(branches.length, 2);
            assert.isTrue(branches.some(b => b.branchId === branch1.branchId));
            assert.isTrue(branches.some(b => b.branchId === branch2.branchId));
        });

        it('should get parent branch', async () => {
            // Create root message
            const message = await db.prisma.message.create({
                data: {
                    conversationId,
                    content: 'Parent message',
                    role: Role.user
                }
            });
            
            // Create branch
            const branch = await traversalService.createBranch(
                conversationId,
                message.id.toString(),
                'Child Branch'
            );
            
            const parentBranch = await traversalService.getParentBranch(branch.conversationId);
            
            assert.exists(parentBranch);
            assert.equal(parentBranch!.id, conversationId);
            assert.isTrue(parentBranch!.messages.some(m => m.id === message.id));
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid conversation ID gracefully', async () => {
            try {
                await traversalService.getMessagesForConversation(-1);
                assert.fail('Should have thrown error');
            } catch (error) {
                assert.exists(error);
                assert.instanceOf(error, Error);
            }
        });

        it('should handle invalid branch creation parameters', async () => {
            try {
                await traversalService.createBranch(-1, 'invalid-message-id');
                assert.fail('Should have thrown error');
            } catch (error) {
                assert.exists(error);
                assert.instanceOf(error, Error);
            }
        });
    });
});
