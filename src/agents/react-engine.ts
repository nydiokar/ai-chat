import { LLMProvider } from "../interfaces/llm-provider.js";
import { MemoryProvider, MemoryType } from "../interfaces/memory-provider.js";
import { IToolManager } from "../tools/mcp/interfaces/core.js";
import { ReasoningStep } from "../interfaces/react-types.js";
import { ToolChainExecutor, ToolExecutionResult } from "../tools/tool-chain/tool-chain-executor.js";
import { getLogger } from "../utils/shared-logger.js";
import type { Logger } from "winston";
import { ToolChainConfigBuilder } from "../tools/tool-chain/tool-chain-config.js";
import { v4 as uuidv4 } from 'uuid';
import { PromptGenerator } from "../interfaces/prompt-generator.js";

/**
 * Interface for thought process representation
 */
interface ReasoningProcess {
  steps: ReasoningStep[];
  final_response: string;
  is_complete: boolean;
}

/**
 * Core engine implementing the ReAct (Reasoning + Action) pattern
 * Orchestrates the process of reasoning steps, tool execution, and memory persistence
 */
export class ReActEngine {
  private readonly MAX_STEPS = 8;
  private readonly logger: Logger;
  private readonly sessionId: string;
  
  constructor(
    private readonly memory: MemoryProvider,
    private readonly llm: LLMProvider,
    private readonly toolManager: IToolManager,
    private readonly toolExecutor: ToolChainExecutor,
    private readonly promptGenerator: PromptGenerator
  ) {
    this.logger = getLogger('ReActEngine');
    this.sessionId = uuidv4();
  }

  /**
   * Process a user message and execute the ReAct loop
   * @param userMessage The message from the user to process
   * @param userId The ID of the user for memory context
   * @param previousSteps Optional array of previous reasoning steps
   * @param maxIterations Maximum number of iterations before forcing completion
   * @returns The final thought process after completing the reasoning
   */
  public async process(
    userMessage: string,
    userId: string,
    previousSteps: ReasoningStep[] = [],
    maxIterations: number = this.MAX_STEPS
  ): Promise<string> {
    // Create a reasoning process to track all steps and the final result
    const reasoningProcess: ReasoningProcess = {
      steps: [...previousSteps],
      final_response: '',
      is_complete: false
    };
    
    let iterationCount = 0;
    
    // Create initial step with user input if none exist
    if (reasoningProcess.steps.length === 0) {
      const initialStep: ReasoningStep = {
        stepId: `user_${Date.now()}`,
        timestamp: new Date().toISOString(),
        isComplete: false,
        observation: {
          result: userMessage
        }
      };
      reasoningProcess.steps.push(initialStep);
      await this.storeReasoningStep(initialStep, userId, this.sessionId);
    }
    
    const toolRegistry = await this.getToolRegistry();
    const availableTools = await this.toolManager.getAvailableTools();
    
    // Main ReAct loop - use MAX_STEPS to limit iterations
    while (!reasoningProcess.is_complete && iterationCount < maxIterations) {
      iterationCount++;
      this.logger.debug(`ReAct iteration ${iterationCount}/${maxIterations}`);
      
      // Check if we need to optimize steps due to token limitations
      let stepsForPrompt = reasoningProcess.steps;
      if (reasoningProcess.steps.length > 5 && this.promptGenerator.optimizeSteps) {
        // Use the optimizeSteps method if available in the promptGenerator
        try {
          stepsForPrompt = this.promptGenerator.optimizeSteps(reasoningProcess.steps);
          if (stepsForPrompt.length < reasoningProcess.steps.length) {
            this.logger.info('Optimized reasoning steps for prompt', {
              originalSteps: reasoningProcess.steps.length,
              optimizedSteps: stepsForPrompt.length
            });
          }
        } catch (error) {
          // If optimization fails, fall back to original steps
          this.logger.warn('Failed to optimize reasoning steps', {
            error: error instanceof Error ? error.message : String(error)
          });
          stepsForPrompt = reasoningProcess.steps;
        }
      }
      
      // Generate prompt - use generateReActPrompt if available, otherwise fall back to regular generatePrompt
      let prompt: string;
      if (this.promptGenerator.generateReActPrompt) {
        prompt = await this.promptGenerator.generateReActPrompt(
          userMessage,
          stepsForPrompt,
          availableTools,
          iterationCount
        );
      } else {
        // Fall back to standard prompt generation if ReAct-specific method is not available
        prompt = await this.promptGenerator.generatePrompt(
          userMessage,
          availableTools,
          []
        );
      }
      
      try {
        const llmResponse = await this.llm.generateResponse(prompt, [], []);
        
        // Parse reasoning step
        const nextStep = this.parseReasoningStep(llmResponse.content);
        if (!nextStep) {
          this.logger.error('Failed to parse reasoning step', { 
            response: llmResponse.content
          });
          continue;
        }
        
        // Store thought step
        await this.storeReasoningStep(nextStep, userId, this.sessionId);
        reasoningProcess.steps.push(nextStep);
        
        // Check for final answer
        if (nextStep.conclusion?.final_answer) {
          reasoningProcess.is_complete = true;
          reasoningProcess.final_response = nextStep.conclusion.final_answer;
          continue;
        }
        
        // Execute tool if action is specified
        if (nextStep.action?.tool) {
          try {
            // Create a tool chain config
            const chainConfig = new ToolChainConfigBuilder(`tool_exec_${Date.now()}`)
              .addTool({
                name: nextStep.action.tool,
                parameters: nextStep.action.params || {},
                maxRetries: 3,
                timeout: 30000
              })
              .build();
            
            // Get and execute the tool
            const result = await this.toolExecutor.execute(
              chainConfig,
              toolRegistry,
              { userId }
            );
            
            // Store tool execution in memory
            await this.storeToolExecution(
              nextStep.action.tool, 
              nextStep.action.params || {}, 
              result, 
              true,
              userId
            );
            
            // Create observation step
            const observationStep: ReasoningStep = {
              stepId: `obs_${Date.now()}`,
              observation: {
                result: this.formatToolResult(result, nextStep.action)
              },
              isComplete: false,
              timestamp: new Date().toISOString()
            };
            
            await this.storeReasoningStep(observationStep, userId, this.sessionId);
            reasoningProcess.steps.push(observationStep);
            
          } catch (error) {
            // Handle tool execution errors
            const observationStep: ReasoningStep = {
              stepId: `error_${Date.now()}`,
              observation: {
                result: `Error executing tool ${nextStep.action.tool}:\n` +
                       `${error instanceof Error ? error.message : String(error)}\n\n` +
                       `Please try a different approach or tool.`
              },
              isComplete: false,
              timestamp: new Date().toISOString()
            };
            
            await this.storeToolExecution(
              nextStep.action.tool, 
              nextStep.action.params || {}, 
              null, 
              false,
              userId,
              error instanceof Error ? error.message : String(error)
            );
            
            await this.storeReasoningStep(observationStep, userId, this.sessionId);
            reasoningProcess.steps.push(observationStep);
          }
        }
        
      } catch (error) {
        // Handle LLM errors with fallback mechanism
        this.logger.error('LLM generation failed', {
          error: error instanceof Error ? error.message : String(error),
          iteration: iterationCount
        });
        
        // Add an error step to the reasoning process
        const errorStep: ReasoningStep = {
          stepId: `llm_error_${Date.now()}`,
          error_handling: {
            error: error instanceof Error ? error.message : String(error),
            recovery: {
              log_error: `LLM error at step ${iterationCount}`,
              alternate_plan: "Will try to continue with simplified context"
            }
          },
          isComplete: false,
          timestamp: new Date().toISOString()
        };
        
        await this.storeReasoningStep(errorStep, userId, this.sessionId);
        reasoningProcess.steps.push(errorStep);
        
        // Simplify context more aggressively for next attempt
        if (reasoningProcess.steps.length > 3 && this.promptGenerator.optimizeSteps) {
          try {
            // Force more aggressive optimization to reduce context
            stepsForPrompt = this.promptGenerator.optimizeSteps(
              reasoningProcess.steps, 
              3000  // Lower token limit for recovery
            );
            this.logger.info('Applied aggressive context optimization after error', {
              originalSteps: reasoningProcess.steps.length,
              reducedSteps: stepsForPrompt.length
            });
          } catch (e) {
            // If optimization fails, use minimal context
            stepsForPrompt = [
              reasoningProcess.steps[0],  // Initial user message
              ...reasoningProcess.steps.slice(-1) // Latest step only
            ];
          }
        }
      }
      
      // If we've hit the maximum iterations without a conclusion, add a timeout step
      if (iterationCount >= maxIterations && !reasoningProcess.is_complete) {
        this.logger.warn('Maximum iterations reached without conclusion', {
          userId,
          iterations: iterationCount,
          maxAllowed: maxIterations
        });
        
        // Add an automatic conclusion due to iteration limit
        reasoningProcess.is_complete = true;
        reasoningProcess.final_response = 
          "I've explored multiple steps but couldn't reach a definitive conclusion. " +
          "Based on what I've learned so far, here's my best response: " +
          this.generateFallbackResponse(reasoningProcess.steps);
      }
    }
    
    // Store the complete reasoning process for future reference
    await this.memory.store({
      userId,
      type: MemoryType.THOUGHT_PROCESS,
      content: {
        complete_process: reasoningProcess,
        summary: `Process with ${reasoningProcess.steps.length} steps. Complete: ${reasoningProcess.is_complete}`
      },
      metadata: {
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
        stepCount: reasoningProcess.steps.length
      }
    });
    
    // Simple basic logging instead of full metrics tracking
    this.logger.info('Reasoning process completed', {
      stepCount: reasoningProcess.steps.length,
      isComplete: reasoningProcess.is_complete
    });
    
    // Return the final response string for the agent to use
    return reasoningProcess.final_response;
  }

  /**
   * Generate a fallback response when the reasoning process hits the iteration limit
   * @param steps The reasoning steps collected so far
   * @returns A reasonable fallback response
   */
  private generateFallbackResponse(steps: ReasoningStep[]): string {
    // Extract useful information from the steps
    const observations = steps
      .filter(step => step.observation?.result)
      .map(step => step.observation!.result)
      .join("\n");
    
    if (observations.length > 0) {
      return `Based on my investigation, I found: ${observations.substring(0, 200)}...`;
    }
    
    return "I wasn't able to complete this task. Could you try asking in a different way?";
  }

  /**
   * Get the last reasoning step for a user from memory
   * @param userId The user ID to get the last reasoning step for
   * @returns The last reasoning step or null if none found
   */
  public async getLastReasoningStep(userId: string): Promise<ReasoningStep | null> {
    try {
      const memories = await this.memory.search({
        userId,
        types: [MemoryType.THOUGHT_PROCESS],
        limit: 1,
        sortBy: 'timestamp',
        sortDirection: 'desc'
      });
      
      if (memories.entries.length > 0) {
        return memories.entries[0].content.step;
      }
      
      return null;
    } catch (error) {
      this.logger.error('Failed to get last reasoning step', {
        error: error instanceof Error ? error.message : String(error),
        userId
      });
      return null;
    }
  }

  /**
   * Execute a tool directly without going through the reasoning process
   * @param toolName The name of the tool to execute
   * @param params The parameters to pass to the tool
   * @returns The tool execution result
   */
  public async executeToolDirectly(toolName: string, params: Record<string, unknown>): Promise<any> {
    const result = await this.toolManager.executeTool(toolName, params);
    return result.data;
  }
  
  /**
   * Store a reasoning step in memory
   * @param step The reasoning step to store
   * @param userId The user ID for memory context
   * @param sessionId The session ID for memory context
   * @returns Boolean indicating success or failure
   */
  private async storeReasoningStep(
    step: ReasoningStep, 
    userId: string,
    sessionId: string
  ): Promise<boolean> {
    try {
      await this.memory.storeThoughtProcess(
        step,
        userId,
        {
          sessionId,
          timestamp: new Date().toISOString()
        }
      );
      return true;
    } catch (error) {
      this.logger.error('Failed to store reasoning step', { 
        error: error instanceof Error ? error.message : String(error),
        userId,
        sessionId,
        step: step.stepId
      });
      return false;
    }
  }
  
  /**
   * Store tool execution details in memory
   * @param tool The name of the tool executed
   * @param params The parameters passed to the tool
   * @param result The result of the tool execution (or null if failed)
   * @param success Whether the execution was successful
   * @param userId The user ID for memory context
   * @param errorMessage Optional error message if execution failed
   * @returns Boolean indicating success or failure of storage operation
   */
  private async storeToolExecution(
    tool: string,
    params: Record<string, any>,
    result: ToolExecutionResult | null,
    success: boolean,
    userId: string,
    errorMessage?: string
  ): Promise<boolean> {
    try {
      await this.memory.store({
        userId,
        type: MemoryType.TOOL_USAGE,
        content: {
          tool,
          params,
          result: result ? result.data : null,
          success,
          errorMessage
        },
        metadata: {
          sessionId: this.sessionId,
          timestamp: new Date().toISOString()
        }
      });
      return true;
    } catch (error) {
      this.logger.error('Failed to store tool execution', { 
        error: error instanceof Error ? error.message : String(error),
        userId,
        sessionId: this.sessionId,
        tool
      });
      return false;
    }
  }

  /**
   * Parse the LLM response into a reasoning step
   * @param llmResponse The raw response from the LLM
   * @returns Parsed reasoning step or null if parsing failed
   */
  private parseReasoningStep(llmResponse: string): ReasoningStep | null {
    try {
      // First try to parse as JSON
      try {
        const parsed = JSON.parse(llmResponse);
        
        // Validate required fields
        if (parsed.stepId) {
          // Add timestamp if missing
          if (!parsed.timestamp) {
            parsed.timestamp = new Date().toISOString();
          }
          // Ensure isComplete field
          if (parsed.isComplete === undefined) {
            parsed.isComplete = false;
          }
          return parsed as ReasoningStep;
        }
      } catch (e) {
        // Not valid JSON, continue to text parsing
      }
      
      // Fall back to basic text parsing
      const lines = llmResponse.split('\n');
      const typeMatch = llmResponse.match(/^(THOUGHT|ACTION|FINAL_ANSWER):/i);
      
      if (typeMatch) {
        const type = typeMatch[1].toLowerCase();
        const stepId = `${type}_${Date.now()}`;
        
        if (type === 'thought') {
          return {
            stepId,
            thought: {
              reasoning: llmResponse.replace(/^THOUGHT:/i, '').trim(),
              plan: ''
            },
            isComplete: false,
            timestamp: new Date().toISOString()
          };
        } else if (type === 'action') {
          // Try to extract tool and params
          const toolMatch = llmResponse.match(/ACTION:\s*([a-zA-Z0-9_]+)/i);
          if (!toolMatch) return null;
          
          // Extract parameters
          const paramsMatch = llmResponse.match(/\{[\s\S]*\}/);
          let params: Record<string, unknown> = {};
          if (paramsMatch) {
            try {
              params = JSON.parse(paramsMatch[0]);
            } catch (e) {
              // If JSON parsing fails, try to extract key-value pairs
              const paramRegex = /([a-zA-Z0-9_]+):\s*([^\n,]+)/g;
              let match;
              while ((match = paramRegex.exec(llmResponse)) !== null) {
                if (match[1] && match[2]) {
                  params[match[1].trim()] = match[2].trim();
                }
              }
            }
          }
          
          return {
            stepId,
            action: {
              tool: toolMatch[1].trim(),
              params
            },
            isComplete: false,
            timestamp: new Date().toISOString()
          };
        } else if (type === 'final_answer') {
          return {
            stepId,
            conclusion: {
              final_answer: llmResponse.replace(/^FINAL_ANSWER:/i, '').trim()
            },
            isComplete: true,
            timestamp: new Date().toISOString()
          };
        }
      }
      
      // Could not parse, return null
      return null;
    } catch (error) {
      this.logger.error('Error parsing reasoning step', { 
        error: error instanceof Error ? error.message : String(error),
        response: llmResponse
      });
      return null;
    }
  }

  /**
   * Get the tool registry from the tool manager
   * This method handles compatibility with different tool manager implementations
   */
  private async getToolRegistry(): Promise<Record<string, (input: any) => Promise<any>>> {
    // Create a registry mapping tool names to execution functions
    const toolRegistry: Record<string, (input: any) => Promise<any>> = {};
    
    try {
      // Get available tools
      const tools = await this.toolManager.getAvailableTools();
      
      // Create execution functions for each tool
      tools.forEach((tool: any) => {
        toolRegistry[tool.name] = async (input: any) => {
          try {
            // Execute the tool directly via the tool manager
            const result = await this.toolManager.executeTool(tool.name, input);
            return result;
          } catch (error) {
            this.logger.error(`Failed to execute tool ${tool.name}`, { 
              error: error instanceof Error ? error.message : String(error),
              input
            });
            throw error;
          }
        };
      });
      
      return toolRegistry;
    } catch (error) {
      this.logger.error('Failed to get available tools', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      // Return empty registry in case of error
      return toolRegistry;
    }
  }

  /**
   * Format tool result into a structured, LLM-friendly observation
   * Handles different result types, truncates long content, and adds context
   * 
   * @param result The raw tool execution result
   * @param action The original action that produced this result
   * @param maxLength Maximum length to allow before truncating (default 2000 chars)
   * @returns Formatted observation text
   */
  private formatToolResult(
    result: ToolExecutionResult, 
    action: ReasoningStep['action'],
    maxLength: number = 2000
  ): string {
    if (!action || !result) {
      return 'No result or action information available';
    }

    const toolName = action.tool;
    const rawData = result.data;
    let formattedResult: string;
    
    try {
      // Format based on data type
      if (typeof rawData === 'string') {
        formattedResult = rawData;
      } else if (rawData === null || rawData === undefined) {
        formattedResult = 'No data returned from tool';
      } else if (Array.isArray(rawData)) {
        // For arrays, create a more readable listing
        if (rawData.length === 0) {
          formattedResult = 'Empty list result []';
        } else if (typeof rawData[0] === 'object' && rawData[0] !== null) {
          // Array of objects - create a summarized view
          formattedResult = `List with ${rawData.length} items:\n` + 
            rawData.slice(0, 5).map((item, i) => 
              `${i+1}. ${JSON.stringify(item, null, 1).replace(/\n\s*/g, ' ')}`
            ).join('\n');
          
          if (rawData.length > 5) {
            formattedResult += `\n...and ${rawData.length - 5} more items`;
          }
        } else {
          // Simple array - show directly
          formattedResult = `[${rawData.slice(0, 10).join(', ')}${rawData.length > 10 ? '...' : ''}]`;
        }
      } else if (typeof rawData === 'object') {
        // For objects, pretty-print with custom handling
        if (Object.keys(rawData).length === 0) {
          formattedResult = 'Empty object result {}';
        } else {
          formattedResult = JSON.stringify(rawData, null, 2);
        }
      } else {
        // For other types, convert to string
        formattedResult = String(rawData);
      }
      
      // Truncate if too long
      if (formattedResult.length > maxLength) {
        const halfLength = Math.floor(maxLength / 2) - 50;
        formattedResult = 
          formattedResult.substring(0, halfLength) +
          `\n...[Result truncated (${formattedResult.length} chars total)]...\n` +
          formattedResult.substring(formattedResult.length - halfLength);
      }
      
      // Add context about the tool execution
      return `Result from ${toolName}:\n${formattedResult}`;
      
    } catch (error) {
      this.logger.error('Error formatting tool result', {
        toolName,
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Fallback to basic formatting
      return `Result from ${toolName} (format error): ${
        typeof rawData === 'string' ? rawData : JSON.stringify(rawData)
      }`;
    }
  }
}