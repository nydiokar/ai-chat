import { expect } from 'chai';
import sinon from 'sinon';
import { ReActAgent } from './react-agent.js';
import { IToolManager } from '../tools/mcp/interfaces/core.js';
import { ToolDefinition, ToolResponse } from '../tools/mcp/types/tools.js';
import { MCPContainer } from '../tools/mcp/di/container.js';
import { Input } from '../types/common.js';
import { LLMProvider } from '../interfaces/llm-provider.js';
import { ReActPromptGenerator } from '../prompt/react-prompt-generator.js';
import yaml from 'js-yaml';

describe('ReActAgent', () => {
    let agent: ReActAgent;
    let mockToolManager: sinon.SinonStubbedInstance<IToolManager>;
    let mockLLMProvider: sinon.SinonStubbedInstance<LLMProvider>;
    let mockPromptGenerator: sinon.SinonStubbedInstance<ReActPromptGenerator>;
    let container: MCPContainer;

    beforeEach(() => {
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

        const mockTool: ToolDefinition = {
            name: 'test_tool',
            description: 'Test tool',
            inputSchema: {
                type: 'object',
                required: ['param1'],
                properties: {
                    param1: { type: 'string' }
                }
            },
            handler: async (args: Record<string, unknown>) => ({
                success: true,
                data: 'test result',
                metadata: {}
            })
        };

        mockToolManager = {
            getAvailableTools: sinon.stub().resolves([mockTool]),
            executeTool: sinon.stub().resolves({
                success: true,
                data: 'test result',
                metadata: {}
            }),
            getToolByName: sinon.stub().resolves(mockTool),
            registerTool: sinon.stub(),
            refreshToolInformation: sinon.stub()
        } as unknown as sinon.SinonStubbedInstance<IToolManager>;

        mockLLMProvider = {
            generateResponse: sinon.stub(),
            getModel: sinon.stub().returns('test-model'),
            setSystemPrompt: sinon.stub(),
            cleanup: sinon.stub().resolves()
        } as unknown as sinon.SinonStubbedInstance<LLMProvider>;

        mockPromptGenerator = {
            generatePrompt: sinon.stub().resolves('test prompt')
        } as unknown as sinon.SinonStubbedInstance<ReActPromptGenerator>;

        sinon.stub(container, 'getToolManager').returns(mockToolManager);
        agent = new ReActAgent(container, mockLLMProvider, mockPromptGenerator, 'Test Agent');
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('Thought Process Management', () => {
        it('should handle direct responses without tool execution', async () => {
            const thoughtProcess = {
                thought: {
                    reasoning: "Simple response needed",
                    plan: "Provide direct answer"
                }
            };

            mockLLMProvider.generateResponse.resolves({
                content: yaml.dump(thoughtProcess),
                tokenCount: 0,
                toolResults: []
            });

            const response = await agent.processMessage('test message');
            
            expect(response.content).to.equal(yaml.dump(thoughtProcess));
            expect(response.toolResults).to.have.length(0);
        });

        it('should execute single-step tool action', async () => {
            const thoughtProcess = {
                thought: {
                    reasoning: "Need to use tool",
                    plan: "Execute test"
                },
                action: {
                    tool: "test_tool",
                    params: {
                        param1: "test"
                    }
                }
            };

            mockLLMProvider.generateResponse.resolves({
                content: yaml.dump(thoughtProcess),
                tokenCount: 0,
                toolResults: []
            });

            const response = await agent.processMessage('test message');
            
            expect(mockToolManager.executeTool.calledOnce).to.be.true;
            expect(response.toolResults[0].success).to.be.true;
            expect(response.toolResults[0].data).to.equal('test result');
        });

        it('should handle multi-step tool execution chain', async () => {
            const step1 = {
                thought: {
                    reasoning: "First step",
                    plan: "Execute first tool"
                },
                action: {
                    tool: "test_tool",
                    params: {
                        param1: "step1"
                    }
                }
            };

            const step2 = {
                thought: {
                    reasoning: "Second step",
                    plan: "Process result and finish"
                }
            };

            mockLLMProvider.generateResponse
                .onFirstCall().resolves({
                    content: yaml.dump(step1),
                    tokenCount: 0,
                    toolResults: []
                })
                .onSecondCall().resolves({
                    content: yaml.dump(step2),
                    tokenCount: 0,
                    toolResults: []
                });

            const response = await agent.processMessage('test message');
            
            expect(mockToolManager.executeTool.calledOnce).to.be.true;
            expect(response.content).to.equal(yaml.dump(step2));
            expect(response.toolResults).to.have.length(1);
        });

        it('should handle invalid YAML responses', async () => {
            mockLLMProvider.generateResponse.resolves({
                content: 'not yaml',
                tokenCount: 0,
                toolResults: []
            });

            const response = await agent.processMessage('test message');
            
            expect(response.content).to.equal('not yaml');
            expect(response.toolResults).to.have.length(0);
        });

        it('should handle tool execution errors', async () => {
            const thoughtProcess = {
                thought: {
                    reasoning: "Need to use tool",
                    plan: "Execute test"
                },
                action: {
                    tool: "test_tool",
                    params: {
                        param1: "test"
                    }
                }
            };

            mockLLMProvider.generateResponse.resolves({
                content: yaml.dump(thoughtProcess),
                tokenCount: 0,
                toolResults: []
            });

            mockToolManager.executeTool.rejects(new Error('Tool failed'));

            const response = await agent.processMessage('test message');
            
            expect(response.toolResults[0].success).to.be.false;
            expect(response.toolResults[0].error).to.equal('Tool execution failed');
        });
    });
}); 