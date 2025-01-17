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
    let manager: MCPServerManager;
    let serverId: string;
    
    before(async () => {
        // Setup once for all tests
        manager = new MCPServerManager(DatabaseService.getInstance(), AIServiceFactory.create('gpt'));
        serverId = 'brave-search';
        const config = mcpConfig.mcpServers[serverId];
        await manager.startServer(serverId, config);
    });

    after(async () => {
        // Cleanup after all tests
        await manager.stopServer(serverId);
    });

    it('should execute web search tool and get response', async () => {
        const query = '[Calling tool brave_web_search with args {"query": "test query", "count": 1}]';
        const response = await manager.executeToolQuery(serverId, query, 37);
        assert.isString(response);
    });

    it('should handle tool execution errors gracefully', async () => {
        try {
            await manager.executeToolQuery('non-existent-server', '[Calling tool non-existent-tool with args {}]', 37);
            assert.fail('Should have thrown an error');
        } catch (error) {
            assert.instanceOf(error, MCPError);
            assert.equal(error.type, ErrorType.SERVER_NOT_FOUND);
        }
    });
});
