import { PromptGenerator } from "../../../interfaces/prompt-generator.js";
import { ToolDefinition } from "../../../tools/mcp/types/tools.js";
import { Input } from "../../../types/common.js";
import { ReasoningStep } from "../../../interfaces/react-types.js";

/**
 * Transparent prompt generator for evals.
 *
 * Captures every prompt that would be sent to the LLM so assertions
 * can verify scratchpad injection, tool listing, step history, etc.
 */
export class MockPromptGenerator implements PromptGenerator {
  private readonly generatedPrompts: Array<{
    input: string;
    steps: ReasoningStep[];
    tools: ToolDefinition[];
    currentStep: number;
    scratchpadSummary?: string;
  }> = [];

  async generatePrompt(
    input: string,
    tools: ToolDefinition[],
    _history?: Input[],
  ): Promise<string> {
    return `Prompt: ${input}\nTools: ${tools.map((t) => t.name).join(",")}`;
  }

  async generateReActPrompt(
    input: string,
    steps?: ReasoningStep[],
    tools?: ToolDefinition[],
    currentStep?: number,
    scratchpadSummary?: string,
  ): Promise<string> {
    const record = {
      input,
      steps: steps ?? [],
      tools: tools ?? [],
      currentStep: currentStep ?? 0,
      scratchpadSummary,
    };
    this.generatedPrompts.push(record);

    const parts = [
      `[Step ${currentStep ?? 0}]`,
      `Input: ${input}`,
      `Tools: ${(tools ?? []).map((t) => t.name).join(",")}`,
    ];

    if (scratchpadSummary) {
      parts.push(`Scratchpad:\n${scratchpadSummary}`);
    }

    if (steps && steps.length > 0) {
      parts.push(`Prior steps: ${steps.length}`);
    }

    return parts.join("\n");
  }

  // --- Inspection ---

  get prompts(): ReadonlyArray<{
    input: string;
    steps: ReasoningStep[];
    tools: ToolDefinition[];
    currentStep: number;
    scratchpadSummary?: string;
  }> {
    return this.generatedPrompts;
  }

  /** Get the scratchpad summary that was injected at a given step index */
  scratchpadAt(stepIndex: number): string | undefined {
    return this.generatedPrompts[stepIndex]?.scratchpadSummary;
  }

  /** Get the tools listed at a given step index */
  toolsAt(stepIndex: number): string[] {
    return (this.generatedPrompts[stepIndex]?.tools ?? []).map((t) => t.name);
  }
}
