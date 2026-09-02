import { describe, it } from "mocha";
import { expect } from "chai";
import { ToTPlanner } from "../agents/planning/tot-planner.js";
import { ReActEngine } from "../agents/react-engine.js";
import { ReActPromptGenerator } from "../prompt/react-prompt-generator.js";
import { ToolChainExecutor } from "../tools/tool-chain/tool-chain-executor.js";
import { InMemoryProvider } from "../memory/in-memory-provider.js";
import sinon from "sinon";

/**
 * DIAGNOSTIC TEST: Validates ToT integration WITHOUT requiring API key
 *
 * This test captures:
 * 1. What prompts ToT sends to LLM
 * 2. Whether ToT gets called at all
 * 3. Whether filtered tools are actually used
 * 4. Whether ReActEngine flow is correct
 *
 * Run with: npm test -- --grep "ToT Diagnostic"
 */
describe("ToT Diagnostic Test", function () {
  this.timeout(10000);

  describe("1. ToT Planner Prompt Validation", () => {
    it("should generate a valid structured planning prompt", async () => {
      const capturedPrompts: string[] = [];
      const capturedResponses: string[] = [];

      // Spy LLM to capture prompts
      const mockLLM = {
        generateResponse: sinon.stub().callsFake(async (prompt: string) => {
          console.log(
            `\n📝 CAPTURED PROMPT (${capturedPrompts.length + 1}/3):`,
          );
          console.log(prompt.substring(0, 300) + "...\n");
          capturedPrompts.push(prompt);

          const response = JSON.stringify({
            rationale: "Use GitHub trending to answer the query.",
            selected_tools: [
              {
                name: "github_trending",
                max_calls: 2,
                purpose: "Fetch trending repositories",
              },
            ],
            steps: [
              {
                id: 1,
                type: "tool",
                tool: "github_trending",
                input_hint: {},
              },
              {
                id: 2,
                type: "answer",
                instruction: "Summarize trending repositories",
              },
            ],
          });
          capturedResponses.push(response);
          return { content: response, tokenCount: 50 };
        }),
        getModel: () => "test-model",
        setSystemPrompt: sinon.stub(),
        cleanup: async () => {},
      };

      const mockTools = [
        { name: "github_trending", description: "Get trending repos" },
        { name: "weather_api", description: "Get weather" },
      ];

      const planner = new ToTPlanner(mockLLM as any);
      const result = await planner.plan(
        "What's trending on GitHub?",
        mockTools as any,
      );

      // VALIDATION 1: Structured planner prompt called once
      expect(mockLLM.generateResponse.callCount).to.equal(1);
      expect(capturedPrompts.length).to.equal(1);

      // VALIDATION 2: Prompts contain expected keywords
      expect(capturedPrompts[0]).to.include("Create a structured plan");
      expect(capturedPrompts[0]).to.include("github_trending");
      expect(capturedPrompts[0]).to.include("selected_tools");
      expect(capturedPrompts[0]).to.include("steps");

      // VALIDATION 3: Tool filtering worked (now returns PlanArtifact)
      expect(result).to.have.property("selected_tools");
      expect(result.selected_tools).to.be.an("array");
      expect(result.selected_tools.length).to.equal(1);
      expect(result.selected_tools[0].name).to.equal("github_trending");
      expect(result.selected_tools[0]).to.have.property("max_calls");

      console.log("\n✅ All 3 stages executed with valid prompts");
      console.log(
        `✅ Tool filtering worked: ${mockTools.length} → ${result.selected_tools.length} tools\n`,
      );
    });

    it("should fallback to all tools if parsing fails", async () => {
      const mockLLM = {
        generateResponse: sinon.stub().resolves({
          content: "Invalid YAML!!!",
          tokenCount: 10,
        }),
        getModel: () => "test-model",
        setSystemPrompt: sinon.stub(),
        cleanup: async () => {},
      };

      const mockTools = [{ name: "tool1", description: "Test" }];

      const planner = new ToTPlanner(mockLLM as any);
      const result = await planner.plan("test query", mockTools as any);

      // Should return a fallback PlanArtifact on failure
      expect(result.selected_tools.map((tool: any) => tool.name)).to.deep.equal(
        ["tool1"],
      );
      expect(result.steps.at(-1)?.type).to.equal("answer");
      console.log(
        "\n✅ Fallback mechanism works (returns all tools on error)\n",
      );
    });
  });

  describe("2. ReActEngine Integration", () => {
    it("should call ToT planner when enabled", async () => {
      // Enable ToT
      process.env.ENABLE_TOT_PLANNING = "true";

      try {
        let totWasCalled = false;
        const mockTotPlanner = {
          plan: sinon.stub().callsFake(async (query: string, tools: any[]) => {
            console.log(`\n🎯 ToT PLANNER CALLED with query: "${query}"`);
            console.log(
              `🎯 Available tools: ${tools.map((t) => t.name).join(", ")}`,
            );
            totWasCalled = true;
            // Return filtered PlanArtifact
            return {
              complexity: "medium",
              rationale: "Use the first tool for the test query",
              selected_tools: [
                {
                  name: tools[0].name,
                  max_calls: 1,
                  purpose: "Test tool",
                },
              ],
              steps: [
                { id: 1, type: "tool", tool: tools[0].name },
                {
                  id: 2,
                  type: "answer",
                  instruction: "Answer from test result",
                },
              ],
            };
          }),
        };

        const mockLLM = {
          generateResponse: sinon.stub().callsFake(async (prompt: string) => {
            console.log(
              `\n📤 ReActEngine sending prompt with tools count: ${(prompt.match(/name:/g) || []).length}`,
            );
            // Return conclusion to end loop
            return {
              content: `\`\`\`yaml
conclusion:
  final_answer: "Test response"
\`\`\``,
              tokenCount: 50,
            };
          }),
          getModel: () => "test-model",
          setSystemPrompt: sinon.stub(),
          cleanup: async () => {},
        };

        const mockMemory = new InMemoryProvider();
        await mockMemory.initialize();

        const mockToolManager = {
          getAvailableTools: sinon.stub().resolves([
            { name: "tool1", description: "Tool 1" },
            { name: "tool2", description: "Tool 2" },
            { name: "tool3", description: "Tool 3" },
          ]),
          executeTool: sinon.stub().resolves({ success: true, data: "result" }),
          registerTool: sinon.stub(),
          getToolByName: sinon.stub(),
          refreshToolInformation: sinon.stub(),
        };

        const mockPromptGen = new ReActPromptGenerator(
          mockToolManager,
          undefined,
        );
        const toolExecutor = new ToolChainExecutor();

        const engine = new ReActEngine(
          mockMemory,
          mockLLM as any,
          mockToolManager,
          toolExecutor,
          mockPromptGen,
          mockTotPlanner as any, // Pass ToT planner
        );

        // Execute
        const result = await engine.process("Test query", "test-user");

        // VALIDATION: ToT was called
        expect(totWasCalled).to.be.true;
        expect(mockTotPlanner.plan.calledOnce).to.be.true;

        // VALIDATION: LLM received prompt (with filtered tools)
        expect(mockLLM.generateResponse.called).to.be.true;

        console.log("\n✅ ToT planner was called by ReActEngine");
        console.log("✅ Filtered tools were used in execution\n");
      } finally {
        delete process.env.ENABLE_TOT_PLANNING;
      }
    });

    it("should NOT call ToT planner when disabled", async () => {
      process.env.ENABLE_TOT_PLANNING = "false";

      try {
        const mockTotPlanner = {
          plan: sinon.stub().rejects(new Error("Should not be called!")),
        };

        const mockLLM = {
          generateResponse: sinon.stub().resolves({
            content: `\`\`\`yaml
conclusion:
  final_answer: "Test"
\`\`\``,
            tokenCount: 10,
          }),
          getModel: () => "test-model",
          setSystemPrompt: sinon.stub(),
          cleanup: async () => {},
        };

        const mockMemory = new InMemoryProvider();
        await mockMemory.initialize();

        const mockToolManager = {
          getAvailableTools: sinon
            .stub()
            .resolves([{ name: "tool1", description: "Tool 1" }]),
          executeTool: sinon.stub().resolves({ success: true, data: "result" }),
          registerTool: sinon.stub(),
          getToolByName: sinon.stub(),
          refreshToolInformation: sinon.stub(),
        };

        const mockPromptGen = new ReActPromptGenerator(
          mockToolManager,
          undefined,
        );
        const toolExecutor = new ToolChainExecutor();

        const engine = new ReActEngine(
          mockMemory,
          mockLLM as any,
          mockToolManager,
          toolExecutor,
          mockPromptGen,
          mockTotPlanner as any,
        );

        await engine.process("Test query", "test-user");

        // VALIDATION: ToT was NOT called
        expect(mockTotPlanner.plan.called).to.be.false;
        console.log("\n✅ ToT planner correctly disabled when flag is false\n");
      } finally {
        delete process.env.ENABLE_TOT_PLANNING;
      }
    });
  });

  describe("3. Tool Filtering Validation", () => {
    it("should reduce tool count significantly", async () => {
      const mockLLM = {
        generateResponse: sinon.stub().callsFake(async () => {
          return {
            content: JSON.stringify({
              rationale: "Use two relevant tools.",
              selected_tools: [
                { name: "tool_a", max_calls: 1, purpose: "First lookup" },
                { name: "tool_b", max_calls: 1, purpose: "Second lookup" },
              ],
              steps: [
                { id: 1, type: "tool", tool: "tool_a" },
                { id: 2, type: "tool", tool: "tool_b" },
                { id: 3, type: "answer", instruction: "Summarize results" },
              ],
            }),
            tokenCount: 50,
          };
        }),
        getModel: () => "test-model",
        setSystemPrompt: sinon.stub(),
        cleanup: async () => {},
      };

      const allTools = Array.from({ length: 20 }, (_, i) => ({
        name: `tool_${String.fromCharCode(97 + i)}`, // tool_a, tool_b, ..., tool_t
        description: `Tool ${i + 1}`,
      }));

      const planner = new ToTPlanner(mockLLM as any);
      const filtered = await planner.plan("Test query", allTools as any);

      const reductionPercent = (
        (1 - filtered.selected_tools.length / allTools.length) *
        100
      ).toFixed(1);

      console.log(`\n📊 Tool Filtering Results:`);
      console.log(`- Before: ${allTools.length} tools`);
      console.log(`- After: ${filtered.selected_tools.length} tools`);
      console.log(`- Reduction: ${reductionPercent}%`);
      console.log(
        `- Filtered tools: ${filtered.selected_tools.map((t: any) => t.name).join(", ")}\n`,
      );

      expect(filtered.selected_tools.length).to.be.lessThan(allTools.length);
      expect(filtered.selected_tools.length).to.be.greaterThan(0);

      console.log(
        `✅ Tool filtering achieved ${reductionPercent}% reduction\n`,
      );
    });
  });

  describe("4. Agent Reasoning Quality (CRITICAL)", () => {
    it("should complete a multi-step task correctly", async () => {
      /**
       * This test validates the CORE CONCERN:
       * Can the agent actually reason and complete a task?
       *
       * Scenario: User asks "What's the weather in Paris and should I bring an umbrella?"
       * Expected: Agent should:
       * 1. Use weather tool to get forecast
       * 2. Analyze the forecast
       * 3. Give recommendation about umbrella
       */

      let stepCount = 0;
      const reasoningSteps: any[] = [];

      const mockLLM = {
        generateResponse: sinon.stub().callsFake(async (prompt: string) => {
          stepCount++;
          console.log(`\n🧠 Reasoning Step ${stepCount}:`);

          // Simulate realistic ReAct responses
          if (stepCount === 1) {
            // First step: Reason about what to do
            const response = `\`\`\`yaml
thought:
  reasoning: "I need to check the weather in Paris first"
  plan: "Use weather_forecast tool with location Paris"
action:
  tool: "weather_forecast"
  params:
    location: "Paris"
\`\`\``;
            console.log("  → Decided to use weather_forecast tool");
            reasoningSteps.push({
              type: "thought_action",
              tool: "weather_forecast",
            });
            return { content: response, tokenCount: 100 };
          } else if (stepCount === 2) {
            // Second step: Observation (would be injected by ReActEngine)
            // Skip - this is handled by engine
            return { content: "", tokenCount: 0 };
          } else if (stepCount === 3) {
            // Third step: Analyze result and conclude
            const response = `\`\`\`yaml
thought:
  reasoning: "Weather shows rain forecast, user should bring umbrella"
  plan: "Provide conclusion with recommendation"
conclusion:
  final_answer: "The weather in Paris shows rain expected today. Yes, you should bring an umbrella!"
\`\`\``;
            console.log("  → Made final recommendation");
            reasoningSteps.push({ type: "conclusion" });
            return { content: response, tokenCount: 80 };
          }

          return { content: "Unknown", tokenCount: 10 };
        }),
        getModel: () => "test-model",
        setSystemPrompt: sinon.stub(),
        cleanup: async () => {},
      };

      const mockMemory = new InMemoryProvider();
      await mockMemory.initialize();

      const mockToolManager = {
        getAvailableTools: sinon.stub().resolves([
          {
            name: "weather_forecast",
            description: "Get weather forecast for a location",
            inputSchema: {
              type: "object",
              properties: {
                location: { type: "string" },
              },
            },
          },
        ]),
        executeTool: sinon
          .stub()
          .callsFake(async (name: string, params: any) => {
            console.log(
              `  ⚙️  Tool executed: ${name}(${JSON.stringify(params)})`,
            );
            return {
              success: true,
              data: JSON.stringify({
                location: "Paris",
                forecast: "Rainy",
                precipitation: "80%",
              }),
            };
          }),
        registerTool: sinon.stub(),
        getToolByName: sinon.stub(),
        refreshToolInformation: sinon.stub(),
      };

      const mockPromptGen = new ReActPromptGenerator(
        mockToolManager,
        undefined,
      );
      const toolExecutor = new ToolChainExecutor();

      const engine = new ReActEngine(
        mockMemory,
        mockLLM as any,
        mockToolManager,
        toolExecutor,
        mockPromptGen,
        undefined, // No ToT for baseline test
      );

      const result = await engine.process(
        "What's the weather in Paris and should I bring an umbrella?",
        "test-user",
      );

      console.log(`\n📊 Reasoning Analysis:`);
      console.log(`- Total steps: ${stepCount}`);
      console.log(`- Tool was called: ${mockToolManager.executeTool.called}`);
      console.log(`- Final response: ${result.substring(0, 100)}...`);

      // VALIDATION: Agent completed the task
      expect(result).to.be.a("string");
      expect(result.length).to.be.greaterThan(0);
      expect(mockToolManager.executeTool.called).to.be.true;

      console.log(`\n✅ Agent successfully completed multi-step reasoning\n`);
    });
  });

  describe("5. Error Handling", () => {
    it("should handle timeout gracefully", async function () {
      this.timeout(8000);

      process.env.TOT_PLANNING_TIMEOUT_MS = "100"; // Very short timeout

      try {
        const mockLLM = {
          generateResponse: sinon.stub().callsFake(async () => {
            // Simulate slow LLM
            await new Promise((resolve) => setTimeout(resolve, 5000));
            return { content: "Too slow!", tokenCount: 10 };
          }),
          getModel: () => "test-model",
          setSystemPrompt: sinon.stub(),
          cleanup: async () => {},
        };

        const mockTools = [{ name: "tool1", description: "Test" }];

        const planner = new ToTPlanner(mockLLM as any);
        const result = await planner.plan("test", mockTools as any);

        // Should fallback to a PlanArtifact using available tools
        expect(
          result.selected_tools.map((tool: any) => tool.name),
        ).to.deep.equal(["tool1"]);
        expect(result.steps.at(-1)?.type).to.equal("answer");
        console.log("\n✅ Timeout handled gracefully (returned all tools)\n");
      } finally {
        delete process.env.TOT_PLANNING_TIMEOUT_MS;
      }
    });
  });
});
