#!/usr/bin/env node

/**
 * Command-line tool to display basic MCP status
 */

import { Container } from 'inversify';
import { BaseServerManager } from '../mcp/base/base-server-manager.js';
import { MCPContainer } from '../mcp/di/container.js';
import { ServerState } from '../mcp/types/server.js';
import mcpConfig from '../../mcp_config.js';

/**
 * Format text with console colors
 */
function colorText(text: string, color: string): string {
    const colors: Record<string, string> = {
        reset: '\x1b[0m',
        red: '\x1b[31m',
        green: '\x1b[32m',
        yellow: '\x1b[33m',
        blue: '\x1b[34m',
        gray: '\x1b[90m'
    };
    
    return `${colors[color] || ''}${text}${colors.reset}`;
}

/**
 * Format server state with appropriate color
 */
function formatState(state: ServerState): string {
    switch (state) {
        case ServerState.RUNNING:
            return colorText('RUNNING', 'green');
        case ServerState.STARTING:
        case ServerState.RESTARTING:
            return colorText('STARTING', 'yellow');
        case ServerState.ERROR:
            return colorText('ERROR', 'red');
        case ServerState.STOPPING:
            return colorText('STOPPING', 'yellow');
        case ServerState.STOPPED:
            return colorText('STOPPED', 'gray');
        default:
            return colorText(state, 'blue');
    }
}

/**
 * Format duration in ms to human-readable format
 */
function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

/**
 * Print a status report of all MCP servers
 */
async function printStatusReport(manager: BaseServerManager): Promise<void> {
    const serverIds = manager.getServerIds();
    
    if (serverIds.length === 0) {
        console.log(colorText('No MCP servers are configured.', 'yellow'));
        return;
    }
    
    console.log('\n' + colorText('=== MCP SERVER STATUS ===', 'blue'));
    console.log(colorText(`Time: ${new Date().toLocaleString()}\n`, 'gray'));
    
    // Header
    console.log(
        colorText('SERVER ID', 'blue').padEnd(20) +
        colorText('STATUS', 'blue').padEnd(15) +
        colorText('UPTIME', 'blue').padEnd(15) +
        colorText('RESTARTS', 'blue').padEnd(10) +
        colorText('ERRORS', 'blue')
    );
    console.log('-'.repeat(70));
    
    // Server status
    for (const id of serverIds) {
        const server = manager.getServer(id);
        if (!server) continue;
        
        let uptime = '';
        if (server.startTime) {
            const now = new Date();
            uptime = formatDuration(now.getTime() - server.startTime.getTime());
        }
        
        // Get error count if available
        const errors = (manager as any).getServerErrors?.(id)?.length || 0;
        
        console.log(
            id.padEnd(20) +
            formatState(server.state).padEnd(15) +
            uptime.padEnd(15) +
            String(server.restartCount || 0).padEnd(10) +
            (errors > 0 ? colorText(String(errors), 'red') : '0')
        );
        
        // Show error message if in error state
        if (server.state === ServerState.ERROR && server.lastError) {
            console.log(
                '  ' + colorText(`Error: ${server.lastError.message}`, 'red')
            );
        }
    }
    
    console.log('\n' + colorText('To view detailed metrics, start the dashboard with:', 'gray'));
    console.log(colorText('  MCP_DASHBOARD_ENABLED=true npm start', 'gray'));
    console.log(colorText('  Then open http://localhost:8080 in your browser\n', 'gray'));
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
    try {
        const container = new MCPContainer(mcpConfig);
        const serverManager = container.getServerManager() as BaseServerManager;
        
        // Wait briefly to get initial status
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Print the status report
        await printStatusReport(serverManager);
        
        // Exit after printing the report
        process.exit(0);
    } catch (error) {
        console.error('Error checking MCP status:', error);
        process.exit(1);
    }
}

// Run the CLI
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
}); 