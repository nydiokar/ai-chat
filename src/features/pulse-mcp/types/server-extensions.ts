/**
 * Type extensions and guards for the server manager
 * 
 * These types help with accessing protected properties when needed for
 * dynamic loading purposes.
 */

import { Container } from 'inversify';
import { IServerManager } from '../../../tools/mcp/interfaces/core.js';
import { ServerConfig } from '../../../tools/mcp/types/server.js';

/**
 * Extended server manager interface with container access
 */
export interface IExtendedServerManager extends IServerManager {
    container?: Container;
}

/**
 * Type guard to check if a server manager has container access
 * 
 * @param manager The server manager to check
 * @returns True if the manager has container access
 */
export function hasContainerAccess(manager: any): manager is IExtendedServerManager {
    return manager && typeof manager === 'object' && 'container' in manager;
}

/**
 * Type guard to check if a server manager has enhanced capabilities
 * 
 * @param manager The server manager to check
 * @returns True if the manager has enhanced capabilities
 */
export function isEnhancedServerManager(manager: any): boolean {
    return manager && 
           typeof manager === 'object' && 
           typeof manager.pauseServer === 'function' &&
           typeof manager.resumeServer === 'function';
}

/**
 * Helper to get configuration with type safety
 * 
 * @param config The server configuration
 * @returns Typed server configuration
 */
export function ensureValidConfig(config: any): ServerConfig {
    if (!config || typeof config !== 'object') {
        throw new Error('Invalid server configuration');
    }
    
    // Ensure minimum required properties
    if (!config.id || typeof config.id !== 'string') {
        throw new Error('Server configuration missing required ID property');
    }
    
    return config as ServerConfig;
} 