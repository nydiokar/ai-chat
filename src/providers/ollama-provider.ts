import { LLMProvider } from "../interfaces/llm-provider.js";
import { Input, Response } from "../types/common.js";
import { MCPContainer } from "../tools/mcp/di/container.js";
import { MCPError, ErrorType } from "../types/errors.js";
import { OllamaBridge } from "./utils/ollama_helpers/ollama-bridge.js";
import { IMCPClient } from "../tools/mcp/interfaces/core.js";
import { debug } from "../utils/logger.js";
import { ToolDefinition } from "../tools/mcp/types/tools.js";

export class OllamaProvider implements LLMProvider {
  private bridge!: OllamaBridge;
  private bridgeInitialized: boolean = false;
  private model: string;
  private endpoint: string;
  private systemPrompt: string = "";

  constructor(
    container: MCPContainer,
    model: string = "llama3.2:latest",
    endpoint: string = "http://127.0.0.1:11434",
  ) {
    this.model = model;
    this.endpoint = endpoint;

    // Initialize synchronously using container's pre-initialized clients
    this.initializeSync(container);
  }

  /**
   * Synchronous initialization using pre-initialized MCP clients from container
   */
  private initializeSync(container: MCPContainer): void {
    try {
      // Get pre-initialized clients from the container
      const toolManager = container.getToolManager();
      const serverManager = container.getServerManager();

      // Create a map of clients from the server manager
      const clients = new Map<string, IMCPClient>();
      const serverIds = serverManager.getServerIds();

      for (const serverId of serverIds) {
        const server = serverManager.getServer(serverId);
        if (server && (server as any).client) {
          clients.set(serverId, (server as any).client);
        }
      }

      // Initialize bridge with existing clients
      this.bridge = new OllamaBridge(
        this.model,
        this.endpoint,
        clients,
        toolManager,
      );

      // Mark as initialized immediately
      this.bridgeInitialized = true;
      debug(
        `OllamaProvider initialized: ${this.model} with ${clients.size} MCP clients`,
      );
    } catch (error) {
      throw new MCPError(
        "Failed to initialize OllamaProvider",
        ErrorType.INITIALIZATION_ERROR,
        { cause: error instanceof Error ? error : new Error(String(error)) },
      );
    }
  }

  public getModel(): string {
    return this.model;
  }

  public setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  public async generateResponse(
    message: string,
    conversationHistory?: Input[],
    tools?: ToolDefinition[],
  ): Promise<Response> {
    const content = await this.processMessage(
      message,
      conversationHistory || [],
    );
    return {
      content,
      tokenCount: null, // Ollama doesn't provide token counts
      toolResults: [],
    };
  }

  public async processMessage(
    message: string,
    history: Input[],
  ): Promise<string> {
    await this.ensureInitialized();

    try {
      const response = await this.bridge.processMessage(message);
      return response;
    } catch (error) {
      debug(
        `Ollama error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new MCPError("Failed to generate response", ErrorType.API_ERROR, {
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.bridgeInitialized) {
      return;
    }
    throw new MCPError(
      "OllamaProvider not initialized",
      ErrorType.INITIALIZATION_ERROR,
    );
  }

  /**
   * Lazy initialization of tools - called when needed
   */
  public async ensureToolsLoaded(): Promise<void> {
    if (!this.bridgeInitialized) {
      throw new MCPError(
        "OllamaProvider not initialized",
        ErrorType.INITIALIZATION_ERROR,
      );
    }

    try {
      // Get tools from tool manager and update bridge
      const toolManager = this.bridge["toolManager"] as any;
      if (toolManager) {
        const tools = await toolManager.getAvailableTools();
        await this.bridge.updateAvailableTools(tools);
        debug(`OllamaProvider loaded ${tools.length} tools`);
      }
    } catch (error) {
      debug(
        `OllamaProvider failed to load tools: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Non-fatal - can proceed without tools
    }
  }

  public async cleanup(): Promise<void> {
    this.bridgeInitialized = false;
  }
}
