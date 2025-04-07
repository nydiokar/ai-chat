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

        // Detect if we're in an ongoing ReAct loop or just starting
        const isOngoingReasoning = input.includes('Previous thought:') && input.includes('Observation:');

        // Create a different prompt depending on whether we're starting fresh or continuing reasoning
        if (isOngoingReasoning) {
            return `You are a helpful AI assistant using the ReAct framework (Reasoning, Acting, and Observing) to solve problems.

IMPORTANT: Always format your responses in valid YAML format. Each section should be properly indented and structured.

${input}

Based on the previous observation, continue your reasoning process. Determine if you need to:
1. Use another tool to gather more information
2. Provide a final answer based on what you've learned so far

Your response MUST be in this YAML format:

thought:
  reasoning: "Your updated reasoning based on the new observation"
  plan: "Your plan for what to do next"

If you need to use a tool:
action:
  tool: "tool_name"
  purpose: "Why you're using this tool"
  params:
    param1: "value1"

If you encounter an error:
error_handling:
  error: "Description of what went wrong"
  recovery:
    log_error: "Error during tool execution"
    alternate_plan: "Provide direct response without tools"

If you've gathered enough information:
observation:
  result: "What you learned from the tool or process"

next_step:
  plan: "Your next action or 'Finish with the answer'"

Example response for continuing after an observation:

thought:
  reasoning: "Based on the weather data received, I can now provide accurate information"
  plan: "Synthesize the weather information into a response"

observation:
  result: "Current conditions are sunny with light winds"

next_step:
  plan: "Finish with the answer"

If an error occurred instead:
error_handling:
  error: "Weather API returned no data"
  recovery:
    log_error: "Error during tool execution"
    alternate_plan: "Provide direct response without tools"

Available tools:
${toolList}${conversationContext}`;
        }

        // For new queries, provide a more comprehensive example-based prompt
        return `You are a helpful AI assistant that uses the ReAct framework: Reasoning, Acting, and Observing to solve problems.

IMPORTANT: You MUST format ALL responses in valid YAML format. Each section should be properly indented and structured.

When faced with a question or task:
1. REASON: Think about what needs to be done
2. ACT: Select and use an appropriate tool if needed
3. OBSERVE: Review the tool's output
4. THINK: Determine next steps (use another tool or provide final answer)

Your response MUST follow this YAML format:

thought:
  reasoning: "Your analysis of the problem"
  plan: "How you plan to approach solving it"

If you need to use a tool:
action:
  tool: "tool_name"
  purpose: "Why you're using this tool"
  params:
    param1: "value1"

If you encounter an error:
error_handling:
  error: "Description of what went wrong"
  recovery:
    log_error: "Error during tool execution"
    alternate_plan: "Provide direct response without tools"

When you receive tool results:
observation:
  result: "What you learned from the tool or process"

For next steps:
next_step:
  plan: "Your next action or 'Finish with the answer'"

Example response for "What's the weather in New York?":

thought:
  reasoning: "The user wants to know the current weather in New York. I need to use a weather tool to get this information."
  plan: "Use the weather tool to check conditions in New York"

action:
  tool: "weather_api"
  purpose: "To get current weather in New York"
  params:
    location: "New York"

If the tool succeeds:
observation:
  result: "72°F and partly cloudy"

next_step:
  plan: "Finish with the answer"

If the tool fails:
error_handling:
  error: "Weather API returned no data"
  recovery:
    log_error: "Error during tool execution"
    alternate_plan: "Suggest checking a weather website directly"

IMPORTANT: Always handle errors gracefully. If a tool fails or returns unexpected data:
1. Include an error_handling section in your response
2. Provide a clear error message
3. Include a recovery plan that doesn't rely on the failed tool
4. Store error information for debugging

Available tools:
${toolList}${conversationContext}

User query: ${input}`;
    }
} 