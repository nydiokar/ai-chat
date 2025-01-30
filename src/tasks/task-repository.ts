import { PrismaClient, Prisma } from '@prisma/client';
import { DatabaseError } from '../services/db-service.js';
import { debug } from '../utils/config.js';
import { 
  Task as TaskType, 
  CreateTaskDTO, 
  UpdateTaskDTO,
  TaskStatus,
  TaskPriority,
  User,
  TaskWithRelations,
  TaskFilters,
  TaskHistoryEntry
} from '../types/task.js';

const PrismaTaskStatus = TaskStatus;
const PrismaTaskPriority = TaskPriority;

type TaskInclude = Prisma.TaskInclude & {
  history?: {
    include: {
      user: true;
    }
  };
};

const defaultTaskInclude: TaskInclude = {
  creator: true,
  assignee: true,
  subTasks: true,
  parentTask: true
};

function mapPrismaTaskToTask(prismaTask: any): TaskWithRelations {
  return {
    id: prismaTask.id,
    title: prismaTask.title,
    description: prismaTask.description,
    status: prismaTask.status as TaskStatus,
    priority: prismaTask.priority as TaskPriority,
    createdAt: prismaTask.createdAt,
    updatedAt: prismaTask.updatedAt,
    dueDate: prismaTask.dueDate ?? undefined,
    completedAt: prismaTask.completedAt ?? undefined,
    creatorId: prismaTask.creatorId,
    assigneeId: prismaTask.assigneeId ?? undefined,
    conversationId: prismaTask.conversationId ?? undefined,
    tags: JSON.parse(prismaTask.tags as string),
    metadata: prismaTask.metadata ? JSON.parse(prismaTask.metadata as string) : undefined,
    parentTaskId: prismaTask.parentTaskId ?? undefined,
    creator: {
      ...prismaTask.creator,
      preferences: prismaTask.creator.preferences 
        ? JSON.parse(prismaTask.creator.preferences as string)
        : undefined
    },
    assignee: prismaTask.assignee ? {
      ...prismaTask.assignee,
      preferences: prismaTask.assignee.preferences
        ? JSON.parse(prismaTask.assignee.preferences as string)
        : undefined
    } : undefined,
    subTasks: prismaTask.subTasks.map((subTask: any) => ({
      ...subTask,
      tags: JSON.parse(subTask.tags as string),
      metadata: subTask.metadata ? JSON.parse(subTask.metadata as string) : undefined
    })),
    parentTask: prismaTask.parentTask ? {
      ...prismaTask.parentTask,
      tags: JSON.parse(prismaTask.parentTask.tags as string),
      metadata: prismaTask.parentTask.metadata ? JSON.parse(prismaTask.parentTask.metadata as string) : undefined
    } : undefined,
    history: prismaTask.history?.map((entry: any) => ({
      ...entry,
      oldValue: entry.oldValue ?? undefined,
      newValue: entry.newValue ?? undefined,
      note: entry.note ?? undefined
    })) ?? []
  };
}

export class TaskRepository {
  private static instance: TaskRepository;
  private readonly prisma: PrismaClient;
  private readonly MAX_TITLE_LENGTH = 200;
  private readonly MAX_DESCRIPTION_LENGTH = 2000;

  private constructor() {
    this.prisma = new PrismaClient({
      log: ['error', 'warn'],
    });
  }

  static getInstance(): TaskRepository {
    if (!TaskRepository.instance) {
      TaskRepository.instance = new TaskRepository();
    }
    return TaskRepository.instance;
  }

  private validateTaskInput(input: Partial<CreateTaskDTO>): void {
    if (input.title && (input.title.length === 0 || input.title.length > this.MAX_TITLE_LENGTH)) {
      throw new DatabaseError(`Title must be between 1 and ${this.MAX_TITLE_LENGTH} characters`);
    }

    if (input.description && (input.description.length === 0 || input.description.length > this.MAX_DESCRIPTION_LENGTH)) {
      throw new DatabaseError(`Description must be between 1 and ${this.MAX_DESCRIPTION_LENGTH} characters`);
    }
  }

  private async validateUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId }
    });
    if (!user) {
      throw new DatabaseError(`User ${userId} not found`);
    }
  }

  private async handlePrismaError(error: unknown, operation: string): Promise<never> {
    const prismaError = error as { code?: string; message?: string };
    if (prismaError.code) {
      if (prismaError.code === 'P2002') {
        throw new DatabaseError('Unique constraint violation');
      }
      if (prismaError.code === 'P2025') {
        throw new DatabaseError('Record not found');
      }
    }
    const errorMessage = prismaError.message || 'Unknown database error';
    throw new DatabaseError(`Task ${operation} failed: ${errorMessage}`, error as Error);
  }

  async addTaskHistory(data: TaskHistoryEntry): Promise<void> {
    try {
      await this.validateUser(data.userId);
      debug(`Adding history entry for task ${data.taskId}`);

      const prisma = this.prisma as any;
      await prisma.taskHistory.create({
        data: {
          taskId: data.taskId,
          userId: data.userId,
          action: data.action,
          oldValue: data.oldValue,
          newValue: data.newValue,
          note: data.note
        }
      });
    } catch (error) {
      throw this.handlePrismaError(error, 'history creation');
    }
  }

  async createTask(data: CreateTaskDTO): Promise<TaskWithRelations> {
    try {
      this.validateTaskInput(data);
      await this.validateUser(data.creatorId);
      if (data.assigneeId) {
        await this.validateUser(data.assigneeId);
      }

      debug(`Creating new task: ${data.title}`);
      const task = await this.prisma.task.create({
        data: {
          title: data.title,
          description: data.description,
          status: PrismaTaskStatus.OPEN,
          priority: data.priority ?? PrismaTaskPriority.MEDIUM,
          creatorId: data.creatorId,
          assigneeId: data.assigneeId,
          conversationId: data.conversationId,
          dueDate: data.dueDate,
          tags: JSON.stringify(data.tags || []),
          metadata: JSON.stringify(data.metadata || {}),
          parentTaskId: data.parentTaskId
        },
        include: defaultTaskInclude
      });

      return mapPrismaTaskToTask(task);
    } catch (error) {
      return this.handlePrismaError(error, 'creation');
    }
  }

  async getTask(id: number): Promise<TaskWithRelations | null> {
    try {
      debug(`Retrieving task ${id}`);
      const task = await this.prisma.task.findUnique({
        where: { id },
        include: defaultTaskInclude
      });

      if (!task) {
        return null;
      }

      return mapPrismaTaskToTask(task);
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      return this.handlePrismaError(error, 'retrieval');
    }
  }

  async updateTask(id: number, data: UpdateTaskDTO): Promise<TaskWithRelations> {
    try {
      this.validateTaskInput(data);
      if (data.assigneeId) {
        await this.validateUser(data.assigneeId);
      }

      debug(`Updating task ${id}`);
      const updateData: any = {
        ...(data.title && { title: data.title }),
        ...(data.description && { description: data.description }),
        ...(data.status && { status: data.status }),
        ...(data.priority && { priority: data.priority }),
        ...(data.dueDate && { dueDate: data.dueDate }),
        ...(data.assigneeId && { assigneeId: data.assigneeId }),
        ...(data.tags && { tags: JSON.stringify(data.tags) }),
        ...(data.metadata && { metadata: JSON.stringify(data.metadata) }),
        updatedAt: new Date()
      };

      if (data.status === TaskStatus.COMPLETED) {
        updateData.completedAt = new Date();
      }

      const updatedTask = await this.prisma.task.update({
        where: { id },
        data: updateData,
        include: defaultTaskInclude
      });

      return mapPrismaTaskToTask(updatedTask);
    } catch (error) {
      return this.handlePrismaError(error, 'update');
    }
  }

  async deleteTask(id: number): Promise<void> {
    try {
      debug(`Deleting task ${id}`);
      await this.prisma.task.delete({
        where: { id }
      });
    } catch (error) {
      throw this.handlePrismaError(error, 'deletion');
    }
  }

  async listTasks(options: TaskFilters = {}): Promise<{ tasks: TaskWithRelations[]; total: number }> {
    try {
      debug(`Listing tasks with filters: ${JSON.stringify(options)}`);
      const [tasks, total] = await Promise.all([
        this.prisma.task.findMany({
          where: {
            ...(options.creatorId && { creatorId: options.creatorId }),
            ...(options.assigneeId && { assigneeId: options.assigneeId }),
            ...(options.status && { status: options.status }),
            ...(options.priority && { priority: options.priority })
          },
          include: defaultTaskInclude,
          take: options.limit ?? 10,
          skip: options.offset ?? 0,
          orderBy: {
            createdAt: 'desc'
          }
        }),
        this.prisma.task.count({
          where: {
            ...(options.creatorId && { creatorId: options.creatorId }),
            ...(options.assigneeId && { assigneeId: options.assigneeId }),
            ...(options.status && { status: options.status }),
            ...(options.priority && { priority: options.priority })
          }
        })
      ]);

      return { 
        tasks: tasks.map(task => mapPrismaTaskToTask(task)),
        total 
      };
    } catch (error) {
      throw this.handlePrismaError(error, 'listing');
    }
  }

  async getTasksByUser(userId: string): Promise<{ created: TaskWithRelations[]; assigned: TaskWithRelations[] }> {
    try {
      await this.validateUser(userId);
      debug(`Getting tasks for user ${userId}`);

      const [created, assigned] = await Promise.all([
        this.prisma.task.findMany({
          where: { creatorId: userId },
          include: defaultTaskInclude,
          orderBy: { updatedAt: 'desc' }
        }),
        this.prisma.task.findMany({
          where: { assigneeId: userId },
          include: defaultTaskInclude,
          orderBy: { updatedAt: 'desc' }
        })
      ]);

      return { 
        created: created.map(task => mapPrismaTaskToTask(task)),
        assigned: assigned.map(task => mapPrismaTaskToTask(task))
      };
    } catch (error) {
      throw this.handlePrismaError(error, 'user tasks retrieval');
    }
  }
}
