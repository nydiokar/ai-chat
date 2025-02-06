import { z } from 'zod';

// Define schemas for tool chain configuration
export const ToolInputSchema = z.object({
  name: z.string(),
  parameters: z.record(z.any()).optional(),
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

  constructor(name: string) {
    this.config.name = name;
    this.config.id = crypto.randomUUID();
    this.config.tools = [];
  }

  addTool(tool: ToolInput): this {
    this.config.tools?.push(tool);
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

  build(): ToolChainConfig {
    return ToolChainConfigSchema.parse(this.config);
  }
}
