// ollama-bridge.ts
import ollama, { Message, Tool } from 'ollama';
import { MCPClientService } from "../../tools/mcp/mcp-client-service.js";
import { MCPServerConfig } from "../../types/tools.js";
import mcpServers from "../../tools/mcp/mcp_config.js";

// Define types for the Ollama chat API responses
interface OllamaMessage {
  role: string;
  content: string;
  // The API may include a list of tool calls if the assistant wants to execute a tool
  tool_calls?: ToolCall[];
}

interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: { [key: string]: any };
  };
}

interface BraveSearchArgs {
  query: string;
}

interface GitHubArgs {
  repo: string;
  issueNumber: string;
}

type ToolResult = string | { [key: string]: unknown };

interface OllamaChatChoice {
  message: OllamaMessage;
  finish_reason: string;
}

interface OllamaChatResponse {
  choices: OllamaChatChoice[];
}

// The request payload structure for the Ollama chat API
interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream: boolean;
  tools?: any[];
}

interface OllamaResponse {
  model: string;
  created_at: string;
  message: OllamaMessage;
  done: boolean;
  done_reason: string;
  total_duration: number;
  load_duration: number;
  prompt_eval_count: number;
  prompt_eval_duration: number;
  eval_count: number;
  eval_duration: number;
}

/**
 * The OllamaBridge class handles sending messages to the Ollama API,
 * detecting tool calls, executing the corresponding MCP tool (here, brave_search),
 * and then continuing the conversation until a final response is received.
 */
class OllamaBridge {
  private model: string;
  private braveSearchClient: MCPClientService;
  private githubClient: MCPClientService | null = null;
  private messages: Message[] = [];
  private tools: Tool[] = [
    {
      type: "function",
      function: {
        name: "brave_search",
        description: "Search the web using Brave Search. Returns search results with URLs.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query for Brave Search"
            }
          },
          required: ["query"]
        }
      }
    },
  ];

  constructor(model: string, _baseUrl: string, braveSearchClient: MCPClientService) {
    this.model = model;
    this.braveSearchClient = braveSearchClient;
  }

  private async executeBraveSearch(query: string): Promise<string> {
    console.log('[OllamaBridge] Executing brave search with query:', query);
    const result = await this.braveSearchClient.webSearch(query);
    console.log('[OllamaBridge] Search result:', result.substring(0, 100) + '...');
    return result;
  }

  public async processMessage(userMessage: string): Promise<string> {
    try {
      console.log('[OllamaBridge] Processing message:', userMessage);
      
      // Add the user message to the conversation
      this.messages.push({ role: "user", content: userMessage });

      // Get response from Ollama with tools configuration
      console.log('[OllamaBridge] Sending request to Ollama with tools');
      const response = await ollama.chat({
        model: this.model,
        messages: this.messages,
        options: {
          temperature: 0.7,
        },
        tools: this.tools
      });

      console.log('[OllamaBridge] Received response from Ollama:', response);

      if (!response || !response.message) {
        console.error('[OllamaBridge] Invalid response from Ollama:', response);
        throw new Error('Invalid response from Ollama API');
      }

      // Add assistant's response to conversation history
      this.messages.push(response.message);

      // Check if the response includes a tool call
      if (response.message.tool_calls && response.message.tool_calls.length > 0) {
        console.log('[OllamaBridge] Tool calls detected:', response.message.tool_calls);
        
        for (const toolCall of response.message.tool_calls) {
          let toolResult: string;
          
          if (toolCall.function.name === "brave_search") {
            const args = toolCall.function.arguments as BraveSearchArgs;
            toolResult = await this.executeBraveSearch(args.query);
          } else {
            console.warn('[OllamaBridge] Unknown tool called:', toolCall.function.name);
            continue;
          }
          
          // Add tool response to conversation
          this.messages.push({
            role: "tool",
            content: toolResult
          });

          // Get final response after tool use
          console.log('[OllamaBridge] Getting final response after tool use');
          const finalResponse = await ollama.chat({
            model: this.model,
            messages: this.messages,
            options: {
              temperature: 0.7,
            },
            tools: this.tools
          });

          if (!finalResponse || !finalResponse.message) {
            console.error('[OllamaBridge] Invalid final response from Ollama:', finalResponse);
            throw new Error('Invalid final response from Ollama API');
          }

          return finalResponse.message.content || 'No response content';
        }
      }

      return response.message.content || 'No response content';
    } catch (error) {
      console.error('Error in processMessage:', error);
      throw error;
    }
  }
}

export { OllamaBridge };
