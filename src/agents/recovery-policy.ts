import { GroundedObservation } from "../interfaces/react-types.js";

/**
 * Severity classification for an error kind.
 *
 * - fatal    : no retry; stop or ask_user immediately
 * - retryable: retry the same tool once with the same params
 * - redirect : stop retrying the same tool; try a different approach or ask_user
 */
export type ErrorSeverity = "fatal" | "retryable" | "redirect";

/**
 * The directive returned by RecoveryPolicy after evaluating a failure.
 *
 * - none     : no special action needed (success or unclassified minor issue)
 * - retry    : retry the same tool call (only when within retry budget)
 * - ask_user : surface a focused clarification request to the user
 * - block    : hard stop — the agent should not continue with this strategy
 */
export type RecoveryDirective = "none" | "retry" | "ask_user" | "block";

export interface RecoveryResult {
  directive: RecoveryDirective;
  reason: string;
  /** Human-readable question to surface when directive === "ask_user" */
  question?: string;
}

interface FailureRecord {
  count: number;
  lastErrorKind: string;
  consecutiveCount: number;
}

const MAX_RETRIES_PER_TOOL = 1;
const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_TOTAL_FAILURES_PER_TOOL = 3;

const SEVERITY_MAP: Record<string, ErrorSeverity> = {
  auth_error: "fatal",
  rate_limit: "fatal",
  timeout: "retryable",
  parse_error: "redirect",
  not_found: "redirect",
  empty_result: "redirect",
  unknown: "redirect",
};

export class RecoveryPolicy {
  /** Per-tool failure records for the current run */
  private readonly failures = new Map<string, FailureRecord>();
  /** Number of consecutive observation-level failures across all tools */
  private consecutiveAnyFailures = 0;

  /**
   * Evaluate a grounded observation and return a recovery directive.
   *
   * Call this after every tool error observation. For success observations,
   * pass the observation so the policy can reset consecutive-failure counters.
   */
  public evaluate(
    toolName: string,
    observation: GroundedObservation,
  ): RecoveryResult {
    if (observation.kind !== "error") {
      this.consecutiveAnyFailures = 0;
      // Reset per-tool consecutive counter on success
      const record = this.failures.get(toolName);
      if (record) {
        record.consecutiveCount = 0;
      }
      return { directive: "none", reason: "Observation succeeded." };
    }

    const errorKind = observation.error?.kind ?? "unknown";
    const severity = SEVERITY_MAP[errorKind] ?? "redirect";

    const record = this.failures.get(toolName) ?? {
      count: 0,
      lastErrorKind: errorKind,
      consecutiveCount: 0,
    };
    record.count += 1;
    record.consecutiveCount += 1;
    record.lastErrorKind = errorKind;
    this.failures.set(toolName, record);
    // Virtual tools (__llm__, __loop__) track their own budgets but do not
    // contribute to the cross-tool consecutive counter — mixing infrastructure
    // failures with real tool failures would trigger spurious blocks.
    if (!toolName.startsWith("__")) {
      this.consecutiveAnyFailures += 1;
    }

    // Hard stop: too many consecutive failures across any tool
    if (this.consecutiveAnyFailures >= MAX_CONSECUTIVE_FAILURES) {
      return {
        directive: "block",
        reason: `${MAX_CONSECUTIVE_FAILURES} consecutive failures detected across tools. Stopping to avoid a retry loop.`,
        question:
          "I've encountered repeated failures. Could you clarify the goal or provide additional context so I can try a different approach?",
      };
    }

    // Hard stop: too many total failures for this specific tool
    if (record.count >= MAX_TOTAL_FAILURES_PER_TOOL) {
      return {
        directive: "ask_user",
        reason: `Tool "${toolName}" has failed ${record.count} times (kind: ${errorKind}). Asking the user before retrying further.`,
        question: `The tool "${toolName}" keeps failing (${errorKind}). Could you provide more context or confirm the right approach?`,
      };
    }

    if (severity === "fatal") {
      return {
        directive: "ask_user",
        reason: `Tool "${toolName}" returned a non-retryable error (${errorKind}).`,
        question: `Tool "${toolName}" failed with a ${errorKind.replace("_", " ")} error. Could you check credentials or confirm the intended action?`,
      };
    }

    if (
      severity === "retryable" &&
      record.consecutiveCount <= MAX_RETRIES_PER_TOOL
    ) {
      return {
        directive: "retry",
        reason: `Tool "${toolName}" timed out. Will retry once.`,
      };
    }

    // redirect or exhausted retries
    return {
      directive: "ask_user",
      reason: `Tool "${toolName}" failed with ${errorKind} and retries are exhausted.`,
      question: `I wasn't able to get a result from "${toolName}" (${errorKind}). Could you clarify the request or suggest an alternative approach?`,
    };
  }

  /** How many times a given tool has failed in this run */
  public failureCount(toolName: string): number {
    return this.failures.get(toolName)?.count ?? 0;
  }

  /** Reset all failure state (call between independent user turns) */
  public reset(): void {
    this.failures.clear();
    this.consecutiveAnyFailures = 0;
  }
}
