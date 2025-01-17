interface RateLimitTracker {
    requests: number;
    windowStart: number;
}

export class RateLimiter {
    private limiters: Record<string, RateLimitTracker>;
    private windowMs: number;
    private maxRequests: number;

    constructor(windowMs: number, maxRequests: number) {
        this.limiters = {};
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
    }

    checkLimit(key: string): void {
        const now = Date.now();
        
        if (!this.limiters[key]) {
            this.limiters[key] = { requests: 0, windowStart: now };
        }

        const limiter = this.limiters[key];
        
        if (now - limiter.windowStart > this.windowMs) {
            limiter.requests = 0;
            limiter.windowStart = now;
        }
        
        if (limiter.requests >= this.maxRequests) {
            throw new Error(`Rate limit exceeded for ${key}. Please try again later.`);
        }
        
        limiter.requests++;
    }
}

// Create a singleton instance for AI services
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 50;

export const aiRateLimiter = new RateLimiter(
    RATE_LIMIT_WINDOW,
    MAX_REQUESTS_PER_WINDOW
);
