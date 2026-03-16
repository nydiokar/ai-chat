import {
  MemoryProvider,
  MemoryEntry,
  MemoryType,
  MemorySearchResult,
  MemorySearchOptions,
} from "../../../interfaces/memory-provider.js";
import { ReasoningStep } from "../../../interfaces/react-types.js";

/**
 * Minimal in-memory provider for evals.
 * Stores everything so assertions can inspect what the engine persisted.
 */
export class MockMemoryProvider implements MemoryProvider {
  private readonly entries: MemoryEntry[] = [];
  private nextId = 1;

  async initialize(): Promise<void> {}

  async store(
    entry: Omit<MemoryEntry, "id" | "timestamp">,
  ): Promise<MemoryEntry> {
    const full: MemoryEntry = {
      ...entry,
      id: `mem-${this.nextId++}`,
      timestamp: new Date(),
    };
    this.entries.push(full);
    return full;
  }

  async storeThoughtProcess(
    reasoningStep: ReasoningStep,
    userId: string,
    metadata?: Record<string, any>,
  ): Promise<MemoryEntry> {
    return this.store({
      userId,
      type: MemoryType.THOUGHT_PROCESS,
      content: { step: reasoningStep },
      metadata,
    });
  }

  async search(options?: MemorySearchOptions): Promise<MemorySearchResult> {
    let filtered = this.entries;
    if (options?.userId) {
      filtered = filtered.filter((e) => e.userId === options.userId);
    }
    if (options?.types) {
      filtered = filtered.filter((e) => options.types!.includes(e.type));
    }
    return { entries: filtered, total: filtered.length, hasMore: false };
  }

  async getById(id: string): Promise<MemoryEntry | null> {
    return this.entries.find((e) => e.id === id) ?? null;
  }

  async update(
    id: string,
    updates: Partial<Omit<MemoryEntry, "id">>,
  ): Promise<MemoryEntry> {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) throw new Error(`Memory entry ${id} not found`);
    Object.assign(entry, updates);
    return entry;
  }

  async delete(id: string): Promise<boolean> {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    this.entries.splice(idx, 1);
    return true;
  }

  async getSummary(): Promise<string> {
    return `${this.entries.length} entries stored`;
  }

  async clearUserMemories(userId: string): Promise<void> {
    const toRemove = this.entries
      .map((e, i) => (e.userId === userId ? i : -1))
      .filter((i) => i >= 0)
      .reverse();
    for (const idx of toRemove) this.entries.splice(idx, 1);
  }

  async getRelevantMemories(): Promise<MemoryEntry[]> {
    return [];
  }

  async cleanup(): Promise<void> {}

  // --- Inspection ---

  get storedEntries(): readonly MemoryEntry[] {
    return this.entries;
  }

  entriesOfType(type: MemoryType): MemoryEntry[] {
    return this.entries.filter((e) => e.type === type);
  }
}
