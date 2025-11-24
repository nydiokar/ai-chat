# Kanebra Service & Feature Architecture Map

## System Overview

Kanebra is a Discord bot with AI capabilities, task management, and cryptocurrency token tracking. Built with TypeScript, Node.js, Prisma, and MCP integration.

## Feature Map

### Core Features

```
┌─────────────────────────────────────────────────────────────┐
│                    KANE BRA FEATURES                       │
├─────────────────────────────────────────────────────────────┤
│  🤖 AI Integration    │  📋 Task Management  │  💰 Hot Tokens    │
│  - OpenAI provider    │  - CRUD operations   │  - Token database  │
│  - Ollama provider    │  - Dependencies      │  - Categories      │
│  - ReAct agent        │  - Recurring tasks   │  - Manual tracking │
│  - MCP tools          │  - Notifications     │  - Discord commands│
└─────────────────────────────────────────────────────────────┘
```

### Feature Relationships

```
Discord Bot
    │
    ├── AI Integration (ReAct Agent)
    │   ├── OpenAI Provider
    │   ├── Ollama Provider
    │   └── MCP Tools (GitHub, Brave Search)
    │
    ├── Task Management
    │   ├── Task CRUD
    │   ├── Dependencies
    │   ├── Recurring Tasks
    │   └── Notifications
    │
    └── Hot Tokens
        ├── Token Database
        ├── Category Management
        └── Price Tracking (Manual)
```

## Service Map

### Core Services

```
┌─────────────────────────────────────────────────────────────┐
│                    CORE SERVICES                           │
├─────────────────────────────────────────────────────────────┤
│  💾 Database         │  🤖 AI Factory      │  📦 Cache Service  │
│  - Prisma ORM        │  - Provider mgmt    │  - File-based      │
│  - PostgreSQL        │  - Model selection  │  - Security filter │
│  - Migrations        │  - Load balancing   │  - TTL support     │
├─────────────────────────────────────────────────────────────┤
│  🧠 Memory Service   │  📊 Performance     │  🔔 Notifications  │
│  - DB-persisted      │  - Query monitoring │  - Discord DMs     │
│  - Conversation ctx  │  - Context scoring  │  - Task alerts     │
│  - User preferences  │  - Middleware       │  - Error handling  │
└─────────────────────────────────────────────────────────────┘
```

### Service Dependencies

```
Database Service
├── Used by ALL features (Task, HotTokens, AI)
├── Query performance monitoring
└── Migration management

AI Factory Service
├── Manages OpenAI & Ollama providers
├── Used by ReAct Agent
└── Handles model selection & fallbacks

Cache Service
├── File-based Keyv storage
├── Used by AI providers
└── Security filtering (GitHub tokens, etc.)

Memory Service
├── In-memory reasoning step storage
├── Used by ReAct agent
└── Simple search/filtering

Performance Service
├── Database query monitoring (Prisma middleware)
├── Context scoring for memory relevance
└── Basic performance metrics

Notification Service
├── Discord direct messages
├── Task status notifications
└── Error alerts
```

## Data Flow Architecture

### Request Flow (Discord Command)

```
User Command → Discord Bot → Feature Handler → Service Layer → Database
                      │              │              │
                      └──────────────┼──────────────┴── AI Integration
                                     │
                                     └────────────── MCP Tools
                                                    (GitHub, Brave Search)
```

### AI Processing Flow

```
Discord Message → ReAct Agent → LLM Provider (OpenAI/Ollama)
                       │                      │
                       ├── Memory Storage     ├── Tool Execution
                       │   (Reasoning Steps)      (MCP Tools)
                       │                      │
                       └── Response Generation   └── Result Processing
```

### Task Management Flow

```
Task Command → Task Service → Database Operations
                │                      │
                ├── Dependency Check   ├── Status Updates
                │                      │
                └── Notification Send  └── History Logging
```

## Component Relationships

### Service-to-Service Dependencies

```
AI Factory
├── Uses: Database (for conversation storage)
├── Uses: Cache (for response caching)
└── Used by: ReAct Agent

Task Services
├── Uses: Database (CRUD operations)
├── Uses: Notification Service (status alerts)
├── Uses: Cache (query results)
└── Used by: Discord Commands

Hot Tokens Service
├── Uses: Database (token storage)
├── Uses: Cache (API responses)
└── Used by: Discord Commands

Cache Service
├── Uses: File System (Keyv storage)
└── Used by: All services (performance optimization)

Memory Service (Dual System)
├── MemoryRepository: Database persistence (contexts, preferences, relationships)
├── InMemoryProvider: ReAct reasoning steps during execution
├── Uses: Prisma database + Node-cache for performance
└── Used by: AI system, task management, user personalization

Performance Service
├── Uses: Database (metrics storage)
├── Monitors: All database queries
└── Provides: Context scoring
```

### Feature-to-Service Dependencies

```
AI Integration Feature
├── Requires: AI Factory Service
├── Requires: Memory Service
├── Requires: MCP Tools
└── Requires: Database (conversations)

Task Management Feature
├── Requires: Task Services (CRUD, Dependencies, Recurring)
├── Requires: Notification Service
├── Requires: Database (task storage)
└── Requires: Cache (performance)

Hot Tokens Feature
├── Requires: Hot Tokens Service
├── Requires: Database (token storage)
└── Requires: Cache (if any API calls)
```

## Database Schema Overview

### Core Tables

```
Conversation (AI chats)
├── Messages (chat history)
├── Sessions (user context)
└── Context (conversation state)

Task (task management)
├── TaskDependency (task relationships)
├── TaskHistory (audit trail)
└── TaskInstance (recurring instances)

HotToken (cryptocurrency tracking)
├── Categories and tags
├── Manual price updates
└── Market cap tracking

MCP Tools & Servers (tool management)
├── Tool definitions
├── Server configurations
└── Execution tracking
```

## Configuration Layers

### Environment Configuration

```
├── .env.development / .env.production
├── PM2 ecosystem configuration
├── Prisma database config
├── MCP server configurations
└── AI provider settings
```

### Runtime Configuration

```
├── Feature flags (enable/disable features)
├── Service instantiation (dependency injection)
├── Database connections
├── Cache settings
└── Logging levels
```

## Integration Points

### External Services

```
Discord API
├── Bot commands and responses
├── Direct messages (notifications)
├── Guild and channel management
└── User interactions

AI Providers
├── OpenAI (GPT models)
├── Ollama (local models)
└── Future: Anthropic (configured but not implemented)

MCP Servers
├── GitHub (repository management)
├── Brave Search (web search)
└── Future: Additional tool servers

Database
├── PostgreSQL (production)
├── SQLite (development)
└── Prisma ORM (query interface)
```

### Internal Communication

```
Service Bus (Dependency Injection)
├── Inversify container
├── Service registration
├── Dependency resolution
└── Instance management

Event System (Notifications)
├── Task status changes
├── AI response completion
├── Error conditions
└── System alerts
```

This architecture provides a solid foundation for a Discord bot with AI capabilities, while maintaining clean separation of concerns and extensibility for future enhancements.
