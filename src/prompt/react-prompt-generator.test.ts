import { expect } from 'chai';
import { ReActPromptGenerator } from './react-prompt-generator.js';
import { ToolDefinition, MCPToolSchema } from '../tools/mcp/types/tools.js';
import { MCPContainer } from '../tools/mcp/di/container.js';

describe('ReActPromptGenerator', () => {
    let promptGenerator: ReActPromptGenerator;
    let mockTools: ToolDefinition[];
    let container: MCPContainer;

    beforeEach(() => {
        // Setup minimal container configuration
        container = new MCPContainer({
            features: {
                core: {
                    serverManagement: true,
                    toolOperations: true,
                    clientCommunication: true
                },
                enhanced: {
                    analytics: false,
                    contextManagement: false,
                    caching: false,
                    stateManagement: false,
                    healthMonitoring: false
                }
            },
            mcpServers: {}
        });

        promptGenerator = new ReActPromptGenerator();
        mockTools = [
            {
                name: 'test_tool',
                description: 'A test tool for unit testing',
                inputSchema: {
                    type: 'object',
                    properties: {
                        param1: { 
                            type: 'string',
                            description: 'Test parameter'
                        }
                    },
                    required: ['param1']
                }
            }
        ];
    });

    it('should generate valid ReAct prompt with tools', async () => {
        const prompt = await promptGenerator.generatePrompt('test message', mockTools);
        
        // Verify prompt contains essential ReAct components
        expect(prompt).to.include('ReAct framework');
        expect(prompt).to.include('thought:');
        expect(prompt).to.include('action:');
        expect(prompt).to.include('params:');
        expect(prompt).to.include('observation:');
        
        // Verify tool information is included
        expect(prompt).to.include('test_tool');
        expect(prompt).to.include('A test tool for unit testing');
        expect(prompt).to.include('param1');
    });

    it('should handle empty tools array', async () => {
        const prompt = await promptGenerator.generatePrompt('test message', []);
        
        // Should still include ReAct framework elements
        expect(prompt).to.include('ReAct framework');
        expect(prompt).to.include('thought:');
        expect(prompt).to.include('action:');
        
        // Should not include tool-specific content
        expect(prompt).not.to.include('test_tool');
    });

    it('should include proper YAML formatting instructions', async () => {
        const prompt = await promptGenerator.generatePrompt('test message', mockTools);
        
        // Verify YAML formatting instructions
        expect(prompt).to.include('YAML format');
        expect(prompt).to.include('thought:');
        expect(prompt).to.include('reasoning:');
        expect(prompt).to.include('plan:');
    });

    it('should handle tools with complex parameters', async () => {
        const complexTools: ToolDefinition[] = [{
            name: 'complex_tool',
            description: 'A tool with complex parameters',
            inputSchema: {
                type: 'object',
                properties: {
                    nested: { 
                        type: 'string',
                        description: 'A nested parameter'
                    },
                    array: {
                        type: 'string',
                        description: 'An array parameter'
                    }
                },
                required: ['nested']
            }
        }];

        const prompt = await promptGenerator.generatePrompt('test message', complexTools);
        
        // Verify complex parameter handling
        expect(prompt).to.include('complex_tool');
        expect(prompt).to.include('nested');
        expect(prompt).to.include('array');
    });

    it('should include error handling instructions', async () => {
        const prompt = await promptGenerator.generatePrompt('test message', mockTools);
        
        // Verify error handling guidance
        expect(prompt).to.include('error');
        expect(prompt).to.include('handle errors');
        expect(prompt).to.include('alternative approach');
    });

    it('should include example response', async () => {
        const generator = new ReActPromptGenerator();
        const prompt = await generator.generatePrompt('test message', []);
        
        expect(prompt).to.include('Example response for "What\'s the weather like?"');
        expect(prompt).to.include('purpose: "Fetch current weather data for accurate reporting"');
        expect(prompt).to.include('plan: "Summarize weather data in a user-friendly format with relevant details"');
    });
}); 