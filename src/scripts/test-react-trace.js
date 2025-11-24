// Quick test script for the ReActTrace component
import { ReActTrace } from "../agents/react-trace.js";
import { MemoryType } from "../interfaces/memory-provider.js";
import { getLogger } from "../utils/shared-logger.js";

// Create a mock memory provider for testing
class MockMemoryProvider {
  constructor() {
    this.memories = [];
    this.logger = getLogger("MockMemoryProvider");
  }

  async initialize() {}

  async store(memory) {
    this.memories.push(memory);
    return { id: `mem_${this.memories.length}` };
  }

  async storeThoughtProcess(step, userId, metadata) {
    return await this.store({
      userId,
      type: MemoryType.THOUGHT_PROCESS,
      content: { step },
      metadata,
    });
  }

  async search({ userId, types, metadata, sortBy, sortDirection, limit }) {
    let results = this.memories.filter(
      (memory) =>
        memory.userId === userId && (!types || types.includes(memory.type)),
    );

    if (metadata && metadata.sessionId) {
      results = results.filter(
        (memory) =>
          memory.metadata && memory.metadata.sessionId === metadata.sessionId,
      );
    }

    // Sort by timestamp if requested
    if (sortBy === "timestamp") {
      results.sort((a, b) => {
        const aTime = a.metadata?.timestamp || "0";
        const bTime = b.metadata?.timestamp || "0";
        return sortDirection === "asc"
          ? aTime.localeCompare(bTime)
          : bTime.localeCompare(aTime);
      });
    }

    // Apply limit if specified
    if (limit && limit > 0) {
      results = results.slice(0, limit);
    }

    return {
      entries: results,
      total: results.length,
      hasMore: false,
    };
  }

  // Other required methods (not used in this test)
  async getById() {
    return null;
  }
  async update() {
    return { id: "mock-id" };
  }
  async delete() {
    return true;
  }
  async getSummary() {
    return "";
  }
  async clearUserMemories() {}
  async getRelevantMemories() {
    return [];
  }
  async cleanup() {}
}

// Test the ReActTrace component
async function testReActTrace() {
  console.log("=======================================");
  console.log("Testing ReActTrace Component");
  console.log("=======================================");

  // Create the mock memory provider
  const memory = new MockMemoryProvider();

  // Create a ReActTrace instance
  const userId = "test-user";
  const trace = new ReActTrace(memory, userId);

  console.log(`Created trace with session ID: ${trace.getSessionId()}`);

  // Test adding steps to the trace
  console.log("\nAdding reasoning steps...");

  // Create a few test steps
  const steps = [
    {
      stepId: "step1",
      timestamp: new Date().toISOString(),
      thought: {
        reasoning: "Initial reasoning about the problem",
        plan: "I will break down this task step by step",
      },
      isComplete: false,
    },
    {
      stepId: "step2",
      timestamp: new Date().toISOString(),
      action: {
        tool: "search",
        params: {
          query: "latest developments in AI",
        },
      },
      isComplete: false,
    },
    {
      stepId: "step3",
      timestamp: new Date().toISOString(),
      observation: {
        result: "Found multiple articles about recent AI advancements",
      },
      isComplete: false,
    },
  ];

  // Add the steps to the trace
  for (const step of steps) {
    await trace.addStep(step);
    console.log(`Added step: ${step.stepId}`);
  }

  // Test getting all steps
  console.log("\nRetrieving all steps:");
  const allSteps = trace.getSteps();
  console.log(`Total steps: ${allSteps.length}`);

  // Test getting the last step
  console.log("\nRetrieving last step:");
  const lastStep = trace.getLastStep();
  console.log(`Last step ID: ${lastStep?.stepId}`);

  // Test optimizing steps
  console.log("\nOptimizing steps for token limits:");
  const optimizedSteps = trace.optimizeSteps(1000);
  console.log(`Optimized steps count: ${optimizedSteps.length}`);

  // Test extracting topics
  console.log("\nExtracting topics from steps:");
  const topics = trace.extractTopics();
  console.log(`Extracted topics: ${topics.join(", ")}`);

  // Test marking the trace as complete
  console.log("\nMarking the trace as complete...");
  const finalResponse =
    "After analyzing the data, I found that recent AI advancements include significant improvements in natural language processing and computer vision.";
  trace.markComplete(finalResponse);

  console.log(`Is reasoning complete: ${trace.isReasoningComplete()}`);
  console.log(
    `Final response (truncated): ${trace.getFinalResponse().substring(0, 50)}...`,
  );

  // Test loading steps from memory
  console.log("\nLoading steps from memory...");
  const loadedSteps = await trace.loadFromMemory();
  console.log(`Loaded ${loadedSteps.length} steps from memory`);

  console.log("\n=======================================");
  console.log("ReActTrace Test Completed");
  console.log("=======================================");
}

// Run the test
testReActTrace().catch((error) => {
  console.error("Error testing ReActTrace:", error);
});
