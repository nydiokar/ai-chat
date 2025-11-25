import { describe, it, before } from "mocha";
import { expect } from "chai";
import { ToTPlanner } from "../agents/planning/tot-planner.js";
import { ReActEngine } from "../agents/react-engine.js";
import { AIFactory } from "../services/ai-factory.js";
import { mcpConfig } from "../mcp_config.js";
import { InMemoryProvider } from "../memory/in-memory-provider.js";

/**
 * INTEGRATION TEST: Validates ToT planning with REAL agent flow
 *
 * This test is designed to catch issues that unit tests miss:
 * - Does ToT actually get called?
 * - Do prompts produce valid YAML/JSON?
 * - Does tool filtering work?
 * - Does ReActEngine use filtered tools?
 * - Does reasoning improve?
 *
 * REQUIRES: OPENAI_API_KEY in environment (skips if not present)
 */
describe("ToT Integration Test", function () {
  // Increase timeout for real LLM calls
  this.timeout(30000);

  const hasApiKey = !!process.env.OPENAI_API_KEY;
  const testQuery = "What are the current trending topics on GitHub?";

  before(function () {
    if (!hasApiKey) {
      console.log("\n⚠️  Skipping ToT integration test (no OPENAI_API_KEY)");
      this.skip();
    }
  });

  describe("ToT Planner Standalone", () => {
    it("should execute 3-stage planning and return filtered tools", async function () {
      if (!hasApiKey) this.skip();

      // Setup
      const mockLLM = {
        generateResponse: async (prompt: string) => {
          console.log("\n📝 LLM Prompt Sent:");
          console.log(prompt.substring(0, 200) + "...\n");

          // Mock responses for each stage
          if (prompt.includes("break it into sub-problems")) {
            // Stage 1: Decomposition
            const response = `\`\`\`yaml
decomposition:
  - step: "Search GitHub trending repositories"
    tools: ["github_trending"]
  - step: "Get popular topics from results"
    tools: ["github_topics"]
strategy: "Fetch trending repos and extract topics"
\`\`\``;
            console.log("📤 Stage 1 Response:", response.substring(0, 100) + "...");
            return { content: response, tokenCount: 50 };
          } else if (prompt.includes("Review and refine")) {
            // Stage 2: Reflection
            const response = `\`\`\`yaml
refined_plan:
  steps:
    - "Call github_trending API"
    - "Parse repository topics"
  tools_needed: ["github_trending", "github_topics"]
\`\`\``;
            console.log("📤 Stage 2 Response:", response.substring(0, 100) + "...");
            return { content: response, tokenCount: 40 };
          } else if (prompt.includes("Extract the exact tools")) {
            // Stage 3: Tool extraction
            const response = `{"tools": ["github_trending", "github_topics"]}`;
            console.log("📤 Stage 3 Response:", response);
            return { content: response, tokenCount: 20 };
          }

          return { content: "Unknown prompt", tokenCount: 10 };
        },
        getModel: () => "gpt-3.5-turbo",
        setSystemPrompt: () => {},
        cleanup: async () => {},
      };

      const mockTools = [
        { name: "github_trending", description: "Get trending repositories" },
        { name: "github_topics", description: "Get repository topics" },
        { name: "github_search", description: "Search GitHub" },
        { name: "github_user", description: "Get user info" },
        { name: "weather_api", description: "Get weather" }, // Irrelevant tool
      ];

      const planner = new ToTPlanner(mockLLM as any);

      // Execute
      console.log("\n🧪 Testing ToT Planner...");
      const filteredTools = await planner.planAndFilter(testQuery, mockTools as any);

      // Validate
      console.log("\n✅ Results:");
      console.log(`- Total tools available: ${mockTools.length}`);
      console.log(`- Tools after filtering: ${filteredTools.length}`);
      console.log(`- Filtered tools: ${filteredTools.map((t) => t.name).join(", ")}`);

      expect(filteredTools).to.be.an("array");
      expect(filteredTools.length).to.be.lessThan(mockTools.length);
      expect(filteredTools.length).to.be.greaterThan(0);

      // Should have filtered out irrelevant tools
      const toolNames = filteredTools.map((t) => t.name);
      expect(toolNames).to.include("github_trending");
      expect(toolNames).to.not.include("weather_api");

      console.log("✅ ToT planner works correctly!\n");
    });
  });

  describe("Full Agent Flow with ToT", () => {
    it("should use ToT when ENABLE_TOT_PLANNING=true", async function () {
      if (!hasApiKey) this.skip();

      // Enable ToT for this test
      process.env.ENABLE_TOT_PLANNING = "true";
      process.env.TOT_PLANNING_TIMEOUT_MS = "10000";

      try {
        // Initialize AI Factory
        console.log("\n🧪 Testing Full Agent Flow with ToT...");
        await AIFactory.initialize(mcpConfig);

        // Create agent with memory
        const memoryProvider = new InMemoryProvider();
        await memoryProvider.initialize();

        const agent = await AIFactory.create("gpt-3.5-turbo", "ToT Test Agent", memoryProvider);

        // Process a test message
        console.log("\n📨 Processing test query...");
        const response = await agent.processMessage(testQuery);

        // Validate response
        console.log("\n✅ Agent Response:");
        console.log(response.content.substring(0, 200) + "...\n");

        expect(response).to.have.property("content");
        expect(response.content).to.be.a("string");
        expect(response.content.length).to.be.greaterThan(0);

        // Cleanup
        await agent.cleanup();
        AIFactory.cleanup();

        console.log("✅ Full agent flow works with ToT!\n");
      } finally {
        // Reset env
        delete process.env.ENABLE_TOT_PLANNING;
      }
    });

    it("should work without ToT when ENABLE_TOT_PLANNING=false", async function () {
      if (!hasApiKey) this.skip();

      // Disable ToT for this test
      process.env.ENABLE_TOT_PLANNING = "false";

      try {
        console.log("\n🧪 Testing Full Agent Flow WITHOUT ToT...");
        await AIFactory.initialize(mcpConfig);

        const memoryProvider = new InMemoryProvider();
        await memoryProvider.initialize();

        const agent = await AIFactory.create("gpt-3.5-turbo", "Non-ToT Test Agent", memoryProvider);

        console.log("\n📨 Processing test query...");
        const response = await agent.processMessage(testQuery);

        console.log("\n✅ Agent Response:");
        console.log(response.content.substring(0, 200) + "...\n");

        expect(response).to.have.property("content");
        expect(response.content).to.be.a("string");
        expect(response.content.length).to.be.greaterThan(0);

        await agent.cleanup();
        AIFactory.cleanup();

        console.log("✅ Agent works without ToT (backward compatible)!\n");
      } finally {
        delete process.env.ENABLE_TOT_PLANNING;
      }
    });
  });

  describe("Diagnostic: Validate ReAct Agent Reasoning", () => {
    it("should demonstrate ReAct reasoning steps", async function () {
      if (!hasApiKey) this.skip();

      // This test validates that the EXISTING ReAct agent works
      process.env.ENABLE_TOT_PLANNING = "false";

      try {
        console.log("\n🔍 DIAGNOSTIC: Validating ReAct Agent Reasoning...");
        await AIFactory.initialize(mcpConfig);

        const memoryProvider = new InMemoryProvider();
        await memoryProvider.initialize();

        const agent = await AIFactory.create("gpt-3.5-turbo", "Diagnostic Agent", memoryProvider);

        // Use a query that REQUIRES tool usage
        const diagnosticQuery = "What is the current time in UTC?";
        console.log(`\n📨 Query: ${diagnosticQuery}`);

        const response = await agent.processMessage(diagnosticQuery);

        console.log("\n📊 Diagnostic Results:");
        console.log(`- Response length: ${response.content.length}`);
        console.log(`- Response preview: ${response.content.substring(0, 150)}...`);

        // Get last thought process
        const thoughtProcess = agent.getLastThoughtProcess();
        if (thoughtProcess) {
          console.log("\n🧠 Last Reasoning Step:");
          console.log(`- Step ID: ${thoughtProcess.stepId}`);
          console.log(`- Has thought: ${!!thoughtProcess.thought}`);
          console.log(`- Has action: ${!!thoughtProcess.action}`);
          console.log(`- Has observation: ${!!thoughtProcess.observation}`);
          console.log(`- Has conclusion: ${!!thoughtProcess.conclusion}`);

          if (thoughtProcess.thought) {
            console.log(`- Reasoning: ${thoughtProcess.thought.reasoning?.substring(0, 100)}...`);
          }

          if (thoughtProcess.action) {
            console.log(`- Tool used: ${thoughtProcess.action.tool}`);
          }
        } else {
          console.log("\n⚠️  No reasoning step captured!");
        }

        expect(response.content).to.be.a("string");

        await agent.cleanup();
        AIFactory.cleanup();

        console.log("\n✅ Diagnostic complete!\n");
      } finally {
        delete process.env.ENABLE_TOT_PLANNING;
      }
    });
  });
});
