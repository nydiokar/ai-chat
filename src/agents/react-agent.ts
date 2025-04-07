import { ToolDefinition, ToolResponse } from "../tools/mcp/types/tools.js";
import { Agent, ThoughtProcess } from "../interfaces/agent.js";
import { LLMProvider } from "../interfaces/llm-provider.js";
import { Input, Response } from "../types/common.js";
import { ReActPromptGenerator } from "../prompt/react-prompt-generator.js";
import { MCPContainer } from "../tools/mcp/di/container.js";
import yaml from 'js-yaml';
import { v4 as uuid } from 'uuid';

interface AgentConfig {
  name: string;
  capabilities: string[];
  reasoning_framework: string;
  thought_process: string[];
  tools: string[];
}

export class ReActAgent implements Agent {
  private readonly config: AgentConfig;
  private thoughtProcess: ThoughtProcess[];
  public readonly id: string;
  public readonly name: string;
  private debugMode: boolean = false;

  constructor(
    private readonly container: MCPContainer,
    private readonly llmProvider: LLMProvider,
    private readonly promptGenerator: ReActPromptGenerator,
    name?: string
  ) {
    this.id = uuid();
    this.name = name || "ReAct Agent";
    this.thoughtProcess = [];
    this.config = {
      name: this.name,
      capabilities: ["reasoning", "tool_usage", "planning"],
      reasoning_framework: "REACT",
      thought_process: ["Reason", "Act", "Observe", "Think"],
      tools: []
    };
  }

  // Add method to toggle debug mode
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  // Add method to get last thought process
  getLastThoughtProcess(): ThoughtProcess | null {
    return this.thoughtProcess[this.thoughtProcess.length - 1] || null;
  }

  async initialize(): Promise<void> {
    // Load available tools into config
    const tools = await this.container.getToolManager().getAvailableTools();
    this.config.tools = tools.map(t => t.name);
  }

  private formatThoughtProcess(process: ThoughtProcess): string {
    let output = '';

    // Format thought section
    if (process.thought) {
      output += `💭 ${process.thought.reasoning}\n`;
      output += `📋 ${process.thought.plan}\n`;
    }

    // Format action section if present
    if (process.action) {
      output += `\n🔧 Using: ${process.action.tool}\n`;
      if (process.action.purpose) output += `📌 For: ${process.action.purpose}\n`;
      if (Object.keys(process.action.params).length > 0) {
        output += `⚙️ With: ${JSON.stringify(process.action.params)}\n`;
      }
    }

    // Format observation if present
    if (process.observation) {
      output += `\n👁️ Result: ${process.observation.result}\n`;
    }

    // Format next steps if present
    if (process.next_step) {
      output += `\n➡️ Next: ${process.next_step.plan}\n`;
    }

    // Format error handling if present
    if (process.error_handling) {
      output += `\n❌ Error: ${process.error_handling.error}\n`;
      if (process.error_handling.recovery) {
        output += `🔄 Recovery: ${process.error_handling.recovery.alternate_plan}\n`;
      }
    }

    return output;
  }

    private async reason(input: string, tools: ToolDefinition[], history?: Input[]): Promise<ThoughtProcess> {
    try {
      // Generate prompt using promptGenerator with history
      const prompt = await this.promptGenerator.generatePrompt(input, tools, history);
      
      // Get LLM response using provider
      const response = await this.llmProvider.generateResponse(prompt, history);
      
      try {
        // Clean the response of any markdown formatting
        const cleanResponse = response.content
          .replace(/^```ya?ml\n/i, '') // Remove opening YAML code block
          .replace(/```\s*$/i, '')     // Remove closing code block
          .trim();                     // Remove extra whitespace
        
        const parsedResponse = yaml.load(cleanResponse) as ThoughtProcess;
        
        // Validate the parsed response has the minimum required structure
        if (parsedResponse && typeof parsedResponse === 'object' && 
            parsedResponse.thought && typeof parsedResponse.thought === 'object' &&
            typeof parsedResponse.thought.reasoning === 'string' && 
            typeof parsedResponse.thought.plan === 'string') {
          
          if (history?.length) {
            parsedResponse.thought.reasoning = `Based on previous conversation: ${parsedResponse.thought.reasoning}`;
          }
          return parsedResponse;
        }
      } catch (parseError) {
        console.error('Failed to parse YAML response:', parseError);
      }

      // If response is invalid or parsing failed, fall back to basic response
      return {
        thought: {
          reasoning: tools.length ? 
            `${history?.length ? 'Considering previous conversation while analyzing' : 'Analyzing'} the input and available tools` : 
            'No tools are available for this request - proceeding with direct response',
          plan: tools.length ?
            "Determining best course of action" :
            "Providing response without tool assistance"
        }
      };
    } catch (error) {
      // If processing fails, return a basic thought process with error handling
      return {
        thought: {
          reasoning: tools.length ? 
            "Error processing the response" : 
            "No tools are available for this request",
          plan: tools.length ?
            "Falling back to basic response" :
            "Providing direct response without tools"
        },
        error_handling: {
          error: error instanceof Error ? error.message : 'Unknown error',
          recovery: {
            log_error: "Error during response processing",
            alternate_plan: "Provide direct response without tools"
          }
        }
      };
    }
  }

  private async act(action: ThoughtProcess['action']): Promise<ToolResponse> {
    if (!action?.tool || !action.params) {
      throw new Error("Invalid action specification");
    }

    try {
      return await this.container.getToolManager().executeTool(action.tool, action.params);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Tool execution failed: ${errorMessage}`);
    }
  }

  private async observe(result: ToolResponse): Promise<ThoughtProcess['observation']> {
    return {
      result: typeof result.data === 'string' ? result.data : JSON.stringify(result.data)
    };
  }

  private async think(observation: ThoughtProcess['observation'], history?: Input[]): Promise<ThoughtProcess['next_step']> {
    try {
      // Generate prompt using promptGenerator
      const prompt = await this.promptGenerator.generatePrompt(
        `Analyze this observation and determine next steps: ${observation?.result}`,
        await this.container.getToolManager().getAvailableTools(),
        history
      );
      
      // Get LLM response using provider
      const response = await this.llmProvider.generateResponse(prompt, history);
      const parsedResponse = yaml.load(response.content) as ThoughtProcess;

      // Validate and return the parsed next steps, or fall back to basic response
      if (parsedResponse?.next_step?.plan) {
        return parsedResponse.next_step;
      }

      return {
        plan: "Processing observation and planning next steps"
      };
    } catch (error) {
      return {
        plan: "Error occurred while analyzing observation"
      };
    }
  }

  async processMessage(message: string, conversationHistory?: Input[]): Promise<Response> {
    try {
      // Get available tools
      const tools = await this.container.getToolManager().getAvailableTools();
      
      // Get response from LLM
      const prompt = await this.promptGenerator.generatePrompt(message, tools, conversationHistory);
      const response = await this.llmProvider.generateResponse(prompt, conversationHistory);
      
      // Clean any markdown formatting
      const cleanResponse = response.content
        .replace(/^```ya?ml\n/i, '')
        .replace(/```\s*$/i, '')
        .trim();

      // Parse the response
      const parsed = yaml.load(cleanResponse) as ThoughtProcess;
      
      // If there's an action, execute it
      if (parsed?.action?.tool) {
        try {
          const result = await this.container.getToolManager().executeTool(
            parsed.action.tool,
            parsed.action.params || {}
          );
          
          // For debug mode, show the full process
          if (this.debugMode) {
            return {
              content: `💭 ${parsed.thought.reasoning}\n🔧 Using: ${parsed.action.tool}\n👁️ Result: ${result.data}`,
              tokenCount: null,
              toolResults: [result]
            };
          }
          
          // For normal mode, just return the result
          return {
            content: typeof result.data === 'string' ? result.data : JSON.stringify(result.data),
            tokenCount: null,
            toolResults: [result]
          };
        } catch (error) {
          return {
            content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            tokenCount: null,
            toolResults: []
          };
        }
      }
      
      // For responses without tools, just return the reasoning
      return {
        content: parsed?.thought?.reasoning || "I'm not sure how to respond to that.",
        tokenCount: null,
        toolResults: []
      };

    } catch (error) {
      return {
        content: "I apologize, but I encountered an error. Could you try again?",
        tokenCount: null,
        toolResults: []
      };
    }
  }

  async executeTool(tool: ToolDefinition, args: Record<string, unknown>): Promise<ToolResponse> {
    return await this.container.getToolManager().executeTool(tool.name, args);
  }

  async cleanup(): Promise<void> {
    // Clean up LLM provider resources
    await this.llmProvider.cleanup();
  }
} 