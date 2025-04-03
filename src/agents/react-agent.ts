import { IToolManager } from "../tools/mcp/interfaces/core.js";
import { ToolDefinition, ToolResponse } from "../tools/mcp/types/tools.js";
import yaml from 'js-yaml';

interface AgentConfig {
  name: string;
  capabilities: string[];
  reasoning_framework: string;
  thought_process: string[];
  tools: string[];
}

interface ThoughtProcess {
  thought: {
    reasoning: string;
    plan: string;
  };
  action?: {
    tool: string;
    purpose: string;
    params: Record<string, any>;
  };
  observation?: {
    result: string;
  };
  next_step?: {
    plan: string;
  };
}

export class ReActAgent {
  private readonly config: AgentConfig;
  private thoughtProcess: ThoughtProcess[];

  constructor(private readonly toolManager: IToolManager) {
    this.thoughtProcess = [];
    this.config = {
      name: "Assistant",
      capabilities: ["reasoning", "tool_usage", "planning"],
      reasoning_framework: "REACT",
      thought_process: ["Reason", "Act", "Observe", "Think"],
      tools: []
    };
  }

  async initialize(): Promise<void> {
    // Load available tools into config
    const tools = await this.toolManager.getAvailableTools();
    this.config.tools = tools.map(t => t.name);
  }

  private formatThoughtProcess(process: ThoughtProcess): string {
    return yaml.dump(process, { 
      indent: 2,
      lineWidth: -1,
      quotingType: '"'
    });
  }

  private async reason(input: string, tools: ToolDefinition[]): Promise<ThoughtProcess> {
    // This will be replaced with actual LLM call
    // The LLM will be prompted to:
    // 1. Analyze the input
    // 2. Form a plan
    // 3. Decide if and which tool to use
    // 4. Format response in YAML
    return {
      thought: {
        reasoning: "Step-by-step analysis will go here",
        plan: "Concrete steps will go here"
      }
    };
  }

  private async act(action: ThoughtProcess['action']): Promise<ToolResponse> {
    if (!action?.tool || !action.params) {
      throw new Error("Invalid action specification");
    }

    return await this.toolManager.executeTool(action.tool, action.params);
  }

  private async observe(result: ToolResponse): Promise<ThoughtProcess['observation']> {
    return {
      result: typeof result.data === 'string' ? result.data : JSON.stringify(result.data)
    };
  }

  private async think(observation: ThoughtProcess['observation']): Promise<ThoughtProcess['next_step']> {
    // This will be replaced with actual LLM call
    // The LLM will be prompted to:
    // 1. Analyze the observation
    // 2. Determine next steps
    return {
      plan: "Next steps will go here"
    };
  }

  async processRequest(input: string): Promise<string> {
    try {
      // Get available tools
      const tools = await this.toolManager.getAvailableTools();
      
      // Start REACT loop
      let currentProcess = await this.reason(input, tools);
      this.thoughtProcess.push(currentProcess);

      // If action is needed
      if (currentProcess.action) {
        // Execute action
        const result = await this.act(currentProcess.action);
        
        // Observe results
        currentProcess.observation = await this.observe(result);
        
        // Think about next steps
        currentProcess.next_step = await this.think(currentProcess.observation);
      }

      // Format the entire thought process
      return this.formatThoughtProcess(currentProcess);

    } catch (error) {
      // Handle errors according to framework
      return yaml.dump({
        error_handling: {
          error: error instanceof Error ? error.message : 'Unknown error',
          recovery: {
            log_error: "Error during request processing",
            alternate_plan: "Provide direct response without tools"
          }
        }
      });
    }
  }
} 