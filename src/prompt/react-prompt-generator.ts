import { PromptGenerator } from '../interfaces/prompt-generator.js';
import { ToolDefinition } from '../tools/mcp/types/tools.js';
import { Input } from '../types/common.js';

export class ReActPromptGenerator implements PromptGenerator {
    private isBasicGreeting(input: string): boolean {
        // Detect simple greetings and conversation starters
        const simplePatterns = [
            /^hi+\s*$/i,
            /^hello+\s*$/i,
            /^hey+\s*$/i,
            /^greetings/i,
            /^how are you/i,
            /^what's up/i,
            /^good (morning|afternoon|evening)/i,
            /^thanks/i,
            /^thank you/i
        ];
        
        return simplePatterns.some(pattern => pattern.test(input.trim()));
    }

    private formatTools(tools: ToolDefinition[]): string {
        return tools.map(tool => 
            `${tool.name}: ${tool.description}`
        ).join('\n');
    }

    async generatePrompt(input: string, tools: ToolDefinition[], history?: Input[]): Promise<string> {
        // Get current date and time information
        const now = new Date();
        const currentDate = now.toDateString();
        const currentTime = now.toTimeString().split(' ')[0];
        
        // For basic greetings, don't use tools
        if (this.isBasicGreeting(input)) {
            return `You are an intelligent AI assistant having a conversation.
Respond naturally to the user's greeting or simple question.

Current date: ${currentDate}
Current time: ${currentTime}

Query: ${input}`;
        }
        
        // For all other queries, use the standard prompt with tools
        const toolList = this.formatTools(tools);
        
        return `You are an intelligent AI assistant with access to external tools to help users. Always respond directly unless a tool would clearly help solve the user's request.

When using tools:
1. Always use tools when they would help complete the user's request
2. You can use multiple tools in sequence if needed
3. Always respond to the user with the results of the tool after using it
4. If a tool fails, try an alternative approach or explain the issue to the user

Current date: ${currentDate}
Current time: ${currentTime}

Available tools:
${toolList}

Query: ${input}`;
    }
} 