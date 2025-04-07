import { MemoryProvider } from '../interfaces/memory-provider.js';
import { InMemoryProvider } from './in-memory-provider.js';

/**
 * Type of memory providers that can be created by the factory
 */
export enum MemoryProviderType {
  IN_MEMORY = 'in_memory',
  MEM0 = 'mem0',  // Placeholder for future Mem0 integration
  CUSTOM = 'custom'
}

/**
 * Configuration options for memory providers
 */
export interface MemoryProviderConfig {
  type: MemoryProviderType;
  mem0Config?: {
    apiKey?: string;
    endpoint?: string;
    // Other Mem0-specific config options
  };
  customProvider?: MemoryProvider;
}

/**
 * Factory class to create and manage memory providers
 */
export class MemoryFactory {
  private static instance: MemoryFactory;
  private activeProvider: MemoryProvider | null = null;
  private config: MemoryProviderConfig;

  /**
   * Default configuration
   */
  private defaultConfig: MemoryProviderConfig = {
    type: MemoryProviderType.IN_MEMORY
  };

  private constructor(config?: Partial<MemoryProviderConfig>) {
    this.config = { ...this.defaultConfig, ...config };
  }

  /**
   * Get the singleton instance of the factory
   */
  public static getInstance(config?: Partial<MemoryProviderConfig>): MemoryFactory {
    if (!MemoryFactory.instance) {
      MemoryFactory.instance = new MemoryFactory(config);
    } else if (config) {
      // Update config if provided
      MemoryFactory.instance.setConfig(config);
    }
    return MemoryFactory.instance;
  }

  /**
   * Update the factory configuration
   */
  public setConfig(config: Partial<MemoryProviderConfig>): void {
    this.config = { ...this.config, ...config };
    
    // If provider type changes, reset the active provider
    if (config.type && this.activeProvider && config.type !== this.config.type) {
      this.activeProvider = null;
    }
  }

  /**
   * Create and initialize a memory provider based on the configuration
   */
  public async createProvider(): Promise<MemoryProvider> {
    // If provider already exists, return it
    if (this.activeProvider) {
      return this.activeProvider;
    }

    let provider: MemoryProvider;

    switch (this.config.type) {
      case MemoryProviderType.IN_MEMORY:
        provider = new InMemoryProvider();
        break;
        
      case MemoryProviderType.MEM0:
        // Placeholder for future Mem0 integration
        throw new Error('Mem0 integration not yet implemented');
        
      case MemoryProviderType.CUSTOM:
        if (!this.config.customProvider) {
          throw new Error('Custom provider specified but no provider instance provided');
        }
        provider = this.config.customProvider;
        break;
        
      default:
        throw new Error(`Unknown memory provider type: ${this.config.type}`);
    }

    // Initialize the provider
    await provider.initialize();
    this.activeProvider = provider;
    
    return provider;
  }

  /**
   * Get the current active provider, creating one if needed
   */
  public async getProvider(): Promise<MemoryProvider> {
    if (!this.activeProvider) {
      return this.createProvider();
    }
    return this.activeProvider;
  }

  /**
   * Clean up the current provider and reset the factory
   */
  public async cleanup(): Promise<void> {
    if (this.activeProvider) {
      await this.activeProvider.cleanup();
      this.activeProvider = null;
    }
  }
} 