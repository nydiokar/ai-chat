import { MCPServerManager } from "../src/services/mcp-server-manager.js";
import { DatabaseService } from "../src/services/db-service.js";
import { AIServiceFactory } from "../src/services/ai-service-factory.js";
import { expect } from "chai";
import { describe, it, before, after } from "mocha";
import toolsConfig from "../src/config/tools.js";
import { MCPError, ErrorType } from '../src/types/errors.js';

describe('MCP Integration Tests', () => {
    let mcpManager: MCPServerManager;
    let db: DatabaseService;
    let aiService: any;
    const serverId = 'test-tool';

    before(async () => {
        // Initialize services
        db = DatabaseService.getInstance();
        aiService = AIServiceFactory.create('gpt');
        mcpManager = new MCPServerManager(db, aiService);

        const serverConfig = {
            command: 'node',
            args: ['./dist/tools/test-tool.js'],
            env: { NODE_ENV: 'test' }
        };

        try {
            await mcpManager.startServer(serverId, serverConfig);
            
            // Verify tool registration matches config
            const client = mcpManager['_servers'].get(serverId);
            if (!client) throw new Error('Server not initialized');
            
            const availableTools = await client.listTools();
            const configuredTools = toolsConfig.tools;
            
            expect(availableTools.length).to.equal(configuredTools.length);
            expect(availableTools[0].name).to.equal(configuredTools[0].name);
            expect(availableTools[0].description).to.equal(configuredTools[0].description);
        } catch (error) {
            console.error('Failed to start server:', error);
            throw error;
        }
    });

    it('should execute configured tool and get response', async () => {
        const conversationId = await db.createConversation('gpt');
        const toolName = toolsConfig.tools[0].name; // Get name from config
        
        const query = `Use ${toolName} with parameter 'test-value'`;
        const response = await mcpManager.executeToolQuery(serverId, query, conversationId);

        // Verify response matches tool's expected format
        expect(response).to.include('Test tool executed with param: test-value');

        // Verify conversation was recorded
        const conversation = await db.getConversation(conversationId);
        expect(conversation).to.exist;
        expect(conversation?.messages).to.have.length.greaterThan(0);

        // Verify tool usage was recorded
        const toolUsage = await db.executePrismaOperation(prisma => 
            prisma.mCPToolUsage.findFirst({
                where: { 
                    conversationId,
                    toolId: toolName
                }
            })
        );
        expect(toolUsage).to.exist;
    });

    it('should handle tool execution errors gracefully', async () => {
        const conversationId = await db.createConversation('gpt');
        const nonExistentTool = 'non-existent-tool';
        
        const query = `Use ${nonExistentTool}`;
        
        try {
            await mcpManager.executeToolQuery(serverId, query, conversationId);
            expect.fail('Should have thrown an error');
        } catch (error) {
            expect(error).to.be.instanceOf(MCPError);
            expect((error as MCPError).type).to.equal(ErrorType.TOOL_NOT_FOUND);
            expect((error as MCPError).message).to.equal(`Tool not found: ${nonExistentTool}`);
        }
    });

    after(async () => {
        // Cleanup
        await mcpManager.stopServer(serverId);
        await db.disconnect();
    });
}); 