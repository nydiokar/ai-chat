import { expect } from 'chai';
import sinon from 'sinon';
import { PerformanceMonitoringService } from './performance-monitoring.service.js';
import { DatabaseService } from './db-service.js';

describe('PerformanceMonitoringService', () => {
  let performanceService: PerformanceMonitoringService;
  let dbServiceStub: sinon.SinonStubbedInstance<DatabaseService>;
  let mockPrisma: any;

  beforeEach(() => {
    // Reset singleton instance
    (PerformanceMonitoringService as any).instance = undefined;

    // Create stub for DatabaseService
    dbServiceStub = sinon.createStubInstance(DatabaseService);

    // Create mock Prisma client for direct calls
    mockPrisma = {
      queryMetrics: {
        findMany: sinon.stub().resolves([])
      },
      performanceMetric: {
        create: sinon.stub().resolves({})
      }
    };

    // Set up prisma property
    Object.defineProperty(dbServiceStub, 'prisma', {
      get: () => mockPrisma
    });

    // Set up executePrismaOperation with proper type handling
    (dbServiceStub.executePrismaOperation as sinon.SinonStub).callsFake(async <T>(operation: (prisma: any) => Promise<T>): Promise<T> => {
      const mockTx = {
        toolUsage: {
          findMany: sinon.stub().resolves([])
        },
        performanceMetric: {
          create: sinon.stub().resolves({})
        }
      };
      return operation(mockTx);
    });

    // Stub getInstance to return our stubbed service
    sinon.stub(DatabaseService, 'getInstance').returns(dbServiceStub);

    // Initialize service
    performanceService = PerformanceMonitoringService.getInstance();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('generatePerformanceDashboard', () => {
    it('should collect and store system metrics', async () => {
      const toolUsageData = [
        {
          tool: { name: 'test-tool-1' },
          status: 'success',
          duration: 100
        },
        {
          tool: { name: 'test-tool-1' },
          status: 'success',
          duration: 150
        }
      ];

      const queryMetricsData = [
        {
          queryHash: 'hash1',
          executionTime: 50
        },
        {
          queryHash: 'hash2',
          executionTime: 75
        }
      ];

      // Update executePrismaOperation stub for tool usage
      const createMetricStub = sinon.stub().resolves({});
      (dbServiceStub.executePrismaOperation as sinon.SinonStub).callsFake(async <T>(operation: (prisma: any) => Promise<T>): Promise<T> => {
        const mockTx = {
          toolUsage: {
            findMany: sinon.stub().resolves(toolUsageData)
          },
          performanceMetric: {
            create: createMetricStub
          }
        };
        return operation(mockTx);
      });

      mockPrisma.queryMetrics.findMany.resolves(queryMetricsData);

      const metrics = await performanceService.generatePerformanceDashboard();

      expect(metrics).to.have.property('id').that.is.a('string');
      expect(metrics).to.have.property('timestamp').that.is.instanceOf(Date);
      expect(metrics.cpuUsage).to.be.a('number');
      expect(metrics.memoryUsage).to.have.all.keys(['total', 'free', 'used']);
      expect(metrics.toolUsageStats).to.have.property('totalToolCalls').that.equals(2);
      expect(metrics.queryPerformance).to.have.property('totalQueries').that.equals(2);

      // Change this assertion to check the transaction stub instead
      sinon.assert.called(createMetricStub);
    });
  });

  describe('setupPeriodicMonitoring', () => {
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
      clock = sinon.useFakeTimers();
    });

    afterEach(() => {
      clock.restore();
    });

    it('should setup periodic monitoring at specified interval', async () => {
      const generateDashboardStub = sinon.stub(performanceService, 'generatePerformanceDashboard').resolves();
      
      performanceService.setupPeriodicMonitoring(1); // 1 minute interval
      
      // Fast forward 2 minutes
      await clock.tickAsync(120000);
      
      expect(generateDashboardStub.callCount).to.equal(2);
    });

    it('should handle errors gracefully', async () => {
      const consoleErrorStub = sinon.stub(console, 'error');
      sinon.stub(performanceService, 'generatePerformanceDashboard').rejects(new Error('Test error'));
      
      performanceService.setupPeriodicMonitoring(1);
      
      await clock.tickAsync(60000);
      
      // Using sinon assertions directly
      sinon.assert.calledWith(
        consoleErrorStub,
        'Performance monitoring error:',
        sinon.match.instanceOf(Error)
      );
    });
  });
});
