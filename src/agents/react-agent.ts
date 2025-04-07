import { ToolDefinition, ToolResponse } from "../tools/mcp/types/tools.js";
import { Agent, ThoughtProcess } from "../interfaces/agent.js";
import { LLMProvider } from "../interfaces/llm-provider.js";
import { Input, Response } from "../types/common.js";
import { ReActPromptGenerator } from "../prompt/react-prompt-generator.js";
import { MCPContainer } from "../tools/mcp/di/container.js";
import { MemoryProvider, MemoryType } from "../interfaces/memory-provider.js";
import { MemoryFactory } from "../memory/memory-factory.js";
import { getLogger } from '../utils/shared-logger.js';
import { handleError } from '../utils/error-handler.js';
import { createLogContext } from '../utils/log-utils.js';
import { defaultConfig } from '../utils/config.js';
import { ReActStateMachine, ReActError } from "./state/react-state.js";
import { ErrorHandler } from "./error/error-handler.js";
import yaml from 'js-yaml';
import { v4 as uuid } from 'uuid';
import type { Logger } from 'winston';

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
  private readonly logger: Logger;
  public readonly id: string;
  public readonly name: string;
  private debugMode: boolean = false;
  private memoryProvider?: MemoryProvider;
  private initialized: boolean = false;

  constructor(
    private readonly container: MCPContainer,
    private readonly llmProvider: LLMProvider,
    private readonly promptGenerator: ReActPromptGenerator,
    name?: string,
    memoryProvider?: MemoryProvider
  ) {
    this.id = uuid();
    this.name = name || "ReAct Agent";
    this.thoughtProcess = [];
    this.logger = getLogger('ReActAgent');
    this.debugMode = defaultConfig.debug;
    
    this.config = {
      name: this.name,
      capabilities: ["reasoning", "tool_usage", "planning"],
      reasoning_framework: "REACT",
      thought_process: ["Reason", "Act", "Observe", "Think"],
      tools: []
    };
    
    // Use provided memory provider
    if (memoryProvider) {
      this.memoryProvider = memoryProvider;
      this.initialized = true;
    }

    this.logger.info('ReAct Agent initialized', createLogContext(
      'ReActAgent',
      'constructor',
      {
        agentId: this.id,
        agentName: this.name,
        debugMode: this.debugMode
      }
    ));
  }

  // Add method to toggle debug mode
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    this.logger.debug('Debug mode toggled', createLogContext(
      'ReActAgent',
      'setDebugMode',
      {
        enabled
      }
    ));
  }

  // Add method to get last thought process
  getLastThoughtProcess(): ThoughtProcess | null {
    return this.thoughtProcess[this.thoughtProcess.length - 1] || null;
  }

  async initialize(): Promise<void> {
    try {
      // Initialize memory provider if not already set
      if (!this.memoryProvider) {
        this.memoryProvider = await MemoryFactory.getInstance().getProvider();
      }
      
      // Load available tools into config
      const tools = await this.container.getToolManager().getAvailableTools();
      this.config.tools = tools.map(t => t.name);
      
      this.initialized = true;

      this.logger.info('ReAct Agent initialized successfully', createLogContext(
        'ReActAgent',
        'initialize',
        {
          memoryProvider: this.memoryProvider.constructor.name,
          toolCount: tools.length
        }
      ));
    } catch (error) {
      this.logger.error('Failed to initialize ReAct Agent', createLogContext(
        'ReActAgent',
        'initialize',
        {
          error
        }
      ));
      handleError(error);
    }
  }

  private formatThoughtProcess(process: ThoughtProcess): string {
    if (this.debugMode) {
      // In debug mode, add debug information but still return YAML
      const debugProcess = {
        ...process,
        debug_info: {
          memories_used: this.thoughtProcess.map(tp => 
            tp.observation?.result || tp.thought?.reasoning || 'No memory'
          ),
          thought_process: this.thoughtProcess.map(tp => ({
            reasoning: tp.thought?.reasoning,
            plan: tp.thought?.plan,
            action: tp.action,
            observation: tp.observation,
            next_step: tp.next_step
          }))
        }
      };
      return yaml.dump(debugProcess);
    }

    // Always return YAML format
    return yaml.dump(process);
  }

  // Safe method for accessing memory provider
  private async getMemoryProvider(): Promise<MemoryProvider> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    if (!this.memoryProvider) {
      throw new Error("Memory provider not available");
    }
    
    return this.memoryProvider;
  }

  // Safe method for getting relevant memories
  private async getRelevantMemories(input: string, userId: string, limit: number = 5): Promise<any[]> {
    try {
      const memoryProvider = await this.getMemoryProvider();
      return await memoryProvider.getRelevantMemories(input, userId, limit);
    } catch (error) {
      this.logger.warn('Failed to retrieve memories', { error });
      return [];
    }
  }

  // Safe method for storing thought process
  private async storeThoughtProcess(thought: ThoughtProcess, userId: string, metadata?: Record<string, any>): Promise<void> {
    try {
      const memoryProvider = await this.getMemoryProvider();
      await memoryProvider.storeThoughtProcess(thought, userId, metadata);
    } catch (error) {
      this.logger.warn('Failed to store thought process', { error });
      // Continue without storing
    }
  }

  private async reason(input: string, tools: ToolDefinition[], history?: Input[]): Promise<ThoughtProcess> {
    try {
      // Retrieve relevant memories for context
      const userId = history && history.length > 0 ? `user-${history[0].role}` : 'default-user';
      const relevantMemories = await this.getRelevantMemories(input, userId, 5);
      
      // Format memories as context for the prompt
      const memoriesContext = relevantMemories.length > 0 
        ? `\nRelevant memories:\n${relevantMemories.map(m => `- ${JSON.stringify(m.content)}`).join('\n')}`
        : '';
      
      // Generate prompt using promptGenerator with history and memories
      const prompt = await this.promptGenerator.generatePrompt(
        `${input}${memoriesContext}`,
        tools,
        history
      );
      
      // Get LLM response using provider
      const response = await this.llmProvider.generateResponse(prompt, history);
      
      try {
        // Clean the response of any markdown formatting
        const cleanResponse = response.content
          .replace(/^```ya?ml\n/i, '')
          .replace(/```\s*$/i, '')
          .trim();
        
        const parsedResponse = yaml.load(cleanResponse) as ThoughtProcess;
        
        // Validate the parsed response has the minimum required structure
        if (parsedResponse && typeof parsedResponse === 'object' && 
            parsedResponse.thought && typeof parsedResponse.thought === 'object' &&
            typeof parsedResponse.thought.reasoning === 'string' && 
            typeof parsedResponse.thought.plan === 'string') {
          
          if (history?.length) {
            parsedResponse.thought.reasoning = `Based on previous conversation: ${parsedResponse.thought.reasoning}`;
          }
          
          // Store the thought process in memory
          await this.storeThoughtProcess(parsedResponse, userId, {
            importance: 0.7,
            input,
            timestamp: new Date().toISOString()
          });
          
          return parsedResponse;
        }

        // If response structure is invalid, throw error to be caught below
        throw new Error('Invalid response structure from language model');
      } catch (parseError) {
        // Create an error handler to handle parsing errors
        const errorHandler = new ErrorHandler();
        const reactError = errorHandler.handle(
          new Error(`${parseError instanceof Error ? parseError.message : 'Unknown error during reasoning'}`),
          { retryCount: 0, originalInput: input }
        );
        
        // For retry strategy, try with a simplified prompt
        if (reactError.recovery.strategy === 'RETRY') {
          try {
            // Generate a simplified prompt
            const simplifiedPrompt = await this.promptGenerator.generatePrompt(
              `Please parse this input and respond in simple YAML format: ${input}`,
              tools,
              history
            );
            
            // Try again with simplified prompt
            const retryResponse = await this.llmProvider.generateResponse(simplifiedPrompt, history);
            const cleanRetryResponse = retryResponse.content
              .replace(/^```ya?ml\n/i, '')
              .replace(/```\s*$/i, '')
              .trim();
            
            const parsedRetryResponse = yaml.load(cleanRetryResponse) as ThoughtProcess;
            
            if (parsedRetryResponse?.thought?.reasoning) {
              return parsedRetryResponse;
            }
          } catch (retryError) {
            // If retry fails, fall through to the default error handling
            this.logger.error('Retry failed after parsing error', createLogContext(
              'ReActAgent',
              'reason',
              { originalError: parseError, retryError }
            ));
          }
        }
        
        return errorHandler.getRecoveryPlan(reactError);
      }
    } catch (error) {
      // If processing fails, return a properly formatted error response
      const errorHandler = new ErrorHandler();
      const reactError = errorHandler.handle(
        new Error(`${error instanceof Error ? error.message : 'Unknown error during reasoning'}`),
        { phase: 'REASON' }
      );
      return errorHandler.getRecoveryPlan(reactError);
    }
  }

  private async act(action: ThoughtProcess['action']): Promise<ToolResponse> {
    if (!action?.tool || !action.params) {
      throw new Error("Invalid action specification");
    }

    try {
      return await this.container.getToolManager().executeTool(action.tool, action.params);
    } catch (error) {
      const errorHandler = new ErrorHandler();
      const reactError = errorHandler.handle(
        new Error(`${error instanceof Error ? error.message : 'Unknown error during tool execution'}`),
        { tool: action.tool, params: action.params }
      );
      
      // Convert to ThoughtProcess format for consistent error handling
      const errorThought = errorHandler.getRecoveryPlan(reactError);
      throw errorThought;
    }
  }

  private async observe(result: ToolResponse, userId: string = 'default-user'): Promise<ThoughtProcess['observation']> {
    const observation = {
      result: typeof result.data === 'string' ? result.data : JSON.stringify(result.data)
    };
    
    try {
      // Store the observation in memory
      const memoryProvider = await this.getMemoryProvider();
      await memoryProvider.store({
        userId,
        type: MemoryType.TOOL_USAGE,
        content: {
          observation,
          timestamp: new Date().toISOString()
        },
        metadata: {
          result: typeof result.data === 'string' ? result.data.substring(0, 100) : JSON.stringify(result.data).substring(0, 100)
        },
        tags: ['observation'],
        importance: 0.6
      });
    } catch (error) {
      this.logger.warn('Failed to store observation', { error });
      // Continue without storing
    }
    
    return observation;
  }

  private async think(observation: ThoughtProcess['observation'], history?: Input[], userId: string = 'default-user'): Promise<ThoughtProcess['next_step']> {
    try {
      // Get relevant memories to provide context
      const relevantMemories = await this.getRelevantMemories(
        observation?.result || 'No observation', 
        userId, 
        3
      );
      
      // Format memories for context
      const memoriesContext = relevantMemories.length > 0 
        ? `\nRelevant memories for decision making:\n${relevantMemories.map(m => 
            `- ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`
          ).join('\n')}`
        : '';
      
      // Generate prompt using promptGenerator
      const prompt = await this.promptGenerator.generatePrompt(
        `Analyze this observation and determine next steps: ${observation?.result}${memoriesContext}`,
        await this.container.getToolManager().getAvailableTools(),
        history
      );
      
      // Get LLM response using provider
      const response = await this.llmProvider.generateResponse(prompt, history);
      const parsedResponse = yaml.load(response.content) as ThoughtProcess;

      // Store the thinking process
      try {
        const memoryProvider = await this.getMemoryProvider();
        if (parsedResponse?.next_step) {
          await memoryProvider.store({
            userId,
            type: MemoryType.THOUGHT_PROCESS,
            content: {
              nextStep: parsedResponse.next_step,
              basedOn: observation?.result
            },
            metadata: {
              type: 'next_step',
              basedOnObservation: !!observation
            },
            tags: ['thinking', 'next_step'],
            importance: 0.5
          });
        }
      } catch (error) {
        this.logger.warn('Failed to store thinking process', { error });
        // Continue without storing
      }

      // Validate and return the parsed next steps, or fall back to basic response
      if (parsedResponse?.next_step?.plan) {
        return parsedResponse.next_step;
      }

      const defaultNextStep = {
        plan: "Processing observation and planning next steps"
      };
      
      // Store default next step with lower importance
      try {
        const memoryProvider = await this.getMemoryProvider();
        await memoryProvider.store({
          userId,
          type: MemoryType.THOUGHT_PROCESS,
          content: {
            nextStep: defaultNextStep,
            basedOn: observation?.result,
            fallback: true
          },
          metadata: {
            type: 'next_step',
            fallback: true,
            basedOnObservation: !!observation
          },
          tags: ['thinking', 'next_step', 'fallback'],
          importance: 0.3
        });
      } catch (error) {
        this.logger.warn('Failed to store default next step', { error });
        // Continue without storing
      }

      return defaultNextStep;
    } catch (error) {
      const errorStep = {
        plan: "Error occurred while analyzing observation"
      };
      
      // Store error with low importance
      try {
        const memoryProvider = await this.getMemoryProvider();
        await memoryProvider.store({
          userId,
          type: MemoryType.THOUGHT_PROCESS,
          content: {
            error: error instanceof Error ? error.message : 'Unknown error',
            nextStep: errorStep,
            basedOn: observation?.result
          },
          metadata: {
            type: 'next_step',
            error: true,
            errorMessage: error instanceof Error ? error.message : 'Unknown error'
          },
          tags: ['thinking', 'next_step', 'error'],
          importance: 0.2
        });
      } catch (error) {
        this.logger.warn('Failed to store error step', { error });
        // Continue without storing
      }
      
      return errorStep;
    }
  }

  async processMessage(input: string, history?: Input[]): Promise<Response> {
    try {
      // Ensure memory provider is initialized
      if (!this.initialized) {
        await this.initialize();
      }
      
      // Initialize state machine
      const userId = history && history.length > 0 ? `user-${history[0].role}` : 'default-user';
      const stateMachine = new ReActStateMachine(input, userId, history);
      stateMachine.setDebugMode(this.debugMode);

      // Get available tools
      const tools = await this.container.getToolManager().getAvailableTools();

      while (stateMachine.shouldContinue()) {
        const state = stateMachine.getState();
        
        try {
          switch (state.currentPhase) {
            case 'REASON': {
              const thought = await this.reason(state.currentInput, tools, history);
              stateMachine.addThoughtProcess(thought);
              
              if (thought.error_handling) {
                // If there's an error, transition to ERROR state
                stateMachine.transitionTo('ERROR');
              } else if (thought.action?.tool) {
                // If there's a tool to execute, transition to ACT
                stateMachine.transitionTo('ACT');
              } else {
                // If no tool needed, we're done
                stateMachine.transitionTo('COMPLETE');
              }
              break;
            }
            
            case 'ACT': {
              const lastThought = stateMachine.getLastThoughtProcess();
              if (!lastThought?.action) {
                throw new Error("No action available in thought process");
              }
              
              const result = await this.act(lastThought.action);
              stateMachine.addToolResult(
                result,
                lastThought.action.tool,
                lastThought.action.params
              );
              
              // Move to OBSERVE phase
              stateMachine.transitionTo('OBSERVE');
              break;
            }
            
            case 'OBSERVE': {
              const lastResult = stateMachine.getLastToolResult();
              if (!lastResult) {
                throw new Error("No tool result available for observation");
              }
              
              const observation = await this.observe(lastResult, state.userId);
              const lastThought = stateMachine.getLastThoughtProcess();
              if (lastThought) {
                lastThought.observation = observation;
                // Update the thought process with the observation
                stateMachine.addThoughtProcess(lastThought);
              }
              
              // Move to THINK phase
              stateMachine.transitionTo('THINK');
              break;
            }
            
            case 'THINK': {
              const lastThought = stateMachine.getLastThoughtProcess();
              if (!lastThought?.observation) {
                throw new Error("No observation available for thinking");
              }
              
              const nextStep = await this.think(lastThought.observation, history, state.userId);
              if (lastThought && nextStep) {
                lastThought.next_step = nextStep;
                // Update the thought process with the next step
                stateMachine.addThoughtProcess(lastThought);
                
                // If next step indicates completion, transition to COMPLETE
                // Otherwise, go back to REASON for another iteration
                if (nextStep.plan.toLowerCase().includes('complete') || 
                    nextStep.plan.toLowerCase().includes('finish')) {
                  stateMachine.transitionTo('COMPLETE');
                } else {
                  stateMachine.transitionTo('REASON');
                  stateMachine.incrementIteration();
                }
              } else {
                // If no next step, transition to ERROR
                stateMachine.handleError({
                  type: 'VALIDATION_ERROR',
                  error: 'No next step available after thinking',
                  recovery: {
                    strategy: 'DIRECT_RESPONSE',
                    plan: 'Provide direct response without further steps'
                  },
                  timestamp: new Date().toISOString()
                });
              }
              break;
            }
            
            case 'ERROR': {
              const state = stateMachine.getState();
              if (!state.error) {
                throw new Error("No error information available in error state");
              }
              
              // Log the error
              this.logger.error('Error in ReAct loop', createLogContext(
                'ReActAgent',
                'processMessage',
                {
                  errorType: state.error.type,
                  error: state.error.error,
                  recovery: state.error.recovery
                }
              ));
              
              // Convert ReActError to ThoughtProcess format using ErrorHandler
              const errorHandler = new ErrorHandler();
              const errorThought = errorHandler.getRecoveryPlan(state.error);
              
              // Return formatted error response in ThoughtProcess YAML format
              return {
                content: this.formatThoughtProcess(errorThought),
                tokenCount: 0,
                toolResults: state.toolResults
              };
            }
            
            case 'COMPLETE': {
              // Format the final response
              const lastThought = stateMachine.getLastThoughtProcess();
              if (!lastThought) {
                throw new Error("No thought process available for final response");
              }
              
              return {
                content: this.formatThoughtProcess(lastThought),
                tokenCount: 0,
                toolResults: state.toolResults
              };
            }
          }
        } catch (error) {
          // Handle any errors that occur during the ReAct loop
          const errorHandler = new ErrorHandler();
          const reactError = errorHandler.handle(
            new Error(`${error instanceof Error ? error.message : 'Unknown error in ReAct loop'}`),
            { phase: state.currentPhase }
          );
          
          stateMachine.handleError(reactError);
        }
      }

      // Get final state
      const finalState = stateMachine.getState();
      
      // If we ended in an error state, return error response using ErrorHandler
      if (finalState.error) {
        const errorHandler = new ErrorHandler();
        const errorThought = errorHandler.getRecoveryPlan(finalState.error);
        return {
          content: this.formatThoughtProcess(errorThought),
          tokenCount: 0,
          toolResults: finalState.toolResults
        };
      }
      
      // Otherwise return the final thought process
      const lastThought = finalState.thoughtProcess[finalState.thoughtProcess.length - 1];
      return {
        content: this.formatThoughtProcess(lastThought),
        tokenCount: 0,
        toolResults: finalState.toolResults
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.logger.error('Fatal error in ReAct agent', createLogContext(
        'ReActAgent',
        'processMessage',
        { 
          errorMessage
        }
      ));
      
      handleError(error);
      
      // Create a properly formatted error response
      const errorHandler = new ErrorHandler();
      const reactError = errorHandler.handle(
        new Error(errorMessage),
        { phase: 'PROCESS_MESSAGE' }
      );
      const errorThought = errorHandler.getRecoveryPlan(reactError);
      
      return {
        content: this.formatThoughtProcess(errorThought),
        tokenCount: 0,
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

  // Enhanced error recovery method with proper error handling
  private async attemptRecovery(error: Error, thoughtProcess: ThoughtProcess, tools: ToolDefinition[], userId: string): Promise<ThoughtProcess> {
    try {
      // Generate a recovery prompt
      const recoveryPrompt = `
Previous thought process:
${thoughtProcess.thought.reasoning}
${thoughtProcess.thought.plan}

Error encountered: ${error.message}

Please provide a recovery plan. Format your response in YAML with:
- Analysis of what went wrong
- A plan to recover or gracefully handle the error
`;

      const response = await this.llmProvider.generateResponse(recoveryPrompt);
      
      try {
        // Clean and parse the response
        const cleanResponse = response.content
          .replace(/^```ya?ml\n/i, '')
          .replace(/```\s*$/i, '')
          .trim();
        
        const parsedResponse = yaml.load(cleanResponse) as ThoughtProcess;
        
        // Store the recovery attempt in memory
        try {
          const memoryProvider = await this.getMemoryProvider();
          await memoryProvider.store({
            userId,
            type: MemoryType.SYSTEM,
            content: {
              error: error.message,
              originalThought: thoughtProcess.thought,
              recoveryPlan: parsedResponse.thought
            },
            metadata: {
              error: true,
              recovery: true,
              timestamp: new Date().toISOString()
            },
            tags: ['error', 'recovery'],
            importance: 0.9
          });
        } catch (memoryError) {
          this.logger.warn('Failed to store recovery attempt', { error: memoryError });
          // Continue without storing
        }
        
        return {
          thought: parsedResponse.thought,
          error_handling: {
            error: error.message,
            recovery: {
              log_error: "Error during tool execution",
              alternate_plan: "Provide direct response without tools"
            }
          }
        };
      } catch (parseError) {
        this.logger.error('Failed to parse recovery response', { error: parseError });
      }
    } catch (recoveryError) {
      this.logger.error('Failed to generate recovery plan', { error: recoveryError });
    }
    
    // Fallback recovery plan if everything fails
    return {
      thought: {
        reasoning: `Error occurred: ${error.message}. Unable to proceed with original plan.`,
        plan: "Fall back to providing a direct response without tools"
      },
      error_handling: {
        error: error.message,
        recovery: {
          log_error: "Error during tool execution",
          alternate_plan: "Provide direct response without tools"
        }
      }
    };
  }
} 