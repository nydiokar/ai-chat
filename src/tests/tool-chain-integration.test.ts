import { expect } from 'chai';
import { ToolChainExecutor } from '../tools/tool-chain/tool-chain-executor.js';
import { ToolChainConfigBuilder } from '../tools/tool-chain/tool-chain-config.js';
import { DatabaseService } from '../services/db-service.js';
import { MCPServerManager } from '../tools/mcp/mcp-server-manager.js';
import { AIServiceFactory } from '../services/ai-service-factory.js';
import { v4 as uuidv4 } from 'uuid';
import { mcpConfig } from '../tools/mcp/mcp_config.js';
import { MemoryRepository } from '../services/memory/memory-repository.js';

describe('Tool Chain Integration Tests', function() {
    this.timeout(30000); // Increase timeout to 30 seconds for real server operations
    
    let executor: ToolChainExecutor;
    let db: DatabaseService;
    let mcpManager: MCPServerManager;
    let memoryRepo: MemoryRepository;
    let toolRegistry: Record<string, (input: any) => Promise<any>>;
    const serverId = 'brave-search';
    
    before(async function() {
        this.timeout(60000); // Even longer timeout for initial setup
        executor = new ToolChainExecutor();
        db = DatabaseService.getInstance();
        memoryRepo = MemoryRepository.getInstance();
        const aiService = AIServiceFactory.create('gpt');
        mcpManager = new MCPServerManager(db, aiService);

        toolRegistry = {
            brave_web_search: mcpManager.executeToolQuery.bind(mcpManager, serverId, 'brave_web_search'),
            memory_store: memoryRepo.saveContext.bind(memoryRepo),
            memory_query: memoryRepo.queryMemory.bind(memoryRepo)
        };
        
        // Start MCP server and enable tools
        await mcpManager.startServer(serverId, mcpConfig.mcpServers[serverId]);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for server startup
        await mcpManager.enableTool(serverId, 'brave_web_search');
    });

    after(async () => {
        await mcpManager.stopServer(serverId);
    });

    describe('Tool Integration', () => {
        it('should execute a chain combining search and memory tools', async () => {
            const chain = new ToolChainConfigBuilder(uuidv4())
                .addTool({
                    name: 'brave_web_search',
                    parameters: { query: 'test query' }
                })
                .addTool({
                    name: 'memory_store',
                    parameters: { 
                        data: '$searchResult',
                        context: 'test-context'
                    }
                })
                .setResultMapping({
                    brave_web_search: 'searchResult'
                })
                .build();

            const result = await executor.execute(chain, toolRegistry);
            expect(result.success).to.be.true;
            expect(result.data).to.have.length(2);
            expect(result.data[0]).to.have.property('content');
        });

        it('should handle cross-tool data dependencies', async () => {
            const chain = new ToolChainConfigBuilder(uuidv4())
                .addTool({
                    name: 'memory_query',
                    parameters: { query: 'test query' }
                })
                .addTool({
                    name: 'brave_web_search',
                    parameters: { 
                        query: '$memoryResult.relevantContext'
                    }
                })
                .addTool({
                    name: 'memory_store',
                    parameters: {
                        data: '$searchResult',
                        context: '$memoryResult.context'
                    }
                })
                .setResultMapping({
                    memory_query: 'memoryResult',
                    brave_web_search: 'searchResult'
                })
                .build();

            const result = await executor.execute(chain, toolRegistry);
            expect(result.success).to.be.true;
            expect(result.data).to.have.length(3);
        });

        it('should maintain context across tool chain execution', async () => {
            const conversationId = await db.createConversation('gpt');
            
            const chain = new ToolChainConfigBuilder(uuidv4())
                .addTool({
                    name: 'memory_store',
                    parameters: {
                        data: 'initial context',
                        conversationId
                    }
                })
                .addTool({
                    name: 'brave_web_search',
                    parameters: { query: 'test' }
                })
                .addTool({
                    name: 'memory_store',
                    parameters: {
                        data: '$searchResult',
                        conversationId
                    }
                })
                .addTool({
                    name: 'memory_query',
                    parameters: { 
                        conversationId,
                        topics: ['test']
                    }
                })
                .setResultMapping({
                    brave_web_search: 'searchResult'
                })
                .build();

            const result = await executor.execute(chain, toolRegistry);
            expect(result.success).to.be.true;

            // Verify context was maintained
            const contexts = await memoryRepo.getContextByConversation(conversationId);
            expect(contexts).to.have.length.greaterThan(1);
        });

        it('should handle concurrent tool chain execution', async () => {
            const chains = Array(3).fill(null).map(() => 
                new ToolChainConfigBuilder(uuidv4())
                    .addTool({
                        name: 'brave_web_search',
                        parameters: { query: `test ${Date.now()}` }
                    })
                    .build()
            );

            const results = await Promise.all(
                chains.map(chain => executor.execute(chain, toolRegistry))
            );

            results.forEach(result => {
                expect(result.success).to.be.true;
                expect(result.data[0]).to.have.property('content');
            });
        });

        it('should handle tool errors gracefully', async () => {
            const chain = new ToolChainConfigBuilder(uuidv4())
                .addTool({
                    name: 'invalid_tool',
                    parameters: {}
                })
                .addTool({
                    name: 'brave_web_search',
                    parameters: { query: 'test' }
                })
                .build();

            const result = await executor.execute(chain, toolRegistry);
            expect(result.success).to.be.false;
            expect(result.error).to.exist;
            // Second tool should not have executed
            expect(result.data).to.have.length(0);
        });
    });

    describe('Tool Chain Performance', () => {
        it('should execute long chains within reasonable time', async () => {
            const chain = new ToolChainConfigBuilder(uuidv4())
                .addTool({
                    name: 'brave_web_search',
                    parameters: { query: 'test 1' }
                })
                .addTool({
                    name: 'brave_web_search',
                    parameters: { query: 'test 2' }
                })
                .addTool({
                    name: 'brave_web_search',
                    parameters: { query: 'test 3' }
                })
                .build();

            const startTime = Date.now();
            const result = await executor.execute(chain, toolRegistry);
            const duration = Date.now() - startTime;

            expect(result.success).to.be.true;
            expect(duration).to.be.lessThan(10000); // Should complete within 10 seconds
        });
    });
});
