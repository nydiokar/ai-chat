import { expect } from 'chai';
import { ToolCacheService } from './tool-cache-service.js';
import { sleep } from '../../utils/test-helpers.js';

describe('ToolCacheService', () => {
  let cacheService: ToolCacheService;

  beforeEach(() => {
    cacheService = new ToolCacheService({
      defaultTTL: 100, // Short TTL for testing
      maxKeys: 10,
      memoryLimit: 50, // Small memory limit for testing
      checkPeriod: 1 // Short check period for testing
    });
  });

  afterEach(() => {
    cacheService.clear();
  });

  describe('Basic Cache Operations', () => {
    it('should cache and retrieve a simple result', () => {
      const toolName = 'test_tool';
      const input = { param: 'value' };
      const result = { data: 'test_result' };

      // Set cache entry
      const setResult = cacheService.set(toolName, input, result);
      expect(setResult).to.be.true;

      // Retrieve cache entry
      const cachedResult = cacheService.get(toolName, input);
      expect(cachedResult).to.deep.equal(result);
    });

    it('should handle undefined cache misses', () => {
      const result = cacheService.get('nonexistent_tool', { param: 'value' });
      expect(result).to.be.undefined;
    });

    it('should track cache hits and misses', () => {
      const toolName = 'hit_miss_tool';
      const input = { param: 'value' };
      const result = { data: 'test' };

      // Initial miss
      cacheService.get(toolName, input);

      // Set and hit
      cacheService.set(toolName, input, result);
      cacheService.get(toolName, input);

      const stats = cacheService.getStats();
      expect(stats.totalHits).to.equal(1);
      expect(stats.totalMisses).to.equal(1);
    });
  });

  describe('Cache Strategies', () => {
    it('should handle increment strategy correctly', () => {
      const toolName = 'math_tool';
      const input = { operation: 'sum' };

      // Initial value
      cacheService.set(toolName, input, 5);

      // Increment with strategy
      cacheService.set(toolName, input, 3, { strategy: 'increment' });

      const result = cacheService.get<number>(toolName, input);
      expect(result).to.equal(8);
    });

    it('should handle max strategy correctly', () => {
      const toolName = 'max_tool';
      const input = { param: 'test' };

      // Initial value
      cacheService.set(toolName, input, 5);

      // Try to set lower value with max strategy
      cacheService.set(toolName, input, 3, { strategy: 'max' });
      expect(cacheService.get<number>(toolName, input)).to.equal(5);

      // Try to set higher value with max strategy
      cacheService.set(toolName, input, 7, { strategy: 'max' });
      expect(cacheService.get<number>(toolName, input)).to.equal(7);
    });

    it('should handle replace strategy correctly', () => {
      const toolName = 'replace_tool';
      const input = { param: 'test' };

      // Initial value
      cacheService.set(toolName, input, 'first');

      // Replace value
      cacheService.set(toolName, input, 'second', { strategy: 'replace' });

      const result = cacheService.get<string>(toolName, input);
      expect(result).to.equal('second');
    });
  });

  describe('Cache Tags', () => {
    it('should handle tagged cache entries', () => {
      const toolName = 'tag_tool';
      const tags = ['test', 'example'];

      cacheService.set(toolName, { param: 'value1' }, 'result1', { tags });
      cacheService.set(toolName, { param: 'value2' }, 'result2', { tags });

      // Invalidate by tag
      const removedCount = cacheService.invalidate({ tags: ['test'] });
      expect(removedCount).to.equal(2);

      // Verify entries are removed
      expect(cacheService.get(toolName, { param: 'value1' })).to.be.undefined;
      expect(cacheService.get(toolName, { param: 'value2' })).to.be.undefined;
    });

    it('should retrieve cache entries with matching tags', () => {
      const toolName = 'multi_tag_tool';
      const input = { param: 'value' };
      const result = 'test_result';
      const tags = ['tag1', 'tag2'];

      cacheService.set(toolName, input, result, { tags });

      // Should find with correct tags
      expect(cacheService.get(toolName, input, tags)).to.equal(result);

      // Should not find with different tags
      expect(cacheService.get(toolName, input, ['different_tag'])).to.be.undefined;
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate entries by tool name', () => {
      const toolName = 'invalidate_tool';

      cacheService.set(toolName, { param: '1' }, 'result1');
      cacheService.set(toolName, { param: '2' }, 'result2');
      cacheService.set('other_tool', { param: '3' }, 'result3');

      const removedCount = cacheService.invalidate({ toolName });
      expect(removedCount).to.equal(2);

      // Verify specific tool entries are removed
      expect(cacheService.get(toolName, { param: '1' })).to.be.undefined;
      expect(cacheService.get(toolName, { param: '2' })).to.be.undefined;

      // Verify other tool entries remain
      expect(cacheService.get('other_tool', { param: '3' })).to.equal('result3');
    });

    it('should handle unused entries cleanup', async () => {
      const toolName = 'cleanup_tool';

      // Create multiple entries with varying hit counts
      for (let i = 0; i < 5; i++) {
        cacheService.set(toolName, { param: i }, `result${i}`);
        
        // Simulate different hit counts
        for (let j = 0; j < i; j++) {
          cacheService.get(toolName, { param: i });
        }
      }

      // Trigger cleanup (20% of entries should be removed)
      cacheService['invalidateUnusedEntries']();

      // Get stats after cleanup
      const stats = cacheService.getStats();
      expect(stats.totalEntries).to.be.lessThan(5);
    });
  });

  describe('Memory Management', () => {
    it('should respect memory limits', () => {
      const toolName = 'memory_tool';
      const largeData = new Array(1000000).fill('x').join(''); // Create large string

      // Attempt to cache large data
      const setResult = cacheService.set(toolName, { param: 'test' }, largeData);
      expect(setResult).to.be.false; // Should fail due to memory limit
    });

    it('should track memory usage', () => {
      const toolName = 'usage_tool';
      const data = 'test_data';

      cacheService.set(toolName, { param: 'test' }, data);
      
      const stats = cacheService.getStats();
      expect(stats.memoryUsage).to.be.greaterThan(0);
    });
  });
});
