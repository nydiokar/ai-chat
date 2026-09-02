# Performance Monitoring Service

## Overview

Kanebra's performance monitoring focuses on database query performance tracking and basic context scoring for memory relevance.

## Core Components

### Database Performance Tracking

The system includes Prisma middleware for monitoring slow database queries:

```typescript
const prismaPerformanceMiddleware: Prisma.Middleware = async (params, next) => {
  const start = performance.now();
  const result = await next(params);
  const duration = performance.now() - start;

  if (duration > 100) {
    // Log slow query metrics
    await logQueryMetrics(params, duration);
  }
};
```

### Metrics Collection

```typescript
interface MetricsSnapshot {
  counters: Record<string, number>
  gauges: Record<string, number>
  histograms: Record<string, HistogramData>
  timers: Record<string, TimerData>
  timestamp: Date
}

interface HistogramData {
  count: number
  sum: number
  min: number
  max: number
  mean: number
  stddev: number
  percentiles: Record<number, number>
}
```

## Monitoring Areas

### AI Service Performance
- Response generation latency
- Token usage tracking
- Model switching performance
- Error rates by provider

### Database Performance
- Query execution times
- Connection pool utilization
- Index performance metrics
- Transaction throughput

### Cache Performance
- Hit/miss ratios
- Cache operation latency
- Memory usage statistics
- Eviction rates

### Discord Bot Performance
- Command processing latency
- Message handling throughput
- API rate limit monitoring
- Error response tracking

## Metrics Collection

### Query Metrics Storage

```typescript
interface QueryMetrics {
  queryHash: string;
  queryString: string;
  executionTime: number;
  rowCount: number;
  timestamp: Date;
}

// Store metrics in database for analysis
await prisma.queryMetrics.create({
  data: {
    queryHash,
    queryString: JSON.stringify(params),
    executionTime: Math.round(duration),
    rowCount: Array.isArray(result) ? result.length : 1
  }
});
```

### Custom Metrics

```typescript
class AIMetricsCollector {
  async collectMetrics(): Promise<void> {
    // AI-specific metrics
    this.monitor.recordGauge('ai_active_requests', this.getActiveRequestCount());
    this.monitor.recordCounter('ai_tokens_used', this.getTokensUsed());
    this.monitor.recordHistogram('ai_response_time', this.getAverageResponseTime());

    // Provider-specific metrics
    for (const provider of this.providers) {
      this.monitor.recordMetric(`ai_provider_${provider.name}_latency`,
        provider.getAverageLatency(), { provider: provider.name });
    }
  }
}
```

## Performance Analysis

### Query Optimization Service

```typescript
class QueryOptimizationService {
  async analyzeQuery(query: string, executionTime: number): Promise<OptimizationSuggestion[]> {
    const analysis = await this.analyzeQueryStructure(query);
    const suggestions: OptimizationSuggestion[] = [];

    if (analysis.hasMissingIndexes) {
      suggestions.push({
        type: 'ADD_INDEX',
        description: 'Add index on frequently queried columns',
        impact: 'HIGH',
        query: this.generateIndexQuery(analysis.missingIndexes)
      });
    }

    if (analysis.hasInefficientJoins) {
      suggestions.push({
        type: 'OPTIMIZE_JOIN',
        description: 'Rewrite query to use more efficient joins',
        impact: 'MEDIUM'
      });
    }

    return suggestions;
  }
}
```

### Memory Repository

```typescript
class MemoryRepository {
  async storeMemoryEntry(entry: MemoryEntry): Promise<void> {
    const startTime = Date.now();

    try {
      await this.db.memory.create({ data: entry });
      this.monitor.recordHistogram('memory_store_duration', Date.now() - startTime);
    } catch (error) {
      this.monitor.recordCounter('memory_store_errors');
      throw error;
    }
  }

  async searchMemories(query: MemoryQuery): Promise<MemoryEntry[]> {
    const timer = this.monitor.startTimer('memory_search', {
      query_type: query.type,
      has_filters: Object.keys(query.filters || {}).length > 0
    });

    try {
      const results = await this.performSearch(query);
      this.monitor.recordGauge('memory_search_results', results.length);
      return results;
    } finally {
      timer.stop();
    }
  }
}
```

## Alerting and Thresholds

### Performance Thresholds

```typescript
interface PerformanceThresholds {
  responseTime: {
    warning: number;  // ms
    critical: number; // ms
  };
  errorRate: {
    warning: number;  // percentage
    critical: number; // percentage
  };
  memoryUsage: {
    warning: number;  // percentage
    critical: number; // percentage
  };
  cacheHitRate: {
    warning: number;  // percentage
    critical: number; // percentage
  };
}

class AlertManager {
  async checkThresholds(metrics: MetricsSnapshot): Promise<Alert[]> {
    const alerts: Alert[] = [];

    if (metrics.histograms.response_time.p95 > this.thresholds.responseTime.critical) {
      alerts.push({
        level: 'CRITICAL',
        message: 'Response time exceeded critical threshold',
        metric: 'response_time_p95',
        value: metrics.histograms.response_time.p95
      });
    }

    if (metrics.counters.error_rate > this.thresholds.errorRate.warning) {
      alerts.push({
        level: 'WARNING',
        message: 'Error rate above warning threshold',
        metric: 'error_rate',
        value: metrics.counters.error_rate
      });
    }

    return alerts;
  }
}
```

## Context Scoring

### Advanced Context Relevance Calculation

The context scoring system provides sophisticated multi-factor relevance analysis:

```typescript
class ContextScoringService {
  calculateContextScore(
    context: ConversationContext,
    currentTopics: string[],
    currentEntities: string[],
    decayParams: ContextDecayParams = DEFAULT_DECAY_PARAMS
  ): ContextScore {
    // Multi-factor analysis:
    const recencyScore = calculateTimeBasedDecay(context.timestamp, decayParams);
    const topicRelevance = calculateTopicRelevance(context.topics, currentTopics);
    const topicContinuity = calculateTopicContinuity(context.topics, currentTopics);
    const entityOverlap = calculateEntityOverlap(context.entities, currentEntities);

    return combineScores([recencyScore, topicRelevance, topicContinuity, entityOverlap]);
  }
}
```

**Implemented Scoring Factors:**
- **Recency**: Exponential decay (24h half-life) based on time since last interaction
- **Topic Relevance**: Semantic matching between stored and current topics
- **Topic Continuity**: Analysis of topic evolution and conversation flow
- **Entity Overlap**: Matching of named entities and key concepts
- **Configurable Decay**: Customizable half-life and multiplier parameters

## Reference System

### Memory Reference Tracking

```typescript
class ReferenceSystemService {
  async trackReferenceUsage(memoryId: string, context: ReferenceContext): Promise<void> {
    await this.db.reference.create({
      data: {
        memoryId,
        contextId: context.conversationId,
        userId: context.userId,
        relevanceScore: context.score,
        accessTime: new Date()
      }
    });

    // Update memory usage statistics
    await this.updateMemoryStats(memoryId);

    this.monitor.recordCounter('reference_created');
  }

  async getReferenceAnalytics(memoryId: string): Promise<ReferenceAnalytics> {
    const references = await this.db.reference.findMany({
      where: { memoryId },
      orderBy: { accessTime: 'desc' }
    });

    return {
      totalReferences: references.length,
      averageRelevance: this.calculateAverage(references.map(r => r.relevanceScore)),
      accessPattern: this.analyzeAccessPattern(references),
      lastAccessed: references[0]?.accessTime
    };
  }
}
```

## Basic Features

### Query Performance Logging
- Automatic logging of slow database queries (>100ms)
- Execution time tracking
- Row count monitoring
- Query string storage for analysis

### Context Relevance Scoring
- Time-based decay for conversation context
- Basic relevance calculation for memory retrieval
- Simple scoring algorithms for context ranking

## Configuration

### Environment Variables

```env
# Performance monitoring
PERFORMANCE_MONITORING_ENABLED=true
METRICS_COLLECTION_INTERVAL_SECONDS=60
METRICS_RETENTION_DAYS=30

# Alerting thresholds
PERFORMANCE_RESPONSE_TIME_WARNING_MS=1000
PERFORMANCE_RESPONSE_TIME_CRITICAL_MS=5000
PERFORMANCE_ERROR_RATE_WARNING_PERCENT=5
PERFORMANCE_ERROR_RATE_CRITICAL_PERCENT=15

# Query optimization
QUERY_OPTIMIZATION_ENABLED=true
SLOW_QUERY_THRESHOLD_MS=1000
INDEX_SUGGESTION_ENABLED=true

# Memory monitoring
MEMORY_MONITORING_ENABLED=true
MEMORY_USAGE_WARNING_PERCENT=80
MEMORY_USAGE_CRITICAL_PERCENT=95
```

## Integration with External Systems

### Database Integration

Performance monitoring is integrated with the Prisma ORM through middleware:

```typescript
// Applied to Prisma client
prisma.$use(prismaPerformanceMiddleware);
```

This provides automatic query performance tracking without external monitoring systems.

## Testing Strategy

### Performance Testing

```typescript
describe('PerformanceMonitor', () => {
  it('should accurately measure execution time', async () => {
    const timer = monitor.startTimer('test_operation');
    await new Promise(resolve => setTimeout(resolve, 100));
    const elapsed = timer.stop();

    expect(elapsed).to.be.closeTo(100, 10); // Within 10ms tolerance
  });

  it('should handle concurrent timers', async () => {
    const promises = Array(100).fill().map(() =>
      this.runTimedOperation(monitor)
    );

    await Promise.all(promises);
    // Verify all timers completed without interference
  });
});
```

### Load Testing

```typescript
class LoadTestRunner {
  async runLoadTest(scenario: LoadScenario): Promise<LoadTestResult> {
    const startTime = Date.now();

    // Generate concurrent requests
    const results = await this.runConcurrentRequests(scenario);

    const endTime = Date.now();

    return {
      duration: endTime - startTime,
      totalRequests: results.length,
      successfulRequests: results.filter(r => r.success).length,
      averageResponseTime: this.calculateAverage(results.map(r => r.responseTime)),
      percentiles: this.calculatePercentiles(results.map(r => r.responseTime)),
      errorRate: (results.filter(r => !r.success).length / results.length) * 100
    };
  }
}
```

## Troubleshooting

### Common Performance Issues

**High Response Times**:
- Check database query performance
- Monitor cache hit rates
- Review external API latencies
- Analyze memory usage patterns

**Memory Leaks**:
- Monitor heap usage over time
- Check for object retention issues
- Review cache size management
- Analyze garbage collection patterns

**Database Bottlenecks**:
- Check slow query logs
- Monitor connection pool usage
- Review index effectiveness
- Analyze query execution plans

### Debug Commands

```bash
# View current metrics
npm run perf:metrics

# Run performance benchmark
npm run perf:benchmark

# Analyze slow queries
npm run perf:queries

# Check memory usage
npm run perf:memory

# Generate performance report
npm run perf:report
```

## Future Enhancements

### Advanced Analytics
- **Machine Learning**: Predictive performance modeling
- **Anomaly Detection**: Automated issue identification
- **Root Cause Analysis**: Automated problem diagnosis
- **Capacity Planning**: Predictive scaling recommendations

### Extended Monitoring
- **Distributed Tracing**: Request flow visualization
- **Custom Metrics**: Domain-specific performance indicators
- **Real-time Alerts**: Instant notification systems
- **Performance Budgets**: Configurable performance limits
