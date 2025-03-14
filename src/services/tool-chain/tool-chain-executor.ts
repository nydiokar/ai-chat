import { ToolChainConfig, ToolInput } from './tool-chain-config.js';
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
    toolRegistry: Record<string, (input: any) => Promise<any>>
  ): Promise<ToolExecutionResult> {
    const startTime = performance.now();
    const executionContext: ExecutionContext = {};
    const chainResults: any[] = [];  // Store only successful results

    try {
      for (const tool of chainConfig.tools) {
        // Check abort conditions before executing tool
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

        // Execute tool
        const toolResult = await this.executeTool(tool, executionContext, toolRegistry, chainConfig);
        
        if (!toolResult.success) {
          this.logger.error('Tool execution failed', { 
            chainId: chainConfig.id, 
            toolName: tool.name, 
            error: toolResult.error 
          });
          return {
            success: false,
            error: toolResult.error,
            data: chainResults,
            metadata: {
              executionTime: performance.now() - startTime,
              toolName: tool.name
            }
          };
        }

        // Only add successful results to the chain
        chainResults.push(toolResult.data);

        // Store tool result in execution context if mapping exists
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
    context: ExecutionContext,
    toolRegistry: Record<string, (input: any) => Promise<any>>,
    chainConfig: ToolChainConfig
  ): Promise<ToolExecutionResult> {
    const startTime = performance.now();

    try {
      // Verify tool exists
      const toolFunction = toolRegistry[tool.name];
      if (!toolFunction) {
        throw new Error(`Tool '${tool.name}' not found in registry`);
      }

      // Prepare input parameters
      const inputParams = this.prepareToolInput(tool, context);

      // Execute tool and validate result
      const result = await toolFunction(inputParams);
      
      // Add debug logging
      this.logger.debug('Tool execution result', {
        toolName: tool.name,
        inputParams,
        result
      });

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
        toolName: tool.name,
        error: error instanceof Error ? error.message : String(error)
      });
      
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: {
          executionTime: performance.now() - startTime,
          toolName: tool.name
        }
      };
    }
  }

  private prepareToolInput(
    tool: ToolInput, 
    context: ExecutionContext
  ): any {
    if (!tool.parameters) return {};

    const params: Record<string, any> = {};
    for (const [key, value] of Object.entries(tool.parameters)) {
      if (typeof value === 'string' && value.startsWith('$')) {
        // Parse the path segments (e.g., "$fetchResult.data" -> ["fetchResult", "data"])
        const pathSegments = value.slice(1).split('.');
        let contextValue = context[pathSegments[0]];

        // Navigate through nested properties
        for (let i = 1; i < pathSegments.length; i++) {
          if (contextValue === undefined) {
            throw new Error(`Cannot access ${pathSegments[i]} of undefined in path ${value}`);
          }
          contextValue = contextValue[pathSegments[i]];
        }

        if (contextValue === undefined) {
          throw new Error(`Missing context value for parameter ${key}: ${value}`);
        }

        params[key] = contextValue;
      } else {
        params[key] = value;
      }
    }

    return params;
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
