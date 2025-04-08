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

    constructor() {
        this.logger = getLogger('ReActPromptGenerator');
    }

    /**
     * Standard prompt generation method required by PromptGenerator interface
     */
    async generatePrompt(input: string, tools: ToolDefinition[], history?: Input[]): Promise<string> {
        // Basic implementation that formats available tools
        const now = new Date();
        
        return `You are an intelligent AI assistant with access to external tools.

When using tools:
1. Always use tools when they would help complete the user's request
2. You can use multiple tools in sequence if needed
3. Always respond to the user with the results of the tool after using it
4. If a tool fails, try an alternative approach or explain the issue to the user

Current date: ${now.toDateString()}
Current time: ${now.toTimeString().split(' ')[0]}

Available tools:
${this.formatTools(tools)}

User query: ${input}`;
    }

    /**
     * Generates a ReAct-specific prompt that encourages structured reasoning and action
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
     * Generates a simple prompt for direct tool usage without extensive reasoning
     */
    async generateSimplePrompt(): Promise<string> {
        const now = new Date();
        
        return `You are an intelligent AI assistant with access to external tools to help users. 
Always respond directly unless a tool would clearly help solve the user's request.

When using tools:
1. Always use tools when they would help complete the user's request
2. You can use multiple tools in sequence if needed
3. Always respond to the user with the results of the tool after using it
4. If a tool fails, try an alternative approach or explain the issue to the user

Current date: ${now.toDateString()}
Current time: ${now.toTimeString().split(' ')[0]}
Current year: ${now.getFullYear()}
Current month: ${now.toLocaleString('default', { month: 'long' })}
Current day: ${now.getDate()}`;
    }

    /**
     * Generates a follow-up prompt after tool execution
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