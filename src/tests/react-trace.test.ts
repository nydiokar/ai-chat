import { describe, it, beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import * as sinon from "sinon";
import { ReActTrace } from "../agents/react-trace.js";
import { MemoryProvider, MemoryType } from "../interfaces/memory-provider.js";
import { ReasoningStep } from "../interfaces/react-types.js";

// Create a mock for MemoryProvider
class MockMemoryProvider implements MemoryProvider {
  public storeThoughtProcessStub: sinon.SinonStub;
  public searchStub: sinon.SinonStub;

  constructor() {
    this.storeThoughtProcessStub = sinon.stub();
    this.searchStub = sinon.stub();
  }

  async initialize(): Promise<void> {
    /* Not used in tests */
  }
  async store(): Promise<any> {
    /* Not used in tests */ return { id: "mock-id" };
  }
  async storeThoughtProcess(
    step: ReasoningStep,
    userId: string,
    metadata?: Record<string, any>,
  ): Promise<any> {
    return this.storeThoughtProcessStub(step, userId, metadata);
  }
  async search(): Promise<any> {
    return this.searchStub();
  }
  async getById(): Promise<any> {
    /* Not used in tests */ return null;
  }
  async update(): Promise<any> {
    /* Not used in tests */ return { id: "mock-id" };
  }
  async delete(): Promise<boolean> {
    /* Not used in tests */ return true;
  }
  async getSummary(): Promise<string> {
    /* Not used in tests */ return "";
  }
  async clearUserMemories(): Promise<void> {
    /* Not used in tests */
  }
  async getRelevantMemories(): Promise<any[]> {
    /* Not used in tests */ return [];
  }
  async cleanup(): Promise<void> {
    /* Not used in tests */
  }
}

describe("ReActTrace", () => {
  let memoryProviderMock: MockMemoryProvider;
  let trace: ReActTrace;
  let sandbox: sinon.SinonSandbox;
  const userId = "test-user-id";

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Create a mock memory provider
    memoryProviderMock = new MockMemoryProvider();

    // Setup the search method to return empty results by default
    memoryProviderMock.searchStub.resolves({
      entries: [],
      total: 0,
      hasMore: false,
    });

    // Setup the storeThoughtProcess stub to resolve successfully
    memoryProviderMock.storeThoughtProcessStub.resolves({
      id: "mock-memory-id",
      userId: "test-user-id",
      type: MemoryType.THOUGHT_PROCESS,
      content: {},
      timestamp: new Date(),
    });

    // Create the trace instance with the mock memory provider
    trace = new ReActTrace(
      memoryProviderMock as unknown as MemoryProvider,
      userId,
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should create a new trace with a unique session ID", () => {
    expect(trace.getSessionId()).to.be.a("string").and.not.empty;
    expect(trace.getUserId()).to.equal(userId);
  });

  it("should add steps to the trace", async () => {
    const step: ReasoningStep = {
      stepId: "step1",
      timestamp: new Date().toISOString(),
      thought: {
        reasoning: "Test reasoning",
        plan: "Test plan",
      },
      isComplete: false,
    };

    await trace.addStep(step);

    const steps = trace.getSteps();
    expect(steps).to.have.lengthOf(1);
    expect(steps[0]).to.deep.equal(step);

    // Verify memory provider was called
    expect(memoryProviderMock.storeThoughtProcessStub.calledOnce).to.be.true;
    expect(
      memoryProviderMock.storeThoughtProcessStub.firstCall.args[0],
    ).to.deep.equal(step);
    expect(
      memoryProviderMock.storeThoughtProcessStub.firstCall.args[1],
    ).to.equal(userId);
    expect(
      memoryProviderMock.storeThoughtProcessStub.firstCall.args[2],
    ).to.have.property("sessionId");
  });

  it("should add steps without saving to memory when specified", async () => {
    const step: ReasoningStep = {
      stepId: "step2",
      timestamp: new Date().toISOString(),
      thought: {
        reasoning: "Another reasoning",
        plan: "Another plan",
      },
      isComplete: false,
    };

    await trace.addStep(step, false);

    const steps = trace.getSteps();
    expect(steps).to.have.lengthOf(1);
    expect(steps[0]).to.deep.equal(step);

    // Verify memory provider was NOT called
    expect(memoryProviderMock.storeThoughtProcessStub.called).to.be.false;
  });

  it("should get the last step correctly", async () => {
    // Add steps
    const step1: ReasoningStep = {
      stepId: "step1",
      timestamp: new Date().toISOString(),
      thought: {
        reasoning: "First reasoning",
        plan: "First plan",
      },
      isComplete: false,
    };

    const step2: ReasoningStep = {
      stepId: "step2",
      timestamp: new Date().toISOString(),
      thought: {
        reasoning: "Second reasoning",
        plan: "Second plan",
      },
      isComplete: false,
    };

    await trace.addStep(step1, false);
    await trace.addStep(step2, false);

    const lastStep = trace.getLastStep();
    expect(lastStep).to.deep.equal(step2);
  });

  it("should return null for last step when trace is empty", () => {
    const lastStep = trace.getLastStep();
    expect(lastStep).to.be.null;
  });

  it("should load steps from memory", async () => {
    const memorizedSteps: ReasoningStep[] = [
      {
        stepId: "mem1",
        timestamp: new Date().toISOString(),
        thought: {
          reasoning: "Memory reasoning 1",
          plan: "Memory plan 1",
        },
        isComplete: false,
      },
      {
        stepId: "mem2",
        timestamp: new Date().toISOString(),
        thought: {
          reasoning: "Memory reasoning 2",
          plan: "Memory plan 2",
        },
        isComplete: false,
      },
    ];

    // Setup the memory provider to return steps
    memoryProviderMock.searchStub.resolves({
      entries: memorizedSteps.map((step) => ({
        id: step.stepId,
        content: { step },
        type: MemoryType.THOUGHT_PROCESS,
        userId,
        timestamp: new Date(),
        metadata: {
          sessionId: trace.getSessionId(),
          timestamp: step.timestamp,
        },
      })),
      total: memorizedSteps.length,
      hasMore: false,
    });

    const loadedSteps = await trace.loadFromMemory();

    expect(loadedSteps).to.have.lengthOf(2);
    expect(trace.getSteps()).to.have.lengthOf(2);

    // Verify search was called
    expect(memoryProviderMock.searchStub.calledOnce).to.be.true;
  });

  it("should mark the trace as complete", () => {
    const finalResponse = "Final answer to the user";

    trace.markComplete(finalResponse);

    expect(trace.isReasoningComplete()).to.be.true;
    expect(trace.getFinalResponse()).to.equal(finalResponse);
    expect(trace.getCompletionOutcome()).to.deep.equal({
      type: "finish",
      response: finalResponse,
    });
  });

  it("should store ask_user completion outcomes", () => {
    const question = "Which repo should I use?";

    trace.markComplete(question, {
      type: "ask_user",
      question,
      reason: "missing repository target",
      stepId: "ask_1",
    });

    expect(trace.isReasoningComplete()).to.be.true;
    expect(trace.getCompletionOutcome()).to.deep.equal({
      type: "ask_user",
      response: question,
      question,
      reason: "missing repository target",
      stepId: "ask_1",
    });
  });

  it("should optimize steps correctly", async () => {
    // Create 5 steps
    const steps: ReasoningStep[] = Array(5)
      .fill(0)
      .map((_, i) => ({
        stepId: `step${i + 1}`,
        timestamp: new Date().toISOString(),
        thought: {
          reasoning: `Reasoning ${i + 1}`,
          plan: `Plan ${i + 1}`,
        },
        isComplete: false,
      }));

    // Add all steps without saving to memory
    for (const step of steps) {
      await trace.addStep(step, false);
    }

    const optimizedSteps = trace.optimizeSteps();

    // With our current simple implementation, all steps should be included
    expect(optimizedSteps).to.have.lengthOf(5);

    // First step should be the same
    expect(optimizedSteps[0]).to.deep.equal(steps[0]);

    // Last two steps should be the same
    expect(optimizedSteps[3]).to.deep.equal(steps[3]);
    expect(optimizedSteps[4]).to.deep.equal(steps[4]);
  });

  it("should extract topics from steps", async () => {
    const step: ReasoningStep = {
      stepId: "step1",
      timestamp: new Date().toISOString(),
      thought: {
        reasoning:
          "I need to search for information about artificial intelligence techniques",
        plan: "Use a search tool to find relevant articles",
      },
      action: {
        tool: "search",
        params: {
          query: "latest developments in machine learning",
        },
      },
      isComplete: false,
    };

    await trace.addStep(step, false);

    const topics = trace.extractTopics();

    expect(topics).to.be.an("array");
    expect(topics.length).to.be.greaterThan(0);

    // Check that we've extracted some meaningful words
    // With our simple implementation, should find words like:
    // search, information, artificial, intelligence, techniques, etc.
    expect(
      topics.some((topic) =>
        ["search", "information", "artificial", "intelligence"].includes(topic),
      ),
    ).to.be.true;
  });
});
