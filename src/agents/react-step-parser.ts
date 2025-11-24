import { ReasoningStep } from "../interfaces/react-types.js";
import { getLogger } from "../utils/shared-logger.js";
import type { Logger } from "winston";
import yaml from "js-yaml";

/**
 * Handles parsing LLM outputs into structured reasoning steps
 * Supports multiple formats: YAML, JSON, and plain text
 */
export class ReActStepParser {
  private readonly logger: Logger;

  constructor() {
    this.logger = getLogger("ReActStepParser");
  }

  /**
   * Parse LLM response into a reasoning step
   * @param llmResponse The raw response from the LLM
   * @returns Parsed reasoning step or null if parsing failed
   */
  public parseReasoningStep(llmResponse: string): ReasoningStep | null {
    try {
      // First check for YAML in code blocks
      const yamlMatch = llmResponse.match(/```(?:yaml)?\s*([\s\S]*?)```/);
      if (yamlMatch) {
        try {
          const yamlContent = yamlMatch[1];
          // Parse YAML content
          const parsed = yaml.load(yamlContent) as Record<string, any>;

          // Create step ID based on the type of step
          let stepType = "unknown";
          if (parsed.thought) stepType = "thought";
          if (parsed.action) stepType = "action";
          if (parsed.conclusion) stepType = "conclusion";

          const stepId = `${stepType}_${Date.now()}`;

          // Convert to ReasoningStep format
          const step: ReasoningStep = {
            stepId,
            timestamp: new Date().toISOString(),
            isComplete: false,
          };

          if (parsed.thought) {
            step.thought = parsed.thought;
          }

          if (parsed.action) {
            step.action = parsed.action;
          }

          if (parsed.conclusion) {
            step.conclusion = parsed.conclusion;
            step.isComplete = true;
          }

          // Log successful YAML parsing
          this.logger.debug("Successfully parsed YAML response", {
            stepType,
            parsedLength: JSON.stringify(parsed).length,
          });

          return step;
        } catch (yamlError) {
          this.logger.error("Failed to parse YAML content", {
            error:
              yamlError instanceof Error
                ? yamlError.message
                : String(yamlError),
            content: yamlMatch[1].substring(0, 100) + "...",
          });
          // Continue to other parsing methods
        }
      }

      // Then try to parse as JSON
      try {
        const parsed = JSON.parse(llmResponse);

        // Validate required fields
        if (parsed.stepId) {
          // Add timestamp if missing
          if (!parsed.timestamp) {
            parsed.timestamp = new Date().toISOString();
          }
          // Ensure isComplete field
          if (parsed.isComplete === undefined) {
            parsed.isComplete = false;
          }
          return parsed as ReasoningStep;
        }
      } catch (e) {
        // Not valid JSON, continue to text parsing
      }

      // Fall back to basic text parsing
      const typeMatch = llmResponse.match(/^(THOUGHT|ACTION|FINAL_ANSWER):/i);

      if (typeMatch) {
        const type = typeMatch[1].toLowerCase();
        const stepId = `${type}_${Date.now()}`;

        if (type === "thought") {
          return {
            stepId,
            thought: {
              reasoning: llmResponse.replace(/^THOUGHT:/i, "").trim(),
              plan: "",
            },
            isComplete: false,
            timestamp: new Date().toISOString(),
          };
        } else if (type === "action") {
          // Try to extract tool and params
          const toolMatch = llmResponse.match(/ACTION:\s*([a-zA-Z0-9_]+)/i);
          if (!toolMatch) return null;

          // Extract parameters
          const paramsMatch = llmResponse.match(/\{[\s\S]*\}/);
          let params: Record<string, unknown> = {};
          if (paramsMatch) {
            try {
              params = JSON.parse(paramsMatch[0]);
            } catch (e) {
              // If JSON parsing fails, try to extract key-value pairs
              const paramRegex = /([a-zA-Z0-9_]+):\s*([^\n,]+)/g;
              let match;
              while ((match = paramRegex.exec(llmResponse)) !== null) {
                if (match[1] && match[2]) {
                  params[match[1].trim()] = match[2].trim();
                }
              }
            }
          }

          return {
            stepId,
            action: {
              tool: toolMatch[1].trim(),
              params,
            },
            isComplete: false,
            timestamp: new Date().toISOString(),
          };
        } else if (type === "final_answer") {
          return {
            stepId,
            conclusion: {
              final_answer: llmResponse.replace(/^FINAL_ANSWER:/i, "").trim(),
            },
            isComplete: true,
            timestamp: new Date().toISOString(),
          };
        }
      }

      // Could not parse, return null
      return null;
    } catch (error) {
      this.logger.error("Error parsing reasoning step", {
        error: error instanceof Error ? error.message : String(error),
        response: llmResponse,
      });
      return null;
    }
  }
}
