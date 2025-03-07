const express = require('express');
const cors = require('cors');
const { fileURLToPath } = require('url');
const path = require('path');
const dotenv = require('dotenv');
const { spawn } = require('child_process');
import type { Request, Response } from 'express';
import type { ChildProcess } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from parent project
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// Store MCP server processes
const mcpServers: Record<string, {
  process: ChildProcess;
  ready: boolean;
  tools: any[];
}> = {};

interface MCPResponse {
  id?: number;
  method?: string;
  result?: {
    tools?: any[];
    content?: Array<{ text: string }>;
  };
  error?: {
    message: string;
  };
}

interface DebugInfo {
  message_received: string;
  active_mcp_servers: Record<string, {
    ready: boolean;
    tool_count: number;
  }>;
  server_status: Record<string, {
    status: string;
    tools_list_response?: any;
    error?: string;
  }>;
  available_tools: Record<string, any[]>;
  test_tool_call?: {
    server?: string;
    tool?: string;
    result?: any;
    error?: string;
  };
}

// Function to start an MCP server
async function startMCPServer(id: string, command: string, args: string[] = [], env: Record<string, string> = {}) {
  if (mcpServers[id]) {
    console.log(`MCP server ${id} is already running`);
    return;
  }

  console.log(`Starting MCP server ${id}...`);
  const serverProcess = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  mcpServers[id] = {
    process: serverProcess,
    ready: false,
    tools: []
  };

  // Handle stdout
  serverProcess.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(`[${id}] ${output}`);
    
    // Parse JSON responses
    try {
      const lines = output.split('\n').filter(Boolean);
      for (const line of lines) {
        const response = JSON.parse(line);
        if (response.method === 'tools/list') {
          mcpServers[id].tools = response.result.tools;
          mcpServers[id].ready = true;
        }
      }
    } catch (e) {
      // Not JSON or not a response we care about
    }
  });

  // Handle stderr
  serverProcess.stderr.on('data', (data) => {
    console.error(`[${id}] Error: ${data}`);
  });

  // Handle process exit
  serverProcess.on('close', (code) => {
    console.log(`MCP server ${id} exited with code ${code}`);
    delete mcpServers[id];
  });

  // Send initial tools/list request
  serverProcess.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {}
  }) + '\n');

  // Wait for server to be ready
  await new Promise<void>((resolve) => {
    const checkReady = () => {
      if (mcpServers[id]?.ready) {
        resolve();
      } else {
        setTimeout(checkReady, 100);
      }
    };
    checkReady();
  });
}

// Function to send a request to an MCP server
async function sendMCPRequest(id: string, method: string, params: any = {}) {
  return new Promise((resolve, reject) => {
    const server = mcpServers[id];
    if (!server || !server.process.stdin || !server.process.stdout) {
      reject(new Error(`MCP server ${id} not found or not properly initialized`));
      return;
    }

    const requestId = Date.now();
    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params
    };

    // Set up response handler
    const responseHandler = (data: Buffer) => {
      const output = data.toString();
      try {
        const lines = output.split('\n').filter(Boolean);
        for (const line of lines) {
          const response = JSON.parse(line) as MCPResponse;
          if (response.id === requestId) {
            if (response.error) {
              reject(new Error(response.error.message));
            } else {
              resolve(response.result);
            }
            return;
          }
        }
      } catch (e) {
        // Not JSON or not our response
      }
    };

    server.process.stdout.once('data', responseHandler);
    server.process.stdin.write(JSON.stringify(request) + '\n');

    // Timeout after 5 seconds
    setTimeout(() => {
      if (server.process.stdout) {
        server.process.stdout.removeListener('data', responseHandler);
      }
      reject(new Error('Request timed out'));
    }, 5000);
  });
}

// Start MCP servers
(async () => {
  try {
    const nodePath = process.execPath;
    const projectRoot = path.join(__dirname, '..');

    // Start Brave Search MCP server
    await startMCPServer(
      'brave-search',
      nodePath,
      ['node_modules/@modelcontextprotocol/server-brave-search/dist/index.js'],
      { BRAVE_API_KEY: process.env.BRAVE_API_KEY || '' }
    );

    // Start GitHub MCP server
    await startMCPServer(
      'github',
      nodePath,
      ['node_modules/@modelcontextprotocol/server-github/dist/index.js'],
      {
        GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN || '',
        PWD: projectRoot
      }
    );

    console.log('MCP servers started successfully');
  } catch (error) {
    console.error('Failed to start MCP servers:', error);
  }
})();

// Available tools endpoint
app.get('/available-tools', (_req: Request, res: Response) => {
  const tools: Record<string, any> = {};
  
  for (const [serverId, server] of Object.entries(mcpServers)) {
    server.tools.forEach(tool => {
      tools[`${serverId}_${tool.name}`] = {
        ...tool,
        mcpServer: serverId
      };
    });
  }
  
  res.json({ tools });
});

// MCP status endpoint
app.get('/mcp-status', (_req: Request, res: Response) => {
  const status: Record<string, any> = {};
  
  for (const [serverId, server] of Object.entries(mcpServers)) {
    status[serverId] = {
      status: server.ready ? 'up' : 'down',
      url: 'stdio'
    };
  }
  
  res.json({ status });
});

// Tool endpoint
app.post('/tool', async (req: Request, res: Response) => {
  try {
    const { tool_name, params } = req.body;
    const [serverId, toolName] = tool_name.split('_');
    
    if (!mcpServers[serverId]) {
      throw new Error(`MCP server ${serverId} not found`);
    }

    const result = await sendMCPRequest(serverId, 'tools/call', {
      name: toolName,
      arguments: params
    }) as { content?: Array<{ text: string }> };

    res.json({
      tool: tool_name,
      params,
      result: result?.content?.[0]?.text || ''
    });
  } catch (error) {
    console.error('Error executing tool:', error);
    res.status(500).json({ 
      error: 'Tool execution failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Chat endpoint (with debugging information)
app.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    const debugInfo: DebugInfo = {
      message_received: message,
      active_mcp_servers: {},
      server_status: {},
      available_tools: {}
    };

    // Gather MCP server information
    for (const [serverId, server] of Object.entries(mcpServers)) {
      debugInfo.active_mcp_servers[serverId] = {
        ready: server.ready,
        tool_count: server.tools.length
      };

      // Test each server with a tools/list request
      try {
        const toolsResult = await sendMCPRequest(serverId, 'tools/list');
        debugInfo.server_status[serverId] = {
          status: 'responding',
          tools_list_response: toolsResult
        };
      } catch (error) {
        debugInfo.server_status[serverId] = {
          status: 'error',
          error: error instanceof Error ? error.message : String(error)
        };
      }

      // Get available tools for this server
      debugInfo.available_tools[serverId] = server.tools;
    }

    // Try to execute a simple tool call if any are available
    const firstServer = Object.keys(mcpServers)[0];
    const firstTool = firstServer ? mcpServers[firstServer].tools[0] : null;
    
    if (firstServer && firstTool) {
      try {
        const testResult = await sendMCPRequest(firstServer, 'tools/call', {
          name: firstTool.name,
          arguments: { query: message }
        });
        debugInfo['test_tool_call'] = {
          server: firstServer,
          tool: firstTool.name,
          result: testResult
        };
      } catch (error) {
        debugInfo['test_tool_call'] = {
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    res.json({ 
      debug_info: debugInfo,
      message: "This is the debug mode response. Check the debug_info object for detailed information about MCP server status and interactions."
    });
  } catch (error) {
    console.error('Error in chat endpoint:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
  }
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('Shutting down MCP servers...');
  for (const [id, server] of Object.entries(mcpServers)) {
    console.log(`Stopping ${id}...`);
    server.process.kill();
  }
  process.exit(0);
});

app.listen(port, () => {
  console.log(`Dashboard server running at http://localhost:${port}`);
}); 