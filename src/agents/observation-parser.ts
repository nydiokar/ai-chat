import {
  GroundedObservation,
  ReasoningStep,
} from "../interfaces/react-types.js";
import { ToolExecutionResult } from "../tools/tool-chain/tool-chain-executor.js";

const DEFAULT_MAX_RESULT_LENGTH = 2000;
const MAX_IMPORTANT_FIELDS = 8;
const MAX_SOURCE_REFS = 10;
const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/gi;

export class ObservationParser {
  public parseToolResult(
    result: ToolExecutionResult,
    action: ReasoningStep["action"],
    maxLength: number = DEFAULT_MAX_RESULT_LENGTH,
  ): GroundedObservation {
    if (!action) {
      return this.createRuntimeObservation(
        "error",
        "Tool execution completed, but action details are missing.",
        maxLength,
      );
    }

    if (!result || !result.success || result.data === undefined) {
      return this.parseToolError(result?.error, action, maxLength);
    }

    const sourceRefs = this.extractSourceRefs(result.data);
    const importantFields = this.extractImportantFields(result.data);
    const summary = this.summarizeData(result.data, action.tool);
    const rawPreview = this.createRawPreview(result.data);

    return this.finalizeObservation(
      {
        kind: this.detectObservationKind(result.data),
        summary,
        tool: action.tool,
        purpose: action.purpose,
        importantFields:
          Object.keys(importantFields).length > 0 ? importantFields : undefined,
        sourceRefs: sourceRefs.length > 0 ? sourceRefs : undefined,
        rawPreview,
      },
      this.renderSuccessResult(
        {
          summary,
          tool: action.tool,
          purpose: action.purpose,
          importantFields,
          sourceRefs,
          rawPreview,
        },
        action,
        result,
      ),
      maxLength,
    );
  }

  public parseToolError(
    error: Error | undefined,
    action: ReasoningStep["action"],
    maxLength: number = DEFAULT_MAX_RESULT_LENGTH,
  ): GroundedObservation {
    if (!action) {
      return this.createRuntimeObservation(
        "error",
        `Error: ${error ? error.message : "Unknown error occurred"}`,
        maxLength,
      );
    }

    const message = error?.message || "Tool returned no result.";
    const summary = `Tool ${action.tool} failed: ${message}`;
    const raw = [
      `Tool: ${action.tool}`,
      `Parameters: ${JSON.stringify(action.params || {})}`,
      `Result: Error: ${message}`,
      "",
      "Recommendation: Consider trying a different approach or different parameters.",
    ].join("\n");

    return this.finalizeObservation(
      {
        kind: "error",
        summary,
        tool: action.tool,
        purpose: action.purpose,
        importantFields: Object.keys(action.params || {}).length
          ? { params: action.params }
          : undefined,
        error: { message },
        rawPreview: this.truncate(raw, 500).value,
      },
      raw,
      maxLength,
    );
  }

  public createRuntimeObservation(
    kind: GroundedObservation["kind"],
    message: string,
    maxLength: number = DEFAULT_MAX_RESULT_LENGTH,
  ): GroundedObservation {
    return this.finalizeObservation(
      {
        kind,
        summary: message,
        rawPreview: this.truncate(message, 500).value,
      },
      message,
      maxLength,
    );
  }

  private finalizeObservation(
    observation: Omit<GroundedObservation, "result" | "truncated">,
    rawResult: string,
    maxLength: number,
  ): GroundedObservation {
    const truncated = this.truncate(rawResult, maxLength);
    return {
      ...observation,
      result: truncated.value,
      truncated: truncated.wasTruncated,
    };
  }

  private renderSuccessResult(
    observation: {
      summary: string;
      tool: string;
      purpose?: string;
      importantFields?: Record<string, unknown>;
      sourceRefs?: string[];
      rawPreview?: string;
    },
    action: ReasoningStep["action"],
    result: ToolExecutionResult,
  ): string {
    const parts: string[] = [
      `Tool: ${action?.tool ?? observation.tool}`,
      `Purpose: ${action?.purpose || "Not specified"}`,
      `Parameters: ${JSON.stringify(action?.params || {})}`,
    ];

    if (result.metadata?.executionTime !== undefined) {
      parts.push(`Execution time: ${result.metadata.executionTime}ms`);
    }

    parts.push(`Observation summary: ${observation.summary}`);

    if (observation.sourceRefs && observation.sourceRefs.length > 0) {
      parts.push(`Sources: ${observation.sourceRefs.join(", ")}`);
    }

    if (observation.importantFields) {
      parts.push(
        `Important fields: ${JSON.stringify(observation.importantFields, null, 2)}`,
      );
    }

    if (observation.rawPreview) {
      parts.push(`Raw preview:\n${observation.rawPreview}`);
    }

    return parts.join("\n");
  }

  private detectObservationKind(data: unknown): GroundedObservation["kind"] {
    if (data === null || data === undefined) {
      return "empty";
    }

    if (typeof data === "string") {
      return data.trim().length === 0 ? "empty" : "success";
    }

    if (Array.isArray(data)) {
      return data.length === 0 ? "empty" : "success";
    }

    if (typeof data === "object") {
      return Object.keys(data as Record<string, unknown>).length === 0
        ? "empty"
        : "success";
    }

    return "success";
  }

  private summarizeData(data: unknown, toolName: string): string {
    if (typeof data === "string") {
      const normalized = data.trim().replace(/\s+/g, " ");
      if (!normalized) {
        return `Tool ${toolName} returned an empty string result.`;
      }
      return normalized.length > 160
        ? `${normalized.slice(0, 157)}...`
        : normalized;
    }

    if (Array.isArray(data)) {
      if (data.length === 0) {
        return `Tool ${toolName} returned no items.`;
      }

      const firstPreview = this.previewValue(data[0]);
      return `Tool ${toolName} returned ${data.length} item${data.length === 1 ? "" : "s"}. First item: ${firstPreview}`;
    }

    if (typeof data === "object" && data !== null) {
      const record = data as Record<string, unknown>;
      const directSummary = [
        record.summary,
        record.message,
        record.result,
        record.answer,
        record.title,
      ].find((value) => typeof value === "string" && value.trim().length > 0);

      if (typeof directSummary === "string") {
        const normalized = directSummary.trim().replace(/\s+/g, " ");
        return normalized.length > 160
          ? `${normalized.slice(0, 157)}...`
          : normalized;
      }

      const keys = Object.keys(record);
      return `Tool ${toolName} returned an object with fields: ${keys.slice(0, 6).join(", ")}${keys.length > 6 ? ", ..." : ""}`;
    }

    return `Tool ${toolName} returned ${String(data)}`;
  }

  private extractImportantFields(data: unknown): Record<string, unknown> {
    if (Array.isArray(data)) {
      return {
        count: data.length,
        sample:
          data.length > 0 ? this.normalizeFieldValue(data[0]) : undefined,
      };
    }

    if (typeof data === "object" && data !== null) {
      const entries = Object.entries(data as Record<string, unknown>).slice(
        0,
        MAX_IMPORTANT_FIELDS,
      );

      return entries.reduce<Record<string, unknown>>((acc, [key, value]) => {
        if (value === undefined) {
          return acc;
        }

        const normalized = this.normalizeFieldValue(value);
        if (normalized !== undefined) {
          acc[key] = normalized;
        }
        return acc;
      }, {});
    }

    return {};
  }

  private normalizeFieldValue(value: unknown): unknown {
    if (typeof value === "string") {
      return this.truncate(value.replace(/\s+/g, " "), 240).value;
    }

    if (Array.isArray(value)) {
      return value.slice(0, 3).map((item) => this.normalizeFieldValue(item));
    }

    if (typeof value === "object" && value !== null) {
      const objectEntries = Object.entries(value as Record<string, unknown>).slice(
        0,
        5,
      );
      return objectEntries.reduce<Record<string, unknown>>(
        (acc, [key, nestedValue]) => {
          const normalized = this.normalizeFieldValue(nestedValue);
          if (normalized !== undefined) {
            acc[key] = normalized;
          }
          return acc;
        },
        {},
      );
    }

    return value;
  }

  private extractSourceRefs(data: unknown): string[] {
    const sources = new Set<string>();

    const visit = (value: unknown): void => {
      if (sources.size >= MAX_SOURCE_REFS || value === null || value === undefined) {
        return;
      }

      if (typeof value === "string") {
        const matches = value.match(URL_PATTERN) || [];
        for (const match of matches) {
          if (sources.size >= MAX_SOURCE_REFS) break;
          sources.add(match.replace(/[),.;]+$/, ""));
        }
        return;
      }

      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }

      if (typeof value === "object") {
        Object.values(value as Record<string, unknown>).forEach(visit);
      }
    };

    visit(data);
    return Array.from(sources);
  }

  private createRawPreview(data: unknown): string {
    if (typeof data === "string") {
      return this.truncate(data, 500).value;
    }

    try {
      return this.truncate(JSON.stringify(data, null, 2), 500).value;
    } catch {
      return this.truncate(String(data), 500).value;
    }
  }

  private previewValue(value: unknown): string {
    if (typeof value === "string") {
      return this.truncate(value.replace(/\s+/g, " "), 80).value;
    }

    try {
      return this.truncate(JSON.stringify(this.normalizeFieldValue(value)), 80)
        .value;
    } catch {
      return this.truncate(String(value), 80).value;
    }
  }

  private truncate(
    value: string,
    maxLength: number,
  ): { value: string; wasTruncated: boolean } {
    if (value.length <= maxLength) {
      return { value, wasTruncated: false };
    }

    return {
      value:
        value.substring(0, maxLength) +
        `\n\n[Result truncated. Total length: ${value.length} characters]`,
      wasTruncated: true,
    };
  }
}
