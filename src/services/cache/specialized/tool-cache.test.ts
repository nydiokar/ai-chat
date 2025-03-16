import { expect } from 'chai';
import { ToolCache } from './tool-cache.js';
import { ToolDefinition } from '../../../tools/mcp/types/tools.js';
import sinon from 'sinon';

describe('ToolCache', () => {
    let toolCache: ToolCache;
    const mockSchema: ToolDefinition = {
        name: 'test-tool',
        description: 'A test tool',
        version: '1.0.0',
        parameters: [
            {
                name: 'param1',
                type: 'string',
                required: true,
                description: 'Test parameter'
            }
        ]
    };

    beforeEach(() => {
        console.log('\nInitializing new test...');
        toolCache = ToolCache.getInstance();
    });

    it('should cache and retrieve tool schemas', async () => {
        console.log('\nTest: should cache and retrieve tool schemas');
        
        // Set schema
        console.log('Setting schema for test-tool...');
        await toolCache.setSchema('test-tool', mockSchema);
        
        // Get schema back
        console.log('Retrieving schema...');
        const cachedSchema = await toolCache.getSchema<ToolDefinition>('test-tool');
        
        console.log('Retrieved schema:', JSON.stringify(cachedSchema, null, 2));
        console.log('Expected schema:', JSON.stringify(mockSchema, null, 2));
        
        expect(cachedSchema).to.be.an('object');
        expect(cachedSchema).to.deep.equal(mockSchema);
    });

    it('should handle large schemas with compression', async () => {
        console.log('\nTest: should handle large schemas with compression');
        
        // Create a large schema by duplicating some fields
        const largeSchema: ToolDefinition = {
            ...mockSchema,
            description: mockSchema.description.repeat(1000),
            parameters: Array(100).fill(mockSchema.parameters[0])
        };
        
        console.log('Setting large schema...');
        console.log('Large schema size:', JSON.stringify(largeSchema).length, 'bytes');
        
        // Set large schema
        await toolCache.setSchema('test-tool-large', largeSchema);
        
        // Get large schema back
        console.log('Retrieving large schema...');
        const cachedSchema = await toolCache.getSchema<ToolDefinition>('test-tool-large');
        
        console.log('Retrieved schema size:', cachedSchema ? JSON.stringify(cachedSchema).length : 0, 'bytes');
        console.log('Schemas match:', JSON.stringify(cachedSchema) === JSON.stringify(largeSchema));
        
        expect(cachedSchema).to.be.an('object');
        expect(cachedSchema).to.deep.equal(largeSchema);
    });

    it('should preserve schemas during cleanup', async () => {
        console.log('\nTest: should preserve schemas during cleanup');
        
        // Set schema
        console.log('Setting schema...');
        await toolCache.setSchema('test-tool', mockSchema);
        
        // Set some non-schema data
        console.log('Setting non-schema data...');
        await toolCache.set('test', 'data', { value: 'test-data' });
        
        // Force cleanup
        console.log('Forcing cleanup...');
        await (toolCache as any).cleanup();
        
        // Schema should still be there
        console.log('Retrieving schema after cleanup...');
        const cachedSchema = await toolCache.getSchema<ToolDefinition>('test-tool');
        
        console.log('Retrieved schema:', JSON.stringify(cachedSchema, null, 2));
        console.log('Schema preserved:', !!cachedSchema);
        
        expect(cachedSchema).to.be.an('object');
        expect(cachedSchema).to.deep.equal(mockSchema);
    });

    it('should track schema cache hits and misses', async () => {
        console.log('\nTest: should track schema cache hits and misses');
        
        const stats1 = await toolCache.getStats();
        console.log('Initial stats:', stats1);
        
        // Miss
        console.log('Testing cache miss...');
        await toolCache.getSchema<ToolDefinition>('nonexistent-tool');
        
        // Set and hit
        console.log('Setting schema and testing cache hit...');
        await toolCache.setSchema('test-tool', mockSchema);
        await toolCache.getSchema<ToolDefinition>('test-tool');
        
        const stats2 = await toolCache.getStats();
        console.log('Final stats:', stats2);
        
        expect(stats2.totalMisses).to.be.greaterThan(stats1.totalMisses);
        expect(stats2.totalHits).to.be.greaterThan(stats1.totalHits);
    });
});
