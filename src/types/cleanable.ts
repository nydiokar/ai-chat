/**
 * Interface for services that need cleanup functionality
 */
export interface Cleanable {
    /**
     * Cleanup resources and stop any ongoing operations
     * @returns Promise that resolves when cleanup is complete
     */
    cleanup(): Promise<void>;
} 