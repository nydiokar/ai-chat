# Technical Context

## Technologies Used
1. Core Runtime
   - TypeScript/Node.js
   - PM2 for process management

2. Database
   - Prisma ORM
   - SQLite database
   - Migration-based schema management

3. AI Services
   - Anthropic Claude
   - OpenAI GPT
   - DeepSeek AI

4. Integration
   - Discord.js v14
   - MCP SDK v1.1.1
   - MCP Server Tools
     - GitHub integration
     - Brave Search capabilities

5. Testing
   - Mocha test framework
   - Chai assertions
   - ts-node for TypeScript testing

## Development Setup
1. Environment Requirements
   - Node.js
   - TypeScript
   - PM2 for production
   - Discord bot token
   - AI service API keys

2. Key Scripts
   ```bash
   npm run dev          # Development with hot reload
   npm run bot         # Run Discord bot in dev mode
   npm run bot:prod    # Run bot in production
   npm run test        # Run test suite
   npm run db:migrate  # Run database migrations
   ```

3. Database Management
   - Prisma migrations for schema changes
   - Auto-generated Prisma client
   - SQLite for data persistence

## Technical Constraints
1. Performance Limits
   - Max 50 requests/min per AI service
   - 30s tool execution timeout
   - 4000 char message length limit
   - 10 message context window

2. Infrastructure Requirements
   - Persistent storage for SQLite
   - Process management (PM2)
   - Network access for APIs
   - Discord bot privileges

3. Security
   - Environment-based secrets
   - Discord permission system
   - Rate limiting protection
   - Error handling boundaries

4. Scaling Considerations
   - Single instance design
   - Synchronous processing
   - Local file system dependency
   - Database connection limits
