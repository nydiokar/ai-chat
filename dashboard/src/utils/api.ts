import { ChatRequest, ChatResponse, ToolRequest, ToolResponse, AvailableToolsResponse } from '../types/api';
import { API_ENDPOINTS } from '../config/api';

export async function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  const response = await fetch(API_ENDPOINTS.chat, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.statusText}`);
  }

  return response.json();
}

export async function executeTool(request: ToolRequest): Promise<ToolResponse> {
  const response = await fetch(API_ENDPOINTS.tool, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Tool execution failed: ${response.statusText}`);
  }

  return response.json();
}

export async function getAvailableTools(): Promise<AvailableToolsResponse> {
  const response = await fetch(API_ENDPOINTS.availableTools);

  if (!response.ok) {
    throw new Error(`Failed to fetch available tools: ${response.statusText}`);
  }

  return response.json();
} 