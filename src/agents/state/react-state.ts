import { Input } from "../../types/common.js";
import { ThoughtProcess } from "../../interfaces/agent.js";
import { ToolResponse } from "../../tools/mcp/types/tools.js";
import { getLogger } from '../../utils/shared-logger.js';
import { createLogContext } from '../../utils/log-utils.js';
import { handleError } from '../../utils/error-handler.js';

export interface ReActState {
  currentInput: string;
  conversationHistory: Input[];
  thoughtProcess: ThoughtProcess[];
  toolResults: ToolResponse[];
  userId: string;
  iteration: number;
  currentPhase: ReActPhase;
  debugInfo?: DebugInfo;
  error?: ReActError;
}

export interface DebugInfo {
  memories: string[];
  thoughtTrace: ThoughtProcess[];
  toolCalls: {
    tool: string;
    params: any;
    result: any;
    timestamp: string;
  }[];
  errors: ReActError[];
  phaseTransitions: {
    from: ReActPhase;
    to: ReActPhase;
    timestamp: string;
    success: boolean;
  }[];
}

export interface ReActError {
  type: 'TOOL_ERROR' | 'PARSING_ERROR' | 'VALIDATION_ERROR' | 'SYSTEM_ERROR' | 'STATE_ERROR';
  error: string;
  recovery: {
    strategy: 'RETRY' | 'ALTERNATE_TOOL' | 'DIRECT_RESPONSE' | 'RESET_STATE';
    plan: string;
  };
  context?: any;
  timestamp: string;
}

export type ReActPhase = 'REASON' | 'ACT' | 'OBSERVE' | 'THINK' | 'ERROR' | 'COMPLETE';

const VALID_TRANSITIONS: Record<ReActPhase, ReActPhase[]> = {
  'REASON': ['ACT', 'ERROR', 'COMPLETE'],
  'ACT': ['OBSERVE', 'ERROR'],
  'OBSERVE': ['THINK', 'ERROR'],
  'THINK': ['REASON', 'COMPLETE', 'ERROR'],
  'ERROR': ['REASON', 'COMPLETE'],
  'COMPLETE': []
};

export class ReActStateMachine {
  private state: ReActState;
  private readonly maxIterations: number = 5;
  private debugMode: boolean = false;
  private readonly logger = getLogger('ReActStateMachine');
  private previousPhase: ReActPhase | null = null; // Track previous phase for retries

  constructor(initialInput: string, userId: string, history: Input[] = []) {
    this.state = {
      currentInput: initialInput,
      conversationHistory: history,
      thoughtProcess: [],
      toolResults: [],
      userId,
      iteration: 0,
      currentPhase: 'REASON'
    };
    
    this.logger.info('State machine initialized', createLogContext(
      'ReActStateMachine',
      'constructor',
      {
        userId,
        initialPhase: this.state.currentPhase,
        hasHistory: history.length > 0
      }
    ));
  }

  getState(): ReActState {
    return { ...this.state };
  }

  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    if (enabled && !this.state.debugInfo) {
      this.state.debugInfo = {
        memories: [],
        thoughtTrace: [],
        toolCalls: [],
        errors: [],
        phaseTransitions: []
      };
    }
    
    this.logger.debug('Debug mode toggled', createLogContext(
      'ReActStateMachine',
      'setDebugMode',
      { enabled }
    ));
  }

  private canTransitionTo(nextPhase: ReActPhase): boolean {
    const validTransitions = VALID_TRANSITIONS[this.state.currentPhase];
    return validTransitions.includes(nextPhase);
  }

  transitionTo(nextPhase: ReActPhase): void {
    try {
      if (!this.canTransitionTo(nextPhase)) {
        throw new Error(`Invalid state transition from ${this.state.currentPhase} to ${nextPhase}`);
      }

      // Store previous phase for potential retries before updating
      this.previousPhase = this.state.currentPhase;
      
      const prevPhase = this.state.currentPhase;
      this.state.currentPhase = nextPhase;
      
      if (this.debugMode && this.state.debugInfo) {
        this.state.debugInfo.phaseTransitions.push({
          from: prevPhase,
          to: nextPhase,
          timestamp: new Date().toISOString(),
          success: true
        });
      }

      this.logger.info('State transition successful', createLogContext(
        'ReActStateMachine',
        'transitionTo',
        {
          from: prevPhase,
          to: nextPhase,
          iteration: this.state.iteration
        }
      ));
    } catch (error) {
      const stateError: ReActError = {
        type: 'STATE_ERROR',
        error: error instanceof Error ? error.message : 'Unknown state transition error',
        recovery: {
          strategy: 'RESET_STATE',
          plan: 'Reset to initial state and try again'
        },
        timestamp: new Date().toISOString()
      };

      this.handleError(stateError);
      handleError(error);
    }
  }

  handleError(error: ReActError): void {
    this.state.error = error;
    
    // Handle retry strategy if applicable
    if (error.recovery.strategy === 'RETRY' && this.previousPhase) {
      // Log the retry attempt
      this.logger.info('Attempting retry after error', createLogContext(
        'ReActStateMachine',
        'handleError',
        {
          errorType: error.type,
          previousPhase: this.previousPhase,
          recovery: 'RETRY'
        }
      ));
      
      // Return to previous phase for retry
      this.state.currentPhase = this.previousPhase;
      
      if (this.debugMode && this.state.debugInfo) {
        this.state.debugInfo.phaseTransitions.push({
          from: 'ERROR',
          to: this.previousPhase,
          timestamp: new Date().toISOString(),
          success: true
        });
        this.state.debugInfo.errors.push(error);
      }
    } else {
      // For non-retry errors, transition to ERROR state
      this.state.currentPhase = 'ERROR';
      
      if (this.debugMode && this.state.debugInfo) {
        this.state.debugInfo.errors.push(error);
        this.state.debugInfo.phaseTransitions.push({
          from: (this.previousPhase || 'THINK') as ReActPhase,
          to: 'ERROR',
          timestamp: new Date().toISOString(),
          success: false
        });
      }
    }

    this.logger.error('Error in state machine', createLogContext(
      'ReActStateMachine',
      'handleError',
      {
        errorType: error.type,
        error: error.error,
        recovery: error.recovery
      }
    ));
  }

  addThoughtProcess(thought: ThoughtProcess): void {
    this.state.thoughtProcess.push(thought);
    if (this.debugMode && this.state.debugInfo) {
      this.state.debugInfo.thoughtTrace.push(thought);
    }

    this.logger.debug('Thought process added', createLogContext(
      'ReActStateMachine',
      'addThoughtProcess',
      {
        thoughtCount: this.state.thoughtProcess.length,
        hasError: !!thought.error_handling
      }
    ));
  }

  addToolResult(result: ToolResponse, tool: string, params: any): void {
    this.state.toolResults.push(result);
    if (this.debugMode && this.state.debugInfo) {
      this.state.debugInfo.toolCalls.push({
        tool,
        params,
        result,
        timestamp: new Date().toISOString()
      });
    }

    this.logger.debug('Tool result added', createLogContext(
      'ReActStateMachine',
      'addToolResult',
      {
        tool,
        success: result.success,
        hasData: !!result.data
      }
    ));
  }

  addMemory(memory: string): void {
    if (this.debugMode && this.state.debugInfo) {
      this.state.debugInfo.memories.push(memory);
    }

    this.logger.debug('Memory added', createLogContext(
      'ReActStateMachine',
      'addMemory',
      {
        memoryLength: memory.length
      }
    ));
  }

  updateInput(newInput: string): void {
    this.state.currentInput = newInput;
    this.logger.debug('Input updated', createLogContext(
      'ReActStateMachine',
      'updateInput',
      {
        inputLength: newInput.length
      }
    ));
  }

  incrementIteration(): void {
    this.state.iteration++;
    this.logger.debug('Iteration incremented', createLogContext(
      'ReActStateMachine',
      'incrementIteration',
      {
        currentIteration: this.state.iteration,
        maxIterations: this.maxIterations
      }
    ));
  }

  shouldContinue(): boolean {
    // Don't continue if we've hit max iterations
    if (this.state.iteration >= this.maxIterations) {
      this.transitionTo('COMPLETE');
      return false;
    }

    // Don't continue if we're in an error state
    if (this.state.currentPhase === 'ERROR' || this.state.error) {
      return false;
    }

    // Don't continue if we're complete
    if (this.state.currentPhase === 'COMPLETE') {
      return false;
    }

    const lastThought = this.getLastThoughtProcess();

    // Don't continue if we have an error in the thought process
    if (lastThought?.error_handling) {
      this.handleError({
        type: 'VALIDATION_ERROR',
        error: lastThought.error_handling.error,
        recovery: {
          strategy: 'DIRECT_RESPONSE',
          plan: lastThought.error_handling.recovery.alternate_plan,
        },
        timestamp: new Date().toISOString()
      });
      return false;
    }

    // Don't continue if we have a next step that indicates completion
    if (lastThought?.next_step?.plan) {
      const plan = lastThought.next_step.plan.toLowerCase();
      if (plan.includes('finish') || plan.includes('complete')) {
        this.transitionTo('COMPLETE');
        return false;
      }
    }

    // Don't continue if we don't have an action to take
    if (!lastThought?.action?.tool && this.state.currentPhase === 'ACT') {
      this.handleError({
        type: 'VALIDATION_ERROR',
        error: 'No tool action specified in thought process',
        recovery: {
          strategy: 'DIRECT_RESPONSE',
          plan: 'Provide response without tool usage',
        },
        timestamp: new Date().toISOString()
      });
      return false;
    }

    return true;
  }

  getLastThoughtProcess(): ThoughtProcess | null {
    return this.state.thoughtProcess[this.state.thoughtProcess.length - 1] || null;
  }

  getLastToolResult(): ToolResponse | null {
    return this.state.toolResults[this.state.toolResults.length - 1] || null;
  }
} 