# Agent Testing Strategy

**Status**: active  
**Last Updated**: 2026-03-16 UTC

## Goal

Prove that the current agent can perform the minimum production-worthy behaviors on realistic tasks using the actual runtime path, and identify exactly where it fails before more feature work continues.

This is not about having "eval infrastructure" for its own sake.

The question we are answering is:

**Does the agent actually work on core real tasks, and if not, which subsystem is failing?**

## Core Behaviors To Prove

The agent must reliably perform these basic moves:

1. Understand the task correctly.
2. Decide whether to answer directly, use a tool, ask the user, or recover.
3. Choose an appropriate tool when current or external information is required.
4. Send usable tool arguments.
5. Interpret tool output correctly.
6. Recover from tool failure or switch strategy when needed.
7. Stop cleanly without looping.
8. Produce a grounded final answer.

## Three-Layer Testing Strategy

### Layer 1: Tool Contract Probes

**Purpose**: verify that each critical real tool path works on its own.

**Uses**:
- real tool implementation
- real schemas
- real execution environment
- no agent loop

**What this isolates**:
- broken tool schemas
- invalid tool arguments
- auth/config failures
- flaky output shape
- timeout or transport failures
- formatter/parser mismatches

**Output**:
- pass/fail per tool probe
- structured error classification
- captured raw output sample

### Layer 2: Agent Loop Scenarios

**Purpose**: verify that the real model and real agent runtime can do the core moves with concern separation.

**Uses**:
- real model
- real `ReActEngine`
- real `ReActPromptGenerator`
- real tool manager path
- controlled scenario selection

**Rules**:
- no fake hand-written answer scripts
- no canned "live" search results embedded in test files
- stable grading with deterministic assertions wherever possible

**What this isolates**:
- wrong tool choice
- bad sequencing
- failure to ask user
- failure to recover
- anti-loop failures
- weak or ungrounded conclusions

### Layer 3: End-to-End Task Runs

**Purpose**: verify that the actual product works on realistic tasks.

**Uses**:
- real model
- real runtime path
- real tools
- real external variability

**What this proves**:
- whether the product is actually usable

This is the deciding layer for green-lighting further feature work.

## Required Scenario Categories

The initial gate should stay small and brutal. Target 8 to 12 must-pass scenarios.

Required categories:

1. Direct answer without tools.
2. Current-information retrieval with tool use and grounded answer.
3. Multi-step research across more than one action.
4. Clarification request on ambiguous input.
5. Tool failure followed by recovery or alternate path.
6. Unavailable or blocked tool followed by adaptation.
7. Insufficient evidence leading to cautious non-hallucinated output.
8. Anti-loop / bounded completion behavior.

## Grading Rules

Avoid manual eyeballing by default.

Each scenario should declare:
- required behaviors
- forbidden behaviors
- expected tools or allowed tools
- tool-call limits
- expected answer facts
- required source presence when relevant

Failures must be classified into a stable taxonomy:
- `wrong_tool`
- `bad_tool_args`
- `tool_execution_failure`
- `bad_result_interpretation`
- `missing_grounding`
- `unnecessary_tool_use`
- `failed_to_ask_user`
- `failed_recovery`
- `loop_or_no_stop`
- `weak_final_answer`

## What Must Be Removed

The current fake "live eval" layer should not remain the source of confidence.

Remove or replace the following because they simulate reality instead of testing it:

- `src/tests/evals/live/live-scenarios.ts`
- `src/tests/evals/live/live-eval-harness.ts`
- `src/tests/evals/live/live-evals.test.ts`

The current mock-driven scenario harness should no longer be treated as proof that the agent works in reality:

- `src/tests/evals/agent-evals.test.ts`
- `src/tests/evals/eval-harness.ts`
- `src/tests/evals/eval-types.ts`
- `src/tests/evals/scenarios/*`
- `src/tests/evals/mocks/*`

These files can either be deleted or moved out of the primary testing path. The key rule is that they must not remain positioned as the main validation story for agent readiness.

## Build Order

1. Remove the fake live-scenario layer.
2. Build a shared real-runner that captures full structured traces.
3. Add tool probes for the critical real tools first.
4. Add the small agent-loop scenario suite with deterministic grading.
5. Add the end-to-end task gate.
6. Use this gate before continuing broader feature work.

## Green-Light Standard

Further runtime expansion should wait until:

1. Critical tool probes pass.
2. Core agent-loop scenarios pass.
3. End-to-end realistic tasks pass.
4. Failures are classified clearly enough to know what to fix next.

If the gate does not pass, the next task is runtime hardening, not feature expansion.
