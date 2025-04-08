import { expect } from "chai";
import { 
  BehavioralPrompt, 
  PromptType, 
  ToolUsagePrompt, 
  ReasoningPrompt 
} from "../../../types/prompts.js";
import { PromptRepository } from "../../../services/prompt/prompt-repository.js";
import { PromptMiddleware } from "../../../services/prompt/prompt-middleware.js";

describe("PromptMiddleware", () => {
  let repository: PromptRepository;
  let middleware: PromptMiddleware;

  beforeEach(() => {
    repository = new PromptRepository();
    middleware = new PromptMiddleware(repository);
  });

  describe("Request Analysis", () => {
    it("should detect tool usage requests", async () => {
      const request = "Please [Calling tool github_search with args {}]";
      const result = await middleware.processRequest(request);
      
      expect(result).to.include("Tool Usage Guidelines");
      expect(result).to.include(repository.getFallbackPrompt(PromptType.TOOL_USAGE).content);
    });

    it("should detect reasoning requests", async () => {
      const request = "Can you help me understand how this algorithm works?";
      const result = await middleware.processRequest(request);
      
      expect(result).to.include("Problem-Solving Approach");
      expect(result).to.include(repository.getFallbackPrompt(PromptType.REASONING).content);
    });

    it("should detect complex requests with both tool usage and reasoning", async () => {
      const request = "Can you analyze this code and [Using tool git_blame] to find who made these changes?";
      const result = await middleware.processRequest(request);
      
      expect(result).to.include("Tool Usage Guidelines");
      expect(result).to.include("Problem-Solving Approach");
    });

    it("should always include behavioral prompts", async () => {
      const request = "Simple request";
      const result = await middleware.processRequest(request);
      
      expect(result).to.include("Behavior and Communication");
      expect(result).to.include(repository.getFallbackPrompt(PromptType.BEHAVIORAL).content);
    });
  });

  describe("Prompt Combination", () => {
    it("should combine multiple prompts with correct ordering", async () => {
      // Add custom prompts of different types
      const behavioral: BehavioralPrompt = {
        type: PromptType.BEHAVIORAL,
        content: "Custom behavioral content",
        priority: 2,
        tone: "technical",
        style: {
          formatting: "concise",
          language: "formal"
        },
        shouldApply: () => true
      };

      const toolUsage: ToolUsagePrompt = {
        type: PromptType.TOOL_USAGE,
        content: "Custom tool usage content",
        priority: 3,
        tools: ["test"],
        usagePatterns: {
          bestPractices: [],
          commonErrors: []
        },
        shouldApply: () => true
      };

      repository.addPrompt(behavioral);
      repository.addPrompt(toolUsage);

      const request = "[Using tool test] with some parameters";
      const result = await middleware.processRequest(request);
      
      // Check ordering and sections
      const behaviorIndex = result.indexOf("Behavior and Communication");
      const toolUsageIndex = result.indexOf("Tool Usage Guidelines");
      
      expect(behaviorIndex).to.be.greaterThan(-1);
      expect(toolUsageIndex).to.be.greaterThan(-1);
      expect(behaviorIndex).to.be.lessThan(toolUsageIndex);
    });
  });

  describe("Error Handling", () => {
    it("should handle empty requests", async () => {
      const result = await middleware.processRequest("");
      expect(result).to.include(repository.getFallbackPrompt(PromptType.BEHAVIORAL).content);
    });

    it("should use fallbacks when no prompts match", async () => {
      // Add custom prompts that never apply
      const customPrompt: BehavioralPrompt = {
        type: PromptType.BEHAVIORAL,
        content: "Custom content",
        priority: 1,
        tone: "professional",
        style: {
          formatting: "concise",
          language: "formal"
        },
        shouldApply: () => false
      };

      repository.addPrompt(customPrompt);
      
      const result = await middleware.processRequest("test request");
      expect(result).to.include(repository.getFallbackPrompt(PromptType.BEHAVIORAL).content);
    });
  });
});
