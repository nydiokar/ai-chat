# Ollama MCP Integration with Brave Search

This document explains how the Ollama integration with Model Context Protocol (MCP) works in this project, focusing on the Brave Search tool as a proof of concept.

## Overview

The integration enables Ollama-based LLMs to use the Brave Search MCP tool through a bridge layer that handles:
- Tool format conversion
- Message context management
- Response streaming
- Error handling

## Architecture

```
┌─────────────────┐     ┌───────────────┐     ┌───────────────┐
│  OllamaService  │────▶│  OllamaBridge │────▶│  Ollama API   │
└─────────────────┘     └───────────────┘     └───────────────┘
         │                      │
         ▼                      ▼
┌─────────────────┐     ┌───────────────┐
│  ToolsHandler   │◀───▶│  MCP Clients  │
└─────────────────┘     └───────────────┘
                               │
                               ▼
                        ┌───────────────┐
                        │ Brave Search  │
                        └───────────────┘
```

## Implementation Details

### OllamaBridge

The `OllamaBridge` class (`src/services/ai/ollama/bridge.ts`) handles the communication between Ollama and MCP tools:

- Converts between different message formats
- Manages conversation context
- Handles tool calls and responses
- Provides error handling and logging
- Includes special handling for Brave Search tools

### OllamaService

The `OllamaService` class (`src/services/ai/ollama.ts`) integrates with the existing AI service infrastructure:

- Implements the BaseAIService abstract class
- Uses the OllamaBridge for Ollama-specific functionality
- Detects when a message likely needs search capabilities
- Handles tool-based completion through MCP
- Manages system prompts and conversation history

## Using Brave Search with Ollama

Ollama can now use the Brave Search MCP tool. Here's how it works:

1. The user sends a query that might require search
2. OllamaService detects search keywords and processes the message
3. The bridge converts the message to Ollama's format
4. Ollama generates a response with tool calls
5. The bridge processes the Brave Search tool call
6. Search results are sent back to Ollama for final response generation

## Testing

A focused test file is provided at `src/tests/ollama-brave-search-test.ts` that demonstrates how to use Ollama with the Brave Search tool.

To run the test:

```bash
npm run test:ollama-brave
```

## Example Queries for Brave Search

- "What are the latest developments in quantum computing?"
- "Find recent news about artificial intelligence regulations"
- "Search for tutorials on React hooks"
- "What are the most popular JavaScript frameworks in 2025?"
- "Find information about climate change initiatives this year"

## Configuration

The Ollama integration uses the following environment variables:

- `OLLAMA_HOST`: The URL of the Ollama server (default: http://127.0.0.1:11434)
- `OLLAMA_MODEL`: The model to use (default: shrijayan/llama-2-7b-chat-q2k:latest)

The Brave Search MCP tool is configured through the standard MCP configuration system.

## Next Steps

After successfully implementing the Brave Search integration, we can extend this approach to other MCP tools like GitHub. The bridge architecture is designed to be tool-agnostic, making it easy to add support for additional tools.
