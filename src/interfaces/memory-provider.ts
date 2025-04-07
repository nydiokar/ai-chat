import { ThoughtProcess } from './agent.js';

/**
 * Memory entry structure for storing agent memories
 */
export interface MemoryEntry {
  id: string;
  userId: string;
  type: MemoryType;
  content: any;
  metadata?: Record<string, any>;
  timestamp: Date;
  tags?: string[];
  importance?: number;
  expiresAt?: Date;
}

/**
 * Types of memory that can be stored
 */
export enum MemoryType {
  CONVERSATION = 'conversation',
  TOOL_USAGE = 'tool_usage',
  USER_PREFERENCE = 'user_preference',
  FACT = 'fact',
  THOUGHT_PROCESS = 'thought_process',
  SYSTEM = 'system'
}

/**
 * Search options for retrieving memories
 */
export interface MemorySearchOptions {
  userId?: string;
  types?: MemoryType[];
  query?: string;
  tags?: string[];
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
  minImportance?: number;
  exactMatch?: boolean;
  metadata?: Record<string, any>;
  sortBy?: 'timestamp' | 'importance';
  sortDirection?: 'asc' | 'desc';
}

/**
 * Result of a memory search operation
 */
export interface MemorySearchResult {
  entries: MemoryEntry[];
  total: number;
  hasMore: boolean;
}

/**
 * Interface for memory providers
 * This allows for different implementations (in-memory, Mem0, custom DB, etc.)
 */
export interface MemoryProvider {
  /**
   * Initialize the memory provider
   */
  initialize(): Promise<void>;
  
  /**
   * Store a memory
   */
  store(entry: Omit<MemoryEntry, 'id' | 'timestamp'>): Promise<MemoryEntry>;
  
  /**
   * Store a thought process in memory
   */
  storeThoughtProcess(thoughtProcess: ThoughtProcess, userId: string, metadata?: Record<string, any>): Promise<MemoryEntry>;
  
  /**
   * Retrieve memories based on search criteria
   */
  search(options: MemorySearchOptions): Promise<MemorySearchResult>;
  
  /**
   * Get memory by ID
   */
  getById(id: string): Promise<MemoryEntry | null>;
  
  /**
   * Update an existing memory
   */
  update(id: string, updates: Partial<Omit<MemoryEntry, 'id'>>): Promise<MemoryEntry>;
  
  /**
   * Delete a memory by ID
   */
  delete(id: string): Promise<boolean>;
  
  /**
   * Get summary of memories for a user
   * Useful for providing context to LLMs
   */
  getSummary(userId: string, options?: Partial<MemorySearchOptions>): Promise<string>;
  
  /**
   * Clear all memories for a user
   */
  clearUserMemories(userId: string): Promise<void>;
  
  /**
   * Get relevant memories for a given input/context
   * This may use semantic search or other relevance algorithms
   */
  getRelevantMemories(input: string, userId: string, limit?: number): Promise<MemoryEntry[]>;
  
  /**
   * Clean up resources when no longer needed
   */
  cleanup(): Promise<void>;
} 