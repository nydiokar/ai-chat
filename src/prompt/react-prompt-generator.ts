import { PromptGenerator } from '../interfaces/prompt-generator.js';
import { ToolDefinition } from '../tools/mcp/types/tools.js';
import { Input } from '../types/common.js';
import { IToolManager } from '../tools/mcp/interfaces/core.js';
import { getLogger } from '../utils/shared-logger.js';
import type { Logger } from 'winston';
import { ReasoningStep } from '../interfaces/react-types.js';
import { PromptRepository } from '../services/prompt/prompt-repository.js';
import { BasePrompt, PromptContext, PromptType, ReasoningPrompt, ToolUsagePrompt } from '../types/prompts.js';
import { ToolFormatter } from '../tools/tool-formatter.js';

/**
 * Generator for creating prompts that guide the LLM to use ReAct-style reasoning
 * Support both direct and reasoning-based prompts
 */
export class ReActPromptGenerator implements PromptGenerator {
    private readonly logger: Logger;
    private readonly toolFormatter: ToolFormatter;
    private readonly defaultIdentity = `You are an intelligent AI assistant with access to external tools to help users. Always respond directly unless a tool would clearly help solve the user's request.

When using tools:
1. Always use tools when they would help complete the user's request
2. You can use multiple tools in sequence if needed
3. Always respond to the user with the results of the tool after using it
4. If a tool fails, try an alternative approach or explain the issue to the user`;

    constructor(
        private readonly toolManager: IToolManager,
        private readonly promptRepository?: PromptRepository
    ) {
        this.logger = getLogger('ReActPromptGenerator');
        this.toolFormatter = new ToolFormatter(2000); // Initialize ToolFormatter
        
        // Register prompts if repository is provided
        if (this.promptRepository) {
            this.registerReActPrompts();
        }
    }
    
    /**
     * Register ReAct-specific prompts in the prompt repository
     */
    private registerReActPrompts(): void {
        try {
            // Register main ReAct reasoning prompt
            this.promptRepository!.addPrompt({
                type: PromptType.REASONING,
                content: `You are an intelligent assistant that uses systematic reasoning and tools when necessary.

When solving a problem:
1. THINK about what needs to be done
2. Use TOOLS when they would help answer the question
3. Always read tool descriptions carefully and use EXACT parameter names
4. Provide a clear final answer once you have enough information

Format your response as:
\`\`\`yaml
thought:
  reasoning: "Brief analysis of what you need to do next"
  plan: "Step-by-step approach to solve this part"
  
action:
  tool: "tool_name"
  purpose: "Why you're using this tool"
  params:
    param1: "value1"
    param2: "value2"
    
# OR if you've completed the task
conclusion:
  final_answer: "Your complete, comprehensive answer to the request. Include multiple paragraphs with specific facts, examples, and detailed information from your tool results."
  explanation: "Brief summary of how you arrived at this answer"
\`\`\``,
                priority: 10,
                complexity: 'advanced',
                approaches: [
                    'Structured reasoning',
                    'Tool selection',
                    'Solution synthesis'
                ],
                shouldApply: (context: PromptContext) => 
                    context.requestType === 'react' && !context.afterToolExecution
            } as ReasoningPrompt);
            
            // Register follow-up prompt for after tool execution
            this.promptRepository!.addPrompt({
                type: PromptType.TOOL_USAGE,
                content: `Analyze the tool results and decide on next steps.

Based on the tool results you received:
1. Determine if the information answers the user's question
2. Decide if you need additional information from another tool
3. If you have sufficient information, provide a comprehensive final answer

Format your response as:
\`\`\`yaml
thought:
  reasoning: "Analysis of the tool results and what to do next"
  plan: "How to proceed based on the results"
  
action:
  tool: "tool_name"
  purpose: "Why you need additional information"
  params:
    param1: "value1"
    param2: "value2"
    
# OR if you've completed the task
conclusion:
  final_answer: "Your complete, detailed answer to the request, incorporating the tool results"
  explanation: "Brief summary of how the tool results led to this answer"
\`\`\``,
                priority: 10,
                tools: ['*'],
                usagePatterns: {
                    bestPractices: [
                        'Analyze tool results thoroughly',
                        'Connect tool results to the original question',
                        'Decide when you have sufficient information'
                    ],
                    commonErrors: [
                        'Ignoring tool results',
                        'Repeatedly using the same tool with same parameters',
                        'Not providing a final answer when sufficient information is available'
                    ]
                },
                shouldApply: (context: PromptContext) => 
                    context.requestType === 'react' && 
                    context.afterToolExecution === true
            } as ToolUsagePrompt);
            
            this.logger.info('Registered ReAct-specific prompts in repository');
        } catch (error) {
            this.logger.error('Failed to register ReAct prompts', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Generate a simple prompt with current time context and available tools
     */
    async generateSimplePrompt(): Promise<string> {
        // Get current date and time information
        const now = new Date();
        const currentDate = now.toDateString();
        const currentTime = now.toTimeString().split(' ')[0];
        const currentYear = now.getFullYear();
        const currentMonth = now.toLocaleString('default', { month: 'long' });
        const currentDay = now.getDate();

        const promptParts = [
            this.defaultIdentity,
            `Current date: ${currentDate}`,
            `Current time: ${currentTime}`,
            `Current year: ${currentYear}`,
            `Current month: ${currentMonth}`,
            `Current day: ${currentDay}`
        ];

        return promptParts.join('\n\n');
    }

    /**
     * Standard prompt generation method required by PromptGenerator interface
     */
    async generatePrompt(input: string, tools: ToolDefinition[], history?: Input[]): Promise<string> {
        // Get current date and time information
        const now = new Date();
        const currentDate = now.toDateString();
        const currentTime = now.toTimeString().split(' ')[0];
        const currentYear = now.getFullYear();
        const currentMonth = now.toLocaleString('default', { month: 'long' });
        const currentDay = now.getDate();

        const promptParts = [
            this.defaultIdentity,
            
            // Add current date/time information
            `Current date: ${currentDate}`,
            `Current time: ${currentTime}`,
            `Current year: ${currentYear}`,
            `Current month: ${currentMonth}`,
            `Current day: ${currentDay}`
        ];

        if (tools.length > 0) {
            const toolsList = tools.map(tool => `${tool.name}: ${tool.description}`).join('\n');
            promptParts.push(`Available tools:\n${toolsList}`);
        }

        if (history && history.length > 0) {
            const historyText = history.map(h => `${h.role}: ${h.content}`).join('\n');
            promptParts.push(`Conversation history:\n${historyText}`);
        }

        promptParts.push(`User query: ${input}`);

        return promptParts.join('\n\n');
    }

    /**
     * Get relevant tools based on the message content
     */
    public async getTools(message: string): Promise<ToolDefinition[]> {
        // Skip expensive operations for empty or basic messages
        if (!message.trim() || this.isBasicGreeting(message)) {
            return [];
        }
        
        // Get all available tools
        const allTools = await this.toolManager.getAvailableTools();
        
        // Check if message contains search-related terms
        const isSearchQuery = /search|find|look up|news|information|web/i.test(message);
        
        // For search queries, prioritize search tools
        if (isSearchQuery) {
            return this.prioritizeSearchTools(allTools);
        }
        
        // For non-search queries, return all tools
        return allTools;
    }

    /**
     * Prioritize search-related tools in the list
     */
    private prioritizeSearchTools(tools: ToolDefinition[]): ToolDefinition[] {
        // Separate search tools from other tools
        const searchTools: ToolDefinition[] = [];
        const otherTools: ToolDefinition[] = [];
        
        tools.forEach(tool => {
            // Prioritize search and research tools
            if (tool.name.includes('search') || 
                tool.name.includes('research') ||
                tool.name.includes('find') ||
                tool.description.toLowerCase().includes('search')) {
                searchTools.push(tool);
            } else {
                otherTools.push(tool);
            }
        });
        
        // Return search tools first, then other tools
        return [...searchTools, ...otherTools];
    }

    /**
     * Simple helper to detect basic greetings that don't need tools
     */
    private isBasicGreeting(message: string): boolean {
        const lowerMessage = message.trim().toLowerCase();
        return /^(hi|hello|hey|thanks|thank you)$/i.test(lowerMessage);
    }

    /**
     * Generates a ReAct-specific prompt that encourages structured reasoning and action
     * Used by the ReActEngine for step-by-step reasoning
     */
    async generateReActPrompt(
        input: string,
        steps: ReasoningStep[] = [],
        tools: ToolDefinition[] = [],
        currentStep: number = 0
    ): Promise<string> {
        try {
            // Get current date and time information
            const now = new Date();
            const currentDate = now.toDateString();
            const currentTime = now.toTimeString().split(' ')[0];

            // Build the prompt with components
            const promptParts: string[] = [];
            
            // Add prompt ingredients from the repository if available
            if (this.promptRepository) {
                const context: PromptContext = {
                    requestType: 'react',
                    tools: tools.map(t => t.name),
                    complexity: steps.length > 3 ? 'high' : 'medium',
                    afterToolExecution: steps.some(s => s.observation !== undefined)
                };
                
                const applicablePrompts = this.promptRepository.getApplicablePrompts(context);
                
                // Add behavioral prompt first (if any)
                const behavioralPrompt = applicablePrompts.find(p => p.type === PromptType.BEHAVIORAL);
                if (behavioralPrompt) {
                    promptParts.push(behavioralPrompt.content);
                }
                
                // Then add reasoning prompt (if any)
                const reasoningPrompt = applicablePrompts.find(p => p.type === PromptType.REASONING);
                if (reasoningPrompt) {
                    promptParts.push(reasoningPrompt.content);
                }
                
                // Then add tool usage prompt (if any)
                const toolUsagePrompt = applicablePrompts.find(p => p.type === PromptType.TOOL_USAGE);
                if (toolUsagePrompt) {
                    promptParts.push(toolUsagePrompt.content);
                }
            } else {
                // Fallback to default identity if no repository
                promptParts.push(this.defaultIdentity);
            }
            
            // Add current date/time context
            promptParts.push(`Current date: ${currentDate}\nCurrent time: ${currentTime}`);
            
            // Add user input with clear formatting
            promptParts.push(`User request: ${input}`);
            
            // Add formatted tools using the ToolFormatter for better descriptions
            if (tools && tools.length > 0) {
                promptParts.push(this.formatTools(tools));
            } else {
                promptParts.push('No tools are available.');
            }
            
            // Add reasoning steps with proper formatting
            if (steps && steps.length > 0) {
                promptParts.push(this.formatReasoningSteps(steps));
            }
            
            // Add guidance for the next step based on the current step
            promptParts.push(this.generateStepGuidance(currentStep, steps));
            
            return promptParts.join('\n\n');
        } catch (error) {
            this.logger.error('Error generating ReAct prompt', {
                error: error instanceof Error ? error.message : String(error),
                stepsCount: steps.length,
                toolsCount: tools.length
            });
            
            // Provide a simple fallback prompt
            return `You are a helpful AI assistant. The user has requested: "${input}".
            
Please provide a step-by-step approach to solve this problem, using tools when necessary.

${this.formatTools(tools)}`;
        }
    }

    /**
     * Generate a follow-up prompt after tool execution
     */
    async generateFollowUpPrompt(
        originalMessage: string,
        steps: ReasoningStep[],
        toolResult: any
    ): Promise<string> {
        // Get the last observation step
        const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
        const toolResultText = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2);
        
        // Build using prompt repository if available
        let basePromptContent = '';
        
        if (this.promptRepository) {
            // Create context specifically for follow-up
            const context: PromptContext = {
                requestType: 'react',
                afterToolExecution: true,
                complexity: steps.length > 3 ? 'high' : 'medium',
                tools: steps
                    .filter(s => s.action?.tool)
                    .map(s => s.action!.tool)
            };
            
            // Get applicable prompts from repository
            const prompts = this.promptRepository.getApplicablePrompts(context);
            
            if (prompts.length > 0) {
                // Use the highest priority prompt as the base
                basePromptContent = prompts[0].content;
            }
        }
        
        // If no prompts from repository or repository not available, use default
        if (!basePromptContent) {
            basePromptContent = `Now you have tool results to help answer the user's question. 

Analyze these results carefully and decide what to do next:
1. If the results provide enough information, give a final answer
2. If more information is needed, decide which tool to use next
3. If the results aren't helpful, try a different approach

Remember:
- Synthesize information from multiple sources
- Connect the tool results directly to the user's question
- Be specific and detailed in your final answer`;
        }
        
        // Construct the follow-up prompt
        const promptParts = [
            basePromptContent,
            `Original query: ${originalMessage}`,
            `Latest tool result:\n${toolResultText}`,
        ];
        
        // Add previous steps for context
        if (steps.length > 1) {
            const previousSteps = steps.slice(0, -1).map((step, idx) => {
                let renderedStep = `Step ${idx + 1}:\n`;
                
                if (step.thought) {
                    renderedStep += `THOUGHT: ${step.thought.reasoning.substring(0, 100)}...\n`;
                }
                
                if (step.action) {
                    renderedStep += `ACTION: Using tool ${step.action.tool}\n`;
                }
                
                if (step.observation) {
                    // Truncate observation for brevity
                    const obs = step.observation.result;
                    renderedStep += `OBSERVATION: ${obs.substring(0, 100)}${obs.length > 100 ? '...' : ''}\n`;
                }
                
                return renderedStep;
            }).join('\n');
            
            promptParts.push(`Previous steps summary:\n${previousSteps}`);
        }
        
        return promptParts.join('\n\n');
    }

    /**
     * Helper method to format tools as a readable list
     */
    private formatTools(tools: ToolDefinition[]): string {
        return this.toolFormatter.formatToolDescriptions(tools);
    }

    /**
     * Estimates the token count for a reasoning step
     * Simple implementation - to be replaced with proper integration later
     * @param step The reasoning step to estimate tokens for
     * @returns Approximate token count
     */
    public estimateStepTokens(step: ReasoningStep): number {
        // Simple token estimation based on content length
        // In a production implementation, this would use a proper tokenizer service
        const contentLength = this.getStepContentLength(step);
        return Math.ceil(contentLength / 4); // Approximate 4 chars per token
    }

    /**
     * Helper method to get total content length of a step
     * @param step The reasoning step to measure
     * @returns Total character count of the step content
     */
    private getStepContentLength(step: ReasoningStep): number {
        let length = 0;
        
        // Add thought content length
        if (step.thought) {
            length += (step.thought.reasoning || '').length;
            length += (step.thought.plan || '').length;
        }
        
        // Add action content length
        if (step.action) {
            length += (step.action.tool || '').length;
            length += (step.action.purpose || '').length;
            length += JSON.stringify(step.action.params || {}).length;
        }
        
        // Add observation content length
        if (step.observation) {
            length += (step.observation.result || '').length;
        }
        
        // Add conclusion content length
        if (step.conclusion) {
            length += (step.conclusion.final_answer || '').length;
            length += (step.conclusion.explanation || '').length;
        }
        
        return length;
    }
    
    /**
     * Estimates the total token count for a prompt with the given reasoning steps
     * Simple implementation - to be enhanced in the future
     * @param input The user input
     * @param steps The reasoning steps to include
     * @param tools The available tools
     * @returns Approximate token count for the full prompt
     */
    public estimatePromptTokens(input: string, steps: ReasoningStep[], tools: ToolDefinition[]): number {
        // Base prompt tokens (approx 800 for the template)
        let totalTokens = 500; // Reduced since we simplified the prompt
        
        // Add tool description tokens
        const toolsText = tools.map(t => `${t.name}: ${t.description}`).join('\n');
        totalTokens += Math.ceil(toolsText.length / 4);
        
        // Add user input tokens
        totalTokens += Math.ceil(input.length / 4);
        
        // Add tokens for each reasoning step
        steps.forEach(step => {
            totalTokens += this.estimateStepTokens(step);
        });
        
        return totalTokens;
    }
    
    /**
     * Optimizes a list of reasoning steps to fit within a token limit
     * Basic implementation - to be enhanced with ContextScoringService in the future
     * @param steps The full list of reasoning steps
     * @param maxTokens The maximum tokens to allow (approximate)
     * @returns A reduced list of steps that fits within the token limit
     */
    public optimizeSteps(steps: ReasoningStep[], maxTokens: number = 4000): ReasoningStep[] {
        if (steps.length <= 3) return steps; // No optimization needed for short chains
        
        // Calculate current token usage
        const currentTokens = steps.reduce((sum, step) => sum + this.estimateStepTokens(step), 0);
        
        // If current usage is under the limit, no optimization needed
        if (currentTokens <= maxTokens * 0.8) {
            return steps;
        }
        
        // Always keep first step (user input/context) and last 2 steps (recent context)
        const firstStep = steps[0];
        const lastSteps = steps.slice(-2);
        
        // Simple optimization: keep first step, last steps, and a few in the middle
        // In the future, this will use context scoring for more intelligent selection
        const middleCount = Math.max(1, Math.floor((maxTokens - this.estimateStepTokens(firstStep) - 
                           lastSteps.reduce((sum, step) => sum + this.estimateStepTokens(step), 0)) / 
                           (steps.reduce((sum, step) => sum + this.estimateStepTokens(step), 0) / steps.length)));
        
        // Take evenly spaced steps from the middle
        const middleSteps: ReasoningStep[] = [];
        const middleSection = steps.slice(1, -2);
        
        if (middleSection.length > 0) {
            const stride = Math.max(1, Math.floor(middleSection.length / middleCount));
            for (let i = 0; i < middleSection.length; i += stride) {
                if (middleSteps.length < middleCount) {
                    middleSteps.push(middleSection[i]);
                }
            }
        }
        
        // Return optimized steps in the correct order
        return [firstStep, ...middleSteps, ...lastSteps];
    }

    /**
     * Format reasoning steps for inclusion in prompts
     * @param steps Array of reasoning steps
     * @returns Formatted reasoning steps section for prompt
     */
    private formatReasoningSteps(steps: ReasoningStep[]): string {
        if (!steps || steps.length === 0) {
            return 'No previous reasoning steps.';
        }
        
        const stepsRendered = steps.map((step, idx) => {
            let renderedStep = `Step ${idx + 1}:\n`;
            
            if (step.thought) {
                renderedStep += `THOUGHT: ${step.thought.reasoning}\n`;
                if (step.thought.plan) {
                    renderedStep += `PLAN: ${step.thought.plan}\n`;
                }
            }
            
            if (step.action) {
                renderedStep += `ACTION: Using tool ${step.action.tool}\n`;
                renderedStep += `Parameters: ${JSON.stringify(step.action.params, null, 2)}\n`;
            }
            
            if (step.observation) {
                renderedStep += `OBSERVATION: ${step.observation.result}\n`;
            }
            
            if (step.conclusion) {
                renderedStep += `CONCLUSION: ${step.conclusion.final_answer}\n`;
            }
            
            return renderedStep;
        }).join('\n');
        
        return `Previous reasoning steps:\n${stepsRendered}`;
    }
    
    /**
     * Generate guidance for the next reasoning step
     * @param currentStep Current step number
     * @param steps Previous reasoning steps
     * @returns Guidance for the next step
     */
    private generateStepGuidance(currentStep: number, steps: ReasoningStep[]): string {
        const hasObservation = steps.some(s => s.observation);
        const alreadyTried = steps
            .filter(s => s.action?.tool)
            .map(s => s.action!.tool);
        
        if (currentStep === 0) {
            return 'Please start by thinking about the problem and deciding on your first step.';
        } else if (hasObservation && currentStep >= 3) {
            return `You have been reasoning for ${currentStep} steps. Consider whether you have enough information to provide a final answer now. If you need more information, choose the most appropriate tool that you haven't tried yet.`;
        } else if (hasObservation) {
            return 'Based on the observation above, what is your next step? If you have enough information, provide a final answer.';
        } else if (alreadyTried.length > 0) {
            const triedTools = alreadyTried.join(', ');
            return `You have tried these tools: ${triedTools}. What tool would be most helpful to try next?`;
        } else {
            return 'What is your next step in solving this problem?';
        }
    }
} 