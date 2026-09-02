# Kanebra Type System Documentation

## Overview

Kanebra uses TypeScript with strict typing throughout the application. The type system is organized into logical modules that provide type safety for all major components of the system.

## Core Type Modules

### Base Types (`src/types/index.ts`)

#### Message Roles
```typescript
export enum Role {
  user = 'user',
  assistant = 'assistant',
  system = 'system',
  function = 'function',
  tool = 'tool',
  developer = 'developer'
}
```

#### AI Models
```typescript
export const Model = {
  // OpenAI models
  'gpt-4-0125-preview': 'gpt-4-0125-preview',
  'gpt-3.5-turbo-0125': 'gpt-3.5-turbo-0125',
  'gpt-3.5-turbo-16k': 'gpt-3.5-turbo-16k',
  'gpt-4o-mini-2024-07-18': 'gpt-4o-mini-2024-07-18',
  'gpt-4o-2024-08-06': 'gpt-4o-2024-08-06',
  // Provider types
  openai: 'openai',
  claude: 'claude',
  ollama: 'ollama'
} as const;

export type AIModel = typeof Model[keyof typeof Model];
export type MessageRole = keyof typeof Role;
```

#### Core Interfaces

**Message Interface**:
```typescript
export interface Message {
  id: number;
  content: string;
  role: MessageRole;
  createdAt: Date;
  conversationId: number;
  tokenCount?: number | null;  // Allow null for Prisma compatibility
  discordUserId?: string | null;
  discordUsername?: string | null;
  name?: string;  // For function messages
  tool_call_id?: string;  // For tool messages
}
```

**Conversation Interface**:
```typescript
export interface Conversation {
  id: number;
  model: AIModel;
  title?: string;
  summary?: string;
  createdAt: Date;
  updatedAt: Date;
  tokenCount: number;
  discordGuildId?: string;
  discordChannelId?: string;
  messages: Message[];
  session?: Session;
}
```

### Task Management Types (`src/types/task.ts`)

#### Task Statuses
```typescript
export enum TaskStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  BLOCKED = 'BLOCKED'
}
```

#### Task Priorities
```typescript
export enum TaskPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT'
}
```

#### Recurrence Patterns
```typescript
export enum RecurrenceType {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  CUSTOM = 'CUSTOM'
}

export interface RecurrencePattern {
  type: RecurrenceType;
  interval: number; // 1 for daily, 2 for every other day, etc.
  daysOfWeek?: number[]; // 0-6 for weekly recurrence
  dayOfMonth?: number; // 1-31 for monthly recurrence
  endDate?: Date;
  endAfterOccurrences?: number;
  customPattern?: string; // For custom cron-like patterns
}
```

#### Task Interface
```typescript
export interface Task {
  id: number;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: Date;
  updatedAt: Date;
  dueDate?: Date;
  assigneeId?: string;
  creatorId: string;
  estimatedHours?: number;
  actualHours?: number;
  tags?: string[];
  metadata?: Record<string, any>;
  recurrence?: RecurrencePattern;
  parentTaskId?: number;
  dependencies: TaskDependency[];
  subtasks: Task[];
  history: TaskHistory[];
}
```

### Error Types (`src/types/errors.ts`)

```typescript
export class BotError extends Error {
  constructor(
    message: string,
    public cause?: Error,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'BotError';
  }
}

export class ValidationError extends BotError {
  constructor(message: string, cause?: Error) {
    super(message, cause, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
  }
}

export class DatabaseError extends BotError {
  constructor(message: string, cause?: Error) {
    super(message, cause, 'DATABASE_ERROR', 500);
    this.name = 'DatabaseError';
  }
}

export class AIProviderError extends BotError {
  constructor(message: string, cause?: Error) {
    super(message, cause, 'AI_PROVIDER_ERROR', 502);
    this.name = 'AIProviderError';
  }
}
```

### Discord Types (`src/types/discord.ts`)

```typescript
export interface DiscordUser {
  id: string;
  username: string;
  discriminator?: string;
  avatar?: string;
  bot?: boolean;
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon?: string;
  ownerId: string;
  permissions?: string;
}

export interface DiscordChannel {
  id: string;
  type: number;
  guildId?: string;
  name?: string;
  topic?: string;
  parentId?: string;
}

export interface DiscordMessage {
  id: string;
  channelId: string;
  guildId?: string;
  author: DiscordUser;
  content: string;
  timestamp: Date;
  editedTimestamp?: Date;
  mentions: DiscordUser[];
  mentionRoles: string[];
  attachments: DiscordAttachment[];
  embeds: DiscordEmbed[];
  reactions: DiscordReaction[];
}
```

### Cache Types (`src/types/cache/`)

```typescript
export interface CacheEntry<T = any> {
  key: string;
  value: T;
  expiresAt?: Date;
  createdAt: Date;
  lastAccessed: Date;
  accessCount: number;
  size: number;
}

export interface CacheConfig {
  ttl: number; // Time to live in milliseconds
  maxSize: number; // Maximum cache size in bytes
  strategy: 'LRU' | 'LFU' | 'TTL';
  compression?: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  clears: number;
  size: number;
  entries: number;
}
```

### Memory Types (`src/types/memory.ts`)

```typescript
export interface MemoryEntry {
  id: string;
  content: string;
  type: 'conversation' | 'fact' | 'preference' | 'context';
  userId?: string;
  conversationId?: number;
  createdAt: Date;
  updatedAt: Date;
  relevance: number;
  tags: string[];
  metadata?: Record<string, any>;
}

export interface MemoryContext {
  userId?: string;
  conversationId?: number;
  currentTopic?: string;
  recentTopics: string[];
  userPreferences: Record<string, any>;
  relevantMemories: MemoryEntry[];
}
```

### Service Types (`src/types/services/`)

#### AI Service Types
```typescript
export interface AIProvider {
  name: string;
  models: AIModel[];
  generateResponse(request: AIRequest): Promise<AIResponse>;
  estimateTokens(text: string): number;
}

export interface AIRequest {
  messages: Message[];
  model: AIModel;
  temperature?: number;
  maxTokens?: number;
  tools?: Tool[];
  toolChoice?: 'auto' | 'none' | 'required';
}

export interface AIResponse {
  content: string;
  role: MessageRole;
  model: AIModel;
  tokenUsage: {
    prompt: number;
    completion: number;
    total: number;
  };
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
}
```

### MCP Types (`src/tools/mcp/types/`)

```typescript
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  handler: ToolHandler;
  serverId: string;
  version: string;
  capabilities: string[];
}

export interface MCPServer {
  id: string;
  name: string;
  version: string;
  capabilities: ServerCapability[];
  tools: MCPTool[];
  config: ServerConfig;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
}
```

### Utility Types (`src/types/common.ts`)

```typescript
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export interface PaginationOptions {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}
```

## Type Safety Patterns

### Strict Null Checks
All types use strict null checking. Optional properties are explicitly marked with `?` and nullable types use `| null`.

### Interface Segregation
Large interfaces are broken down into smaller, focused interfaces that can be composed together.

### Generic Constraints
Generic types are constrained appropriately to ensure type safety:

```typescript
export interface Repository<T extends { id: number }> {
  findById(id: number): Promise<T | null>;
  findAll(options?: PaginationOptions): Promise<PaginatedResponse<T>>;
  create(data: Omit<T, 'id'>): Promise<T>;
  update(id: number, data: Partial<T>): Promise<T>;
  delete(id: number): Promise<void>;
}
```

### Discriminated Unions
Complex type hierarchies use discriminated unions for better type safety:

```typescript
export type TaskEvent =
  | { type: 'created'; task: Task }
  | { type: 'updated'; task: Task; changes: Partial<Task> }
  | { type: 'deleted'; taskId: number }
  | { type: 'status_changed'; taskId: number; oldStatus: TaskStatus; newStatus: TaskStatus };
```

## Type Guards and Assertions

### Type Guards
```typescript
export function isTaskEvent(event: unknown): event is TaskEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'type' in event &&
    typeof event.type === 'string' &&
    ['created', 'updated', 'deleted', 'status_changed'].includes(event.type)
  );
}
```

### Type Assertions (used sparingly)
```typescript
// Only when we know the type from context
const task = response.data as Task;
```

## Import/Export Patterns

Types are exported from index files for clean imports:

```typescript
// src/types/index.ts
export * from './errors.js';
export * from './task.js';
export * from './prompts.js';
export * from './ollama.js';
export * from './discord.js';
export * from './cleanable.js';
export * from './memory.js';
export * from './common.js';
```

This allows for clean imports throughout the codebase:
```typescript
import { Task, TaskStatus, BotError } from '../types';
```

## Type Testing

Types are validated through:
- **Unit tests** for type guards and utility functions
- **Integration tests** ensuring proper typing across service boundaries
- **TypeScript compiler** strict mode checks
- **Manual type assertions** in critical paths

The comprehensive type system ensures runtime safety and provides excellent developer experience with full IntelliSense support.
