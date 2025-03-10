# Current MCP Functionalities Map

## 1. MCPServerManager
Primary responsibility: Manages MCP servers and coordinates between ServerStateManager and ToolsHandler

### Core Features
- Server Lifecycle Management
  ```typescript
  - startServer(serverId: string, config: MCPServerConfig)
  - stopServer(serverId: string)
  - hasServer(serverId: string)
  - getServerIds(): string[]
  - getServerByIds(serverId: string)
  ```

### Tool Management
- Delegates to ToolsHandler
  ```typescript
  - getAvailableTools()
  - getToolByName(name: string)
  - refreshToolInformation()
  - enableTool(serverId: string, toolName: string)
  - disableTool(serverId: string, toolName: string)
  - getEnabledTools(serverId: string)
  ```

### State Management
- Event Handling
  ```typescript
  - Listens to 'serverError'
  - Listens to 'serverPaused'
  ```
- Database Integration
  ```typescript
  - _updateServerStatusInDB(serverId: string, state: ServerState)
  ```

## 2. ServerStateManager
Primary responsibility: Handles server states and lifecycle events

### State Management
```typescript
enum ServerState {
    STOPPED = 'STOPPED',
    STARTING = 'STARTING',
    RUNNING = 'RUNNING',
    PAUSED = 'PAUSED',
    ERROR = 'ERROR'
}
```

### Core Features
- Server Operations
  ```typescript
  - startServer(id: string, config: MCPServerConfig)
  - stopServer(id: string)
  - pauseServer(id: string)
  - resumeServer(id: string)
  ```

### Monitoring
- Health Checks
  ```typescript
  - HEALTH_CHECK_INTERVAL = 60000 // 1 minute
  - MAX_BACKOFF = 5 * 60 * 1000 // 5 minutes
  ```
- Activity Tracking
  ```typescript
  - updateActivity(id: string)
  - isServerActive(id: string)
  - IDLE_TIMEOUT = 30 * 60 * 1000 // 30 minutes
  ```

## 3. ToolsHandler
Primary responsibility: Manages tool registration, execution, and analytics

### Tool Management
- Registration & Discovery
  ```typescript
  - getAvailableTools()
  - getToolByName(name: string)
  - refreshToolInformation()
  ```

### Tool Execution
- Query Processing
  ```typescript
  - processQuery(query: string, conversationId: number)
  - validateToolArgs(tool: MCPToolDefinition, args: any)
  ```

### Analytics & Context
- Usage Tracking
  ```typescript
  - trackToolUsage(toolName: string, usage: {...})
  - analyzeUsagePatterns(toolId: string)
  ```
- Context Management
  ```typescript
  - getToolContext(toolName: string)
  - refreshToolContext(toolName: string, tool: ToolWithUsage)
  ```

### Caching
- Tool Cache
  ```typescript
  - TOOLS_CACHE_KEY = 'available-tools'
  - TOOLS_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
  ```

## 4. MCPClientService
Primary responsibility: Handles communication with MCP servers

### Core Features
- Client Operations
  ```typescript
  - initialize()
  - reconnect()
  - cleanup()
  ```

### Tool Operations
```typescript
- listTools()
- callTool(name: string, args: any)
- hasToolEnabled(toolName: string)
```

## Integration Points

### Database Integration
- Tool state persistence
- Usage history
- Context storage
- Server status tracking

### Event System
- Server state changes
- Error handling
- Activity monitoring

### Cache System
- Tool definitions
- Usage patterns
- Context data

## Current Dependencies
```typescript
- DatabaseService
- CacheService
- EventEmitter
- StdioClientTransport
- Client (from MCP SDK)
``` 