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
            // VALIDATE AND NORMALIZE params to ensure it's always an object
            if (parsed.action.params) {
              if (Array.isArray(parsed.action.params)) {
                // Try to intelligently convert array to object
                if (
                  parsed.action.params.length === 1 &&
                  typeof parsed.action.params[0] === "object"
                ) {
                  // Unwrap single object from array
                  parsed.action.params = parsed.action.params[0];
                  this.logger.warn(
                    `Params array unwrapped for ${parsed.action.tool}`,
                  );
                } else {
                  // Create object with array as value (fallback)
                  const originalParams = parsed.action.params;
                  parsed.action.params = { values: originalParams };
                  this.logger.warn(
                    `Params array wrapped for ${parsed.action.tool}`,
                  );
                }
              } else if (typeof parsed.action.params !== "object") {
                // If it's a primitive, wrap it
                const originalValue = parsed.action.params;
                parsed.action.params = { value: originalValue };
                this.logger.warn(
                  `Params primitive wrapped for ${parsed.action.tool}`,
                );
              }
            }

            step.action = parsed.action;
          }

          if (parsed.conclusion) {
            step.conclusion = parsed.conclusion;
            step.isComplete = true;
          }

          // CRITICAL: Validate that step has EITHER action OR conclusion, not both
          if (step.action && step.conclusion) {
            this.logger.error(
              "Invalid step: contains both action AND conclusion",
              {
                hasAction: !!step.action,
                hasConclusion: !!step.conclusion,
              },
            );
            return null; // Reject this step entirely
          }

          // Validate that step has at least thought + (action OR conclusion)
          if (!step.thought) {
            this.logger.warn("Step missing required 'thought' field");
          }

          if (!step.action && !step.conclusion) {
            this.logger.error(
              "Invalid step: has neither action nor conclusion",
            );
            return null; // Reject steps with no action or conclusion
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
