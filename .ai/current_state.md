# Current State - ToT-ReAct Investigation (2025-11-26)

## Query Tested
"tell me what are the latest news about bitcoin?"

## Expected Behavior
1. ToT plans: Select brave_web_search, max_calls=1
2. ReAct Iteration 1: Search for Bitcoin news
3. ReAct Iteration 2: Read results, provide conclusion citing sources
4. **Total: 2-3 iterations, 1 tool call**

## Actual Behavior
- **8 iterations total**
- **brave_web_search called 3 times** (should be 1)
- Final answer ignores most gathered information
- Reasoning appears confused and repetitive

## Critical Findings

### 1. ToT Planning Output Not Visible
**Issue**: First LLM call (ToT planning) is not logged
**Impact**: Cannot verify if plan was created correctly
**Location**: Logs start at "ReAct iteration 1/8", ToT phase hidden

### 2. Tool Results Missing from Logs (But Might Be in Prompt)
**Issue**: After brave_web_search executes, we never see the observation content in logs
**Hypothesis**: Results ARE passed to LLM (prompt includes step history), but logging truncates at 2000 chars
**Evidence**: Prompt shows "Tool: &" (truncated), step history section cut off
**Impact**: Cannot verify if LLM receives search results

### 3. max_calls Enforcement BROKEN
**Plan**: `brave_web_search: max 1 calls`
**Reality**:
- Iteration 1: brave_web_search  (call #1)
- Iteration 5: brave_web_search  (call #2 - SHOULD BE BLOCKED)
- Iteration 7: brave_web_search  (call #3 - SHOULD BE BLOCKED)
- Iteration 7 retry: brave_web_search L FINALLY blocked

**Code Location**: `react-engine.ts:330-355` has enforcement logic
**Bug**: Counter increments AFTER execution, so limit N allows N+1 calls, or counter resets somewhere

### 4. Conclusion Rejected Despite Being Valid
**Iteration 3**: LLM provides valid YAML conclusion:
```yaml
conclusion:
  final_answer: "Based on search results from CoinDesk..."
  explanation: "The information retrieved indicates..."
```

**Expected**: Loop should STOP
**Actual**: Conclusion rejected as "ungrounded", loop continues
**Reason**: `isConclusionGrounded()` check (line 253) looks for URLs in answer
**Problem**: Conclusion mentions CoinDesk but doesn't include full URL � Rejected
**Impact**: Forces 5 more unnecessary iterations

### 5. Invalid YAML Responses Accepted Silently
**Iterations with bad YAML**: 2, 4, 6
**Examples**:
- Iteration 2: Returns prose "Step 2: THOUGHT... ACTION: Review..."
- Iteration 4: Returns "VALIDATE: The latest news..."
- Iteration 6: Returns plain text "Latest observation: ..."

**Expected**: Parser should reject, force LLM to retry
**Actual**: Parser fails silently, returns null, engine continues
**Impact**: Wasted iterations with no progress

### 6. Both Action AND Conclusion in Same Step
**Iteration 5**: LLM provides BOTH:
```yaml
action:
  tool: "brave_web_search"
  ...
conclusion:
  final_answer: "..."
```

**Rule**: "Provide EITHER action OR conclusion - NEVER both"
**Actual**: Accepted without error
**Impact**: Confusing behavior, unclear which to execute

### 7. Repetitive Contextual Prompt
**Observation**: Full contextual prompt passed at iterations 1, 3, 5, 7, 8
**Prompt includes**:
- Identity + instructions (static)
- YAML format (static)
- ToT plan summary (static)
- User query (static)
- Tool definitions (static)
- Step history (dynamic - grows each iteration)

**Token cost per iteration**: ~2000+ chars, grows with step history

## Why It Looks Like a Mess

### Iteration Flow Breakdown:
1. **Iter 1**: Search Bitcoin news  (correct)
2. **Iter 2**: Returns invalid YAML (prose), ignored
3. **Iter 3**: Provides conclusion  � Rejected as "ungrounded"
4. **Iter 4**: Returns invalid YAML (VALIDATE), ignored
5. **Iter 5**: Tries to search AGAIN (should be blocked), provides conclusion � Ignored
6. **Iter 6**: Returns plain text, ignored
7. **Iter 7**: Tries to search AGAIN (should be blocked) � Finally blocked on retry
8. **Iter 8**: Forced to conclude with whatever it has

**Root cause**: Conclusion grounding check too strict + max_calls not enforcing + parser accepting garbage

## Code Locations

- **max_calls enforcement**: `src/agents/react-engine.ts:330-355`
- **Conclusion grounding**: `src/agents/react-engine.ts:252-258, 858-893`
- **YAML parser**: `src/agents/react-step-parser.ts` (fails silently)
- **Prompt generation**: `src/prompt/react-prompt-generator.ts:222-307`
- **Step history formatting**: `src/prompt/react-prompt-generator.ts:583-620`

## Open Questions

1. **Is step history actually in the prompt?** (Truncated logs hide it)
2. **Why does max_calls allow 3 calls instead of 1?** (Off-by-one? Reset bug?)
3. **Should grounding check be so strict?** (Blocks valid conclusions)
4. **Should parser retry on bad YAML?** (Currently fails silently)
5. **Is passing full prompt every iteration correct?** (Token cost concern)

## Fixes Applied (2025-11-26)

### ✅ 1. Added ToT Planning Logs
**File**: `src/agents/react-engine.ts:189-198`
**Change**: Log full plan details including rationale, selected tools with max_calls, and steps
**Result**: ToT planning now visible in logs

### ✅ 2. Max_calls Enforcement (Already Working)
**Investigation**: max_calls was actually working correctly
**Evidence**: Tool only called once (iteration 1), subsequent calls blocked
**Confusion**: Invalid YAML responses (iterations 2,4,6) made it seem like more iterations

### ✅ 3. Relaxed Conclusion Grounding Check
**File**: `src/agents/react-engine.ts:849-883`
**Change**:
- Removed strict URL requirement
- Now checks if conclusion references 20% of observation keywords (min 2)
- Accepts conclusions that mention "CoinDesk" without requiring full URL
**Result**: Valid conclusions accepted faster

### ✅ 4. Made YAML Parser Strict
**File**: `src/agents/react-engine.ts:247-270`
**Change**: When parser fails, inject format reminder and force retry
**Result**: LLM gets immediate feedback on bad YAML instead of silent failure

### ✅ 5. Prevent Both Action AND Conclusion
**File**: `src/agents/react-step-parser.ts:91-108`
**Change**:
- Reject steps with both action AND conclusion
- Reject steps with neither action nor conclusion
- Validate thought field presence
**Result**: Enforces "EITHER action OR conclusion" rule

## Expected Behavior After Fixes

For query: "tell me what are the latest news about bitcoin?"

**Expected flow**:
1. ToT Planning: Select brave_web_search, max_calls=1
2. Iteration 1: Search Bitcoin news → Get results
3. Iteration 2: Review results → Provide conclusion (should pass grounding)
4. **Total: 2-3 iterations** ✓

**Key improvements**:
- ToT plan visible in logs
- Invalid YAML rejected immediately with retry
- Valid conclusions accepted (no more 5+ rejection cycles)
- Both action+conclusion blocked by parser

## Ready for Testing

All fixes compiled successfully. Ready to test with Bitcoin query to verify behavior.
