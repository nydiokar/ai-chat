import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { TaskManager } from '../task-manager.js';
import { TaskStatus, TaskPriority } from '../../../types/task.js';
import { PrismaClient } from '@prisma/client';

export const taskCommands = new SlashCommandBuilder()
    .setName('task')
    .setDescription('Manage tasks')
    .addSubcommand(subcommand =>
        subcommand
            .setName('create')
            .setDescription('Create a new task')
            .addStringOption(option =>
                option.setName('title')
                    .setDescription('Task title')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('description')
                    .setDescription('Task description')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('priority')
                    .setDescription('Task priority')
                    .setRequired(false)
                    .addChoices(
                        { name: 'Low', value: TaskPriority.LOW },
                        { name: 'Medium', value: TaskPriority.MEDIUM },
                        { name: 'High', value: TaskPriority.HIGH },
                        { name: 'Urgent', value: TaskPriority.URGENT }
                    )))
    .addSubcommand(subcommand =>
        subcommand
            .setName('view')
            .setDescription('View task details')
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('Task ID')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('update')
            .setDescription('Update task status')
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('Task ID')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('status')
                    .setDescription('New status')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Open', value: TaskStatus.OPEN },
                        { name: 'In Progress', value: TaskStatus.IN_PROGRESS },
                        { name: 'Completed', value: TaskStatus.COMPLETED },
                        { name: 'Cancelled', value: TaskStatus.CANCELLED },
                        { name: 'Blocked', value: TaskStatus.BLOCKED }
                    )))
    .addSubcommand(subcommand =>
        subcommand
            .setName('assign')
            .setDescription('Assign a task to a user')
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('Task ID')
                    .setRequired(true))
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('User to assign the task to')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('list')
            .setDescription('List tasks')
            .addStringOption(option =>
                option.setName('status')
                    .setDescription('Filter by status')
                    .setRequired(false)
                    .addChoices(
                        { name: 'Open', value: TaskStatus.OPEN },
                        { name: 'In Progress', value: TaskStatus.IN_PROGRESS },
                        { name: 'Completed', value: TaskStatus.COMPLETED },
                        { name: 'Cancelled', value: TaskStatus.CANCELLED },
                        { name: 'Blocked', value: TaskStatus.BLOCKED }
                    )))
    .addSubcommand(subcommand =>
        subcommand
            .setName('delete')
            .setDescription('Delete a task')
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('Task ID')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('stats')
            .setDescription('Show task statistics'))
    .addSubcommand(subcommand =>
        subcommand
            .setName('help')
            .setDescription('Show task commands help'));

export function getTaskHelpMenu(): string {
    return `📋 **Task Management System** 📋

Create, track, and manage tasks with the team.

**Quick Commands:**
✨ **/task create** - Create a new task
  Example: /task create title:"Deploy website" description:"Deploy the new website to production"

🔍 **/task view** - View task details
  Example: /task view id:123

🔄 **/task update** - Update task status
  Example: /task update id:123 status:IN_PROGRESS

👤 **/task assign** - Assign a task to someone
  Example: /task assign id:123 user:@username

📋 **/task list** - List all your tasks
  • All tasks: /task list
  • By status: /task list status:OPEN

❌ **/task delete** - Delete a task
  Example: /task delete id:123

📊 **/task stats** - Show task statistics

**Status Types:**
• OPEN 🟢 - Task is open and ready to be worked on
• IN_PROGRESS 🔵 - Task is currently being worked on
• COMPLETED ✅ - Task has been completed
• CANCELLED ⭕ - Task has been cancelled
• BLOCKED 🔴 - Task is blocked by another task or issue

**Priority Levels:**
• LOW ⚫ - Low priority
• MEDIUM ⚪ - Medium priority
• HIGH ⚡ - High priority
• URGENT 🔥 - Urgent priority`;
}

// Function to ensure user exists in the database
async function ensureUserExists(userId: string, username: string): Promise<void> {
    const prisma = new PrismaClient();
    try {
        // Check if user exists
        const existingUser = await prisma.user.findUnique({
            where: { id: userId }
        });
        
        // If not, create the user
        if (!existingUser) {
            console.log(`Creating user record for Discord user ${userId} (${username})`);
            await prisma.user.create({
                data: {
                    id: userId,
                    username: username,
                    isActive: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
            });
        }
    } catch (error) {
        console.error('Error ensuring user exists:', error);
    } finally {
        await prisma.$disconnect();
    }
}

export async function handleTaskCommand(interaction: ChatInputCommandInteraction) {
    try {
        // Ensure the user exists in the database
        await ensureUserExists(interaction.user.id, interaction.user.username);
        
        const taskManager = TaskManager.getInstance();
        
        switch (interaction.options.getSubcommand()) {
            case 'help': {
                await interaction.reply({
                    content: getTaskHelpMenu(),
                    ephemeral: true
                });
                break;
            }
            
            case 'create': {
                const title = interaction.options.getString('title', true);
                const description = interaction.options.getString('description', true);
                const priority = interaction.options.getString('priority') as TaskPriority || TaskPriority.MEDIUM;
                
                const task = await taskManager.createTask({
                    title,
                    description,
                    creatorId: interaction.user.id,
                    priority,
                    tags: []
                });
                
                await interaction.reply({
                    content: `✅ Task #${task.id} created: ${task.title}`,
                    ephemeral: false
                });
                break;
            }
            
            case 'view': {
                const id = interaction.options.getInteger('id', true);
                const task = await taskManager.getTaskDetails(id);
                
                // Format task details
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
                        response += `• ${timestamp}: ${formatHistoryEntry(entry)}\n`;
                    });
                }
                
                await interaction.reply({
                    content: response,
                    ephemeral: false
                });
                break;
            }
            
            case 'update': {
                const id = interaction.options.getInteger('id', true);
                const status = interaction.options.getString('status', true) as TaskStatus;
                
                await taskManager.updateTaskStatus(id, status, interaction.user.id);
                
                await interaction.reply({
                    content: `✅ Task #${id} status updated to ${status}`,
                    ephemeral: false
                });
                break;
            }
            
            case 'assign': {
                const id = interaction.options.getInteger('id', true);
                const user = interaction.options.getUser('user', true);
                
                await taskManager.assignTask(id, user.id, interaction.user.id);
                
                await interaction.reply({
                    content: `✅ Task #${id} assigned to <@${user.id}>`,
                    ephemeral: false
                });
                break;
            }
            
            case 'list': {
                const status = interaction.options.getString('status') as TaskStatus | undefined;
                const tasks = await taskManager.getUserTasks(interaction.user.id);
                
                let response = '**Your Tasks:**\n\n';
                
                if (tasks.created.length === 0 && tasks.assigned.length === 0) {
                    response += '📝 No tasks found.\n';
                } else {
                    // Filter by status if provided
                    const createdTasks = status 
                        ? tasks.created.filter((task: any) => task.status === status)
                        : tasks.created;
                        
                    const assignedTasks = status
                        ? tasks.assigned.filter((task: any) => task.status === status)
                        : tasks.assigned;
                    
                    if (createdTasks.length > 0) {
                        response += '✨ **Created by you:**\n\n';
                        createdTasks.forEach((task: any) => {
                            const statusEmoji = getStatusEmoji(task.status);
                            const priorityEmoji = getPriorityEmoji(task.priority);
                            
                            response += `**#${task.id}. ${task.title}**\n`;
                            response += `📋 **What to do:** ${task.description || 'No description provided'}\n`;
                            response += `${statusEmoji} **Status:** ${task.status} Since ${formatDate(task.createdAt)}\n`;
                            response += `${priorityEmoji} **Priority:** ${task.priority}\n`;
                            
                            if (task.assigneeId) {
                                response += `👤 **Assigned to:** <@${task.assigneeId}>\n`;
                            }
                            
                            if (task.dueDate) {
                                const dueDate = new Date(task.dueDate);
                                const now = new Date();
                                const isOverdue = dueDate < now && task.status !== TaskStatus.COMPLETED;
                                response += `${isOverdue ? '⚠️' : '📅'} **Due:** ${formatDate(task.dueDate)}${isOverdue ? ' (OVERDUE)' : ''}\n`;
                            }
                            
                            response += '\n';
                        });
                    }
                    
                    if (assignedTasks.length > 0) {
                        response += '📋 **Assigned to you:**\n\n';
                        assignedTasks.forEach((task: any) => {
                            const statusEmoji = getStatusEmoji(task.status);
                            const priorityEmoji = getPriorityEmoji(task.priority);
                            
                            response += `**#${task.id}. ${task.title}**\n`;
                            response += `📋 **What to do:** ${task.description || 'No description provided'}\n`;
                            response += `${statusEmoji} **Status:** ${task.status} Since ${formatDate(task.createdAt)}\n`;
                            response += `${priorityEmoji} **Priority:** ${task.priority}\n`;
                            response += `👤 **Created by:** <@${task.creatorId}>\n`;
                            
                            if (task.dueDate) {
                                const dueDate = new Date(task.dueDate);
                                const now = new Date();
                                const isOverdue = dueDate < now && task.status !== TaskStatus.COMPLETED;
                                response += `${isOverdue ? '⚠️' : '📅'} **Due:** ${formatDate(task.dueDate)}${isOverdue ? ' (OVERDUE)' : ''}\n`;
                            }
                            
                            response += '\n';
                        });
                    }
                }
                
                await interaction.reply({
                    content: response,
                    ephemeral: false
                });
                break;
            }
            
            case 'delete': {
                const id = interaction.options.getInteger('id', true);
                
                await taskManager.deleteTask(id, interaction.user.id);
                
                await interaction.reply({
                    content: `✅ Task #${id} deleted`,
                    ephemeral: false
                });
                break;
            }
            
            case 'stats': {
                const performanceMonitoring = await import('../../../services/performance/performance-monitoring.service.js');
                const metrics = await performanceMonitoring.PerformanceMonitoringService.getInstance().generatePerformanceDashboard();
                const taskMetrics = metrics.taskMetrics;

                let response = '**Task Performance Metrics:**\n\n';
                
                // Overall stats
                response += `📊 **Total Tasks:** ${taskMetrics.totalTasks}\n`;
                response += `✅ **Completion Rate:** ${(taskMetrics.completionRate * 100).toFixed(1)}%\n`;
                response += `⏱️ **Avg Completion Time:** ${(taskMetrics.averageCompletionTime / (1000 * 60 * 60)).toFixed(1)} hours\n\n`;
                
                // Status breakdown
                response += '**Status Breakdown:**\n';
                Object.entries(taskMetrics.tasksPerStatus).forEach(([status, count]) => {
                    response += `${getStatusEmoji(status)} ${status}: ${count}\n`;
                });

                // Priority breakdown
                response += '\n**Priority Distribution:**\n';
                Object.entries(taskMetrics.tasksByPriority).forEach(([priority, count]) => {
                    response += `${getPriorityEmoji(priority)} ${priority}: ${count}\n`;
                });

                // Active and overdue
                response += `\n📈 **Active Tasks:** ${taskMetrics.activeTasksCount}\n`;
                response += `⚠️ **Overdue Tasks:** ${taskMetrics.overdueTasksCount}\n`;
                
                await interaction.reply({
                    content: response,
                    ephemeral: false
                });
                break;
            }
        }
    } catch (error) {
        console.error('Error handling task command:', error);
        await interaction.reply({ 
            content: `❌ Error: ${error instanceof Error ? error.message : 'An unknown error occurred'}`,
            ephemeral: true 
        });
    }
}

function formatHistoryEntry(entry: any): string {
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

function formatDate(date: Date | string): string {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
    });
}

function getStatusEmoji(status: string): string {
    switch (status) {
        case TaskStatus.OPEN:
            return '🟢';
        case TaskStatus.IN_PROGRESS:
            return '🔵';
        case TaskStatus.COMPLETED:
            return '✅';
        case TaskStatus.CANCELLED:
            return '⭕';
        case TaskStatus.BLOCKED:
            return '🔴';
        default:
            return '❓';
    }
}

function getPriorityEmoji(priority: string): string {
    switch (priority) {
        case TaskPriority.LOW:
            return '⚫';
        case TaskPriority.MEDIUM:
            return '⚪';
        case TaskPriority.HIGH:
            return '⚡';
        case TaskPriority.URGENT:
            return '🔥';
        default:
            return '❓';
    }
} 