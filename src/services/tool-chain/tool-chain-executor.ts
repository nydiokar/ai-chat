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
    const executionContext: Record<string, any> = {};
    const chainResults: ToolExecutionResult[] = [];

    try {
      for (const tool of chainConfig.tools) {
        // Prepare input parameters
        const inputParams = this.prepareToolInput(tool, executionContext);

        // Check abort conditions before executing tool
        if (this.shouldAbortChain(chainConfig, executionContext, chainResults)) {
          this.logger.warn('Tool chain aborted', { 
            chainId: chainConfig.id, 
            toolName: tool.name 
          });
          break;
        }

        // Execute tool
        const toolResult = await this.executeTool(tool, inputParams, toolRegistry);

        // Store tool result in execution context
        if (chainConfig.resultMapping && chainConfig.resultMapping[tool.name]) {
          executionContext[chainConfig.resultMapping[tool.name]] = toolResult.data;
        }

        // Add to chain results
        chainResults.push(toolResult);

        // Handle tool execution result
        if (!toolResult.success) {
          this.logger.error('Tool execution failed', { 
            chainId: chainConfig.id, 
            toolName: tool.name, 
            error: toolResult.error 
          });
          return {
            success: false,
            error: toolResult.error,
            metadata: {
              executionTime: performance.now() - startTime,
              toolName: tool.name
            }
          };
        }
      }

      // Final chain execution result
      return {
        success: true,
        data: chainResults.map(result => result.data),
        metadata: {
          executionTime: performance.now() - startTime,
          toolName: 'chain_complete'
        }
      };
    } catch (error) {
      this.logger.error('Unexpected error in tool chain execution', { 
        chainId: chainConfig.id, 
        error: error instanceof Error ? error.message : String(error) 
      });

      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: {
          executionTime: performance.now() - startTime,
          toolName: 'chain_error'
        }
      };
    }
  }

  private prepareToolInput(
    tool: ToolInput, 
    executionContext: Record<string, any>
  ): any {
    // Dynamic input preparation
    if (!tool.parameters) return {};

    return Object.entries(tool.parameters).reduce((acc, [key, value]) => {
      // If value is a string referencing a previous tool's result
      if (typeof value === 'string' && value.startsWith('$')) {
        const contextKey = value.slice(1);
        acc[key] = executionContext[contextKey];
      } else {
        acc[key] = value;
      }
      return acc;
    }, {} as Record<string, any>);
  }

  private shouldAbortChain(
    chainConfig: ToolChainConfig, 
    executionContext: Record<string, any>,
    chainResults: ToolExecutionResult[]
  ): boolean {
    // No abort conditions defined
    if (!chainConfig.abortConditions?.length) return false;

    return chainConfig.abortConditions.some(abortCondition => {
      switch (abortCondition.type) {
        case 'error':
          // Abort if any previous tool had an error
          return chainResults.some(result => !result.success);
        
        case 'result':
          // Custom result-based abort condition
          return abortCondition.condition 
            ? abortCondition.condition(executionContext, chainResults) 
            : false;
        
        case 'custom':
          // Most flexible abort condition
          return abortCondition.condition 
            ? abortCondition.condition(executionContext, chainResults) 
            : false;
        
        default:
          return false;
      }
    });
  }

  private async executeTool(
    tool: ToolInput, 
    inputParams: any,
    toolRegistry: Record<string, (input: any) => Promise<any>>
  ): Promise<ToolExecutionResult> {
    const startTime = performance.now();

    try {
      // Retrieve tool from registry
      const toolFunction = toolRegistry[tool.name];
      if (!toolFunction) {
        throw new Error(`Tool '${tool.name}' not found in registry`);
      }

      // Execute tool
      const result = await toolFunction(inputParams);

      return {
        success: true,
        data: result,
        metadata: {
          executionTime: performance.now() - startTime,
          toolName: tool.name
        }
      };
    } catch (error) {
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
}

// Utility for creating a tool registry
export function createToolRegistry(
  tools: Record<string, (input: any) => Promise<any>>
): Record<string, (input: any) => Promise<any>> {
  return tools;
}
