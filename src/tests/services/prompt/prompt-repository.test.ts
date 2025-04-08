import { expect } from "chai";
import { PromptRepository, defaultPrompts } from "../../../services/prompt/prompt-repository.js";
import { BasePrompt, PromptType } from "../../../types/prompts.js";

describe("PromptRepository", () => {
  let repository: PromptRepository;

  beforeEach(() => {
    repository = new PromptRepository();
  });

  describe("Input Validation", () => {
    it("should validate prompt type", () => {
      const invalidPrompt = {
        type: "invalid_type" as PromptType,
        content: "test",
        priority: 1,
        shouldApply: () => true
      };

      expect(() => repository.addPrompt(invalidPrompt)).to.throw("Invalid prompt type");
    });

    it("should validate content is not empty", () => {
      const emptyPrompt = {
        type: PromptType.BEHAVIORAL,
        content: "",
        priority: 1,
        shouldApply: () => true
      };

      expect(() => repository.addPrompt(emptyPrompt)).to.throw("content must be a non-empty string");
    });

    it("should validate priority is a positive number", () => {
      const invalidPriorityPrompt = {
        type: PromptType.BEHAVIORAL,
        content: "test",
        priority: -1,
        shouldApply: () => true
      };

      expect(() => repository.addPrompt(invalidPriorityPrompt)).to.throw("priority must be a positive number");
    });
  });

  describe("Error Handling", () => {
    it("should return behavioral prompt as fallback on error", () => {
      const invalidType = "INVALID" as PromptType;
      const result = repository.getFallbackPrompt(invalidType);
      
      expect(result).to.equal(defaultPrompts[PromptType.BEHAVIORAL]);
    });

    it("should handle errors in shouldApply functions", () => {
      const errorPrompt: BasePrompt = {
        type: PromptType.BEHAVIORAL,
        content: "test",
        priority: 1,
        shouldApply: () => { throw new Error("Test error"); }
      };

      repository.addPrompt(errorPrompt);
      const prompts = repository.getApplicablePrompts({});
      
      // Should still return default behavioral prompt
      expect(prompts).to.have.length(1);
      expect(prompts[0]).to.equal(defaultPrompts[PromptType.BEHAVIORAL]);
    });
  });

  describe("Priority Handling", () => {
    it("should sort prompts by priority", () => {
      const lowPriority: BasePrompt = {
        type: PromptType.BEHAVIORAL,
        content: "low",
        priority: 1,
        shouldApply: () => true
      };

      const highPriority: BasePrompt = {
        type: PromptType.BEHAVIORAL,
        content: "high",
        priority: 10,
        shouldApply: () => true
      };

      repository.addPrompt(lowPriority);
      repository.addPrompt(highPriority);

      const prompts = repository.getApplicablePrompts({});
      expect(prompts[0].content).to.equal("high");
      expect(prompts[1].content).to.equal("low");
    });
  });
});
