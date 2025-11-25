# ToT Integration Flow Map

## Complete Request Flow

```
User Query: "What are trending topics on GitHub?"
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 1. ToT PLANNING (Optional - if ENABLE_TOT_PLANNING=true)   │
├─────────────────────────────────────────────────────────────┤
│ ToTPlanner.planAndFilter()                                   │
│   → Stage 1: LLM generates YAML (decomposition)             │
│   → Stage 2: LLM generates YAML (reflection)                │
│   → Stage 3: LLM generates JSON (tool list)                 │
│   → Returns: Filtered ToolDefinition[]                       │
└─────────────────────────────────────────────────────────────┘
    ↓ Filtered tools (or all tools if ToT disabled)
┌─────────────────────────────────────────────────────────────┐
│ 2. REACT ENGINE LOOP                                         │
├─────────────────────────────────────────────────────────────┤
│ ReActEngine.process()                                        │
│   For iteration 1-8:                                         │
│     ┌─────────────────────────────────────────────────┐    │
│     │ 2a. GENERATE PROMPT                              │    │
│     │ ReActPromptGenerator.generatePrompt()            │    │
│     │   → Creates ReAct system prompt with tools       │    │
│     │   → Formats: YAML structure expected             │    │
│     └─────────────────────────────────────────────────┘    │
│     ↓                                                         │
│     ┌─────────────────────────────────────────────────┐    │
│     │ 2b. LLM CALL (Provider-specific)                │    │
│     │ ┌─ OpenAI: Direct API call                      │    │
│     │ └─ Ollama: OllamaProvider.generateResponse()    │    │
│     │      → OllamaBridge.processMessage()             │    │
│     │      → ollama.chat() with tools (native format)  │    │
│     │      → Returns: Text response (NOT tool_calls!)  │    │
│     └─────────────────────────────────────────────────┘    │
│     ↓ LLM Response (YAML text)                              │
│     ┌─────────────────────────────────────────────────┐    │
│     │ 2c. PARSE RESPONSE                               │    │
│     │ ReActStepParser.parseStep()                      │    │
│     │   → Extracts YAML block from markdown            │    │
│     │   → yaml.load() → JavaScript object              │    │
│     │   → Creates ReActStep object                     │    │
│     │     ├─ thought?: { reasoning, plan }             │    │
│     │     ├─ action?: { tool, params }  ⚠️ HERE!      │    │
│     │     ├─ observation?: string                      │    │
│     │     └─ conclusion?: { final_answer }             │    │
│     └─────────────────────────────────────────────────┘    │
│     ↓ action.params (could be object OR array!)             │
│     ┌─────────────────────────────────────────────────┐    │
│     │ 2d. EXECUTE TOOL                                 │    │
│     │ ReActEngine.executeToolAndStoreResult()          │    │
│     │   → toolManager.executeTool(tool, params)        │    │
│     └─────────────────────────────────────────────────┘    │
│     ↓                                                         │
└─────────────────────────────────────────────────────────────┘
    ↓ params passed to MCP
┌─────────────────────────────────────────────────────────────┐
│ 3. MCP TOOL EXECUTION                                        │
├─────────────────────────────────────────────────────────────┤
│ BaseToolManager.executeTool()                                │
│   → BaseMCPClient.callTool(name, args)                      │
│     → client.request({                                       │
│         method: "tools/call",                                │
│         params: {                                            │
│           name: "search_repositories",                       │
│           arguments: args  ⚠️ MUST BE OBJECT!               │
│         }                                                    │
│       })                                                     │
│   → MCP SERVER validates arguments                          │
│     ✅ Expects: { query: "Python" }                         │
│     ❌ Gets: ["Python"] or { params: [...] }                │
└─────────────────────────────────────────────────────────────┘
```

## The Problem Chain

### Issue Location: Step 2c → 2d (YAML Parsing)

**Expected YAML from LLM:**
```yaml
thought:
  reasoning: "Need to search GitHub"
  plan: "Use search_repositories tool"
action:
  tool: "search_repositories"
  params:
    query: "Python trending"  # ✅ Object format
```

**But LLM might generate:**
```yaml
action:
  tool: "search_repositories"
  params:
    - "Python trending"  # ❌ Array format (YAML list)
```

**Or:**
```yaml
action:
  tool: "search_repositories"
  params: ["Python trending"]  # ❌ JSON array in YAML
```

### Why Tests Didn't Catch This

**Diagnostic Tests:**
- Use mocked LLM responses
- Return hardcoded YAML strings with correct format
- Never test against real LLM output variations

**Integration Tests:**
- Would catch it, but they need API credits
- We hit the OpenAI quota issue before finding this

## Critical Logging Points (Missing)

1. **After YAML parsing** (ReActStepParser.parseStep)
   - Log: action.params type and value

2. **Before tool execution** (ReActEngine.executeToolAndStoreResult)
   - Log: params being sent to ToolManager

3. **In ToolManager** (BaseMCPClient.callTool)
   - Log: arguments structure before MCP request

## Root Cause

**The ReAct prompt doesn't enforce object format strictly enough!**

LLMs (especially smaller models like Granite) may interpret "params" as:
- An object: `{ key: value }`
- An array: `[value]`
- A value: `"value"`

The prompt needs to be **explicit** about the expected structure.

## Fix Strategy

1. **Improve ReAct prompt** - Make params format crystal clear
2. **Add validation** in ReActStepParser - Normalize params to object
3. **Add comprehensive logging** - Track params through the chain
4. **Add integration test** - Test with real Ollama/LLM output
