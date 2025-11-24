# Tree-of-Thought (ToT) Integration - Implementation Plan

## Executive Summary

**Problem Statement**: The current ReAct agent jumps directly from user input to tool execution without deliberate planning, causing:
- Inefficient tool selection (sending 50+ tools to LLM every iteration)
- Shallow reasoning (no problem decomposition)
- High token costs and slow responses
- Difficulty handling complex multi-step tasks

**Solution**: Integrate a Tree-of-Thought pre-planning stage that decomposes problems, validates plans, and filters tools BEFORE entering the execution loop.

**Expected Outcomes**:
- 70-80% reduction in tool context tokens
- 40-50% faster response times
- Improved reasoning quality through structured decomposition
- Better handling of complex, multi-step queries

---

## Quality Control Review Findings

### ✅ Validated Strengths to Preserve

1. **Superior Memory System** (`src/services/performance/context-scoring.service.ts`)
   - LightAgent has basic memory; yours has intelligent context scoring
   - **Action**: Keep as-is, enhance ToT to leverage memory for planning

2. **Sophisticated Tool Chain Executor** (`src/tools/tool-chain/tool-chain-executor.ts`)
   - Sequential tool execution with error recovery
   - **Action**: Use for complex tool sequences after planning

3. **Modular Architecture**
   - Clean separation: Agent → Engine → Trace → Parser → Handler
   - **Action**: Add ToT as a parallel planning module, not a replacement

4. **Task Management Infrastructure**
   - Dependency handling, scheduling, notifications
   - **Action**: Integrate ToT-planned actions into task system

### ⚠️ Critical Gaps Identified

#### Gap 1: No Problem Decomposition Layer
**Current**: User query → immediate tool selection
**Missing**: Problem understanding → sub-problem identification → solution planning
**Risk**: Complex queries fail because agent doesn't break them down
**Solution**: Implement `ProblemDecomposer` in Phase 1

#### Gap 2: Tool Explosion Problem
**Current**: All 50+ tools sent to LLM every iteration
**Evidence**: `ReActEngine.process()` line 147-156 passes all tools
**Impact**:
- Wasted tokens (tool schemas are large)
- Model confusion (too many options)
- Slower responses
**Solution**: `ToolFilterService` that reduces to 5-10 relevant tools

#### Gap 3: No Reflection/Validation Loop
**Current**: Single-pass reasoning → execution
**Risk**: Agent acts on flawed plans without validation
**LightAgent Pattern**: Plan → Reflect on plan → Validate against constraints → Filter tools
**Solution**: Add `PlanReflector` stage between planning and execution

#### Gap 4: Weak Step Optimization
**Current**: `ReActTrace.optimizeSteps()` (line 125) just keeps first + last 2 steps
**Problem**: Loses important middle reasoning
**Better Approach**: Semantic compression based on relevance to current goal
**Solution**: Enhance with `SemanticStepOptimizer`

#### Gap 5: No Planning Metrics
**Current**: No visibility into planning effectiveness
**Missing**:
- Planning time vs execution time
- Tool filter accuracy
- Plan-to-execution alignment
**Solution**: Add `PlanningMetricsCollector` in Phase 4

#### Gap 6: Prompt Generation Doesn't Support Planning
**Current**: `ReActPromptGenerator` only has execution-focused prompts
**Missing**: Decomposition prompts, reflection prompts, tool-selection prompts
**Solution**: Extend with planning-specific prompt methods

#### Gap 7: No Feature Flag System
**Current**: Changes would force everyone to new system
**Risk**: Breaking production without fallback
**Solution**: `ENABLE_TOT_PLANNING` environment variable with gradual rollout

### 🚨 Architectural Risks

#### Risk 1: Token Budget Explosion
**Concern**: Adding planning stages BEFORE execution could increase total tokens
**Mitigation**:
- Use cheaper model for planning (GPT-3.5 Turbo)
- Planning output is compact (JSON tool list)
- Savings in execution loop outweigh planning cost
**Validation**: Track total token usage before/after

#### Risk 2: Latency Increase
**Concern**: 3-stage planning adds 3 LLM calls before execution starts
**Mitigation**:
- Run planning stages with lower-latency model
- Cache planning results for similar queries
- Parallel execution where possible
**Validation**: Measure end-to-end response time

#### Risk 3: Integration Complexity
**Concern**: ReActEngine is tightly coupled; changes could break existing flows
**Mitigation**:
- Feature flag for gradual rollout
- Planning module is isolated (dependency injection)
- Existing ReAct loop remains unchanged
**Validation**: Comprehensive integration tests

#### Risk 4: Prompt Engineering Challenges
**Concern**: ToT requires carefully crafted prompts for each stage
**Mitigation**:
- Start with LightAgent's proven prompt patterns
- Iterate based on actual agent behavior
- Version control for prompt templates
**Validation**: A/B testing of prompt variations

---

## Implementation Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────┐
│                      User Query                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
           ┌───────────────────────┐
           │   Feature Flag Check   │
           │  ENABLE_TOT_PLANNING   │
           └─────┬────────────┬────┘
                 │            │
        Yes      │            │ No (fallback)
                 │            │
                 ▼            ▼
    ┌────────────────────┐  ┌──────────────────┐
    │  ToT Planning      │  │ Traditional      │
    │  Module (NEW)      │  │ ReAct Loop       │
    └─────┬──────────────┘  └──────────────────┘
          │
          │ ┌─────────────────────────────────┐
          ├─┤ Stage 1: Problem Decomposition  │
          │ └─────────────────────────────────┘
          │ ┌─────────────────────────────────┐
          ├─┤ Stage 2: Plan Reflection        │
          │ └─────────────────────────────────┘
          │ ┌─────────────────────────────────┐
          ├─┤ Stage 3: Tool Filtering         │
          │ └─────────────────────────────────┘
          │
          ▼
    ┌──────────────────────────────────────┐
    │  Planning Result                      │
    │  - Decomposed sub-problems            │
    │  - Validated approach                 │
    │  - Filtered tool list (5-10 tools)    │
    │  - Planning context                   │
    └─────┬────────────────────────────────┘
          │
          ▼
    ┌──────────────────────────────────────┐
    │  ReActEngine.process()                │
    │  (Existing execution loop)            │
    │  - Uses filtered tools                │
    │  - Planning context in prompts        │
    └─────┬────────────────────────────────┘
          │
          ▼
    ┌──────────────────────────────────────┐
    │  Tool Execution & Response            │
    └──────────────────────────────────────┘
```

### Module Responsibilities

#### Module 1: ToTPlanningOrchestrator (NEW)
**Location**: `src/agents/planning/tot-orchestrator.ts`
**Responsibility**: Coordinates the 3-stage planning process
**Dependencies**: LLMProvider, ToolManager, PlanReflector, ToolFilterService
**Public API**:
```typescript
interface ToTPlanningResult {
  decomposition: SubProblem[];
  approach: PlanningApproach;
  filteredTools: ToolDefinition[];
  planningContext: string;
  metadata: PlanningMetadata;
}

async plan(userQuery: string, availableTools: ToolDefinition[]): Promise<ToTPlanningResult>
```

#### Module 2: ProblemDecomposer (NEW)
**Location**: `src/agents/planning/problem-decomposer.ts`
**Responsibility**: Stage 1 - Break down complex queries into sub-problems
**Output**: Structured decomposition with dependencies

#### Module 3: PlanReflector (NEW)
**Location**: `src/agents/planning/plan-reflector.ts`
**Responsibility**: Stage 2 - Validate and refine the initial plan
**Output**: Refined approach with constraints validated

#### Module 4: ToolFilterService (NEW)
**Location**: `src/tools/tool-selection/tool-filter-service.ts`
**Responsibility**: Stage 3 - Extract tool names from plan and filter schemas
**Output**: Reduced ToolDefinition[] array

#### Module 5: PlanningPromptGenerator (NEW)
**Location**: `src/prompt/planning-prompt-generator.ts`
**Responsibility**: Generate prompts for each planning stage
**Extends**: Existing prompt infrastructure

#### Module 6: Enhanced ReActEngine (MODIFIED)
**Location**: `src/agents/react-engine.ts`
**Changes**:
- Add optional ToT planning before main loop
- Use filtered tools instead of all tools
- Include planning context in prompts

#### Module 7: PlanningMetrics (NEW)
**Location**: `src/services/performance/planning-metrics.service.ts`
**Responsibility**: Track planning effectiveness
**Integrates with**: Existing performance monitoring

---

## Implementation Phases

### Phase 1: Core ToT Planning Module (Week 1-2)
**Goal**: Implement 3-stage planning in isolation
**Deliverables**:
- ToTPlanningOrchestrator
- ProblemDecomposer
- PlanReflector
- ToolFilterService
- PlanningPromptGenerator
- Unit tests for each module

**Success Criteria**:
- Given user query + tools, returns filtered tool list
- Planning stages can be tested independently
- Prompts produce parseable outputs

### Phase 2: Integration with ReActEngine (Week 3)
**Goal**: Wire ToT into existing agent flow
**Deliverables**:
- Feature flag: `ENABLE_TOT_PLANNING`
- Modified `ReActEngine.process()` to call ToT
- Integration tests
- Fallback mechanism if planning fails

**Success Criteria**:
- Agent works with ToT enabled
- Agent works with ToT disabled (existing behavior)
- Graceful degradation if planning errors

### Phase 3: Prompt Engineering & Tuning (Week 4)
**Goal**: Optimize prompts for quality and cost
**Deliverables**:
- Refined planning prompts
- Model selection strategy (GPT-4 vs GPT-3.5 for planning)
- A/B testing framework

**Success Criteria**:
- Planning produces coherent decompositions
- Tool filtering is accurate (>90% relevant tools)
- Acceptable latency (<2s for planning)

### Phase 4: Metrics & Observability (Week 5)
**Goal**: Measure effectiveness of ToT
**Deliverables**:
- PlanningMetrics service
- Dashboard integration
- Logging enhancements

**Success Criteria**:
- Can measure planning time, tool filter accuracy
- Can compare ToT vs non-ToT performance
- Clear visibility into planning decisions

### Phase 5: Production Rollout (Week 6)
**Goal**: Gradual rollout with monitoring
**Strategy**:
- Week 6.1: Internal testing only
- Week 6.2: 10% of production traffic
- Week 6.3: 50% of production traffic
- Week 6.4: 100% rollout (remove feature flag)

---

## Risk Mitigation Matrix

| Risk | Impact | Probability | Mitigation | Contingency |
|------|--------|-------------|------------|-------------|
| Token cost increase | High | Medium | Use cheaper model for planning; measure continuously | Disable ToT if costs exceed 20% increase |
| Latency increase | Medium | High | Parallel execution; caching; fast model | Timeout after 3s, fallback to traditional |
| Breaking existing flows | High | Low | Feature flag; comprehensive tests | Quick rollback via env var |
| Poor planning quality | High | Medium | Iterate on prompts; validate outputs | Fallback to traditional on parse failures |
| Model hallucination in tools | Medium | Medium | Strict JSON parsing; validation against registry | Reject invalid tool names |

---

## Testing Strategy

### Unit Tests
- Each planning module isolated
- Mock LLM responses for deterministic tests
- Edge cases: empty tool list, malformed plans

### Integration Tests
- End-to-end: query → ToT → execution → response
- With/without feature flag
- Failure scenarios: planning errors, tool execution errors

### Performance Tests
- Token usage comparison (ToT vs traditional)
- Latency measurements (p50, p95, p99)
- Load testing with 100 concurrent queries

### Quality Tests
- Human evaluation of reasoning quality
- A/B testing: ToT vs traditional for same queries
- Metric: % of queries that successfully decompose

---

## Rollback Plan

If ToT causes production issues:

1. **Immediate**: Set `ENABLE_TOT_PLANNING=false` (no code deploy needed)
2. **Short-term**: Analyze logs to identify root cause
3. **Medium-term**: Fix issues in staging, re-enable gradually
4. **Long-term**: If unfixable, remove ToT code and document learnings

---

## Success Metrics

### Primary KPIs
- **Reasoning Quality**: Human evaluation score (1-5 scale)
- **Token Efficiency**: Average tokens per query (target: -50%)
- **Response Time**: p95 latency (target: <3s for complex queries)
- **Tool Relevance**: % of filtered tools actually used (target: >70%)

### Secondary KPIs
- Planning stage success rate
- Fallback frequency
- User satisfaction (Discord feedback)

---

## Next Steps

1. **Review this document** with the team
2. **Approve architecture** and phase timeline
3. **Set up feature flag** in environment configuration
4. **Begin Phase 1 implementation** (Core ToT Planning Module)

---

## Document Control

- **Created**: 2025-11-24
- **Version**: 1.0
- **Authors**: Claude-3.5-Sonnet (Architecture Analysis)
- **Reviewers**: [Pending]
- **Next Review**: After Phase 1 completion

**Related Documents**:
- `.ai/tot-refactoring/01-ARCHITECTURE.md` - Detailed technical design
- `.ai/tot-refactoring/02-IMPLEMENTATION.md` - Step-by-step implementation guide
- `.ai/tot-refactoring/03-TESTING.md` - Comprehensive test plan
- `.ai/tot-refactoring/04-PROMPTS.md` - Planning prompt templates
