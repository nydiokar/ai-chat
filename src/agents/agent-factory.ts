import { Agent } from '../interfaces/agent.js';
import { ReActAgent } from './react-agent.js';
import { LLMProvider } from '../interfaces/llm-provider.js';
import { MemoryProvider } from '../interfaces/memory-provider.js';
import { IToolManager } from '../tools/mcp/interfaces/core.js';
import { ReActPromptGenerator } from '../prompt/react-prompt-generator.js';
import { MCPContainer } from '../tools/mcp/di/container.js';

/**
 * Low-level factory for creating agent instances with specific dependencies.
 * This factory is primarily used for testing and internal use.
 * For application-level agent creation, use AIFactory instead.
 */
export class AgentFactory {
  private static reActAgentInstance: Agent | null = null;

  /**
   * Create a ReAct agent with the necessary dependencies.
   * This is a low-level factory method that expects all dependencies to be provided.
   * For application use, prefer AIFactory.create() which handles configuration and initialization.
   */
  static async createReActAgent(
    container: MCPContainer,
    llmProvider: LLMProvider,
    memoryProvider: MemoryProvider,
    toolManager: IToolManager,
    promptGenerator: ReActPromptGenerator,
    name?: string
  ): Promise<Agent> {
    if (!this.reActAgentInstance) {
      // Create and store the agent instance
      this.reActAgentInstance = new ReActAgent(
        container,
        llmProvider,
        memoryProvider,
        toolManager,
        promptGenerator,
        name
      );
    }
    return this.reActAgentInstance;
  }
} 