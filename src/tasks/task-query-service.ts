import { TaskManager } from './task-manager.js';
import { TaskFilters, TaskStatus, TaskPriority, TaskListResult } from '../types/task.js';
import { debug } from '../utils/config.js';

export class TaskQueryService {
  private static instance: TaskQueryService;
  private readonly taskManager: TaskManager;
  
  // Common keywords and their mappings
  private readonly statusKeywords = new Map<string, TaskStatus>([
    ['open', TaskStatus.OPEN],
    ['active', TaskStatus.IN_PROGRESS],
    ['in progress', TaskStatus.IN_PROGRESS],
    ['done', TaskStatus.COMPLETED],
    ['completed', TaskStatus.COMPLETED],
    ['finished', TaskStatus.COMPLETED],
    ['cancelled', TaskStatus.CANCELLED],
    ['canceled', TaskStatus.CANCELLED],
    ['blocked', TaskStatus.BLOCKED],
    ['stuck', TaskStatus.BLOCKED]
  ]);

  private readonly priorityKeywords = new Map<string, TaskPriority>([
    ['low', TaskPriority.LOW],
    ['medium', TaskPriority.MEDIUM],
    ['normal', TaskPriority.MEDIUM],
    ['high', TaskPriority.HIGH],
    ['urgent', TaskPriority.URGENT],
    ['critical', TaskPriority.URGENT]
  ]);

  private constructor() {
    this.taskManager = TaskManager.getInstance();
  }

  static getInstance(): TaskQueryService {
    if (!TaskQueryService.instance) {
      TaskQueryService.instance = new TaskQueryService();
    }
    return TaskQueryService.instance;
  }

  /**
   * Convert natural language query to task filters
   * @param query Natural language query string
   * @param userId Current user ID
   * @returns TaskFilters object
   */
  public async parseQuery(query: string, userId: string): Promise<TaskFilters> {
    const filters: TaskFilters = {};
    const lowercaseQuery = query.toLowerCase();

    // User context parsing
    if (lowercaseQuery.includes('my tasks') || lowercaseQuery.includes('assigned to me')) {
      filters.assigneeId = userId;
    }
    if (lowercaseQuery.includes('created by me')) {
      filters.creatorId = userId;
    }

    // Status parsing
    for (const [keyword, status] of this.statusKeywords) {
      if (lowercaseQuery.includes(keyword)) {
        filters.status = status;
        break;
      }
    }

    // Priority parsing
    if (lowercaseQuery.includes('urgent')) {
      filters.priority = TaskPriority.URGENT;
    } else if (lowercaseQuery.includes('high priority')) {
      filters.priority = TaskPriority.HIGH;
    } else if (lowercaseQuery.includes('medium priority')) {
      filters.priority = TaskPriority.MEDIUM;
    } else if (lowercaseQuery.includes('low priority')) {
      filters.priority = TaskPriority.LOW;
    }

    // Assignee parsing
    const assigneeMatch = lowercaseQuery.match(/assigned to (\w+)/i);
    if (assigneeMatch && assigneeMatch[1]) {
      // For testing purposes, we'll use a dummy assignee ID
      // In a real implementation, you would look up the user ID from a user service
      filters.assigneeId = `user-${assigneeMatch[1].toLowerCase()}`;
    }

    // Add pagination parsing
    const limitMatch = lowercaseQuery.match(/limit (\d+)/i);
    if (limitMatch && limitMatch[1]) {
        filters.limit = parseInt(limitMatch[1], 10);
    }

    debug(`Parsed query "${query}" to filters: ${JSON.stringify(filters)}`);
    return filters;
  }

  /**
   * Query tasks using natural language
   * @param query Natural language query string
   * @param userId Current user ID
   * @returns Filtered tasks
   */
  async queryTasks(query: string, userId: string): Promise<TaskListResult> {
    try {
      debug(`Processing natural language query: "${query}"`);
      const filters = await this.parseQuery(query, userId);
      return await this.taskManager.listTasks(filters);
    } catch (error) {
      throw new Error(`Failed to process task query: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get example queries that users can use
   * @returns Array of example queries
   */
  getExampleQueries(): string[] {
    return [
      'Show my tasks',
      'Find all high priority tasks',
      'Show tasks assigned to me',
      'List open tasks',
      'Show completed tasks',
      'Find urgent tasks',
      'Show tasks created by me',
      'List blocked tasks',
      'Show in progress tasks limit 5'
    ];
  }
}
