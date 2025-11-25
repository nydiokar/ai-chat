import { ToolDefinition } from "../mcp/types/tools.js";

/**
 * Built-in tool to get current date and time
 * Replaces date/time injection in prompts - only called when needed
 */
export const getCurrentDateTimeTool: ToolDefinition = {
  name: "get_current_datetime",
  description:
    "Get the current date and time. Use this when the user asks about 'today', 'now', 'current time', or references temporal information.",
  version: "1.0.0",
  inputSchema: {
    type: "object",
    properties: {
      format: {
        type: "string",
        description:
          "Output format: 'full' (default), 'date', 'time', 'iso', or 'unix'",
        enum: ["full", "date", "time", "iso", "unix"],
      },
      timezone: {
        type: "string",
        description:
          "Optional timezone (e.g., 'America/New_York', 'UTC'). Defaults to system timezone.",
      },
    },
    required: [],
  },
};

/**
 * Execute the datetime tool
 * @param params Tool parameters
 * @returns Formatted date/time information
 */
export async function executeGetCurrentDateTime(params: {
  format?: "full" | "date" | "time" | "iso" | "unix";
  timezone?: string;
}): Promise<string> {
  const now = new Date();
  const format = params.format || "full";

  try {
    switch (format) {
      case "date":
        return now.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          timeZone: params.timezone,
        });

      case "time":
        return now.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZone: params.timezone,
        });

      case "iso":
        return params.timezone
          ? now.toLocaleString("en-US", {
              timeZone: params.timezone,
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            })
          : now.toISOString();

      case "unix":
        return Math.floor(now.getTime() / 1000).toString();

      case "full":
      default:
        return `Current date and time: ${now.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          timeZone: params.timezone,
        })} at ${now.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZone: params.timezone,
        })}${params.timezone ? ` (${params.timezone})` : ""}`;
    }
  } catch (error) {
    // If timezone is invalid, fallback to system timezone
    console.warn(`Invalid timezone "${params.timezone}", using system default`);
    return executeGetCurrentDateTime({ format, timezone: undefined });
  }
}
