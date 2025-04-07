import { PromptGenerator } from '../interfaces/prompt-generator.js';
import { ToolDefinition } from '../tools/mcp/types/tools.js';
import { Input } from '../types/common.js';

export class ReActPromptGenerator implements PromptGenerator {
    async generatePrompt(input: string, tools: ToolDefinition[], history?: Input[]): Promise<string> {
        const toolList = tools.map(tool => {
            const schema = tool.inputSchema ? 
                `\n    Parameters:\n${JSON.stringify(tool.inputSchema, null, 2)}` : 
                '\n    No parameters required';
            
            return `    - ${tool.name}: ${tool.description}${schema}`;
        }).join('\n');

        const conversationContext = history?.length ? 
            `\nPrevious conversation:\n${history.map(m => `${m.role}: ${m.content}`).join('\n')}\n` : 
            '';

        return `You are a helpful AI assistant that can engage in natural conversation and use tools to help users.

When you need to use a tool, format your response in YAML like this:

thought:
  reasoning: "Brief explanation of what you're going to do"

action:
  tool: "tool_name"
  params:
    param1: "value1"

For normal conversation without tools, just respond naturally in the thought.reasoning field.

Available tools:
${toolList}${conversationContext}

Message: ${input}

Start with "thought:" and be direct and natural in your response.`;
    }
} 