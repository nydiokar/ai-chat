# MCP Tool Integration Guide

This guide explains how to add new MCP (Model Context Protocol) tools to the ai-chat project.

## Prerequisites

- Node.js and npm installed
- Access to required API keys/tokens
- Project dependencies installed

## Steps to Add a New MCP Tool

1. Install the MCP Server Package
```bash
npm install @modelcontextprotocol/server-[tool-name]
```

2. Update Environment Variables
- Add new environment variables to `.env.example`
- Add the actual values to your `.env` file
- Format: `TOOL_NAME_API_KEY=your-api-key`

3. Configure the Tool in `tools.ts`
```typescript
// Add environment variable check
if (!process.env.TOOL_NAME_API_KEY) {
    console.warn('Warning: TOOL_NAME_API_KEY not found in environment variables');
}

// Add tool configuration
export const mcpConfig: MCPConfig = {
    mcpServers: {
        "tool-name": {
            command: nodePath,
            args: [
                "node_modules/@modelcontextprotocol/server-[tool-name]/dist/index.js"
            ],
            env: {
                TOOL_NAME_API_KEY: process.env.TOOL_NAME_API_KEY || ''
            },
            tools: [
                {
                    name: "tool_function_name",
                    description: "Description of what the tool does"
                }
                // Add more tool functions as needed
            ]
        }
    }
};
```

## Testing Checklist

1. Configuration Verification
- [ ] Environment variables are properly set
- [ ] Tool is correctly configured in `tools.ts`
- [ ] Package is installed and listed in `package.json`

2. Functionality Testing
- [ ] MCP server starts without errors
- [ ] Tool functions are accessible
- [ ] API keys/tokens are properly passed

3. Error Handling
- [ ] Missing API key warnings work
- [ ] Error messages are clear and helpful
- [ ] Failed requests are properly handled

## Best Practices

1. Security
- Never commit API keys/tokens
- Use environment variables for sensitive data
- Follow principle of least privilege

2. Documentation
- Keep tool descriptions clear and concise
- Document any special requirements
- Include example usage where helpful

3. Error Handling
- Implement proper error checks
- Provide meaningful error messages
- Handle edge cases appropriately

## Troubleshooting

Common issues and solutions:

1. Tool Not Found
- Verify package installation
- Check path in tools.ts configuration
- Ensure correct package name

2. Authentication Errors
- Verify API key/token in .env
- Check environment variable names
- Confirm API key permissions

3. Runtime Errors
- Check server logs
- Verify tool configuration
- Ensure all dependencies are installed

## Example Integration

Here's a complete example using the GitHub MCP tool:

1. Installation
```bash
npm install @modelcontextprotocol/server-github
```

2. Environment Setup
```env
GITHUB_TOKEN=your-github-token
```

3. Configuration
```typescript
if (!process.env.GITHUB_TOKEN) {
    console.warn('Warning: GITHUB_TOKEN not found in environment variables');
}

export const mcpConfig: MCPConfig = {
    mcpServers: {
        "github": {
            command: nodePath,
            args: [
                "node_modules/@modelcontextprotocol/server-github/dist/index.js"
            ],
            env: {
                GITHUB_TOKEN: process.env.GITHUB_TOKEN || ''
            },
            tools: [
                {
                    name: "create_issue",
                    description: "Create a new issue in a GitHub repository"
                }
                // Additional GitHub tools...
            ]
        }
    }
};
