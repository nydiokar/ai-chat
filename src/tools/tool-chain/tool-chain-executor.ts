import { ToolChainConfig, ToolInput } from './tool-chain-config';
import { performance } from 'perf_hooks';
import winston from 'winston';

export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: Error;
  metadata?: {
    executionTime: number;
    toolName: string;
  };
}

export interface ExecutionContext {
  [key: string]: any;
}

export class ToolChainExecutor {
  private logger: winston.Logger;

  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({ filename: 'tool-chain-executor.log' }),
        new winston.transports.Console()
      ]
    });
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
            metadata: {
              executionTime: performance.now() - startTime,
              toolName: tool.name
            }
          };
        }

        const toolResult = await this.executeTool(tool, inputResult.params, toolRegistry, chainConfig);
        
        if (!toolResult.success) {
          this.logger.error('Tool execution failed', { 
            chainId: chainConfig.id, 
            toolName: tool.name, 
            error: toolResult.error 
          });
          return {
            success: false,
            error: toolResult.error,
            data: chainResults, // Include the results from successful tools
            metadata: {
              executionTime: performance.now() - startTime,
              toolName: tool.name
            }
          };
        }

        chainResults.push(toolResult.data);

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

    const toolFunction = toolRegistry[tool.name];
    if (!toolFunction) {
      return {
        success: false,
        error: new Error(`Tool '${tool.name}' not found in registry`),
        metadata: {
          executionTime: performance.now() - startTime,
          toolName: tool.name
        }
      };
    }

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
        const result = await Promise.race([functionPromise, timeoutPromise]);

        if (result === undefined || result === null) {
          throw new Error(`Tool ${tool.name} returned no result`);
        }

        return {
          success: true,
          data: result,
          metadata: {
            executionTime: performance.now() - startTime,
            toolName: tool.name
          }
        };

      } catch (error) {
        this.logger.error('Tool execution error', {
          chainId: chainConfig.id,
          toolName: tool.name,
          error: error instanceof Error ? error.message : String(error),
          attempt
        });

        if (attempt === maxRetries + 1 || (error instanceof Error && error.message.includes('TIMEOUT:'))) {
          return {
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
            metadata: {
              executionTime: performance.now() - startTime,
              toolName: tool.name
            }
          };
        }

        await new Promise(resolve => setTimeout(resolve, Math.min(50 * Math.pow(2, attempt - 1), 1000)));
      }
    }

    // This shouldn't be reached
    throw new Error('Unexpected execution path');
  }

  private prepareToolInput(
    tool: ToolInput, 
    context: ExecutionContext
  ): { success: boolean; error?: Error; params?: any } {
    if (!tool.parameters) {
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
