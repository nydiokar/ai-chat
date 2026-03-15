import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import { ReActEngine } from "../agents/react-engine.js";
import { MemoryProvider, MemoryType } from "../interfaces/memory-provider.js";
import { LLMProvider } from "../interfaces/llm-provider.js";
import { IToolManager } from "../tools/mcp/interfaces/core.js";
import { PromptGenerator } from "../interfaces/prompt-generator.js";
import { ToolChainExecutor } from "../tools/tool-chain/tool-chain-executor.js";
import { ToolDefinition } from "../tools/mcp/types/tools.js";

class MockMemoryProvider implements MemoryProvider {
  async initialize(): Promise<void> {}
  async store(entry: any): Promise<any> {
    return { id: "memory-entry", timestamp: new Date(), ...entry };
  }
  async storeThoughtProcess(
    reasoningStep: any,
    userId: string,
    metadata?: Record<string, any>,
  ): Promise<any> {
    return {
      id: reasoningStep.stepId,
      userId,
      type: MemoryType.THOUGHT_PROCESS,
      content: { step: reasoningStep },
      metadata,
      timestamp: new Date(),
    };
  }
  async search(): Promise<any> {
    return { entries: [], total: 0, hasMore: false };
  }
  async getById(): Promise<any> {
    return null;
  }
  async update(): Promise<any> {
    return null;
  }
  async delete(): Promise<boolean> {
    return true;
  }
  async getSummary(): Promise<string> {
    return "";
  }
  async clearUserMemories(): Promise<void> {}
  async getRelevantMemories(): Promise<any[]> {
    return [];
  }
  async cleanup(): Promise<void> {}
}

describe("ReActEngine", () => {
  let memory: MemoryProvider;
  let llm: LLMProvider;
  let toolManager: IToolManager;
  let promptGenerator: PromptGenerator;
  let toolExecutor: ToolChainExecutor;
  let engine: ReActEngine;
  let availableTools: ToolDefinition[];
  let llmGenerateResponseStub: sinon.SinonStub;
  let toolExecuteStub: sinon.SinonStub;
  let promptGenerateStub: sinon.SinonStub;

  beforeEach(() => {
    memory = new MockMemoryProvider();
    availableTools = [
      {
        name: "web_search",
        description: "Search the web",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
      },
    ];

    llm = {
      generateResponse: (llmGenerateResponseStub = sinon.stub()),
      getModel: () => "test-model",
      setSystemPrompt: sinon.stub(),
      cleanup: sinon.stub().resolves(),
    };

    toolManager = {
      getAvailableTools: sinon.stub().resolves(availableTools),
      getToolByName: sinon.stub(),
      executeTool: (toolExecuteStub = sinon.stub().resolves({
        success: true,
        data: "tool result",
      })),
      registerTool: sinon.stub(),
      refreshToolInformation: sinon.stub(),
    };

    promptGenerator = {
      generatePrompt: sinon.stub().resolves("fallback prompt"),
      generateReActPrompt: (promptGenerateStub = sinon.stub().callsFake(
        async (
          input: string,
          _steps?: any[],
          tools?: ToolDefinition[],
          currentStep?: number,
        ) => `Prompt ${currentStep ?? 0}: ${input}\nTools:${tools?.map((t) => t.name).join(",") ?? ""}`,
      )),
    };

    toolExecutor = {
      execute: sinon.stub(),
    } as unknown as ToolChainExecutor;

    engine = new ReActEngine(
      memory,
      llm,
      toolManager,
      toolExecutor,
      promptGenerator,
    );
  });

  it("finishes immediately on an explicit conclusion", async () => {
    llmGenerateResponseStub.resolves({
      content: `\`\`\`yaml
thought:
  reasoning: I already have enough information.
  plan: Finish now.
conclusion:
  final_answer: Final answer from engine test.
  explanation: Grounded in prior evidence.
\`\`\``,
      tokenCount: null,
      toolResults: [],
    });

    const result = await engine.process("test query", "user-1");

    expect(result).to.equal("Final answer from engine test.");
    expect(toolExecuteStub.called).to.be.false;
    expect(llmGenerateResponseStub.calledOnce).to.be.true;
  });

  it("returns a clarification question on ask_user without executing tools", async () => {
    llmGenerateResponseStub.resolves({
      content: `\`\`\`yaml
thought:
  reasoning: The task is ambiguous.
  plan: Ask one focused question.
ask_user:
  question: Which repository should I inspect?
  reason: I need a concrete repository target before proceeding.
\`\`\``,
      tokenCount: null,
      toolResults: [],
    });

    const result = await engine.process("inspect the repo", "user-2");

    expect(result).to.equal("Which repository should I inspect?");
    expect(toolExecuteStub.called).to.be.false;
    expect(llmGenerateResponseStub.calledOnce).to.be.true;
  });

  it("supports recover before continuing to a final answer", async () => {
    llmGenerateResponseStub
      .onFirstCall()
      .resolves({
        content: `\`\`\`yaml
thought:
  reasoning: The previous approach is too broad.
  plan: Recover before taking the next step.
recover:
  strategy: Narrow the search to the exact entity requested.
  reason: The current approach would gather noisy evidence.
\`\`\``,
        tokenCount: null,
        toolResults: [],
      })
      .onSecondCall()
      .resolves({
        content: `\`\`\`yaml
thought:
  reasoning: The recovery plan is now clear enough to answer.
  plan: Finish with the corrected answer.
conclusion:
  final_answer: Recovered final answer.
  explanation: After revising the strategy, the answer is clear.
\`\`\``,
        tokenCount: null,
        toolResults: [],
      });

    const result = await engine.process("test recovery", "user-3");

    expect(result).to.equal("Recovered final answer.");
    expect(llmGenerateResponseStub.calledTwice).to.be.true;
    expect(toolExecuteStub.called).to.be.false;
    const secondPrompt = promptGenerateStub.secondCall.args[1];
    expect(secondPrompt.some((step: any) => step.observation?.result.includes("Recovery requested."))).to.be.true;
  });
});
