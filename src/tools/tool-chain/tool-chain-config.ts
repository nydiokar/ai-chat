import { z } from 'zod';

// Define schemas for tool chain configuration
export const ToolInputSchema = z.object({
  name: z.string(),
  parameters: z.record(z.any()).optional(),
  maxRetries: z.number().optional().default(3),
  timeout: z.number().optional().default(30000),
  dependsOn: z.union([z.string(), z.array(z.string())]).optional(),
});

export const ChainAbortConditionSchema = z.object({
  type: z.enum(['error', 'result', 'custom']),
  condition: z.function()
    .optional(),
});

export const ToolChainConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  tools: z.array(ToolInputSchema),
  abortConditions: z.array(ChainAbortConditionSchema).optional(),
  resultMapping: z.record(z.string()).optional(),
});

export type ToolInput = z.infer<typeof ToolInputSchema>;
export type ChainAbortCondition = z.infer<typeof ChainAbortConditionSchema>;
export type ToolChainConfig = z.infer<typeof ToolChainConfigSchema>;

// Utility for creating tool chain configurations
export class ToolChainConfigBuilder {
  private config: Partial<ToolChainConfig> = {};
  private dependencies: Map<string, string[]> = new Map();

  constructor(name: string) {
    this.config = {
      name,
      id: crypto.randomUUID(),
      tools: [],
    };
  }

  addTool(tool: Partial<ToolInput> & { name: string }): this {
    const toolConfig = {
      name: tool.name,
      parameters: tool.parameters || {},
      maxRetries: tool.maxRetries || 3,
      timeout: tool.timeout || 30000,
      dependsOn: tool.dependsOn,
    };

    this.config.tools?.push(toolConfig);

    // Handle dependencies
    if (tool.dependsOn) {
      const deps = Array.isArray(tool.dependsOn) ? tool.dependsOn : [tool.dependsOn];
      this.dependencies.set(tool.name, deps);
    }

    return this;
  }

  addAbortCondition(condition: ChainAbortCondition): this {
    if (!this.config.abortConditions) {
      this.config.abortConditions = [];
    }
    this.config.abortConditions.push(condition);
    return this;
  }

  setResultMapping(mapping: Record<string, string>): this {
    this.config.resultMapping = mapping;
    return this;
  }

  setDescription(description: string): this {
    this.config.description = description;
    return this;
  }

  private validateDependencies(): void {
    const toolNames = new Set(this.config.tools?.map(t => t.name));
    
    // Check for circular dependencies
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (toolName: string): boolean => {
      if (recursionStack.has(toolName)) return true;
      if (visited.has(toolName)) return false;

      visited.add(toolName);
      recursionStack.add(toolName);

      const deps = this.dependencies.get(toolName) || [];
      for (const dep of deps) {
        if (hasCycle(dep)) return true;
      }

      recursionStack.delete(toolName);
      return false;
    };

    // Validate dependencies exist and check for cycles
    for (const [toolName, deps] of this.dependencies) {
      for (const dep of deps) {
        if (!toolNames.has(dep)) {
          throw new Error(`Tool ${toolName} depends on non-existent tool ${dep}`);
        }
      }
      if (hasCycle(toolName)) {
        throw new Error(`Circular dependency detected in tool chain involving ${toolName}`);
      }
    }
  }

  build(): ToolChainConfig {
    this.validateDependencies();
    return ToolChainConfigSchema.parse(this.config);
  }
}
