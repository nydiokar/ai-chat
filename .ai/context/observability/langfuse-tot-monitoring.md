# Langfuse Integration: ToT Performance Monitoring

## What We're Doing

Adding Langfuse observability to track Tree-of-Thought (ToT) planning performance and agent behavior.

## Why This Matters

- **Complete ToT visibility**: Track planning time, token usage, tool selection accuracy
- **Agent behavior insights**: Monitor reasoning patterns, success rates, performance bottlenecks
- **Data-driven optimization**: Use real metrics to improve agent effectiveness

## Current State Assessment

### ✅ What We Already Have
- **Sophisticated MCP monitoring**: Server health, tool usage, performance metrics
- **Agent architecture**: ReAct engine, ToT planner, feature flags
- **Existing dashboard**: Real-time MCP server monitoring at `http://localhost:8080/`

### ❌ What's Missing
- **AI agent observability**: No tracking of LLM calls, reasoning steps, or ToT performance
- **Token usage metrics**: Can't measure ToT overhead vs benefit
- **Agent behavior patterns**: No historical analysis of decision making

## Implementation Plan

### Phase 1: Core Setup (2-3 hours)
```bash
npm install langfuse
```

Create `src/utils/langfuse-client.ts`:
```typescript
import { Langfuse } from 'langfuse';

export const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: process.env.LANGFUSE_BASEURL || 'http://localhost:3000',
  enabled: process.env.LANGFUSE_ENABLED !== 'false'
});

export const isLangfuseEnabled = () => process.env.LANGFUSE_ENABLED !== 'false';
```

Add to `.env`:
```env
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASEURL=http://localhost:3000
LANGFUSE_ENABLED=true
```

### Phase 2: Provider Instrumentation (1-2 hours)

**OpenAI Provider** (`src/providers/openai.ts`):
```typescript
import { observeOpenAI } from 'langfuse';

// In constructor, replace:
this.client = observeOpenAI(new OpenAI(openaiConfig), {
  generationName: 'openai-llm-call',
  model: this.model,
  metadata: { provider: 'openai' }
});
```

**Ollama Provider** (`src/providers/ollama-provider.ts`):
```typescript
// In generate method:
const trace = langfuse.trace({
  name: 'ollama-llm-call',
  input: { prompt, model: this.model }
});

const response = await this.client.generate(...);
trace.end({ output: response.response });
```

### Phase 3: Agent Tracing (2-3 hours)

**ReAct Engine** (`src/agents/react-engine.ts`):
```typescript
const sessionTrace = langfuse.trace({
  name: 'react-agent-session',
  input: { message },
  metadata: { hasToT: !!this.totPlanner }
});

// Track reasoning steps
for (let step = 0; step < MAX_STEPS; step++) {
  const stepGen = sessionTrace.generation({
    name: `step-${step}`,
    input: currentPrompt
  });

  const response = await this.llmProvider.generateResponse(currentPrompt);
  stepGen.end({ output: response });

  // Track tool executions
  if (hasToolCall) {
    sessionTrace.event({
      name: 'tool-execution',
      metadata: { toolName, executionTime, success }
    });
  }
}

sessionTrace.end({ output: finalAnswer });
```

**ToT Planner** (`src/agents/planning/tot-planner.ts`):
```typescript
const planningTrace = langfuse.trace({
  name: 'tot-planning',
  input: { task: input }
});

const startTime = Date.now();
// ... existing planning logic ...
const plan = await this.generatePlan(input);

planningTrace.score({
  name: 'planning-time',
  value: Date.now() - startTime
});

planningTrace.score({
  name: 'tools-selected',
  value: plan.selectedTools.length
});

planningTrace.end({ output: plan });
```

### Phase 4: Dashboard Integration (1 hour)

**Link to existing MCP dashboard** (`src/tools/dashboard/metrics-dashboard.ts`):
```typescript
// Add trace links to server cards
const traceLink = `<a href="${langfuseUrl}/traces?filter=serverId:${serverId}" target="_blank">View Agent Traces</a>`;
```

### Phase 5: Basic Alerting (1 hour)

**Performance alerts** (`src/services/alerting/agent-alerts.ts`):
```typescript
export class AgentAlerts {
  static async checkToTPerformance() {
    // Query Langfuse for recent ToT traces
    // Alert if planning time > 5s or success rate < 80%
  }
}
```

## Success Validation

### What Success Looks Like
- ✅ **ToT Planning Traced**: Every planning session captured with timing and outcomes
- ✅ **Token Usage Visible**: Clear metrics on ToT overhead vs benefit
- ✅ **Agent Sessions Tracked**: Full reasoning chains and tool usage patterns
- ✅ **Dashboard Integration**: Easy access to agent traces from existing MCP dashboard

### Quick Validation
1. **Start Kanebra** with `LANGFUSE_ENABLED=true`
2. **Run a query** that triggers ToT planning
3. **Check Langfuse UI** - should see traces for planning + reasoning steps
4. **Verify metrics** - token usage, timing, success rates

## Risk Mitigation

### Rollback Plan
```bash
# Immediate disable
export LANGFUSE_ENABLED=false
npm run bot:restart
```

### Performance Safeguards
- **Feature flag control**: `LANGFUSE_ENABLED=false` disables all tracing
- **Async processing**: Tracing doesn't block agent responses
- **Graceful degradation**: Agents work normally if Langfuse is down

## Timeline & Effort

- **Total Time**: 6-8 hours spread over 2-3 days
- **Risk Level**: Very Low (optional, feature-flagged, no breaking changes)
- **Testing**: Can be done incrementally with existing test suite

## Next Steps

1. **Get Langfuse credentials** (self-host or cloud)
2. **Implement Phase 1** (core setup)
3. **Test basic tracing** with a simple query
4. **Add agent instrumentation** (Phase 2-3)
5. **Integrate dashboards** (Phase 4)
6. **Validate ToT monitoring** works as expected

This gives you complete ToT performance monitoring with minimal effort, building on your existing excellent MCP infrastructure.
