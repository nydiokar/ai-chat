import { DependencyType, Task, TaskDependency, TaskStatus, TaskHistoryAction } from '../types/task';
import { PrismaClient, Prisma } from '@prisma/client';

// Helper function to convert Prisma Task to our Task type
function convertPrismaTask(prismaTask: any): Task {
  return {
    ...prismaTask,
    tags: prismaTask.tags as Record<string, any>,
    metadata: prismaTask.metadata as Record<string, any> | undefined,
    status: prismaTask.status as TaskStatus,
    priority: prismaTask.priority as Task['priority'],
  };
}

// Helper function to convert Prisma TaskDependency to our TaskDependency type
function convertPrismaDependency(prismaDep: any): TaskDependency {
  return {
    id: prismaDep.id,
    blockedTaskId: prismaDep.blockedTaskId,
    blockerTaskId: prismaDep.blockerTaskId,
    dependencyType: prismaDep.dependencyType,
    metadata: prismaDep.metadata ? (prismaDep.metadata as Record<string, any>) : undefined,
    createdAt: prismaDep.createdAt,
    updatedAt: prismaDep.updatedAt,
  };
}

export class TaskDependencyService {
  constructor(private prisma: PrismaClient) {}

  async addDependency(
    blockedTaskId: number,
    blockerTaskId: number,
    userId: string,
    dependencyType: DependencyType = DependencyType.BLOCKS,
    metadata?: Record<string, any>,
  ): Promise<TaskDependency> {
    // Check for circular dependencies
    if (await this.wouldCreateCircularDependency(blockedTaskId, blockerTaskId)) {
      throw new Error('Cannot add dependency: would create circular dependency');
    }

    const dependency = await this.prisma.taskDependency.create({
      data: {
        blockedTaskId,
        blockerTaskId,
        dependencyType,
        metadata: metadata ? (metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });

    const convertedDep = convertPrismaDependency(dependency);

    // Update task status if needed
    await this.updateTaskBlockedStatus(blockedTaskId);

    // Record history with the user who performed the action
    await this.prisma.taskHistory.create({
      data: {
        taskId: blockedTaskId,
        userId: userId,
        action: TaskHistoryAction.UPDATED,
        note: `Added dependency: blocked by task #${blockerTaskId}`,
      },
    });

    return convertedDep;
  }

  async removeDependency(blockedTaskId: number, blockerTaskId: number, userId: string): Promise<void> {
    await this.prisma.taskDependency.delete({
      where: {
        blockedTaskId_blockerTaskId: {
          blockedTaskId,
          blockerTaskId,
        },
      },
    });

    // Update task status
    await this.updateTaskBlockedStatus(blockedTaskId);

    // Record history with the user who performed the action
    await this.prisma.taskHistory.create({
      data: {
        taskId: blockedTaskId,
        userId: userId,
        action: TaskHistoryAction.UPDATED,
        note: `Removed dependency: no longer blocked by task #${blockerTaskId}`,
      },
    });
  }

  private async wouldCreateCircularDependency(
    blockedTaskId: number,
    blockerTaskId: number,
  ): Promise<boolean> {
    // Check if the blocked task is a dependency of the blocker task
    const visited = new Set<number>();
    const stack = [blockerTaskId];

    while (stack.length > 0) {
      const currentTaskId = stack.pop()!;
      
      if (currentTaskId === blockedTaskId) {
        return true; // Found a cycle
      }

      if (!visited.has(currentTaskId)) {
        visited.add(currentTaskId);

        const dependencies = await this.prisma.taskDependency.findMany({
          where: { blockedTaskId: currentTaskId },
          select: { blockerTaskId: true },
        });

        stack.push(...dependencies.map(d => d.blockerTaskId));
      }
    }

    return false;
  }

  private async updateTaskBlockedStatus(taskId: number): Promise<void> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        blockedBy: {
          include: {
            blockerTask: true,
          },
        },
      },
    });

    if (!task) return;

    // Group dependencies by type
    const blockingDeps = task.blockedBy.filter(
      dep => dep.dependencyType === DependencyType.BLOCKS || 
             dep.dependencyType === DependencyType.SEQUENTIAL
    );

    const parallelDeps = task.blockedBy.filter(
      dep => dep.dependencyType === DependencyType.PARALLEL || 
             dep.dependencyType === DependencyType.REQUIRED
    );

    // Check if any blocking dependencies are incomplete
    const hasActiveBlockers = blockingDeps.some(
      dependency => dependency.blockerTask.status !== TaskStatus.COMPLETED
    );

    // Check if parallel dependencies are satisfied
    const hasIncompleteParallel = parallelDeps.length > 0 && parallelDeps.some(
      dependency => dependency.blockerTask.status !== TaskStatus.COMPLETED
    );

    // Block if either blocking deps are active or parallel deps are incomplete
    const shouldBeBlocked = (hasActiveBlockers && blockingDeps.length > 0) || hasIncompleteParallel;

    // Update task status if needed
    if (shouldBeBlocked && task.status !== TaskStatus.BLOCKED) {
      await this.prisma.task.update({
        where: { id: taskId },
        data: { status: TaskStatus.BLOCKED },
      });
    } else if (!shouldBeBlocked && task.status === TaskStatus.BLOCKED) {
      await this.prisma.task.update({
        where: { id: taskId },
        data: { status: TaskStatus.OPEN },
      });
    }
  }

  async getDependencies(taskId: number): Promise<{
    blockedBy: TaskDependency[];
    blocking: TaskDependency[];
  }> {
    const [blockedByRaw, blockingRaw] = await Promise.all([
      this.prisma.taskDependency.findMany({
        where: { blockedTaskId: taskId },
        include: { blockerTask: true },
      }),
      this.prisma.taskDependency.findMany({
        where: { blockerTaskId: taskId },
        include: { blockedTask: true },
      }),
    ]);

    return {
      blockedBy: blockedByRaw.map(convertPrismaDependency),
      blocking: blockingRaw.map(convertPrismaDependency),
    };
  }

  async getBlockerTasks(taskId: number): Promise<Task[]> {
    const dependencies = await this.prisma.taskDependency.findMany({
      where: { blockedTaskId: taskId },
      include: { blockerTask: true },
    });

    return dependencies.map(d => convertPrismaTask(d.blockerTask));
  }

  async getBlockedTasks(taskId: number): Promise<Task[]> {
    const dependencies = await this.prisma.taskDependency.findMany({
      where: { blockerTaskId: taskId },
      include: { blockedTask: true },
    });

    return dependencies.map(d => convertPrismaTask(d.blockedTask));
  }

  async propagateStatusUpdate(taskId: number): Promise<void> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        blocking: {
          include: {
            blockedTask: true,
          },
        },
      },
    });

    if (!task) return;

    // If task is completed, update blocked tasks based on dependency type
    if (task.status === TaskStatus.COMPLETED) {
      for (const dependency of task.blocking) {
        // Handle different dependency types
        switch (dependency.dependencyType) {
          case DependencyType.BLOCKS:
          case DependencyType.SEQUENTIAL:
            // These types require completion before the blocked task can start
            await this.updateTaskBlockedStatus(dependency.blockedTaskId);
            break;
          
          case DependencyType.PARALLEL:
          case DependencyType.REQUIRED:
            // For parallel tasks, check if ALL parallel dependencies are completed
            await this.checkParallelDependencies(dependency.blockedTaskId);
            break;
          
          case DependencyType.RELATED:
            // No status update needed for related tasks
            break;
        }
      }
    }
  }

  /**
   * Check if all parallel dependencies for a task are completed
   */
  private async checkParallelDependencies(taskId: number): Promise<void> {
    const dependencies = await this.prisma.taskDependency.findMany({
      where: {
        blockedTaskId: taskId,
        OR: [
          { dependencyType: DependencyType.PARALLEL },
          { dependencyType: DependencyType.REQUIRED }
        ]
      },
      include: {
        blockerTask: true
      }
    });

    // Check if all parallel/required dependencies are completed
    const allParallelComplete = dependencies.every(
      dep => dep.blockerTask.status === TaskStatus.COMPLETED
    );

    if (allParallelComplete) {
      await this.updateTaskBlockedStatus(taskId);
    }
  }

  /**
   * Validate that sequential tasks are being worked on in the correct order
   */
  async validateSequentialOrder(taskId: number): Promise<boolean> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        blockedBy: {
          where: { dependencyType: DependencyType.SEQUENTIAL },
          include: { blockerTask: true }
        }
      }
    });

    if (!task) return false;

    // For sequential dependencies, ALL previous tasks must be completed
    return task.blockedBy.every(dep => dep.blockerTask.status === TaskStatus.COMPLETED);
  }

  /**
   * Check if a task can be started based on its dependencies
   */
  async canStartTask(taskId: number): Promise<{
    canStart: boolean;
    blockedBy: Array<{taskId: number; reason: string}>
  }> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        blockedBy: {
          include: { blockerTask: true }
        }
      }
    });

    if (!task) {
      throw new Error('Task not found');
    }

    const blockers = [];

    // Check each dependency type
    for (const dep of task.blockedBy) {
      const blocker = dep.blockerTask;
      
      switch (dep.dependencyType) {
        case DependencyType.BLOCKS:
          if (blocker.status !== TaskStatus.COMPLETED) {
            blockers.push({
              taskId: blocker.id,
              reason: `Task ${blocker.id} must be completed first`
            });
          }
          break;

        case DependencyType.SEQUENTIAL:
          if (blocker.status !== TaskStatus.COMPLETED) {
            blockers.push({
              taskId: blocker.id,
              reason: `Sequential task ${blocker.id} must be completed first`
            });
          }
          break;

        case DependencyType.PARALLEL:
        case DependencyType.REQUIRED:
          // Can start parallel tasks together
          break;

        case DependencyType.RELATED:
          // Related tasks don't block
          break;
      }
    }

    return {
      canStart: blockers.length === 0,
      blockedBy: blockers
    };
  }
}
