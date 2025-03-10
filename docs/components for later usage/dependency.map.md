DiscordService
    ├── AIServiceFactory
    │   └── Concrete AI Services (OpenAI, Claude, etc.)
    │       └── BaseAIService
    │           ├── Responsibilities:
    │           │   - Abstract base for AI services
    │           │   - Manages system prompts
    │           │   - Processes messages and generates responses
    │           │   - Handles tool query processing ✓
    │           └── Uses: ToolInformationProvider
    └── MCPServerManager
        ├── Responsibilities:
        │   - Server lifecycle coordination
        │   - Tool enabling/disabling in DB ✓
        │   - DB status synchronization
        │   - Tool context refreshing
        │   - Tool query execution routing ✓
        │   - Implements ToolInformationProvider (delegates to ToolsHandler)
        │
        ├── ServerStateManager
        │   ├── Responsibilities:
        │   │   - Server state management (RUNNING/STOPPED/PAUSED/ERROR)
        │   │   - Health checks
        │   │   - Activity monitoring
        │   │   - Server lifecycle events
        │   │   - Client instance management
        │   └── Uses: MCPClientService
        │
        └── ToolsHandler
            ├── Responsibilities:
            │   - Tool registration and discovery
            │   - Tool execution and validation ✓
            │   - Tool context management
            │   - Tool usage tracking
            │   - Tool caching
            │   - Tool response formatting
            │   - Tool enabling/disabling ✓
            │   - Tool state management ✓
            │   - Tool DB synchronization ✓
            │   - Implements ToolInformationProvider (direct implementation)
            │
            └── Uses:
                ├── MCPClientService (for tool operations)
                ├── DatabaseService (for persistence)
                └── CacheService (for tool caching)

