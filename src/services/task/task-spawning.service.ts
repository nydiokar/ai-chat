import { RecurrencePatternService } from './recurrence-pattern.service.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { 
  RecurrencePattern, 
  TaskWithRelations, 
  CreateTaskDTO, 
  TaskStatus, 
  TaskHistoryEntry,
  TaskHistoryAction 
} from '../../types/task.js';


/**
 * TaskSpawningService manages the creation and tracking of recurring tasks
 * 
 * Key Responsibilities:
 * - Automatic task instance creation based on recurrence patterns
 * - Parent-child task relationship management
 * - Completion history tracking
 * - Performance-optimized task spawning
 */
export class TaskSpawningService {
  private static instance: TaskSpawningService;
  private taskRepository: TaskRepository;

  private constructor() {
    this.taskRepository = TaskRepository.getInstance();
  }

  /**
   * Singleton instance management
   */
  static getInstance(): TaskSpawningService {
    if (!TaskSpawningService.instance) {
      TaskSpawningService.instance = new TaskSpawningService();
    }
    return TaskSpawningService.instance;
  }

  /**
   * Spawns a new task instance based on a recurring task pattern
   * @param parentTask The original recurring task
   * @param occurrenceDate The date for this task instance
   */
  async spawnTaskInstance(
    parentTask: TaskWithRelations, 
    occurrenceDate: Date
  ): Promise<TaskWithRelations> {
    try {
      // Create a new task instance linked to the parent
      const taskInstance: CreateTaskDTO = {
        title: `${parentTask.title} - ${occurrenceDate.toLocaleDateString()}`,
        description: parentTask.description,
        creatorId: parentTask.creatorId,
        assigneeId: parentTask.assigneeId,
        priority: parentTask.priority,
        dueDate: occurrenceDate,
        parentTaskId: parentTask.id,
        metadata: {
          ...parentTask.metadata,
          originalTaskId: parentTask.id,
          occurrenceDate: occurrenceDate.toISOString()
        },
        tags: Object.values(parentTask.tags)
      };

      const newTask = await this.taskRepository.createTask(taskInstance);

      // Log task spawning history
      await this.logTaskSpawning(newTask, parentTask);

      return newTask;
    } catch (error) {
      console.error('Task spawning failed:', error);
      throw error;
    }
  }

  /**
   * Logs the task spawning event in task history
   */
  private async logTaskSpawning(
    newTask: TaskWithRelations, 
    parentTask: TaskWithRelations
  ): Promise<void> {
    const historyEntry: TaskHistoryEntry = {
      taskId: newTask.id,
      userId: parentTask.creatorId,
      action: TaskHistoryAction.SPAWN,
      note: 'Recurring task instance created',
      oldValue: JSON.stringify(parentTask),
      newValue: JSON.stringify(newTask)

    };

    await this.taskRepository.addTaskHistory(historyEntry);
  }

  /**
   * Checks and spawns tasks for all recurring tasks due
   */
  async processRecurringTasks(): Promise<void> {
    // Retrieve active recurring tasks
    const recurringTasks = await this.findDueRecurringTasks();

    for (const task of recurringTasks) {
      try {
        // Extract recurrence pattern from task metadata
        const pattern = task.metadata?.recurrencePattern as RecurrencePattern;
        if (!pattern) continue;

        // Find the last spawned task instance
        const lastInstance = await this.findLastTaskInstance(task);
        const lastOccurrence = lastInstance?.dueDate ?? new Date();

        // Calculate next occurrence
        const nextOccurrence = RecurrencePatternService.getNextOccurrence(
          pattern, 
          lastOccurrence
        );

        if (nextOccurrence) {
          // Spawn new task instance
          await this.spawnTaskInstance(task, nextOccurrence);
        }
      } catch (error) {
        console.error(`Failed to process recurring task ${task.id}:`, error);
      }
    }
  }

  /**
   * Finds tasks that are due for spawning
   */
  private async findDueRecurringTasks(): Promise<TaskWithRelations[]> {
    // This is a placeholder - would need to be implemented with proper filtering
    const { tasks } = await this.taskRepository.listTasks({
      // Add filtering for recurring tasks
    });

    return tasks.filter(task => 
      task.metadata?.recurrencePattern && 
      RecurrencePatternService.shouldSpawnTask(
        task.metadata.recurrencePattern as RecurrencePattern, 
        task.dueDate ?? new Date()
      )
    );
  }

  /**
   * Finds the most recent task instance for a recurring task
   */
  private async findLastTaskInstance(
    parentTask: TaskWithRelations
  ): Promise<TaskWithRelations | null> {
    const { tasks } = await this.taskRepository.listTasks({
      parentTaskId: parentTask.id
    });

    return tasks.length > 0 
      ? tasks.reduce((latest, current) => 
          (latest.dueDate ?? new Date(0)) > (current.dueDate ?? new Date(0)) 
            ? latest 
            : current
        )
      : null;
  }

  /**
   * Handles task completion and potential rescheduling
   */
  async completeTaskInstance(
    taskId: number, 
    userId: string
  ): Promise<TaskWithRelations> {
    // Update task status
    const completedTask = await this.taskRepository.updateTask(taskId, {
      status: TaskStatus.COMPLETED
    });

    // Log completion history
    await this.taskRepository.addTaskHistory({
      taskId,
      userId,
      action: TaskHistoryAction.STATUS_CHANGED,
      note: 'Task instance completed'
    });


    return completedTask;
  }
}
