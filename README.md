# Kanebra - Discord bot with MCP capabilities

A comprehensive system that combines AI capabilities, cryptocurrency token tracking, and advanced task management. Built with a modular architecture using the Model Context Protocol (MCP) for extensible tool integration.

## Core Features

### 🤖 AI Integration
- Multiple AI model support (OpenAI, Ollama)
- Context-aware interactions
- Memory management system
- Dynamic prompt generation

### 💎 Token Tracking
- Real-time cryptocurrency monitoring
- Market cap and price tracking
- Trend detection and alerts
- Category-based organization

### ⚡ Task Management
- Advanced task scheduling
- Dependency management
- Progress visualization
- Automated notifications

### 🔌 Tool Integration
- Dynamic MCP server integration
- Extensible tool system
- GitHub-based tool discovery
- Resource management

## System Architecture

### Core Services
- **AI Service**: Model integration and context management
- **Memory System**: Long-term conversation memory
- **Cache System**: Performance optimization
- **Performance Monitoring**: System health and metrics

### Features
- **Hot Tokens**: Cryptocurrency tracking and analysis
- **Pulse MCP**: Tool and server management
- **Task System**: Scheduling and dependency handling

### Integration
- **Discord Bot**: User interface and notifications
- **Database**: Prisma-based data persistence
- **GitHub**: Tool discovery and integration

## Technical Stack

- **Runtime**: Node.js (v16+)
- **Language**: TypeScript
- **Database**: Prisma with SQL
- **Testing**: Mocha
- **Process Management**: PM2

## Prerequisites

- Node.js (v16 or higher)
- Discord Bot Token
- Database (supported by Prisma)
- API Keys for AI services

## Environment Setup

Create a `.env.development` or `.env.production` file based on the example:

**Quick Start:** Copy `.env.example` to `.env` and fill in your actual values.

```env
# Core Configuration
INSTANCE_ID=development
NODE_ENV=development

# AI Services
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
OLLAMA_HOST=http://127.0.0.1:11434

# AI Model Configuration
OPENAI_MODEL=gpt-3.5-turbo-0125
OPENAI_TEMPERATURE=0.7
OPENAI_MAX_RETRIES=3
OLLAMA_MODEL=llama3.2:latest

# Alternative provider-based configuration (used by main services):
# MODEL=openai
# OPENAI_MODEL=gpt-3.5-turbo-0125
# CLAUDE_MODEL=claude-3-5-sonnet-20241022
# OLLAMA_MODEL=llama3.2:latest

# Discord Integration
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLEANUP_INTERVAL=24
DISCORD_SESSION_TIMEOUT=12

# MCP Configuration
MCP_ENABLED=true
MCP_AUTH_TOKEN=your_mcp_token
MCP_LOG_LEVEL=info
MCP_GITHUB_ENABLED=true
MCP_BRAVE_ENABLED=true
GITHUB_TOKEN=your_github_token
BRAVE_API_KEY=your_brave_api_key

# Database
DATABASE_URL=your_database_url

# Optional Settings
DEBUG=true
LOG_LEVEL=info
LOG_SHOW_TOOLS=true
LOG_SHOW_REQUESTS=true
```

## Getting Started

1. **Installation**
   ```bash
   git clone [repository-url]
   cd them
   npm install
   ```

2. **Database Setup**
   ```bash
   npx prisma generate
   npx prisma migrate dev
   ```

3. **Running the System**
   
   Development:
   ```bash
   ./start-dev.bat
   ```
   
   Production:
   ```bash
   ./start-prod.bat
   ```
   
   Using PM2:
   ```bash
   pm2 start ecosystem.config.cjs
   ```

## Development

### Testing
```bash
npm test
```

### Linting
```bash
npm run lint
```

## Project Structure

```
src/
├── features/          # Core feature implementations
├── services/         # Shared services
├── tasks/           # Task management system
├── tools/           # Tool integration
├── types/           # Type definitions
└── utils/           # Utility functions
```

## Documentation

For detailed documentation, please refer to the `/docs` directory:

### Core Documentation
- [Architecture Overview](/docs/ARCHITECTURE.md)
- [Type System](/docs/TYPES.md)
- [Configuration Guide](/docs/configuration.md)

### Feature Documentation
- [AI Integration](/docs/features/ai-integration.md)
- [Token Tracking](/docs/features/hot-tokens.md)
- [Task Management](/docs/features/tasks.md)

### Service Documentation
- [Memory System](/docs/services/memory.md)
- [Cache System](/docs/services/cache.md)
- [Performance](/docs/services/performance.md)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to your branch
5. Create a Pull Request

## License

## Logging Options

### Environment Variables for Logging

To control the verbosity of logs, especially when using the OpenAI API, you can set the following environment variables:

- `DISABLE_OPENAI_VERBOSE_LOGS=true` - Disables all detailed logs from OpenAI API requests and responses
- `REACT_VERBOSE_LOGGING=true` - Enables detailed logging for the ReAct reasoning process
- `NODE_ENV=production` - Sets more conservative logging levels in production environments

### Enhanced Logging with CLI

For a cleaner, more useful debugging experience with the CLI, use the new clean CLI mode:

```bash
# Use the clean CLI mode
npm run cli:react:clean

# Or manually set environment variables
DISABLE_OPENAI_VERBOSE_LOGS=true REACT_VERBOSE_LOGGING=true npm run cli:react
```

This mode will:
1. Disable noisy OpenAI API debug logs
2. Enable detailed, formatted logging of:
   - Prompts being sent to the model
   - Responses received from the model
   - Tool calls and their results
   - Reasoning steps and conclusions
3. Format the output to focus on the important information

For detailed examples and more configuration options, see the [Logging Documentation](/docs/logging.md).

### Log Filtering

The logger automatically filters out noisy HTTP headers and other extraneous information from the logs. This includes:

- HTTP headers
- Authorization tokens
- Rate limit information
- OpenAI API metadata

If you're still seeing too many logs, you can:

1. Set `DISABLE_OPENAI_VERBOSE_LOGS=true` to disable OpenAI request/response logging
2. Adjust the log level by setting `LOG_LEVEL=info` (default is debug in development)

