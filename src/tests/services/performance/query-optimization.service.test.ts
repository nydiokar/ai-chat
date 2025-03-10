import { expect } from 'chai';
import sinon from 'sinon';
import { QueryOptimizationService } from '../../../services/performance/query-optimization.service.js';
import { DatabaseService } from '../../../services/db-service.js';

describe('QueryOptimizationService', () => {
  let queryOptimizationService: QueryOptimizationService;
  let dbServiceStub: sinon.SinonStubbedInstance<DatabaseService>;

  beforeEach(() => {
    // Reset singleton instance
    (QueryOptimizationService as any).instance = undefined;
    
    // Create stub for DatabaseService with mocked Prisma client
    dbServiceStub = sinon.createStubInstance(DatabaseService) as any;

    // Create mock Prisma client with all required methods
    const mockPrisma = {
      $use: sinon.stub().callsFake(async (fn) => {}),
      queryMetrics: {
        create: sinon.stub().resolves({}),
        findMany: sinon.stub().resolves([])
      },
      cacheMetrics: {
        findMany: sinon.stub().resolves([])
      }
    };

    // Set up prisma property correctly
    Object.defineProperty(dbServiceStub, 'prisma', {
      get: () => mockPrisma
    });
    
    // Stub getInstance to return our stubbed service
    sinon.stub(DatabaseService, 'getInstance').returns(dbServiceStub);

    // Initialize service
    queryOptimizationService = QueryOptimizationService.getInstance();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getCachedResult', () => {
    it('should return cached result if available and not expired', async () => {
      const queryHash = 'test-hash';
      const testData = { foo: 'bar' };
      const queryFn = sinon.stub().resolves(testData);

      // First call should execute query
      const result1 = await queryOptimizationService.getCachedResult(queryHash, queryFn);
      expect(queryFn.calledOnce).to.be.true;
      expect(result1).to.deep.equal(testData);

      // Second call should return cached result
      const result2 = await queryOptimizationService.getCachedResult(queryHash, queryFn);
      expect(queryFn.calledOnce).to.be.true; // Still called only once
      expect(result2).to.deep.equal(testData);
    });

    it('should execute query if cache is expired', async () => {
      const queryHash = 'test-hash';
      const testData = { foo: 'bar' };
      const queryFn = sinon.stub().resolves(testData);

      // Override TTL for test
      (queryOptimizationService as any).cacheConfig.ttl = 0;

      // First call
      await queryOptimizationService.getCachedResult(queryHash, queryFn);
      
      // Second call should execute query again due to expired TTL
      await queryOptimizationService.getCachedResult(queryHash, queryFn);
      
      expect(queryFn.calledTwice).to.be.true;
    });
  });

  describe('getQueryMetrics', () => {
    it('should return query metrics within date range', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-02-01');
      const testMetrics = [
        { executionTime: 100, timestamp: new Date('2025-01-15') }
      ];

      // Update the existing mock's findMany method
      (dbServiceStub.prisma.queryMetrics.findMany as sinon.SinonStub).resolves(testMetrics);

      const metrics = await queryOptimizationService.getQueryMetrics({
        startDate,
        endDate,
        minExecutionTime: 50
      });

      expect(metrics).to.deep.equal(testMetrics);
    });
  });

  describe('getCacheAnalytics', () => {
    it('should calculate correct cache statistics', async () => {
      const cacheMetrics = [
        { hits: 10, misses: 5 },
        { hits: 20, misses: 10 }
      ];

      // Update the existing mock's findMany method
      (dbServiceStub.prisma.cacheMetrics.findMany as sinon.SinonStub).resolves(cacheMetrics);

      const analytics = await queryOptimizationService.getCacheAnalytics();

      expect(analytics.hitRate).to.equal(66.66666666666666); // (30 hits / 45 total) * 100
      expect(analytics.missRate).to.equal(33.33333333333333); // (15 misses / 45 total) * 100
    });
  });

  describe('cleanup', () => {
    it('should remove expired cache entries', async () => {
      const queryHash1 = 'test-hash-1';
      const queryHash2 = 'test-hash-2';
      
      // Add some test cache entries
      (queryOptimizationService as any).queryCache.set(queryHash1, {
        data: 'test1',
        timestamp: Date.now() - 1000000 // Old entry
      });
      (queryOptimizationService as any).queryCache.set(queryHash2, {
        data: 'test2',
        timestamp: Date.now() // Fresh entry
      });

      // Override TTL for test
      (queryOptimizationService as any).cacheConfig.ttl = 1; // 1 second

      await queryOptimizationService.cleanup();

      const cache = (queryOptimizationService as any).queryCache;
      expect(cache.has(queryHash1)).to.be.false;
      expect(cache.has(queryHash2)).to.be.true;
    });
  });
});
