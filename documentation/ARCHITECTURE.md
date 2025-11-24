# Kanebra Architecture Overview

## System Overview

Kanebra is a comprehensive AI-powered Discord bot system built with TypeScript that integrates cryptocurrency token tracking, advanced task management, and extensible tool support through the Model Context Protocol (MCP).

## Core Architecture

### System Layers

```
┌─────────────────┐
│   Discord Bot   │ ← User Interface
└─────────────────┘
         │
┌─────────────────┐
│  Feature Layer  │ ← Business Logic (hot-tokens, tasks, pulse-mcp)
└─────────────────┘
         │
┌─────────────────┐
│ Service Layer   │ ← Core Services (AI, Memory, Cache, Performance)
└─────────────────┘
         │
┌─────────────────┐
│   Tool Layer    │ ← MCP Integration & Tool Management
└─────────────────┘
         │
┌─────────────────┐
│   Data Layer    │ ← Prisma ORM + PostgreSQL
└─────────────────┘
```

### Key Components

#### 1. **Discord Bot Layer** (`src/discord-bot.ts`)
- Primary user interface and command handling
- Integrates with Discord.js for bot functionality
- Routes commands to appropriate feature handlers
- Manages Discord-specific concerns (channels, guilds, users)

#### 2. **Feature Layer** (`src/features/`)
- **Hot Tokens** (`hot-tokens/`): Cryptocurrency tracking and analysis
- **Tasks** (`tasks/`): Advanced task scheduling and dependency management
- **Pulse MCP** (`pulse-mcp/`): Dynamic tool loading and server management

#### 3. **Service Layer** (`src/services/`)
- **AI Services**: Multi-provider AI integration (OpenAI, Anthropic, Ollama)
- **Memory Services**: Conversation context and memory management
- **Cache Services**: Performance optimization and data caching
- **Performance Services**: System monitoring and query optimization
- **Discord Services**: Discord API abstractions

#### 4. **Tool Layer** (`src/tools/`)
- **MCP Integration**: Model Context Protocol server management
- **Tool Chain**: Tool execution orchestration
- **Dashboard**: MCP status monitoring and management
- **Diagnostic Tools**: GitHub integration and system diagnostics

#### 5. **Agent Layer** (`src/agents/`)
- **React Agent**: Chain-of-thought reasoning implementation
- **Agent Factory**: Dynamic agent instantiation
- **React Engine**: Reasoning execution and tool integration

### Data Architecture

#### Database Schema (Prisma)

**Core Models**:
- `Message`: Individual chat messages with threading support
- `Conversation`: Chat sessions with AI model tracking
- `ConversationContext`: Context management for conversations
- `Task`: Task management with dependencies and scheduling
- `Token`: Cryptocurrency token data and tracking
- `MCPTool`: MCP tool registration and metadata
- `MCPServer`: MCP server configurations

**Key Relationships**:
- Messages belong to Conversations (many-to-one)
- Tasks have dependencies (many-to-many through TaskDependency)
- Tokens have categories and tracking data
- MCP tools are organized by servers and capabilities

### Dependency Injection

The system uses InversifyJS for dependency injection:

```typescript
// Service registration pattern
container.bind<AIProvider>(TYPES.AIProvider).to(OpenAIProvider);
container.bind<MemoryService>(TYPES.MemoryService).to(MemoryService);

// Constructor injection
constructor(
  @inject(TYPES.Logger) private logger: Logger,
  @inject(TYPES.Database) private db: Database
) {}
```

### Configuration Management

**Environment-Based Configuration**:
- `.env.development` / `.env.production`
- Dynamic database URL resolution via `prisma.config.ts`
- MCP server configurations in `mcp_config.ts`

### Error Handling & Logging

**Winston-based Logging**:
- Structured logging with configurable levels
- Separate error and general logs
- Performance monitoring integration

**Error Types**:
- Custom error classes for different failure modes
- Proper error propagation through service layers
- Discord-friendly error messaging

### Testing Strategy

**Test Coverage Areas**:
- Unit tests for individual functions and services
- Integration tests for feature interactions
- MCP tool functionality testing
- Discord bot command testing
- Database operation testing

**Testing Tools**:
- Mocha + Chai for test framework
- Sinon for mocking and stubbing
- c8 for coverage reporting

### Performance Considerations

**Optimization Features**:
- Query optimization service for database performance
- Context scoring for memory management
- Caching layers for frequently accessed data
- Rate limiting for external API calls

### Security Architecture

**Security Measures**:
- Input validation and sanitization
- Rate limiting on Discord commands
- Secure environment variable management
- MCP tool execution sandboxing

### Deployment Architecture

**PM2 Process Management**:
- Production deployment with ecosystem configuration
- Process monitoring and automatic restarts
- Log aggregation and rotation

**CI/CD Pipeline**:
- GitHub Actions for automated testing
- CodeQL security scanning
- Automated dependency updates
- Release automation

## Communication Patterns

### Event-Driven Architecture
- Discord events trigger feature handlers
- Task scheduling uses cron-like patterns
- MCP tool discovery uses polling mechanisms

### Service Communication
- Dependency injection for service coupling
- Interface-based service contracts
- Observable patterns for real-time updates

## Extensibility Points

### Adding New Features
1. Create feature directory in `src/features/`
2. Implement command handlers and services
3. Register with dependency injection container
4. Add database migrations if needed
5. Update Discord command routing

### Adding New AI Providers
1. Implement provider interface in `src/providers/`
2. Register with AI factory
3. Add configuration options
4. Update environment variable documentation

### Adding New MCP Tools
1. Register tool schemas in MCP configuration
2. Implement tool handlers if needed
3. Add to tool chain configuration
4. Update server management logic

This architecture provides a solid foundation for AI-powered Discord bot functionality while maintaining clean separation of concerns and extensibility for future enhancements.
