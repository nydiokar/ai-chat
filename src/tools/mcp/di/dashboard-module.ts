import { IServerManager } from '../interfaces/core.js';
import { MCPContainer } from './container.js';
import { DashboardServer } from '../../dashboard/dashboard-server.js';

/**
 * Helper function to register dashboard components in the container
 * @param container The MCPContainer instance
 */
export function registerDashboard(container: MCPContainer): void {
    try {
        console.log('Registering dashboard in container');
        // Dashboard functionality will be directly instantiated
    } catch (error) {
        console.error('Failed to register dashboard:', error);
    }
}

/**
 * Helper function to start the dashboard server
 * @param serverManager The server manager instance
 * @param port The port to run the dashboard on
 */
export async function startDashboard(serverManager: IServerManager, port?: number): Promise<void> {
    try {
        // Default port, can be overridden with environment variables
        const dashboardPort = port || (process.env.MCP_DASHBOARD_PORT ? 
            parseInt(process.env.MCP_DASHBOARD_PORT, 10) : 8080);
            
        // Create and start dashboard directly
        const dashboardServer = new DashboardServer(serverManager, dashboardPort);
        dashboardServer.start();
        
        console.log(`MCP Dashboard server started on port ${dashboardPort}`);
    } catch (error) {
        console.error('Failed to start dashboard server:', error);
        throw error;
    }
} 