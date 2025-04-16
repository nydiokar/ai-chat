import { PromptGenerator } from '../interfaces/prompt-generator.js';
import { ToolDefinition } from '../tools/mcp/types/tools.js';
import { Input } from '../types/common.js';
import { IToolManager } from '../tools/mcp/interfaces/core.js';
import { getLogger } from '../utils/shared-logger.js';
import type { Logger } from 'winston';
import { ReasoningStep } from '../interfaces/react-types.js';

/**
 * Generator for creating prompts that guide the LLM to use ReAct-style reasoning
 * Support both direct and reasoning-based prompts
 */
export class ReActPromptGenerator implements PromptGenerator {
    private readonly logger: Logger;
    private readonly defaultIdentity = `You are an intelligent AI assistant with access to external tools to help users. Always respond directly unless a tool would clearly help solve the user's request.

When using tools:
1. Always use tools when they would help complete the user's request
2. You can use multiple tools in sequence if needed
3. Always respond to the user with the results of the tool after using it
4. If a tool fails, try an alternative approach or explain the issue to the user`;

    constructor(
        private readonly toolManager: IToolManager
    ) {
        this.logger = getLogger('ReActPromptGenerator');
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
        // Get current date and time information
        const now = new Date();
        
        // Build the base ReAct prompt with improved instructions and examples
        const basePrompt = `You are an intelligent assistant that uses systematic reasoning and tools when necessary.

When solving a problem:
1. THINK about what needs to be done
2. Use TOOLS when they would help answer the question
3. Always read tool descriptions carefully and use EXACT parameter names
4. Provide a clear final answer once you have enough information

IMPORTANT:
- Be concise in your reasoning
- Use the exact parameter names from each tool's description
- If a tool fails, check if you used the correct parameters
- Don't get stuck in loops - try a different approach if something isn't working
- For simple greetings like "hi", "hello", etc. - DO NOT use tools, just respond directly
- When providing a final answer about complex topics, synthesize the information into a coherent response rather than just listing search results
- For informational queries, provide specific details from your search results, not general knowledge
- ALWAYS provide comprehensive, detailed final answers (at least 3-5 sentences) that include all relevant information you gathered
- Your final answer should fully address the user's query with specific facts and details from tool results

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
  final_answer: "Your complete, comprehensive answer to the request. Include multiple paragraphs with specific facts, examples, and detailed information from your tool results. Minimum 3-5 sentences."
  explanation: "Brief summary of how you arrived at this answer"
\`\`\`

Current date: ${now.toDateString()}
Current time: ${now.toTimeString().split(' ')[0]}

Available tools:
${this.formatTools(tools)}`;

        // Add reasoning history if we have previous steps
        let historyContent = '';
        if (steps.length > 0) {
            historyContent = '\n\nPrevious reasoning steps:\n';
            
            for (const step of steps) {
                if (step.thought) {
                    historyContent += `\nThought:\nReasoning: ${step.thought.reasoning}\nPlan: ${step.thought.plan}\n`;
                }
                
                if (step.action) {
                    historyContent += `\nAction: ${step.action.tool}\nPurpose: ${step.action.purpose || "Not specified"}\nParams: ${JSON.stringify(step.action.params, null, 2)}\n`;
                }
                
                if (step.observation) {
                    historyContent += `\nObservation: ${step.observation.result}\n`;
                }
                
                if (step.conclusion) {
                    historyContent += `\nConclusion: ${step.conclusion.final_answer}\nExplanation: ${step.conclusion.explanation || ""}\n`;
                }
            }
        }

        const nextStepPrompt = `
Your next step (step ${currentStep + 1}):

${currentStep > 3 
    ? "Consider whether you now have enough information to provide a final answer. If you do, ensure your conclusion synthesizes ALL the information into a comprehensive, detailed response with multiple paragraphs covering specific facts from your tool results."
    : "Decide if you need more information from a tool or can provide a final answer."}`;

        return `${basePrompt}${historyContent}\n\nUser request: ${input}${nextStepPrompt}`;
    }

    /**
     * Generates a follow-up prompt after tool execution
     * For use when continuation is needed after tools have been executed
     */
    async generateFollowUpPrompt(
        originalMessage: string,
        steps: ReasoningStep[],
        toolResult: any
    ): Promise<string> {
        // Get the most recent reasoning step
        const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
        const lastAction = lastStep?.action;
        
        // Build a prompt focusing on the tool result and next steps
        return `Original request: ${originalMessage}

You just used tool "${lastAction?.tool}" with parameters:
${JSON.stringify(lastAction?.params || {}, null, 2)}

The tool returned:
${typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2)}

Now:
1. Analyze what you learned from these results
2. Decide if you need more information or can provide a final answer
3. If the tool failed, check if you used the correct parameters

For complex topics, synthesize the information into a coherent response rather than just listing search results. Use specific details from your search results.

Continue using the same YAML format:
\`\`\`yaml
thought:
  reasoning: "Brief analysis of the results"
  plan: "Next steps based on what you learned"

action:
  tool: "next_tool_name"  # if you need more information
  purpose: "Why you need this additional information"
  params:
    param1: "value1"

# OR if you can now provide an answer
conclusion:
  final_answer: "Your complete, comprehensive answer to the request. Include multiple paragraphs with specific facts, examples, and detailed information from your tool results. Minimum 3-5 sentences."
  explanation: "Brief summary of how you arrived at this answer"
\`\`\``;
    }

    /**
     * Helper method to format tools as a readable list
     */
    private formatTools(tools: ToolDefinition[]): string {
        return tools.map(tool => 
            `${tool.name}: ${tool.description}`
        ).join('\n');
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
} 