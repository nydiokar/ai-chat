import { Agent } from '../interfaces/agent.js';
import { ReActAgent } from './react-agent.js';
import { LLMProvider } from '../interfaces/llm-provider.js';
import { MemoryProvider } from '../interfaces/memory-provider.js';
import { IToolManager } from '../tools/mcp/interfaces/core.js';
import { ReActPromptGenerator } from '../prompt/react-prompt-generator.js';
import { MCPContainer } from '../tools/mcp/di/container.js';

/**
 * Factory for creating agent instances
 */
export class AgentFactory {
  /**
   * Create a ReAct agent with the necessary dependencies
   */
  static async createReActAgent(
    container: MCPContainer,
    llmProvider: LLMProvider,
    memoryProvider: MemoryProvider,
    toolManager: IToolManager,
    name?: string
  ): Promise<Agent> {
    // Create prompt generator
    const promptGenerator = new ReActPromptGenerator();
    
    // Create and return the agent
    return new ReActAgent(
      container,
      llmProvider,
      memoryProvider,
      toolManager,
      promptGenerator,
      name
    );
  }
} 