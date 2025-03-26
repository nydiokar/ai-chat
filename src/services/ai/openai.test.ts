import { expect } from 'chai';
import { OpenAIService } from './openai.js';
import { MCPContainer } from '../../tools/mcp/di/container.js';
import { MCPError } from '../../types/errors.js';
import { mcpConfig } from '../../mcp_config.js';
import { AIMessage } from '../../types/ai-service.js';
import sinon from 'sinon';
import { IMCPClient, IToolManager, IServerManager } from '../../tools/mcp/interfaces/core.js';
import { ToolDefinition, ToolResponse, ToolHandler } from '../../tools/mcp/types/tools.js';

describe('OpenAIService Integration Tests', () => {
    let service: OpenAIService;
    let container: MCPContainer;
    let sandbox: sinon.SinonSandbox;
    let toolManagerMock: IToolManager;

    before(async () => {
        // Create a sinon sandbox for test isolation
        sandbox = sinon.createSandbox();

        // Ensure we have API key
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY environment variable must be set to run tests');
        }

        // Create a mock tool manager
        toolManagerMock = {
            getAvailableTools: sandbox.stub().resolves([]) as () => Promise<ToolDefinition[]>,
            executeTool: sandbox.stub().resolves({ success: true, data: {} }) as (name: string, args: any) => Promise<ToolResponse>,
            registerTool: sandbox.stub() as (name: string, handler: ToolHandler) => void,
            getToolByName: sandbox.stub().resolves(undefined) as (name: string) => Promise<ToolDefinition | undefined>,
            refreshToolInformation: sandbox.stub().resolves() as () => Promise<void>
        };

        // Create a minimal container mock that just provides the tool manager
        container = {
            getToolManager: () => toolManagerMock
        } as MCPContainer;

        // Initialize the service with our mocked container
        service = new OpenAIService(container);
    });

    describe('Basic Functionality', () => {
        it('should generate a simple response without tools', async () => {
            // Ensure getAvailableTools returns empty array for this test
            (toolManagerMock.getAvailableTools as sinon.SinonStub).resolves([]);

            const response = await service.generateResponse('What is 2+2?');
            
            expect(response).to.have.property('content').that.is.a('string');
            expect(response.content).to.include('4');
            expect(response).to.have.property('tokenCount').that.is.a('number');
            expect(response.toolResults).to.be.an('array').that.is.empty;
        });

        it('should handle conversation history', async () => {
            // Ensure getAvailableTools returns empty array for this test
            (toolManagerMock.getAvailableTools as sinon.SinonStub).resolves([]);

            const history: AIMessage[] = [
                { role: 'user', content: 'My name is Alice' },
                { role: 'assistant', content: 'Hello Alice, nice to meet you!' }
            ];

            const response = await service.generateResponse('What is my name?', history);
            
            expect(response.content.toLowerCase()).to.include('alice');
        });
    });

    describe('Tool Integration', () => {
        beforeEach(() => {
            // Setup mock tools for each test with updated schema
            (toolManagerMock.getAvailableTools as sinon.SinonStub).resolves([{
                name: 'list_dir',
                description: 'Lists directory contents',
                inputSchema: {
                    type: 'object',
                    properties: {
                        relative_workspace_path: {
                            type: 'string',
                            description: 'Path to list contents of, relative to the workspace root'
                        },
                        explanation: {
                            type: 'string',
                            description: 'One sentence explanation as to why this tool is being used, and how it contributes to the goal.'
                        }
                    },
                    required: ['relative_workspace_path']
                },
                version: '1.0.0'
            } as unknown as ToolDefinition]);

            (toolManagerMock.executeTool as sinon.SinonStub).resolves({
                success: true,
                data: { files: ['file1.ts', 'file2.ts'] }
            });
        });

        it('should execute a tool when appropriate', async () => {
            const response = await service.generateResponse(
                'What files are in the current directory? Use the appropriate tool to find out.'
            );
            
            expect(response.toolResults).to.be.an('array');
            expect((toolManagerMock.executeTool as sinon.SinonStub).called).to.be.true;
            expect(response.content).to.include('directory');
        });

        it('should handle multiple tool calls in sequence', async () => {
            const response = await service.generateResponse(
                'First list the files in the current directory, then search for any typescript files.'
            );
            
            expect(response.toolResults).to.be.an('array');
            expect((toolManagerMock.executeTool as sinon.SinonStub).callCount).to.be.greaterThan(0);
            expect(response.content).to.satisfy((content: string) => 
                content.includes('directory') || content.includes('file') || content.includes('.ts')
            );
        });

        it('should provide helpful responses when tools fail', async () => {
            // Setup tool to fail for this test
            (toolManagerMock.executeTool as sinon.SinonStub).rejects(new Error('Directory not found'));

            const response = await service.generateResponse(
                'Try to access a non-existent directory /this/does/not/exist'
            );
            
            expect(response.content).to.satisfy((content: string) => 
                content.includes('not found') || content.includes('does not exist') || 
                content.includes('failed') || content.includes('error')
            );
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid model gracefully', async () => {
            const originalModel = process.env.OPENAI_MODEL;
            process.env.OPENAI_MODEL = 'invalid-model';
            
            try {
                await service.generateResponse('Test message');
                expect.fail('Should have thrown an error');
            } catch (err: unknown) {
                const error = err as MCPError;
                expect(error).to.be.instanceOf(MCPError);
                expect(error.message).to.include('Failed to generate response');
                // The error could be either an OpenAI API error or a local validation error
                // Both are valid cases and should be handled gracefully
                if (error.cause) {
                    expect((error.cause as Error).message).to.satisfy((msg: string) => 
                        msg.includes('model') || msg.includes('undefined')
                    );
                }
            } finally {
                process.env.OPENAI_MODEL = originalModel;
            }
        });
    });

    describe('System Prompt', () => {
        it('should use custom system prompt when provided', async () => {
            const customPrompt = 'You are a mathematician who only talks about numbers.';
            service.setSystemPrompt(customPrompt);

            // Reset any cached tools/prompts
            await (toolManagerMock.refreshToolInformation as sinon.SinonStub).resolves();
            (toolManagerMock.getAvailableTools as sinon.SinonStub).resolves([]);

            const response = await service.generateResponse('Tell me about yourself');
            
            expect(response.content.toLowerCase()).to.satisfy((content: string) => 
                content.includes('number') || 
                content.includes('math') || 
                content.includes('calculate')
            );
        });
    });

    afterEach(() => {
        // Reset all stubs after each test
        sandbox.reset();
    });

    after(() => {
        sandbox.restore();
    });
});
