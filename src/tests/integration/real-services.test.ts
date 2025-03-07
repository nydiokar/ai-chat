import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { OllamaBridge } from '../../services/ai/utils/ollama_helpers/ollama-bridge.js';
import { MCPServerManager } from '../../tools/mcp/mcp-server-manager.js';
import { ToolsHandler } from '../../tools/tools-handler.js';
import { DatabaseService } from '../../services/db-service.js';
import { AIService } from '../../services/ai/base-service.js';
import { MCPServerConfig } from '../../types/tools.js';
import { AIServiceFactory } from '../../services/ai-service-factory.js';

describe('Real Services Integration', () => {
    let db: DatabaseService;
    let aiService: AIService;
    let bridge: OllamaBridge;
    let mcpManager: MCPServerManager;
    let toolsHandler: ToolsHandler;
    let githubConfig: MCPServerConfig;
    let braveConfig: MCPServerConfig;

    beforeEach(async () => {
        // Check for required environment variables
        if (!process.env.GITHUB_TOKEN) {
            throw new Error('GITHUB_TOKEN environment variable is required');
        }
        if (!process.env.BRAVE_API_KEY) {
            throw new Error('BRAVE_API_KEY environment variable is required');
        }

        // Initialize real services
        db = DatabaseService.getInstance();
        aiService = await AIServiceFactory.create();
        
        // Create server configs
        githubConfig = {
            id: 'github',
            name: 'GitHub Tools',
            command: 'node',
            args: ['node_modules/@modelcontextprotocol/server-github/dist/index.js'],
            env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN }
        };

        braveConfig = {
            id: 'brave-search',
            name: 'Brave Search',
            command: 'node',
            args: ['node_modules/@modelcontextprotocol/server-brave-search/dist/index.js'],
            env: { BRAVE_API_KEY: process.env.BRAVE_API_KEY }
        };
        
        mcpManager = new MCPServerManager(db)
        toolsHandler = new ToolsHandler(db, [], aiService);
        
        bridge = new OllamaBridge(
            "llama3.2:latest",
            "http://127.0.0.1:11434",
            new Map(),
            mcpManager,
            toolsHandler
        );

        // Start servers once for all tests
        await mcpManager.startServer('github', githubConfig);
        await mcpManager.startServer('brave-search', braveConfig);
    });

    afterEach(async () => {
        // Clean up all servers
        await mcpManager.stopServer('github');
        await mcpManager.stopServer('brave-search');
    });

    describe('Real Tool Execution', () => {
        it('should execute real tools with actual LLM', async () => {
            const result = await bridge.processMessage("Search for 'typescript testing best practices'");
            expect(result).to.be.a('string');
            expect(result.length).to.be.greaterThan(0);
        });

        it('should persist tool usage in real database', async () => {
            await bridge.processMessage("Search for 'typescript testing best practices'");
            
            const usage = await db.prisma.toolUsage.findMany({
                where: {
                    createdAt: {
                        gte: new Date(Date.now() - 60000) // Last minute
                    }
                }
            });
            
            expect(usage.length).to.be.greaterThan(0);
        });
    });

    describe('Real Context Management', () => {
        it('should build and maintain real tool contexts', async () => {
            await bridge.processMessage("Search for 'typescript testing best practices'");
            await bridge.processMessage("Search for 'mocha chai testing examples'");
            
            const context = await toolsHandler.getToolContext('brave_web_search');
            expect(context).to.not.be.undefined;
            expect(context?.history.length).to.be.greaterThan(1);
        });
    });

    describe('Real Server Management', () => {
        it('should handle server reloads gracefully', async () => {
            const githubTools = await mcpManager.getEnabledTools('github');
            const braveTools = await mcpManager.getEnabledTools('brave-search');
            
            await mcpManager.reloadServer('github');
            await mcpManager.reloadServer('brave-search');
            
            const githubToolsAfter = await mcpManager.getEnabledTools('github');
            const braveToolsAfter = await mcpManager.getEnabledTools('brave-search');
            
            expect(githubToolsAfter).to.deep.equal(githubTools);
            expect(braveToolsAfter).to.deep.equal(braveTools);
        });

        it('should maintain tool availability after reload', async () => {
            const githubServer = mcpManager.getServerByIds('github');
            const braveServer = mcpManager.getServerByIds('brave-search');
            
            expect(githubServer).to.not.be.undefined;
            expect(braveServer).to.not.be.undefined;
            
            await mcpManager.reloadServer('github');
            await mcpManager.reloadServer('brave-search');
            
            const githubServerAfter = mcpManager.getServerByIds('github');
            const braveServerAfter = mcpManager.getServerByIds('brave-search');
            
            expect(githubServerAfter).to.not.be.undefined;
            expect(braveServerAfter).to.not.be.undefined;
        });
    });
}); 