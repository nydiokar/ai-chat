import { LLMProvider } from "../../../interfaces/llm-provider.js";
import { Input, Response } from "../../../types/common.js";
import { ToolDefinition } from "../../../tools/mcp/types/tools.js";

/**
 * A scriptable LLM provider for eval scenarios.
 *
 * You provide an ordered list of YAML response strings (the same format
 * the real LLM returns). Each call to generateResponse() pops the next
 * one off the queue. If the queue is exhausted, it returns a forced
 * conclusion so the loop terminates instead of hanging.
 */
export class MockLLMProvider implements LLMProvider {
  private readonly responses: string[];
  private callIndex = 0;
  private readonly prompts: string[] = [];

  constructor(responses: string[]) {
    this.responses = [...responses];
  }

  async generateResponse(
    message: string,
    _conversationHistory?: Input[],
    _tools?: ToolDefinition[],
  ): Promise<Response> {
    this.prompts.push(message);

    const content =
      this.callIndex < this.responses.length
        ? this.responses[this.callIndex]
        : this.makeForcedConclusion();

    this.callIndex++;

    return {
      content,
      tokenCount: content.length,
      toolResults: [],
    };
  }

  getModel(): string {
    return "eval-mock";
  }

  setSystemPrompt(_prompt: string): void {}

  async cleanup(): Promise<void> {}

  /** How many times generateResponse was called */
  get callCount(): number {
    return this.callIndex;
  }

  /** All prompts that were sent to the mock LLM, in order */
  get receivedPrompts(): readonly string[] {
    return this.prompts;
  }

  private makeForcedConclusion(): string {
    return [
      "```yaml",
      "thought:",
      '  reasoning: "Queue exhausted — forced conclusion."',
      '  plan: "Finish."',
      "conclusion:",
      '  final_answer: "[EVAL ERROR] LLM response queue exhausted — scenario has fewer responses than the engine needed."',
      "```",
    ].join("\n");
  }
}
