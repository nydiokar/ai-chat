# Kanebra

> Status: Archived. This repository is kept as a learning and architecture reference, not as an active product.

See [ARCHIVE.md](./ARCHIVE.md) for the final project verdict.

[![CI](https://github.com/nydiokar/ai-chat/workflows/CI/badge.svg)](https://github.com/nydiokar/ai-chat/actions)
[![Security](https://github.com/nydiokar/ai-chat/workflows/Security/badge.svg)](https://github.com/nydiokar/ai-chat/actions)
[![CodeQL](https://github.com/nydiokar/ai-chat/workflows/CodeQL/badge.svg)](https://github.com/nydiokar/ai-chat/actions)

This repository contains an experimental agent-oriented codebase that combined AI capabilities, cryptocurrency token tracking, and task-management ideas. It is no longer being actively developed.

The most useful parts of the project are its runtime architecture and implementation lessons, not its status as a current agent platform.

## Archive Summary

- Archived on 2026-03-16 UTC
- Not production-ready as a general-purpose agent platform
- Preserved for reference, learning, and selective reuse only

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

## CI/CD & Quality Assurance

This project uses **intelligent CI/CD pipelines** that automatically fix issues and maintain code quality:

### 🧠 Intelligent Workflows

- **🤖 Auto-Fix**: Automatically fixes formatting and linting issues on PRs
- **📝 Smart Commits**: Commits quality improvements directly to your branch
- **💬 PR Comments**: Provides actionable feedback and next steps
- **🎯 Quality Gates**: Ensures only high-quality code gets merged
- **📊 Quality Scoring**: Provides code quality metrics and recommendations

### Automated Workflows

- **CI Pipeline**: Multi-Node.js version testing with comprehensive checks
- **Auto-Fix**: Runs on PRs to automatically fix formatting/linting issues
- **Code Quality**: Advanced analysis with quality scoring and debt tracking
- **Security Scanning**: Daily CodeQL analysis and dependency audits
- **PR Validation**: Intelligent PR analysis with conventional commit checking
- **Release Automation**: Automated GitHub releases on version tags

### 🛠️ Code Quality Tools

- **ESLint**: Advanced linting with auto-fix capabilities
- **Prettier**: Automated code formatting
- **TypeScript**: Strict type checking with path mapping
- **Quality Scoring**: Automated code quality assessment (0-100 scale)
- **Bundle Analysis**: Size monitoring and optimization suggestions

### 🤖 How Intelligent CI Works

1. **PR Creation**: When you create a PR, auto-fix workflow runs
2. **Quality Analysis**: Checks formatting, linting, and code quality
3. **Auto-Fix**: Automatically fixes issues like:
   - Code formatting (Prettier)
   - Basic linting issues (ESLint auto-fixable rules)
4. **Smart Commits**: Commits fixes directly to your PR branch
5. **PR Comments**: Provides feedback on what was fixed
6. **Quality Gate**: Final check ensures everything meets standards

**Example PR Comment:**
```
🤖 Auto-fix Applied

I've automatically improved your code quality by fixing:
• Code formatting (Prettier)
• Linting issues (ESLint)

The fixes have been committed to your branch. Your code now meets our formatting and linting standards!
```

### 🎯 Quality Standards

- **ESLint**: 0 errors allowed, warnings tracked but don't block CI
- **Prettier**: 100% formatted code required
- **TypeScript**: Strict compilation required
- **Tests**: Must pass on all supported Node.js versions
- **Security**: No high/critical vulnerabilities allowed

### Available Scripts

```bash
# 🚀 Development
npm run build          # TypeScript compilation
npm run typecheck      # Type checking only
npm run dev            # Development server with hot reload

# ✨ Code Quality (Intelligent)
npm run quality:check  # Run all quality checks (lint + format + types)
npm run quality:fix    # Auto-fix all quality issues
npm run pre-push       # Pre-push quality gate (run before pushing)

# 🧹 Individual Quality Tools
npm run lint           # ESLint checking
npm run lint:fix       # Auto-fix ESLint issues
npm run format         # Prettier formatting
npm run format:check   # Check formatting without changes

# 🧪 Testing
npm test               # Run all tests (including database-dependent)
npm run test:unit      # Run unit tests only
npm run test:ci        # Run CI tests (core functionality only)
npm run test:coverage  # Run tests with coverage (includes database tests)
npm run test:watch     # Watch mode testing

# 🔧 Maintenance
npm run db:sync        # Database synchronization
npm run prisma:generate # Generate Prisma client

# 🤖 CI Simulation
npm run ci             # Simulate full CI pipeline locally
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes and ensure tests pass (`npm test`)
4. Format your code (`npm run format`)
5. Commit your changes (`git commit -m 'feat: add amazing feature'`)
6. Push to your branch (`git push origin feature/amazing-feature`)
7. Create a Pull Request

### Pull Request Requirements

- All CI checks must pass
- Code must be formatted with Prettier
- Tests must have adequate coverage
- No security vulnerabilities introduced
- Conventional commit messages preferred

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

