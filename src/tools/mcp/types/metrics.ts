/**
 * Client performance metrics
 */
export interface ClientMetrics {
    /** Total number of requests */
    requests: number;
    /** Total number of errors */
    errors: number;
    /** Total number of tool calls */
    toolCalls: number;
    /** Average response time in milliseconds */
    avgResponseTime: number;
    /** Last 100 response times for calculating averages */
    responseTimeData: number[];
    /** When metrics collection started */
    startTime: Date;
    /** Last time metrics were updated */
    lastUpdateTime: Date;
    /** Request success rate (0-1) */
    successRate: number;
    /** Server ID this client is connected to */
    serverId: string;
}

/**
 * Server performance metrics
 */
export interface ServerMetrics {
    /** Server identifier */
    serverId: string;
    /** How many times this server has been restarted */
    restartCount: number;
    /** Total uptime in milliseconds */
    uptime: number;
    /** Time when the server was last started */
    lastStartTime: Date;
    /** Server health status */
    isHealthy: boolean;
    /** Connection state */
    connectionState: 'connected' | 'disconnected' | 'connecting' | 'error';
    /** Total number of tools available */
    toolCount: number;
    /** Client metrics if available */
    clientMetrics?: ClientMetrics;
    /** Number of errors recorded for this server */
    errorCount?: number;
    /** Overall success rate for operations (0-1) */
    successRate?: number;
} 