import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Define the schema for tool calls
const ToolCallRequestSchema = z.object({
    method: z.literal('tools/call'),
    params: z.object({
        name: z.string(),
        arguments: z.object({
            param: z.string()
        })
    })
});

const ToolListRequestSchema = z.object({
    method: z.literal('tools/list'),
    params: z.object({}).optional()
});

class TestToolServer extends Server {
    protected assertCapabilityForMethod(): void {}
    protected assertNotificationCapability(): void {}
    protected assertRequestHandlerCapability(): void {}
}

async function main() {
    const transport = new StdioServerTransport();
    const server = new TestToolServer(
        {
            name: 'test-tool',
            version: '1.0.0',
        },
        {
            capabilities: {
                tools: {
                    'test-tool': {
                        name: 'test-tool',
                        description: 'Test tool for demonstration',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                param: {
                                    type: 'string',
                                    description: 'Test parameter'
                                }
                            }
                        }
                    }
                }
            }
        }
    );

    // Register request handler for tool calls
    server.setRequestHandler(ToolCallRequestSchema, async (request) => {
        return {
            content: [{
                text: `Test tool executed with param: ${request.params.arguments.param}`
            }]
        };
    });

    // Register request handler for tool listing
    server.setRequestHandler(ToolListRequestSchema, async () => {
        return {
            tools: [{
                name: 'test-tool',
                description: 'Test tool for demonstration',
                inputSchema: {
                    type: 'object',
                    properties: {
                        param: {
                            type: 'string',
                            description: 'Test parameter'
                        }
                    }
                }
            }]
        };
    });

    try {
        await server.connect(transport);
        console.log('Test tool server started');
        
        process.on('SIGINT', async () => {
            console.log('Received SIGINT, closing server...');
            await server.close();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            console.log('Received SIGTERM, closing server...');
            await server.close();
            process.exit(0);
        });

        // Keep the process alive
        await new Promise(() => {});
    } catch (error) {
        console.error('Failed to start test tool server:', error);
        process.exit(1);
    }
}

main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
}); 