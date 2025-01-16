import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';

// Define the schema for tool responses
const ToolResponseSchema = z.object({
    content: z.array(z.object({
        text: z.string()
    }))
});

async function main() {
    // Configure the transport to spawn the tool process
    const transport = new StdioClientTransport({
        command: 'node',
        args: ['dist/tools/test-tool.js'],
        env: {
            ...process.env,
            NODE_ENV: 'development'
        },
        stderr: 'inherit'  // This will show server's stderr output
    });

    transport.onerror = (error) => {
        console.error('Transport error:', error);
    };

    const client = new Client(
        {
            name: 'test-client',
            version: '1.0.0',
        },
        {
            capabilities: {}
        }
    );

    try {
        console.log('Connecting to server...');
        await client.connect(transport);
        console.log('Connected to server');

        console.log('Sending request...');
        const response = await client.request({
            method: 'tools/call',
            params: {
                name: 'test-tool',
                arguments: {
                    param: 'Hello from client!'
                }
            }
        }, ToolResponseSchema);

        console.log('Server response:', response);
    } catch (error) {
        console.error('Error:', error);
    } finally {
        console.log('Closing connection...');
        await client.close();
        process.exit(0);
    }
}

main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
}); 