import { v4 as uuid } from 'uuid';
import { ThoughtProcess } from '../interfaces/agent.js';
import {
  MemoryEntry,
  MemoryProvider,
  MemorySearchOptions,
  MemorySearchResult,
  MemoryType
} from '../interfaces/memory-provider.js';

/**
 * In-memory implementation of the MemoryProvider interface
 * Suitable for development and testing
 */
export class InMemoryProvider implements MemoryProvider {
  private memories: Map<string, MemoryEntry> = new Map();
  private initialized: boolean = false;

  async initialize(): Promise<void> {
    this.initialized = true;
    return Promise.resolve();
  }

  async store(entry: Omit<MemoryEntry, 'id' | 'timestamp'>): Promise<MemoryEntry> {
    this.checkInitialized();
    
    const id = uuid();
    const timestamp = new Date();
    const fullEntry: MemoryEntry = {
      ...entry,
      id,
      timestamp
    };
    
    this.memories.set(id, fullEntry);
    return fullEntry;
  }

  async storeThoughtProcess(
    thoughtProcess: ThoughtProcess, 
    userId: string, 
    metadata?: Record<string, any>
  ): Promise<MemoryEntry> {
    return this.store({
      userId,
      type: MemoryType.THOUGHT_PROCESS,
      content: thoughtProcess,
      metadata,
      tags: ['thought_process'],
      importance: metadata?.importance || 0.5
    });
  }

  async search(options: MemorySearchOptions): Promise<MemorySearchResult> {
    this.checkInitialized();
    
    let entries = Array.from(this.memories.values());
    
    // Filter by userId if provided
    if (options.userId) {
      entries = entries.filter(entry => entry.userId === options.userId);
    }
    
    // Filter by memory types if provided
    if (options.types && options.types.length > 0) {
      entries = entries.filter(entry => options.types?.includes(entry.type));
    }
    
    // Filter by tags if provided
    if (options.tags && options.tags.length > 0) {
      entries = entries.filter(entry => 
        options.tags?.some(tag => entry.tags?.includes(tag))
      );
    }
    
    // Filter by date range if provided
    if (options.fromDate) {
      entries = entries.filter(entry => entry.timestamp >= options.fromDate!);
    }
    
    if (options.toDate) {
      entries = entries.filter(entry => entry.timestamp <= options.toDate!);
    }
    
    // Filter by importance if provided
    if (options.minImportance !== undefined) {
      entries = entries.filter(entry => 
        (entry.importance || 0) >= (options.minImportance || 0)
      );
    }
    
    // Filter by metadata if provided
    if (options.metadata) {
      entries = entries.filter(entry => {
        if (!entry.metadata) return false;
        
        return Object.entries(options.metadata!).every(([key, value]) => {
          return entry.metadata?.[key] === value;
        });
      });
    }
    
    // Handle text search if query is provided
    if (options.query) {
      const query = options.query.toLowerCase();
      entries = entries.filter(entry => {
        // For exact matches
        if (options.exactMatch) {
          if (typeof entry.content === 'string') {
            return entry.content.toLowerCase() === query;
          } else {
            return JSON.stringify(entry.content).toLowerCase() === query;
          }
        }
        
        // For partial matches
        if (typeof entry.content === 'string') {
          return entry.content.toLowerCase().includes(query);
        } else if (typeof entry.content === 'object') {
          return JSON.stringify(entry.content).toLowerCase().includes(query);
        }
        
        return false;
      });
    }
    
    // Sort entries
    if (options.sortBy) {
      const direction = options.sortDirection === 'desc' ? -1 : 1;
      
      entries.sort((a, b) => {
        if (options.sortBy === 'timestamp') {
          return direction * (a.timestamp.getTime() - b.timestamp.getTime());
        } else if (options.sortBy === 'importance') {
          return direction * ((a.importance || 0) - (b.importance || 0));
        }
        return 0;
      });
    } else {
      // Default sort by timestamp (newest first)
      entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }
    
    // Apply pagination
    const total = entries.length;
    const offset = options.offset || 0;
    const limit = options.limit || total;
    
    entries = entries.slice(offset, offset + limit);
    
    return {
      entries,
      total,
      hasMore: offset + limit < total
    };
  }

  async getById(id: string): Promise<MemoryEntry | null> {
    this.checkInitialized();
    return this.memories.get(id) || null;
  }

  async update(id: string, updates: Partial<Omit<MemoryEntry, 'id'>>): Promise<MemoryEntry> {
    this.checkInitialized();
    
    const entry = this.memories.get(id);
    if (!entry) {
      throw new Error(`Memory with ID ${id} not found`);
    }
    
    const updatedEntry: MemoryEntry = {
      ...entry,
      ...updates
    };
    
    this.memories.set(id, updatedEntry);
    return updatedEntry;
  }

  async delete(id: string): Promise<boolean> {
    this.checkInitialized();
    return this.memories.delete(id);
  }

  async getSummary(userId: string, options?: Partial<MemorySearchOptions>): Promise<string> {
    this.checkInitialized();
    
    const searchResult = await this.search({
      userId,
      limit: 10,
      sortBy: 'importance',
      sortDirection: 'desc',
      ...options
    });
    
    if (searchResult.entries.length === 0) {
      return "No memories found for this user.";
    }
    
    // Group memories by type for better organization
    const groupedByType: Record<string, MemoryEntry[]> = {};
    
    for (const entry of searchResult.entries) {
      if (!groupedByType[entry.type]) {
        groupedByType[entry.type] = [];
      }
      groupedByType[entry.type].push(entry);
    }
    
    // Create summary text
    let summary = `Memory summary for user ${userId}:\n\n`;
    
    for (const [type, entries] of Object.entries(groupedByType)) {
      summary += `${type.toUpperCase()}:\n`;
      
      for (const entry of entries) {
        const contentStr = typeof entry.content === 'string' 
          ? entry.content 
          : JSON.stringify(entry.content);
          
        summary += `- ${contentStr.substring(0, 100)}${contentStr.length > 100 ? '...' : ''}\n`;
      }
      
      summary += '\n';
    }
    
    return summary;
  }

  async clearUserMemories(userId: string): Promise<void> {
    this.checkInitialized();
    
    for (const [id, entry] of this.memories.entries()) {
      if (entry.userId === userId) {
        this.memories.delete(id);
      }
    }
  }

  async getRelevantMemories(input: string, userId: string, limit: number = 5): Promise<MemoryEntry[]> {
    this.checkInitialized();
    
    // For in-memory provider, we'll use simple keyword matching
    // More sophisticated providers would use vector embeddings/semantic search
    const query = input.toLowerCase();
    
    // Get all memories for this user
    const userMemories = Array.from(this.memories.values())
      .filter(entry => entry.userId === userId);
    
    // Assign relevance scores based on content matching
    const scoredMemories = userMemories.map(memory => {
      let score = 0;
      const contentStr = typeof memory.content === 'string'
        ? memory.content
        : JSON.stringify(memory.content);
      
      // Simple scoring based on substring matching
      if (contentStr.toLowerCase().includes(query)) {
        score += 1;
      }
      
      // Bonus points for exact matches of words
      const words = query.split(/\s+/);
      for (const word of words) {
        if (word.length > 3 && contentStr.toLowerCase().includes(word)) {
          score += 0.5;
        }
      }
      
      // Consider importance
      score *= (memory.importance || 0.5);
      
      return { memory, score };
    });
    
    // Sort by score and take top N
    return scoredMemories
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => item.memory);
  }

  async cleanup(): Promise<void> {
    this.memories.clear();
    this.initialized = false;
    return Promise.resolve();
  }
  
  private checkInitialized(): void {
    if (!this.initialized) {
      throw new Error('Memory provider not initialized. Call initialize() first.');
    }
  }
} 