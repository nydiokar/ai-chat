export interface ReasoningStep {
    stepId: string;
    thought?: {
      reasoning: string;
      plan: string;
    };
    action?: {
      tool: string;
      purpose?: string;
      params: Record<string, unknown>;
    };
    observation?: {
      result: string;
    };
    conclusion?: {
      final_answer: string;
      explanation?: string;
    };
    error_handling?: {
      error: string;
      recovery: {
        log_error: string;
        alternate_plan: string;
        discord_message?: {
          content: string;
          ephemeral: boolean;
        };
      };
    };
    isComplete: boolean;
    timestamp: string;
  }