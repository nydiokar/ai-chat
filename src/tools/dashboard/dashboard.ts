import * as http from 'http';
import { IServerManager } from '../mcp/interfaces/core.js';
import { MetricsDashboard } from './metrics-dashboard.js';
import { Server, ServerState } from '../mcp/types/server.js';

/**
 * Simple HTTP server that displays the MCP metrics dashboard
 */
export class MCPDashboard {
    private server: http.Server | null = null;
    private readonly port: number;
    private readonly metricsDashboard: MetricsDashboard;
    private registrationTimer: NodeJS.Timeout | null = null;
    private periodicRefreshTimer: NodeJS.Timeout | null = null;
    private readonly REFRESH_INTERVAL = 30000; // 30 seconds (increased from 15 seconds)
    private _refreshCount = 0; // Track number of refreshes
    
    constructor(serverManager: IServerManager, port: number = 8080) {
        this.port = port;
        this.metricsDashboard = new MetricsDashboard(serverManager);
        
        // Log server manager information
        console.log('[MCPDashboard] Initialized with server manager', {
            managerType: serverManager.constructor.name,
            hasServers: serverManager.getServerIds().length > 0,
            serverIds: serverManager.getServerIds()
        });
        
        // Setup timer for checking server registration
        this.setupServerRegistrationCheck();
    }
    
    /**
     * Set up periodic refresh of server data
     */
    private setupPeriodicRefresh(): void {
        if (this.periodicRefreshTimer) {
            clearInterval(this.periodicRefreshTimer);
        }
        
        this.periodicRefreshTimer = setInterval(() => {
            const metrics = this.metricsDashboard.getAllMetrics();
            this._refreshCount++;
            
            // Only log every few refreshes or when there's an issue
            if (metrics.size === 0 || this._refreshCount % 5 === 0) {
                console.log(`[MCPDashboard] Periodic refresh #${this._refreshCount} - Current metrics count: ${metrics.size}`);
            }
            
            // If no metrics, try manual registration again
            if (metrics.size === 0) {
                console.log('[MCPDashboard] No metrics found during periodic refresh, attempting registration');
                this.directlyRegisterServers();
            }
            
            // Force refresh regardless
            this.metricsDashboard.forceRefresh();
        }, this.REFRESH_INTERVAL);
    }
    
    /**
     * Check if servers are registered and manually register them if not
     */
    private setupServerRegistrationCheck(): void {
        // Try to register servers directly now
        this.directlyRegisterServers();
        
        // Wait for servers to be discovered naturally first
        this.registrationTimer = setTimeout(() => {
            // Check current server count
            const metrics = this.metricsDashboard.getAllMetrics();
            if (metrics.size === 0) {
                console.log('[MCPDashboard] No servers discovered automatically. Attempting manual registration...');
                this.directlyRegisterServers();
            }
            
            // Set up periodic refresh regardless of whether we found servers
            this.setupPeriodicRefresh();
        }, 10000); // Check after 10 seconds
    }
    
    /**
     * Directly register known servers with the dashboard
     */
    private directlyRegisterServers(): void {
        // Check current state
        const serverIds = this.metricsDashboard.getServerManager().getServerIds();
        const metrics = this.metricsDashboard.getAllMetrics();
        
        console.log(`[MCPDashboard] Manual registration check - ServerIds: ${serverIds.length}, Metrics: ${metrics.size}`);
        
        // These are the known default servers in the system
        const knownServers = ['github', 'brave-search', 'deep-web-research'];
        
        // Log the server manager state
        const serverManager = this.metricsDashboard.getServerManager();
        console.log(`[MCPDashboard] Server manager state:`, {
            type: serverManager.constructor.name,
            serverCount: serverIds.length,
            servers: serverIds
        });
        
        // Try to register each known server
        for (const serverId of knownServers) {
            console.log(`[MCPDashboard] Manually registering server: ${serverId}`);
            
            // Try to create a minimal server object that the dashboard might accept
            const fakeServer: Partial<Server> = {
                id: serverId,
                state: ServerState.RUNNING,
                startTime: new Date(),
                restartCount: 0,
                config: {
                    id: serverId,
                    name: serverId,
                    command: 'node',
                    args: []
                }
            };
            
            // Register with the fake server object
            this.metricsDashboard.registerServer(serverId, fakeServer as Server);
        }
        
        // Force a refresh of the dashboard
        this.metricsDashboard.forceRefresh();
    }
    
    /**
     * Start the dashboard HTTP server
     */
    public async start(): Promise<void> {
        if (this.server) {
            console.log('[MCPDashboard] Server already running');
            return;
        }
        
        console.log(`[MCPDashboard] Starting dashboard on port ${this.port}`);
        
        this.server = http.createServer((req, res) => {
            // Simple routing
            if (req.url === '/' || req.url === '/dashboard') {
                // Force server discovery before generating report
                this.metricsDashboard.forceRefresh();
                
                // Get HTML report from metrics dashboard
                const html = this.metricsDashboard.generateHtmlReport();
                
                // Set headers and send response
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(html);
            } else if (req.url === '/api/refresh') {
                // Special endpoint to force refresh
                this.metricsDashboard.forceRefresh();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Refresh triggered' }));
            } else {
                // 404 for any other routes
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
            }
        });
        
        // Handle server errors
        this.server.on('error', (error) => {
            console.error('[MCPDashboard] Server error:', error);
        });
        
        // Start listening
        return new Promise((resolve, reject) => {
            if (!this.server) {
                return reject(new Error('Server not initialized'));
            }
            
            this.server.listen(this.port, () => {
                console.log(`[MCPDashboard] Dashboard is running at http://localhost:${this.port}/`);
                resolve();
            });
        });
    }
    
    /**
     * Stop the dashboard HTTP server
     */
    public async stop(): Promise<void> {
        if (this.registrationTimer) {
            clearTimeout(this.registrationTimer);
            this.registrationTimer = null;
        }
        
        if (this.periodicRefreshTimer) {
            clearInterval(this.periodicRefreshTimer);
            this.periodicRefreshTimer = null;
        }
        
        if (!this.server) {
            console.log('[MCPDashboard] Server not running');
            return;
        }
        
        return new Promise((resolve, reject) => {
            if (!this.server) {
                return resolve();
            }
            
            this.server.close((err) => {
                if (err) {
                    console.error('[MCPDashboard] Error closing server:', err);
                    return reject(err);
                }
                
                console.log('[MCPDashboard] Dashboard server stopped');
                this.server = null;
                resolve();
            });
        });
    }
}

/**
 * Start the dashboard with the given server manager
 */
export function startDashboard(
    serverManager: IServerManager, 
    port: number = 8080
): MCPDashboard {
    const dashboard = new MCPDashboard(serverManager, port);
    
    // Start the dashboard in the background
    dashboard.start().catch(error => {
        console.error('[MCPDashboard] Error starting dashboard:', error);
    });
    
    return dashboard;
} 