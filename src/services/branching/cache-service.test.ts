import { assert } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { CacheService } from './cache-service.js';
import fs from 'fs';
import path from 'path';

describe('CacheService', () => {
    let cacheService: CacheService;
    const testCacheFile = 'test-cache.json';

    beforeEach(() => {
        cacheService = CacheService.getInstance({
            filename: testCacheFile
        });
    });

    afterEach(async () => {
        await cacheService.clear();
        if (fs.existsSync(testCacheFile)) {
            fs.unlinkSync(testCacheFile);
        }
        if (fs.existsSync(testCacheFile + '.metrics')) {
            fs.unlinkSync(testCacheFile + '.metrics');
        }
    });

    describe('Basic Cache Operations', () => {
        it('should store and retrieve data', async () => {
            const key = 'test-key';
            const data = { message: 'test data' };
            
            await cacheService.set(key, data);
            const retrieved = await cacheService.get(key);
            
            assert.deepEqual(retrieved, data);
        });

        it('should handle cache misses', async () => {
            const result = await cacheService.get('nonexistent-key');
            assert.isNull(result);
        });

        it('should track cache metrics', async () => {
            const key = 'metrics-test';
            
            // Miss
            await cacheService.get(key);
            
            // Hit
            await cacheService.set(key, 'test');
            await cacheService.get(key);
            
            const metrics = await cacheService.getMetrics(key);
            assert.exists(metrics);
            assert.equal(metrics!.hits, 1);
            assert.equal(metrics!.misses, 1);
        });
    });

    describe('Branch Operations', () => {
        it('should create and retrieve branches', async () => {
            const messages = [
                { id: '1', content: 'test message' }
            ] as any[];

            const branch = await cacheService.createBranch(null, messages);
            assert.exists(branch.id);
            
            const retrieved = await cacheService.getBranch(branch.id);
            assert.exists(retrieved);
            assert.deepEqual(retrieved!.messages, messages);
        });

        it('should handle branch relationships', async () => {
            const parentMessages = [{ id: '1', content: 'parent' }] as any[];
            const childMessages = [{ id: '2', content: 'child' }] as any[];

            // Create parent branch and verify it exists
            const parent = await cacheService.createBranch(null, parentMessages);
            let verifyParent = await cacheService.getBranch(parent.id);
            assert.exists(verifyParent, 'Parent branch should exist');
            assert.isEmpty(verifyParent!.children, 'Parent should start with no children');

            // Create child branch
            const child = await cacheService.createBranch(parent.id, childMessages);
            let verifyChild = await cacheService.getBranch(child.id);
            assert.exists(verifyChild, 'Child branch should exist');
            assert.equal(verifyChild!.parent, parent.id, 'Child should reference parent');

            // Re-fetch parent to verify updated children list
            const updatedParent = await cacheService.getBranch(parent.id);
            assert.exists(updatedParent, 'Parent branch should still exist');
            assert.isArray(updatedParent!.children, 'Parent children should be an array');
            assert.include(updatedParent!.children, child.id, 'Parent should include child in children array');
            
            // Double verify the relationship is maintained
            const finalCheck = await cacheService.getBranch(parent.id);
            assert.include(finalCheck!.children, child.id, 'Relationship should persist in cache');
        }).timeout(5000);

        it('should get branch tree', async () => {
            const rootMessages = [{ id: '1', content: 'root' }] as any[];
            const branch1Messages = [{ id: '2', content: 'branch1' }] as any[];
            const branch2Messages = [{ id: '3', content: 'branch2' }] as any[];

            const root = await cacheService.createBranch(null, rootMessages);
            await cacheService.createBranch(root.id, branch1Messages);
            await cacheService.createBranch(root.id, branch2Messages);

            const tree = await cacheService.getBranchTree(root.id);
            assert.equal(tree.length, 3);
        });
    });

    describe('Cache Management', () => {
        it('should handle deletion', async () => {
            const key = 'delete-test';
            await cacheService.set(key, 'test');
            
            const exists = await cacheService.get(key);
            assert.exists(exists);
            
            await cacheService.delete(key);
            const afterDelete = await cacheService.get(key);
            assert.isNull(afterDelete);
        });

        it('should clear all cache data', async () => {
            await cacheService.set('key1', 'test1');
            await cacheService.set('key2', 'test2');
            
            await cacheService.clear();
            
            const result1 = await cacheService.get('key1');
            const result2 = await cacheService.get('key2');
            
            assert.isNull(result1);
            assert.isNull(result2);
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid branch operations', async () => {
            try {
                await cacheService.getBranch('nonexistent-branch');
                assert.fail('Should have thrown error');
            } catch (error) {
                assert.exists(error);
            }
        });

        it('should handle concurrent operations', async () => {
            const key = 'concurrent-test';
            const promises = [];
            
            for (let i = 0; i < 10; i++) {
                promises.push(cacheService.set(key + i, 'test' + i));
            }
            
            await Promise.all(promises);
            
            for (let i = 0; i < 10; i++) {
                const value = await cacheService.get(key + i);
                assert.equal(value, 'test' + i);
            }
        });
    });
});
