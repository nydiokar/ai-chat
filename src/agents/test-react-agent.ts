import { ReActAgent } from '../agents/react-agent.js';
import { ReActPromptGenerator } from '../prompt/react-prompt-generator.js';
import { OpenAIProvider } from '../providers/openai.js';
import { MCPContainer } from '../tools/mcp/di/container.js';
import { ToolDefinition, ToolResponse } from '../tools/mcp/types/tools.js';
import { Input } from '../types/common.js';
import { BaseConfig, AIProviders } from '../utils/config.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Mock tool definition for testing
const mockTool: ToolDefinition = {
    name: 'echo',
    description: 'Echoes back the input message',
    inputSchema: {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                description: 'The message to echo back'
            }
        },
        required: ['message']
    },
    handler: async (args: { message: string }): Promise<ToolResponse> => {
        return {
            success: true,
            data: `Echoed: ${args.message}`,
            metadata: { echoed: true }
        };
    }
};

// Create a mock MCPContainer that provides the mockTool
class MockMCPContainer {
    async getToolManager() {
        return {
            getAvailableTools: async () => [mockTool],
            getToolByName: async (name: string) => {
                if (name === 'echo') {
                    return mockTool;
                }
                return undefined;
            }
        };
    }
}

// Proper config matching BaseConfig interface
const config: BaseConfig = {
    debug: false,
    logging: {
        level: 'info',
        showTools: true,
        showRequests: true
    },
    maxRetries: 3,
    retryDelay: 1000,
    rateLimitDelay: 1000,
    defaultModel: AIProviders.OPENAI,
    messageHandling: {
        maxContextMessages: 3,
        maxTokens: 4096,
        tokenBuffer: 1000,
        maxMessageLength: 8000
    },
    openai: {
        model: 'gpt-3.5-turbo',
        temperature: 0.7,
        maxRetries: 3
    },
    discord: {
        enabled: false,
        cleanupInterval: 24,
        sessionTimeout: 12,
        mcp: {
            enabled: false
        }
    }
};

// Test function
async function testReActAgent() {
    try {
        console.log('=== Testing ReAct Agent with a simple tool call ===');

        // Create the provider and agent components
        const llmProvider = new OpenAIProvider(config);
        const promptGenerator = new ReActPromptGenerator();
        const container = new MockMCPContainer() as unknown as MCPContainer;
        
        // Create the agent
        const agent = new ReActAgent(container, llmProvider, promptGenerator, 'TestAgent');
        console.log('Agent created successfully');

        // Test a simple query that should use the tool
        const testInput = 'Please use the echo tool to say "Hello, World!"';
        console.log(`\nSending test input: "${testInput}"`);

        // Process the message
        const response = await agent.processMessage(testInput);
        
        // Log the response
        console.log('\nResponse received:');
        console.log(`Content: ${response.content}`);
        console.log(`Token count: ${response.tokenCount}`);
        console.log(`Tool results: ${response.toolResults.length}`);
        
        response.toolResults.forEach((result, index) => {
            console.log(`\nTool result #${index + 1}:`);
            console.log(`Success: ${result.success}`);
            console.log(`Data: ${result.data}`);
            if (result.error) console.log(`Error: ${result.error}`);
            console.log(`Metadata:`, result.metadata);
        });

        console.log('\n=== Test completed successfully ===');
    } catch (error) {
        console.error('Error testing ReAct agent:', error);
    }
}

// Run the test
testReActAgent().catch(console.error); 