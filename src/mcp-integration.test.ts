import dotenv from 'dotenv';
dotenv.config(); // Load environment variables first

import { MCPServerManager } from "./services/mcp/mcp-server-manager.js";
import { DatabaseService } from "../src/services/db-service.js";
import { AIServiceFactory } from "../src/services/ai-service-factory.js";
import { assert, expect } from "chai";
import { describe, it, before, after } from "mocha";
import { mcpConfig } from "./tools/tools.js";
import { MCPError, ErrorType } from '../src/types/errors.js';

describe('MCP Integration Tests', () => {
    let mcpManager: MCPServerManager;
    const serverId = 'brave-search';

    before(async () => {
        const db = DatabaseService.getInstance();
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
        const query = '[Calling tool brave_web_search with args {"query": "test query", "count": 1}]';
        const response = await mcpManager.executeToolQuery(serverId, query, 37);
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
