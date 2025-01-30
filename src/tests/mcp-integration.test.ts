import dotenv from 'dotenv';
dotenv.config(); // Load environment variables first

import { MCPServerManager } from "../services/mcp/mcp-server-manager.js";
import { DatabaseService } from "../services/db-service.js";
import { AIServiceFactory } from "../services/ai-service-factory.js";
import { assert } from "chai";
import { describe, it, before, after } from "mocha";
import { mcpConfig } from "../utils/tools.js";
import { MCPError, ErrorType } from '../types/errors.js';

describe('MCP Integration Tests', () => {
    let mcpManager: MCPServerManager;
    let db: DatabaseService;
    let conversationId: number;
    const serverId = 'brave-search';

    before(async () => {
        db = DatabaseService.getInstance();
        const aiService = AIServiceFactory.create('gpt');
        mcpManager = new MCPServerManager(db, aiService);
        
        // Start server and wait for it to be ready
        await mcpManager.startServer(serverId, mcpConfig.mcpServers[serverId]);
        
        // Wait a bit for server to fully initialize
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Enable the tool
        await mcpManager.enableTool(serverId, 'brave_web_search');
        
        // Wait for tool to be enabled
        await new Promise(resolve => setTimeout(resolve, 1000));
    });

    after(async () => {
        // Clean up
        await mcpManager.stopServer(serverId);
    });

    it('should execute web search tool and get response', async () => {
        // Create a test conversation first
        conversationId = await db.createConversation('gpt');

        const response = await mcpManager.executeToolQuery(
            serverId, 
            'brave_web_search',
            conversationId
        );
        assert.isString(response);
    });

    it('should handle tool execution errors gracefully', async () => {
        try {
            await mcpManager.executeToolQuery('non-existent-server', '[Calling tool non-existent-tool with args {}]', 37);
            assert.fail('Should have thrown an error');
        } catch (error) {
            assert.instanceOf(error, MCPError);
            assert.equal(error.type, ErrorType.SERVER_NOT_FOUND);
        }
    });
});
