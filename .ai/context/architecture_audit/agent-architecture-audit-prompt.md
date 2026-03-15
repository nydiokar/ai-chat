# Agent Architecture Audit Prompt

> Hand this entire document to your coding agent along with your agent's codebase.
> It will force the agent to do a structured audit against the ideal architecture.

---

## Context for the Reviewing Agent

You are reviewing an agent codebase that was built some time ago and abandoned due to architectural issues. The builder has since identified that several critical layers were missing or broken. Your job is to:

1. Read the entire codebase first — every file, every module
2. Map what exists to the layer architecture defined below
3. For each layer, answer the diagnostic questions honestly
4. Produce a gap analysis and a concrete remediation plan

Do NOT start suggesting fixes until you have completed the full audit. Do NOT be optimistic — if something is missing, say it's missing.

---

## The 9 Layers of Agent Architecture

For each layer below, you must: identify where it lives in the codebase (file, function, class), assess its current state (missing / broken / partial / solid), and answer every diagnostic question.

---

### Layer 1: Cognitive Loop (ReAct / Act-Observe-Reflect Cycle)

**What it is:** The core loop that makes the system an agent. Input → Reason → Act → Observe → Reason again → Act again → ... → Decide to stop. Without this, you have a chatbot.

**The two valid patterns:**
- **ReAct** — interleave reasoning ("Thought") and action ("Action") with observation ("Observation") in a single loop
- **Chain-of-Thought + Tool Use** — let the LLM produce reasoning and tool calls together, feed results back

**Diagnostic questions:**
- [ ] Does the loop exist? Where is it? (file/function)
- [ ] What controls termination? Does the LLM decide when it's done, or is there a hardcoded step limit?
- [ ] If there's a step limit: what happens when the agent finishes in fewer steps? Does it keep running uselessly, or does it exit early?
- [ ] Is the loop synchronous or async? Can tool calls happen in parallel when they're independent?
- [ ] What is the exact message format being sent to the LLM at each iteration? Is it accumulating the full history, or just the latest observation?

**Known issue from the builder:** The agent had a fixed 8-12 step limit and did NOT exit early when the task was already complete. This is the most critical fix — the LLM must be able to signal "I'm done" and the loop must respect that signal.

**What "done right" looks like:** The loop runs until the LLM explicitly signals completion (e.g., a special token, a tool call like `task_complete`, or a response with no tool calls). There is a maximum step limit as a safety net, but the agent almost never hits it.

---

### Layer 2: Planning / Task Decomposition

**What it is:** Before or at the start of execution, the agent breaks a complex task into subtasks. This can be explicit (the agent writes out a plan) or implicit (the agent's first reasoning step naturally decomposes the problem).

**Diagnostic questions:**
- [ ] Does the agent produce an explicit plan before acting? Where?
- [ ] Can the plan be revised mid-execution if new information changes the approach?
- [ ] Is the plan stored somewhere the agent can reference it, or is it lost after the first step?
- [ ] For simple tasks, does the agent skip planning (good) or still go through a heavy planning phase (wasteful)?

**What "done right" looks like:** The system prompt or first-step prompt asks the agent to think about what steps are needed. The plan is kept in working memory. When the agent observes something unexpected, it can revise the plan. Simple tasks get minimal or no planning overhead.

---

### Layer 3: Working Memory / Scratchpad

**What it is:** The running context the agent maintains during a single task. This is NOT long-term memory across sessions — it's "what do I know right now about this task."

**Diagnostic questions:**
- [ ] What gets accumulated in the context as the agent runs? Raw tool outputs? Summaries? Both?
- [ ] Is there any compression or summarization of earlier steps, or does the full raw history get passed every time?
- [ ] Is there a scratchpad or state object that the agent maintains separately from the conversation history?
- [ ] When the context gets long, what happens? Does it get truncated? From the beginning? From the middle?

**What "done right" looks like:** The agent maintains a compressed state that includes: current plan status, key findings so far, what's been tried, and what's left. Raw tool outputs from earlier steps are summarized, not carried verbatim. The most recent 2-3 tool outputs are kept in full. There's an explicit context budget strategy.

---

### Layer 4: Tool Abstraction Layer

**What it is:** The structured interface between the agent and its available actions. This includes tool definitions (schemas), how tools are described to the LLM, and how tool calls are parsed and dispatched.

**Diagnostic questions:**
- [ ] How are tools defined? JSON Schema? Function signatures? Plain text descriptions?
- [ ] Are tool descriptions clear enough that the LLM consistently picks the right tool?
- [ ] Is there input validation before tool execution?
- [ ] How are new tools added? Is there a clean registration pattern or is it hardcoded?
- [ ] Are tools grouped or categorized, or is the full list always presented?
- [ ] For the current number of tools: is the LLM being overwhelmed with too many options?

**What "done right" looks like:** Tools have precise, unambiguous descriptions. Each tool has a clear JSON schema for inputs. There's a registration/plugin pattern. Tool descriptions include examples of when to use and when NOT to use each tool. The agent can discover available tools rather than having all of them hardcoded in every prompt.

---

### Layer 5: Observation Parsing / Grounding

**What it is:** After a tool runs, the raw output needs to be processed before the agent can reason about it. This layer turns raw output into actionable information.

**Diagnostic questions:**
- [ ] What happens when a tool returns 500+ lines of output? Is it truncated? Summarized? Passed raw?
- [ ] Are error messages extracted and highlighted, or buried in raw output?
- [ ] Is there any structured parsing of tool outputs (e.g., extracting specific fields from JSON responses)?
- [ ] Does the agent ever hallucinate about what a tool returned because the output was too long or ambiguous?

**Known issue from the builder:** This layer was missing. Tool outputs were likely passed raw, causing context pollution and hallucinated observations.

**What "done right" looks like:** Each tool type has an output parser. Long outputs are truncated with a note ("showing first 50 lines of 500"). Errors are extracted into a clear format: `ERROR: [type] [message] [relevant context]`. JSON outputs are parsed and only relevant fields are presented. Binary outputs are described, not dumped.

---

### Layer 6: Control Flow / Orchestration

**What it is:** The engineering infrastructure that hosts the cognitive loop. This is the runtime — process management, tool dispatch, timeout handling, state management between steps, API call management.

**Diagnostic questions:**
- [ ] Is there a clean separation between the orchestration logic and the LLM interaction logic?
- [ ] How are API calls to the LLM managed? Retries? Rate limiting? Error handling?
- [ ] What happens when a tool call times out?
- [ ] What happens when the LLM returns an unparseable response (no valid tool call, malformed JSON)?
- [ ] Is the orchestration logic readable and maintainable, or is it a tangled mess of callbacks/promises?
- [ ] Can you add a new step type (e.g., "ask the user for clarification") without rewriting the loop?

**Known issue from the builder:** This layer was likely where complexity exploded, making the project unbearable to work on.

**What "done right" looks like:** The orchestrator is a clean state machine or event loop. Each step is: call LLM → parse response → dispatch action → collect result → format for next iteration. Error handling is centralized, not scattered. Adding a new tool or behavior doesn't require touching the core loop. The whole thing fits in one readable file under 300 lines.

---

### Layer 7: Error Recovery / Self-Correction

**What it is:** The agent's ability to detect that something went wrong and change strategy, not just retry the same thing.

**Diagnostic questions:**
- [ ] When a tool call fails, does the agent retry the exact same call, or does it reason about why it failed?
- [ ] Is there any tracking of "what I've already tried" to prevent loops?
- [ ] Can the agent escalate (ask the user) when it's stuck?
- [ ] Is there a maximum retry count per action?
- [ ] Does the agent distinguish between retriable errors (timeout, rate limit) and fatal errors (file not found, permission denied)?

**Known issue from the builder:** This layer was missing.

**What "done right" looks like:** Failed actions are fed back with clear error context. The agent's prompt includes guidance like "if an approach fails twice, try a different approach." There's a simple retry counter per action. After N failures on the same subtask, the agent either tries an alternative or reports that it's stuck. The agent never enters an infinite retry loop.

---

### Layer 8: Context Window Management

**What it is:** The strategy for what stays in the context window and what gets evicted as the agent runs longer tasks.

**Diagnostic questions:**
- [ ] What is the maximum context length being used?
- [ ] Is there any measurement of current context usage?
- [ ] What happens when the context is about to overflow?
- [ ] Are earlier steps summarized or just dropped?
- [ ] Is the system prompt protected from eviction?
- [ ] For multi-file tasks: is file content kept in context, or read on demand?

**What "done right" looks like:** There's an explicit context budget. The system prompt and current plan are always kept. Recent tool outputs (last 2-3) are kept in full. Older steps are compressed into a summary like "Steps 1-5: explored the codebase, found the relevant file at X, identified the bug as Y." When approaching the limit, the agent is warned and can prioritize what to keep.

---

### Layer 9: Guardrails / Boundary Layer

**What it is:** The safety constraints on what the agent can do. File system access, network access, cost limits, confirmation requirements for destructive actions.

**Diagnostic questions:**
- [ ] Is there a sandbox or are tools running with full system access?
- [ ] Are destructive actions (delete, overwrite, send) gated behind confirmation?
- [ ] Is there a cost limit (API calls, tokens)?
- [ ] Can the agent access the internet? Is that intentional?
- [ ] Is there logging of all actions taken?

**What "done right" looks like:** There's a clear permission model. Destructive actions require confirmation (or are disabled). All tool calls are logged. There's a token/cost budget with a hard cutoff. The agent operates in a sandboxed environment where mistakes are recoverable.

---

## Your Audit Output Format

After reviewing the codebase against all 9 layers, produce:

### 1. Layer Map
A table showing each layer, where it lives in the code (or "MISSING"), and its status (missing / broken / partial / solid).

### 2. Critical Path
The ordered list of fixes from most to least impactful. What should be fixed first to make the agent functional?

### 3. Architecture Proposal
For each missing or broken layer, propose a specific implementation approach. Include:
- What pattern to use
- Where it should live in the codebase
- What the interface looks like
- Estimated complexity (simple / moderate / complex)

### 4. Wiring Diagram
How the layers connect. What calls what. Where data flows. This should be a simple text diagram showing the flow from user input to final output, with each layer labeled.

### 5. Quick Wins
Things that can be fixed in under 30 minutes that will immediately improve the agent's behavior. Start here.

---

## Important Notes

- Do not refactor the entire codebase. Identify the minimum changes to make each layer functional.
- If a layer is partial, extend it — don't rewrite it.
- The cognitive loop termination fix is the single highest priority item.
- The builder attempted both ReAct and Chain-of-Thought. Assess which one fits the current codebase better and commit to one.
- The builder is experienced but was working before coding agents were as capable as they are now. The code may have patterns that were reasonable at the time but are now unnecessary.
