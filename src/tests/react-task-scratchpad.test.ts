import { describe, it } from "mocha";
import { expect } from "chai";
import { TaskScratchpad } from "../agents/task-scratchpad.js";
import { GroundedObservation, ReasoningStep } from "../interfaces/react-types.js";

function makeStep(overrides: Partial<ReasoningStep> = {}): ReasoningStep {
  return {
    stepId: `step_${Date.now()}`,
    isComplete: false,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function successObs(summary: string, sourceRefs?: string[]): GroundedObservation {
  return { kind: "success", result: "raw", summary, sourceRefs };
}

function errorObs(tool: string, kind: NonNullable<NonNullable<GroundedObservation["error"]>["kind"]>): GroundedObservation {
  return {
    kind: "error",
    result: "raw",
    summary: `${tool} failed: something went wrong`,
    tool,
    error: { message: "something went wrong", kind },
  };
}

describe("TaskScratchpad", () => {
  it("initialises with the goal", () => {
    const sp = new TaskScratchpad("find the best coffee shop");
    expect(sp.getState().goal).to.equal("find the best coffee shop");
  });

  it("extracts a fact from a successful observation", () => {
    const sp = new TaskScratchpad("test goal");
    sp.update(makeStep({ observation: successObs("Coffee prices dropped 10% in Q1") }));
    expect(sp.getState().facts).to.include("Coffee prices dropped 10% in Q1");
  });

  it("records source refs as a separate fact", () => {
    const sp = new TaskScratchpad("test goal");
    sp.update(makeStep({
      observation: successObs("Found 2 results", ["https://a.com", "https://b.com"]),
    }));
    const { facts } = sp.getState();
    expect(facts.some((f) => f.includes("https://a.com"))).to.be.true;
  });

  it("records attempted tool actions", () => {
    const sp = new TaskScratchpad("test goal");
    sp.update(makeStep({
      action: { tool: "web_search", params: { query: "test" }, purpose: "find info" },
    }));
    expect(sp.getState().attemptedActions).to.include("web_search (find info)");
  });

  it("does not duplicate the same attempted action", () => {
    const sp = new TaskScratchpad("test goal");
    const step = makeStep({ action: { tool: "web_search", params: {}, purpose: "find info" } });
    sp.update(step);
    sp.update(step);
    expect(sp.getState().attemptedActions.filter((a) => a.includes("web_search")).length).to.equal(1);
  });

  it("records error observations as failures", () => {
    const sp = new TaskScratchpad("test goal");
    sp.update(makeStep({ observation: errorObs("web_search", "timeout") }));
    const { failures } = sp.getState();
    expect(failures.some((f) => f.includes("web_search") && f.includes("timeout"))).to.be.true;
  });

  it("records empty observations as failures", () => {
    const sp = new TaskScratchpad("test goal");
    sp.update(makeStep({
      observation: { kind: "empty", result: "", summary: "no results", tool: "lookup" },
    }));
    expect(sp.getState().failures.some((f) => f.includes("lookup"))).to.be.true;
  });

  it("records ask_user questions as open questions", () => {
    const sp = new TaskScratchpad("test goal");
    sp.update(makeStep({ ask_user: { question: "Which city are you in?", reason: "needed for search" } }));
    expect(sp.getState().openQuestions).to.include("Which city are you in?");
  });

  it("sets nextBestAction from a recover step", () => {
    const sp = new TaskScratchpad("test goal");
    sp.update(makeStep({ recover: { strategy: "try a different search term", reason: "first attempt failed" } }));
    expect(sp.getState().nextBestAction).to.equal("try a different search term");
  });

  it("applyDecision updates nextBestAction from a recover decision", () => {
    const sp = new TaskScratchpad("test goal");
    sp.applyDecision({ type: "recover", strategy: "use a broader query", reason: "too narrow", stepId: "s1" });
    expect(sp.getState().nextBestAction).to.equal("use a broader query");
  });

  it("applyDecision records ask_user question as open question", () => {
    const sp = new TaskScratchpad("test goal");
    sp.applyDecision({ type: "ask_user", question: "What is the budget?", stepId: "s1" });
    expect(sp.getState().openQuestions).to.include("What is the budget?");
  });

  it("render includes goal, facts, tried tools, and failures", () => {
    const sp = new TaskScratchpad("find coffee");
    sp.update(makeStep({ action: { tool: "web_search", params: {} } }));
    sp.update(makeStep({ observation: successObs("Found 3 cafes nearby") }));
    sp.update(makeStep({ observation: errorObs("yelp_api", "not_found") }));

    const rendered = sp.render();
    expect(rendered).to.include("Goal: find coffee");
    expect(rendered).to.include("Found 3 cafes nearby");
    expect(rendered).to.include("web_search");
    expect(rendered).to.include("yelp_api");
    expect(rendered).to.include("not_found");
  });

  it("render does not include empty sections", () => {
    const sp = new TaskScratchpad("simple goal");
    const rendered = sp.render();
    expect(rendered).to.equal("Goal: simple goal");
    expect(rendered).not.to.include("Facts:");
    expect(rendered).not.to.include("Tried:");
    expect(rendered).not.to.include("Failures:");
  });
});
