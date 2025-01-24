# AI Chat System Context

## Core Files & Patterns
- `mcp-server-manager.ts`: MCP server lifecycle and tools management
- `tools-handler.ts`: Tool execution and response processing
- `mcp-client-service.ts`: Tool communication and state management
- `error-handler.ts`: Standardized error handling patterns
- `base-service.ts`: AI service abstraction template

## Integration Examples
### MCP Tool Integration
```typescript
// Tool registration pattern
mcpConfig.mcpServers[serverId] = {
  command: nodePath,
  args: ["path/to/server"],
  env: { API_KEY: process.env.KEY },
  tools: [{ name: "tool_name", description: "..." }]
};

// Tool execution pattern
const result = await client.callTool(toolName, args);
await db.addMessage(conversationId, result, 'assistant');
```

### Task System Core
```typescript
interface Task {
  id: string;
  content: string;
  status: TaskStatus;
  dueDate?: Date;
  reminderTime?: Date;
  discordChannelId?: string;
}

// Task operations pattern
class TaskManager {
  async createTask(task: Task): Promise<void>;
  async updateStatus(id: string, status: TaskStatus): Promise<void>;
  async setReminder(id: string, time: Date): Promise<void>;
}
```

## Current Development Focus
- Tool Registration Standard 
- Task Management Foundation
- Reminder System Integration
- Tool Execution Reliability

## Next Steps
1. Implement unified tool interface
2. Build task schema and operations
3. Add Discord command handlers
4. Integrate reminder notifications

## Technical Boundaries
- Rate limiting: Max 50 requests/min
- Context window: 10 messages
- Message length: 4000 chars
- Tool timeout: 30s

## Core Patterns
- Event-driven architecture
- Repository pattern for data access
- Strategy pattern for AI services
- Factory pattern for service creation
- Command pattern for Discord interactions