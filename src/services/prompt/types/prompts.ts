export enum PromptType {
  BEHAVIORAL = 'behavioral',
  TOOL_USAGE = 'tool_usage',
  REASONING = 'reasoning'
}

export interface BasePrompt {
  type: PromptType;
  content: string;
  priority: number; // Higher number = higher priority
  shouldApply: (context: PromptContext) => boolean;
}

export interface BehavioralPrompt extends BasePrompt {
  type: PromptType.BEHAVIORAL;
  tone: 'professional' | 'friendly' | 'technical';
  style: {
    formatting: 'concise' | 'detailed';
    language: 'formal' | 'casual';
  };
}

export interface ToolUsagePrompt extends BasePrompt {
  type: PromptType.TOOL_USAGE;
  tools: string[]; // Tool names this prompt applies to
  usagePatterns: {
    bestPractices: string[];
    commonErrors: string[];
  };
}

export interface ReasoningPrompt extends BasePrompt {
  type: PromptType.REASONING;
  complexity: 'basic' | 'advanced';
  approaches: string[]; // Different problem-solving approaches
}

export interface PromptContext {
  requestType?: 'tool_usage' | 'reasoning' | 'general';
  tools?: string[]; // Tools being used in the request
  complexity?: 'low' | 'medium' | 'high';
  userPreferences?: {
    tone?: BehavioralPrompt['tone'];
    formatting?: BehavioralPrompt['style']['formatting'];
  };
}

// Type guard to check if a prompt matches a specific type
export function isPromptType<T extends BasePrompt>(
  prompt: BasePrompt,
  type: PromptType
): prompt is T {
  return prompt.type === type;
}
