import { expect } from 'chai';
import { MCPContainer } from '../di/container.js';
import { IMCPClient, IToolManager, IServerManager } from '../interfaces/core.js';
import { BaseMCPClient } from '../base/base-mcp-client.js';
import { BaseToolManager } from '../base/base-tool-manager.js';
import { BaseServerManager } from '../base/base-server-manager.js';
import { ServerState } from '../types/server.js';
import { mcpConfig } from '../mcp_config.js';
import sinon from 'sinon';

describe('MCP Base Functionality Tests', () => {
    let container: MCPContainer;
    let client: IMCPClient;
    let toolManager: IToolManager;
    let serverManager: IServerManager;
    let mockConnect: sinon.SinonStub;
    let mockRequest: sinon.SinonStub;
    let mockClose: sinon.SinonStub;

    beforeEach(async () => {
        // Create mock methods
        mockConnect = sinon.stub().resolves();
        mockRequest = sinon.stub().resolves([{
            name: 'test-tool',
            description: 'Test tool',
            version: '1.0.0',
            parameters: []
        }]);
        mockClose = sinon.stub().resolves();

        // Create a new container with base configuration
        container = new MCPContainer(mcpConfig);
        client = container.getMCPClient('github');
        toolManager = container.getToolManager();
        serverManager = container.getServerManager();

        // Replace the client's internal client with our mock
        const mockClient = {
            connect: mockConnect,
            request: mockRequest
        };
        const mockTransport = {
            close: mockClose,
            stderr: 'inherit'
        };

        // @ts-ignore - Accessing protected properties for testing
        (client as BaseMCPClient)['client'] = mockClient;
        // @ts-ignore - Accessing protected properties for testing
        (client as BaseMCPClient)['transport'] = mockTransport;

        // Initialize the client
        await client.initialize();
    });

    afterEach(async () => {
        // Cleanup
        if (client) {
            await client.disconnect();
        }
        // Cleanup any running servers
        if (serverManager) {
            for (const id of serverManager.getServerIds()) {
                await serverManager.unregisterServer(id);
            }
        }
    });

    describe('Container Configuration', () => {
        it('should create base implementations when enhanced features are disabled', () => {
            expect(client).to.be.instanceOf(BaseMCPClient);
            expect(toolManager).to.be.instanceOf(BaseToolManager);
            expect(serverManager).to.be.instanceOf(BaseServerManager);
        });
    });

    describe('Tool Manager', () => {
        it('should register and retrieve tools', async () => {
            const testTool = {
                name: 'test-tool',
                handler: async () => ({ success: true, data: 'test' })
            };

            toolManager.registerTool(testTool.name, testTool.handler);
            const tools = await toolManager.getAvailableTools();
            
            expect(tools).to.have.length.greaterThan(0);
            expect(tools.some(t => t.name === testTool.name)).to.be.true;
        });

        it('should execute registered tools', async () => {
            const testTool = {
                name: 'test-tool',
                handler: async () => ({ success: true, data: 'test-result' })
            };

            toolManager.registerTool(testTool.name, testTool.handler);
            const result = await toolManager.executeTool(testTool.name, {});
            
            expect(result.success).to.be.true;
            expect(result.data).to.equal('test-result');
        });
    });

    describe('Server Manager', () => {
        it('should start and stop servers', async () => {
            const serverId = 'test-server';
            
            await serverManager.startServer(serverId, mcpConfig.mcpServers[serverId]);
            expect(serverManager.hasServer(serverId)).to.be.true;
            
            const server = serverManager.getServer(serverId);
            expect(server?.state).to.equal(ServerState.RUNNING);

            await serverManager.stopServer(serverId);
            expect(serverManager.getServer(serverId)?.state).to.equal(ServerState.STOPPED);
        });
    });
}); 