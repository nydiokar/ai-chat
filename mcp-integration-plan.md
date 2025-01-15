# MCP Integration Plan

## Overview
This document outlines the plan for integrating Model Context Protocol (MCP) server usage into our AI chat application. This plan was created on January 15, 2025.

## Note to Future Claude
Hello future Claude! This plan was created after analyzing the MCP documentation and the existing codebase. Key points for you:
1. Read the current codebase again when you start
2. Check `config.ts` for any MCP-related updates that may have been added
3. Be particularly careful with the AI service integration to maintain existing functionality
4. Check for any new commits or changes in the MCP repository before proceeding

## Current Architecture
- TypeScript-based AI chat application
- Uses Prisma for database management
- Interfaces with OpenAI and Anthropic APIs
- Provides CLI and Discord interfaces
- Built-in context management

## Integration Plan

### PHASE 1: MCP Configuration & Basic Setup

#### 1.1 Configuration
- Add MCP server configurations to config.ts
- Structure similar to Claude Desktop's config:
```typescript
interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface MCPConfig {
  servers: Record<string, MCPServerConfig>;
}
```
- Support both local and NPM-installed servers
- Add environment variables for server authentication

#### 1.2 Basic MCP Service
- Create `services/mcp-service.ts`
- Implement server connection management
- Add server lifecycle management
- Handle initialization and cleanup

### PHASE 2: MCP Client Integration

#### 2.1 Core Integration
- Create MCPClientService class
- Implement stdio transport
- Add server initialization
- Implement tool discovery and registration

#### 2.2 Database Updates
New Prisma models needed:
```prisma
model MCPServer {
  id          String   @id @default(uuid())
  name        String   @unique
  status      String   // active, inactive, error
  lastActive  DateTime @updatedAt
  tools       MCPTool[]
}

model MCPTool {
  id          String   @id @default(uuid())
  serverId    String
  server      MCPServer @relation(fields: [serverId], references: [id])
  name        String
  description String?
  usage       MCPToolUsage[]
}

model MCPToolUsage {
  id              String   @id @default(uuid())
  toolId          String
  tool            MCPTool  @relation(fields: [toolId], references: [id])
  conversationId  Int
  conversation    Conversation @relation(fields: [conversationId], references: [id])
  timestamp       DateTime @default(now())
  input           String?  // JSON string of input params
  output          String?  // JSON string of output
  error           String?  // Error message if failed
}
```

### PHASE 3: AI Service Integration

#### 3.1 AI Service Updates
- Modify OpenAIService and AnthropicService
- Add MCP context support
- Implement tool calling
- Add response handling

#### 3.2 Conversation Flow Updates
- Update conversation handling
- Modify context management
- Add tool result processing

### PHASE 4: Interface Updates

#### 4.1 CLI Updates
New commands to add:
- mcp:list - List available MCP servers
- mcp:start <server> - Start specific server
- mcp:stop <server> - Stop specific server
- mcp:status - Show all server statuses
- mcp:tools - List available tools

#### 4.2 Discord Updates
- Add MCP server status commands
- Implement tool usage in Discord
- Add error handling

## Implementation Priority
1. Start with Phase 1.1 - Configuration
2. Move to Phase 1.2 - Basic MCP Service
3. Implement Phase 2.1 - Core Integration
4. Continue with database updates
5. Proceed with remaining phases

## Notes on Testing
- Create tests for each new component
- Test server connection handling
- Test tool execution
- Test error scenarios
- Validate conversation flow with tools

## Security Considerations
- Validate all tool inputs
- Implement rate limiting
- Handle server crashes gracefully
- Sanitize tool outputs

Remember to:
- Keep existing functionality working
- Add comprehensive error handling
- Document all new features
- Add logging for debugging

## Future Improvements
Consider these after basic integration:
- Tool result caching
- Server health monitoring
- Advanced error recovery
- Performance optimizations

## Resources
- MCP Documentation: https://modelcontextprotocol.io/
- TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Example Servers List (check for updates)