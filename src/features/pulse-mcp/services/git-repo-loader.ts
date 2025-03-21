/**
 * Git Repository Loader for MCP Servers
 * 
 * This service handles cloning, updating, and loading MCP servers directly from
 * GitHub repositories. This allows for dynamic loading without requiring application restarts.
 */

import { exec, execSync } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { PulseMCPServer } from './pulse-api-service.js';
import { ServerConfig } from '../../../tools/mcp/types/server.js';
import { clearRequireCache } from './module-utils.js';
import { promisify } from 'util';

const execAsync = promisify(exec);
const nodePath = process.execPath;
const projectRoot = process.cwd();

// Base directory where all cloned repositories will be stored
const REPOS_DIR = path.join(projectRoot, 'mcp-repos');

export class GitRepoLoader {
  /**
   * Ensure the repositories directory exists
   */
  static async ensureReposDir(): Promise<void> {
    try {
      await fs.mkdir(REPOS_DIR, { recursive: true });
    } catch (error: any) {
      console.error(`Failed to create repos directory: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clone a GitHub repository
   * 
   * @param repoUrl URL of the GitHub repository
   * @returns Path to the cloned repository
   */
  static async cloneRepository(repoUrl: string): Promise<string> {
    if (!repoUrl) {
      throw new Error('Repository URL is required');
    }

    // Extract repo name from URL
    const repoName = repoUrl.split('/').pop()?.replace('.git', '') || 
                     `repo-${Date.now()}`;
    
    const repoPath = path.join(REPOS_DIR, repoName);

    try {
      // Check if repo already exists
      try {
        await fs.access(repoPath);
        console.log(`Repository ${repoName} already exists at ${repoPath}, updating instead`);
        return await GitRepoLoader.updateRepository(repoPath);
      } catch {
        // Repo doesn't exist, proceed with clone
        console.log(`Cloning repository ${repoUrl} to ${repoPath}`);
        await ensureParentDirExists(repoPath);
        
        await execAsync(`git clone ${repoUrl} "${repoPath}"`, {
          cwd: REPOS_DIR
        });
        
        return repoPath;
      }
    } catch (error: any) {
      console.error(`Failed to clone repository ${repoUrl}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update an existing repository
   * 
   * @param repoPath Path to the repository
   * @returns Path to the repository
   */
  static async updateRepository(repoPath: string): Promise<string> {
    try {
      console.log(`Updating repository at ${repoPath}`);
      
      // Pull latest changes
      await execAsync('git pull', {
        cwd: repoPath
      });
      
      return repoPath;
    } catch (error: any) {
      console.error(`Failed to update repository at ${repoPath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Install dependencies and build the repository
   * 
   * @param repoPath Path to the repository
   * @returns True if build successful
   */
  static async buildRepository(repoPath: string): Promise<boolean> {
    try {
      console.log(`Installing dependencies and building repository at ${repoPath}`);
      
      // Check if package.json exists
      const packageJsonPath = path.join(repoPath, 'package.json');
      try {
        await fs.access(packageJsonPath);
      } catch {
        console.error(`No package.json found in ${repoPath}`);
        return false;
      }
      
      // Read package.json to determine package manager and scripts
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      
      // Determine if using npm, yarn, or pnpm
      let packageManager = 'npm';
      try {
        await fs.access(path.join(repoPath, 'yarn.lock'));
        packageManager = 'yarn';
      } catch {}
      
      try {
        await fs.access(path.join(repoPath, 'pnpm-lock.yaml'));
        packageManager = 'pnpm';
      } catch {}
      
      // Install dependencies
      console.log(`Installing dependencies with ${packageManager}`);
      await execAsync(`${packageManager} install`, {
        cwd: repoPath
      });
      
      // Build the project if a build script exists
      if (packageJson.scripts && packageJson.scripts.build) {
        console.log(`Building project with ${packageManager} run build`);
        await execAsync(`${packageManager} run build`, {
          cwd: repoPath
        });
      }
      
      return true;
    } catch (error: any) {
      console.error(`Failed to build repository at ${repoPath}: ${error.message}`);
      return false;
    }
  }

  /**
   * Determine the entry point for a repository
   * 
   * @param repoPath Path to the repository
   * @returns Path to the entry point JS file
   */
  static async findEntryPoint(repoPath: string): Promise<string> {
    try {
      // Read package.json to find entry point
      const packageJsonPath = path.join(repoPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      
      // Check for typical entry points in priority order
      const possiblePaths = [
        // Built dist files (most common for TypeScript projects)
        path.join(repoPath, 'dist', 'index.js'),
        
        // Package.json specified entries
        packageJson.main && path.join(repoPath, packageJson.main),
        packageJson.exports && 
          (typeof packageJson.exports === 'string' 
            ? path.join(repoPath, packageJson.exports)
            : packageJson.exports['.'] && path.join(repoPath, 
                typeof packageJson.exports['.'] === 'string' 
                  ? packageJson.exports['.'] 
                  : packageJson.exports['.'].default || packageJson.exports['.'].import)),
        
        // Common defaults
        path.join(repoPath, 'index.js'),
        path.join(repoPath, 'src', 'index.js')
      ];
      
      // Find the first path that exists
      for (const possiblePath of possiblePaths) {
        if (!possiblePath) continue;
        
        try {
          await fs.access(possiblePath);
          console.log(`Found entry point: ${possiblePath}`);
          return possiblePath;
        } catch {}
      }
      
      throw new Error(`Could not find entry point for repository at ${repoPath}`);
    } catch (error: any) {
      console.error(`Failed to find entry point: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create a minimal server config from a PulseMCPServer using the local repository
   * 
   * @param pulseServer The server from Pulse API
   * @param repoPath Path to the cloned repository
   * @param entryPoint Path to the entry point JS file
   * @returns ServerConfig compatible with our MCP container
   */
  static createServerConfig(
    pulseServer: PulseMCPServer, 
    repoPath: string,
    entryPoint: string
  ): ServerConfig {
    // Create a safe server ID from the name
    const serverId = pulseServer.name.toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    
    // Create minimal server configuration
    return {
      id: serverId,
      name: pulseServer.name,
      command: nodePath,
      args: [entryPoint],
      env: {
        SOURCE_URL: pulseServer.source_code_url
      }
    };
  }
  
  /**
   * Prepare an MCP server from a GitHub repository
   * 
   * @param pulseServer Server information from Pulse API
   * @returns Server configuration ready to be added to MCP config
   */
  static async prepareFromGitHub(pulseServer: PulseMCPServer): Promise<ServerConfig | null> {
    if (!pulseServer.source_code_url) {
      console.error(`No source code URL available for ${pulseServer.name}`);
      return null;
    }
    
    try {
      // Ensure the repos directory exists
      await GitRepoLoader.ensureReposDir();
      
      // Clone the repository
      const repoPath = await GitRepoLoader.cloneRepository(pulseServer.source_code_url);
      
      // Build the repository
      const buildSuccess = await GitRepoLoader.buildRepository(repoPath);
      if (!buildSuccess) {
        console.error(`Failed to build repository for ${pulseServer.name}`);
        return null;
      }
      
      // Find the entry point
      const entryPoint = await GitRepoLoader.findEntryPoint(repoPath);
      
      // Create the server config with minimal configuration
      return GitRepoLoader.createServerConfig(pulseServer, repoPath, entryPoint);
    } catch (error: any) {
      console.error(`Failed to prepare server from GitHub: ${error.message}`);
      return null;
    }
  }
}

/**
 * Helper function to ensure a directory's parent exists
 */
async function ensureParentDirExists(dirPath: string): Promise<void> {
  const parentDir = path.dirname(dirPath);
  await fs.mkdir(parentDir, { recursive: true });
} 