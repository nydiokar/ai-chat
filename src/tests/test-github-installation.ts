/**
 * Test script for GitHub-based MCP server installation
 * 
 * This script tests the process of installing an MCP server directly from a GitHub repository
 * and verifies that it can be started without requiring npm install or application restart.
 * 
 * Usage: ts-node -r tsconfig-paths/register src/features/pulse-mcp/tests/test-github-installation.ts
 */

import { PulseMCPServer } from '../services/pulse-api-service.js';
import { GitRepoLoader } from '../services/git-repo-loader.js';
import { installFromGitHub } from '../commands/pulse-dynamic-loader.js';
import mcpConfig from '../../../mcp_config.js';
import { MCPContainer } from '../../../tools/mcp/di/container.js';
import { ServerState } from '../../../tools/mcp/types/server.js';
import path from 'path';
import fs from 'fs/promises';

// Test repository URL - using mcp-DEEPwebresearch as our example
const TEST_REPO_URL = 'https://github.com/qpd-v/mcp-DEEPwebresearch';

// Get the project root directory for consistent path handling
const projectRoot = process.cwd();
const REPOS_DIR = path.join(projectRoot, 'mcp-repos');

// Create a mock PulseMCPServer object based on the actual repository
const testServer: PulseMCPServer = {
  name: 'MCP Deep Web Research',
  url: TEST_REPO_URL,
  short_description: 'Enhanced MCP server for deep web research with intelligent search queuing and content extraction',
  source_code_url: TEST_REPO_URL,
  github_stars: 38 // Actual star count from the repository
};

/**
 * Validate repository structure
 */
async function validateRepository(repoPath: string): Promise<boolean> {
  try {
    // Check for package.json
    const packageJsonPath = path.join(repoPath, 'package.json');
    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      
      // Verify it's a Node.js project
      if (!packageJson.name || !packageJson.version) {
        console.error('Invalid package.json: missing name or version');
        return false;
      }
      
      // Check for MCP-related dependencies
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      if (!deps['@modelcontextprotocol/sdk']) {
        console.error('Missing MCP SDK dependency');
        return false;
      }
      
      // Additional validation specific to mcp-DEEPwebresearch
      const requiredDeps = ['playwright', 'typescript'];
      const missingDeps = requiredDeps.filter(dep => !deps[dep]);
      if (missingDeps.length > 0) {
        console.error(`Missing required dependencies: ${missingDeps.join(', ')}`);
        return false;
      }
      
      console.log('package.json validation passed');
    } catch {
      console.error('package.json not found or invalid');
      return false;
    }
    
    // Check for TypeScript/JavaScript source files
    const srcDir = path.join(repoPath, 'src');
    try {
      const files = await fs.readdir(srcDir);
      if (!files.some(f => f.endsWith('.ts') || f.endsWith('.js'))) {
        console.error('No TypeScript/JavaScript files found in src directory');
        return false;
      }
      
      // Check for specific files we know should exist in mcp-DEEPwebresearch
      const requiredFiles = ['index.ts'];
      const missingFiles = requiredFiles.filter(file => !files.includes(file));
      if (missingFiles.length > 0) {
        console.error(`Missing required files in src: ${missingFiles.join(', ')}`);
        return false;
      }
      
      console.log('Source files validation passed');
    } catch {
      console.error('src directory not found or empty');
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Error validating repository:', error);
    return false;
  }
}

/**
 * Test cloning and preparing a GitHub repository
 */
async function testGitHubPreparation(): Promise<boolean> {
  console.log('Testing GitHub repository preparation...');
  
  try {
    // Ensure repos directory exists
    await fs.mkdir(REPOS_DIR, { recursive: true });
    
    // Prepare the server from GitHub
    const serverConfig = await GitRepoLoader.prepareFromGitHub(testServer);
    
    if (!serverConfig) {
      console.error('Failed to prepare server from GitHub');
      return false;
    }
    
    console.log('Server configuration prepared successfully:');
    console.log(JSON.stringify(serverConfig, null, 2));
    
    // Get repository path
    const repoName = testServer.source_code_url.split('/').pop()?.replace('.git', '') || '';
    const repoPath = path.join(REPOS_DIR, repoName);
    
    // Validate repository structure
    if (!await validateRepository(repoPath)) {
      return false;
    }
    
    // Check for minimal configuration
    const minimalFields = ['id', 'name', 'command', 'args', 'env'];
    for (const field of minimalFields) {
      if (!(field in serverConfig)) {
        console.error(`Missing required field: ${field}`);
        return false;
      }
    }
    
    // Verify command is using nodePath
    if (serverConfig.command !== process.execPath) {
      console.error('Server command does not match expected nodePath');
      return false;
    }
    
    // Check entry point file exists and is within mcp-repos
    const entryPoint = serverConfig.args[0];
    if (!entryPoint.startsWith(REPOS_DIR)) {
      console.error(`Entry point ${entryPoint} is not within mcp-repos directory`);
      return false;
    }
    
    try {
      await fs.access(entryPoint);
      console.log(`Entry point file exists: ${entryPoint}`);
    } catch {
      console.error(`Entry point file not found: ${entryPoint}`);
      return false;
    }
    
    console.log('GitHub preparation test PASSED');
    return true;
    
  } catch (error) {
    console.error('Error during GitHub preparation test:', error);
    return false;
  }
}

/**
 * Updates mcp_config.ts with the new server configuration
 */
async function updateMCPConfig(serverConfig: any): Promise<boolean> {
  try {
    console.log('Updating MCP configuration...');
    
    const configPath = path.join(projectRoot, 'src', 'mcp_config.ts');
    const configContent = await fs.readFile(configPath, 'utf8');
    
    // Create the server configuration entry
    const serverEntry = `
// Deep Web Research Server
enabledServers["deep-web-research"] = {
  id: "deep-web-research",
  name: "Deep Web Research",
  command: nodePath,
  args: [
    ${JSON.stringify(serverConfig.args[0])}
  ],
  env: {
    PWD: projectRoot,
    MAX_PARALLEL_SEARCHES: "5",
    SEARCH_DELAY_MS: "200",
    MAX_RETRIES: "3",
    TIMEOUT_MS: "55000",
    LOG_LEVEL: "info"
  }
};
`;
    
    // Find the position to insert the new server
    const insertPosition = configContent.indexOf('// DYNAMICALLY ADDED SERVERS');
    if (insertPosition === -1) {
      console.error('Could not find insertion point in mcp_config.ts');
      return false;
    }
    
    // Insert the new server configuration after the comment
    const endDynamicPosition = configContent.indexOf('// END DYNAMIC SERVERS');
    if (endDynamicPosition === -1) {
      console.error('Could not find end of dynamic servers section');
      return false;
    }
    
    const newConfig = 
      configContent.slice(0, insertPosition + '// DYNAMICALLY ADDED SERVERS'.length) +
      '\n' + serverEntry + '\n' +
      configContent.slice(endDynamicPosition);
    
    await fs.writeFile(configPath, newConfig, 'utf8');
    console.log('✅ MCP configuration updated successfully');
    return true;
    
  } catch (error) {
    console.error('Error updating MCP configuration:', error);
    return false;
  }
}

/**
 * Test starting a server without restart
 */
async function testStartingServer(): Promise<boolean> {
  console.log('Testing dynamic server start...');
  
  try {
    // Install the server using installFromGitHub
    const result = await installFromGitHub([testServer]);
    if (result.installedServers.length === 0) {
      return false;
    }
    
    const serverId = result.installedServers[0];
    const serverConfig = result.config.mcpServers[serverId];
    
    // Create a new MCP container with merged configuration
    const container = new MCPContainer({
      ...mcpConfig,
      mcpServers: {
        ...mcpConfig.mcpServers,
        [serverId]: serverConfig
      }
    });
    
    // Get the server manager
    const serverManager = container.getServerManager();
    
    // Start the server
    console.log(`Starting server ${serverId}...`);
    await serverManager.startServer(serverId);
    
    // Check server state
    const server = serverManager.getServer(serverId);
    if (!server) {
      console.error(`Server ${serverId} not found after starting`);
      return false;
    }
    
    console.log(`Server state: ${server.state}`);
    
    // Verify server is running
    if (server.state === ServerState.RUNNING) {
      console.log('Server started successfully');
      
      // Update MCP configuration with the new server
      if (!await updateMCPConfig(serverConfig)) {
        console.error('Failed to update MCP configuration');
        return false;
      }
      
      // Stop the server
      console.log(`Stopping server ${serverId}...`);
      await serverManager.stopServer(serverId);
      
      console.log('Dynamic server start test PASSED');
      return true;
    } else {
      console.error(`Server did not start successfully. State: ${server.state}`);
      return false;
    }
  } catch (error) {
    console.error('Error during server start test:', error);
    return false;
  } finally {
    // Clean up any running servers
    try {
      const container = new MCPContainer(mcpConfig);
      const serverManager = container.getServerManager();
      const serverIds = serverManager.getServerIds();
      await Promise.all(serverIds.map(id => serverManager.stopServer(id)));
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}

/**
 * Run all tests
 */
async function runTests(): Promise<void> {
  console.log('=== TESTING GITHUB-BASED MCP SERVER INSTALLATION ===');
  
  const tests = [
    { name: 'GitHub Preparation', test: testGitHubPreparation },
    { name: 'Dynamic Server Start', test: testStartingServer }
  ];
  
  let allPassed = true;
  
  for (const { name, test } of tests) {
    console.log(`\n--- Running test: ${name} ---`);
    const passed = await test();
    if (!passed) {
      console.error(`❌ Test FAILED: ${name}`);
      allPassed = false;
      break; // Stop testing if a test fails
    } else {
      console.log(`✅ Test PASSED: ${name}`);
    }
  }
  
  console.log('\n=== TEST RESULTS ===');
  if (allPassed) {
    console.log('✅ ALL TESTS PASSED');
  } else {
    console.error('❌ SOME TESTS FAILED');
    process.exit(1); // Exit with error code if tests fail
  }
}

// Run the tests
runTests().catch(error => {
  console.error('Unhandled error during tests:', error);
  process.exit(1);
}); 