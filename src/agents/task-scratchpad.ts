import { AgentDecision, GroundedObservation, ReasoningStep } from "../interfaces/react-types.js";

const MAX_FACTS = 12;
const MAX_ATTEMPTS = 10;
const MAX_FAILURES = 8;
const MAX_OPEN_QUESTIONS = 6;
const FACT_SUMMARY_MAX = 180;

export interface ScratchpadState {
  goal: string;
  facts: string[];
  attemptedActions: string[];
  failures: string[];
  openQuestions: string[];
  nextBestAction: string | null;
}

/**
 * Maintains a structured task-state model across the agent run.
 *
 * Updated incrementally after each reasoning step. Produces a compact
 * summary string that can be injected into every prompt so the model
 * always has a current working model of the task — independent of the
 * raw step history.
 */
export class TaskScratchpad {
  private goal: string;
  private readonly facts: string[] = [];
  private readonly attemptedActions: string[] = [];
  private readonly failures: string[] = [];
  private readonly openQuestions: string[] = [];
  private nextBestAction: string | null = null;

  constructor(goal: string) {
    this.goal = goal;
  }

  /** Update the scratchpad from a completed reasoning step. */
  public update(step: ReasoningStep): void {
    // Extract facts from successful observations
    if (step.observation) {
      this.ingestObservation(step.observation);
    }

    // Record the tool that was attempted
    if (step.action?.tool) {
      const entry = step.action.purpose
        ? `${step.action.tool} (${step.action.purpose})`
        : step.action.tool;
      if (!this.attemptedActions.includes(entry)) {
        this.push(this.attemptedActions, entry, MAX_ATTEMPTS);
      }
    }

    // Record ask_user open questions
    if (step.ask_user?.question) {
      this.push(this.openQuestions, step.ask_user.question, MAX_OPEN_QUESTIONS);
    }
  }

  /** Update after the engine interprets a decision (covers finish/ask_user/recover). */
  public applyDecision(decision: AgentDecision): void {
    if (decision.type === "recover") {
      this.nextBestAction = decision.strategy;
    }
    if (decision.type === "ask_user") {
      this.push(this.openQuestions, decision.question, MAX_OPEN_QUESTIONS);
    }
  }

  /** Return a compact multi-line summary for prompt injection. */
  public render(): string {
    const lines: string[] = [`Goal: ${this.goal}`];

    if (this.facts.length > 0) {
      lines.push(`Facts:\n${this.facts.map((f) => `  - ${f}`).join("\n")}`);
    }

    if (this.attemptedActions.length > 0) {
      lines.push(`Tried: ${this.attemptedActions.join(", ")}`);
    }

    if (this.failures.length > 0) {
      lines.push(`Failures:\n${this.failures.map((f) => `  - ${f}`).join("\n")}`);
    }

    if (this.openQuestions.length > 0) {
      lines.push(`Open questions:\n${this.openQuestions.map((q) => `  - ${q}`).join("\n")}`);
    }

    if (this.nextBestAction) {
      lines.push(`Next best action: ${this.nextBestAction}`);
    }

    return lines.join("\n");
  }

  /** Snapshot of current state (for tests and debugging). */
  public getState(): ScratchpadState {
    return {
      goal: this.goal,
      facts: [...this.facts],
      attemptedActions: [...this.attemptedActions],
      failures: [...this.failures],
      openQuestions: [...this.openQuestions],
      nextBestAction: this.nextBestAction,
    };
  }

  private ingestObservation(obs: GroundedObservation): void {
    if (obs.kind === "error") {
      const kind = obs.error?.kind ? ` (${obs.error.kind})` : "";
      const tool = obs.tool ? `${obs.tool}` : "tool";
      this.push(this.failures, `${tool} failed${kind}: ${this.truncate(obs.summary, 120)}`, MAX_FAILURES);
      return;
    }

    if (obs.kind === "empty") {
      const tool = obs.tool ?? "tool";
      this.push(this.failures, `${tool} returned empty result`, MAX_FAILURES);
      return;
    }

    // success / partial — extract a fact from the summary
    const fact = this.truncate(obs.summary, FACT_SUMMARY_MAX);
    if (fact && !this.facts.includes(fact)) {
      this.push(this.facts, fact, MAX_FACTS);
    }

    // Add sources as individual facts if present
    if (obs.sourceRefs && obs.sourceRefs.length > 0) {
      const sourceLine = `Sources: ${obs.sourceRefs.slice(0, 3).join(", ")}`;
      if (!this.facts.includes(sourceLine)) {
        this.push(this.facts, sourceLine, MAX_FACTS);
      }
    }
  }

  private push<T>(arr: T[], item: T, max: number): void {
    if (arr.length >= max) arr.shift();
    arr.push(item);
  }

  private truncate(s: string, max: number): string {
    const normalized = s.replace(/\s+/g, " ").trim();
    return normalized.length > max ? normalized.slice(0, max - 1) + "…" : normalized;
  }
}
