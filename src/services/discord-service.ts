import { Client, Events, GatewayIntentBits, Message as DiscordMessage, TextChannel, Message } from 'discord.js';
import { DatabaseService } from './db-service.js';
import { AIModel, Message as DBMessage, Role } from '../types/index.js';
import { AIService } from '../types/ai-service.js';
import { AIServiceFactory } from './ai-service-factory.js';
import { TaskManager } from '../tasks/task-manager.js';
import { CommandParserService, CommandParserError } from '../utils/command-parser-service.js';
import { PerformanceMonitoringService } from './performance/performance-monitoring.service.js';
import { debug, defaultConfig } from '../utils/config.js';
import { IServerManager } from '../tools/mcp/interfaces/core.js';
import { MCPContainer } from '../tools/mcp/di/container.js';
import { mcpConfig } from '../tools/mcp/mcp_config.js';
import { CacheService, CacheType } from './cache/cache-service.js';
import { CommandHandler, DiscordContext, DiscordCachedMessage, DiscordCachedConversation } from '../types/discord.js';

export class DiscordService {
    private client: Client;
    private db: DatabaseService;
    private static instance: DiscordService;
    private aiServices: Map<string, AIService> = new Map();
    private readonly contextRefreshInterval = 30 * 60 * 1000;
    private contextSummaryTasks: Map<string, NodeJS.Timeout> = new Map();
    private lastActivityTimestamps: Map<string, number> = new Map();
    private commandHandlers: Map<string, CommandHandler> = new Map();
    private taskManager: TaskManager;
    private performanceMonitoring: PerformanceMonitoringService;
    private mcpContainer?: MCPContainer;
    private serverManager?: IServerManager;
    private commandParser: CommandParserService;
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
        this.taskManager = TaskManager.getInstance();
        this.performanceMonitoring = PerformanceMonitoringService.getInstance();
        this.commandParser = CommandParserService.getInstance();
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

    private initializeCommandHandlers() {
        this.commandHandlers = new Map([
            ['create', {
                action: 'create',
                handler: async (message, params) => {
                    const task = await this.taskManager.createTask({
                        title: params.title,
                        description: params.description,
                        creatorId: message.author.id,
                        tags: [],
                    });
                    await this.sendMessage(message.channel as TextChannel, 
                        `✅ Task #${task.id} created: ${task.title}`, 
                        message
                    );
                }
            }],
            ['stats', {
                action: 'stats',
                handler: async (message) => {
                    const metrics = await this.performanceMonitoring.generatePerformanceDashboard();
                    const taskMetrics = metrics.taskMetrics;

                    let response = '```\nTask Performance Metrics:\n\n';
                    
                    // Overall stats
                    response += `📊 Total Tasks: ${taskMetrics.totalTasks}\n`;
                    response += `✅ Completion Rate: ${(taskMetrics.completionRate * 100).toFixed(1)}%\n`;
                    response += `⏱️ Avg Completion Time: ${(taskMetrics.averageCompletionTime / (1000 * 60 * 60)).toFixed(1)} hours\n`;
                    
                    // Status breakdown
                    response += '\nStatus Breakdown:\n';
                    Object.entries(taskMetrics.tasksPerStatus).forEach(([status, count]) => {
                        response += `${this.getStatusEmoji(status)} ${status}: ${count}\n`;
                    });

                    // Priority breakdown
                    response += '\nPriority Distribution:\n';
                    Object.entries(taskMetrics.tasksByPriority).forEach(([priority, count]) => {
                        response += `${this.getPriorityEmoji(priority)} ${priority}: ${count}\n`;
                    });

                    // Active and overdue
                    response += `\n📈 Active Tasks: ${taskMetrics.activeTasksCount}\n`;
                    response += `⚠️ Overdue Tasks: ${taskMetrics.overdueTasksCount}\n`;
                    
                    response += '```';
                    await this.sendMessage(message.channel as TextChannel, response, message);
                }
            }],
            ['list', {
                action: 'list',
                handler: async (message) => {
                    const tasks = await this.taskManager.getUserTasks(message.author.id);
                    let response = '```\nYour Tasks:\n\n';
                    
                    if (tasks.created.length === 0 && tasks.assigned.length === 0) {
                        response += '📝 No tasks found.\n';
                    } else {
                        if (tasks.created.length > 0) {
                            response += '✨ Created by you:\n';
                            tasks.created.forEach(task => {
                                response += `\n#${task.id}. ${task.title}
    📋 What to do: ${task.description || 'No description provided'}
    ${this.getStatusEmoji(task.status)} Since ${this.formatDate(task.createdAt)}\n`;
                            });
                        }
                        
                        if (tasks.assigned.length > 0) {
                            response += '\n📋 Assigned to you:\n';
                            tasks.assigned.forEach(task => {
                                response += `\n#${task.id}. ${task.title}
    📋 What to do: ${task.description || 'No description provided'}
    ${this.getStatusEmoji(task.status)} Status since ${this.formatDate(task.createdAt)}\n`;
                            });
                        }
                    }
                    response += '```';
                    await this.sendMessage(message.channel as TextChannel, response, message);
                }
            }],
            ['view', {
                action: 'view',
                handler: async (message, params) => {
                    const task = await this.taskManager.getTaskDetails(params.id);
                    const response = this.formatTaskDetails(task);
                    await this.sendMessage(message.channel as TextChannel, response, message);
                }
            }],
            ['update', {
                action: 'update',
                handler: async (message, params) => {
                    await this.taskManager.updateTaskStatus(params.id, params.status, message.author.id);
                    await this.sendMessage(message.channel as TextChannel, 
                        `✅ Task #${params.id} status updated to ${params.status}`, 
                        message
                    );
                }
            }],
            ['assign', {
                action: 'assign',
                handler: async (message, params) => {
                    await this.taskManager.assignTask(params.id, params.assigneeId, message.author.id);
                    await this.sendMessage(message.channel as TextChannel, 
                        `✅ Task #${params.id} assigned to <@${params.assigneeId}>`, 
                        message
                    );
                }
            }],
            ['delete', {
                action: 'delete',
                handler: async (message, params) => {
                    await this.taskManager.deleteTask(params.id, message.author.id);
                    await this.sendMessage(message.channel as TextChannel, 
                        `✅ Task #${params.id} deleted`, 
                        message
                    );
                }
            }]
        ]);
    }

    private formatDate(date: Date | string): string {
        return new Date(date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    private async handleCommand(message: DiscordMessage, command: { action: string; parameters: any }): Promise<void> {
        const handler = this.commandHandlers.get(command.action);
        if (handler) {
            try {
                await handler.handler(message, command.parameters);
            } catch (error) {
                await this.sendMessage(message.channel as TextChannel, 
                    `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 
                    message
                );
            }
        } else {
            await this.sendMessage(message.channel as TextChannel, 
                '❌ Unknown command. Available commands: create, list, view, update, assign, delete, stats', 
                message
            );
        }
    }

    private async handleMessage(message: Message): Promise<void> {
        if (message.author.bot) return;

        // Try to parse as a command first
        try {
            const parsedCommand = this.commandParser.parse(message.content);
            await this.handleCommand(message as DiscordMessage, parsedCommand);
            return;
        } catch (error) {
            // If it's not a valid command (CommandParserError), proceed with AI processing
            if (!(error instanceof CommandParserError)) {
                console.error('Error parsing command:', error);
                await message.reply('Sorry, I encountered an error processing your command.');
                return;
            }
        }

        // Handle as a conversation with AI
        try {
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

            const response = await service.processMessage(message.content, messages);

            // Update database
            await this.db.addMessage(conversation.id, message.content, 'user');
            await this.db.addMessage(conversation.id, response.content, 'assistant');

            // Update cache with new messages and handle errors
            const newUserMessage: DiscordCachedMessage = {
                content: message.content,
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
            // Initialize cache first
            await this.initializeCache();

            // Initialize command handlers
            this.initializeCommandHandlers();

            // Set up event handlers
            this.setupEventHandlers();

            // Initialize MCP if enabled
            if (defaultConfig.discord.mcp.enabled) {
                console.log('Initializing MCP...');
                
                // Create and configure MCP container
                this.mcpContainer = new MCPContainer(mcpConfig);
                this.serverManager = this.mcpContainer.getServerManager();

                // Get and initialize the MCP client using the first available server
                const servers = Object.values(mcpConfig.mcpServers);
                if (servers.length === 0) {
                    throw new Error('No MCP servers configured');
                }
                const mcpClient = this.mcpContainer.getMCPClient(servers[0].id);
                await mcpClient.initialize();
                console.log('MCP client initialized and connected');

                // Start all configured servers
                const configuredServers = Object.keys(mcpConfig.mcpServers);
                for (const serverId of configuredServers) {
                    console.log(`Starting server ${serverId}...`);
                    const config = mcpConfig.mcpServers[serverId];
                    await this.serverManager.startServer(serverId, config);
                }

                // Wait for servers to be ready
                const maxWaitTime = 30000;
                const startTime = Date.now();
                
                while (Date.now() - startTime < maxWaitTime) {
                    const runningServers = this.serverManager.getServerIds();
                    if (runningServers.length === configuredServers.length) {
                        // Wait a bit for servers to fully initialize
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        
                        // Initialize AIServiceFactory with the container
                        await AIServiceFactory.initialize(this.mcpContainer);
                        console.log('AIServiceFactory initialized');
                        console.log('MCP initialization complete');
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                if (Date.now() - startTime >= maxWaitTime) {
                    throw new Error('Timeout waiting for MCP servers to initialize');
                }
            }

            // Login to Discord
            console.log('Logging in to Discord...');
            await this.client.login(this.token);
            this.isInitialized = true;
            console.log('Discord bot started successfully');
        } catch (error) {
            console.error('Failed to start Discord client:', error);
            await this.stop();
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

    private getStatusEmoji(status: string): string {
        switch (status.toUpperCase()) {
            case 'OPEN':
                return '🟢 OPEN';
            case 'IN_PROGRESS':
                return '🔵 IN PROGRESS';
            case 'BLOCKED':
                return '🔴 BLOCKED';
            case 'COMPLETED':
                return '✅ COMPLETED';
            case 'CLOSED':
                return '⭕ CLOSED';
            default:
                return '❓';
        }
    }

    private getPriorityEmoji(priority: string): string {
        switch (priority.toUpperCase()) {
            case 'URGENT':
                return '🔥';
            case 'HIGH':
                return '⚡';
            case 'MEDIUM':
                return '⚪';
            case 'LOW':
                return '⚫';
            default:
                return '❓';
        }
    }

    private formatTaskDetails(task: any): string {
        let response = `**Task #${task.id}**\n`;
        response += `📌 **Title:** ${task.title}\n`;
        response += `🔄 **Status:** ${task.status}\n`;
        response += `📝 **Description:** ${task.description}\n`;
        response += `👤 **Created by:** <@${task.creatorId}>\n`;
        response += `👥 **Assigned to:** ${task.assigneeId ? `<@${task.assigneeId}>` : 'Unassigned'}\n`;
        
        if (task.history && task.history.length > 0) {
            response += '\n📋 **Recent History:**\n';
            task.history.slice(-3).forEach((entry: any) => {
                const timestamp = new Date(entry.createdAt).toLocaleString();
                response += `• ${timestamp}: ${this.formatHistoryEntry(entry)}\n`;
            });
        }

        return response;
    }

    private formatHistoryEntry(entry: any): string {
        switch (entry.action) {
            case 'CREATED':
                return 'Task created';
            case 'STATUS_CHANGED':
                return `Status changed from ${entry.oldValue} to ${entry.newValue}`;
            case 'ASSIGNED':
                return `Assigned to <@${entry.newValue}>`;
            case 'UNASSIGNED':
                return 'Unassigned';
            default:
                return entry.action;
        }
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
}
