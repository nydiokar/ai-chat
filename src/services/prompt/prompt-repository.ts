import { 
  BasePrompt, 
  BehavioralPrompt, 
  ToolUsagePrompt, 
  ReasoningPrompt,
  PromptType,
  PromptContext
} from "../../types/prompts.js";

// Default fallback prompts for each category
export const defaultPrompts: Record<PromptType, BasePrompt> = {
  [PromptType.BEHAVIORAL]: {
    type: PromptType.BEHAVIORAL,
    content: `Maintain a professional and clear communication style.
- Use concise language
- Provide structured responses
- Stay focused on the task
- Be direct but courteous`,
    priority: 1,
    tone: 'professional',
    style: {
      formatting: 'concise',
      language: 'formal'
    },
    shouldApply: () => true // Behavioral prompt always applies as a base
  } as BehavioralPrompt,

  [PromptType.TOOL_USAGE]: {
    type: PromptType.TOOL_USAGE,
    content: `When using tools:
1. Always explain your intention before using a tool
2. Use the exact tool name as specified
3. Verify input parameters match the schema
4. Handle errors gracefully
5. Report results clearly`,
    priority: 2,
    tools: ['*'], // Applies to all tools
    usagePatterns: {
      bestPractices: [
        'Verify tool availability before use',
        'Use specific tools over general ones',
        'Include error handling in your approach'
      ],
      commonErrors: [
        'Using incorrect parameter formats',
        'Missing required parameters',
        'Not handling errors'
      ]
    },
    shouldApply: (context: PromptContext) => 
      context.requestType === 'tool_usage' || (context.tools?.length ?? 0) > 0
  } as ToolUsagePrompt,

  [PromptType.REASONING]: {
    type: PromptType.REASONING,
    content: `Problem-solving approach:
1. Analyze the problem thoroughly
2. Break down complex issues into smaller parts
3. Consider multiple approaches
4. Validate assumptions
5. Explain your reasoning process`,
    priority: 3,
    complexity: 'basic',
    approaches: [
      'Step-by-step analysis',
      'Problem decomposition',
      'Solution validation'
    ],
    shouldApply: (context: PromptContext) =>
      context.requestType === 'reasoning' || 
      (context.complexity && ['medium', 'high'].includes(context.complexity))
  } as ReasoningPrompt
};

export class PromptRepository {
  private customPrompts: Map<PromptType, BasePrompt[]> = new Map();

  constructor() {
    // Initialize with default prompts
    Object.values(PromptType).forEach(type => {
      this.customPrompts.set(type, [defaultPrompts[type]]);
    });
  }

  /**
   * Validate prompt properties
   */
  private validatePrompt(prompt: BasePrompt): void {
    if (!prompt.type || !Object.values(PromptType).includes(prompt.type)) {
      throw new Error(`Invalid prompt type: ${prompt.type}`);
    }
    if (!prompt.content?.trim()) {
      throw new Error('Prompt content must be a non-empty string');
    }
    if (typeof prompt.priority !== 'number' || prompt.priority < 0) {
      throw new Error('Prompt priority must be a positive number');
    }
    if (typeof prompt.shouldApply !== 'function') {
      throw new Error('Prompt must have a shouldApply function');
    }
  }

  /**
   * Add a custom prompt for a specific type with validation
   * @param prompt The prompt to add
   */
  addPrompt(prompt: BasePrompt): void {
    try {
      this.validatePrompt(prompt);
      const existing = this.customPrompts.get(prompt.type) ?? [];
      this.customPrompts.set(prompt.type, [...existing, prompt]);
    } catch (error) {
      console.error('[PromptRepository] Failed to add prompt:', error);
      throw error;
    }
  }

  /**
   * Get all prompts that should apply based on the context
   * @param context The current prompt context
   * @returns Array of applicable prompts sorted by priority
   */
  getApplicablePrompts(context: PromptContext): BasePrompt[] {
    try {
      const allPrompts: BasePrompt[] = [];

      this.customPrompts.forEach(prompts => {
        prompts.forEach(prompt => {
          try {
            if (prompt.shouldApply(context)) {
              allPrompts.push(prompt);
            }
          } catch (error) {
            console.warn(`[PromptRepository] Error applying prompt filter:`, error);
          }
        });
      });

      // Sort by priority (higher numbers first)
      return allPrompts.sort((a, b) => b.priority - a.priority);
    } catch (error) {
      console.error('[PromptRepository] Error getting applicable prompts:', error);
      // Return default behavioral prompt as fallback
      return [defaultPrompts[PromptType.BEHAVIORAL]];
    }
  }

  /**
   * Get the fallback prompt for a specific type
   * @param type The prompt type
   * @returns The default fallback prompt
   */
  getFallbackPrompt(type: PromptType): BasePrompt {
    try {
      if (!Object.values(PromptType).includes(type)) {
        throw new Error(`Invalid prompt type: ${type}`);
      }
      return defaultPrompts[type];
    } catch (error) {
      console.error('[PromptRepository] Error getting fallback prompt:', error);
      // Always have a safe fallback
      return defaultPrompts[PromptType.BEHAVIORAL];
    }
  }
}
