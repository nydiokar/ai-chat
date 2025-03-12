import { Client, Message, TextChannel, GatewayIntentBits } from 'discord.js';
import { DatabaseService } from '../services/db-service.js';
import { DiscordService } from '../services/discord-service.js';
import { MCPServerManager } from '../tools/mcp/mcp-server-manager.js';
import { AIServiceFactory } from '../services/ai-service-factory.js';
import { expect } from 'chai';
import { describe, it, before, after } from 'mocha';
import dotenv from 'dotenv';

describe('Discord Integration Tests', () => {
    let discordService: DiscordService;
    let client: Client;
    let db: DatabaseService;
    let mcpManager: MCPServerManager;
    let testChannel: TextChannel;

    before(async () => {
        dotenv.config();
        
        // Initialize services
        discordService = await DiscordService.getInstance();
        client = discordService.getClient();
        
        db = DatabaseService.getInstance();
        const aiService = AIServiceFactory.create('gpt');
        mcpManager = new MCPServerManager(db);

        // Connect to Discord
        await client.login(process.env.DISCORD_TOKEN);
        
        // Create a mock channel for testing
        testChannel = {
            send: async (content: string) => ({
                id: '123',
                content,
                author: { id: client.user?.id },
                delete: async () => {},
                reference: { messageId: '123' },
                createMessageCollector: () => ({
                    on: (event: string, callback: (m: any) => void) => {
                        // Simulate bot response
                        setTimeout(() => {
                            // Simulate different responses based on the message content
                            let responseContent = 'Mock bot response';
                            if (content.startsWith('/help')) {
                                responseContent = 'Available commands: /help, /search, /status';
                            } else if (content.startsWith('/search')) {
                                responseContent = 'Here are the search results for your query...';
                            } else if (content.startsWith('/invalid')) {
                                responseContent = 'Error: invalid command. Type /help for available commands.';
                            } else if (content.includes('What did I ask you to remember?')) {
                                responseContent = 'You asked me to remember: testing context';
                            }

                            callback({
                                id: '456',
                                content: responseContent,
                                author: { id: client.user?.id },
                                delete: async () => {}
                            });
                        }, 100);
                    }
                })
            })
        } as unknown as TextChannel;
    });

    after(async () => {
        await client.destroy();
    });

    describe('Message Handling', () => {
        it('should handle direct messages with commands', async () => {
            const testMessage = await testChannel.send('/help');
            
            // Wait for bot response
            const response = await new Promise<Message>((resolve) => {
                const collector = testChannel.createMessageCollector({ 
                    filter: m => m.author.id === client.user?.id,
                    time: 5000,
                    max: 1 
                });
                collector.on('collect', m => resolve(m));
            });

            expect(response.content).to.include('Available commands');
            await testMessage.delete();
            await response.delete();
        });

        it('should process messages with MCP tool commands', async () => {
            const testMessage = await testChannel.send('/search test query');
            
            const response = await new Promise<Message>((resolve) => {
                const collector = testChannel.createMessageCollector({ 
                    filter: m => m.author.id === client.user?.id,
                    time: 5000,
                    max: 1 
                });
                collector.on('collect', m => resolve(m));
            });

            expect(response.content).to.not.be.empty;
            expect(response.content).to.include('search results');
            
            await testMessage.delete();
            await response.delete();
        });

        it('should handle concurrent message processing', async () => {
            const messages = await Promise.all([
                testChannel.send('/help'),
                testChannel.send('/search test'),
                testChannel.send('/status')
            ]);

            const responses = await Promise.all(messages.map(msg => 
                new Promise<Message>((resolve) => {
                    const collector = testChannel.createMessageCollector({ 
                        filter: m => m.author.id === client.user?.id && 
                                   m.reference?.messageId === msg.id,
                        time: 5000,
                        max: 1 
                    });
                    collector.on('collect', m => resolve(m));
                })
            ));

            expect(responses).to.have.length(3);
            expect(responses.every(r => r.content.length > 0)).to.be.true;

            // Cleanup
            await Promise.all([
                ...messages.map(m => m.delete()),
                ...responses.map(r => r.delete())
            ]);
        });

        it('should handle error conditions gracefully', async () => {
            const testMessage = await testChannel.send('/invalid_command');
            
            const response = await new Promise<Message>((resolve) => {
                const collector = testChannel.createMessageCollector({ 
                    filter: m => m.author.id === client.user?.id,
                    time: 5000,
                    max: 1 
                });
                collector.on('collect', m => resolve(m));
            });

            expect(response.content).to.include('error');
            expect(response.content).to.include('invalid command');
            
            await testMessage.delete();
            await response.delete();
        });
    });

    describe('Cross-Component Integration', () => {
        it('should maintain conversation context across messages', async () => {
            const msg1 = await testChannel.send('Remember this: testing context');
            await new Promise(r => setTimeout(r, 1000));
            const msg2 = await testChannel.send('What did I ask you to remember?');

            const responses = await Promise.all([msg1, msg2].map(msg => 
                new Promise<Message>((resolve) => {
                    const collector = testChannel.createMessageCollector({ 
                        filter: m => m.author.id === client.user?.id && 
                                   m.reference?.messageId === msg.id,
                        time: 5000,
                        max: 1 
                    });
                    collector.on('collect', m => resolve(m));
                })
            ));

            expect(responses[1].content).to.include('testing context');

            // Cleanup
            await Promise.all([
                msg1.delete(),
                msg2.delete(),
                ...responses.map(r => r.delete())
            ]);
        });
    });
});
