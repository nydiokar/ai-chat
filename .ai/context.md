# Current State

**Project**: Kanebra
**Primary Goal**: Evolve the current ReAct-based runtime into a dependable general-purpose agent with complete systemic layers.
**Status**: Architecture remediation in progress
**Last Updated**: 2026-03-15 UTC
**Source of Truth**:
- [Architecture Audit Report](/C:/Users/solastic/prj/ai-chat/.ai/context/architecture_audit/agent-architecture-audit-report.md)
- [Audit Prompt](/C:/Users/solastic/prj/ai-chat/.ai/context/architecture_audit/agent-architecture-audit-prompt.md)

---

## Mission

The current codebase already has an agent skeleton:
- ReAct loop
- parser
- tool usage
- optional planning
- trace/memory

But it does **not** yet have dependable agency because the missing layers are systemic:
- grounded observation parsing
- structured recovery
- true scratchpad state
- cleaner orchestration boundaries
- explicit context budget management
- first-class completion and clarification semantics

The work from now on should be driven by the 9-layer architecture, not by adding more tools or more prompt tweaks.

---

## Canonical Direction

We are committing to:
- **ReAct as the core execution model**
- **Structured planning as a supporting layer**
- **Tool use through a unified dispatch contract**
- **Task-state-driven prompting instead of raw-history-driven prompting**

We are **not** trying to:
- rewrite the whole codebase
- optimize irrelevant subsystems first
- expand tool/plugin breadth before the runtime layers are complete

---

## Layer Status

### Layer 1: Cognitive Loop
- Status: `partial`
- Current location: `src/agents/react-engine.ts`
- Problem:
  - loop exists, but completion is not modeled as a first-class runtime outcome
  - still shaped too heavily by fixed max-step behavior
- Target:
  - explicit decision types: `tool`, `finish`, `ask_user`, `recover`

### Layer 2: Planning / Task Decomposition
- Status: `partial`
- Current location: `src/agents/planning/tot-planner.ts`
- Problem:
  - planning exists but is one-shot, optional, and not revisable
- Target:
  - persistent execution plan state with revision support

### Layer 3: Working Memory / Scratchpad
- Status: `partial`
- Current location: `src/agents/react-trace.ts`, prompt assembly
- Problem:
  - step history exists, but there is no explicit task scratchpad
- Target:
  - scratchpad with goal, facts, attempts, failures, open questions, next action

### Layer 4: Tool Abstraction Layer
- Status: `partial`
- Current location: `src/agents/react-tool-handler.ts`, tool manager integration
- Problem:
  - tool abstraction exists, but execution/validation/policy are split
- Target:
  - one dispatch path with validation, execution policy, and normalized results

### Layer 5: Observation Parsing / Grounding
- Status: `broken`
- Current location: `src/agents/react-tool-handler.ts`
- Problem:
  - tool outputs are formatted, not parsed into grounded observations
- Target:
  - structured observation parser with summaries, salient fields, errors, and sources

### Layer 6: Control Flow / Orchestration
- Status: `partial`
- Current location: `src/agents/react-engine.ts`
- Problem:
  - engine mixes planning, prompting, execution, memory, recovery, and fallbacks
- Target:
  - small orchestrator plus explicit helper layers

### Layer 7: Error Recovery / Self-Correction
- Status: `broken`
- Current location: `src/agents/react-engine.ts`
- Problem:
  - no structured retry policy, no stuck-state handling, no ask-user branch
- Target:
  - recovery policy with retry classification and anti-loop behavior

### Layer 8: Context Window Management
- Status: `partial`
- Current location: `src/agents/react-trace.ts`, `src/prompt/react-prompt-generator.ts`
- Problem:
  - compression exists, but there is no true context budget subsystem
- Target:
  - token-budgeted context assembly with fixed priority slices

### Layer 9: Guardrails / Boundary Layer
- Status: `partial`
- Current location: provider config, runtime filtering, logging
- Problem:
  - guardrails are implicit and scattered
- Target:
  - explicit execution policy for allowed, confirm-required, and blocked actions

---

## Current Priorities

These are ordered by impact on real agency.

1. **Completion semantics**
   - Status: `complete`
   - Explicit `finish`, `ask_user`, and `recover` runtime outcomes are now modeled in parser/trace/engine internals.
   - Completion notes:
     - the loop now routes through explicit runtime decisions instead of conclusion-only termination
     - `MAX_STEPS` remains only as a safety-stop outcome
     - deeper recovery policy work belongs to priority 3 (`Recovery behavior`), not completion semantics itself
   - Keep max steps only as a safety net.

2. **Observation grounding**
   - Introduce a real observation parser.
   - Stop reasoning over presentation strings alone.

3. **Recovery behavior**
   - Add retry classification and repeated-failure blocking.
   - Add `ask_user` path when the agent is blocked.

4. **Scratchpad**
   - Introduce task-state memory separate from raw step history.

5. **Orchestrator extraction**
   - Shrink `react-engine.ts` into clear runtime components.

6. **Context budget**
   - Build prompt context from budgeted slices, not just compressed history.

7. **Planning revision**
   - Turn planning into persistent execution state, not a one-time prelude.

8. **Guardrail formalization**
   - Add execution policy object and confirmation paths.

---

## Active Implementation Plan

### Phase 1: Runtime Boundary Cleanup
- Goal:
  - isolate orchestration responsibilities without changing outward behavior too much
- Deliverables:
  - `ReActOrchestrator`
  - explicit step/decision result model
  - simplified `react-engine.ts` responsibilities
- Success condition:
  - the core runtime flow is readable and extendable

### Phase 2: Observation Grounding
- Goal:
  - replace formatted tool blobs with structured observations
- Deliverables:
  - `ObservationParser`
  - parsed observation model in trace/state
  - structured error extraction
- Success condition:
  - the LLM reasons over normalized observations, not raw formatter output

### Phase 3: Scratchpad and Recovery
- Goal:
  - make the agent stateful and self-correcting
- Deliverables:
  - `TaskScratchpad`
  - `RecoveryPolicy`
  - repeated-failure tracking
  - `ask_user` branch
- Success condition:
  - the agent avoids retry loops and can surface focused clarification requests

### Phase 4: Context and Planning Upgrade
- Goal:
  - make longer runs stable
- Deliverables:
  - `ContextBudgetManager`
  - persistent plan state with revision
- Success condition:
  - prompts are assembled from priority state slices under explicit budget

### Phase 5: Guardrails and Evaluation
- Goal:
  - make the runtime safer and verifiable
- Deliverables:
  - `ExecutionPolicy`
  - scenario tests for finish, recovery, clarification, and context pressure
- Success condition:
  - runtime behavior is constrained and regression-tested

---

## Immediate Next Actions

When continuing work, default to these steps:

1. Extract orchestration responsibilities from `src/agents/react-engine.ts`.
2. Introduce explicit runtime decision types.
3. Add a dedicated observation parser.
4. Add scratchpad state and wire prompt generation to it.
5. Add recovery policy and same-failure loop protection.

Do **not** prioritize:
- plugin marketplace expansion
- broad tool catalog work
- cosmetic prompt tuning
- unrelated task-system work

unless the runtime architecture work above is blocked.

---

## Working Rules

### Scope discipline
- Focus on the agent runtime path first:
  - `src/agents/**`
  - `src/prompt/**`
  - `src/providers/**`
  - `src/interfaces/memory-provider.ts`
  - `src/memory/**`
  - relevant factory wiring
- Ignore irrelevant directories unless directly required.

### Implementation discipline
- Extend partial layers instead of rewriting everything.
- Prefer explicit runtime contracts over prompt-only fixes.
- Treat prompt changes as supporting work, not the main architecture.

### Documentation discipline
- Update this file when:
  - a phase starts
  - a phase completes
  - priorities change
  - a major architectural decision is made
- Keep this file concise and execution-oriented.

---

## Progress Log

### 2026-03-15
- Completed a scoped 9-layer architecture audit of the actual agent runtime.
- Confirmed the codebase should remain ReAct-centered.
- Identified the main systemic gaps:
  - Layer 5 observation parsing missing
  - Layer 7 recovery missing
  - Layer 3 scratchpad missing
  - Layer 6 orchestration overloaded
- Established the critical path:
  - completion semantics
  - observation grounding
  - recovery
  - scratchpad
  - orchestrator cleanup
- Implemented the first completion-semantics slice:
  - added explicit `ask_user` step support alongside `action` and `conclusion`
  - introduced internal `AgentDecision` and `CompletionOutcome` runtime contracts
  - updated `ReActTrace` to persist structured completion outcomes instead of only a final string
  - updated the ReAct prompt to instruct the model when to use `ask_user`
  - updated the engine to terminate on explicit clarification requests while preserving the existing string response API
- Extended completion semantics:
  - added explicit `recover` runtime decision support to the parser, prompt contract, and engine loop
  - added focused `ReActEngine` tests covering `finish`, `ask_user`, and `recover -> finish`
- Fixed validation scope for runtime work:
  - identified `.mocharc.cjs` global `spec` configuration as the reason ad hoc Mocha runs expanded into the full suite
  - added `npm run test:agent-runtime` using `--no-config` so runtime-only checks stay scoped to agent runtime tests
  - updated the local refactor test helper and pre-push check to use the isolated runtime test command
- Validation status:
  - `npm run typecheck` passes
  - `npm run test:agent-runtime` passes and stays scoped to the intended runtime test files
- Next recommended slice:
  - begin Layer 5 by replacing string-only observations with a parsed observation model
  - store grounded observations in the trace while preserving `observation.result` compatibility for existing prompt code
- Advanced Layer 5 observation grounding in the runtime path:
  - added explicit `GroundedObservation` runtime typing in `src/interfaces/react-types.ts`
  - introduced `ObservationParser` in `src/agents/observation-parser.ts` to normalize tool outputs into:
    - `kind`
    - `summary`
    - `importantFields`
    - `sourceRefs`
    - `rawPreview`
    - `error`
    - backward-compatible `result`
  - updated `ReActToolHandler` to parse tool success/error outputs into grounded observations instead of only formatting presentation strings
  - kept backward compatibility by preserving `observation.result` as the prompt-facing text field while enriching observation steps with structured metadata
  - wired grounded observations through `ReActEngine` so parsed observations are what enter the trace after tool execution
  - updated fallback response generation to use grounded observation summaries and sources rather than only raw observation blobs
  - updated `ReActTrace` topic extraction to consider grounded observation summaries and source refs
  - updated `ReActPromptGenerator` step rendering to handle grounded observations while preserving current prompt behavior
- Added focused validation for observation grounding:
  - added `src/tests/react-observation-parser.test.ts`
  - extended tool-handler tests to cover grounded success/error parsing
  - extended engine tests to assert structured observations are passed into the next prompt cycle
  - added the new parser test file to `npm run test:agent-runtime`
- Validation status after observation-grounding slice:
  - `npm run typecheck` passes
  - `npm run test:agent-runtime` passes
- Current status of priority 2 (`Observation grounding`):
  - moved from `broken` to `partial`
  - the runtime now stores grounded observations, but per-tool parser specialization and stricter distinction between model-working data vs user-visible renderings are still open
- Completed per-tool/parser heuristics for higher-fidelity source extraction and error classification:
  - added `errorKind` field to `GroundedObservation.error` in `src/interfaces/react-types.ts`: `not_found | timeout | auth_error | rate_limit | parse_error | empty_result | unknown`
  - added `classifyError()` in `ObservationParser` — matches error messages against ordered regex patterns to assign a structured kind
  - added per-tool structured source extraction in `extractSourceRefs()`: for search-shaped tools with array results, extracts canonical `url`/`link`/`href` etc. fields directly per item; falls back to generic regex for other tool shapes
  - updated `parseToolError` to include classified `errorKind` in the returned observation
  - added tests: structured source extraction and error kind classification (53 passing)
- Validation status after per-tool heuristics slice:
  - `npm run typecheck` passes
  - `npm run test:agent-runtime` passes (53 tests, 0 failures)
- Current status of priority 2 (`Observation grounding`):
  - substantially complete for runtime core
  - remaining open: per-tool summary specialization — low priority vs starting priority 3
- Next recommended slice:
  - begin priority 3 (`Recovery behavior`): use `observation.error.kind` to classify failure severity and drive structured retry/ask_user/block decisions in the engine

---

## Definition of Success

We consider the runtime architecture substantially improved when:
- the agent can finish early through explicit runtime semantics
- the agent can ask for clarification when blocked
- tool outputs are parsed into grounded observations
- the agent maintains a task scratchpad
- repeated failed strategies are detected and stopped
- context assembly is budget-aware
- the orchestration flow is clean enough to extend without re-breaking the system

That is the path from "agent-shaped code" to "dependable agency."
