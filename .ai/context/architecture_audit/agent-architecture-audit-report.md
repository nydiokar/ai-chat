# Agent Architecture Audit Report

Date: 2026-03-15

Scope:
- Audited the agent runtime and the code directly participating in agent behavior.
- Intentionally excluded irrelevant domains like broad `tools/` implementation details except where the runtime directly depends on them.
- Primary files reviewed:
  - `src/agents/react-agent.ts`
  - `src/agents/react-engine.ts`
  - `src/agents/react-step-parser.ts`
  - `src/agents/react-tool-handler.ts`
  - `src/agents/react-trace.ts`
  - `src/agents/planning/tot-planner.ts`
  - `src/agents/planning/plan-artifact.ts`
  - `src/prompt/react-prompt-generator.ts`
  - `src/services/ai-factory.ts`
  - `src/agents/agent-factory.ts`
  - `src/providers/openai.ts`
  - `src/providers/ollama-provider.ts`
  - `src/interfaces/memory-provider.ts`
  - `src/memory/in-memory-provider.ts`

Decision:
- This codebase is fundamentally a ReAct-style agent, not a pure chat-with-tools system.
- The right path is to stabilize and complete the ReAct architecture, not replace it with a different paradigm.

## 1. Layer Map

| Layer | Where it lives | Status | Summary |
|---|---|---|---|
| 1. Cognitive Loop | `src/agents/react-engine.ts` | Partial | The loop exists and can end on conclusion, but completion is not modeled cleanly enough and the loop is still shaped around a fixed max-step regime. |
| 2. Planning / Task Decomposition | `src/agents/planning/tot-planner.ts`, `src/agents/react-engine.ts` | Partial | There is explicit planning, but it is optional, one-shot, and not revisable. |
| 3. Working Memory / Scratchpad | `src/agents/react-trace.ts`, `src/prompt/react-prompt-generator.ts` | Partial | There is step history and compression, but no true scratchpad state for facts, attempts, blockers, and next steps. |
| 4. Tool Abstraction Layer | `src/agents/react-tool-handler.ts`, tool manager integration in engine | Partial | Tools are discoverable and described, but execution policy is split across layers and not unified. |
| 5. Observation Parsing / Grounding | `src/agents/react-tool-handler.ts` | Broken | Tool outputs are formatted, not parsed into grounded observations. |
| 6. Control Flow / Orchestration | `src/agents/react-engine.ts`, `src/services/ai-factory.ts` | Partial | Orchestration is centralized, but the engine is overloaded and mixes too many responsibilities. |
| 7. Error Recovery / Self-Correction | `src/agents/react-engine.ts` | Broken | Errors are surfaced back to the model, but there is no structured retry, alternative strategy, or stuck-state handling. |
| 8. Context Window Management | `src/agents/react-trace.ts`, `src/prompt/react-prompt-generator.ts` | Partial | Some compression exists, but no real context budget manager or explicit eviction policy exists. |
| 9. Guardrails / Boundary Layer | Provider config, runtime logging, tool restrictions in prompt/filtering | Partial | There are some limits and logs, but guardrails are not expressed as a dedicated runtime policy layer. |

## 2. Layer-by-Layer Findings

### Layer 1: Cognitive Loop

Where:
- `src/agents/react-engine.ts`

What exists:
- Main loop in `process(...)`
- Completion check via `trace.isReasoningComplete()`
- Early exit when parsed step contains `conclusion.final_answer`
- Safety limit via `MAX_STEPS`

Status:
- Partial

What is good:
- The loop does exist.
- It does not always burn all steps if the LLM produces a valid conclusion.
- The parser enforces a meaningful `action XOR conclusion` shape.

What is missing:
- Completion is not a first-class orchestration outcome.
- The loop still fundamentally revolves around `MAX_STEPS`, not a rich step result model.
- There is no explicit `finish`, `ask_user`, `repair_format`, or `blocked` step type.
- The LLM can only finish if it emits one specific parseable structure.

Gap:
- This is closer to a constrained loop wrapper than a fully modeled agent execution cycle.

Recommended implementation:
- Introduce an explicit executor outcome model:
  - `tool`
  - `finish`
  - `ask_user`
  - `recover`
- Keep `MAX_STEPS` only as a safety net.

Complexity:
- Moderate

### Layer 2: Planning / Task Decomposition

Where:
- `src/agents/planning/tot-planner.ts`
- `src/agents/planning/plan-artifact.ts`
- `src/agents/react-engine.ts`

What exists:
- Optional ToT planner
- Structured `PlanArtifact`
- Tool budget enforcement via `max_calls`
- Plan summary injection into prompt

Status:
- Partial

What is good:
- There is a real planning artifact, not just prose.
- The selected-tools contract is useful.
- Planning can reduce tool overload.

What is missing:
- No mid-run plan revision.
- No plan state transitions such as `pending`, `in_progress`, `completed`, `blocked`.
- The executor does not truly execute against the plan; it mostly uses the plan for tool filtering and budget hints.
- Planning is env-gated, which makes it non-systemic.

Gap:
- Planning exists as a preamble, not as a persistent execution layer.

Recommended implementation:
- Introduce `ExecutionPlanState` that persists:
  - current subtask
  - completed subtasks
  - blocked subtasks
  - revised rationale
- Allow plan revision after failed observations or contradictions.

Complexity:
- Moderate

### Layer 3: Working Memory / Scratchpad

Where:
- `src/agents/react-trace.ts`
- `src/interfaces/memory-provider.ts`
- `src/memory/in-memory-provider.ts`
- `src/prompt/react-prompt-generator.ts`

What exists:
- Per-session step trace
- Memory persistence for thought process and tool usage
- Compressed prompt rendering of previous steps

Status:
- Partial

What is good:
- There is a trace object.
- Steps are persisted.
- Prior steps can be compressed for prompt reuse.

What is missing:
- No explicit scratchpad state for:
  - key findings
  - attempted approaches
  - failures
  - unresolved questions
  - current objective
- `optimizeSteps()` is still step-list-centric, not state-centric.
- Memory storage is available, but not used as a task-state substrate.

Gap:
- The agent remembers steps, but does not maintain a working model of the task.

Recommended implementation:
- Add `TaskScratchpad` with fields:
  - `goal`
  - `plan_summary`
  - `facts`
  - `attempted_actions`
  - `failures`
  - `open_questions`
  - `next_best_action`
- Rebuild prompts from scratchpad plus recent observations, not from raw step accumulation alone.

Complexity:
- Moderate

### Layer 4: Tool Abstraction Layer

Where:
- `src/agents/react-tool-handler.ts`
- Tool definitions via tool manager and tool schemas
- Prompt tool rendering in `src/prompt/react-prompt-generator.ts`

What exists:
- Tool discovery through tool manager
- Tool formatting and registry generation
- Tool manager execution interface

Status:
- Partial

What is good:
- New tools are not fully hardcoded in prompts.
- The model receives names and descriptions.
- There is an existing registration surface through the tool manager.

What is missing:
- Main loop execution bypasses the richer chain-oriented execution path.
- Validation and execution policy are not clearly separated.
- Tool descriptions are still optimized for listing, not for precise action selection.
- Tool categories are only partially reflected.

Gap:
- Tool abstraction exists, but it is not the single source of truth for tool eligibility, validation, execution, formatting, and observation parsing.

Recommended implementation:
- Create a unified tool dispatch contract:
  - `selectable tools`
  - `validated action`
  - `execution policy`
  - `normalized result`
- Ensure the loop uses one tool execution path only.

Complexity:
- Simple to moderate

### Layer 5: Observation Parsing / Grounding

Where:
- `src/agents/react-tool-handler.ts`

What exists:
- Result formatting
- Basic truncation
- Error result formatting
- Some special formatting for search/code/API-like tools

Status:
- Broken

What is good:
- The system does not dump everything blindly.
- There is at least a result shaping attempt.

What is missing:
- No actual observation parser.
- No normalized representation like:
  - `summary`
  - `salient fields`
  - `errors`
  - `sources`
  - `raw_preview`
- No per-tool parser strategy.
- No explicit extraction of critical fields from JSON or structured outputs.
- No distinction between user-visible data and model-working data.

Gap:
- This is the largest systemic absence after completion semantics.
- The agent reasons over presentation strings, not grounded observations.

Recommended implementation:
- Add `ObservationParser.parse(toolName, rawResult)` returning:
  - `kind`
  - `summary`
  - `important_fields`
  - `error`
  - `source_refs`
  - `truncated`
- Make the trace store parsed observations, not only strings.

Complexity:
- Moderate

### Layer 6: Control Flow / Orchestration

Where:
- `src/agents/react-engine.ts`
- `src/services/ai-factory.ts`
- `src/agents/agent-factory.ts`

What exists:
- Central runtime engine
- Factory wiring
- Prompt generation
- LLM call
- parse -> act -> observe loop

Status:
- Partial

What is good:
- The orchestration is not scattered across the entire codebase.
- Factories are present.
- There is a single runtime center of gravity.

What is missing:
- `react-engine.ts` is too large and mixes:
  - planning
  - prompting
  - tool filtering
  - tool budgeting
  - execution
  - memory storage
  - recovery
  - fallback response logic
- The core runtime is not a clean state machine.
- New step types would require modifying the engine directly.

Gap:
- Complexity is caused less by feature count and more by boundary collapse.

Recommended implementation:
- Split into:
  - `ReActOrchestrator`
  - `StepInterpreter`
  - `ToolDispatcher`
  - `ObservationParser`
  - `RecoveryPolicy`
  - `ContextBudgetManager`

Complexity:
- Moderate

### Layer 7: Error Recovery / Self-Correction

Where:
- `src/agents/react-engine.ts`

What exists:
- Error observations are added back into the trace.
- Some guidance is injected on tool failures.

Status:
- Broken

What is good:
- Errors are not silently swallowed.
- The model is at least informed that something failed.

What is missing:
- No retry counter per subtask or tool call.
- No classification of:
  - transient
  - invalid-input
  - permission
  - unavailable
  - fatal
- No tracking of repeated failed strategies.
- No dedicated stuck behavior.
- No system-level `ask user for clarification` branch.

Gap:
- The agent can fail visibly, but it cannot recover deliberately.

Recommended implementation:
- Add `RecoveryPolicy`:
  - classify error
  - increment failure counts
  - suggest alternate tool or ask-user path
  - stop retry loops

Complexity:
- Moderate

### Layer 8: Context Window Management

Where:
- `src/agents/react-trace.ts`
- `src/prompt/react-prompt-generator.ts`
- provider prompt construction

What exists:
- Step compression
- Truncation heuristics
- Recent-step preservation

Status:
- Partial

What is good:
- There is an awareness of context cost.
- Compression preserves observations better than thoughts.

What is missing:
- No explicit token budget manager.
- No measured budget usage at runtime in the agent loop.
- No guaranteed priority ordering such as:
  - system prompt
  - current task state
  - current plan
  - recent observations
  - older summary
- No robust overflow strategy.

Gap:
- Context management is heuristic formatting, not a runtime subsystem.

Recommended implementation:
- Add `ContextBudgetManager` with explicit slices:
  - immutable instructions
  - scratchpad
  - plan state
  - recent observations
  - compressed history

Complexity:
- Moderate

### Layer 9: Guardrails / Boundary Layer

Where:
- Provider config and retries in `src/providers/openai.ts`
- tool filtering and limits in `src/agents/react-engine.ts`
- logging in factories and runtime

What exists:
- Logging
- Provider retries and timeouts
- Tool list filtering
- Some indirect capability narrowing

Status:
- Partial

What is good:
- There is some runtime boundary behavior.
- Provider-level operational limits exist.

What is missing:
- No explicit execution policy object.
- No first-class destructive action confirmation layer.
- No explicit budget or cost policy enforced by the agent runtime.
- No formal distinction between safe, confirm-required, and forbidden actions.

Gap:
- Guardrails are implicit and scattered.

Recommended implementation:
- Add `ExecutionPolicy` that determines:
  - allowed
  - blocked
  - confirm-required
  - max-cost
  - network/file side effects

Complexity:
- Simple

## 3. Critical Path

Ordered from most impactful to least:

1. Make completion a first-class runtime outcome.
2. Add observation parsing and grounding.
3. Add structured recovery and anti-loop protections.
4. Introduce a real scratchpad state.
5. Refactor the engine into explicit orchestration components.
6. Add token-budgeted context assembly.
7. Formalize execution policy and confirmations.
8. Upgrade planning from one-shot preamble to revisable execution state.

## 4. Architecture Proposal

### Proposed runtime components

1. `src/agents/runtime/react-orchestrator.ts`
- Owns the loop.
- Calls planner, prompt generator, parser, tool dispatcher, observation parser, recovery policy.

2. `src/agents/runtime/task-scratchpad.ts`
- Stores task state.

3. `src/agents/runtime/observation-parser.ts`
- Converts raw tool results into grounded observations.

4. `src/agents/runtime/recovery-policy.ts`
- Decides whether to retry, replan, ask user, or stop.

5. `src/agents/runtime/context-budget-manager.ts`
- Assembles prompt context under explicit budget.

6. `src/agents/runtime/execution-policy.ts`
- Defines allowed vs confirm-required actions.

### Suggested interfaces

```ts
type AgentDecision =
  | { type: "tool"; tool: string; params: Record<string, unknown>; purpose?: string }
  | { type: "finish"; answer: string; explanation?: string }
  | { type: "ask_user"; question: string; reason: string }
  | { type: "recover"; strategy: string; reason: string };

interface ParsedObservation {
  kind: "success" | "error" | "empty" | "partial";
  summary: string;
  importantFields?: Record<string, unknown>;
  sourceRefs?: string[];
  rawPreview?: string;
  truncated?: boolean;
}

interface TaskScratchpad {
  goal: string;
  currentPlan?: string;
  facts: string[];
  attemptedActions: string[];
  failures: string[];
  openQuestions: string[];
  nextBestAction?: string;
}
```

## 5. Wiring Diagram

```text
User Input
  -> ReActAgent
  -> ReActOrchestrator
    -> optional Planner
    -> ContextBudgetManager
    -> PromptGenerator
    -> LLMProvider
    -> StepParser
    -> if tool: ToolDispatcher
      -> ObservationParser
      -> Scratchpad update
      -> RecoveryPolicy
    -> if finish: Final response
    -> if ask_user: Clarification response
```

## 6. Quick Wins

These should be feasible quickly and improve behavior immediately:

1. Add explicit `ask_user` and `finish` step types.
2. Stop using presentation strings as the only observation representation.
3. Track repeated failed actions and block same-call loops.
4. Use one tool execution path in the runtime.
5. Persist a compact scratchpad summary and inject it every step.

## 7. Answer to the Core Question

Is this codebase close to a fully functioning agent in the sense described by the 9-layer architecture?

Answer:
- It is closer than a simple chatbot-with-tools because it already has:
  - a loop
  - parsing
  - tool use
  - plan artifacts
  - step memory
- But it is still materially short of the target architecture because the missing layers are the ones that make an agent robust:
  - grounded observations
  - structured recovery
  - explicit scratchpad state
  - real orchestration boundaries

Practical assessment:
- It has an agent skeleton.
- It does not yet have dependable agency.
- The biggest difference between this and Codex/Claude-Code-like behavior is not model quality alone; it is the missing runtime layers that make action reliable over multiple steps.

## 8. If I Owned This Project

I would not ask for a whole-codebase rewrite.

I would instruct the coding agent to do the following, in order:

1. Extract a small orchestrator from `react-engine.ts` without changing external behavior.
2. Add an observation parser and store structured observations in the trace.
3. Add scratchpad state and rebuild prompts from scratchpad plus recent observations.
4. Add recovery policy and same-failure loop prevention.
5. Add explicit finish and ask-user outcomes.
6. Make planning always available for medium and complex tasks, with mid-run revision.
7. Add runtime evaluation tests for:
   - early completion
   - failure recovery
   - no repeated invalid tool loops
   - long-context compression
   - clarification path

Ultimate goal:
- Move from "LLM emits formatted steps in a loop" to "runtime owns task state, grounded observations, recovery, and completion semantics."

That is the minimum path to real agency.

## 9. Avoid Building a Toy

As this runtime gets optimized and hardened, there is a real risk of building something that looks agentic in demos but is still structurally a toy.

### What a toy agent looks like

A toy agent usually has some of these properties:
- it can complete curated happy paths but degrades quickly on slightly messy tasks
- it depends on prompt wording more than runtime state and contracts
- it stores mostly strings and formatted blobs rather than typed execution state
- it retries failures without understanding them
- it adds more tools faster than it improves tool selection, observation grounding, and recovery
- it passes unit tests but has weak multi-step behavioral guarantees

In short:
- toy behavior means the model is carrying too much of the system
- real agent behavior means the runtime is carrying more of the system

### What to replicate immediately

These are the traits worth copying from stronger coding agents as early as possible:

1. Explicit runtime contracts
- decisions should be typed
- observations should be typed
- failures should be typed
- completion should be typed

2. State over transcript
- maintain task state, not just step history
- preserve facts, attempts, blockers, and next action separately from raw logs

3. One execution path
- tool validation, dispatch, normalization, and storage should happen through one path
- avoid multiple side channels that bypass runtime policy

4. Recovery as a system responsibility
- repeated failures should be classified and tracked
- the runtime should know when to retry, switch strategy, ask the user, or stop

5. Scenario-level evaluation
- test behaviors like clarification, recovery, context pressure, invalid tool loops, and early finish
- do not rely only on parser or formatting tests

### What to avoid

These patterns usually produce local progress but global fragility:

1. Prompt-only fixes for runtime problems
- if the issue is memory, grounding, recovery, or orchestration, prompt tuning is not a durable fix

2. Tool expansion before runtime maturity
- more tools increase branching factor and failure surface
- if observation and recovery layers are weak, more tools usually make the agent worse

3. Raw string coupling
- if important decisions depend on parsing presentation strings, the system is still brittle

4. Demo-driven optimization
- optimizing only for impressive single runs can hide poor repeatability and failure handling

5. Broad rewrites before layer closure
- replacing everything can erase progress and make validation harder
- extend the existing runtime where possible and close systemic gaps one layer at a time

### How to tell what is bottlenecking progress

When a run is poor, determine whether the bottleneck is coming from toy/dev/testing artifacts or from still-missing runtime layers.

#### Signals you are bottlenecked by toy/dev/testing components

Look for these first:
- mocks or stubbed tools behave unlike real tools
- test prompts are too clean and over-constrained
- tool outputs in tests are unrealistically small or uniform
- providers are configured differently in tests than in actual runs
- behavior looks strong in unit tests but unstable in real multi-step sessions
- failures disappear when using canned tool outputs

Interpretation:
- the runtime might be better than the tests suggest, or worse than the tests reveal
- the problem is in evaluation realism, fixture quality, or dev-only shortcuts

#### Signals you are bottlenecked by missing runtime layers

Look for these patterns:
- the model keeps re-trying similar failing actions
- the model cannot tell what a tool result actually means
- the model loses track of what has already been learned
- conclusions are based on vaguely formatted output rather than grounded evidence
- longer runs degrade sharply because prompts are built from history blobs instead of prioritized state
- adding a new tool or step type requires touching too many unrelated places

Interpretation:
- the runtime is still missing architecture, not just polish
- this means you should invest in layer completion, not benchmarking or prompt tuning

### Meaningfulness check before optimization

Before spending time on optimization, ask:

1. Is the runtime making decisions from structured state or from strings?
2. Can the system explain why it retried, switched strategy, asked the user, or stopped?
3. Are we testing multi-step behavior under realistic tool outputs?
4. Would adding one more tool make the agent more reliable, or just more chaotic?
5. Are observed failures caused by mock environments, or by missing runtime machinery?

If the answer to the first two is "no", the system is not ready for serious optimization yet.

### Practical rule of thumb

If a behavior improvement comes mainly from:
- better prompts
- more examples
- narrower demos
- special-cased formatting

then you are at risk of building a toy.

If a behavior improvement comes mainly from:
- stronger runtime contracts
- better state handling
- grounded observations
- explicit recovery
- better evaluation coverage

then you are likely hardening the real agent.
