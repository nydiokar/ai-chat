export enum ServerState {
    STOPPED = 'STOPPED',
    STARTING = 'STARTING',
    RUNNING = 'RUNNING',
    STOPPING = 'STOPPING',
    PAUSED = 'PAUSED',
    ERROR = 'ERROR'
}

export interface ServerConfig {
    id: string;
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    maxRetries?: number;
    retryDelay?: number;
}

export interface Server {
    id: string;
    name: string;
    version: string;
    state: ServerState;
    config: ServerConfig;
    lastError?: Error;
    startTime?: Date;
    stopTime?: Date;
    metadata?: Record<string, any>;
}

export interface ServerEvent {
    id: string;
    timestamp: Date;
    type: 'start' | 'stop' | 'error' | 'pause' | 'resume';
    error?: Error;
    metadata?: Record<string, any>;
}

// Constants from current-functionalities.md
export const HEALTH_CHECK_INTERVAL = 60000; // 1 minute
export const MAX_BACKOFF = 5 * 60 * 1000; // 5 minutes
export const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes 