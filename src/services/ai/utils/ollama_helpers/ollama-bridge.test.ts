import { expect } from 'chai';
import { OllamaBridge } from './ollama-bridge.js';
import { MCPClientService } from '../../../../tools/mcp/mcp-client-service.js';
import { MCPServerManager } from '../../../../tools/mcp/mcp-server-manager.js';
import { ToolsHandler } from '../../../../tools/tools-handler.js';
import { DatabaseService } from '../../../../services/db-service.js';
import mcpServers from '../../../../tools/mcp/mcp_config.js';
import { OllamaService } from '../../ollama.js';
import fs from 'fs/promises';
import path from 'path';

describe('OllamaBridge', function() {
    this.timeout(60000); // 1 minute is enough for bridge tests
    
    let bridge: OllamaBridge;
    let braveClient: MCPClientService;
    let githubClient: MCPClientService;
    let clients: Map<string, MCPClientService>;
    let mcpManager: MCPServerManager;
    let toolsHandler: ToolsHandler;
    let dbService: DatabaseService;
    const outputDir = path.join(process.cwd(), 'test-results');

    before(async function() {
        // Initialize DatabaseService
        dbService = await DatabaseService.getInstance();

        // Initialize real OllamaService
        const ollamaService = new OllamaService();
        await ollamaService.initPromise;   // Wait for initialization

        // Get MCPServerManager from OllamaService
        mcpManager = ollamaService.mcpManager!;

        // Initialize clients
        braveClient = new MCPClientService(mcpServers.mcpServers["brave-search"]);
        await braveClient.initialize();

        githubClient = new MCPClientService(mcpServers.mcpServers["github"]);
        await githubClient.initialize();

        // Create clients map
        clients = new Map();
        clients.set("brave-search", braveClient);
        clients.set("github", githubClient);

        // Get ToolsHandler from OllamaService
        toolsHandler = ollamaService.toolsHandler!;

        // Initialize bridge with real components
        bridge = new OllamaBridge(
            "llama3.2:latest",
            "http://127.0.0.1:11434",
            clients,
            mcpManager,
            toolsHandler
        );

        // Update available tools
        const braveTools = await braveClient.listTools();
        const githubTools = await githubClient.listTools();
        await bridge.updateAvailableTools([...braveTools, ...githubTools]);

        await fs.mkdir(outputDir, { recursive: true });
    });

    describe('Bridge Functionality', () => {
        it('should handle basic responses without tools', async () => {
            const response = await bridge.processMessage('Say hello');
            expect(response).to.be.a('string');
            expect(response.toLowerCase()).to.include('hello');
        });

        it('should maintain conversation context', async () => { // why do we test this here, when we have services/memory? Thsi is not bridge function  
            const name = 'Alice';
            await bridge.processMessage(`My name is ${name}`);
            const response = await bridge.processMessage('What is my name?');
            expect(response.toLowerCase()).to.contain(name.toLowerCase());
        });

        it('should include tools only when relevant', async () => {
            // No tools case
            const noToolsMsg = await bridge.processMessage('What is 2+2?');
            expect(noToolsMsg).to.not.include('http');
            expect(noToolsMsg).to.not.include('github');

            // With tools case
            const withToolsMsg = await bridge.processMessage('Search for AI news');
            expect(withToolsMsg).to.include('http');
        });

        it('should handle tool errors gracefully', async () => {
            const response = await bridge.processMessage('Search for nonexistent12345xyz');
            expect(response).to.be.a('string');
            expect(response).to.match(/no results|not found|unable to find/i);
        });
    });

    after(async () => {
        await Promise.all([
            braveClient.cleanup(),
            githubClient.cleanup()
        ]);
    });
});
