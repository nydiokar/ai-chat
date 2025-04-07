import { Client, Events, GatewayIntentBits, Message as DiscordMessage, TextChannel, Message, REST, Routes } from 'discord.js';
import { DatabaseService } from './db-service.js';
import { AIModel, Message as DBMessage, Role, Model } from '../types/index.js';
import { AIFactory } from './ai-factory.js';
import { defaultConfig } from '../utils/config.js';
import { debug, error as logError } from '../utils/logger.js';
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
import path from 'path';
import fs from 'fs';
import type { CacheConfig } from '../types/cache/base.js';
import { createLogContext } from '../utils/log-utils.js';
import { Agent } from '../interfaces/agent.js';
import { Input } from '../types/common.js';
import { MessageRole } from '../types/index.js';
import { AIProviders } from '../utils/config.js';
import { ReActAgent } from '../agents/react-agent.js';

export class DiscordService {
    private client: Client;
    private db: DatabaseService;
    private static instances: Map<string, DiscordService> = new Map();
    private aiServices: Map<string, Agent> = new Map();
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
                GatewayIntentBits.Guilds,           // Required for basic server functionality
                GatewayIntentBits.GuildMessages,    // Required for message handling in servers
                GatewayIntentBits.MessageContent,   // Required to read message content
                GatewayIntentBits.DirectMessages,   // Required for DM support
                GatewayIntentBits.GuildMembers      // Required for user management
            ]
        });
        this.db = dbService;
    }

    private async initializeCache(): Promise<void> {
        try {
            debug('Initializing cache service...');
            
            const env = process.env.NODE_ENV || 'development';
            const cacheDir = path.join(process.cwd(), 'cache', env);
            
            // Ensure cache directory exists
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
            }

            const sessionFile = path.join(cacheDir, 'discord-sessions.cache');
            
            const cacheConfig: CacheConfig = {
                type: CacheType.PERSISTENT,
                namespace: 'discord-sessions',
                ttl: defaultConfig.discord.sessionTimeout * 60 * 60 * 1000, // Convert hours to ms
                filename: sessionFile,
                writeDelay: 1000 // Increased delay to reduce I/O
            };
            
            this.sessionCache = CacheService.getInstance(cacheConfig);
            
            debug('Cache service initialized');
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logError('Failed to initialize cache', createLogContext(
                'DiscordService',
                'initializeCache',
                { error: err.message }
            ));
            throw err;
        }
    }

    private async handleMessage(message: Message): Promise<void> {
        if (message.author.bot) return;

        // Check if message is from the allowed guild
        const allowedGuildId = process.env.DISCORD_GUILD_ID;
        if (allowedGuildId && message.guild?.id !== allowedGuildId) {
            debug(`Message ignored - not from allowed guild. Message guild: ${message.guild?.id}, Allowed guild: ${allowedGuildId}`);
            return;
        }

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

        // Check for debug mode command
        if (cleanContent.toLowerCase().startsWith('debug')) {
            const args = cleanContent.split(' ');
            if (args[1]?.toLowerCase() === 'on') {
                const service = this.aiServices.get(message.channelId);
                if (service && service instanceof ReActAgent) {
                    service.setDebugMode(true);
                    await message.reply('Debug mode enabled - showing full thought process');
                }
                return;
            } else if (args[1]?.toLowerCase() === 'off') {
                const service = this.aiServices.get(message.channelId);
                if (service && service instanceof ReActAgent) {
                    service.setDebugMode(false);
                    await message.reply('Debug mode disabled - showing clean responses');
                }
                return;
            }
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
                    // Verify the cached conversation still exists in the database
                    const dbConversation = await this.db.getConversation(cachedSession.id);
                    if (dbConversation) {
                        conversation = cachedSession;
                        debug('Using cached session');
                    } else {
                        debug('Cached conversation not found in database, creating new one');
                    }
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
                    
                    // Create conversation and immediately verify it exists
                    const conversationId = await this.db.createConversation(
                        defaultConfig.openai.model as AIModel,  // Use the actual OpenAI model name
                        undefined,
                        undefined,
                        context
                    );
                    
                    // Verify the conversation was created
                    conversation = await this.db.getConversation(conversationId);
                    if (!conversation) {
                        throw new Error(`Failed to create conversation - could not verify conversation ${conversationId} exists`);
                    }
                    debug(`Created and verified new conversation with ID: ${conversationId}`);
                }

                // Cache the conversation with retry mechanism
                try {
                    await this.sessionCache.set(sessionKey, conversation as DiscordCachedConversation);
                } catch (error) {
                    debug(`Failed to cache conversation: ${error instanceof Error ? error.message : String(error)}`);
                }
            }

            // Double check we have a valid conversation before proceeding
            if (!conversation || !conversation.id) {
                throw new Error('No valid conversation available');
            }

            let service: Agent;
            const existingService = this.aiServices.get(conversation.id.toString());
            if (!existingService) {
                service = AIFactory.create(conversation.model as AIModel);
                this.aiServices.set(conversation.id.toString(), service);
            } else {
                service = existingService;
            }

            // Get messages for LLM context
            const llmMessages = conversation.messages
                .slice(-defaultConfig.messageHandling.maxContextMessages)
                .map((msg: DiscordCachedMessage): Input => ({
                    role: msg.role as MessageRole,
                    content: msg.content,
                    name: undefined,
                    tool_call_id: undefined
                }));

            // Use the cleaned content (without the bot mention) for processing
            const response = await service.processMessage(cleanContent, llmMessages);

            // Update database with explicit error handling
            try {
                // Create database message format
                const dbUserMessage: DiscordCachedMessage = {
                    id: Date.now(),
                    content: cleanContent,
                    role: 'user' as MessageRole,
                    createdAt: new Date(),
                    conversationId: conversation.id,
                    tokenCount: null,
                    discordUserId: message.author.id,
                    discordUsername: message.author.username,
                    discordChannelId: message.channelId,
                    discordGuildId: message.guild?.id || null,
                    contextId: null,
                    parentMessageId: null
                };

                const dbAssistantMessage: DiscordCachedMessage = {
                    id: Date.now() + 1,
                    content: response.content,
                    role: 'assistant' as MessageRole,
                    createdAt: new Date(),
                    conversationId: conversation.id,
                    tokenCount: null,
                    discordUserId: null,
                    discordUsername: null,
                    discordChannelId: message.channelId,
                    discordGuildId: message.guild?.id || null,
                    contextId: null,
                    parentMessageId: null
                };

                await this.db.addMessage(conversation.id, dbUserMessage.content, 'user' as MessageRole, undefined, {
                    userId: message.author.id,
                    username: message.author.username,
                    guildId: message.guild?.id,
                    channelId: message.channelId
                });

                await this.db.addMessage(conversation.id, dbAssistantMessage.content, 'assistant' as MessageRole, undefined, {
                    channelId: message.channelId,
                    guildId: message.guild?.id
                });

                // Update cache with new messages
                conversation.messages.push(dbUserMessage, dbAssistantMessage);
            } catch (error) {
                throw error;
            }

            // Update cache with new messages and handle errors
            const newUserMessage: DiscordCachedMessage = {
                content: cleanContent,
                role: 'user' as MessageRole,
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
                role: 'assistant' as MessageRole,
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

            // Split and send message in chunks if needed
            const messageChunks = this.splitMessage(response.content);
            for (const chunk of messageChunks) {
                await message.reply(chunk);
            }
            
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

                // Cast model to AIModel since we know it's valid from the database
                await this.summarizeConversation({
                    ...conversation,
                    model: conversation.model as AIModel
                });
            }

            // Schedule next check without full reinitialization
            this.scheduleNextContextCheck(contextKey, conversationId);
        } catch (error) {
            console.error('Error in context summarization:', error);
        }
    }

    private async summarizeConversation(conversation: { id: number; model: string; messages: DiscordCachedMessage[] }) {
        try {
            // Validate model
            if (!Object.values(Model).includes(conversation.model as any)) {
                debug(`Invalid model type: ${conversation.model}`);
                return null;
            }

            const service = this.aiServices.get(conversation.id.toString());
            if (!service) {
                debug(`No AI service found for conversation ${conversation.id}`);
                return;
            }

            // Convert cached messages to Input type
            const messages: Input[] = conversation.messages.map(msg => ({
                role: msg.role as MessageRole,
                content: msg.content,
                name: undefined,
                tool_call_id: undefined
            }));

            // Request a summary using the agent
            const response = await service.processMessage(
                "Please provide a brief summary of the conversation context so far.",
                messages
            );

            return response;
        } catch (error) {
            debug(`Error summarizing conversation: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
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

    /**
     * Start the Discord bot
     */
    public async start(): Promise<void> {
        try {
            if (this.isInitialized) {
                debug('Discord service already initialized');
                return;
            }

            debug('Initializing Discord service...');

            // Initialize MCP container
            try {
                this.mcpContainer = new MCPContainer(mcpConfig);
                // Container is initialized in constructor
                this.serverManager = this.mcpContainer.getServerManager();
                debug('MCP container initialized');

                // Initialize AIFactory with MCP container
                await AIFactory.initialize(this.mcpContainer);
                debug('AIFactory initialized with MCP container');
            } catch (error) {
                logError('Failed to initialize MCP container and AIFactory, continuing without it', createLogContext(
                    'DiscordService',
                    'start',
                    { error: error instanceof Error ? error.message : String(error) }
                ));
            }

            // Initialize cache
            await this.initializeCache();

            // Set up event handlers
            this.setupEventHandlers();

            // Login to Discord
            await this.client.login(this.token);
            debug('Logged in to Discord');

            // Register slash commands
            await this.registerSlashCommands();
            debug('Slash commands registered');

            this.isInitialized = true;
            debug('Discord service initialized');
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logError('Failed to start Discord service', createLogContext(
                'DiscordService',
                'start',
                { error: err.message }
            ));
            throw err;
        }
    }

    private async registerSlashCommands() {
        try {
            // Get the client ID from the client object
            if (!this.client.user?.id) {
                debug('Client ID not available yet, skipping registration');
                return;
            }

            const rest = new REST().setToken(this.token);
            const guildId = process.env.DISCORD_GUILD_ID;
            const env = process.env.NODE_ENV || 'development';

            debug(`Registering commands for ${env} environment`);

            // Clean up and register commands based on environment
            if (guildId) {
                // For development: Clean up only this bot's commands in the guild
                if (env === 'development') {
                    debug('Development mode: Cleaning up guild commands for dev bot');
                    const existingCommands = await rest.get(
                        Routes.applicationGuildCommands(this.client.user.id, guildId)
                    ) as any[];
                    
                    // Delete each command individually instead of bulk delete
                    for (const command of existingCommands) {
                        await rest.delete(
                            Routes.applicationGuildCommand(this.client.user.id, guildId, command.id)
                        );
                    }
                    debug('Cleaned up dev bot guild commands');
                }
                // For production: Clean up all commands in the guild
                else if (env === 'production') {
                    debug('Production mode: Cleaning up all guild commands');
                    await rest.put(
                        Routes.applicationGuildCommands(this.client.user.id, guildId),
                        { body: [] }
                    );
                    debug('Cleaned up all guild commands');
                }

                // Register new commands
                const commands = [
                    hotTokensCommands.toJSON(),
                    taskCommands.toJSON(),
                    pulseCommand.toJSON()
                ];

                debug('Registering new commands...');
                
                try {
                    await rest.put(
                        Routes.applicationGuildCommands(this.client.user.id, guildId),
                        { body: commands },
                    );
                    debug(`Successfully registered ${commands.length} commands for guild ${guildId}`);
                } catch (error) {
                    debug('Guild registration failed, falling back to global registration');
                    await rest.put(
                        Routes.applicationCommands(this.client.user.id),
                        { body: commands },
                    );
                }
            } else {
                debug('No guild ID provided, registering commands globally');
                const commands = [
                    hotTokensCommands.toJSON(),
                    taskCommands.toJSON(),
                    pulseCommand.toJSON()
                ];
                await rest.put(
                    Routes.applicationCommands(this.client.user.id),
                    { body: commands },
                );
            }

            debug('Command registration complete');
        } catch (error) {
            console.error('Error refreshing commands:', error);
            throw error;
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

            // Cleanup AIFactory
            AIFactory.cleanup();
            debug('AIFactory cleaned up');

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

            // Remove instance from static map
            const env = process.env.NODE_ENV || 'development';
            DiscordService.instances.delete(env);

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
        const MAX_LENGTH = 1900; // Leave some room for formatting
        const messages: string[] = [];
        
        // Split on double newlines to preserve formatting
        const paragraphs = content.split('\n\n');
        let currentMessage = '';
        
        for (const paragraph of paragraphs) {
            // If adding this paragraph would exceed limit, push current message and start new one
            if (currentMessage.length + paragraph.length + 2 > MAX_LENGTH) {
                if (currentMessage) {
                    messages.push(currentMessage.trim());
                    currentMessage = '';
                }
                
                // If single paragraph is too long, split it
                if (paragraph.length > MAX_LENGTH) {
                    const words = paragraph.split(' ');
                    for (const word of words) {
                        if (currentMessage.length + word.length + 1 > MAX_LENGTH) {
                            messages.push(currentMessage.trim());
                            currentMessage = word;
                        } else {
                            currentMessage += (currentMessage ? ' ' : '') + word;
                        }
                    }
                } else {
                    currentMessage = paragraph;
                }
            } else {
                currentMessage += (currentMessage ? '\n\n' : '') + paragraph;
            }
        }
        
        if (currentMessage) {
            messages.push(currentMessage.trim());
        }
        
        return messages;
    }

    public getClient(): Client {
        return this.client;
    }

    static async getInstance(): Promise<DiscordService> {
        const env = process.env.NODE_ENV || 'development';
        
        if (!DiscordService.instances.has(env)) {
            const token = process.env.DISCORD_TOKEN;
            if (!token) {
                throw new Error('DISCORD_TOKEN environment variable is not set');
            }
            
            const instance = new DiscordService(
                token,
                DatabaseService.getInstance()
            );

            // Initialize the service
            await instance.start();
            DiscordService.instances.set(env, instance);
            
            debug(`Created new Discord service instance for environment: ${env}`);
        }
        
        return DiscordService.instances.get(env)!;
    }

    /**
     * Get the MCP container for external use
     * @returns The MCP container instance
     */
    getMCPContainer(): MCPContainer | undefined {
        return this.mcpContainer;
    }
}
