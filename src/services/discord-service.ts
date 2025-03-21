import { Client, Events, GatewayIntentBits, Message as DiscordMessage, TextChannel, Message, REST, Routes } from 'discord.js';
import { DatabaseService } from './db-service.js';
import { AIModel, Message as DBMessage, Role } from '../types/index.js';
import { AIService } from '../types/ai-service.js';
import { AIServiceFactory } from './ai-service-factory.js';
import { debug, defaultConfig } from '../utils/config.js';
import { IServerManager } from '../tools/mcp/interfaces/core.js';
import { MCPContainer } from '../tools/mcp/di/container.js';
import { mcpConfig } from '../mcp_config.js';
import { CacheService, CacheType } from './cache/cache-service.js';
import { DiscordContext, DiscordCachedMessage, DiscordCachedConversation } from '../types/discord.js';
import { hotTokensCommands, handleHotTokensCommand } from '../features/hot-tokens/commands/hot-tokens-commands.js';
import { taskCommands, handleTaskCommand } from '../tasks/commands/task-commands.js';
import { pulseCommand, handlePulseCommand } from '../features/pulse-mcp/commands/pulse-discord-command.js';
import { HotTokensService } from '../features/hot-tokens/services/hot-tokens-service.js';
import { PrismaClient } from '@prisma/client';

export class DiscordService {
    private client: Client;
    private db: DatabaseService;
    private static instance: DiscordService;
    private aiServices: Map<string, AIService> = new Map();
    private readonly contextRefreshInterval = 30 * 60 * 1000;
    private contextSummaryTasks: Map<string, NodeJS.Timeout> = new Map();
    private lastActivityTimestamps: Map<string, number> = new Map();
    private mcpContainer?: MCPContainer;
    private serverManager?: IServerManager;
    private isInitialized: boolean = false;
    private sessionCache!: CacheService;

    private constructor(
        private readonly token: string,
        dbService: DatabaseService
    ) {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent
            ]
        });
        this.db = dbService;
    }

    private async initializeCache(): Promise<void> {
        try {
            debug('Initializing cache service...');
            // Initialize session cache with proper error handling and memory services
            this.sessionCache = CacheService.getInstance({
                type: CacheType.PERSISTENT,
                namespace: 'discord-sessions',
                ttl: defaultConfig.discord.sessionTimeout * 60 * 60 * 1000, // Convert hours to ms
                filename: 'discord-sessions.json',
                writeDelay: 100
            });
            debug('Cache service instance created');

            // Verify cache is properly initialized by testing it
            debug('Starting cache verification test...');
            try {
                debug('Testing cache write...');
                await this.sessionCache.set('test-key', 'test-value');
                debug('Cache write successful');

                debug('Testing cache read...');
                const testValue = await this.sessionCache.get('test-key');
                debug(`Cache read result: ${JSON.stringify(testValue)}`);

                if (testValue !== 'test-value') {
                    throw new Error(`Cache verification failed: expected "test-value" but got ${JSON.stringify(testValue)}`);
                }
                debug('Cache read verification successful');

                debug('Testing cache delete...');
                await this.sessionCache.delete('test-key');
                debug('Cache delete successful');

                debug('Cache initialization verified successfully');
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                debug(`Cache verification step failed: ${err.message}`);
                if (err.stack) debug(err.stack);
                throw err;
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            debug(`Cache initialization failed: ${err.message}`);
            if (err.stack) debug(err.stack);
            throw err;
        }
    }

    private async handleMessage(message: Message): Promise<void> {
        if (message.author.bot) return;

        // Check if this is a direct message or if the bot is mentioned
        const isDM = !message.guild;
        const isBotMentioned = message.mentions.users.has(this.client.user!.id);
        
        // Only proceed if it's a DM or the bot is explicitly mentioned
        if (!isDM && !isBotMentioned) {
            debug(`Message ignored - bot not mentioned: ${message.content.substring(0, 50)}...`);
            return;
        }
        
        // Remove the bot mention from the message content if present
        let cleanContent = message.content;
        if (isBotMentioned) {
            // Remove the bot mention (both <@!id> and <@id> formats)
            cleanContent = cleanContent.replace(new RegExp(`<@!?${this.client.user!.id}>`, 'g'), '').trim();
            debug(`Processing message with bot mention: ${cleanContent.substring(0, 50)}...`);
        }

        // Check if the message looks like a command attempt
        if (cleanContent.match(/^(task|ht|help|list|create|view|update|assign|delete|stats)/i)) {
            // Direct users to slash commands
            await this.sendMessage(message.channel as TextChannel, 
                "I've moved to slash commands! Try using `/task` or `/ht` commands instead. Type `/` to see all available commands.", 
                message
            );
            return;
        }

        // Handle as a conversation with AI
        try {
            // Ensure the user exists in the database
            try {
                const existingUser = await this.db.prisma.user.findUnique({
                    where: { id: message.author.id }
                });
                
                if (!existingUser) {
                    debug(`Creating user record for Discord user ${message.author.id}`);
                    await this.db.prisma.user.create({
                        data: {
                            id: message.author.id,
                            username: message.author.username,
                            isActive: true,
                            createdAt: new Date(),
                            updatedAt: new Date()
                        }
                    });
                }
            } catch (error) {
                console.error('Error ensuring user exists:', error);
            }

            const sessionKey = `session:${message.channelId}`;
            let conversation;

            // Try to get session from cache first with error handling
            try {
                const cachedSession = await this.sessionCache.get<DiscordCachedConversation>(sessionKey);
                if (cachedSession) {
                    conversation = cachedSession;
                    debug('Using cached session');
                }
            } catch (error) {
                debug(`Cache error, falling back to database: ${error instanceof Error ? error.message : String(error)}`);
            }

            if (!conversation) {
                // If not in cache or cache failed, get from database
                debug(`Looking for conversation for channel ${message.channelId}`);
                const conversations = await this.db.getDiscordConversations(
                    message.guild?.id || 'DM',
                    message.channelId,
                    1
                );
                
                conversation = conversations[0];
                
                if (!conversation) {
                    debug(`Creating new conversation for channel ${message.channelId}`);
                    const context: DiscordContext = {
                        channelId: message.channelId,
                        userId: message.author.id,
                        username: message.author.username,
                        guildId: message.guild?.id || 'DM'
                    };
                    const conversationId = await this.db.createConversation(
                        defaultConfig.defaultModel,
                        undefined,
                        undefined,
                        context
                    );
                    conversation = await this.db.getConversation(conversationId);
                }

                // Cache the conversation with retry mechanism
                try {
                    await this.sessionCache.set(sessionKey, conversation as DiscordCachedConversation);
                } catch (error) {
                    debug(`Failed to cache conversation: ${error instanceof Error ? error.message : String(error)}`);
                }
            }

            let service = this.aiServices.get(conversation.id.toString());
            if (!service) {
                service = AIServiceFactory.create(conversation.model as AIModel);
                this.aiServices.set(conversation.id.toString(), service);
            }

            // Get messages for context
            const messages = conversation.messages
                .slice(-defaultConfig.messageHandling.maxContextMessages)
                .map((msg: DiscordCachedMessage) => ({
                    id: msg.id,
                    content: msg.content,
                    role: msg.role as keyof typeof Role,
                    createdAt: msg.createdAt,
                    conversationId: msg.conversationId,
                    tokenCount: msg.tokenCount,
                    discordUserId: msg.discordUserId,
                    discordUsername: msg.discordUsername,
                    name: undefined,
                    tool_call_id: undefined
                } as DBMessage));

            // Use the cleaned content (without the bot mention) for processing
            const response = await service.processMessage(cleanContent, messages);

            // Update database
            await this.db.addMessage(conversation.id, cleanContent, 'user');
            await this.db.addMessage(conversation.id, response.content, 'assistant');

            // Update cache with new messages and handle errors
            const newUserMessage: DiscordCachedMessage = {
                content: cleanContent,
                role: 'user',
                createdAt: new Date(),
                id: Date.now(),
                conversationId: conversation.id,
                tokenCount: null,
                discordUserId: message.author.id,
                discordUsername: message.author.username,
                discordChannelId: message.channelId,
                discordGuildId: message.guild?.id || null,
                contextId: null,
                parentMessageId: null
            };

            const newAssistantMessage: DiscordCachedMessage = {
                content: response.content,
                role: 'assistant',
                createdAt: new Date(),
                id: Date.now() + 1,
                conversationId: conversation.id,
                tokenCount: null,
                discordUserId: null,
                discordUsername: null,
                discordChannelId: message.channelId,
                discordGuildId: message.guild?.id || null,
                contextId: null,
                parentMessageId: null
            };

            conversation.messages.push(newUserMessage, newAssistantMessage);
            
            // Update cache with retry mechanism
            try {
                await this.sessionCache.set(sessionKey, conversation as DiscordCachedConversation);
            } catch (error) {
                debug(`Failed to update cache with new messages: ${error instanceof Error ? error.message : String(error)}`);
            }

            await message.reply(response.content);
            
            this.updateLastActivity(conversation.id.toString());
        } catch (error) {
            console.error('Error processing message:', error);
            await message.reply('Sorry, I encountered an error processing your message.');
        }
    }

    private updateLastActivity(conversationId: string): void {
        this.lastActivityTimestamps.set(conversationId, Date.now());
    }

    private setupEventHandlers() {
        this.client.on(Events.ClientReady, () => {
            debug(`Logged in as ${this.client.user?.tag}`);
        });

        this.client.on(Events.MessageCreate, (message: DiscordMessage) => {
            this.handleMessage(message).catch(error => {
                console.error('Error in message handler:', error);
            });
        });
        
        this.client.on(Events.InteractionCreate, async interaction => {
            if (!interaction.isChatInputCommand()) return;
            
            try {
                const commandName = interaction.commandName;
                
                // Create a single PrismaClient instance to be used by both services
                const prisma = new PrismaClient();
                
                if (commandName === 'task') {
                    // TaskManager is obtained inside the handler
                    await handleTaskCommand(interaction);
                } else if (commandName === 'ht') {
                    const hotTokensService = new HotTokensService(prisma);
                    await handleHotTokensCommand(interaction, hotTokensService);
                } else if (commandName === 'pulse') {
                    await handlePulseCommand(interaction);
                }
                
                // Close the Prisma client after command handling
                await prisma.$disconnect();
            } catch (error) {
                console.error('Error handling slash command:', error);
                
                // Reply with error if interaction hasn't been replied to yet
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: 'An error occurred while processing your command.',
                        ephemeral: true
                    });
                }
            }
        });

        this.client.on(Events.Error, (error) => {
            console.error('Discord client error:', error);
        });
    }

    private async summarizeAndRefreshContext(conversationId: number) {
        try {
            const contextKey = `${conversationId}`;
            const lastActivity = this.lastActivityTimestamps.get(contextKey) || 0;
            const timeSinceLastActivity = Date.now() - lastActivity;

            // Only summarize if there's been no activity for 30 minutes
            if (timeSinceLastActivity >= this.contextRefreshInterval) {
                const conversation = await this.db.getConversation(conversationId);
                if (!conversation || conversation.messages.length <= defaultConfig.messageHandling.maxContextMessages) return;

                // Just summarize, don't reinitialize services
                await this.summarizeConversation(conversation);
            }

            // Schedule next check without full reinitialization
            this.scheduleNextContextCheck(contextKey, conversationId);
        } catch (error) {
            console.error('Error in context summarization:', error);
        }
    }

    private async summarizeConversation(conversation: any) {
        const service = this.aiServices.get(conversation.id.toString());
        if (!service) return;

        const oldMessages = conversation.messages.slice(0, -defaultConfig.messageHandling.maxContextMessages);
        const summary = await service.generateResponse(
            "Please provide a brief summary of this conversation context.",
            oldMessages
        );

        await this.db.updateConversationMetadata(conversation.id, {
            summary: summary.content
        });
    }

    private scheduleNextContextCheck(contextKey: string, conversationId: number) {
        // Clear existing task if any
        if (this.contextSummaryTasks.has(contextKey)) {
            clearTimeout(this.contextSummaryTasks.get(contextKey));
        }

        // Schedule next check
        const task = setTimeout(
            () => this.summarizeAndRefreshContext(conversationId),
            this.contextRefreshInterval
        );
        this.contextSummaryTasks.set(contextKey, task);
    }

    async start() {
        if (this.isInitialized) {
            console.warn('DiscordService is already initialized');
            return;
        }

        try {
            console.log('\n=== Discord Bot Initialization ===');
            
            // Initialize cache first
            console.log('\n1. Initializing cache...');
            await this.initializeCache();
            console.log('  ✓ Cache initialized');

            // Set up event handlers
            console.log('\n2. Setting up event handlers...');
            this.setupEventHandlers();
            console.log('  ✓ Event handlers configured');

            // Initialize MCP if enabled
            if (defaultConfig.discord.mcp.enabled) {
                console.log('\n3. Initializing MCP...');
                
                // Create and configure MCP container
                this.mcpContainer = new MCPContainer(mcpConfig);
                this.serverManager = this.mcpContainer.getServerManager();
                console.log('  ✓ MCP container created');

                // Get and initialize the MCP client using the first available server
                const servers = Object.values(mcpConfig.mcpServers);
                if (servers.length === 0) {
                    throw new Error('No MCP servers configured');
                }

                try {
                    // Initialize MCP client
                    const mcpClient = this.mcpContainer.getMCPClient(servers[0].id);
                    await mcpClient.initialize();
                    console.log('  ✓ MCP client connected');

                    // Start all configured servers
                    console.log('\n4. Starting MCP servers...');
                    let successCount = 0;
                    const totalServers = Object.keys(mcpConfig.mcpServers).length;
                    
                    for (const [serverId, config] of Object.entries(mcpConfig.mcpServers)) {
                        try {
                            await this.serverManager.startServer(serverId, config);
                            console.log(`  ✓ Started ${serverId}`);
                            successCount++;
                        } catch (error) {
                            console.error(`  ✗ Failed to start ${serverId}:`, error);
                        }
                    }
                    console.log(`\nServers started: ${successCount}/${totalServers}`);

                    // Initialize AIServiceFactory
                    console.log('\n5. Initializing AI Service...');
                    try {
                        await AIServiceFactory.initialize(this.mcpContainer);
                        console.log('  ✓ AI Service initialized');
                    } catch (error) {
                        console.error('  ✗ Failed to initialize AI Service:', error);
                    }

                } catch (mcpError) {
                    console.error('  ✗ Failed to initialize MCP:', mcpError);
                }
            }

            // Login to Discord
            console.log('\n6. Logging in to Discord...');
            await this.client.login(this.token);
            this.isInitialized = true;
            console.log('  ✓ Successfully logged in');
            
            // Register slash commands
            console.log('\n7. Setting up slash commands...');
            try {
                await this.registerSlashCommands();
                console.log('  ✓ Slash commands setup complete');
            } catch (error) {
                console.error('  ✗ Failed to setup slash commands:', error);
            }
            
            console.log('\n=== Initialization Complete ===\n');
            
        } catch (error) {
            console.error('\n❌ Failed to start Discord client:', error);
            await this.stop();
            throw error;
        }
    }

    private async registerSlashCommands() {
        try {
            console.log('\n=== Discord Command Registration ===');
            
            // Get the client ID from the client object
            if (!this.client.user?.id) {
                console.log('❌ Client ID not available yet, skipping registration');
                return;
            }
            
            const clientId = this.client.user.id;
            const rest = new REST({ version: '10' }).setToken(this.token);
            
            const commands = [
                taskCommands.toJSON(),
                hotTokensCommands.toJSON(),
                pulseCommand.toJSON()
            ];
            
            // Get the guilds the bot is in
            const guilds = this.client.guilds.cache;
            console.log(`\nRegistering ${commands.length} commands in ${guilds.size} guilds...`);
            
            // First, clear all commands
            console.log('\n1. Clearing existing commands...');
            
            // Clear global commands
            try {
                await rest.put(Routes.applicationCommands(clientId), { body: [] });
                console.log('  ✓ Cleared global commands');
            } catch (error) {
                console.error('  ✗ Error clearing global commands:', error);
            }
            
            // Clear guild commands
            for (const [guildId, guild] of guilds) {
                try {
                    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
                    console.log(`  ✓ Cleared commands from ${guild.name}`);
                } catch (error) {
                    console.error(`  ✗ Error clearing commands from ${guild.name}:`, error);
                }
            }
            
            // Register new commands
            console.log('\n2. Registering new commands...');
            let successCount = 0;
            
            for (const [guildId, guild] of guilds) {
                try {
                    await rest.put(
                        Routes.applicationGuildCommands(clientId, guildId),
                        { body: commands }
                    );
                    console.log(`  ✓ Registered in ${guild.name}`);
                    successCount++;
                } catch (error) {
                    console.error(`  ✗ Failed to register in ${guild.name}:`, error);
                }
            }
            
            // Print summary
            console.log('\n=== Command Registration Summary ===');
            console.log(`Commands registered successfully in ${successCount}/${guilds.size} guilds`);
            console.log('Registered commands:');
            commands.forEach(cmd => console.log(`  - /${cmd.name}`));
            console.log('\n=== End Command Registration ===\n');
            
        } catch (error) {
            console.error('\n❌ Error registering slash commands:', error);
        }
    }

    async stop() {
        console.log('Stopping Discord service...');
        try {
            this.isInitialized = false;

            // Clear all timeouts
            for (const task of this.contextSummaryTasks.values()) {
                clearTimeout(task);
            }
            this.contextSummaryTasks.clear();
            this.lastActivityTimestamps.clear();

            // Cleanup AI services
            for (const service of this.aiServices.values()) {
                await service.cleanup();
            }
            this.aiServices.clear();

            // Cleanup MCP servers
            if (this.serverManager) {
                console.log('Stopping MCP servers...');
                const serverIds = this.serverManager.getServerIds();
                await Promise.all(serverIds.map(async id => {
                    try {
                        await this.serverManager!.unregisterServer(id);
                        console.log(`Server ${id} stopped`);
                    } catch (error) {
                        console.error(`Error stopping server ${id}:`, error);
                    }
                }));
            }

            // Cleanup Discord client
            if (this.client) {
                console.log('Destroying Discord client...');
                await this.client.destroy();
            }

            console.log('Discord service stopped successfully');
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

    public getClient(): Client {
        return this.client;
    }

    static async getInstance(): Promise<DiscordService> {
        if (!DiscordService.instance) {
            const token = process.env.DISCORD_TOKEN;
            if (!token) {
                throw new Error('DISCORD_TOKEN environment variable is not set');
            }
            
            DiscordService.instance = new DiscordService(
                token,
                DatabaseService.getInstance()
            );

            // Initialize the service
            await DiscordService.instance.start();
        }
        return DiscordService.instance;
    }

    /**
     * Get the MCP container for external use
     * @returns The MCP container instance
     */
    getMCPContainer(): MCPContainer | undefined {
        return this.mcpContainer;
    }
}
