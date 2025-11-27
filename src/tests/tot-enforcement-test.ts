import { describe, it } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import { ToTPlanner } from "../agents/planning/tot-planner.js";
import { ReActEngine } from "../agents/react-engine.js";
import { ReActPromptGenerator } from "../prompt/react-prompt-generator.js";
import { ToolChainExecutor } from "../tools/tool-chain/tool-chain-executor.js";
import { InMemoryProvider } from "../memory/in-memory-provider.js";

/**
 * ENFORCEMENT TEST: Proves ToT plan is actually enforced by ReAct
 *
 * Scenario: "latest bitcoin news"
 * Expected flow:
 * 1. ToT creates plan: brave_web_search max_calls=1
 * 2. ReAct calls brave_web_search once
 * 3. ReAct gets blocked if it tries again
 * 4. ReAct answers with the data it has
 */
describe("ToT-ReAct Enforcement Test", function () {
  this.timeout(15000);

  it("should enforce max_calls limit for brave_web_search", async () => {
    const executionLog: string[] = [];
    let webSearchCallCount = 0;

    // Mock LLM that tries to call brave_web_search twice
    const mockLLM = {
      generateResponse: sinon.stub().callsFake(async (prompt: string) => {
        executionLog.push(`LLM called (prompt length: ${prompt.length})`);

        // First call: ToT planning request
        if (
          prompt.includes("task planner") ||
          prompt.includes("Create a structured plan")
        ) {
          executionLog.push("→ ToT Planning phase");
          const plan = {
            complexity: "simple",
            rationale:
              "User wants latest Bitcoin news. One web search is sufficient.",
            selected_tools: [
              {
                name: "brave_web_search",
                max_calls: 1,
                purpose: "Fetch recent Bitcoin news headlines",
              },
            ],
            steps: [
              {
                id: 1,
                type: "tool",
                tool: "brave_web_search",
                input_hint: { query: "latest bitcoin news", recency_days: 1 },
              },
              {
                id: 2,
                type: "answer",
                instruction: "Summarize the news and answer the user",
              },
            ],
          };
          return { content: JSON.stringify(plan), tokenCount: 100 };
        }

        // Check if plan summary is in prompt
        if (prompt.includes("Tool limits") || prompt.includes("max 1 calls")) {
          executionLog.push("✓ Plan summary found in ReAct prompt");
        }

        // ReAct execution: First step - call brave_web_search
        if (webSearchCallCount === 0 && prompt.includes("brave_web_search")) {
          executionLog.push("→ ReAct Step 1: Calling brave_web_search");
          webSearchCallCount++;
          return {
            content: `\`\`\`yaml
thought:
  reasoning: "I need to search for latest Bitcoin news"
  plan: "Use brave_web_search"
action:
  tool: "brave_web_search"
  params:
    query: "latest bitcoin news"
\`\`\``,
            tokenCount: 50,
          };
        }

        // ReAct execution: After getting search results, try to search again (should be blocked)
        if (webSearchCallCount === 1 && prompt.includes("Bitcoin price")) {
          executionLog.push(
            "→ ReAct Step 2: Trying brave_web_search again (should be blocked)",
          );
          webSearchCallCount++;
          return {
            content: `\`\`\`yaml
thought:
  reasoning: "Let me search for more details"
  plan: "Search again"
action:
  tool: "brave_web_search"
  params:
    query: "bitcoin price analysis"
\`\`\``,
            tokenCount: 50,
          };
        }

        // After being blocked, provide conclusion
        if (
          prompt.includes("already used") ||
          prompt.includes("must now provide")
        ) {
          executionLog.push("✓ Blocked! Received enforcement message");
          executionLog.push("→ ReAct Step 3: Forced to conclude");
          return {
            content: `\`\`\`yaml
thought:
  reasoning: "I have the news data, I should answer now"
  plan: "Provide final answer"
conclusion:
  final_answer: "Recent Bitcoin news shows prices are volatile. Based on latest reports, Bitcoin is trading around $43,000."
\`\`\``,
            tokenCount: 50,
          };
        }

        // Default fallback
        executionLog.push("→ Default fallback response");
        return {
          content: `\`\`\`yaml
thought:
  reasoning: "I should provide an answer now"
  plan: "Conclude"
conclusion:
  final_answer: "Here's what I found about Bitcoin."
\`\`\``,
          tokenCount: 30,
        };
      }),
      getModel: () => "test-model",
      setSystemPrompt: sinon.stub(),
      cleanup: async () => {},
    };

    // Mock tool manager
    const mockToolManager = {
      getAvailableTools: async () => [
        {
          name: "brave_web_search",
          description: "Search the web using Brave Search",
          inputSchema: {
            properties: {
              query: { type: "string" },
              recency_days: { type: "number" },
            },
            required: ["query"],
          },
        },
        {
          name: "get_current_datetime",
          description: "Get current date and time",
          inputSchema: { properties: {} },
        },
      ],
      executeTool: sinon
        .stub()
        .callsFake(async (toolName: string, params: any) => {
          executionLog.push(
            `✓ Tool executed: ${toolName}(${JSON.stringify(params).substring(0, 50)})`,
          );

          if (toolName === "brave_web_search") {
            return {
              success: true,
              data: "Bitcoin price reaches $43,000 amid market volatility. Experts predict continued fluctuations.",
              metadata: { toolName, executionTime: 100 },
            };
          }

          return {
            success: true,
            data: "Tool result",
            metadata: { toolName, executionTime: 10 },
          };
        }),
    };

    // Setup
    const memory = new InMemoryProvider();
    const promptGenerator = new ReActPromptGenerator(undefined as any);
    const toolExecutor = new ToolChainExecutor();
    const totPlanner = new ToTPlanner(mockLLM as any);

    const reactEngine = new ReActEngine(
      memory,
      mockLLM as any,
      mockToolManager as any,
      toolExecutor,
      promptGenerator,
      totPlanner,
    );

    // Enable ToT planning
    process.env.ENABLE_TOT_PLANNING = "true";

    // Execute
    console.log(
      "\n🧪 Testing enforcement with query: 'what are the latest news about bitcoin?'\n",
    );

    const result = await reactEngine.process(
      "what are the latest news about bitcoin?",
      "test-user-123",
      [],
      8,
    );

    // Print execution log
    console.log("\n📋 Execution Log:");
    executionLog.forEach((log, i) => console.log(`  ${i + 1}. ${log}`));
    console.log("\n");

    // Assertions
    console.log("🔍 Validating enforcement behavior:\n");

    // 1. ToT planning should have happened
    const planningHappened = executionLog.some((log) =>
      log.includes("ToT Planning"),
    );
    console.log(`  ✓ ToT planning executed: ${planningHappened}`);
    expect(planningHappened).to.be.true;

    // 2. Plan summary should be in ReAct prompt
    const planInPrompt = executionLog.some((log) =>
      log.includes("Plan summary found"),
    );
    console.log(`  ✓ Plan summary passed to ReAct: ${planInPrompt}`);
    expect(planInPrompt).to.be.true;

    // 3. brave_web_search should have been called exactly once
    const webSearchExecutions = executionLog.filter((log) =>
      log.includes("Tool executed: brave_web_search"),
    ).length;
    console.log(
      `  ✓ brave_web_search executed: ${webSearchExecutions} time(s)`,
    );
    expect(webSearchExecutions).to.equal(1); // CRITICAL: Should be called only ONCE

    // 4. Second attempt should have been blocked
    const blocked = executionLog.some((log) => log.includes("Blocked!"));
    console.log(`  ✓ Second attempt blocked: ${blocked}`);
    expect(blocked).to.be.true;

    // 5. Forced conclusion should have happened
    const forcedConclusion = executionLog.some((log) =>
      log.includes("Forced to conclude"),
    );
    console.log(`  ✓ Forced to conclude: ${forcedConclusion}`);
    expect(forcedConclusion).to.be.true;

    // 6. Result should contain answer
    console.log(`  ✓ Final answer received: ${result.length > 0}`);
    expect(result).to.be.a("string");
    expect(result.length).to.be.greaterThan(0);

    console.log("\n✅ Enforcement test PASSED!");
    console.log("   - ToT created plan with max_calls=1");
    console.log("   - ReAct called tool once");
    console.log("   - Second attempt was blocked");
    console.log("   - LLM was forced to answer with available data\n");

    // Cleanup
    delete process.env.ENABLE_TOT_PLANNING;
  });
});
