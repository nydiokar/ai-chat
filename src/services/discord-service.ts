import { Client, Events, GatewayIntentBits, Message as DiscordMessage, TextChannel, Message, REST, Routes } from 'discord.js';
import { DatabaseService } from './db-service.js';
import { AIModel, Message as DBMessage, Role } from '../types/index.js';
import { AIService } from '../types/ai-service.js';
import { AIServiceFactory } from './ai-service-factory.js';
import { defaultConfig } from '../utils/config.js';
import { debug } from '../utils/logger.js';
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
import { startDashboard } from '../tools/dashboard/dashboard.js';

export class DiscordService {
    private client: Client;
    private db: DatabaseService;
    private static instances: Map<string, DiscordService> = new Map();
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
            // Initialize session cache with proper error handling and memory services
            const env = process.env.NODE_ENV || 'development';
            const sessionFile = `logs/${env}/discord-sessions.json`;
            
            this.sessionCache = CacheService.getInstance({
                type: CacheType.PERSISTENT,
                namespace: 'discord-sessions',
                ttl: defaultConfig.discord.sessionTimeout * 60 * 60 * 1000, // Convert hours to ms
                filename: sessionFile,
                writeDelay: 100
            });
            
            debug('Cache service initialized');
        } catch (error) {
            console.error('Failed to initialize cache:', error);
            throw error;
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
                        defaultConfig.defaultModel,
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

            // Update database with explicit error handling
            try {
                debug(`Adding user message to conversation ${conversation.id}`);
                await this.db.addMessage(conversation.id, cleanContent, 'user', undefined, {
                    userId: message.author.id,
                    username: message.author.username,
                    guildId: message.guild?.id,
                    channelId: message.channelId
                });

                debug(`Adding assistant message to conversation ${conversation.id}`);
                await this.db.addMessage(conversation.id, response.content, 'assistant', undefined, {
                    channelId: message.channelId,
                    guildId: message.guild?.id
                });
            } catch (error) {
                debug(`Error adding messages to conversation ${conversation.id}: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }

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

    /**
     * Start the Discord bot
     */
    public async start(): Promise<void> {
        if (this.isInitialized) {
            console.warn('DiscordService is already initialized');
            return;
        }

        const MAX_RETRIES = 3;
        const INITIAL_RETRY_DELAY = 2000; // 2 seconds

        try {
            console.log('\n=== Discord Bot Initialization ===');
            
            console.log('\n1. Setting up event handlers...');
            await this.setupEventHandlers();
            console.log('   ✓ Event handlers configured');

            console.log('\n2. Setting up database connection...');
            await this.db.connect();


            console.log('\n3. Initializing cache service...');
            await this.initializeCache();


            // Initialize MCP if enabled
            if (defaultConfig.discord.mcp.enabled) {
                console.log('\n4. Initializing MCP...');
                
                // Create and configure MCP container
                this.mcpContainer = new MCPContainer(mcpConfig);
                this.serverManager = this.mcpContainer.getServerManager();
                console.log('  ✓ MCP container created');

                // Set up server manager event listeners for better monitoring
                this.serverManager.on('toolsChanged', (event) => {
                    console.log(`[DiscordService] Tools changed for server ${event.id}`);
                });
                
                this.serverManager.on('serverStarted', (event) => {
                    console.log(`[DiscordService] Server started: ${event.id}`);
                });
                
                this.serverManager.on('serverStopped', (event) => {
                    console.log(`[DiscordService] Server stopped: ${event.id}`);
                });
                
                this.serverManager.on('server.error', (error) => {
                    console.error(`[DiscordService] Server error: ${error.source}`, error.error);
                });

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
                    console.log('\n5. Starting MCP servers...');
                    let successCount = 0;
                    const totalServers = Object.keys(mcpConfig.mcpServers).length;
                    
                    for (const [serverId, config] of Object.entries(mcpConfig.mcpServers)) {
                        try {
                            await this.initServer(serverId, config);
                            console.log(`  ✓ Started ${serverId}`);
                            successCount++;
                        } catch (error) {
                            console.error(`  ✗ Failed to start ${serverId}:`, error);
                        }
                    }
                    console.log(`\nServers started: ${successCount}/${totalServers}`);

                    // Initialize AIServiceFactory with MCP container
                    console.log('\n6. Initializing AI Service Factory...');
                    try {
                        await AIServiceFactory.initialize(this.mcpContainer);
                        console.log('  ✓ AI Service Factory initialized');
                    } catch (error) {
                        console.error('  ✗ Failed to initialize AI Service Factory:', error);
                        // Don't throw here, we'll continue with degraded functionality
                    }

                } catch (mcpError) {
                    console.error('  ✗ Failed to initialize MCP:', mcpError);
                    // Initialize AIServiceFactory without MCP container for fallback functionality
                    console.log('\n6. Initializing AI Service Factory without MCP...');
                    try {
                        await AIServiceFactory.initialize(mcpConfig);
                        console.log('  ✓ AI Service Factory initialized in fallback mode');
                    } catch (error) {
                        console.error('  ✗ Failed to initialize AI Service Factory in fallback mode:', error);
                    }
                }

                // Initialize the MCP dashboard if enabled
                if (process.env.MCP_DASHBOARD_ENABLED === 'true') {
                    const dashboardPort = parseInt(process.env.MCP_DASHBOARD_PORT || '8080', 10);
                    console.log(`\nStarting MCP Dashboard on port ${dashboardPort}...`);
                    
                    try {
                        // Start the dashboard with the server manager
                        const dashboard = startDashboard(this.serverManager, dashboardPort);
                        console.log(`MCP Dashboard available at http://localhost:${dashboardPort}/`);
                    } catch (error) {
                        console.error('Error starting MCP Dashboard:', error);
                    }
                }
            } else {
                // If MCP is disabled, adjust step numbering and messaging
                console.log('\n4. Initializing AI Service Factory...');
                try {
                    await AIServiceFactory.initialize(mcpConfig);
                    console.log('  ✓ AI Service Factory initialized (MCP tools will be loaded if configured)');
                } catch (error) {
                    console.error('  ✗ Failed to initialize AI Service Factory:', error);
                }
            }

            // Login to Discord with retry logic
            console.log('\n5. Logging in to Discord...');
            let retryCount = 0;
            let lastError;

            while (retryCount < MAX_RETRIES) {
                try {
                    await this.client.login(this.token);
                    this.isInitialized = true;
                    console.log('  ✓ Successfully logged in');
                    break;
                } catch (error) {
                    lastError = error;
                    retryCount++;
                    
                    if (retryCount === MAX_RETRIES) {
                        console.error(`\n❌ Failed to login after ${MAX_RETRIES} attempts. Stopping bot.`);
                        throw error;
                    }

                    const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount - 1);
                    console.log(`Login attempt ${retryCount} failed. Retrying in ${delay/1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
            
            // Register slash commands
            if (this.isInitialized) {
                console.log('\n8. Setting up slash commands...');
                try {
                    await this.registerSlashCommands();
                } catch (error) {
                    console.error('  ✗ Failed to setup slash commands:', error);
                }
                
                console.log('\n=== Initialization Complete ===\n');
            }
            
        } catch (error) {
            console.error('\n❌ Failed to start Discord client:', error);
            await this.stop();
            throw error;
        }
    }

    private async registerSlashCommands() {
        try {
            // Get the client ID from the client object
            if (!this.client.user?.id) {
                debug('Client ID not available yet, skipping registration');
                return;
            }

            const commands = [
                hotTokensCommands.toJSON(),
                taskCommands.toJSON(),
                pulseCommand.toJSON()
            ];

            const rest = new REST().setToken(this.token);
            const guildId = process.env.DISCORD_GUILD_ID;

            debug('Started refreshing application (/) commands.');

            if (guildId) {
                // Register commands for specific guild only
                debug(`Registering commands for guild ${guildId}`);
                try {
                    await rest.put(
                        Routes.applicationGuildCommands(this.client.user.id, guildId),
                        { body: commands },
                    );
                    debug(`Successfully registered commands for guild ${guildId}`);
                } catch (error) {
                    console.error('Failed to register guild commands:', error);
                    throw error; // Let the error propagate to handle it properly
                }
            } else {
                // Register commands globally only if no guild ID is specified
                debug('Registering commands globally');
                await rest.put(
                    Routes.applicationCommands(this.client.user.id),
                    { body: commands },
                );
            }

            debug('Successfully reloaded application (/) commands.');
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

    private async initServer(serverId: string, config: any): Promise<void> {
        try {
            console.log(`[DiscordService] Initializing server ${serverId}...`);
            
            // First register the server with its config
            await this.serverManager?.registerServer(serverId, config);
            
            // Check if server is properly registered and in the correct state
            const server = this.serverManager?.getServer(serverId);
            if (!server) {
                throw new Error(`Server ${serverId} was not properly registered`);
            }
            
            console.log(`[DiscordService] Server registered: ${serverId}, state: ${server.state}`);
            
            // Server is already started by registerServer, but we can validate its state
            if (server.state !== 'RUNNING') {
                console.warn(`[DiscordService] Server ${serverId} is not running (state: ${server.state})`);
            } else {
                console.log(`[DiscordService] Server started: ${serverId}`);
            }
        } catch (error) {
            console.error(`[DiscordService] Failed to initialize server ${serverId}:`, error);
            throw error;
        }
    }
}
