import { performance } from 'perf_hooks';
import { DatabaseService } from './db-service.js';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import { Prisma, PrismaClient } from '@prisma/client';

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
}

export class PerformanceMonitoringService {
  private static instance: PerformanceMonitoringService;
  private dbService: DatabaseService;
  private prisma: PrismaClient;

  private constructor() {
    this.dbService = DatabaseService.getInstance();
    this.prisma = this.dbService.prisma;
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

    const toolUsageStats = await this.collectToolUsageStats();
    const queryPerformance = await this.collectQueryPerformance();

    return {
      id: uuidv4(),
      timestamp: new Date(),
      cpuUsage: totalCpuUsage,
      memoryUsage,
      toolUsageStats,
      queryPerformance
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

  async generatePerformanceDashboard(): Promise<PerformanceMetrics> {
    const metrics = await this.collectSystemMetrics();
    
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
