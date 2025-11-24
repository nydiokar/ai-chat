# Kanebra Work Guide

Reference for development, maintenance, and feature work on the Kanebra Discord bot.

---

## Project Goal

Build and maintain a comprehensive AI-powered Discord bot with MCP capabilities for cryptocurrency token tracking, advanced task management, and extensible tool integration using modular architecture.

---

## Main Documentation

**Available Documentation**:
- **README.md** - Complete project overview, setup, and usage
- **docs/ARCHITECTURE.md** - System design and architecture details
- **docs/TYPES.md** - TypeScript type system documentation
- **docs/configuration.md** - Configuration guide
- **prisma/schema.prisma** - Database schema and relationships
- **package.json** - Dependencies and scripts reference

**Feature Documentation**:
- **docs/features/ai-integration.md** - AI service implementation
- **docs/features/hot-tokens.md** - Cryptocurrency tracking
- **docs/features/tasks.md** - Task management system

**Service Documentation**:
- **docs/services/memory.md** - Memory management
- **docs/services/cache.md** - Caching strategies
- **docs/services/performance.md** - Performance monitoring

**Existing Docs Directory**:
- **docs/components for later usage/** - Contains system-prompt-generator copy.md

---

## Task List

### 1. **Development Workflow**
   - [ ] Set up development environment (.env.development)
   - [ ] Run database migrations (`npm run db:generate:dev`)
   - [ ] Start development server (`npm run dev`)
   - [ ] Verify Discord bot connectivity

### 2. **Feature Development**
   - [ ] AI Service enhancements (new models/providers)
   - [ ] Hot Tokens feature improvements (new data sources)
   - [ ] Task Management extensions (advanced scheduling)
   - [ ] MCP Tool integration (new tools/servers)

### 3. **Testing & Quality**
   - [ ] Run full test suite (`npm test`)
   - [ ] Execute feature-specific tests (`npm run test:tokens`, `npm run test:mcp`)
   - [ ] Check code coverage (`npm run test:coverage`)
   - [ ] Run linting (`npm run lint`)

### 4. **Deployment & Operations**
   - [ ] Update production configuration
   - [ ] Test production build (`npm run build`)
   - [ ] Deploy with PM2 (`npm run bot:prod`)
   - [ ] Verify monitoring and logging

---

## Key Files

**Core Architecture**:
- `src/index.ts` - Main application entry point
- `src/services/` - Core services (AI, Memory, Cache, Performance)
- `src/features/` - Feature implementations (hot-tokens, pulse-mcp, tasks)
- `src/tools/mcp/` - MCP integration and tool management
- `src/types/` - TypeScript type definitions

**Configuration & Database**:
- `prisma/schema.prisma` - Database schema
- `.env.example` - Environment variables template
- `ecosystem.config.cjs` - PM2 process configuration

**Testing & Quality**:
- `src/**/*.test.ts` - Unit and integration tests
- `tsconfig.json` - TypeScript configuration
- `eslint.config.js` - Linting rules

---

## Build/Run Commands

```bash
# Development setup
npm install
npm run prisma:generate
npm run db:migrate:dev

# Development server
npm run dev                    # Main application
npm run bot:dev               # Discord bot only
npm run mcp:dashboard:dev     # MCP dashboard

# Production build
npm run build
npm run bot:prod              # Start with PM2

# Testing
npm test                      # All tests
npm run test:coverage         # With coverage
npm run test:tokens           # Hot tokens tests
npm run test:mcp              # MCP tests

# Quality checks
npm run lint                  # ESLint
npm run typecheck             # TypeScript check
npm run format                # Prettier formatting

# Database management
npm run db:generate:dev       # Generate Prisma client
npm run db:migrate:dev        # Run migrations
npm run db:sync               # Sync database
```

---

## Testing Strategy

**Unit Tests**: Test individual functions and modules
- Run with: `npm test` or `npm run test:unit`
- Coverage threshold: 80% minimum

**Integration Tests**: Test feature interactions
- AI service integration: `npm run test:react`
- MCP tools: `npm run test:mcp`
- Hot tokens: `npm run test:tokens`

**Manual Testing**:
- Discord bot commands in test server
- MCP dashboard functionality (`npm run mcp:dashboard`)
- API endpoints and tool execution

**CI/CD Verification**:
- All tests pass in GitHub Actions
- CodeQL security scan passes
- Linting and type checking succeed

---

## Reference Material

**Primary Sources**:
- **README.md** - Complete setup and usage guide
- **docs/** - Detailed feature and service documentation
- **prisma/schema.prisma** - Database relationships and constraints
- **package.json** - Available scripts and dependencies

**Code Patterns**:
- Dependency injection with Inversify (`src/services/`)
- MCP tool registration (`src/tools/mcp/`)
- Error handling patterns (`src/utils/`)
- Type definitions (`src/types/`)

**External Resources**:
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP specification
- [Discord.js Guide](https://discordjs.guide/) - Discord integration
- [Prisma Documentation](https://www.prisma.io/docs) - Database operations

---

## Success Criteria

**Code Quality**:
- [ ] All TypeScript types properly defined
- [ ] ESLint passes with no errors
- [ ] Test coverage > 80%
- [ ] Code formatted with Prettier

**Functionality**:
- [ ] Discord bot responds to commands
- [ ] AI services integrate correctly
- [ ] MCP tools discover and execute
- [ ] Database operations work
- [ ] Hot tokens tracking functions

**Documentation**:
- [ ] Code changes documented
- [ ] New features added to relevant docs
- [ ] Environment variables documented
- [ ] API changes reflected in types

---

## Common Patterns

**Service Structure**:
```typescript
@Injectable()
export class ExampleService {
  constructor(
    @inject(TYPES.Logger) private logger: Logger,
    @inject(TYPES.Database) private db: Database
  ) {}

  async execute(input: InputType): Promise<OutputType> {
    this.logger.info('Starting execution', { input });

    try {
      // Implementation
      const result = await this.process(input);
      return result;
    } catch (error) {
      this.logger.error('Execution failed', { error, input });
      throw error;
    }
  }
}
```

**Error Handling**:
```typescript
try {
  const result = await riskyOperation();
  return result;
} catch (error) {
  if (error instanceof ValidationError) {
    throw new BotError('Invalid input provided', error);
  }
  throw new BotError('Operation failed', error);
}
```

**MCP Tool Registration**:
```typescript
export const exampleTool: Tool = {
  name: 'example_tool',
  description: 'Description of what the tool does',
  inputSchema: {
    type: 'object',
    properties: {
      param1: { type: 'string' },
      param2: { type: 'number' }
    },
    required: ['param1']
  }
};
```

---

## Troubleshooting

**Common Issues**:

- **Database connection fails**: Check `DATABASE_URL` in .env file
- **Discord bot won't start**: Verify `DISCORD_TOKEN` is valid
- **MCP tools not loading**: Check `MCP_ENABLED=true` and related configs
- **AI requests failing**: Verify API keys for OpenAI/Anthropic
- **TypeScript errors**: Run `npm run typecheck` for detailed errors
- **Tests failing**: Ensure database is set up with `npm run db:sync`

**Debug Commands**:
```bash
npm run diagnose:github    # Debug GitHub integration
npm run mcp:status         # Check MCP server status
npm run react              # Test AI reasoning with clean logs
```

---

### AI Integration Patterns

**LightAgent Integration Notes**:
- Use LightAgent only as an architectural reference, not as a dependency
- Adopt Tree-of-Thought pre-planning loop in ai-service as optional planning stage
- Reuse MCP auto-registration pattern to simplify logic in tools/mcp/
- Replace implicit tool-selection heuristics with explicit "reflect-then-filter" cycle
- Keep existing task, memory, DI, and Discord layers (already superior)
- Use LightAgent as correctness baseline when debugging reasoning failures

**Remember**: Always run tests before committing. Use the modular architecture. Follow TypeScript strict typing. Update documentation for changes.
