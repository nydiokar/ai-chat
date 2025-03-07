export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export const API_ENDPOINTS = {
  chat: `${API_BASE_URL}/chat`,
  tool: `${API_BASE_URL}/tool`,
  availableTools: `${API_BASE_URL}/available-tools`,
} as const; 