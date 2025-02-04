#!/usr/bin/env node
import boxen, { Options as BoxenOptions } from 'boxen';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import inquirerAutocompletePrompt from 'inquirer-autocomplete-prompt';
import { DatabaseService } from './services/db-service';
import { AIServiceFactory } from './services/ai-service-factory';
import { AIService } from './services/ai/base-service';
import { ConversationTraversalService } from './services/branching/conversation-traversal-service';
import { Message } from '@prisma/client';
import { DiscordMessageContext, Model } from './types/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Initialize services
const db = DatabaseService.getInstance();
const traversalService = ConversationTraversalService.getInstance();
let aiService: AIService;
let currentConversationId: number;
let currentModel: keyof typeof Model = 'gpt'; // Default model

// Add these variables for message navigation
let currentMessageIndex = 0;
let messageHistory: Message[] = [];

// Add this at the top with other interfaces
interface CLICommand {
    name: string;
    value: string;
    usage: string;
    description: string;
    command: (args: string[]) => Promise<void>;
}

// Add these interfaces
interface DisplayConfig {
    USER: DisplayRole;
    ASSISTANT: DisplayRole;
}

interface DisplayRole {
    title: string;
    color: 'blue' | 'white' | 'green' | 'yellow' | 'red' | 'magenta';
    align: 'right' | 'left';
}

const availableCommands: CLICommand[] = [
    {
        name: '!help - Show available commands',
        value: '!help',
        usage: '!help [command]',
        description: 'Show command documentation',
        command: async (args: string[]) => {
            const command = args[0];
            if (command) {
                const cmd = availableCommands.find(c => c.value === command);
                if (cmd) {
                    console.log(`\n${cmd.usage}: ${cmd.description}`);
                } else {
                    console.log(chalk.red(`Unknown command: ${command}`));
                }
            } else {
                console.log('\nAvailable CLI commands:');
                availableCommands.forEach(cmd => {
                    console.log(`${cmd.usage}: ${cmd.description}`);
                });
            }
            return conversation();
        }
    },
    {
        name: '!new - Start new conversation',
        value: '!new',
        usage: '!new [model]',
        description: 'Start a new conversation with optional model selection (gpt/claude/deepseek)',
        command: async (args: string[]) => newConversation(args[0] as keyof typeof Model)
    },
    {
        name: '!model - Switch AI model',
        value: '!model',
        usage: '!model <gpt|claude|deepseek>',
        description: 'Switch between different AI models',
        command: async (args: string[]) => switchModel(args[0] as keyof typeof Model)
    },
    {
        name: '!branch - Create conversation branch',
        value: '!branch',
        usage: '!branch [title]',
        description: 'Create a new branch from current conversation',
        command: async (args: string[]) => createBranch(args.join(' '))
    },
    {
        name: '!back - Go to parent branch',
        value: '!back',
        usage: '!back',
        description: 'Navigate to parent branch',
        command: async () => navigateToParentBranch()
    },
    {
        name: '!branches - List branches',
        value: '!branches',
        usage: '!branches',
        description: 'Show all available branches',
        command: async () => showBranches()
    },
    {
        name: '!goto - Go to branch',
        value: '!goto',
        usage: '!goto <branch_id>',
        description: 'Navigate to a specific branch by ID',
        command: async (args: string[]) => navigateToBranch(Number(args[0]))
    },
    {
        name: '!prev - Show previous message',
        value: '!prev',
        usage: '!prev',
        description: 'Navigate to previous message in conversation',
        command: async () => showPreviousMessage()
    },
    {
        name: '!next - Show next message',
        value: '!next',
        usage: '!next',
        description: 'Navigate to next message in conversation',
        command: async () => showNextMessage()
    },
    {
        name: '!exit - Exit the CLI',
        value: '!exit',
        usage: '!exit',
        description: 'Exit the CLI application',
        command: async () => {
            console.log(chalk.yellow('Exiting CLI...'));
            process.exit(0);
        }
    }
];

// Add this constant for display configuration
const displayConfig: DisplayConfig = {
    USER: {
        title: 'You',
        color: 'magenta',
        align: 'right'
    },
    ASSISTANT: {
        title: currentModel.toUpperCase() || 'AI',
        color: 'blue',
        align: 'left'
    }
};

// Create a CLI context that matches the Discord context structure
const cliContext: DiscordMessageContext = {
    channelId: 'cli',
    guildId: 'cli',
    userId: 'cli-user',
    username: 'cli-user'
};

// Setup logging with absolute path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logDir = path.join(__dirname, '..', 'logs');
const logFile = path.join(logDir, 'cli.log');

// Create logs directory if it doesn't exist
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// Enhanced logging function
function log(message: string, ...args: any[]) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} - ${message} ${args.length ? JSON.stringify(args, null, 2) : ''}`;
    
    try {
        // Write to log file
        fs.appendFileSync(logFile, logMessage + '\n');
        
        // Also show in console during development
        if (process.env.NODE_ENV === 'development') {
            console.log(chalk.gray(`[LOG] ${message}`), ...args);
        }
    } catch (error) {
        console.error('Logging failed:', error);
    }
}

// Add startup logging
process.on('uncaughtException', (error) => {
    log('UNCAUGHT EXCEPTION:', error);
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
    log('UNHANDLED REJECTION:', error);
    console.error('Unhandled Rejection:', error);
});

// Update initialize function with logging
async function initialize(): Promise<void> {
    try {
        log('CLI Starting...');
        log('Log file location:', logFile);
        
        log('Connecting to database...');
        await db.connect();
        
        log('Creating AI service...');
        aiService = AIServiceFactory.create('gpt');
        
        log('Starting new conversation...');
        const newConv = await newConversation();
        log('New conversation created:', { conversationId: currentConversationId });
        
        // Log terminal info
        log('Terminal info:', {
            columns: process.stdout.columns,
            rows: process.stdout.rows,
            isTTY: process.stdout.isTTY,
            platform: process.platform
        });
        
        return conversation();
    } catch (error) {
        log('Initialization failed:', error);
        console.error('Failed to initialize CLI:', error);
        throw error;
    }
}

// Add logging to conversation function
async function conversation(): Promise<void> {
    try {
        const { message } = await inquirer.prompt<{ message: string }>([{
            type: 'input',
            name: 'message',
            message: '> ',
            prefix: ''
        }]);

        log('Received input:', { message });

        if (message.startsWith('!')) {
            log('Processing command:', message);
            await handleCommand(message);
        } else {
            log('Processing message:', message);
            await generateResponse(message);
        }
        
        return conversation();
    } catch (error) {
        log('Conversation error:', error);
        return conversation();
    }
}

async function generateResponse(message: string): Promise<void> {
    // Don't process commands through AI service
    if (message.startsWith('!')) {
        const [command, ...args] = message.split(' ');
        const cmd = availableCommands.find(c => c.value === command);
        if (cmd) {
            await cmd.command(args);
            return;
        } else {
            console.log(chalk.red('Unknown command. Type !help to see available commands.'));
            return;
        }
    }

    const spinner = ora('Generating response...').start();
    try {
        await db.addMessage(
            currentConversationId,
            message,
            'user'
        );

        const response = await aiService.generateResponse(message, []);

        await db.addMessage(
            currentConversationId,
            response.content,
            'assistant',
            response.tokenCount
        );

        await showCurrentConversation();
    } catch (error) {
        console.error('Error generating response:', error);
        console.log(chalk.red('Failed to generate response. Please try again.'));
    } finally {
        spinner.stop();
    }
}

async function newConversation(model?: keyof typeof Model): Promise<void> {
    if (model) {
        currentModel = model;
        aiService = AIServiceFactory.create(model.toLowerCase() as 'gpt' | 'claude' | 'deepseek');
    }

    currentConversationId = await db.createConversation(
        currentModel,
        'New Conversation',
        cliContext.channelId
    );

    currentMessageIndex = 0;
    messageHistory = [];
    
    console.log(chalk.green('Started new conversation'));
    return conversation();
}

async function switchModel(model: keyof typeof Model): Promise<void> {
    if (!model || !Object.keys(Model).includes(model)) {
        console.log(chalk.red('Invalid model. Available models: GPT_4, CLAUDE, DEEPSEEK'));
        return conversation();
    }

    currentModel = model;
    aiService = AIServiceFactory.create(model.toLowerCase() as 'gpt' | 'claude' | 'deepseek');
    console.log(chalk.green(`Switched to ${model} model`));
    return conversation();
}

async function createBranch(title?: string): Promise<void> {
    try {
        const conversationData = await db.getConversation(currentConversationId);
        const lastMessage = conversationData.messages[conversationData.messages.length - 1];
        
        if (!lastMessage) {
            console.log(chalk.yellow('Cannot create branch: No messages in conversation'));
            return await conversation();
        }

        // Match the expected parameters of traversalService.createBranch
        const result = await traversalService.createBranch(
            currentConversationId,      // sourceConversationId: number
            lastMessage.id.toString(),   // parentMessageId: string
            title || undefined          // title?: string
        );
        
        currentConversationId = result.conversationId;
        console.log(chalk.green(`Created new branch ${result.branchId}`));
        await showCurrentConversation();
    } catch (error) {
        console.error('Failed to create branch:', error);
        console.log(chalk.red('Failed to create conversation branch'));
    }
    return await conversation();
}

async function showCurrentConversation(): Promise<void> {
    try {
        console.clear();
        const conversation = await db.getConversation(currentConversationId);
        
        log('Showing conversation:', {
            id: currentConversationId,
            messageCount: conversation?.messages?.length || 0,
            model: currentModel
        });

        if (!conversation) {
            log('No conversation found');
            console.error('No conversation found');
            return;
        }

        console.log(chalk.gray(`\nConversation #${currentConversationId} - ${conversation.messages.length} messages\n`));
        
        conversation.messages.forEach((msg: Message) => {
            const role = msg.role.toLowerCase() === 'user' ? 'USER' : 'ASSISTANT';
            const config = displayConfig[role];
            
            if (process.platform === 'win32') {
                const prefix = role === 'USER' ? 
                    chalk.bgMagenta.white(' YOU ') : 
                    chalk.bgBlue.white(` ${currentModel.toUpperCase()} `);
                
                const content = msg.content;
                
                if (config.align === 'right') {
                    const padding = ' '.repeat(Math.max(0, process.stdout.columns - content.length - prefix.length - 5));
                    console.log(padding + prefix + ' ' + content);
                } else {
                    console.log(prefix + ' ' + content);
                }
                console.log();
            } else {
                const box = tryBoxen(msg.content, {
                    title: config.title,
                    padding: 0.7,
                    margin: 1,
                    borderColor: config.color,
                    float: config.align,
                    width: 60
                });
                
                if (config.align === 'right') {
                    const padding = ' '.repeat(Math.max(0, process.stdout.columns - 70));
                    console.log(padding + box);
                } else {
                    console.log(box);
                }
            }
        });
    } catch (error) {
        log('Error showing conversation:', error);
        console.error('Failed to show conversation:', error);
    }
}

function tryBoxen(input: string, options: BoxenOptions): string {
    try {
        return boxen(input, options);
    } catch {
        return input;
    }
}

// Add these new functions for branch navigation
async function navigateToParentBranch(): Promise<void> {
    try {
        const parentBranch = await traversalService.getParentBranch(currentConversationId);
        
        if (!parentBranch) {
            console.log(chalk.yellow('This is the main conversation (no parent branch).'));
            return conversation();
        }

        currentConversationId = parentBranch.id;
        console.log(chalk.green(`Navigated to parent branch: ${parentBranch.title || 'Untitled'}`));
        await showCurrentConversation();
    } catch (error) {
        console.error('Failed to navigate to parent branch:', error);
        console.log(chalk.red('Failed to navigate to parent branch'));
    }
    return conversation();
}

async function showBranches(): Promise<void> {
    try {
        const branches = await traversalService.getBranches(currentConversationId);
        
        if (branches.length === 0) {
            console.log(chalk.yellow('\nNo branches found for this conversation.'));
            return conversation();
        }

        console.log('\nAvailable branches:');
        branches.forEach(branch => {
            console.log(chalk.green(`ID: ${branch.id}`) + 
                       chalk.white(` - ${branch.title || 'Untitled'}`) +
                       chalk.gray(` (Created: ${new Date(branch.createdAt).toLocaleString()})`));
        });
    } catch (error) {
        console.error('Failed to show branches:', error);
        console.log(chalk.red('Failed to list branches'));
    }
    return conversation();
}

async function navigateToBranch(branchId: number): Promise<void> {
    try {
        if (!branchId || isNaN(branchId)) {
            console.log(chalk.red('Please provide a valid branch ID'));
            return conversation();
        }

        const targetBranch = await db.getConversation(branchId);
        if (!targetBranch) {
            console.log(chalk.red('Branch not found'));
            return conversation();
        }

        currentConversationId = branchId;
        console.log(chalk.green(`Navigated to branch: ${targetBranch.title || 'Untitled'}`));
        await showCurrentConversation();
    } catch (error) {
        console.error('Failed to navigate to branch:', error);
        console.log(chalk.red('Failed to navigate to branch'));
    }
    return conversation();
}

async function showPreviousMessage(): Promise<void> {
    if (currentMessageIndex > 0) {
        currentMessageIndex--;
        await showCurrentConversation();
    } else {
        console.log(chalk.yellow('Already at the beginning of conversation'));
    }
    return conversation();
}

async function showNextMessage(): Promise<void> {
    const conversationData = await db.getConversation(currentConversationId);
    if (currentMessageIndex < conversationData.messages.length - 1) {
        currentMessageIndex++;
        await showCurrentConversation();
    } else {
        console.log(chalk.yellow('Already at the end of conversation'));
    }
    return conversation();
}

// Update the SIGINT handler
process.on('SIGINT', () => {
    console.log(chalk.yellow('\nTo exit, please type !exit or press Ctrl+C again'));
    process.once('SIGINT', () => {
        console.log(chalk.yellow('\nForce exiting CLI...'));
        process.exit(0);
    });
});

// Add this debug function
function debugTerminal() {
    console.log({
        columns: process.stdout.columns,
        rows: process.stdout.rows,
        isTTY: process.stdout.isTTY
    });
}

// Add the handleCommand function
async function handleCommand(input: string): Promise<void> {
    try {
        const [command, ...args] = input.trim().slice(1).split(' '); // Remove the ! and split
        
        log('Executing command:', { command, args });
        
        switch (command.toLowerCase()) {
            case 'help':
                log('Showing help menu');
                console.log('\nAvailable commands:');
                availableCommands.forEach(cmd => {
                    console.log(chalk.yellow(`${cmd.usage}`) + chalk.gray(`: ${cmd.description}`));
                });
                break;
                
            case 'new':
                log('Creating new conversation');
                await newConversation(args[0] as keyof typeof Model);
                break;
                
            case 'model':
                log('Switching model');
                await switchModel(args[0] as keyof typeof Model);
                break;
                
            case 'branch':
                log('Creating branch');
                await createBranch(args.join(' '));
                break;
                
            case 'back':
                log('Navigating to parent branch');
                await navigateToParentBranch();
                break;
                
            case 'branches':
                log('Showing branches');
                await showBranches();
                break;
                
            case 'goto':
                log('Navigating to branch');
                await navigateToBranch(Number(args[0]));
                break;
                
            case 'prev':
                log('Showing previous message');
                await showPreviousMessage();
                break;
                
            case 'next':
                log('Showing next message');
                await showNextMessage();
                break;
                
            case 'exit':
                log('Exiting CLI');
                console.log(chalk.yellow('Exiting CLI...'));
                process.exit(0);
                break;
                
            default:
                log('Unknown command:', command);
                console.log(chalk.red(`Unknown command: ${command}`));
                console.log('Type !help to see available commands');
        }
    } catch (error) {
        log('Command execution failed:', { command: input, error });
        console.error('Failed to execute command:', error);
    }
}

// Update the main execution
console.log('Initializing CLI...');
initialize().catch(error => {
    console.error('Critical error in CLI:', error);
    // Keep the window open
    process.stdin.resume();
});
