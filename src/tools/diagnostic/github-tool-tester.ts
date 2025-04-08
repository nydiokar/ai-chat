/**
 * GitHub Tool Diagnostic Tester
 * 
 * This script provides a way to test GitHub tool functionality directly
 * and diagnose issues with the GitHub integration.
 */

import dotenv from 'dotenv';
import { createLogContext, createErrorContext } from '../../utils/log-utils.js';
import { MCPContainer, MCPConfig } from '../mcp/di/container.js';
import { getLogger } from '../../utils/shared-logger.js';
import { error, info } from '../../utils/logger.js';
import { mcpConfig } from '../../mcp_config.js';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

// Create a logger for this script
const logger = getLogger('GitHubDiagnostic');

/**
 * Run a diagnostic test on the GitHub tool
 */
export async function runGitHubDiagnostic() {
    logger.info('Starting GitHub Tool diagnostic', createLogContext(
        'GitHubDiagnostic',
        'runGitHubDiagnostic',
        { status: 'starting' }
    ));

    try {
        // Check environment variables
        if (!process.env.GITHUB_TOKEN) {
            logger.error('GITHUB_TOKEN environment variable is missing', createErrorContext(
                'GitHubDiagnostic',
                'runGitHubDiagnostic',
                'System',
                'MISSING_ENV_VAR',
                new Error('GITHUB_TOKEN is not set')
            ));
            return;
        }

        // Initialize MCP with configuration
        const mcp = new MCPContainer(mcpConfig);
        
        // Get tool manager from MCP
        const toolManager = mcp.getToolManager();
        
        // Refresh available tools
        await toolManager.refreshToolInformation();
        
        // Get all available tools
        const tools = await toolManager.getAvailableTools();
        logger.info('Available tools retrieved', createLogContext(
            'GitHubDiagnostic',
            'runGitHubDiagnostic',
            { toolCount: tools.length }
        ));
        
        // Filter GitHub tools
        const githubTools = tools.filter(t => t.server?.id === 'github');
        logger.info('GitHub tools', createLogContext(
            'GitHubDiagnostic',
            'runGitHubDiagnostic',
            { 
                githubToolCount: githubTools.length,
                toolNames: githubTools.map(t => t.name).join(', ')
            }
        ));
        
        // Find the create_issue tool
        const createIssueTool = githubTools.find(t => t.name === 'create_issue');
        if (!createIssueTool) {
            logger.error('create_issue tool not found', createErrorContext(
                'GitHubDiagnostic',
                'runGitHubDiagnostic',
                'System',
                'TOOL_NOT_FOUND',
                new Error('create_issue tool not found in available tools')
            ));
            return;
        }
        
        // Test creating an issue
        logger.info('Testing issue creation', createLogContext(
            'GitHubDiagnostic',
            'runGitHubDiagnostic',
            { toolName: 'create_issue' }
        ));

        const result = await toolManager.executeTool('create_issue', {
            owner: process.env.GITHUB_OWNER || 'nydiokar',
            repo: process.env.GITHUB_REPO || 'ai-chat',
            title: 'Test Issue from Diagnostic Tool',
            body: 'This is a test issue created by the diagnostic tool.',
            labels: ['test', 'diagnostic']
        });

        logger.info('Issue creation result', createLogContext(
            'GitHubDiagnostic',
            'runGitHubDiagnostic',
            { 
                success: result.success,
                data: result.data ? JSON.stringify(result.data) : undefined,
                error: result.error
            }
        ));

        // Test complete
        logger.info('GitHub Tool diagnostic complete', createLogContext(
            'GitHubDiagnostic',
            'runGitHubDiagnostic',
            { timestamp: new Date().toISOString() }
        ));
    } catch (err) {
        logger.error('Error in GitHub diagnostic', createErrorContext(
            'GitHubDiagnostic',
            'runGitHubDiagnostic',
            'System',
            'DIAGNOSTIC_ERROR',
            err
        ));
    }
}

// Run the diagnostic if this script is executed directly
// ESM equivalent of 'if (require.main === module)'
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
    runGitHubDiagnostic()
        .catch(err => {
            error('Unhandled exception in GitHub diagnostic', createErrorContext(
                'GitHubDiagnostic',
                'main',
                'System',
                'UNHANDLED_EXCEPTION',
                err
            ));
            process.exit(1);
        });
}