# Memory Management Service

## Overview

Kanebra's memory system provides comprehensive database-backed memory management for conversation contexts, user preferences, entity relationships, and command patterns, alongside in-memory reasoning step storage.

## Core Components

### Dual Memory Architecture

**1. Database-Backed Memory (MemoryRepository)**
```typescript
class MemoryRepository {
  // User preferences persistence
  async saveUserPreferences(preferences: UserPreferences): Promise<UserPreferences>

  // Conversation context management
  async saveContext(context: ConversationContext): Promise<ConversationContext>

  // Entity relationship tracking
  async saveEntityRelationship(relationship: EntityRelationship): Promise<EntityRelationship>

  // Command usage pattern analysis
  async saveCommandUsage(pattern: CommandUsagePattern): Promise<CommandUsagePattern>
}
```

**2. In-Memory Reasoning (InMemoryProvider)**
```typescript
interface MemoryProvider {
  store(entry: Omit<MemoryEntry, 'id' | 'timestamp'>): Promise<MemoryEntry>
  storeThoughtProcess(reasoningStep: ReasoningStep, userId: string): Promise<MemoryEntry>
  search(options: MemorySearchOptions): Promise<MemorySearchResult>
  getRelevantMemories(input: string, userId: string): Promise<MemoryEntry[]>
}
```

### Memory Entry Structure

```typescript
interface MemoryEntry {
  id: string;
  content: string;
  type: MemoryType;
  userId?: string;
  conversationId?: number;
  createdAt: Date;
  updatedAt: Date;
  relevance: number;
  tags: string[];
  metadata?: Record<string, any>;
}
```

## Memory Types

### Comprehensive Memory Types

**Database-Persisted Memory:**
- **Conversation Context**: Topics, entities, summaries with full relationships
- **User Preferences**: Personalized settings and behavior patterns
- **Entity Relationships**: Knowledge graph of people, projects, concepts
- **Command Usage Patterns**: Learning from user interaction patterns

**In-Memory Reasoning:**
- **Thought Process**: ReAct agent reasoning steps during execution
- **Conversation Memory**: Short-term conversation context
- **Factual Memory**: Immediate knowledge retrieval

## Storage Strategies

### In-Memory Provider
```typescript
class InMemoryProvider implements MemoryProvider {
  private store = new Map<string, MemoryEntry[]>();

  async store(conversationId: number, content: string): Promise<void> {
    const key = `conv_${conversationId}`;
    const entries = this.store.get(key) || [];
    const entry: MemoryEntry = {
      id: generateId(),
      content,
      type: MemoryType.CONVERSATION,
      conversationId,
      createdAt: new Date(),
      relevance: 1.0,
      tags: []
    };
    entries.push(entry);
    this.store.set(key, entries);
  }
}
```

### Database-Backed Storage
- Persistent storage using PostgreSQL
- Indexed for fast retrieval
- Supports complex queries and filtering

### Hybrid Approach
- Recent conversations in memory for speed
- Older data in database for persistence
- Automatic migration between storage layers

## Retrieval Strategies

### Basic Search
```typescript
class InMemoryProvider {
  async search(options: MemorySearchOptions): Promise<MemorySearchResult> {
    // Filter by user, type, tags, date range
    // Simple text matching for queries
    // Sort by timestamp (newest first)
    // Apply pagination
  }
}
```

### Simple Filtering
- User-based filtering
- Memory type filtering
- Tag-based filtering
- Date range filtering
- Basic text search

## Memory Lifecycle

### Memory Creation
```typescript
class MemoryManager {
  async createMemory(input: CreateMemoryInput): Promise<MemoryEntry> {
    const entry = await this.validateAndEnrich(input);
    await this.provider.store(entry);
    await this.updateIndexes(entry);
    return entry;
  }
}
```

### Memory Updates
- Content updates and corrections
- Relevance score adjustments
- Tag management and categorization
- Metadata enrichment

### Memory Cleanup
```typescript
class MemoryCleanupService {
  async cleanup(options: CleanupOptions): Promise<CleanupResult> {
    // Identify stale memories
    const staleEntries = await this.identifyStaleMemories(options);

    // Archive important memories
    await this.archiveImportantMemories(staleEntries);

    // Remove expired entries
    const removedCount = await this.removeEntries(staleEntries);

    return { removedCount, archivedCount: staleEntries.length - removedCount };
  }
}
```

## Basic Operations

### Persistent Storage
- Full database persistence with relationships
- User preference management with caching
- Conversation context analysis and summarization
- Entity relationship mapping and knowledge graphs
- Command pattern learning and adaptation

### Intelligent Retrieval
- Context-aware memory relevance scoring
- Entity relationship queries
- Conversation topic clustering
- User behavior pattern analysis
- Personalized memory ranking

### Caching Integration
- Node-cache for performance optimization
- TTL-based cache expiration
- Memory metrics tracking
- Performance monitoring integration

## Relevance Scoring

### Scoring Factors
- **Recency**: Newer memories are more relevant
- **Semantic Similarity**: Content similarity to query
- **User Context**: User-specific relevance
- **Usage Frequency**: Frequently accessed memories
- **Quality Score**: Manually or automatically assigned quality

### Scoring Algorithm
```typescript
class RelevanceScorer {
  calculateRelevance(entry: MemoryEntry, query: string, context: MemoryContext): number {
    const recencyScore = this.calculateRecencyScore(entry.createdAt);
    const similarityScore = this.calculateSimilarityScore(entry.content, query);
    const contextScore = this.calculateContextScore(entry, context);
    const usageScore = this.calculateUsageScore(entry);

    return this.combineScores([recencyScore, similarityScore, contextScore, usageScore]);
  }
}
```

## Privacy and Security

### Data Protection
- User data isolation and access controls
- Memory content encryption at rest
- Secure deletion and data purging
- Audit logging for memory access

### Privacy Controls
- User consent for memory retention
- Data anonymization options
- Memory export and deletion features
- Privacy-preserving memory sharing

## Integration Points

### AI Service Integration
```typescript
class AIWithMemoryService {
  async generateResponse(messages: Message[], context: ConversationContext): Promise<AIResponse> {
    // Retrieve relevant memories
    const memories = await this.memoryService.retrieveRelevant(
      messages[messages.length - 1].content,
      { userId: context.userId, conversationId: context.conversationId }
    );

    // Enrich context with memories
    const enrichedContext = this.enrichContext(context, memories);

    // Generate AI response
    return this.aiService.generateResponse(messages, enrichedContext);
  }
}
```

### Conversation Management
- Automatic memory extraction from conversations
- Context preservation across sessions
- Memory-informed response generation

## Monitoring and Analytics

### Memory Metrics
- Storage utilization and growth trends
- Retrieval performance and latency
- Memory quality and relevance scores
- User engagement with memory features

### Health Monitoring
- Memory service availability
- Database connection health
- Query performance monitoring
- Error rates and failure patterns

## Configuration

### Environment Variables
```env
# Memory service settings
MEMORY_ENABLED=true
MEMORY_PROVIDER=database
MEMORY_MAX_ENTRIES_PER_CONVERSATION=1000
MEMORY_RETENTION_DAYS=365

# Performance settings
MEMORY_CACHE_ENABLED=true
MEMORY_CACHE_TTL_MINUTES=60
MEMORY_MAX_QUERY_RESULTS=50

# Cleanup settings
MEMORY_CLEANUP_ENABLED=true
MEMORY_CLEANUP_INTERVAL_HOURS=24
MEMORY_CLEANUP_OLDER_THAN_DAYS=90
```

## Testing Strategy

### Unit Tests
```typescript
describe('MemoryService', () => {
  it('should store and retrieve memories', async () => {
    const entry = await memoryService.store(testConversationId, 'test content');
    const retrieved = await memoryService.retrieve(testConversationId);
    expect(retrieved).to.include(entry);
  });

  it('should perform semantic search', async () => {
    // Test semantic similarity search
  });
});
```

### Integration Tests
- End-to-end memory workflows
- Performance testing under load
- Memory consistency across services
- Database migration testing

## Future Enhancements

### Advanced Features
- **Vector Embeddings**: Advanced semantic search using vector databases
- **Memory Compression**: Automatic summarization and compression
- **Collaborative Memory**: Shared team knowledge bases
- **Memory Visualization**: Memory network graphs and relationships

### Performance Improvements
- **Distributed Caching**: Redis integration for high-performance caching
- **Memory Sharding**: Horizontal scaling for large memory stores
- **Real-time Sync**: Cross-device memory synchronization
- **Offline Support**: Local memory caching for offline operation

## Troubleshooting

### Common Issues

**Memory Not Persisting**:
- Check database connectivity and permissions
- Verify memory provider configuration
- Review error logs for storage failures

**Slow Retrieval**:
- Check database indexes and query performance
- Review caching configuration
- Monitor memory usage and cleanup

**Low Relevance Scores**:
- Verify embedding model configuration
- Check context filtering logic
- Review scoring algorithm parameters

### Debug Commands

```bash
# Test memory storage
npm run memory:test-store

# Check memory retrieval
npm run memory:test-retrieve

# Monitor memory performance
npm run memory:performance

# View memory statistics
npm run memory:stats

# Run memory cleanup
npm run memory:cleanup
```
