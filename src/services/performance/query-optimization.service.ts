import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { DatabaseService } from '../db-service.js';
import { debug } from '../../utils/config.js';

interface QueryMonitoringData {
  queryString: string;
  params?: any;
  startTime: Date;
  endTime?: Date;
  rowCount?: number;
}

interface CacheConfig {
  ttl: number; // Time to live in seconds
  maxSize: number; // Maximum number of cached results
}

export class QueryOptimizationService {
  private static instance: QueryOptimizationService;
  private readonly dbService: DatabaseService;
  private readonly queryCache: Map<string, { data: any; timestamp: number }>;
  private readonly cacheConfig: CacheConfig = {
    ttl: 300, // 5 minutes default TTL
    maxSize: 1000, // Maximum cache entries
  };

  private constructor() {
    this.dbService = DatabaseService.getInstance();
    this.queryCache = new Map();
    this.setupPrismaMiddleware();
  }

  static getInstance(): QueryOptimizationService {
    if (!QueryOptimizationService.instance) {
      QueryOptimizationService.instance = new QueryOptimizationService();
    }
    return QueryOptimizationService.instance;
  }

  private setupPrismaMiddleware(): void {
    const prisma = this.dbService.prisma;
    if (prisma && typeof prisma.$use === 'function') {
      prisma.$use(async (params, next) => {
        const monitoring: QueryMonitoringData = {
          queryString: JSON.stringify(params),
          startTime: new Date(),
        };

        try {
          const result = await next(params);
          monitoring.endTime = new Date();
          monitoring.rowCount = Array.isArray(result) ? result.length : 1;
          
          // Track query metrics asynchronously
          this.trackQueryMetrics(monitoring).catch(error => {
            debug(`Failed to track query metrics: ${error.message}`);
          });

          return result;
        } catch (error) {
          monitoring.endTime = new Date();
          throw error;
        }
      });
    } else {
      debug('Prisma client not properly initialized or $use method not available');
    }
  }

  private generateQueryHash(queryString: string, params?: any): string {
    const content = JSON.stringify({ query: queryString, params });
    return createHash('sha256').update(content).digest('hex');
  }

  private async trackQueryMetrics(monitoring: QueryMonitoringData): Promise<void> {
    const executionTime = monitoring.endTime!.getTime() - monitoring.startTime.getTime();
    const queryHash = this.generateQueryHash(monitoring.queryString, monitoring.params);

    await this.dbService.prisma.queryMetrics.create({
      data: {
        queryHash,
        queryString: monitoring.queryString,
        executionTime,
        rowCount: monitoring.rowCount,
        updatedAt: new Date(),
      },
    });
  }

  async getCachedResult<T>(
    queryHash: string,
    queryFn: () => Promise<T>
  ): Promise<T> {
    const cached = this.queryCache.get(queryHash);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.cacheConfig.ttl * 1000) {
      await this.updateCacheMetrics(queryHash, true);
      return cached.data;
    }

    await this.updateCacheMetrics(queryHash, false);
    const result = await queryFn();
    
    // Cache the new result
    this.queryCache.set(queryHash, {
      data: result,
      timestamp: now,
    });

    // Cleanup old cache entries if needed
    if (this.queryCache.size > this.cacheConfig.maxSize) {
      const oldestKey = [...this.queryCache.entries()]
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
      this.queryCache.delete(oldestKey);
    }

    return result;
  }

  private async updateCacheMetrics(key: string, isHit: boolean): Promise<void> {
    await this.dbService.upsertCacheMetrics({
      key,
      hits: isHit ? 1 : 0,
      misses: isHit ? 0 : 1,
      lastAccessed: new Date(),
    });
  }

  async getQueryMetrics(options: {
    startDate?: Date;
    endDate?: Date;
    minExecutionTime?: number;
    limit?: number;
  } = {}): Promise<any> {
    const {
      startDate = new Date(0),
      endDate = new Date(),
      minExecutionTime = 0,
      limit = 100,
    } = options;

    return this.dbService.prisma.queryMetrics.findMany({
      where: {
        timestamp: {
          gte: startDate,
          lte: endDate,
        },
        executionTime: {
          gte: minExecutionTime,
        },
      },
      orderBy: {
        executionTime: 'desc',
      },
      take: limit,
    });
  }

  async getSlowQueries(threshold: number = 1000, limit: number = 10): Promise<any> {
    return this.getQueryMetrics({
      minExecutionTime: threshold,
      limit,
    });
  }

  async getCacheAnalytics(): Promise<{
    totalEntries: number;
    hitRate: number;
    missRate: number;
    averageAccessTime: number;
  }> {
    const metrics = await this.dbService.prisma.cacheMetrics.findMany();
    
    const totalHits = metrics.reduce((sum, metric) => sum + metric.hits, 0);
    const totalMisses = metrics.reduce((sum, metric) => sum + metric.misses, 0);
    const total = totalHits + totalMisses;

    return {
      totalEntries: this.queryCache.size,
      hitRate: total > 0 ? (totalHits / total) * 100 : 0,
      missRate: total > 0 ? (totalMisses / total) * 100 : 0,
      averageAccessTime: metrics.length > 0 
        ? metrics.reduce((sum, m) => sum + (m.hits + m.misses), 0) / metrics.length
        : 0,
    };
  }

  async cleanup(): Promise<void> {
    // Clear expired cache entries
    const now = Date.now();
    for (const [key, value] of this.queryCache.entries()) {
      if (now - value.timestamp > this.cacheConfig.ttl * 1000) {
        this.queryCache.delete(key);
      }
    }

    // Clean up old metrics (keep last 30 days)
    await this.dbService.cleanOldCacheMetrics(30);
  }
}
