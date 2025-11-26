# ReAct Step History Compression Configuration

**Last Updated**: 2025-11-26
**Location**: `src/prompt/react-prompt-generator.ts` (lines 17-59)

## Quick Reference

| Component | Max Chars | Approx Tokens | Rationale |
|-----------|-----------|---------------|-----------|
| **Observation** | 800 | ~200 | Preserves search results, API data, sources for citation |
| **Conclusion** | 600 | ~150 | Preserves complete answers for multi-turn context |
| **Param Value** | 30 | ~7 | Just shows what was called (e.g., "Bitcoin price") |

## Philosophy: "Compress Metadata, Preserve Information"

### What We Remove ❌
- **THOUGHT**: "I need to search for..." (obvious from action)
- **PLAN**: "I will use tool X..." (redundant with action)
- Verbose formatting (newlines, labels, JSON pretty-printing)

### What We Keep ✅
- **OBSERVATION**: Search results, API responses, structured data
- **CONCLUSION**: Complete final answers
- **ACTION**: Tool name + compressed params

## Format Examples

### Before (Verbose - 72 tokens):
```yaml
Step 1:
THOUGHT: I need to search for Michael Saylor Bitcoin news
PLAN: Use brave_web_search to find recent information
ACTION: Using tool brave_web_search
Parameters: {"query": "Michael Saylor Bitcoin selling"}
OBSERVATION: Michael Saylor, CEO of MicroStrategy, recently stated in a Bloomberg interview that he has no plans to sell Bitcoin. MicroStrategy holds 152,800 BTC. Source: bloomberg.com/news/saylor-bitcoin-2025
```

### After (Compressed - 45 tokens):
```
[1] brave_search(Michael Saylor Bitcoin selling) → Michael Saylor, CEO of MicroStrategy, recently stated in a Bloomberg interview that he has no plans to sell Bitcoin. MicroStrategy holds 152,800 BTC. Source: bloomberg.com/news/saylor-bitcoin-2025
```

**Savings**: ~27 tokens (38%) while preserving all reasoning-critical information

## Why These Specific Values?

### OBSERVATION_MAX_CHARS = 800 (~200 tokens)

**Reasoning**:
- Search results need URLs, snippets, multiple sources
- API responses need structured data (prices, stats, metadata)
- **Too short** = LLM can't cite sources, gives vague answers
- **Too long** = Minimal token savings, context window bloat

**Example of what fits**:
```
Bitcoin is trading at $95,234 (CoinMarketCap, accessed Nov 26 2025).
Price increased 5.2% in 24h. Market cap: $1.8T. Trading volume: $42B.
Michael Saylor tweeted "Bitcoin is digital property" yesterday.
Sources: coinmarketcap.com/currencies/bitcoin, twitter.com/saylor/status/123
```

**Debugging**: If agent says "I found reliable sources" but doesn't cite them → **increase this value**

### CONCLUSION_MAX_CHARS = 600 (~150 tokens)

**Reasoning**:
- Final answers need to be complete for multi-turn conversations
- User may ask "what did you say earlier?" or "why?"
- Conclusions become context for follow-up questions

**Example of what fits**:
```
Michael Saylor is not selling Bitcoin. He stated in a Bloomberg interview
that MicroStrategy has no plans to sell any of their 152,800 BTC holdings.
In fact, they continue to accumulate Bitcoin as a treasury reserve asset.
Saylor views Bitcoin as "digital property" and believes it's the best
store of value. Sources: bloomberg.com, twitter.com/saylor
```

### PARAM_VALUE_MAX_CHARS = 30 (~7 tokens)

**Reasoning**:
- Just needs to show what was queried/called
- Full JSON not needed in step history (actual params are in observation)
- Balance: Show enough to understand what happened, not everything

**Examples**:
- ✅ Good: `"Bitcoin price"` or `"weather, NYC"`
- ❌ Too long: `"What is the current Bitcoin price in USD according to CoinMarketCap?"`

## Token Estimation

**Rough guideline**: 1 token ≈ 4 characters

- 800 chars ≈ 200 tokens
- 600 chars ≈ 150 tokens
- 30 chars ≈ 7-8 tokens

**Note**: This varies by tokenizer (GPT uses BPE, Claude uses different), but 4:1 is a reasonable approximation for planning.

## Tuning Guidelines

### If agent can't cite sources or gives vague answers:
```typescript
OBSERVATION_MAX_CHARS: 1200, // Increase to ~300 tokens
```

### If you're hitting context window limits:
```typescript
OBSERVATION_MAX_CHARS: 600, // Decrease to ~150 tokens
CONCLUSION_MAX_CHARS: 400,  // Decrease to ~100 tokens
```

### To monitor actual lengths (add logging):
```typescript
const result = this.truncateResult(step.observation.result, OBSERVATION_MAX_CHARS);
if (step.observation.result.length > OBSERVATION_MAX_CHARS) {
  this.logger.debug(`Observation truncated: ${step.observation.result.length} → ${OBSERVATION_MAX_CHARS}`);
}
```

## Related Configuration

**ReActEngine Loop**:
- Max iterations: 8 (hardcoded in `react-engine.ts`)
- Step optimization: First + last 2 + downsampled middle (see `react-trace.ts`)

**Token Limits**:
- OpenAI context window: 16,385 tokens (gpt-3.5-turbo)
- Target prompt size: <8,000 tokens (leave room for response)

## Testing

**File**: `src/prompt/react-prompt-generator.test.ts`

Tests verify:
- Compressed format includes tool names
- Compressed format includes observation results
- "Previous steps:" header is present
- Identity changed from "intelligent AI assistant" to "task orchestrator"

**Run tests**:
```bash
npm run test:react
```

## Common Issues

### Issue: Agent executes tool after providing conclusion
**Symptom**: Logs show "Executing tool" after "Added step: conclusion_XXX"
**Fix**: Already fixed in `react-engine.ts` (check conclusion first, break immediately)

### Issue: "No reasoning steps were recorded" in CLI
**Symptom**: CLI shows this message despite agent working
**Cause**: CLI checks memory (MemoryProvider), not ReActTrace
**Not related to compression**: This is a separate memory persistence issue

### Issue: Observations are `"→ undefined"` or `"→ "` (empty)
**Symptom**: Compressed steps show empty results
**Fix**: Check `truncateResult()` handles null/undefined properly (returns empty string)

## Version History

- **v1.0** (2025-11-26): Initial implementation with aggressive truncation (50 chars)
- **v1.1** (2025-11-26): **CRITICAL FIX** - Increased to 800 chars after discovering agent couldn't cite sources
- **v2.0** (2025-11-26): Added `STEP_COMPRESSION_LIMITS` constant with extensive documentation

## See Also

- `.ai/PROMPT_MAP.md` - Complete prompt architecture analysis
- `.ai/context.md` - Current implementation status
- `src/agents/react-engine.ts` - ReAct loop implementation
- `src/agents/react-trace.ts` - Step storage and optimization
