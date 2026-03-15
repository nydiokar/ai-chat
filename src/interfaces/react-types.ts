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
  ask_user?: {
    question: string;
    reason?: string;
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

export type AgentDecision =
  | {
      type: "tool";
      tool: string;
      params: Record<string, unknown>;
      purpose?: string;
      stepId: string;
    }
  | {
      type: "finish";
      answer: string;
      explanation?: string;
      stepId: string;
    }
  | {
      type: "ask_user";
      question: string;
      reason?: string;
      stepId: string;
    };

export interface CompletionOutcome {
  type: "finish" | "ask_user" | "safety_stop";
  response: string;
  explanation?: string;
  question?: string;
  reason?: string;
  stepId?: string;
}
