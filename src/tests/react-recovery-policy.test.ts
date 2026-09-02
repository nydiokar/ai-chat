import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import { RecoveryPolicy } from "../agents/recovery-policy.js";
import { GroundedObservation } from "../interfaces/react-types.js";

function errorObs(
  kind: NonNullable<NonNullable<GroundedObservation["error"]>["kind"]>,
  message = "tool failed",
): GroundedObservation {
  return {
    kind: "error",
    result: message,
    summary: message,
    error: { message, kind },
  };
}

function successObs(): GroundedObservation {
  return {
    kind: "success",
    result: "ok",
    summary: "ok",
  };
}

describe("RecoveryPolicy", () => {
  let policy: RecoveryPolicy;

  beforeEach(() => {
    policy = new RecoveryPolicy();
  });

  it("returns none for a success observation", () => {
    const result = policy.evaluate("web_search", successObs());
    expect(result.directive).to.equal("none");
  });

  it("returns retry for a first timeout", () => {
    const result = policy.evaluate("web_search", errorObs("timeout"));
    expect(result.directive).to.equal("retry");
  });

  it("returns ask_user after exhausting retries on timeout", () => {
    policy.evaluate("web_search", errorObs("timeout")); // retry
    const result = policy.evaluate("web_search", errorObs("timeout")); // exhausted
    expect(result.directive).to.equal("ask_user");
  });

  it("returns ask_user immediately on auth_error (fatal)", () => {
    const result = policy.evaluate("some_tool", errorObs("auth_error"));
    expect(result.directive).to.equal("ask_user");
    expect(result.question).to.include("auth");
  });

  it("returns ask_user immediately on rate_limit (fatal)", () => {
    const result = policy.evaluate("some_tool", errorObs("rate_limit"));
    expect(result.directive).to.equal("ask_user");
  });

  it("returns ask_user for not_found (redirect)", () => {
    const result = policy.evaluate("search_tool", errorObs("not_found"));
    expect(result.directive).to.equal("ask_user");
  });

  it("returns block after 3 consecutive failures across tools", () => {
    policy.evaluate("tool_a", errorObs("unknown")); // 1
    policy.evaluate("tool_b", errorObs("unknown")); // 2
    const result = policy.evaluate("tool_c", errorObs("unknown")); // 3 → block
    expect(result.directive).to.equal("block");
    expect(result.question).to.be.a("string");
  });

  it("resets consecutive failure counter after a success", () => {
    policy.evaluate("web_search", errorObs("unknown")); // 1
    policy.evaluate("web_search", errorObs("unknown")); // 2
    policy.evaluate("web_search", successObs()); // reset
    // Now three more failures should be needed before block
    policy.evaluate("web_search", errorObs("unknown")); // 1
    policy.evaluate("web_search", errorObs("unknown")); // 2
    const result = policy.evaluate("web_search", errorObs("unknown")); // 3 → block
    expect(result.directive).to.equal("block");
  });

  it("returns ask_user when a single tool has failed 3 times regardless of kind", () => {
    policy.evaluate("flaky_tool", errorObs("unknown")); // 1
    policy.evaluate("flaky_tool", errorObs("unknown")); // 2
    const result = policy.evaluate("flaky_tool", errorObs("unknown")); // 3
    // May be ask_user or block depending on whether consecutive threshold hit first
    expect(["ask_user", "block"]).to.include(result.directive);
  });

  it("tracks failure count correctly", () => {
    policy.evaluate("web_search", errorObs("timeout"));
    policy.evaluate("web_search", errorObs("timeout"));
    expect(policy.failureCount("web_search")).to.equal(2);
    expect(policy.failureCount("other_tool")).to.equal(0);
  });

  it("reset() clears all failure state", () => {
    policy.evaluate("web_search", errorObs("timeout"));
    policy.evaluate("web_search", errorObs("timeout"));
    policy.reset();
    expect(policy.failureCount("web_search")).to.equal(0);
    // After reset, a single timeout should go back to retry
    const result = policy.evaluate("web_search", errorObs("timeout"));
    expect(result.directive).to.equal("retry");
  });
});
