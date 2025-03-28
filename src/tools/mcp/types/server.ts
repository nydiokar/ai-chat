export enum ServerState {
    STARTING = 'STARTING',
    RUNNING = 'RUNNING',
    STOPPING = 'STOPPING',
    STOPPED = 'STOPPED',
    ERROR = 'ERROR',
    PAUSED = 'PAUSED',
    RETRYING = 'RETRYING',
    RESTARTING = 'RESTARTING'
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
    startTime?: Date;
    stopTime?: Date;
    lastError?: Error;
    restartCount?: number;
    client?: any; // Reference to the connected client
    error?: Error; // The last error that occurred
}

export interface ServerEvent {
    type: 'start' | 'stop' | 'pause' | 'resume' | 'error' | 'restart' | 'response';
    timestamp: Date;
    error?: Error;
    duration?: number;
    data?: {
        state?: ServerState;
        [key: string]: any;
    };
}

// Constants from current-functionalities.md
export const HEALTH_CHECK_INTERVAL = 60000; // 1 minute
export const MAX_BACKOFF = 5 * 60 * 1000; // 5 minutes
export const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes 