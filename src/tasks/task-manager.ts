import { TaskRepository } from '../tasks/task-repository.js';
import { DatabaseError } from '../services/db-service.js';
import { debug } from '../config.js';
import {
  CreateTaskDTO,
  UpdateTaskDTO,
  TaskWithRelations,
  TaskStatus,
  TaskFilters,
  TaskListResult,
  UserTasks
} from '../types/task.js';

export class TaskManagerError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'TaskManagerError';
  }
}

export class TaskNotFoundError extends TaskManagerError {
  constructor(taskId: number) {
    super(`Task ${taskId} not found`);
    this.name = 'TaskNotFoundError';
  }
}

export class UnauthorizedTaskActionError extends TaskManagerError {
  constructor(message: string = 'User not authorized for this action') {
    super(message);
    this.name = 'UnauthorizedTaskActionError';
  }
}

export class TaskManager {
  private static instance: TaskManager;
  private readonly taskRepository: TaskRepository;

  private constructor() {
    this.taskRepository = TaskRepository.getInstance();
  }

  static getInstance(): TaskManager {
    if (!TaskManager.instance) {
      TaskManager.instance = new TaskManager();
    }
    return TaskManager.instance;
  }

  async createTask(taskData: CreateTaskDTO): Promise<TaskWithRelations> {
    try {
      debug('Creating task through TaskManager');
      return await this.taskRepository.createTask(taskData);
    } catch (error) {
      throw new TaskManagerError('Failed to create task', error as Error);
    }
  }

  /**
   * Updates the status of a task
   * @param taskId - The ID of the task to update
   * @param status - The new status to set
   * @param userId - The ID of the user performing the update
   * @throws {TaskNotFoundError} If the task doesn't exist
   * @throws {UnauthorizedTaskActionError} If the user isn't authorized
   * @returns {Promise<TaskWithRelations>} The updated task
   */
  async updateTaskStatus(taskId: number, status: TaskStatus, userId: string): Promise<TaskWithRelations> {
    try {
      debug(`Updating task ${taskId} status to ${status}`);
      const task = await this.taskRepository.getTask(taskId);
      
      if (!task) {
        throw new TaskManagerError(`Task ${taskId} not found`);
      }

      // Verify user has permission to update the task
      if (task.creatorId !== userId && task.assigneeId !== userId) {
        throw new TaskManagerError('User not authorized to update this task');
      }

      // Add completion date if task is being marked as completed
      const updateData: UpdateTaskDTO = {
        status,
      };

      return await this.taskRepository.updateTask(taskId, updateData);
    } catch (error) {
      throw new TaskManagerError(`Failed to update task status: ${error instanceof Error ? error.message : 'Unknown error'}`, error as Error);
    }
  }

  async assignTask(taskId: number, assigneeId: string, userId: string): Promise<TaskWithRelations> {
    try {
      debug(`Assigning task ${taskId} to user ${assigneeId}`);
      const task = await this.taskRepository.getTask(taskId);
      
      if (!task) {
        throw new TaskManagerError(`Task ${taskId} not found`);
      }

      // Verify user has permission to assign the task
      if (task.creatorId !== userId) {
        throw new TaskManagerError('Only task creator can assign tasks');
      }

      return await this.taskRepository.updateTask(taskId, { assigneeId });
    } catch (error) {
      throw new TaskManagerError(`Failed to assign task: ${error instanceof Error ? error.message : 'Unknown error'}`, error as Error);
    }
  }

  async getTaskDetails(taskId: number): Promise<TaskWithRelations> {
    try {
      debug(`Getting details for task ${taskId}`);
      const task = await this.taskRepository.getTask(taskId);
      
      if (!task) {
        throw new TaskManagerError(`Task ${taskId} not found`);
      }

      return task;
    } catch (error) {
      throw new TaskManagerError(`Failed to get task details: ${error instanceof Error ? error.message : 'Unknown error'}`, error as Error);
    }
  }

  async listTasks(filters: TaskFilters): Promise<TaskListResult> {
    try {
      debug('Listing tasks with filters');
      return await this.taskRepository.listTasks(filters);
    } catch (error) {
      throw new TaskManagerError(`Failed to list tasks: ${error instanceof Error ? error.message : 'Unknown error'}`, error as Error);
    }
  }

  async getUserTasks(userId: string): Promise<UserTasks> {
    try {
      debug(`Getting tasks for user ${userId}`);
      return await this.taskRepository.getTasksByUser(userId);
    } catch (error) {
      throw new TaskManagerError(`Failed to get user tasks: ${error instanceof Error ? error.message : 'Unknown error'}`, error as Error);
    }
  }

  async deleteTask(taskId: number, userId: string): Promise<void> {
    try {
      debug(`Deleting task ${taskId}`);
      const task = await this.taskRepository.getTask(taskId);
      
      if (!task) {
        throw new TaskNotFoundError(taskId);
      }

      // Verify user has permission to delete the task
      if (task.creatorId !== userId) {
        throw new UnauthorizedTaskActionError();
      }

      await this.taskRepository.deleteTask(taskId);
    } catch (error) {
      throw new TaskManagerError(`Failed to delete task: ${error instanceof Error ? error.message : 'Unknown error'}`, error as Error);
    }
  }
}