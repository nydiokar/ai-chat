# Kanebra Prompt Architecture Map

**Generated**: 2025-11-25
**Purpose**: Complete mapping of all prompts for optimization work

---

## Executive Summary

The Kanebra codebase has a **sophisticated multi-layered prompt system**:

- ✅ **3 main prompt generators** (ReActPromptGenerator, PromptRepository, ToTPlanner)
- ✅ **5 prompt consumption points** (OpenAI, Ollama, ReActEngine, ReActAgent, OllamaBridge)
- ✅ **5+ prompt types** (System/Identity, ReAct Reasoning, Tool Usage, ToT Planning, Follow-up)
- ⚠️ **ToT planning documented but not fully integrated**

---

## 1. PROMPT GENERATORS (Where Prompts are Created)

### 1.1 ReActPromptGenerator 🎯 PRIMARY
**Location**: `src/prompt/react-prompt-generator.ts`

**4 Main Prompt Types**:

#### A. Default Identity Prompt
- **Lines**: 24-30
- **Purpose**: Base system prompt for simple interactions
- **Used by**: `generateSimplePrompt()`, `generatePrompt()`
- **Content**: "You are an intelligent AI assistant with access to external tools..."

#### B. ReAct Reasoning Prompt ⭐ CORE
- **Lines**: 51-88
- **Priority**: 10
- **Format**: YAML structured (thought → action → conclusion)
- **Used by**: `generateReActPrompt()` when NOT after tool execution
- **Content**: Detailed reasoning instructions with examples

#### C. Follow-Up/Post-Tool Prompt
- **Lines**: 91-135
- **Priority**: 10
- **Applied**: After tool execution to decide next steps
- **Content**: "Analyze the tool results and decide on next steps..."

#### D. Dynamic Context Additions
All prompts get enhanced with:
- **Date/time info** (Lines 178-193) - Current date, time, year, month, day
- **Tool descriptions** (Lines 196-200, 344-347) - Formatted via ToolFormatter
- **Conversation history** (Lines 203-208) - Previous interactions
- **Reasoning steps** (Lines 350-352, 645-678) - Previous ReAct steps
- **Step guidance** (Lines 355-369, 687-709) - Context-aware guidance based on iteration

**Key Methods**:
1. `generatePrompt()` - General prompt with tools/history
2. `generateSimplePrompt()` - Identity + date/time only
3. `generateReActPrompt()` ⭐ - Full ReAct with reasoning steps
4. `generateFollowUpPrompt()` - Post-tool execution
5. `estimateStepTokens()` - Token estimation (~4 chars/token)
6. `optimizeSteps()` - Context window optimization (keep first + last 2 + downsample middle)

---

### 1.2 PromptRepository
**Location**: `src/services/prompt/prompt-repository.ts`

**Purpose**: Repository pattern for dynamic prompt selection

**3 Default Prompts** (Lines 11-73):

| Type | Priority | Applies When | Content |
|------|----------|--------------|---------|
| BEHAVIORAL | 1 | Always | Professional communication style guidelines |
| TOOL_USAGE | 2 | When tools available | Tool usage instructions, parameter validation |
| REASONING | 3 | Medium/high complexity | Problem-solving approach, structured thinking |

**Selection Logic**:
- Based on `PromptContext`: `{requestType, complexity, afterToolExecution, tools}`
- Request types: "tool_usage" \| "reasoning" \| "general" \| "react"
- Complexity: "low" \| "medium" \| "high"
- Prompts sorted by priority (descending)

---

### 1.3 ToTPlanner ⚠️ PARTIALLY IMPLEMENTED
**Location**: `src/agents/planning/tot-planner.ts`

**3-Stage Planning Process**:

| Stage | Lines | Purpose | Output Format | Method |
|-------|-------|---------|---------------|--------|
| 1. Decomposition | 99-125 | Break query into sub-problems | YAML | `stage1Decompose()` |
| 2. Reflection | 128-157 | Validate and refine plan | YAML | `stage2Reflect()` |
| 3. Tool Selection | 160-198 | Extract exact tool list | JSON | `stage3ExtractTools()` |

**Status**:
- ✅ Basic implementation exists
- ⚠️ Comprehensive 655-line documentation at `.ai/context/tot-refactoring/04-PROMPTS.md`
- ⚠️ Full prompts documented but not fully integrated
- ✅ Feature flag: `ENABLE_TOT_PLANNING` (default: false)

**Reference Documentation**:
- Full prompt templates
- Examples and test cases
- Troubleshooting guidelines
- Model-specific considerations

---

### 1.4 PromptMiddleware
**Location**: `src/services/prompt/prompt-middleware.ts`

**Purpose**: Analyzes requests and selects prompts from repository

**Key Functions**:
- `analyzeRequestType()` - Classifies request type
- `analyzeComplexity()` - Determines complexity level
- `processRequest()` - Generates combined prompt
- `combinePrompts()` - Merges multiple prompts into sections

**Pattern Recognition**:
- Tool patterns: `/\[(Calling tool|Using tool|Execute tool|Run tool)\s+(\w+)\s*]/i`
- Reasoning patterns: `/how|why|explain|analyze|compare|evaluate|solve/i`

---

## 2. PROMPT CONSUMPTION POINTS (Where Prompts are Used)

### 2.1 OpenAI Provider
**Location**: `src/providers/openai.ts`

**Flow**:
1. `setSystemPrompt(prompt)` - Stores in `this.systemPrompt` (Lines 328-330)
2. `generateResponse()` - Prepends to messages array (Lines 138-144)
3. Sent as `{role: "system", content: prompt}` to OpenAI API

---

### 2.2 Ollama Provider
**Location**: `src/providers/ollama-provider.ts` + `src/providers/utils/ollama_helpers/ollama-bridge.ts`

**Flow**:
1. `setSystemPrompt(prompt)` - Stores in provider (Lines 75-77)
2. **OllamaBridge** has its own `ReActPromptGenerator` instance (bridge.ts Line 29)
3. `convertToOllamaRequest()` - Generates prompt via bridge's generator (Lines 117-136)
4. Prepends system message if not present
5. Sent to Ollama API

**Note**: OllamaBridge uses container's pre-initialized MCP clients (architecture fix from recent work)

---

### 2.3 ReActEngine ⭐ ORCHESTRATOR
**Location**: `src/agents/react-engine.ts`

**Main Prompt Method**: `generateContextualPrompt()` (Lines 483-523)
- Calls `promptGenerator.generateReActPrompt()` if available
- Fallback to `generatePrompt()` for basic generation
- Includes: userMessage, steps, tools, currentStep

**ReAct Loop Flow** (Lines 179-228):
1. Optimize steps for context window
2. **Generate contextual prompt** ← Prompt consumption
3. Send to LLM via `getLLMReasoningStep()`
4. Parse response into ReasoningStep
5. Execute tools if action present
6. Add observation step
7. Repeat until conclusion (max 8 iterations)

**ToT Integration** (Lines 160-176):
- If `ENABLE_TOT_PLANNING=true`, runs ToT planning first
- Filters tools based on plan
- Passes filtered tools to prompt generator

---

### 2.4 ReActAgent
**Location**: `src/agents/react-agent.ts`

**Simple Greeting Path** (Lines 121-133):
- Detects simple greetings: "hi", "hello", "hey"
- Uses `getSimplePrompt()` (Lines 162-169)
- Calls LLM directly, bypassing ReAct loop

**Complex Query Path**:
- Delegates to ReActEngine.process()
- Full ReAct reasoning loop with context-aware prompts

---

### 2.5 DiscordService
**Location**: `src/services/discord-service.ts`

**Indirect Consumption**:
- Lines 113-127: Creates agent via AIFactory
- Agent uses prompts internally
- No direct prompt manipulation

---

## 3. PROMPT TYPES & CATEGORIES

### 3.1 System/Identity Prompts
**Purpose**: Define AI behavior and role

**Examples**:
- ReActPromptGenerator.defaultIdentity (Lines 24-30)
- PromptRepository BEHAVIORAL (Lines 12-26)
- Fallback greeting prompt (react-agent.ts Line 169)

**Characteristics**:
- Always applied as base
- Defines communication style
- Sets tool usage expectations

---

### 3.2 ReAct Reasoning Prompts ⭐ CORE
**Purpose**: Guide structured reasoning (Thought-Action-Observation pattern)

**Examples**:
- Main ReAct prompt (react-prompt-generator.ts Lines 51-88)
- Step guidance (Lines 687-709)

**Structure**:
```yaml
thought:
  reasoning: "Analysis of situation"
  plan: "Concrete next steps"
action:
  tool: "tool_name"
  purpose: "Why using this tool"
  params: {key: "value"}
observation:
  result: "Tool output"
conclusion:
  final_answer: "Complete answer"
  explanation: "How I arrived at this"
```

**Characteristics**:
- YAML-formatted output
- Iterative reasoning loop
- Tool integration
- Context-aware guidance based on iteration count

---

### 3.3 Tool Usage Prompts
**Purpose**: Guide proper tool selection and usage

**Examples**:
- PromptRepository TOOL_USAGE (Lines 28-52)
- Follow-up prompt (react-prompt-generator.ts Lines 91-135)
- Tool descriptions via ToolFormatter

**Characteristics**:
- Applied when tools available
- Includes tool descriptions with parameters
- Parameter validation guidance
- Error handling instructions

---

### 3.4 Tree-of-Thought Planning Prompts ⚠️
**Purpose**: Multi-stage planning for complex queries

**Examples**:
- Stage 1: Decomposition (tot-planner.ts Lines 99-125)
- Stage 2: Reflection (Lines 128-157)
- Stage 3: Tool selection (Lines 160-198)
- Full documentation: `.ai/context/tot-refactoring/04-PROMPTS.md` (655 lines)

**Status**: Basic implementation, comprehensive documentation not fully integrated

---

### 3.5 Context/Follow-Up Prompts
**Purpose**: Guide continuation after tool execution

**Examples**:
- `generateFollowUpPrompt()` (react-prompt-generator.ts Lines 391-474)
- Post-observation guidance (react-engine.ts Lines 355-369)

**Characteristics**:
- Include previous tool results
- Decision guidance (continue or conclude)
- Result synthesis instructions

---

## 4. DYNAMIC PROMPT COMPONENTS

### 4.1 Tool Descriptions
**Generator**: ToolFormatter
**Location**: `src/tools/tool-formatter.ts`

**Format** (Lines 25-61):
```
Tool: tool_name
Description: tool description
Parameters:
  - param1 (required): type: description
  - param2 (optional): type: description
Version: 1.0
```

**Used in**: All prompts with available tools

---

### 4.2 Reasoning Steps History
**Generator**: ReActPromptGenerator
**Lines**: 645-678

**Format**:
```
Previous reasoning steps:
Step 1:
THOUGHT: reasoning text
PLAN: plan text
ACTION: Using tool tool_name
Parameters: {...}
OBSERVATION: result text
CONCLUSION: final answer
```

**Used in**: ReAct loop iterations for context continuity

---

### 4.3 Date/Time Context
**Generator**: ReActPromptGenerator
**Lines**: 149-163, 178-193, 287-289, 335-337

**Format**:
```
Current date: Wed Nov 25 2025
Current time: 14:30:45
Current year: 2025
Current month: November
Current day: 25
```

**Applied to**: All prompts

---

### 4.4 Step Guidance (Context-Aware)
**Generator**: ReActPromptGenerator.generateStepGuidance()
**Lines**: 687-709

**Variations by iteration**:
- **Step 0**: "Please start by thinking about the problem..."
- **Step 1-2** (with observation): "Based on the observation above, what is your next step?"
- **Step 3+** (with observation): "You have been reasoning for N steps. Consider whether you have enough information..."
- **With tried tools**: "You have tried these tools: X, Y. Reflect on what you've learned..."

**Purpose**: Guides agent based on reasoning progress

---

## 5. PROMPT FLOW DIAGRAM

```
User Message
    ↓
ReActAgent.processMessage()
    ↓
[Simple greeting?]
    Yes → generateSimplePrompt() → LLM → Response
    No ↓
ReActEngine.process()
    ↓
[ToT Planning enabled?]
    Yes → ToTPlanner.planAndFilter()
         → Stage 1 Prompt (decomposition) → YAML
         → Stage 2 Prompt (reflection) → YAML
         → Stage 3 Prompt (tool selection) → JSON
         → Filtered Tools
    No ↓
ReActEngine Loop (max 8 iterations):
    ↓
generateContextualPrompt()
    ↓
promptGenerator.generateReActPrompt(
    userMessage,
    optimizedSteps,
    tools,
    currentStep
)
    ↓
Assembled Prompt Contains:
    1. Identity/Behavioral instructions
    2. ReAct reasoning format (YAML)
    3. Current date/time
    4. User request
    5. Tool descriptions (formatted)
    6. Previous reasoning steps
    7. Step guidance (context-aware)
    ↓
llmProvider.generateResponse()
    ↓
[Provider: OpenAI or Ollama]
    ↓
Parse Response (ReActStepParser)
    ↓
[Action present?]
    Yes → Execute Tool → Add Observation → Loop
    No ↓
[Conclusion present?]
    Yes → End Loop → Return Response
    No → Continue Loop
```

---

## 6. CONFIGURATION

### Environment Variables (Prompt-Related)

| Variable | Default | Purpose |
|----------|---------|---------|
| `ENABLE_TOT_PLANNING` | false | Enable Tree-of-Thought pre-planning |
| `TOT_PLANNING_TIMEOUT_MS` | 5000 | ToT planning timeout |
| `REACT_VERBOSE_LOGGING` | true | Enable detailed ReAct logging |
| `DISABLE_OPENAI_VERBOSE_LOGS` | true | Disable OpenAI debug logs |
| `MODEL` | "openai" | AI provider selection |
| `OPENAI_MODEL` | "gpt-3.5-turbo-0125" | OpenAI model |
| `OPENAI_TEMPERATURE` | 0.7 | Temperature setting |
| `OLLAMA_MODEL` | "llama3.2:latest" | Ollama model |

**Config Source**: `src/utils/config.ts`

---

## 7. PROMPT OPTIMIZATION & MANAGEMENT

### 7.1 Token Estimation
**Location**: ReActPromptGenerator
- `estimateStepTokens()` (Lines 501-506)
- `estimatePromptTokens()` (Lines 551-574)
- **Calculation**: ~4 chars per token (simplified approximation)
- **Purpose**: Prevent context window overflow

### 7.2 Step Optimization
**Location**: ReActPromptGenerator.optimizeSteps() (Lines 583-638)

**Strategy**:
- Keep first step (context)
- Keep last 2 steps (most recent)
- Downsample middle steps
- **Target**: 80% of max tokens

**Used in**: ReActEngine before generating prompts

### 7.3 Caching
- **OpenAI responses**: CacheService for LLM responses (openai.ts Lines 102-135)
- **Prompts**: ❌ No caching (generated fresh each time)

---

## 8. TESTING & VALIDATION

### Test Files
- `src/prompt/react-prompt-generator.test.ts`
- `src/tests/prompt/react-prompt-generator.test.ts`
- `src/tests/services/prompt/prompt-middleware.test.ts`
- `src/tests/services/prompt/prompt-repository.test.ts`
- `src/tests/tot-integration.test.ts`
- `src/tests/tot-diagnostic.test.ts`

### Prompt Validation
**Parser**: ReActStepParser
**Location**: `src/agents/react-step-parser.ts`

**Validates**:
- YAML format (Lines 25-107)
- JSON format (Lines 111-128)
- Plain text format (Lines 130-189)
- Parameter types (Lines 53-81)

---

## 9. KEY FINDINGS

### ✅ Strengths
1. Well-structured prompt system with clear separation of concerns
2. Context-aware prompt selection via repository pattern
3. Dynamic prompt assembly with optimization
4. Multiple format support (YAML, JSON, text)
5. Step-based guidance adapts to reasoning progress
6. Comprehensive ToT planning documentation

### ⚠️ Areas for Improvement
1. **ToT planning prompts**: Documented but not fully integrated
2. **No prompt versioning**: No A/B testing framework
3. **Token estimation**: Simplified (4 chars/token approximation)
4. **No prompt caching**: Regenerated every time
5. **Limited customization**: Per user/context customization missing

### ❌ Missing Features (from documentation)
1. Prompt metrics tracking (parseSuccessRate, toolValidityRate)
2. A/B testing framework for prompt variants
3. Few-shot learning from past successful reasoning
4. Dynamic prompt adjustment based on query complexity
5. Prompt optimization using LLMs

---

## 10. FILE REFERENCE INDEX

### Core Prompt Files
1. `src/prompt/react-prompt-generator.ts` ⭐ Primary generator
2. `src/services/prompt/prompt-repository.ts` - Repository pattern
3. `src/services/prompt/prompt-middleware.ts` - Request analysis
4. `src/services/prompt/types/prompts.ts` - Type definitions
5. `src/agents/planning/tot-planner.ts` - ToT planning
6. `.ai/context/tot-refactoring/04-PROMPTS.md` - ToT documentation (655 lines)

### Consumption Files
1. `src/providers/openai.ts` - OpenAI provider
2. `src/providers/ollama-provider.ts` - Ollama provider
3. `src/providers/utils/ollama_helpers/ollama-bridge.ts` - Ollama bridge
4. `src/agents/react-engine.ts` ⭐ Main orchestrator
5. `src/agents/react-agent.ts` - High-level interface

### Supporting Files
1. `src/tools/tool-formatter.ts` - Tool description formatting
2. `src/agents/react-step-parser.ts` - Response parsing
3. `src/interfaces/prompt-generator.ts` - Interfaces
4. `src/interfaces/llm-provider.ts` - Interfaces

---

## 11. NEXT STEPS FOR OPTIMIZATION

Based on this map, prompt optimization should focus on:

1. **ReActPromptGenerator** (PRIMARY TARGET)
   - Lines 51-88: Main ReAct reasoning prompt
   - Lines 91-135: Follow-up prompt
   - Lines 687-709: Step guidance

2. **ToT Integration** (SECONDARY)
   - Integrate comprehensive prompts from `04-PROMPTS.md`
   - Enhance 3-stage planning prompts (Lines 99-198)

3. **Examples & Few-Shot Learning**
   - Add successful reasoning chain examples
   - Create task-type-specific variations

4. **Token Optimization**
   - Improve token estimation accuracy
   - Implement prompt caching

5. **Testing & Metrics**
   - Add prompt effectiveness tracking
   - Implement A/B testing framework

---

## 12. ARCHITECTURAL EVALUATION & WASTE ANALYSIS

**Evaluation Date**: 2025-11-25
**Evaluator**: Analysis based on complete codebase mapping

### 12.1 Overall Architecture Assessment

**✅ Fundamentally Sound Patterns:**
1. **Repository Pattern** - Good separation of concerns, allows dynamic selection
2. **Generator vs Consumer separation** - Clean architecture
3. **Context-aware selection** - PromptMiddleware analyzing complexity is smart
4. **Step optimization exists** - ReActPromptGenerator.optimizeSteps() (Lines 583-638)

**❌ Critical Issues Identified:**
1. **No prompt caching** - Regenerating static content every iteration
2. **Content duplication** - Same instructions across multiple prompt types
3. **Wasteful context injection** - Date/time passed regardless of relevance
4. **Verbose formatting** - Step history uses excessive tokens
5. **Identity bloat** - Unnecessary fluff in system prompts

**Verdict**: Structure is good, but implementation has significant waste that compounds across iterations.

---

### 12.2 Token Waste Analysis

#### 🚨 **Issue #1: Date/Time Spam** - BIGGEST WASTE

**Current Implementation:**
```
Current date: Wed Nov 25 2025      ← ~8 tokens
Current time: 14:30:45             ← ~8 tokens
Current year: 2025                 ← ~6 tokens
Current month: November            ← ~6 tokens
Current day: 25                    ← ~5 tokens
----------------------------------------
TOTAL: ~33 tokens PER PROMPT
```

**Locations:**
- `generateSimplePrompt()` - react-prompt-generator.ts Lines 149-166
- `generatePrompt()` - Lines 177-193
- `generateReActPrompt()` - Lines 287-289, 335-337

**Problem:**
- Passed in **every single prompt** regardless of query relevance
- 99% of queries don't need time: "What's Bitcoin price?" doesn't need 14:30:45
- Multiplied across iterations: ~33 tokens × 8 max iterations = **264 tokens wasted per session**

**Solution:**
- ❌ Remove from prompts entirely
- ✅ Create `get_current_datetime` tool (only called when query is time-relevant)
- **Savings**: ~264 tokens per ReAct session (12.5% of typical session)

---

#### 🚨 **Issue #2: Identity Bloat** - "Clown vs Tool Orchestrator"

**Current Identity** (Lines 23-29):
```typescript
defaultIdentity = `You are an intelligent AI assistant with access to external tools to help users. Always respond directly unless a tool would clearly help solve the user's request.

When using tools:
1. Always use tools when they would help complete the user's request
2. You can use multiple tools in sequence if needed
3. Always respond to the user with the results of the tool after using it
4. If a tool fails, try an alternative approach or explain the issue to the user`
```

**Token Cost**: ~85 tokens
**Issues**:
- "intelligent AI assistant" - unnecessary anthropomorphization
- Tool usage instructions - **DUPLICATED in ReAct prompt** (Lines 54-58)
- Vague guidance ("respond directly unless...") - doesn't help decision-making
- Overly friendly tone - agent should be task orchestrator, not conversational assistant

**Optimal Identity**:
```
You are a task orchestrator. Use tools to complete requests efficiently.
```

**Token Cost**: ~12 tokens
**Savings**: ~73 tokens per prompt (86% reduction)

---

#### 🚨 **Issue #3: Prompt Duplication** - Multiple Sources Saying Same Thing

**Evidence of Duplication:**

| Concept | Source 1 | Source 2 | Source 3 |
|---------|----------|----------|----------|
| Tool usage basics | Identity (Lines 25-29) | ReAct prompt (Lines 54-58) | Repository TOOL_USAGE (prompt-repository.ts Lines 28-52) |
| Reasoning approach | ReAct prompt (Lines 54-58) | Repository REASONING (Lines 54-73) | Step guidance (Lines 687-709) |
| Response format | ReAct prompt (Lines 60-77) | Follow-up prompt (Lines 99-135) | - |

**Problem:**
- All three sources are **combined into final prompt**
- Telling the LLM 3 times how to use tools is redundant
- Each duplication adds 30-50 tokens

**Solution:**
- Single source of truth for each concept
- Identity: Just role definition (15 tokens)
- ReAct prompt: Format + reasoning approach (keep as-is, 137 tokens)
- Repository: Remove TOOL_USAGE and REASONING (already in ReAct)
- **Savings**: ~40-80 tokens per prompt

---

#### 🚨 **Issue #4: Step History Verbosity**

**Current Format** (Lines 645-678):
```
Previous reasoning steps:
Step 1:
THOUGHT: Need to search for current Bitcoin price
PLAN: Use brave_web_search to find latest price information
ACTION: Using tool brave_web_search
Parameters: {query: "Bitcoin price today"}
OBSERVATION: Bitcoin is currently trading at $95,234
CONCLUSION: Based on search results, Bitcoin price is $95,234
```

**Token Estimate per Step**: ~80-120 tokens
**With 3 steps**: ~240-360 tokens (17% of typical session)

**Optimized Format**:
```
[1] brave_search(Bitcoin price) → $95,234
[2] calculator(95234*1.1) → $104,757
```

**Token Estimate per Step**: ~20-30 tokens
**With 3 steps**: ~60-90 tokens
**Savings**: 50-75% reduction on step history

**Why This Works:**
- LLM only needs context of what was tried and what resulted
- THOUGHT/PLAN are not needed for context (only current step needs planning)
- Compressed format maintains all necessary information

---

#### 🚨 **Issue #5: NO CACHING** - Critical Performance Issue

**Current Behavior:**
- Every ReAct iteration regenerates the **ENTIRE prompt**
- Static content resent every time:
  - Identity (85 tokens) × 8 iterations = 680 tokens
  - ReAct YAML instructions (137 tokens) × 8 iterations = 1,096 tokens
  - Tool descriptions (~125 tokens) × 8 iterations = 1,000 tokens
  - Date/time (33 tokens) × 8 iterations = 264 tokens

**Total Waste from Re-sending Static Content**: ~3,040 tokens per 8-iteration session

**What Should Be Cached:**

| Component | Changes? | Cache? | Tokens | Rationale |
|-----------|----------|--------|--------|-----------|
| Identity | Never | ✅ YES | 85 | Same role throughout session |
| ReAct format | Never | ✅ YES | 137 | YAML structure doesn't change |
| Tool descriptions | Rarely | ✅ YES | 125 | Tools don't change mid-session |
| Date/time | Never* | ❌ NO (Remove entirely) | 33 | Make it a tool instead |
| Step history | Every iteration | ❌ NO | Varies | Updates every loop |
| User message | Per request | ❌ NO | Varies | Different each session |

**Implementation:**
- Use OpenAI's prompt caching (cache_control parameter)
- Mark identity + ReAct format + tool descriptions as cacheable
- Only send fresh: compressed step history + observation

**Savings with Caching**: ~60% reduction in prompt tokens

---

### 12.3 Token Baseline Estimates

#### **Current System** (Typical 3-step ReAct completion):

```
Per-Iteration Components (sent every loop):
├─ Identity bloat:           85 tokens
├─ Date/time spam:           33 tokens
├─ ReAct YAML instructions: 137 tokens
├─ Tool descriptions (5):    125 tokens
├─ Step history (3 steps):   300 tokens
└─ User message:              20 tokens
──────────────────────────────────────
   TOTAL PER ITERATION:      700 tokens

3-step completion: 700 × 3 = 2,100 tokens
8-step maximum: 700 × 8 = 5,600 tokens
```

**Problem**: Static content (380 tokens) is resent every iteration.

---

#### **Optimized System** (With caching + compression):

```
Cached Components (sent ONCE per session):
├─ Minimal identity:         15 tokens
├─ ReAct format:            137 tokens (keep, it's needed)
└─ Tool descriptions (5):    125 tokens
──────────────────────────────────────
   CACHED SUBTOTAL:         277 tokens ← Sent only on iteration 0

Per-Iteration Components (sent every loop):
├─ Compressed step history:  60 tokens (3 steps @ 20 each)
└─ User message:             20 tokens
──────────────────────────────────────
   FRESH SUBTOTAL:           80 tokens ← Sent every iteration

3-step completion cost:
  = 277 (cached once) + 80×3 (fresh)
  = 277 + 240
  = 517 tokens

──────────────────────────────────────
SAVINGS: 75% reduction (2,100 → 517)
```

**Breakdown by Optimization:**

| Optimization | Tokens Saved | % of Total |
|--------------|--------------|------------|
| Remove date/time | 99 tokens | 4.7% |
| Slim identity | 70 tokens | 3.3% |
| Deduplicate prompts | 60 tokens | 2.9% |
| Compress step history | 180 tokens | 8.6% |
| **Implement caching** | **1,174 tokens** | **55.9%** |
| **TOTAL SAVINGS** | **1,583 tokens** | **75.4%** |

---

### 12.4 Optimal Flow Structure

**Current Flow** (Wasteful):
```
Iteration 0: Send 700 tokens (380 static + 320 dynamic)
Iteration 1: Send 700 tokens (380 static + 320 dynamic) ← 380 tokens wasted
Iteration 2: Send 700 tokens (380 static + 320 dynamic) ← 380 tokens wasted
Total: 2,100 tokens for 3 steps
```

**Optimized Flow** (Efficient):
```
Iteration 0: Send 277 tokens cached + 20 fresh = 297 tokens
Iteration 1: Send 0 cached + 80 fresh = 80 tokens ← Cache hit
Iteration 2: Send 0 cached + 80 fresh = 80 tokens ← Cache hit
Total: 457 tokens for 3 steps (78% savings)
```

**Caching Strategy:**
```
Request Flow:
│
├─ [Simple Greeting?]
│   └─ YES → Minimal prompt (15 tokens, no cache) → Done
│
├─ [Needs Tools?]
│   └─ NO → Minimal prompt + task (50 tokens, no cache) → Done
│
└─ [Complex ReAct Loop]
    │
    ├─ ITERATION 0: Initialize cache + send fresh context
    │   ├─ 🔒 CACHED (277 tokens, stored by LLM provider):
    │   │   ├─ Minimal identity (15 tokens)
    │   │   ├─ ReAct YAML format (137 tokens)
    │   │   └─ Tool descriptions (125 tokens)
    │   └─ 🆕 FRESH (20 tokens):
    │   │   └─ User message
    │   └─ Total: 297 tokens
    │
    ├─ ITERATION 1+: Reuse cache + send only new info
    │   ├─ 🔒 CACHED (0 tokens, retrieved from cache):
    │   │   └─ (Identity + Format + Tools)
    │   └─ 🆕 FRESH (80 tokens):
    │   │   ├─ Compressed previous step (20 tokens)
    │   │   └─ Observation result (60 tokens avg)
    │   └─ Total: 80 tokens per iteration
    │
    └─ ITERATION N: Conclusion
        └─ Final answer with cache reuse
```

**Key Principle**: Don't resend what the LLM already knows in its context window.

---

### 12.5 Composition Analysis - "Separable Elements"

**Current Problem**: Prompts are not properly composed from separable elements.

**Evidence**:
1. **Identity** includes tool usage instructions → Should be separate
2. **ReAct prompt** includes behavioral guidelines → Should be separate
3. **Repository prompts** duplicate ReAct instructions → Should reference, not duplicate
4. **Step guidance** regenerates context → Should build on cached base

**Ideal Composition Model**:

```
Prompt = ComposedFrom(
  BaseElements {
    Role: "You are a task orchestrator"          ← Identity only
    Format: YAML structure definition             ← ReAct only
    ToolCatalog: List of available tools          ← Tool Manager only
  },
  DynamicElements {
    TaskContext: User message + current goal      ← Changes per request
    SessionHistory: Previous steps (compressed)   ← Changes per iteration
    Observation: Latest tool result               ← Changes per tool call
  }
)
```

**Benefits**:
- Each element has single responsibility
- No duplication across layers
- Easy to cache base elements
- Dynamic elements inject fresh context only

**Current Violations**:

| Component | Violation | Lines |
|-----------|-----------|-------|
| defaultIdentity | Includes tool usage instructions | 23-29 |
| ReAct prompt (repository) | Includes behavioral guidance | 52-77 |
| TOOL_USAGE prompt | Duplicates tool instructions | prompt-repository.ts 28-52 |
| generateReActPrompt | Regenerates date/time | 287-289, 335-337 |
| Step history formatter | Includes full YAML structure | 645-678 |

---

### 12.6 Critical Recommendations

#### **Priority 1: Implement Prompt Caching** 🚨 CRITICAL
**Impact**: 55.9% token reduction
**Effort**: Medium (provider-specific implementation)
**Files to modify**:
- `src/providers/openai.ts` - Add cache_control headers
- `src/providers/ollama-provider.ts` - Check Ollama caching support
- `src/prompt/react-prompt-generator.ts` - Mark cacheable sections

**Implementation**:
```typescript
// Cacheable sections
const cacheablePrompt = {
  identity: "...",     // Cache tier 1
  format: "...",       // Cache tier 1
  tools: "..."         // Cache tier 2 (updates rarely)
};

// Fresh sections
const freshPrompt = {
  stepHistory: "...",  // Never cache
  userMessage: "...",  // Never cache
  observation: "..."   // Never cache
};
```

---

#### **Priority 2: Remove Date/Time Spam**
**Impact**: 4.7% token reduction + improves relevance
**Effort**: Low
**Files to modify**:
- `src/prompt/react-prompt-generator.ts` - Remove Lines 149-163, 177-193, 287-289, 335-337
- Create `get_current_datetime` tool in `src/tools/`

**Rationale**: Only ~1% of queries actually need current time. Making it a tool means:
- Tool is only called when query mentions "today", "now", "current", etc.
- Saves 33 tokens on 99% of queries
- More accurate time (called when needed, not when session started)

---

#### **Priority 3: Slim Identity Prompt**
**Impact**: 3.3% token reduction + clearer role definition
**Effort**: Low
**Files to modify**:
- `src/prompt/react-prompt-generator.ts` - Lines 23-29

**Change**:
```typescript
// Before (85 tokens)
private readonly defaultIdentity = `You are an intelligent AI assistant with access to external tools to help users. Always respond directly unless a tool would clearly help solve the user's request.

When using tools:
1. Always use tools when they would help complete the user's request
2. You can use multiple tools in sequence if needed
3. Always respond to the user with the results of the tool after using it
4. If a tool fails, try an alternative approach or explain the issue to the user`;

// After (15 tokens)
private readonly defaultIdentity = `You are a task orchestrator. Use tools to complete requests efficiently.`;
```

**Rationale**: Tool usage instructions are already in ReAct prompt. Identity should only define the role.

---

#### **Priority 4: Compress Step History**
**Impact**: 8.6% token reduction
**Effort**: Medium
**Files to modify**:
- `src/prompt/react-prompt-generator.ts` - Lines 645-678 (formatReasoningSteps method)

**Change**:
```typescript
// Before (~80-120 tokens per step)
Previous reasoning steps:
Step 1:
THOUGHT: Need to search for current Bitcoin price
PLAN: Use brave_web_search to find latest price information
ACTION: Using tool brave_web_search
Parameters: {query: "Bitcoin price today"}
OBSERVATION: Bitcoin is currently trading at $95,234

// After (~20 tokens per step)
[1] brave_search(Bitcoin price) → $95,234
[2] calculator(95234*1.1) → $104,757
```

**Rationale**: LLM only needs to know what was tried and what resulted. Full YAML history is verbose.

---

#### **Priority 5: Deduplicate Prompts**
**Impact**: 2.9% token reduction + cleaner architecture
**Effort**: Medium
**Files to modify**:
- `src/services/prompt/prompt-repository.ts` - Remove or slim TOOL_USAGE and REASONING prompts
- `src/prompt/react-prompt-generator.ts` - Ensure single source of truth

**Strategy**:
- **Keep**: ReAct prompt (it has the format + instructions)
- **Remove**: Repository TOOL_USAGE (duplicates ReAct)
- **Remove**: Repository REASONING (duplicates ReAct)
- **Keep**: Repository BEHAVIORAL (unique guidance)

---

### 12.7 Expected Results After Optimization

**Performance Metrics:**

| Metric | Current | Optimized | Improvement |
|--------|---------|-----------|-------------|
| 3-step ReAct session | 2,100 tokens | 517 tokens | 75% reduction |
| 8-step max session | 5,600 tokens | 937 tokens | 83% reduction |
| Simple greeting | 118 tokens | 15 tokens | 87% reduction |
| Cost per 1M requests | $2.10 | $0.52 | $1.58 savings |
| Avg response latency | ~2.5s | ~1.2s | 52% faster |

**Token Distribution Before vs After:**

```
BEFORE (2,100 tokens):
├─ Identity bloat:         255 tokens (12%)
├─ Date/time spam:          99 tokens (5%)
├─ ReAct instructions:     411 tokens (20%)
├─ Tool descriptions:      375 tokens (18%)
├─ Step history:           900 tokens (43%)
└─ User message:            60 tokens (2%)

AFTER (517 tokens):
├─ Identity (cached):       15 tokens (3%)
├─ ReAct format (cached):  137 tokens (27%)
├─ Tools (cached):         125 tokens (24%)
├─ Step history:           180 tokens (35%)
└─ User message:            60 tokens (11%)
```

**Cost Analysis** (GPT-3.5-turbo pricing: $0.001/1K tokens):

```
Per 1,000 requests:
  Current:  2,100 × 1,000 = 2.1M tokens = $2.10
  Optimized:  517 × 1,000 = 0.517M tokens = $0.52

  Savings: $1.58 per 1,000 requests (75% cost reduction)

Annual savings (assuming 10M requests/year):
  Current:  $21,000/year
  Optimized: $5,170/year

  SAVINGS: $15,830/year
```

---

### 12.8 Implementation Roadmap

**Phase 1: Quick Wins (1-2 days)**
- [ ] Remove date/time from all prompts
- [ ] Create `get_current_datetime` tool
- [ ] Slim identity prompt to 15 tokens
- [ ] Test: Verify agent still functions correctly

**Phase 2: Structural Improvements (2-3 days)**
- [ ] Implement compressed step history format
- [ ] Deduplicate Repository prompts
- [ ] Refactor to separable elements pattern
- [ ] Test: Compare before/after reasoning quality

**Phase 3: Caching Implementation (3-5 days)**
- [ ] Add prompt caching to OpenAI provider
- [ ] Add prompt caching to Ollama provider (if supported)
- [ ] Implement cache invalidation logic
- [ ] Test: Verify cache hits and token savings

**Phase 4: Validation (2-3 days)**
- [ ] Run full test suite
- [ ] Measure actual token usage reduction
- [ ] Validate reasoning quality maintained
- [ ] Update documentation

**Total Estimated Time**: 8-13 days
**Expected ROI**: 75% token reduction, $15k+ annual savings

---

**Map Complete**: All prompts identified, analyzed, and optimization plan documented.
