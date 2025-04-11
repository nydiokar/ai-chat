import { PromptGenerator } from '../interfaces/prompt-generator.js';
import { ToolDefinition } from '../tools/mcp/types/tools.js';
import { Input } from '../types/common.js';
import { IToolManager } from '../tools/mcp/interfaces/core.js';
import { getLogger } from '../utils/shared-logger.js';
import type { Logger } from 'winston';

/**
 * Generator for creating prompts that guide the LLM to use ReAct-style reasoning
 * Simplified version that supports both direct and reasoning-based prompts
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
        
        if (tools.length === 0) {
            return basePrompt + `\n\nUser query: ${input}`;
        }
        
        let prompt = `${basePrompt}\n\nAvailable tools:\n${this.formatTools(tools)}\n\n`;
        
        if (history && history.length > 0) {
            prompt += `Conversation history:\n${history.map(h => `${h.role}: ${h.content}`).join('\n')}\n\n`;
        }
        
        prompt += `User query: ${input}`;
        
        return prompt;
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
     * @deprecated Use generatePrompt instead
     */
    async generateReActPrompt(): Promise<string> {
        const now = new Date();
        
        return `You are an intelligent AI assistant that follows a systematic Reasoning + Action approach.

When given a task, you will:
1. THINK: Analyze what needs to be done
2. PLAN: Decide specific steps and tools needed
3. ACT: Use tools to gather information or perform actions
4. OBSERVE: Process the results
5. REPEAT: Continue thinking and acting until the task is complete

Always use this YAML format:
thought:
  reasoning: "Your detailed analysis of the current situation"
  plan: "How you'll approach solving this step by step"
  
action:
  tool: "tool_name"
  purpose: "Why you're using this tool"
  params:
    param1: "value1"
    param2: "value2"
    
# OR if you've completed the task
conclusion:
  final_answer: "The complete solution to the original task"
  explanation: "Summary of what you did and how you arrived at this answer"

Current date: ${now.toDateString()}
Current time: ${now.toTimeString().split(' ')[0]}`;
    }

    /**
     * Generates a follow-up prompt after tool execution
     * @deprecated Use generatePrompt instead
     */
    async generateFollowUpPrompt(
        originalMessage: string,
        reasoning: string,
        toolCall: {name: string, parameters: any},
        toolResult: any
    ): Promise<string> {
        return `Original request: ${originalMessage}

You analyzed this request with the following reasoning:
${reasoning}

Then you used tool "${toolCall.name}" with parameters:
${JSON.stringify(toolCall.parameters, null, 2)}

The tool returned these results:
${JSON.stringify(toolResult, null, 2)}

Based on these results, please provide a helpful final response to the user.
Make your response direct and natural - do not mention the tool by name.`;
    }

    /**
     * Helper method to format tools as a readable list
     */
    private formatTools(tools: ToolDefinition[]): string {
        return tools.map(tool => 
            `${tool.name}: ${tool.description}`
        ).join('\n');
    }
} 