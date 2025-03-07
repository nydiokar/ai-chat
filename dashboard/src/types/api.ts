export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  function: {
    name: string;
    arguments: Record<string, any>;
  };
}

export interface ChatRequest {
  message: string;
  model: string;
}

export interface ChatResponse {
  response: string;
  tool_results?: ToolResult[];
}

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
  mcpServer: string;
}

export interface ToolRequest {
  tool_name: string;
  params: Record<string, any>;
}

export interface ToolResponse {
  tool: string;
  params: Record<string, any>;
  result: string;
}

export interface ToolResult {
  tool: string;
  result: string;
  error?: string;
}

export interface MCPServer {
  id: string;
  url: string;
  status: 'up' | 'down';
  error?: string;
}

export interface AvailableToolsResponse {
  tools: Record<string, Tool>;
}

export interface MCPStatusResponse {
  status: Record<string, MCPServer>;
} 