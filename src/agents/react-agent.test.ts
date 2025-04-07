import { expect } from 'chai';
import sinon from 'sinon';
import { ReActAgent } from './react-agent';
import { IToolManager } from '../tools/mcp/interfaces/core.js';
import { ToolDefinition, ToolResponse, MCPToolSchema } from '../tools/mcp/types/tools.js';
import { MCPContainer } from '../tools/mcp/di/container.js';
import { Input, MessageRole } from '../types/common.js';
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
        // Setup container with mocked tool manager
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

        // Create mock tool manager
        mockToolManager = {
            getAvailableTools: sinon.stub().resolves([{
                name: 'test_tool',
                description: 'Test tool',
                inputSchema: {
                    type: 'object',
                    required: ['param1'],
                    properties: {
                        param1: { type: 'string' }
                    }
                } as MCPToolSchema
            }]),
            executeTool: sinon.stub().resolves({
                success: true,
                data: 'test result'
            } as ToolResponse),
            getToolByName: sinon.stub(),
            registerTool: sinon.stub(),
            refreshToolInformation: sinon.stub()
        } as unknown as sinon.SinonStubbedInstance<IToolManager>;

        // Create mock LLM provider
        mockLLMProvider = {
            generateResponse: sinon.stub().resolves({
                content: `
thought:
  reasoning: "Test reasoning"
  plan: "Test plan"
`,
                tokenCount: 0,
                toolResults: []
            }),
            getModel: sinon.stub().returns('test-model'),
            setSystemPrompt: sinon.stub(),
            cleanup: sinon.stub().resolves()
        } as unknown as sinon.SinonStubbedInstance<LLMProvider>;

        // Create mock prompt generator with updated signature
        mockPromptGenerator = {
            generatePrompt: sinon.stub().callsFake((message: string, tools: ToolDefinition[], history?: Input[]) => {
                return Promise.resolve('test prompt');
            })
        } as unknown as sinon.SinonStubbedInstance<ReActPromptGenerator>;

        // Replace container's tool manager with mock
        sinon.stub(container, 'getToolManager').returns(mockToolManager);

        agent = new ReActAgent(container, mockLLMProvider, mockPromptGenerator);
    });

    afterEach(() => {
        sinon.restore();
    });

    it('should have unique id and name', () => {
        expect(agent.id).to.be.a('string');
        expect(agent.name).to.include('ReAct Agent');
        expect(agent.id).to.have.length.greaterThan(8);
    });

    it('should process message and return valid response', async () => {
        mockLLMProvider.generateResponse.resolves({
            content: `
thought:
  reasoning: "Test reasoning"
  plan: "Test plan"
`,
            tokenCount: 0,
            toolResults: []
        });

        const response = await agent.processMessage('test message');
        
        expect(response).to.have.property('content');
        expect(response).to.have.property('toolResults');
        expect(response).to.have.property('tokenCount');
        
        // Verify YAML structure
        const parsed = yaml.load(response.content) as { thought: { reasoning: string; plan: string } };
        expect(parsed).to.have.property('thought');
        expect(parsed.thought).to.have.property('reasoning');
        expect(parsed.thought).to.have.property('plan');

        // Verify LLM provider was called with correct prompt
        expect(mockPromptGenerator.generatePrompt.calledOnce).to.be.true;
        expect(mockLLMProvider.generateResponse.calledOnce).to.be.true;
    });

    it('should execute tool through tool manager', async () => {
        const toolDef: ToolDefinition = {
            name: 'test_tool',
            description: 'Test tool',
            inputSchema: {
                type: 'object',
                required: ['param1'],
                properties: {
                    param1: { type: 'string' }
                }
            }
        };
        const args = { param1: 'test value' };

        const result = await agent.executeTool(toolDef, args);
        
        expect(mockToolManager.executeTool.calledWith('test_tool', args)).to.be.true;
        expect(result).to.have.property('success', true);
        expect(result).to.have.property('data', 'test result');
    });

    it('should handle tool execution errors gracefully', async () => {
        mockToolManager.executeTool.rejects(new Error('Tool failed'));
        
        // Mock LLM provider response
        mockLLMProvider.generateResponse.resolves({
            content: `
thought:
  reasoning: "Attempting to execute tool"
  plan: "Execute test tool"

action:
  tool: "test_tool"
  purpose: "Testing error handling"
  params:
    param1: "test"

error_handling:
  error: "Tool execution failed: Tool failed"
  recovery:
    log_error: "Error during tool execution"
    alternate_plan: "Provide direct response without tools"
`,
            tokenCount: 0,
            toolResults: []
        });
        
        const response = await agent.processMessage('use failing tool');
        
        const parsed = yaml.load(response.content) as { error_handling: { error: string; recovery: { log_error: string; alternate_plan: string } } };
        expect(parsed).to.have.property('error_handling');
        expect(parsed.error_handling).to.have.property('error');
        expect(parsed.error_handling.error).to.equal('Tool execution failed: Tool failed');
        expect(parsed.error_handling.recovery).to.deep.equal({
            log_error: 'Error during tool execution',
            alternate_plan: 'Provide direct response without tools'
        });
        expect(response.toolResults).to.be.empty;
    });

    it('should maintain conversation history', async () => {
        const history: Input[] = [
            { role: 'user', content: 'previous message' },
            { role: 'assistant', content: 'previous response' }
        ];

        // Mock LLM provider response
        mockLLMProvider.generateResponse.resolves({
            content: `
thought:
  reasoning: "Based on previous conversation: Analyzing user request"
  plan: "Consider previous context and respond"

action:
  tool: "test_tool"
  purpose: "Testing conversation history"
  params:
    param1: "test"
`,
            tokenCount: 0,
            toolResults: []
        });

        const response = await agent.processMessage('test message', history);
        
        const parsed = yaml.load(response.content) as { thought: { reasoning: string } };
        expect(parsed.thought.reasoning).to.include('Based on previous conversation');

        // Verify prompt generator was called with history in both reason and think
        expect(mockPromptGenerator.generatePrompt.callCount).to.equal(2);
        
        // Check first call (reason)
        const reasonCall = mockPromptGenerator.generatePrompt.firstCall;
        expect(reasonCall.args[0]).to.equal('test message');
        expect(reasonCall.args[2]).to.deep.equal(history);
        
        // Check second call (think)
        const thinkCall = mockPromptGenerator.generatePrompt.secondCall;
        expect(thinkCall.args[2]).to.deep.equal(history);
    });

    it('should handle empty tool list', async () => {
        mockToolManager.getAvailableTools.resolves([]);
        
        // Mock LLM provider response
        mockLLMProvider.generateResponse.resolves({
            content: `
thought:
  reasoning: "No tools are available for this request - proceeding with direct response"
  plan: "Providing response without tool assistance"
`,
            tokenCount: 0,
            toolResults: []
        });
        
        const response = await agent.processMessage('test message');
        
        const parsed = yaml.load(response.content) as { thought: { reasoning: string; plan: string } };
        expect(parsed.thought).to.have.property('reasoning');
        expect(parsed.thought.reasoning).to.equal('No tools are available for this request - proceeding with direct response');
        expect(parsed.thought.plan).to.equal('Providing response without tool assistance');
    });

    it('should cleanup resources properly', async () => {
        await agent.cleanup();
        expect(mockLLMProvider.cleanup.calledOnce).to.be.true;
    });

    it('should handle complex multi-step tool execution', async () => {
        // First response indicates need for tool execution
        mockLLMProvider.generateResponse.onFirstCall().resolves({
            content: `
thought:
  reasoning: "Need to execute first tool"
  plan: "Execute test tool and analyze results"

action:
  tool: "test_tool"
  purpose: "First step of process"
  params:
    param1: "first step"

observation:
  result: "first step complete"

next_step:
  plan: "Process results and execute second step"`,
            tokenCount: 0,
            toolResults: []
        });

        // Second response processes results and executes another tool
        mockLLMProvider.generateResponse.onSecondCall().resolves({
            content: `
thought:
  reasoning: "Processing first step results"
  plan: "Execute second tool based on first results"

action:
  tool: "test_tool"
  purpose: "Second step of process"
  params:
    param1: "second step"

observation:
  result: "process complete"

next_step:
  plan: "Summarize results"`,
            tokenCount: 0,
            toolResults: []
        });

        const response = await agent.processMessage('perform multi-step task');
        
        // Verify tool was called twice
        expect(mockToolManager.executeTool.calledTwice).to.be.true;
        
        // Verify correct parameters were passed
        expect(mockToolManager.executeTool.firstCall.args[1]).to.deep.equal({ param1: "first step" });
        expect(mockToolManager.executeTool.secondCall.args[1]).to.deep.equal({ param1: "second step" });
        
        // Verify final response includes both steps
        const parsed = yaml.load(response.content) as any;
        expect(parsed.observation.result).to.equal('process complete');
        expect(parsed.next_step.plan).to.equal('Summarize results');
    });

    it('should handle invalid YAML responses from LLM', async () => {
        mockLLMProvider.generateResponse.resolves({
            content: 'invalid yaml content: {',
            tokenCount: 0,
            toolResults: []
        });

        const response = await agent.processMessage('test message');
        
        // Should return a properly formatted error response
        const parsed = yaml.load(response.content) as any;
        expect(parsed).to.have.property('error_handling');
        expect(parsed.error_handling.error).to.include('Error processing the response');
        expect(parsed.error_handling.recovery.alternate_plan).to.equal('Provide direct response without tools');
    });

    it('should handle missing required tool parameters', async () => {
        mockLLMProvider.generateResponse.resolves({
            content: `
thought:
  reasoning: "Need to execute tool"
  plan: "Execute test tool"

action:
  tool: "test_tool"
  purpose: "Testing invalid params"
  params:
    invalid_param: "test"`,
            tokenCount: 0,
            toolResults: []
        });

        const response = await agent.processMessage('test message');
        
        // Should include error handling for invalid parameters
        const parsed = yaml.load(response.content) as any;
        expect(parsed).to.have.property('error_handling');
        expect(parsed.error_handling.error).to.include('Tool execution failed');
        expect(parsed.error_handling.recovery.alternate_plan).to.include('Provide direct response');
    });

    it('should handle long conversation histories efficiently', async () => {
        const longHistory: Input[] = Array(20).fill(null).map((_, i) => ({
            role: i % 2 === 0 ? 'user' as MessageRole : 'assistant' as MessageRole,
            content: `message ${i}`,
            name: undefined,
            tool_call_id: undefined
        }));

        await agent.processMessage('test with long history', longHistory);
        
        // Verify prompt generator was called with full history
        expect(mockPromptGenerator.generatePrompt.firstCall.args[2]).to.deep.equal(longHistory);
        
        // Verify LLM provider was called with correct history
        expect(mockLLMProvider.generateResponse.firstCall.args[1]).to.deep.equal(longHistory);
    });

    it('should handle concurrent tool executions correctly', async () => {
        // Setup multiple tool definitions
        const tools: ToolDefinition[] = [
            {
                name: 'tool1',
                description: 'First test tool',
                inputSchema: {
                    type: 'object',
                    required: ['param1'],
                    properties: { param1: { type: 'string' } }
                }
            },
            {
                name: 'tool2',
                description: 'Second test tool',
                inputSchema: {
                    type: 'object',
                    required: ['param1'],
                    properties: { param1: { type: 'string' } }
                }
            }
        ];

        mockToolManager.getAvailableTools.resolves(tools);
        
        // Simulate concurrent tool executions
        const executions = [
            agent.executeTool(tools[0], { param1: 'test1' }),
            agent.executeTool(tools[1], { param1: 'test2' })
        ];

        const results = await Promise.all(executions);
        
        // Verify both tools were executed
        expect(mockToolManager.executeTool.calledTwice).to.be.true;
        expect(results).to.have.length(2);
        results.forEach(result => {
            expect(result).to.have.property('success', true);
            expect(result).to.have.property('data', 'test result');
        });
    });

    it('should handle Discord message formatting and mentions', async () => {
        mockLLMProvider.generateResponse.resolves({
            content: `
thought:
  reasoning: "Processing Discord message with mentions and formatting"
  plan: "Parse message and respond appropriately"

action:
  tool: "test_tool"
  purpose: "Handle Discord formatting"
  params:
    param1: "test with <@123456789> mention"`,
            tokenCount: 0,
            toolResults: []
        });

        const response = await agent.processMessage('<@123456789> Hello, can you **help** me?');
        
        // Verify Discord formatting is preserved
        const parsed = yaml.load(response.content) as any;
        expect(parsed.action.params.param1).to.include('<@123456789>');
    });

    it('should handle rate limiting and chunked responses', async () => {
        // Create a long response that might need chunking in Discord
        const longResponse = `
thought:
  reasoning: "Generating a detailed response that exceeds Discord's message limit"
  plan: "Break down response into manageable chunks"

analysis:
  ${Array(10).fill('This is a long detailed analysis that needs to be properly formatted for Discord.').join('\n  ')}

action:
  tool: "test_tool"
  purpose: "Test chunked response"
  params:
    param1: "test chunking"`;

        mockLLMProvider.generateResponse.resolves({
            content: longResponse,
            tokenCount: 0,
            toolResults: []
        });

        const response = await agent.processMessage('give me a detailed analysis');
        
        // Verify response handling
        const parsed = yaml.load(response.content) as any;
        expect(parsed).to.have.property('thought');
        expect(parsed).to.have.property('analysis');
        expect(parsed).to.have.property('action');
    });

    it('should maintain context across multiple Discord messages', async () => {
        const discordHistory: Input[] = [
            {
                role: 'user',
                content: 'Can you help me with a task?',
                name: 'TestUser#1234',
                tool_call_id: undefined
            },
            {
                role: 'assistant',
                content: 'Of course! What do you need help with?',
                name: undefined,
                tool_call_id: undefined
            },
            {
                role: 'user',
                content: 'I need to analyze some data',
                name: 'TestUser#1234',
                tool_call_id: undefined
            }
        ];

        mockLLMProvider.generateResponse.resolves({
            content: `
thought:
  reasoning: "Analyzing conversation context from Discord"
  plan: "Use previous messages to provide contextual response"

context_analysis:
  user: "TestUser#1234"
  conversation_flow:
    - "Initial help request"
    - "Confirmation response"
    - "Specific task request"

action:
  tool: "test_tool"
  purpose: "Process with context"
  params:
    param1: "analyze data with context"`,
            tokenCount: 0,
            toolResults: []
        });

        const response = await agent.processMessage('please proceed with the analysis', discordHistory);
        
        // Verify context handling
        const parsed = yaml.load(response.content) as any;
        expect(parsed.thought.reasoning).to.include('Analyzing conversation context');
        expect(parsed.context_analysis.user).to.equal('TestUser#1234');
    });

    it('should handle Discord-specific error recovery', async () => {
        // Simulate Discord API error during tool execution
        mockToolManager.executeTool.rejects(new Error('Discord API rate limit exceeded'));
        
        const response = await agent.processMessage('execute task with potential Discord limitations');
        
        // Verify error handling specific to Discord
        const parsed = yaml.load(response.content) as any;
        expect(parsed).to.have.property('error_handling');
        expect(parsed.error_handling.error).to.include('Discord API rate limit exceeded');
        expect(parsed.error_handling.recovery).to.have.property('alternate_plan');
    });
}); 