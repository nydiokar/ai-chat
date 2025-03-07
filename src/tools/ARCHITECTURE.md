# Tool Integration Architecture

## Core Components

### 1. MCP Server & Client (`mcp/`)
- Tool registration and schemas
- Tool execution
- Response formatting
- Server-side validation

### 2. Tools Handler (`tools-handler.ts`)
- Tool management and coordination
- Context and usage patterns
- Result persistence
- Usage history

### 3. AI Model Integration (`services/ai/`)
- Model-specific integration (Ollama, OpenAI, etc.)
- Message history
- Tool availability management

### 4. Ollama-Specific (`ollama_helpers/`)
- `ollama-bridge.ts`: 
  - Bridge between Ollama and MCP tools
  - Message flow management
  - Tool call handling

- `ollama-tool-adapter.ts`:
  - Convert MCP tool schemas to Ollama function format
  - Validate Ollama function calls against MCP schemas
  - No response formatting (handled by MCP servers)

## Data Flow

1. User Input → AI Service
2. AI Service → Ollama Bridge
3. Ollama Bridge → Ollama Tool Adapter (format conversion only)
4. Ollama Bridge → Tools Handler → MCP Client (execution & formatting)
5. Formatted Response → AI Service → User

## Key Points

1. MCP Servers own their:
   - Tool definitions
   - Input validation
   - Response formatting
   - Execution logic

2. Ollama Integration only needs to:
   - Convert MCP schemas to Ollama format
   - Validate function calls against schemas
   - Pass execution to MCP clients

3. Tools Handler remains the central coordinator:
   - Tool discovery and availability
   - Usage tracking
   - Context management
   - Result persistence

This keeps the MCP server architecture clean while adding just the necessary Ollama-specific functionality.
