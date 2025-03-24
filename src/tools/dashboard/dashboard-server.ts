import * as http from 'http';
import { IServerManager } from '../mcp/interfaces/core.js';
import { MetricsDashboard } from './metrics-dashboard.js';

/**
 * Simple web server that exposes the metrics dashboard
 */
export class DashboardServer {
    private server: http.Server | null = null;
    private dashboard: MetricsDashboard;
    private port: number;
    
    constructor(serverManager: IServerManager, port: number = 8080) {
        this.dashboard = new MetricsDashboard(serverManager);
        this.port = port;
    }
    
    /**
     * Start the dashboard web server
     */
    public start(): void {
        if (this.server) {
            return; // Already running
        }
        
        this.server = http.createServer((req, res) => {
            // Basic routing
            if (req.url === '/' || req.url === '/index.html') {
                this.serveDashboard(res);
            } else if (req.url === '/api/metrics') {
                this.serveMetricsJson(res);
            } else if (req.url === '/api/errors') {
                this.serveErrorsJson(res);
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
            }
        });
        
        this.server.listen(this.port, () => {
            console.log(`Dashboard server running at http://localhost:${this.port}/`);
        });
        
        // Handle server errors
        this.server.on('error', (error) => {
            if ((error as any).code === 'EADDRINUSE') {
                console.error(`Port ${this.port} is already in use. Dashboard server could not start.`);
            } else {
                console.error('Dashboard server error:', error);
            }
        });
    }
    
    /**
     * Stop the dashboard web server
     */
    public stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.server) {
                resolve();
                return;
            }
            
            this.dashboard.stop();
            
            this.server.close((error) => {
                if (error) {
                    reject(error);
                } else {
                    this.server = null;
                    console.log('Dashboard server stopped');
                    resolve();
                }
            });
        });
    }
    
    /**
     * Serve the HTML dashboard
     */
    private serveDashboard(res: http.ServerResponse): void {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(this.dashboard.generateHtmlReport());
    }
    
    /**
     * Serve metrics as JSON
     */
    private serveMetricsJson(res: http.ServerResponse): void {
        const metricsMap = this.dashboard.getAllMetrics();
        const metricsObject: Record<string, any> = {};
        
        // Convert Map to a regular object for JSON serialization
        for (const [serverId, serverMetrics] of metricsMap.entries()) {
            metricsObject[serverId] = serverMetrics;
        }
        
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        res.end(JSON.stringify(metricsObject, this.replacer));
    }
    
    /**
     * Serve errors as JSON
     */
    private serveErrorsJson(res: http.ServerResponse): void {
        const serverManager = this.dashboard.getServerManager();
        const errors: Record<string, any> = {};
        
        for (const serverId of serverManager.getServerIds()) {
            // Use optional chaining in case getServerErrors doesn't exist
            errors[serverId] = (serverManager as any).getServerErrors?.(serverId) || [];
        }
        
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        res.end(JSON.stringify(errors, this.replacer));
    }
    
    /**
     * Custom JSON replacer to handle Sets and Maps
     */
    private replacer(key: string, value: any): any {
        if (value instanceof Set) {
            return Array.from(value);
        }
        if (value instanceof Map) {
            const obj: Record<string, any> = {};
            for (const [k, v] of value.entries()) {
                obj[k] = v;
            }
            return obj;
        }
        return value;
    }
} 