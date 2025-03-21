/**
 * Utility functions for handling security-sensitive information
 */

/**
 * Redacts sensitive information from objects and strings
 * Used for logging and debugging to prevent exposure of sensitive data
 */
export function redactSensitiveInfo(obj: any): any {
    if (!obj) return obj;
    
    const sensitiveKeys = [
        'key', 'password', 'secret', 'auth', 'credential',
        'GITHUB_PERSONAL_ACCESS_TOKEN', 'OPENAI_API_KEY',
        'ollama_api_key', 'ollama_api_url', 'API_KEY', 'API_URL', 'API_TOKEN'
    ];
    
    if (typeof obj === 'string') {
        // Check if the string looks like a token/key (long string with special chars)
        if (obj.length > 20 && /[A-Za-z0-9_\-\.]+/.test(obj)) {
            return '[REDACTED]';
        }
        return obj;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => redactSensitiveInfo(item));
    }
    
    if (typeof obj === 'object') {
        const redacted = { ...obj };
        for (const [key, value] of Object.entries(redacted)) {
            if (sensitiveKeys.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
                redacted[key] = '[REDACTED]';
            } else if (typeof value === 'object') {
                redacted[key] = redactSensitiveInfo(value);
            }
        }
        return redacted;
    }
    
    return obj;
} 