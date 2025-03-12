import { expect } from 'chai';
import { describe, it, before, after } from 'mocha';
import { IMCPClient, IServerManager } from '../tools/mcp/migration/interfaces/core.js';
import { MCPContainer } from '../tools/mcp/migration/di/container.js';
import { mcpConfig } from '../tools/mcp/mcp_config.js';
import { ToolDefinition, ToolResponse } from '../tools/mcp/migration/types/tools.js';

describe('OpenAI MCP Integration', () => {
    let client: IMCPClient;
    let serverManager: IServerManager;
    let container: MCPContainer;
    
    // Store original console methods
    const originalLog = console.log;
    const originalDebug = console.debug;
    const originalInfo = console.info;
    
    // Increase timeout for async operations
    before(async function() {
        this.timeout(10000); // 10 seconds
        
        // Keep error logging
        const originalError = console.error;
        console.log = (...args) => originalLog('[TEST]', ...args);
        console.debug = () => {};
        console.info = () => {};
        console.error = (...args) => originalError('[TEST ERROR]', ...args);
        
        try {
            originalLog('[TEST] Creating MCP container...');
            container = new MCPContainer(mcpConfig);
            
            originalLog('[TEST] Getting server manager...');
            serverManager = container.getServerManager();
            
            originalLog('[TEST] Starting servers...');
            for (const [id, config] of Object.entries(mcpConfig.mcpServers)) {
                originalLog(`[TEST] Starting server ${id}...`);
                if (config.env) {
                    const envStatus = {
                        BRAVE_API_KEY: config.env.BRAVE_API_KEY ? 'set' : 'not set',
                        GITHUB_TOKEN: config.env.GITHUB_PERSONAL_ACCESS_TOKEN ? 'set' : 'not set'
                    };
                    originalLog(`[TEST] Server ${id} env status:`, envStatus);
                }
                try {
                    await serverManager.startServer(id, config);
                    originalLog(`[TEST] Server ${id} started successfully`);
                    
                    // Get and initialize client for this server
                    originalLog(`[TEST] Getting client for ${id}...`);
                    const serverClient = container.getMCPClient(id);
                    await serverClient.initialize();
                    await serverClient.connect();
                    
                    // Verify tools for this server
                    originalLog(`[TEST] Verifying tools for ${id}...`);
                    const tools = await serverClient.listTools();
                    originalLog(`[TEST] Server ${id} tools:`, tools.map(t => t.name));
                    
                    // Add a delay after initialization
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    originalLog(`[TEST] Server ${id} fully initialized`);
                } catch (err) {
                    console.error(`Failed to initialize server ${id}:`, err);
                    throw err;
                }
            }
            
            // Use the Brave Search client for our tests
            client = container.getMCPClient('brave-search');
            if (!client) {
                throw new Error('Brave Search client not found');
            }
            
            originalLog('[TEST] Setup complete');
        } catch (err) {
            console.error('Setup failed:', err);
            throw err;
        }
    });
    
    after(async function() {
        this.timeout(5000); // 5 seconds
        
        // Restore console methods
        console.log = originalLog;
        console.debug = originalDebug;
        console.info = originalInfo;
        
        originalLog('[TEST] Cleaning up...');
        try {
            // Stop all servers and cleanup
            for (const id of serverManager.getServerIds()) {
                originalLog(`[TEST] Stopping server ${id}...`);
                await serverManager.stopServer(id);
            }
            if (client) {
                await client.disconnect();
            }
            originalLog('[TEST] Cleanup complete');
        } catch (err) {
            console.error('Cleanup failed:', err);
            throw err;
        }
    });

    describe('1. Basic Response Generation', () => {
        it('should list available tools', async function() {
            this.timeout(5000); // 5 seconds
            originalLog('[TEST] Listing tools...');
            try {
                const tools = await client.listTools();
                originalLog('[TEST] Raw tools response:', JSON.stringify(tools, null, 2));
                const toolNames = tools.map(t => t.name);
                originalLog(`[TEST] Available tools (${tools.length}):`, toolNames);
                expect(tools).to.be.an('array');
                expect(tools.length).to.be.greaterThan(0);
                
                // Check for specific tools
                const braveWebSearch = tools.find(t => t.name === 'brave_web_search');
                const braveLocalSearch = tools.find(t => t.name === 'brave_local_search');
                
                originalLog('[TEST] Brave Web Search tool:', braveWebSearch ? 'found' : 'not found');
                originalLog('[TEST] Brave Local Search tool:', braveLocalSearch ? 'found' : 'not found');
                
                expect(braveWebSearch).to.exist;
                expect(braveLocalSearch).to.exist;
            } catch (err) {
                originalLog('[TEST] Error listing tools:', err);
                throw err;
            }
        });
    });

    describe('2. Tool Recognition', () => {
        it('should have search tool available', async function() {
            this.timeout(5000); // 5 seconds
            originalLog('[TEST] Checking for brave_web_search tool...');
            const tools = await client.listTools();
            const searchTool = tools.find(t => t.name === 'brave_web_search');
            originalLog(`[TEST] brave_web_search tool found: ${!!searchTool}`);
            expect(searchTool).to.exist;
            expect(searchTool?.name).to.equal('brave_web_search');
        });
    });

    describe('3. Tool Usage', () => {
        it('should execute search tool successfully', async function() {
            this.timeout(5000); // 5 seconds
            originalLog('[TEST] Calling brave_web_search tool...');
            const response = await client.callTool('brave_web_search', {
                query: 'latest version of Node.js',
                count: 5
            }) as ToolResponse;
            originalLog(`[TEST] Search response:`, response);
            expect(response).to.exist;
            expect(response).to.be.an('object');
            expect(response.success).to.be.true;
            expect(response.data).to.exist;
            if (response.error) {
                originalLog('[TEST] Search error:', response.error);
            }
        });
    });
});