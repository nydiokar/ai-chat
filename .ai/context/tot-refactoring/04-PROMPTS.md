# Planning Prompt Templates

## Overview

This document contains the prompt templates for each stage of Tree-of-Thought planning. These prompts are critical for success and should be carefully tuned based on actual agent behavior.

---

## Stage 1: Problem Decomposition Prompt

### Purpose
Break down the user's query into structured sub-problems with dependencies.

### Template

```
You are an AI planning assistant. Your task is to analyze a user query and break it down into a structured plan.

## User Query
{user_query}

## Available Tools
You have access to the following tools (only use these, do not create new ones):
{tool_summaries}

## Task
Analyze the user's query and decompose it into sub-problems. For each sub-problem:
1. Describe what needs to be done
2. Identify which tools from the available list would be helpful
3. Determine dependencies (which sub-problems must be solved first)
4. Assign a priority (1 = highest)

## Output Format
Respond with YAML in this exact format:

```yaml
decomposition:
  - id: "sub1"
    description: "Clear description of the sub-problem"
    dependencies: []  # List of IDs this depends on (empty array if none)
    required_tools: ["tool_name_1", "tool_name_2"]  # Tools from available list
    priority: 1

  - id: "sub2"
    description: "Another sub-problem"
    dependencies: ["sub1"]  # This depends on sub1 completing first
    required_tools: ["tool_name_3"]
    priority: 2

  # Add more sub-problems as needed (typically 2-5)

overall_strategy: "Brief 1-2 sentence summary of the overall approach"
estimated_complexity: "simple" | "moderate" | "complex"
```

## Guidelines
1. Be specific about what each sub-problem achieves
2. Only mention tools that are actually in the available tools list
3. Keep sub-problems atomic (each should be a single logical step)
4. Ensure dependencies form a valid sequence (no circular dependencies)
5. Prioritize sub-problems by execution order

## Example

User Query: "What are the top 3 trending cryptocurrencies and their current prices?"

```yaml
decomposition:
  - id: "sub1"
    description: "Fetch the list of currently trending cryptocurrencies"
    dependencies: []
    required_tools: ["crypto_trending_api", "market_sentiment"]
    priority: 1

  - id: "sub2"
    description: "Get current price data for the top 3 trending coins"
    dependencies: ["sub1"]
    required_tools: ["crypto_price_api"]
    priority: 2

  - id: "sub3"
    description: "Format and present the results with coin names and prices"
    dependencies: ["sub1", "sub2"]
    required_tools: []  # No tools needed, just formatting
    priority: 3

overall_strategy: "Identify trending coins, fetch their prices, present results"
estimated_complexity: "simple"
```

Now analyze this query:
{user_query}
```

### Variables
- `{user_query}`: The actual user query
- `{tool_summaries}`: Formatted string of available tools, e.g.:
  ```
  - crypto_trending_api: Get list of trending cryptocurrencies
  - crypto_price_api: Fetch current prices for specific coins
  - market_sentiment: Analyze market sentiment for cryptocurrencies
  - trend_analyzer: Analyze price trends over time
  ...
  ```

### Expected Output Format
Valid YAML with `decomposition` array and metadata fields.

---

## Stage 2: Reflection & Validation Prompt

### Purpose
Critically evaluate the initial plan and refine it with tool validation.

### Template

```
You are an AI validation assistant. You previously created a plan, and now you must critically evaluate and refine it.

## User Query
{user_query}

## Your Initial Plan
{stage1_output}

## Available Tools (Complete List)
{available_tool_names}

## Task
Reflect on your initial plan and validate it:

1. **Tool Validation**: Check if all tools you mentioned actually exist in the available tools list
   - If a tool doesn't exist, replace it with a similar available tool or remove it
   - Flag any tools you're unsure about

2. **Logic Validation**: Review the approach
   - Is the dependency order correct?
   - Are there any missing steps?
   - Is this plan realistic given the available tools?

3. **Feasibility Check**: Can this plan actually solve the user's query?
   - Is the scope appropriate?
   - Are there constraints we should consider?

## Output Format
Respond with YAML in this exact format:

```yaml
validation_results:
  tools_validated: true | false
  missing_tools: ["tool1", "tool2"]  # Tools you mentioned that don't exist
  suggested_replacements:
    - original: "tool_that_doesnt_exist"
      replacement: "actual_tool_from_list"
      reasoning: "Why this replacement is suitable"

  logic_issues: []  # List any problems with the plan logic
  missing_steps: []  # Any steps you forgot to include

refined_approach:
  strategy: "Updated overall strategy incorporating the reflection"
  key_steps:
    - "Step 1 description"
    - "Step 2 description"
    - "Step 3 description"

  constraints:
    - "Known limitation 1"
    - "Known limitation 2"

  confidence: 0.85  # Your confidence in this plan (0.0 to 1.0)

  risks:
    - "Potential risk 1"
    - "Potential risk 2"
```

## Critical Rules
1. You MUST only use tools from the available tools list
2. If you're unsure about a tool, check the list carefully
3. If no suitable tool exists, adjust the plan to work without it
4. Be honest about limitations and risks
5. Provide specific, actionable refinements

## Example Reflection

Initial plan mentioned "price_fetcher" but available tools only have "crypto_price_api":

```yaml
validation_results:
  tools_validated: false
  missing_tools: ["price_fetcher"]
  suggested_replacements:
    - original: "price_fetcher"
      replacement: "crypto_price_api"
      reasoning: "crypto_price_api provides the same functionality for fetching cryptocurrency prices"

  logic_issues: []
  missing_steps: ["Should add error handling for API failures"]

refined_approach:
  strategy: "Fetch trending coins via crypto_trending_api, get prices via crypto_price_api, format results. Added error handling consideration."
  key_steps:
    - "Call crypto_trending_api to get top trending coins"
    - "Extract coin symbols from results"
    - "Call crypto_price_api for each coin symbol"
    - "Aggregate and format the data"
    - "Return formatted response to user"

  constraints:
    - "API rate limits may restrict how many coins we can query"
    - "Some coins may not have price data available"

  confidence: 0.90

  risks:
    - "API might be unavailable"
    - "Trending list might change during execution"
```

Now reflect on your initial plan and provide a refined approach.
```

### Variables
- `{user_query}`: Original user query
- `{stage1_output}`: The YAML output from Stage 1
- `{available_tool_names}`: Comma-separated list of tool names only

### Expected Output Format
Valid YAML with validation results and refined approach.

---

## Stage 3: Tool Selection Prompt

### Purpose
Extract a precise list of tools needed for execution in JSON format.

### Template

```
You are a tool selection assistant. Based on the refined plan, select the exact tools needed for execution.

## User Query
{user_query}

## Refined Plan
{stage2_refined_approach}

## Available Tools
{available_tool_names}

## Task
Review the refined plan and select ONLY the tools that will actually be used during execution.

## Selection Criteria
1. Only include tools explicitly needed in the plan
2. Do not include tools "just in case" - be precise
3. Every tool you select should be from the available tools list
4. Do not create or hallucinate tool names
5. Aim for 3-10 tools (more focused is better)

## Output Format
Respond with JSON in this exact format (do not use markdown code blocks):

{
  "tools": [
    "tool_name_1",
    "tool_name_2",
    "tool_name_3"
  ],
  "reasoning": "Brief explanation of why these specific tools were selected and how they map to the plan steps"
}

## Example

Refined plan involves: Fetch trending coins → Get prices → Analyze trends → Generate recommendation

Correct JSON response:
{
  "tools": [
    "crypto_trending_api",
    "crypto_price_api",
    "trend_analyzer",
    "recommendation_engine"
  ],
  "reasoning": "crypto_trending_api for fetching trending list, crypto_price_api for current prices, trend_analyzer for analyzing patterns, recommendation_engine for final investment advice"
}

## Common Mistakes to Avoid
❌ Including tools not in the available list
❌ Including too many tools "just in case"
❌ Duplicating similar tools
❌ Creating fictional tool names
❌ Using markdown code blocks (return raw JSON only)

Now select tools for this plan:
Plan: {stage2_refined_approach}
Available: {available_tool_names}
```

### Variables
- `{user_query}`: Original user query
- `{stage2_refined_approach}`: The refined approach from Stage 2
- `{available_tool_names}`: Comma-separated list

### Expected Output Format
Raw JSON object with `tools` array and `reasoning` string.

---

## Execution Context Prompt (for ReActEngine)

### Purpose
Provide context to the ReAct execution loop about the planning that occurred.

### Template

```
## Planning Context

A multi-stage planning process was completed for this query. Here is what was determined:

### Problem Decomposition
{decomposition_summary}

### Approach
{approach_strategy}

### Tools Available
You have been provided with a curated set of {tool_count} tools specifically selected for this task:
{filtered_tool_list}

These tools were chosen based on careful analysis of the query requirements. Focus on using these tools effectively rather than exploring other options.

### Execution Guidance
- Follow the decomposed sub-problems as a guide
- The dependency order has been validated
- Tool availability has been confirmed
- Focus on executing the plan efficiently

---

[Rest of standard ReAct prompt follows...]
```

### Variables
- `{decomposition_summary}`: Brief summary of sub-problems
- `{approach_strategy}`: The overall strategy from planning
- `{tool_count}`: Number of filtered tools
- `{filtered_tool_list}`: List of filtered tools with descriptions

---

## Prompt Engineering Guidelines

### General Principles

1. **Be Explicit**: Clearly state expected output format
2. **Use Examples**: Include 1-2 examples for complex formats
3. **Constrain Output**: Use YAML/JSON to enforce structure
4. **Remind of Constraints**: Repeatedly mention "only use available tools"
5. **Keep It Concise**: Avoid unnecessary verbosity

### Testing Prompts

When testing a prompt:

1. **Try Edge Cases**:
   - Query with no clear decomposition
   - Query requiring non-existent tools
   - Ambiguous queries
   - Simple queries that don't need planning

2. **Validate Output**:
   - Can it be parsed?
   - Does it follow the schema?
   - Are tool names valid?
   - Is the logic sound?

3. **Iterate**:
   - A/B test variations
   - Track success rate
   - Refine based on failures

### Model-Specific Considerations

#### GPT-3.5-Turbo (Recommended for Planning)
- ✅ Fast and cost-effective
- ✅ Good at structured output (YAML/JSON)
- ⚠️ May need more explicit examples
- ⚠️ Can sometimes skip steps in complex plans

#### GPT-4
- ✅ Better reasoning quality
- ✅ Handles complex decompositions well
- ❌ Slower and more expensive
- 💡 Use for Stage 1 if budget allows, GPT-3.5 for Stages 2-3

#### Claude (If Switching Providers)
- ✅ Excellent at structured output
- ✅ Strong reasoning capabilities
- ⚠️ May be verbose (adjust prompts to request brevity)

---

## Prompt Version Control

### Version History

| Version | Date | Changes | Performance |
|---------|------|---------|-------------|
| 1.0 | 2025-11-24 | Initial prompts based on LightAgent patterns | TBD |

### Testing New Versions

1. Create new prompt variant
2. Test with 20 diverse queries
3. Measure:
   - Parse success rate
   - Tool filter accuracy
   - Planning time
   - Reasoning quality (human eval)
4. Compare to baseline
5. Roll out if >10% improvement

---

## Troubleshooting Common Issues

### Issue: LLM Returns Plain Text Instead of YAML

**Symptom**: Response doesn't match expected format

**Solutions**:
1. Add "Respond ONLY with YAML, no additional text" to prompt
2. Use few-shot examples showing exact format
3. Try JSON mode if provider supports it (OpenAI structured outputs)

### Issue: LLM Hallucinates Tools

**Symptom**: Tool names in output don't exist in registry

**Solutions**:
1. Repeat available tools list in prompt
2. Add explicit instruction: "ONLY use tools from this exact list"
3. In Stage 2, validate and force corrections
4. In code, filter out hallucinated tools

### Issue: Planning Takes Too Long

**Symptom**: >3s for planning stages

**Solutions**:
1. Reduce tool list in prompts (show only tool names, not descriptions)
2. Use faster model (GPT-3.5 instead of GPT-4)
3. Add timeout and fallback
4. Cache planning results for similar queries

### Issue: Poor Decomposition Quality

**Symptom**: Sub-problems don't make sense

**Solutions**:
1. Add more examples in prompt
2. Use GPT-4 for Stage 1 (better reasoning)
3. Increase temperature slightly (0.3 → 0.5) for more creativity
4. Validate output structure in code, reject if invalid

### Issue: Tool List Too Long After Filtering

**Symptom**: Stage 3 returns >15 tools

**Solutions**:
1. Add explicit limit in prompt: "Select 3-10 tools maximum"
2. Ask LLM to prioritize most essential tools
3. In code, if >10 tools, re-prompt asking to narrow down
4. Log warning if filter efficiency <50%

---

## Monitoring Prompt Performance

### Metrics to Track

```typescript
interface PromptMetrics {
  // Success rates
  parseSuccessRate: number; // % of responses that parse correctly
  toolValidityRate: number;  // % of tools that exist in registry

  // Quality metrics
  averageToolCount: number;  // Average tools after filtering
  filterEfficiency: number;  // % of tools filtered out

  // Performance
  averageLatency: number;    // Time per stage
  tokenUsage: number;        // Tokens per stage

  // User impact
  userSatisfaction: number;  // Human eval or feedback
  taskSuccessRate: number;   // Did execution succeed?
}
```

### A/B Testing Framework

```typescript
interface PromptVariant {
  id: string;
  name: string;
  stage: 1 | 2 | 3;
  template: string;
  metrics: PromptMetrics;
  sampleSize: number;
}

// Compare variants
async function comparePromptVariants(
  baseline: PromptVariant,
  variant: PromptVariant,
  testQueries: string[]
): Promise<ComparisonResult> {
  // Run both prompts on same queries
  // Measure metrics
  // Statistical significance test
  // Return recommendation
}
```

---

## Future Improvements

### Potential Enhancements

1. **Dynamic Prompts**: Adjust based on query complexity
2. **Few-Shot Learning**: Learn from successful past plannings
3. **Meta-Prompting**: LLM generates its own planning prompts
4. **Multi-Modal**: Support for image/file-based queries
5. **Streaming**: Stream planning stages for better UX

### Research Directions

1. **Prompt Optimization**: Use LLMs to optimize prompts
2. **Reinforcement Learning**: Learn better prompts from outcomes
3. **Chain-of-Thought**: Integrate with other reasoning techniques
4. **Self-Correction**: LLM validates its own output

---

## Appendix: Full Example

### Query
"Analyze the performance of Bitcoin and Ethereum over the last week and recommend which one is a better short-term investment."

### Stage 1 Output
```yaml
decomposition:
  - id: "sub1"
    description: "Fetch historical price data for Bitcoin for the last 7 days"
    dependencies: []
    required_tools: ["crypto_price_history", "time_series_fetcher"]
    priority: 1

  - id: "sub2"
    description: "Fetch historical price data for Ethereum for the last 7 days"
    dependencies: []
    required_tools: ["crypto_price_history", "time_series_fetcher"]
    priority: 1

  - id: "sub3"
    description: "Analyze price trends and volatility for both coins"
    dependencies: ["sub1", "sub2"]
    required_tools: ["trend_analyzer", "volatility_calculator"]
    priority: 2

  - id: "sub4"
    description: "Assess current market sentiment for both coins"
    dependencies: []
    required_tools: ["sentiment_analyzer", "social_media_scanner"]
    priority: 2

  - id: "sub5"
    description: "Generate investment recommendation based on analysis"
    dependencies: ["sub3", "sub4"]
    required_tools: ["recommendation_engine", "risk_assessor"]
    priority: 3

overall_strategy: "Parallel fetch of price data for both coins, analyze trends and sentiment, synthesize into recommendation"
estimated_complexity: "moderate"
```

### Stage 2 Output
```yaml
validation_results:
  tools_validated: true
  missing_tools: []
  suggested_replacements: []
  logic_issues: []
  missing_steps: ["Should compare trading volumes as well"]

refined_approach:
  strategy: "Fetch 7-day price history for BTC and ETH in parallel, analyze trends and volatility, assess market sentiment, compare trading volumes, generate risk-adjusted short-term recommendation"
  key_steps:
    - "Retrieve 7-day historical prices for BTC and ETH"
    - "Calculate volatility and trend direction for each"
    - "Analyze current market sentiment"
    - "Compare trading volumes"
    - "Assess short-term (1-2 week) prospects"
    - "Generate recommendation with risk disclaimer"

  constraints:
    - "Analysis limited to 7-day window"
    - "Short-term predictions have inherent uncertainty"
    - "Past performance doesn't guarantee future results"

  confidence: 0.85

  risks:
    - "Market conditions can change rapidly"
    - "Sentiment data may lag actual market movements"
    - "Unexpected news could invalidate analysis"
```

### Stage 3 Output
```json
{
  "tools": [
    "crypto_price_history",
    "trend_analyzer",
    "volatility_calculator",
    "sentiment_analyzer",
    "volume_comparator",
    "recommendation_engine",
    "risk_assessor"
  ],
  "reasoning": "crypto_price_history for fetching BTC/ETH price data, trend_analyzer for identifying patterns, volatility_calculator for risk assessment, sentiment_analyzer for market mood, volume_comparator for liquidity analysis, recommendation_engine for synthesis, risk_assessor for disclaimers"
}
```

**Result**: 7 tools selected from 50+ available (86% reduction)

---

## Document Control

- **Created**: 2025-11-24
- **Version**: 1.0
- **Status**: Initial Draft - Requires Testing
- **Next Review**: After Phase 1 Implementation

**Testing Notes**: These prompts must be validated with real LLM calls during Phase 1 implementation. Expect to iterate 3-5 times based on actual outputs.
