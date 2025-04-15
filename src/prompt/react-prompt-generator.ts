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
        const basePrompt = await this.generateSimplePrompt();
        const relevantTools = await this.getTools(input);
        
        if (relevantTools.length === 0) {
            return basePrompt + `\n\nUser query: ${input}`;
        }
        
        return `${basePrompt}

Available tools:
${this.formatTools(relevantTools)}

User query: ${input}`;
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
        const basePrompt = `You are an intelligent assistant that excels at multi-step reasoning using a systematic Reasoning + Action (ReAct) approach.

When given a task, you will follow this structured reasoning process:
1. THINK: Carefully analyze what needs to be done, breaking down complex tasks into manageable steps
2. PLAN: Identify the specific tools needed and the sequence of actions required
3. ACT: Execute the appropriate tool with precise parameters
4. OBSERVE: Analyze the results thoroughly
5. REPEAT: Continue this process, building on previous steps until you reach a complete solution

IMPORTANT GUIDELINES:
- Use the most relevant tool for each specific subtask
- Your reasoning must be clear and logical, showing your step-by-step thought process
- Only provide a final answer when you have sufficient information
- If a tool fails, try an alternative approach or use a different tool
- Specify exactly why you're using each tool and what information you hope to gain

Always use this YAML format for your response:
\`\`\`yaml
thought:
  reasoning: "Your detailed analysis of the current situation, explaining your understanding and what you need to determine next"
  plan: "Your specific step-by-step approach to solve this part of the task"
  
action:
  tool: "tool_name"
  purpose: "Specific reason why you're using this tool and what information you expect to get"
  params:
    param1: "value1"
    param2: "value2"
    
# OR if you've completed the task
conclusion:
  final_answer: "Your complete solution to the original request"
  explanation: "Summary of the steps you took, what you learned, and how you arrived at this answer"
\`\`\`

Current date: ${now.toDateString()}
Current time: ${now.toTimeString().split(' ')[0]}

Available tools:
${this.formatTools(tools)}

EXAMPLE OF SUCCESSFUL REASONING:

User request: "Create a summary of recent news about artificial intelligence."

\`\`\`yaml
thought:
  reasoning: "The user wants a summary of recent AI news. To provide up-to-date information, I should search for recent news articles about artificial intelligence. I need to use a search tool to find this information."
  plan: "1. Use web_search to find recent AI news articles. 2. Analyze the search results. 3. Create a comprehensive summary."
  
action:
  tool: "web_search"
  purpose: "To find recent news articles about artificial intelligence that I can summarize for the user"
  params:
    search_term: "latest artificial intelligence news past week"
\`\`\`

Observation: [Search results with several AI news articles...]

\`\`\`yaml
thought:
  reasoning: "The search results provide several recent news stories about AI. I see articles about AI regulation, new research breakthroughs, and industry applications. I now have enough information to create a comprehensive summary for the user."
  plan: "Organize the information into key categories: 1. Regulatory developments, 2. Research advancements, 3. Industry applications, 4. Present a concise summary."

conclusion:
  final_answer: "Here's a summary of recent AI news: 1) Regulatory Developments: The EU has advanced new AI regulations focusing on transparency and safety. 2) Research Breakthroughs: Scientists at MIT announced a new neural network architecture that reduces training time by 60%. 3) Industry Applications: Google has implemented new AI features in their search platform that improve answer quality by 40% according to internal metrics. Several healthcare companies have launched AI diagnostic tools with FDA approval. 4) Investment Trends: AI startups raised $14B in the last quarter, with healthcare and automation seeing the largest investments."
  explanation: "I gathered this information by searching for recent AI news and analyzing the most significant developments across regulations, research, practical applications, and investment trends."
\`\`\`

EXAMPLE OF MULTI-STEP REASONING:

User request: "Find me a good Italian restaurant in Boston and make a reservation for Friday night for 2 people."

\`\`\`yaml
thought:
  reasoning: "This task requires multiple steps. First, I need to find Italian restaurants in Boston. Then I need to evaluate which ones are highly rated. Finally, I need to make a reservation at one of them for Friday night for 2 people."
  plan: "1. Search for top-rated Italian restaurants in Boston. 2. Select one based on ratings and reviews. 3. Make a reservation at the chosen restaurant."
  
action:
  tool: "web_search"
  purpose: "To find top-rated Italian restaurants in Boston"
  params:
    search_term: "best Italian restaurants Boston ratings reviews"
\`\`\`

Observation: [Search results with several restaurant options and reviews...]

\`\`\`yaml
thought:
  reasoning: "Based on the search results, 'Giacomo's Ristorante' in the North End has excellent reviews (4.7/5 stars from over 1,200 reviews) and is known for authentic Italian cuisine. It appears to be a popular choice with moderate pricing. Now I need to check if I can make a reservation there."
  plan: "Use a restaurant reservation tool to book a table at Giacomo's Ristorante for Friday night for 2 people."
  
action:
  tool: "restaurant_reservation"
  purpose: "To book a table at Giacomo's Ristorante for Friday night for 2 people"
  params:
    restaurant_name: "Giacomo's Ristorante"
    location: "Boston North End"
    date: "Friday"
    time: "7:00 PM"
    party_size: 2
\`\`\`

Observation: "Reservation confirmed at Giacomo's Ristorante for Friday at 7:00 PM for 2 people. Confirmation #: RT78921."

\`\`\`yaml
conclusion:
  final_answer: "I've made a reservation for you at Giacomo's Ristorante in Boston's North End for Friday at 7:00 PM for 2 people. Your confirmation number is RT78921. Giacomo's is highly rated (4.7/5 stars) and known for authentic Italian cuisine with moderate pricing. They're famous for their homemade pasta dishes and seafood specialties."
  explanation: "I searched for the best Italian restaurants in Boston, selected Giacomo's based on its excellent reviews and popularity, and successfully made a reservation for Friday at 7:00 PM for 2 people."
\`\`\``;

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

${currentStep > 4 
    ? "Important: You've gone through multiple steps. Consider whether you now have enough information to provide a conclusion with a final_answer."
    : "Determine whether to use a tool to gather more information or provide a conclusion if you have enough information to answer the user's request."}`;

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

You have been working on this request using the following approach:
${steps.map(step => {
    if (step.thought) return `Thought: ${step.thought.reasoning.substring(0, 150)}...`;
    if (step.action) return `Action: Used tool "${step.action.tool}"`;
    if (step.observation) return `Observation: Observed results from tool execution`;
    return '';
}).join('\n')}

Your most recent action was to use tool "${lastAction?.tool}" with parameters:
${JSON.stringify(lastAction?.params || {}, null, 2)}

The tool returned these results:
${typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2)}

Based on these results, continue your reasoning process. You should:
1. Analyze the tool results thoroughly - what did you learn?
2. Determine if the information is sufficient or if you need more data
3. Decide on the next step - either use another tool or provide a final answer
4. If the tool failed or returned unexpected results, adjust your strategy

Remember to always maintain a coherent reasoning chain connected to the original request.

Always respond in the same YAML format as before:
\`\`\`yaml
thought:
  reasoning: "Your detailed analysis of the tool results and what they mean for the task"
  plan: "Your refined approach based on this new information"

action:
  tool: "next_tool_name"  # if you need more information
  purpose: "Specific reason why you're using this tool and what you expect to learn"
  params:
    param1: "value1"

# OR if you can now answer the original request
conclusion:
  final_answer: "Your complete answer to the user's request"
  explanation: "How you arrived at this answer using the tools and what key insights you gained"
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
        let totalTokens = 800;
        
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