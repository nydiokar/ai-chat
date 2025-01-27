# Quick Guide to Implementing MCP Servers

## Before You Start
- Check the MCP server's documentation first
- Look for required API keys/tokens
- Note any specific authentication requirements
- Review available tools and their purposes

## Key Files to Focus On

1. `src/tools/tools.ts`
   - This is where you configure the server
   - Define command, args, and environment variables
   - Map your API keys from .env to server env

2. `src/types/mcp-config.ts`
   - Contains interface definitions
   - Add new server IDs here if needed

## Critical Points to Check

1. **Authentication Pattern**
   - Find how server validates tokens (Bearer, Basic, etc.)
   - Example from GitHub server:
     ```javascript
     // In utils.js:
     headers["Authorization"] = `Bearer ${process.env.GITHUB_PERSONAL_ACCESS_TOKEN}`;
     ```
   - Notice header format and env var naming
   - Match this pattern in your implementation

2. **Server Configuration**
   - Each MCP server implementation may be different
   - Some use package.json scripts
   - Others use direct Node execution
   - Check server docs or implementation for requirements

2. **Environment Variables**
   - Check how the MCP server expects env vars to be named
   - Map your .env variables to match server expectations
   - Example: We had GITHUB_TOKEN -> GITHUB_PERSONAL_ACCESS_TOKEN

3. **Server Package Integration**
   - Look at the server's utils.js or similar for auth handling
   - Check how API calls are made
   - Understanding server's auth mechanism is crucial

3. **Common Gotchas**
   - Environment variable naming mismatches
   - Token/key format requirements
   - Server might expect different auth header format

## Implementation Steps

1. Working Configuration Example
   ```typescript
   // From our GitHub implementation:
   mcpConfig: MCPConfig = {
     mcpServers: {
       "github": {
         id: "github",
         name: "GitHub Tools",
         command: process.execPath,
         args: [
           "node_modules/@modelcontextprotocol/server-github/dist/index.js"
         ],
         env: {
           GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN || '',
           PWD: projectRoot
         }
       }
     }
   };
   ```
   - Notice direct Node execution
   - Environment variable mapping pattern
   - Project root path handling

2. First Look:
   - Check server implementation (index.js, utils.js)
   - Key files: utils.js (auth handling), index.js (tool definitions)
   - Pay attention to request headers and auth formats
   - Learn from server's error handling for debugging

2. Quick Test Strategy:
   - Start server manually: `node path/to/server/index.js`
   - Watch output for immediate auth/env issues
   - Verify server tools list matches documentation
   - Try a simple tool call directly before integration

2. Configuration:
   - Add environment variables to .env
   - Configure in tools.ts
   - Map environment variables correctly

3. Testing:
   - Start with read operations
   - Then try write operations
   - Watch server logs for auth issues

## Files You'll Typically Need to Touch

```
project/
├── .env                    // Add API keys
├── src/
│   ├── tools/
│   │   └── tools.ts       // Add server config
│   └── types/
│       └── mcp-config.ts  // Update if adding new server type
```

## Debugging Tips

1. **Watch the Logs**
   - Check terminal output for auth errors
   - Look for environment variable warnings
   - Pay attention to API error responses

2. **Progressive Testing**
   - Test server connection first
   - Try simple read operations
   - Then attempt write operations
   - Each step confirms different auth aspects

3. **Common Error Messages**
   - "Authentication Failed" - Check env var mapping
   - "Not Found" - Check paths and permissions
   - "Bad Request" - Check API call format

## Quick Server Verification

```typescript
// Use these steps to quickly verify server functionality
1. Check server starts:
   pm2 logs # Watch for "MCP Server running on stdio"

2. Verify tools are available:
   // Server should list available tools in logs
   // Example output:
   // [MCPClientService] Got tools list: { tools: [...] }

3. Try simplest operation:
   // Usually a read operation like search or list
   // Watch response format in logs to verify auth

Remember: Most issues come from environment variable mapping and authentication handling. Focus on these first if something's not working.
