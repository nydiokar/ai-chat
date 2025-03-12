import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import { BaseMCPClient } from '../../base/base-mcp-client.js';
import { ServerConfig } from '../../types/server.js';
import { MCPError } from '../../types/errors.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('BaseMCPClient', () => {
    let mcpClient: BaseMCPClient;
    let config: ServerConfig;
    let mockConnect: sinon.SinonStub;
    let mockRequest: sinon.SinonStub;
    let mockClose: sinon.SinonStub;

    beforeEach(() => {
        console.log('\n=== Setting up test ===');
        // Create config
        config = {
            id: 'test-server',
            name: 'Test Server',
            command: 'test-command',
            args: []
        };
        console.log('Config created:', JSON.stringify(config, null, 2));

        // Create mock methods
        mockConnect = sinon.stub().resolves();
        mockRequest = sinon.stub().resolves({});
        mockClose = sinon.stub().resolves();
        console.log('Mock methods created');

        // Create instance with real classes
        mcpClient = new BaseMCPClient(config, 'test-server');
        console.log('BaseMCPClient instance created');

        // Replace the client and transport instances with our mocks
        const mockClient = {
            connect: mockConnect,
            request: mockRequest
        };
        const mockTransport = {
            close: mockClose,
            stderr: 'inherit'
        };
        console.log('Mock client and transport created:', {
            client: Object.keys(mockClient),
            transport: Object.keys(mockTransport)
        });

        // @ts-ignore - Accessing protected properties for testing
        mcpClient['client'] = mockClient;
        // @ts-ignore - Accessing protected properties for testing
        mcpClient['transport'] = mockTransport;
        console.log('Mocks injected into client');
    });

    describe('initialization', () => {
        it('should create instance with config', () => {
            console.log('\n=== Testing instance creation ===');
            expect(mcpClient).to.be.instanceOf(BaseMCPClient);
            console.log('Instance verified to be BaseMCPClient');
        });

        it('should initialize and connect', async () => {
            console.log('\n=== Testing initialization ===');
            await mcpClient.initialize();
            console.log('Initialize called');
            console.log('Connection state:', mcpClient['isConnected']);
            console.log('Connect called times:', mockConnect.callCount);
            expect(mcpClient['isConnected']).to.be.true;
            expect(mockConnect.calledOnce).to.be.true;
        });
    });

    describe('connection management', () => {
        it('should connect and disconnect successfully', async () => {
            console.log('\n=== Testing connect/disconnect cycle ===');
            await mcpClient.connect();
            console.log('Connect called');
            console.log('Connection state:', mcpClient['isConnected']);
            console.log('Connect called times:', mockConnect.callCount);
            expect(mcpClient['isConnected']).to.be.true;
            expect(mockConnect.calledOnce).to.be.true;

            await mcpClient.disconnect();
            console.log('Disconnect called');
            console.log('Connection state:', mcpClient['isConnected']);
            console.log('Close called times:', mockClose.callCount);
            expect(mcpClient['isConnected']).to.be.false;
            expect(mockClose.calledOnce).to.be.true;
        });

        it('should handle multiple connect/disconnect calls gracefully', async () => {
            console.log('\n=== Testing multiple connect/disconnect calls ===');
            // First connection
            await mcpClient.connect();
            console.log('First connect called');
            console.log('Connection state:', mcpClient['isConnected']);
            console.log('Connect called times:', mockConnect.callCount);
            expect(mcpClient['isConnected']).to.be.true;
            expect(mockConnect.calledOnce).to.be.true;

            // Second connect should not make another call
            await mcpClient.connect();
            console.log('Second connect called');
            console.log('Connection state:', mcpClient['isConnected']);
            console.log('Connect called times:', mockConnect.callCount);
            expect(mcpClient['isConnected']).to.be.true;
            expect(mockConnect.calledOnce).to.be.true;

            // First disconnect
            await mcpClient.disconnect();
            console.log('First disconnect called');
            console.log('Connection state:', mcpClient['isConnected']);
            console.log('Close called times:', mockClose.callCount);
            expect(mcpClient['isConnected']).to.be.false;
            expect(mockClose.calledOnce).to.be.true;

            // Second disconnect should not make another call
            await mcpClient.disconnect();
            console.log('Second disconnect called');
            console.log('Connection state:', mcpClient['isConnected']);
            console.log('Close called times:', mockClose.callCount);
            expect(mcpClient['isConnected']).to.be.false;
            expect(mockClose.calledOnce).to.be.true;
        });
    });

    describe('tool operations', () => {
        beforeEach(async () => {
            console.log('\n=== Setting up tool operation test ===');
            await mcpClient.connect();
            console.log('Client connected for tool test');
        });

        it('should list available tools', async () => {
            console.log('\n=== Testing listTools ===');
            const mockTools = [{
                name: 'test-tool',
                description: 'Test tool',
                version: '1.0.0',
                parameters: [{
                    name: 'param1',
                    type: 'string',
                    description: 'Test parameter',
                    required: true
                }]
            }];
            console.log('Mock tools:', JSON.stringify(mockTools, null, 2));

            mockRequest.resolves(mockTools);
            const tools = await mcpClient.listTools();
            console.log('Received tools:', JSON.stringify(tools, null, 2));
            
            console.log('Request called times:', mockRequest.callCount);
            console.log('Request args:', JSON.stringify(mockRequest.firstCall.args[0], null, 2));
            expect(mockRequest.calledOnce).to.be.true;
            expect(mockRequest.firstCall.args[0]).to.deep.equal({
                method: 'tools/list',
                params: {}
            });
            expect(tools).to.deep.equal(mockTools);
        });

        it('should call tool with arguments', async () => {
            console.log('\n=== Testing callTool ===');
            const mockResponse = {
                success: true,
                data: { result: 'test' },
                error: undefined,
                metadata: undefined
            };
            console.log('Mock response:', JSON.stringify(mockResponse, null, 2));

            mockRequest.resolves(mockResponse);
            const response = await mcpClient.callTool('test-tool', { param: 'value' });
            console.log('Actual response:', JSON.stringify(response, null, 2));
            
            console.log('Request called times:', mockRequest.callCount);
            console.log('Request args:', JSON.stringify(mockRequest.firstCall.args[0], null, 2));
            expect(mockRequest.calledOnce).to.be.true;
            expect(mockRequest.firstCall.args[0]).to.deep.equal({
                method: 'tools/call',
                params: {
                    name: 'test-tool',
                    arguments: { param: 'value' }
                }
            });
            expect(response).to.deep.equal(mockResponse);
        });

        it('should handle tool execution errors', async () => {
            console.log('\n=== Testing tool execution error ===');
            const errorMessage = 'Tool execution failed';
            console.log('Setting up error:', errorMessage);
            mockRequest.rejects(new Error(errorMessage));
            
            try {
                await mcpClient.callTool('test-tool', {});
                expect.fail('Should have thrown an error');
            } catch (err) {
                const error = err as Error;
                console.log('Error caught:', error.message);
                console.log('Error type:', error.constructor.name);
                if (error instanceof MCPError) {
                    console.log('MCPError type:', error.type);
                    console.log('MCPError cause:', error.cause);
                }
                expect(error).to.be.instanceOf(MCPError);
            }
        });
    });

    describe('error handling', () => {
        it('should handle connection errors', async () => {
            console.log('\n=== Testing connection error ===');
            const errorMessage = 'Connection failed';
            console.log('Setting up error:', errorMessage);
            mockConnect.rejects(new Error(errorMessage));
            
            try {
                await mcpClient.connect();
                expect.fail('Should have thrown an error');
            } catch (err) {
                const error = err as Error;
                console.log('Error caught:', error.message);
                console.log('Error type:', error.constructor.name);
                expect(error).to.be.instanceOf(Error);
            }
        });

        it('should handle disconnection errors', async () => {
            console.log('\n=== Testing disconnection error ===');
            await mcpClient.connect();
            console.log('Client connected');
            
            const errorMessage = 'Disconnection failed';
            console.log('Setting up error:', errorMessage);
            mockClose.rejects(new Error(errorMessage));
            
            try {
                await mcpClient.disconnect();
                expect.fail('Should have thrown an error');
            } catch (err) {
                const error = err as Error;
                console.log('Error caught:', error.message);
                console.log('Error type:', error.constructor.name);
                expect(error).to.be.instanceOf(Error);
            }
        });
    });
});