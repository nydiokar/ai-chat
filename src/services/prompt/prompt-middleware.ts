//prompt-middleware.ts

import { BasePrompt, PromptContext, PromptType } from "../../types/prompts.js";
import { PromptRepository } from "./prompt-repository.js";

export interface RequestAnalysisResult {
  type: "tool_usage" | "reasoning" | "general";
  complexity: "low" | "medium" | "high";
  tools?: string[];
}

export class PromptMiddleware {
  private readonly toolPattern = /\[(Calling tool|Using tool|Execute tool|Run tool)\s+(\w+)\s*]/i;
  private readonly reasoningPatterns = [
    /how|why|explain|analyze|compare|evaluate|solve/i,
    /what (is|are) the (reasons|benefits|drawbacks|implications)/i,
    /can you (help|assist) .* (understand|figure out|determine)/i
  ];

  constructor(private promptRepository: PromptRepository) {}

  private extractTools(request: string): string[] {
    return request.match(/\b(tool|using|execute|run)\s+(\w+)/gi)
      ?.map(match => match.split(/\s+/).pop() as string)
      .filter(Boolean) ?? [];
  }

  private calculateComplexity(
    request: string,
    hasToolUsage: boolean,
    hasReasoning: boolean,
    tools: string[]
  ): "low" | "medium" | "high" {
    const metrics = {
      length: request.length,
      conditions: (request.match(/\band\b|\bor\b|\bbut\b/g) ?? []).length,
      tools: tools.length,
      hasComplexPatterns: hasReasoning && hasToolUsage
    };

    if (metrics.length > 500 || metrics.tools > 4 || metrics.hasComplexPatterns) {
      return "high";
    }
    if (metrics.length > 200 || metrics.conditions > 3 || metrics.tools > 2) {
      return "medium";
    }
    return "low";
  }

  private analyzeRequest(request: string): RequestAnalysisResult {
    const hasToolUsage = this.toolPattern.test(request);
    const hasReasoning = this.reasoningPatterns.some(pattern => pattern.test(request));
    const tools = this.extractTools(request);
    const complexity = this.calculateComplexity(request, hasToolUsage, hasReasoning, tools);

    return {
      type: hasToolUsage ? "tool_usage" : hasReasoning ? "reasoning" : "general",
      complexity,
      tools: tools.length > 0 ? tools : undefined
    };
  }

  async analyzeRequestType(request: string): Promise<"tool_usage" | "reasoning" | "general"> {
    return this.analyzeRequest(request).type;
  }

  async analyzeComplexity(request: string): Promise<"low" | "medium" | "high"> {
    return this.analyzeRequest(request).complexity;
  }

  /**
   * Combine multiple prompts into a single coherent prompt
   */
  private combinePrompts(prompts: BasePrompt[]): string {
    // Group prompts by type to ensure logical ordering
    const grouped = prompts.reduce((acc, prompt) => {
      if (!acc[prompt.type]) {
        acc[prompt.type] = [];
      }
      acc[prompt.type].push(prompt);
      return acc;
    }, {} as Record<string, BasePrompt[]>);

    const sections: string[] = [];

    // Start with behavioral prompts as they set the tone
    if (grouped["behavioral"]) {
      sections.push(
        "# Behavior and Communication",
        ...grouped["behavioral"].map(p => p.content)
      );
    }

    // Add tool usage prompts if present
    if (grouped["tool_usage"]) {
      sections.push(
        "# Tool Usage Guidelines",
        ...grouped["tool_usage"].map(p => p.content)
      );
    }

    // Add reasoning prompts if present
    if (grouped["reasoning"]) {
      sections.push(
        "# Problem-Solving Approach",
        ...grouped["reasoning"].map(p => p.content)
      );
    }

    return sections.join("\n\n");
  }

  /**
   * Process a request and generate appropriate prompts
   */
  async processRequest(request: string, context?: PromptContext): Promise<string> {
    try {
      // If no context provided, analyze the request
      const requestContext = context || {
        requestType: (await this.analyzeRequestType(request)),
        complexity: (await this.analyzeComplexity(request)),
        tools: this.analyzeRequest(request).tools
      };

      // Get applicable prompts
      let prompts = this.promptRepository.getApplicablePrompts(requestContext);

      // If no prompts are found (shouldn't happen due to defaults), use fallbacks
      if (prompts.length === 0) {
        console.warn("No prompts found, using fallbacks");
        prompts = [
          this.promptRepository.getFallbackPrompt(PromptType.BEHAVIORAL),
          this.promptRepository.getFallbackPrompt(
            requestContext.requestType === "tool_usage" ? PromptType.TOOL_USAGE : PromptType.REASONING
          )
        ];
      }

      // Combine prompts into final output
      return this.combinePrompts(prompts);
    } catch (error) {
      console.error("Error in prompt middleware:", error);
      // Return a safe fallback prompt in case of errors
      return this.promptRepository.getFallbackPrompt(PromptType.BEHAVIORAL).content;
    }
  }
}
