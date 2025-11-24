# Kanebra Configuration Guide

## Overview

Kanebra supports comprehensive configuration through environment variables, allowing flexible deployment across different environments (development, production). Configuration is managed through `.env` files and validated at startup.

## Environment Files

### File Structure
```
.env.development    # Development environment
.env.production     # Production environment
```

### Environment Loading
Configuration is loaded based on:
1. `DOTENV_CONFIG_PATH` environment variable (if set)
2. `NODE_ENV` (production → `.env.production`, others → `.env.development`)

## Core Configuration

### Application Settings
```env
# Core Configuration
INSTANCE_ID=development
NODE_ENV=development

# Debug and Logging
DEBUG=true
LOG_LEVEL=info
LOG_SHOW_TOOLS=true
LOG_SHOW_REQUESTS=true
```

### Database Configuration

**Development (SQLite)**:
```env
DATABASE_URL="file:./dev.db"
```

**Production (PostgreSQL)**:
```env
DATABASE_URL="postgresql://username:password@localhost:5432/kanebra"
```

**Database Management**:
- Development: SQLite with automatic migrations
- Production: PostgreSQL with manual migration control
- Schema files: `prisma/schema.dev.prisma` and `prisma/schema.prod.prisma`

## AI Service Configuration

### OpenAI Provider
```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-3.5-turbo-0125
OPENAI_TEMPERATURE=0.7
OPENAI_MAX_RETRIES=3
OPENAI_TIMEOUT=60000
```

### Anthropic Provider
```env
ANTHROPIC_API_KEY=your_anthropic_api_key
CLAUDE_MODEL=claude-3-5-sonnet-20241022
```

### Ollama Provider
```env
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2:latest
```

### Provider Selection
```env
MODEL=openai  # Options: openai, claude, ollama
```

## Discord Integration

### Bot Configuration
```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_ENABLED=true
DISCORD_CLEANUP_INTERVAL=24
DISCORD_SESSION_TIMEOUT=12
```

## MCP (Model Context Protocol) Configuration

### Core MCP Settings
```env
MCP_ENABLED=true
MCP_AUTH_TOKEN=your_mcp_auth_token
MCP_LOG_LEVEL=info
```

### Server-Specific Configuration

**GitHub Server**:
```env
GITHUB_TOKEN=your_github_personal_access_token
MCP_GITHUB_ENABLED=true
MCP_GITHUB_DISABLED=false
```

**Brave Search Server**:
```env
BRAVE_API_KEY=your_brave_api_key
MCP_BRAVE_ENABLED=true
MCP_BRAVE_DISABLED=false
```

### MCP Server Management
- Servers are automatically discovered and registered
- Individual servers can be disabled using `MCP_{SERVER_NAME}_DISABLED=true`
- Server configurations are defined in `src/mcp_config.ts`

## PM2 Process Management

### Ecosystem Configuration
Configuration is defined in `ecosystem.config.cjs`:

**Production Bot** (`them-bot`):
```javascript
{
  name: "them-bot",
  script: "./dist/discord-bot.js",
  env_production: {
    NODE_ENV: "production",
    DOTENV_CONFIG_PATH: ".env.production",
    INSTANCE_ID: "production"
  }
}
```

**Development Bot** (`them-bot-dev`):
```javascript
{
  name: "them-bot-dev",
  script: "./dist/discord-bot.js",
  env_development: {
    NODE_ENV: "development",
    DOTENV_CONFIG_PATH: ".env.development",
    INSTANCE_ID: "development"
  }
}
```

### PM2 Commands
```bash
# Production
npm run bot:prod          # Start production bot
npm run bot:stop:prod     # Stop production bot
npm run bot:logs:prod     # View production logs

# Development
npm run bot:dev           # Start development bot
npm run bot:stop:dev      # Stop development bot
npm run bot:logs:dev      # View development logs

# Management
npm run bot:monit         # PM2 monitoring dashboard
```

## Development vs Production Differences

### Database
- **Development**: SQLite (fast, file-based, auto-migrations)
- **Production**: PostgreSQL (scalable, concurrent, manual migrations)

### Logging
- **Development**: Verbose logging, all tools and requests shown
- **Production**: Concise logging, errors only by default

### Performance
- **Development**: Hot reloading, detailed metrics
- **Production**: Optimized builds, memory limits, auto-restart

## Configuration Validation

### Startup Validation
The application validates configuration at startup:

1. **Environment Variables**: Required variables are checked
2. **Database Connection**: Database connectivity is verified
3. **API Keys**: AI provider keys are validated
4. **Discord Token**: Bot token format is checked
5. **MCP Configuration**: Server configurations are validated

### Validation Errors
Invalid configuration will prevent startup with clear error messages indicating which settings need correction.

## Environment-Specific Overrides

### Development Overrides
```env
DEBUG=true
LOG_LEVEL=debug
LOG_SHOW_TOOLS=true
LOG_SHOW_REQUESTS=true
DATABASE_URL="file:./dev.db"
```

### Production Overrides
```env
DEBUG=false
LOG_LEVEL=info
LOG_SHOW_TOOLS=false
LOG_SHOW_REQUESTS=false
DATABASE_URL="postgresql://..."
```

## Security Considerations

### Sensitive Data
- API keys should never be committed to version control
- Use environment-specific `.env` files
- Rotate keys regularly
- Use secure token storage

### Database Security
- Use strong passwords for production databases
- Enable SSL/TLS for database connections
- Regularly backup production data
- Limit database user permissions

### Discord Bot Security
- Use bot-specific tokens with minimal permissions
- Monitor bot activity for abuse
- Implement rate limiting for commands
- Log security-relevant events

## Troubleshooting Configuration

### Common Issues

**Database Connection Failed**:
- Check `DATABASE_URL` format
- Verify database server is running
- Ensure correct credentials for PostgreSQL

**AI Provider Errors**:
- Validate API keys are correct and active
- Check rate limits and quotas
- Verify model names are supported

**Discord Bot Won't Start**:
- Confirm `DISCORD_TOKEN` is valid
- Check bot permissions in Discord developer portal
- Verify bot is invited to server

**MCP Tools Not Loading**:
- Check `MCP_ENABLED=true`
- Verify server-specific tokens (GitHub, Brave)
- Review MCP server logs

### Configuration Debugging
```bash
# Test configuration loading
npm run config:test

# Check database connection
npm run db:test

# Validate MCP setup
npm run mcp:status

# Test Discord connection
npm run discord:test
```

## Configuration File Reference

### TypeScript Configuration
- `tsconfig.json`: Main TypeScript configuration
- `tsconfig.test.json`: Test-specific TypeScript settings

### ESLint Configuration
- `eslint.config.js`: Linting rules and settings

### Prisma Configuration
- `prisma.config.ts`: Database and migration configuration
- `prisma/schema.prisma`: Database schema definition

This comprehensive configuration system ensures Kanebra can be deployed flexibly across different environments while maintaining security and performance standards.
