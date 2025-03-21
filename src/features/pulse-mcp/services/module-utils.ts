/**
 * Module utilities for dynamic loading support in ESM environment
 * 
 * This file contains utilities to help with dynamic module loading,
 * especially for handling module caching when dynamically loading
 * MCP servers from GitHub repositories.
 */

import { createRequire } from 'module';

/**
 * Clear module cache for a specific module path
 * 
 * In an ESM environment, module cache clearing is more complex than in CommonJS.
 * This function uses a combination of techniques to handle it.
 * 
 * @param modulePath Path to the module that needs cache clearing
 */
export function clearRequireCache(modulePath: string): void {
    console.log(`Attempting to clear cache for module: ${modulePath}`);
    
    try {
        // For ESM, we can try to create a temporary require function
        // This allows us to access the CommonJS cache even in an ESM environment
        const require = createRequire(import.meta.url);
        
        // Try to resolve the module path
        try {
            const resolvedPath = require.resolve(modulePath);
            console.log(`Resolved module path: ${resolvedPath}`);
            
            // Check if there's a module cache entry
            if (require.cache && resolvedPath in require.cache) {
                // Get any dependent modules first
                const dependentModules = findDependentModules(resolvedPath, require);
                
                // Clear the cache for dependent modules
                for (const depModule of dependentModules) {
                    delete require.cache[depModule];
                    console.log(`Cleared cache for dependent module: ${depModule}`);
                }
                
                // Then clear the main module
                delete require.cache[resolvedPath];
                console.log(`Successfully cleared cache for ${resolvedPath}`);
            } else {
                console.log(`No cache entry found for ${resolvedPath}`);
            }
        } catch (resolveError) {
            console.log(`Could not resolve module: ${modulePath}`, resolveError);
        }
        
        // For ESM modules, we'll also try the timestamp-based approach
        clearESMCache(modulePath);
        
    } catch (error) {
        console.warn(`Error during cache clearing: ${error instanceof Error ? error.message : String(error)}`);
        // As a fallback, try only the ESM approach
        clearESMCache(modulePath);
    }
}

/**
 * Find all modules that depend on a specific module
 * 
 * @param moduleId ID of the module to check dependencies for
 * @param req A require function to use
 * @returns Array of module IDs that depend on the specified module
 */
function findDependentModules(moduleId: string, req: NodeRequire): string[] {
    const dependentModules: string[] = [];
    
    if (!req.cache) {
        return dependentModules;
    }
    
    // Check all modules in the cache
    for (const cachedModuleId in req.cache) {
        const cachedModule = req.cache[cachedModuleId];
        
        // Skip if this module doesn't have children
        if (!cachedModule?.children) continue;
        
        // Check if any of this module's children is our target module
        if (cachedModule.children.some(child => child.id === moduleId)) {
            dependentModules.push(cachedModuleId);
            
            // Recursively find modules that depend on this one
            dependentModules.push(...findDependentModules(cachedModuleId, req));
        }
    }
    
    return dependentModules;
}

/**
 * Approach for clearing ESM module cache
 * 
 * ESM caching is more complex as it's managed internally by the Node.js runtime.
 * We use timestamp query parameters to force new imports of modules.
 * 
 * @param modulePath Path to the module
 */
async function clearESMCache(modulePath: string): Promise<void> {
    try {
        console.log(`Attempting ESM cache clearing for ${modulePath}`);
        
        // Make sure we have a URL-compatible path
        let importPath = modulePath;
        if (importPath.startsWith('/') || /^[a-zA-Z]:\\/.test(importPath)) {
            // Convert absolute path to URL format
            importPath = `file://${importPath.replace(/\\/g, '/')}`;
        }
        
        // Add timestamp to force bypass of import cache
        const timestamp = Date.now();
        const importUrl = /\?/.test(importPath) 
            ? `${importPath}&t=${timestamp}` 
            : `${importPath}?t=${timestamp}`;
            
        console.log(`Attempting import with: ${importUrl}`);
        
        // Attempt dynamic import with a timeout to prevent hanging
        const importPromise = import(importUrl);
        
        // Set a timeout for the import
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Import timed out')), 3000);
        });
        
        // Race the import against the timeout
        await Promise.race([importPromise, timeoutPromise])
            .catch(err => {
                // Many import errors are expected and can be ignored
                if (err.message !== 'Import timed out') {
                    console.log(`Expected import error: ${err.message}`);
                } else {
                    console.warn(`Import timed out for ${importUrl}`);
                }
            });
            
        console.log(`Completed ESM cache clearing attempt for ${modulePath}`);
    } catch (error) {
        console.warn(`ESM cache clearing error for ${modulePath}:`, error);
    }
} 