import { performance } from 'perf_hooks';
import { DatabaseService } from '../db-service.js';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import { Prisma, PrismaClient } from '@prisma/client';

// Performance monitoring middleware for Prisma
const prismaPerformanceMiddleware: Prisma.Middleware = async (params, next) => {
  const start = performance.now();
  const result = await next(params);
  const duration = performance.now() - start;
  
  try {
    // Only log if query took longer than 100ms
    if (duration > 100) {
      const queryHash = JSON.stringify(params);
      await DatabaseService.getInstance().prisma.queryMetrics.create({
        data: {
          queryHash,
          queryString: JSON.stringify(params),
          executionTime: Math.round(duration),
          rowCount: Array.isArray(result) ? result.length : 1
        }
      });
    }
  } catch (error) {
    // Log error but don't interrupt the original query
    console.error('Error logging query metrics:', error);
  }
  
  return result;
};

interface ToolUsageStats {
  name: string;
  usage: Array<{
    status: string;
    executionTime: number;
  }>;
}

interface PerformanceMetrics {
  id: string;
  timestamp: Date;
  cpuUsage: number;
  memoryUsage: {
    total: number;
    free: number;
    used: number;
  };
  toolUsageStats: {
    totalToolCalls: number;
    successRate: number;
    topTools: Array<{
      name: string;
      callCount: number;
      averageExecutionTime: number;
    }>;
  };
  queryPerformance: {
    totalQueries: number;
    averageQueryTime: number;
    slowQueries: Array<{
      queryHash: string;
      executionTime: number;
    }>;
  };
  taskMetrics: {
    totalTasks: number;
    tasksPerStatus: Record<string, number>;
    completionRate: number;
    averageCompletionTime: number;
    tasksByPriority: Record<string, number>;
    activeTasksCount: number;
    overdueTasksCount: number;
  };
}

export class PerformanceMonitoringService {
  private static instance: PerformanceMonitoringService;
  private dbService: DatabaseService;
  private prisma: PrismaClient;

  private constructor() {
    this.dbService = DatabaseService.getInstance();
    this.prisma = this.dbService.prisma;
    
    // Apply performance monitoring middleware
    this.prisma.$use(prismaPerformanceMiddleware);
  }

  static getInstance(): PerformanceMonitoringService {
    if (!PerformanceMonitoringService.instance) {
      PerformanceMonitoringService.instance = new PerformanceMonitoringService();
    }
    return PerformanceMonitoringService.instance;
  }

  private async collectSystemMetrics(): Promise<PerformanceMetrics> {
    const cpus = os.cpus();
    const totalCpuUsage = cpus.reduce((acc: number, cpu) => {
      const total = Object.values(cpu.times).reduce((a: number, b: number) => a + b, 0);
      const idle = cpu.times.idle;
      return acc + ((total - idle) / total * 100);
    }, 0) / cpus.length;

    const memoryUsage = {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem()
    };

    const [toolUsageStats, queryPerformance, taskMetrics] = await Promise.all([
      this.collectToolUsageStats(),
      this.collectQueryPerformance(),
      this.collectTaskMetrics()
    ]);

    return {
      id: uuidv4(),
      timestamp: new Date(),
      cpuUsage: totalCpuUsage,
      memoryUsage,
      toolUsageStats,
      queryPerformance,
      taskMetrics
    };
  }

  private async collectToolUsageStats() {
    try {
      return await this.dbService.executePrismaOperation(async (prisma) => {
        // Retrieve tool usage within the last 24 hours only
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        const toolUsageRecords = await prisma.toolUsage.findMany({
          where: {
            createdAt: {
              gte: oneDayAgo
            }
          },
          include: {
            tool: true,
            mcpTool: true
          },
          orderBy: { createdAt: 'desc' }
        });

        // Early return with zeros if no records found
        if (toolUsageRecords.length === 0) {
          return {
            totalToolCalls: 0,
            successRate: 0,
            topTools: []
          };
        }

        const allTools: ToolUsageStats[] = toolUsageRecords.reduce((acc: ToolUsageStats[], record) => {
          // Validate and normalize status
          const validStatus = ['success', 'failure', 'error'].includes(record.status || '') 
            ? record.status 
            : 'unknown';

          const toolName = 
            record.tool?.name || 
            record.mcpTool?.name || 
            record.toolId || 
            'unknown_tool';
          
          const existingTool = acc.find(tool => tool.name === toolName);
          
          if (existingTool) {
            existingTool.usage.push({
              status: validStatus,
              executionTime: Math.max(0, record.duration || 0) // Ensure non-negative
            });
          } else {
            acc.push({
              name: toolName,
              usage: [{
                status: validStatus,
                executionTime: Math.max(0, record.duration || 0)
              }]
            });
          }
          return acc;
        }, []);

        // Calculate total successful calls and total calls
        let totalSuccessfulCalls = 0;
        let totalCalls = 0;

        allTools.forEach(tool => {
          totalCalls += tool.usage.length;
          totalSuccessfulCalls += tool.usage.filter(u => u.status === 'success').length;
        });

        // Calculate overall success rate
        const successRate = totalCalls > 0 ? totalSuccessfulCalls / totalCalls : 0;

        // Generate top tools statistics
        const topTools = allTools
          .map(tool => {
            const totalTime = tool.usage.reduce((sum, u) => sum + u.executionTime, 0);
            return {
              name: tool.name,
              callCount: tool.usage.length,
              averageExecutionTime: tool.usage.length > 0 ? totalTime / tool.usage.length : 0
            };
          })
          .sort((a, b) => b.callCount - a.callCount)
          .slice(0, 5);

        return {
          totalToolCalls: totalCalls,
          successRate,
          topTools
        };
      });
    } catch (error) {
      console.error('Error collecting tool usage stats:', error);
      // Return safe fallback values
      return {
        totalToolCalls: 0,
        successRate: 0,
        topTools: []
      };
    }
  }

  private async collectQueryPerformance() {
    const queryMetrics = await this.prisma.queryMetrics.findMany({
      orderBy: { executionTime: 'desc' },
      take: 10
    });

    return {
      totalQueries: queryMetrics.length,
      averageQueryTime: queryMetrics.reduce((sum, metric) => sum + metric.executionTime, 0) / queryMetrics.length,
      slowQueries: queryMetrics.map(metric => ({
        queryHash: metric.queryHash,
        executionTime: metric.executionTime
      }))
    };
  }

  private async collectTaskMetrics() {
    try {
      const tasks = await this.prisma.task.findMany({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        },
        include: {
          _count: true
        }
      });

      // Calculate tasks per status
      const tasksPerStatus = tasks.reduce((acc, task) => {
        acc[task.status] = (acc[task.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Calculate tasks by priority
      const tasksByPriority = tasks.reduce((acc, task) => {
        acc[task.priority] = (acc[task.priority] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Calculate completion metrics
      const completedTasks = tasks.filter(task => task.status === 'COMPLETED');
      const completionRate = tasks.length > 0 ? completedTasks.length / tasks.length : 0;

      // Calculate average completion time for completed tasks
      const completionTimes = completedTasks
        .filter(task => task.completedAt)
        .map(task => task.completedAt!.getTime() - task.createdAt.getTime());
      
      const averageCompletionTime = completionTimes.length > 0 
        ? completionTimes.reduce((sum, time) => sum + time, 0) / completionTimes.length 
        : 0;

      // Count active and overdue tasks
      const now = new Date();
      const activeTasksCount = tasks.filter(task => 
        task.status === 'IN_PROGRESS' || task.status === 'OPEN'
      ).length;

      const overdueTasksCount = tasks.filter(task => 
        task.dueDate && task.dueDate < now && task.status !== 'COMPLETED'
      ).length;

      return {
        totalTasks: tasks.length,
        tasksPerStatus,
        completionRate,
        averageCompletionTime,
        tasksByPriority,
        activeTasksCount,
        overdueTasksCount
      };
    } catch (error) {
      console.error('Error collecting task metrics:', error);
      return {
        totalTasks: 0,
        tasksPerStatus: {},
        completionRate: 0,
        averageCompletionTime: 0,
        tasksByPriority: {},
        activeTasksCount: 0,
        overdueTasksCount: 0
      };
    }
  }

  async generatePerformanceDashboard(): Promise<PerformanceMetrics> {
    const start = performance.now();
    
    const metrics = await this.collectSystemMetrics();
    const collectionDuration = Math.round(performance.now() - start);
    
    // Store metrics in database for historical tracking
    await this.dbService.executePrismaOperation(async (prisma) => {
      await prisma.performanceMetric.create({
        data: {
          timestamp: metrics.timestamp,
          cpuUsage: metrics.cpuUsage,
          memoryTotal: BigInt(metrics.memoryUsage.total),
          memoryFree: BigInt(metrics.memoryUsage.free),
          totalToolCalls: metrics.toolUsageStats.totalToolCalls,
          toolSuccessRate: metrics.toolUsageStats.successRate,
          averageQueryTime: metrics.queryPerformance.averageQueryTime
        }
      });
    });

    // Log performance information
    console.log(`Performance metrics collected in ${collectionDuration}ms`);
    if (metrics.queryPerformance.averageQueryTime > 0) {
      console.log(`Average query time: ${metrics.queryPerformance.averageQueryTime}ms`);
    }

    return metrics;
  }

  async setupPeriodicMonitoring(intervalMinutes: number = 5) {
    setInterval(async () => {
      try {
        await this.generatePerformanceDashboard();
      } catch (error) {
        console.error('Performance monitoring error:', error);
      }
    }, intervalMinutes * 60 * 1000);
  }
}
