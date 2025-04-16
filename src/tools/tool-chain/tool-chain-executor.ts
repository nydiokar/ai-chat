import { ToolChainConfig, ToolInput } from './tool-chain-config.js';
import { performance } from 'perf_hooks';
import { getLogger } from '../../utils/shared-logger.js';
import type { Logger } from 'winston';

export interface ToolExecutionResult {  
  success: boolean;
  data?: any;
  error?: Error;
  metadata?: {
    executionTime: number;
    toolName: string;
    attempts?: number;
    maxRetries?: number;
  };
}

export interface ExecutionContext {
  [key: string]: any;
}

export class ToolChainExecutor {
  private readonly logger: Logger;

  constructor() {
    this.logger = getLogger('ToolChainExecutor');
  }

  async execute(
    chainConfig: ToolChainConfig, 
    toolRegistry: Record<string, (input: any) => Promise<any>>,
    initialContext: ExecutionContext = {}
  ): Promise<ToolExecutionResult> {
    const startTime = performance.now();
    const executionContext: ExecutionContext = { ...initialContext };
    const chainResults: any[] = [];

    try {
      this.logger.debug('Starting tool chain execution', {
        chainId: chainConfig.id,
        toolCount: chainConfig.tools.length,
        tools: chainConfig.tools.map(t => t.name),
        initialContext
      });

      for (const tool of chainConfig.tools) {
        if (this.shouldAbortChain(chainConfig, executionContext, chainResults)) {
          this.logger.warn('Tool chain aborted', { 
            chainId: chainConfig.id, 
            toolName: tool.name 
          });
          return {
            success: true,
            data: chainResults,
            metadata: {
              executionTime: performance.now() - startTime,
              toolName: 'chain_aborted'
            }
          };
        }

        const inputResult = this.prepareToolInput(tool, executionContext);
        if (!inputResult.success) {
          return {
            success: false,
            error: inputResult.error,
            data: chainResults,
            metadata: {
              executionTime: performance.now() - startTime,
              toolName: tool.name,
              attempts: 1,
              maxRetries: 0
            }
          };
        }

        const toolResult = await this.executeTool(tool, inputResult.params, toolRegistry, chainConfig);
        
        if (!toolResult.success) {
          this.logger.error('Tool execution failed', { 
            chainId: chainConfig.id, 
            toolName: tool.name, 
            error: toolResult.error,
            partialResults: chainResults,
            currentToolResult: toolResult
          });

          return {
            success: false,
            error: toolResult.error,
            data: [...chainResults],  // Create a new array to avoid any reference issues
            metadata: {
              executionTime: performance.now() - startTime,
              toolName: tool.name,
              attempts: toolResult.metadata?.attempts,
              maxRetries: toolResult.metadata?.maxRetries
            }
          };
        }

        // Only add the result if it's successful and has data
        if (toolResult.data !== null && toolResult.data !== undefined) {
          chainResults.push(toolResult.data);
        }

        const mappedKey = chainConfig.resultMapping?.[tool.name];
        if (mappedKey) {
          executionContext[mappedKey] = toolResult.data;
          this.logger.info('Mapped tool result', {
            chainId: chainConfig.id,
            toolName: tool.name,
            mappedKey,
            value: toolResult.data
          });
        }
      }

      return {
        success: true,
        data: chainResults,
        metadata: {
          executionTime: performance.now() - startTime,
          toolName: 'chain_complete'
        }
      };
    } catch (error) {
      this.logger.error('Chain execution error', { 
        chainId: chainConfig.id, 
        error: error instanceof Error ? error.message : String(error) 
      });

      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        data: chainResults,
        metadata: {
          executionTime: performance.now() - startTime,
          toolName: 'chain_error'
        }
      };
    }
  }

  private async executeTool(
    tool: ToolInput,
    inputParams: any,
    toolRegistry: Record<string, (input: any) => Promise<any>>,
    chainConfig: ToolChainConfig
  ): Promise<ToolExecutionResult> {
    const startTime = performance.now();
    const maxRetries = tool.maxRetries || 3;
    const timeoutMs = tool.timeout || 30000;

    this.logger.debug('Starting tool execution', {
      chainId: chainConfig.id,
      toolName: tool.name,
      inputParams,
      maxRetries,
      timeoutMs
    });

    const toolFunction = toolRegistry[tool.name];
    if (!toolFunction) {
      const error = new Error(`Tool '${tool.name}' not found in registry`);
      this.logger.error('Tool not found', {
        chainId: chainConfig.id,
        toolName: tool.name,
        error: error.message
      });
      return {
        success: false,
        error,
        data: null,
        metadata: {
          executionTime: performance.now() - startTime,
          toolName: tool.name,
          attempts: 1,
          maxRetries
        }
      };
    }

    let lastError: Error | undefined;
    let lastResult: any = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        // Create separate promises for tool execution and timeout
        const functionPromise = toolFunction(inputParams);
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`TIMEOUT: Tool execution timeout after ${timeoutMs}ms`));
          }, timeoutMs);
        });

        // Race between function and timeout
        lastResult = await Promise.race([functionPromise, timeoutPromise]);

        // If the promise was rejected, it will be caught in the catch block
        // If it resolved with undefined/null, we throw here
        if (lastResult === undefined || lastResult === null) {
          throw new Error(`Tool ${tool.name} returned no result`);
        }

        // Log successful execution
        this.logger.info('Tool execution succeeded', {
          chainId: chainConfig.id,
          toolName: tool.name,
          attempt,
          executionTime: performance.now() - startTime,
          result: lastResult
        });

        return {
          success: true,
          data: lastResult,
          metadata: {
            executionTime: performance.now() - startTime,
            toolName: tool.name,
            attempts: attempt
          }
        };

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        this.logger.error('Tool execution error', {
          chainId: chainConfig.id,
          toolName: tool.name,
          error: {
            message: lastError.message,
            stack: lastError.stack,
            name: lastError.name
          },
          attempt,
          maxRetries,
          isTimeout: lastError.message.includes('TIMEOUT:'),
          isLastAttempt: attempt === maxRetries + 1,
          inputParams  // Log the input params to help debug
        });

        if (attempt === maxRetries + 1 || lastError.message.includes('TIMEOUT:')) {
          // Ensure we return a proper error result
          return {
            success: false,
            error: lastError,
            data: null,
            metadata: {
              executionTime: performance.now() - startTime,
              toolName: tool.name,
              attempts: attempt,
              maxRetries
            }
          };
        }

        // Add jitter to backoff
        const baseDelay = Math.min(50 * Math.pow(2, attempt - 1), 1000);
        const jitter = Math.random() * 100;  // Add up to 100ms of jitter
        const backoffDelay = baseDelay + jitter;
        
        this.logger.debug('Retrying tool execution', {
          chainId: chainConfig.id,
          toolName: tool.name,
          attempt,
          baseDelay,
          jitter,
          backoffDelay,
          error: lastError.message
        });
        
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }

    // This shouldn't be reached, but if it does, return the last error state
    const finalError = lastError || new Error('Unexpected execution path');
    this.logger.error('Tool execution reached unexpected state', {
      chainId: chainConfig.id,
      toolName: tool.name,
      error: {
        message: finalError.message,
        stack: finalError.stack,
        name: finalError.name
      }
    });
    
    return {
      success: false,
      error: finalError,
      data: null,
      metadata: {
        executionTime: performance.now() - startTime,
        toolName: tool.name,
        attempts: maxRetries + 1,
        maxRetries
      }
    };
  }

  private prepareToolInput(
    tool: ToolInput, 
    context: ExecutionContext
  ): { success: boolean; error?: Error; params?: any } {
    this.logger.debug('Preparing tool input', {
      toolName: tool.name,
      parameters: tool.parameters,
      context
    });

    // Return empty params if parameters is undefined, null, or an empty object
    if (!tool.parameters || typeof tool.parameters !== 'object' || Object.keys(tool.parameters).length === 0) {
      this.logger.debug('No parameters provided, using empty object', {
        toolName: tool.name
      });
      return { success: true, params: {} };
    }

    try {
      const params: Record<string, any> = {};
      for (const [key, value] of Object.entries(tool.parameters)) {
        if (typeof value === 'string' && value.startsWith('$')) {
          const pathSegments = value.slice(1).split('.');
          let contextValue = context[pathSegments[0]];

          if (contextValue === undefined) {
            return {
              success: false,
              error: new Error(`Missing context value for parameter ${key}: ${value}`)
            };
          }

          for (let i = 1; i < pathSegments.length; i++) {
            if (contextValue === undefined) {
              return {
                success: false,
                error: new Error(`Cannot access ${pathSegments[i]} of undefined in path ${value}`)
              };
            }
            contextValue = contextValue[pathSegments[i]];
          }

          params[key] = contextValue;
        } else {
          params[key] = value;
        }
      }

      return { success: true, params };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }

  private shouldAbortChain(
    chainConfig: ToolChainConfig,
    context: ExecutionContext,
    results: any[]
  ): boolean {
    if (!chainConfig.abortConditions?.length) return false;

    return chainConfig.abortConditions.some(condition => {
      if (condition.type === 'error') {
        return results.some(result => !result.success);
      }
      
      if (condition.condition) {
        try {
          return condition.condition(context, results);
        } catch (error) {
          this.logger.error('Abort condition error', { error });
          return false;
        }
      }

      return false;
    });
  }
}

export function createToolRegistry(
  tools: Record<string, (input: any) => Promise<any>>
): Record<string, (input: any) => Promise<any>> {
  return tools;
}
