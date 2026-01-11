import { OpenAI } from "openai";
import { Input, Response } from "../types/common.js";
import { LLMProvider } from "../interfaces/llm-provider.js";
import { MCPError, ErrorType } from "../types/errors.js";
import { debug, info } from "../utils/logger.js";
import { createLogContext } from "../utils/log-utils.js";
import { validateInput } from "../utils/ai-utils.js";
import { BaseConfig } from "../utils/config.js";
import { CacheService, CacheType } from "../services/cache/cache-service.js";
import {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletion,
  ChatCompletionToolMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions.js";
import { FunctionDefinition } from "openai/resources/shared.js";
import { ToolDefinition } from "../tools/mcp/types/tools.js";

// Check if OpenAI verbose logging is disabled
const DISABLE_OPENAI_VERBOSE_LOGS =
  process.env.DISABLE_OPENAI_VERBOSE_LOGS !== "false";

// Helper function to conditionally log OpenAI-related messages
const logOpenAI = (message: string, context: any) => {
  if (DISABLE_OPENAI_VERBOSE_LOGS) return;
  debug(
    message,
    createLogContext("OpenAIProvider", context.operation, context),
  );
};

// Helper to print user-friendly summaries of important operations
const logOperation = (message: string, context: any) => {
  info(message, createLogContext("OpenAIProvider", context.operation, context));
};

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;
  private temperature: number;
  private systemPrompt: string = "";
  private messageCache: CacheService;
  private readonly enablePromptCaching =
    process.env.ENABLE_PROMPT_CACHING !== "false";

  constructor(private readonly config: BaseConfig) {
    // Disable OpenAI's built-in debug logs completely
    // Don't use the internal logger property as it's not part of the official API
    const openaiConfig = {
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: config.openai.maxRetries,
      timeout: config.openai.timeout,
      dangerouslyAllowBrowser: true,
      defaultHeaders: { "OpenAI-Debug": "false" },
      defaultQuery: { debug: "false" },
    };

    // Create our own wrapper to intercept OpenAI client logging
    this.client = new OpenAI(openaiConfig);

    // Disable console logging from OpenAI client if possible
    if (typeof globalThis !== "undefined" && globalThis.console) {
      // Store original methods
      const originalConsoleLog = console.log;
      const originalConsoleError = console.error;

      // Filter out OpenAI SDK logs
      console.log = (...args) => {
        if (
          DISABLE_OPENAI_VERBOSE_LOGS &&
          args.length > 0 &&
          typeof args[0] === "string" &&
          (args[0].includes("OpenAI") || args[0].includes("api.openai.com"))
        ) {
          return; // Skip OpenAI logs
        }
        return originalConsoleLog.apply(console, args);
      };

      console.error = (...args) => {
        if (args.length > 0 && typeof args[0] === "string") {
          if (args[0].includes("OpenAI API Error:")) {
            // Still log API errors but in a cleaner format
            return originalConsoleError.apply(console, [
              `OpenAI API Error: ${args[1] || ""}`,
            ]);
          }
          if (
            DISABLE_OPENAI_VERBOSE_LOGS &&
            (args[0].includes("OpenAI") || args[0].includes("api.openai.com"))
          ) {
            return; // Skip verbose OpenAI logs
          }
        }
        return originalConsoleError.apply(console, args);
      };
    }

    this.model = config.openai.model;
    this.temperature = config.openai.temperature;

    // Initialize cache with default settings
    this.messageCache = CacheService.getInstance({
      type: CacheType.PERSISTENT,
      namespace: "openai-messages",
      ttl: 3600, // 1 hour
      filename: "cache/openai-cache.json",
    });
  }

  async generateResponse(
    message: string,
    conversationHistory?: Input[],
    tools?: ToolDefinition[],
  ): Promise<Response> {
    validateInput(message);

    try {
      logOpenAI("Generating response", {
        operation: "generateResponse",
        model: this.model,
        hasTools: !!tools?.length,
        messageLength: message.length,
      });

      // Try to get from cache first
      const cacheKey = `${message}_${conversationHistory?.length || 0}_${this.systemPrompt}_${tools?.length || 0}`;
      const cachedResponse = await this.messageCache.get(cacheKey);
      if (cachedResponse) {
        logOpenAI("Using cached response", {
          operation: "generateResponse",
          cached: true,
          messageLength: message.length,
        });
        return cachedResponse as Response;
      }

      // Convert conversation history to OpenAI format
      let messages: ChatCompletionMessageParam[] =
        this.convertToCompletionMessages(message, conversationHistory);

      // Add system prompt if set
      if (this.systemPrompt) {
        messages.unshift({ role: "system", content: this.systemPrompt });
      }

      // Mark cacheable segments if enabled (OpenAI request caching)
      if (this.enablePromptCaching) {
        messages = this.applyPromptCaching(messages);
      }

      // Log the user-friendly request summary
      logOperation("Sending to OpenAI", {
        operation: "generateResponse",
        promptFirstLine:
          message.split("\n")[0].substring(0, 50) +
          (message.length > 50 ? "..." : ""),
        numMessages: messages.length,
        hasTools: !!tools?.length,
        toolCount: tools?.length || 0,
      });

      // Initial completion to get tool calls
      const completion = await this.createCompletionWithToolChoice(
        messages,
        tools,
      );
      const choice = completion.choices[0]?.message;

      if (!choice) {
        throw new MCPError(
          "OpenAI response missing message",
          ErrorType.API_ERROR,
        );
      }

      // Log detailed response information that's actually useful
      const hasToolCalls = !!choice.tool_calls?.length;
      const toolNames = hasToolCalls
        ? choice.tool_calls?.map((tc) => tc.function.name).join(", ") || ""
        : "";

      logOperation("Response received", {
        operation: "generateResponse",
        contentLength: choice.content?.length || 0,
        hasToolCalls,
        toolCount: choice.tool_calls?.length || 0,
        toolNames,
        tokenCount: completion.usage?.total_tokens,
        finishReason: completion.choices[0]?.finish_reason,
        tokenUsage: this.extractTokenUsage(completion),
      });

      // If no tool calls, return the content directly
      if (!choice.tool_calls || choice.tool_calls.length === 0) {
        const tokenUsage = this.extractTokenUsage(completion);
        const response: Response = {
          content: choice.content || "",
          tokenCount: completion.usage?.total_tokens ?? null,
          toolResults: [],
          tokenUsage,
        };

        await this.messageCache.set(cacheKey, response);
        return response;
      }

      // Extract tool call information for the agent to execute
      const toolResults =
        choice.tool_calls?.map((toolCall) => ({
          success: false, // Will be set to true after execution
          data: "", // Will be filled after execution
          error: "", // Will be filled if execution fails
          metadata: {
            toolName: toolCall.function.name,
            arguments: toolCall.function.arguments,
            toolCallId: toolCall.id,
          },
        })) || [];

      // Create response with tool calls for the agent to execute
      const response: Response = {
        content: choice.content || "I need to use a tool to help with that.",
        tokenCount: completion.usage?.total_tokens ?? null,
        toolResults,
        tokenUsage: this.extractTokenUsage(completion),
      };

      await this.messageCache.set(cacheKey, response);
      return response;
    } catch (err) {
      logOpenAI("Error generating response", {
        operation: "generateResponse",
        error: err instanceof Error ? err.message : String(err),
      });

      if (err instanceof MCPError) {
        throw err;
      }

      throw MCPError.apiError(this.model, err);
    }
  }

  async getFinalResponse(
    originalMessage: string,
    toolResults: {
      toolName: string;
      toolCallId: string;
      result: string;
      success: boolean;
    }[],
    conversationHistory?: Input[],
  ): Promise<Response> {
    try {
      logOpenAI("Getting final response after tool execution", {
        operation: "getFinalResponse",
        model: this.model,
        toolResultCount: toolResults.length,
      });

      // Convert conversation history to OpenAI format
      const messages: ChatCompletionMessageParam[] =
        this.convertToCompletionMessages(originalMessage, conversationHistory);

      // Add system prompt if set
      if (this.systemPrompt) {
        messages.unshift({ role: "system", content: this.systemPrompt });
      }

      // Add assistant's tool calls
      const toolCalls: ChatCompletionMessageToolCall[] = toolResults.map(
        (result) => ({
          id: result.toolCallId,
          type: "function",
          function: {
            name: this.sanitizeToolName(result.toolName),
            arguments: "{}", // Arguments are simplified here
          },
        }),
      );

      const assistantMessage: ChatCompletionMessageParam = {
        role: "assistant",
        content: null,
        tool_calls: toolCalls,
      };

      messages.push(assistantMessage);

      // Add tool results
      for (const result of toolResults) {
        const toolMessage: ChatCompletionToolMessageParam = {
          role: "tool",
          tool_call_id: result.toolCallId,
          content: result.success ? result.result : `Error: ${result.result}`,
        };
        messages.push(toolMessage);
      }

      // Get final completion with tool results
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: this.temperature,
      });

      const choice = completion.choices[0]?.message;

      if (!choice) {
        throw new MCPError(
          "OpenAI response missing message in final response",
          ErrorType.API_ERROR,
        );
      }

      logOpenAI("Response received", {
        operation: "getFinalResponse",
        hasToolCalls: !!choice.tool_calls?.length,
        toolCount: choice.tool_calls?.length || 0,
        tokenCount: completion.usage?.total_tokens,
        tokenUsage: this.extractTokenUsage(completion),
      });

      return {
        content:
          choice.content ||
          "I processed the tool results but have no additional information to provide.",
        tokenCount: completion.usage?.total_tokens ?? null,
        toolResults: [],
        tokenUsage: this.extractTokenUsage(completion),
      };
    } catch (err) {
      logOpenAI("Error getting final response", {
        operation: "getFinalResponse",
        error: err instanceof Error ? err.message : String(err),
      });

      if (err instanceof MCPError) {
        throw err;
      }

      throw MCPError.apiError(this.model, err);
    }
  }

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  // Implement LLMProvider interface methods
  getModel(): string {
    return this.model;
  }

  async cleanup(): Promise<void> {
    await this.messageCache.cleanup();
  }

  private convertToCompletionMessages(
    message: string,
    history?: Input[],
  ): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [];

    // System prompt is added by the caller, so we don't need to handle it here

    // Add history first
    if (history && history.length > 0) {
      messages.push(
        ...history.map((msg) => this.convertToCompletionMessage(msg)),
      );
    }

    // Add the current message last
    messages.push({ role: "user", content: message });

    return messages;
  }

  private convertToCompletionMessage(msg: Input): ChatCompletionMessageParam {
    if (msg.role === "tool" && msg.tool_call_id) {
      return {
        role: "tool",
        content: msg.content,
        tool_call_id: msg.tool_call_id,
      } as ChatCompletionToolMessageParam;
    }

    // Handle developer role by mapping to user for OpenAI
    if (msg.role === "developer") {
      return {
        role: "user",
        content: msg.content,
        ...(msg.name ? { name: msg.name } : {}),
      };
    }

    // Handle different roles properly based on their requirements
    switch (msg.role) {
      case "system":
        return {
          role: "system",
          content: msg.content,
          ...(msg.name ? { name: msg.name } : {}),
        };
      case "user":
        return {
          role: "user",
          content: msg.content,
          ...(msg.name ? { name: msg.name } : {}),
        };
      case "assistant":
        return {
          role: "assistant",
          content: msg.content,
          ...(msg.name ? { name: msg.name } : {}),
        };
      case "function":
        if (!msg.name) {
          throw new Error("Function messages must have a name");
        }
        return {
          role: "function",
          name: msg.name,
          content: msg.content,
        };
      default:
        // Fallback for unknown roles
        return {
          role: "user",
          content: msg.content,
        };
    }
  }

  private async createCompletionWithToolChoice(
    messages: ChatCompletionMessageParam[],
    tools?: ToolDefinition[],
  ): Promise<ChatCompletion> {
    if (!tools || tools.length === 0) {
      logOpenAI("Creating completion without tools", {
        operation: "createCompletionWithToolChoice",
        model: this.model,
        messageCount: messages.length,
      });

      return await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: this.temperature,
      });
    }

    logOpenAI("Creating completion with tools", {
      operation: "createCompletionWithToolChoice",
      model: this.model,
      toolCount: tools.length,
      messageCount: messages.length,
    });

    const formattedTools: ChatCompletionTool[] = tools.map((tool) => {
      if (!tool.inputSchema?.properties) {
        logOpenAI("Tool missing input schema", {
          operation: "createCompletionWithToolChoice",
          toolName: tool.name,
        });
      }

      // Convert MCPToolSchema to FunctionParameters
      const parameters: FunctionDefinition["parameters"] = {
        type: "object",
        properties: tool.inputSchema?.properties || {},
        required: tool.inputSchema?.required || [],
      };

      return {
        type: "function",
        function: {
          name: this.sanitizeToolName(tool.name),
          description: tool.description || "",
          parameters,
        },
      };
    });

    // Create a completion with the option to use tools
    return await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools: formattedTools,
      tool_choice: "auto",
      temperature: this.temperature,
    });
  }

  private sanitizeToolName(name: string): string {
    // Remove any characters that might cause issues with OpenAI function calling
    return name.replace(/[^\w\d_-]/g, "_");
  }

  private extractTokenUsage(completion: ChatCompletion | null | undefined) {
    const usage = completion?.usage;
    const promptTokens = usage?.prompt_tokens ?? null;
    const completionTokens = usage?.completion_tokens ?? null;
    const totalTokens = usage?.total_tokens ?? null;
    const cachedTokens =
      (usage as any)?.prompt_tokens_details?.cached_tokens ?? null;
    return { promptTokens, completionTokens, totalTokens, cachedTokens };
  }

  /**
   * Apply OpenAI cache_control markers to stable parts of the prompt
   */
  private applyPromptCaching(
    messages: ChatCompletionMessageParam[],
  ): ChatCompletionMessageParam[] {
    const cacheControl = { type: "ephemeral" } as const;

    return messages.map((msg) => {
      if (msg.role === "system") {
        return { ...msg, cache_control: cacheControl } as any;
      }
      return msg;
    });
  }
}
