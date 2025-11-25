# Kanebra Work Guide

Reference for development, maintenance, and feature work on the Kanebra Discord bot.

---

## Project Goal

Build and maintain a comprehensive AI-powered Discord bot with MCP capabilities for cryptocurrency token tracking, advanced task management, and extensible tool integration using modular architecture.

---

## Main Documentation

**Available Documentation**:
- **README.md** - Complete project overview, setup, and usage
- **documentation/ARCHITECTURE.md** - System design and architecture details
- **documentation/ARCHITECTURE_MAP.md** - Service and feature relationships
- **documentation/configuration.md** - Configuration guide
- **documentation/ROADMAP.md** - Project journey and future direction
- **prisma/schema.prisma** - Database schema and relationships
- **package.json** - Dependencies and scripts reference

**Feature Documentation**:
- **documentation/features/ai-integration.md** - AI service implementation
- **documentation/features/hot-tokens.md** - Cryptocurrency tracking
- **documentation/features/tasks.md** - Task management system

**Historical Documentation**:
- **docs/archive/** - Historical vision and early roadmaps (reference only)
- **docs/logging.md** - Logging system configuration
- **docs/migration/** - Database migration strategies

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
- `src/agents/` - AI agents (ReAct, ToT planning)

**Agent System**:
- `src/agents/react-agent.ts` - Lightweight agent wrapper
- `src/agents/react-engine.ts` - Core reasoning orchestration
- `src/agents/planning/tot-planner.ts` - Tree-of-Thought pre-planning
- `src/agents/react/` - ReAct components (parser, prompt generator, trace, tool handler)

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
npm run test:react            # ReAct agent tests

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

## ReAct Agent Architecture

### Component Structure

```
ReActAgent (minimal wrapper)
  └─ ReActEngine (orchestrator)
      ├─ ToTPlanner (optional - pre-planning)
      ├─ ReActTrace (state management)
      ├─ ReActStepParser (LLM output parsing)
      ├─ ReActToolHandler (tool execution)
      ├─ ReActPromptGenerator (prompt creation)
      └─ MemoryProvider (persistence)
```

### Core Types

**ReasoningStep** (src/types/react-types.ts):
```typescript
interface ReasoningStep {
  stepId: string;
  thought?: {
    reasoning: string;
    plan: string;
  };
  action?: {
    tool: string;
    purpose?: string;
    params: Record<string, unknown>;
  };
  observation?: {
    result: string;
  };
  conclusion?: {
    final_answer: string;
    explanation?: string;
  };
  isComplete: boolean;
  timestamp: string;
}
```

### Agent Flow

1. **Input** → ReActAgent.processMessage()
2. **Planning** (if enabled) → ToTPlanner generates 3-stage plan
3. **Reasoning Loop** → ReActEngine.process():
   - Generate contextual prompt
   - Get LLM response
   - Parse reasoning step
   - Execute tool if needed
   - Store step in memory
   - Check for conclusion
   - Repeat (max 8 iterations)
4. **Output** → Final answer or fallback

### Key Features

**Tree-of-Thought Integration**:
- Feature flag: `ENABLE_TOT_PLANNING` (default: false)
- 3-stage planning: Understanding → Decomposition → Strategy
- Filters tools based on plan relevance
- Works with OpenAI and Ollama providers

**Memory System**:
- Dual system: Database persistence + in-memory during reasoning
- Stores all reasoning steps with metadata
- Retrieves relevant memories for context

**Tool Integration**:
- MCP-based dynamic tool discovery
- Intelligent tool selection based on task
- Proper parameter validation and normalization
- Formatted results for LLM consumption

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
- **documentation/** - Detailed feature and service documentation
- **documentation/ROADMAP.md** - Development journey and next steps
- **prisma/schema.prisma** - Database relationships and constraints
- **package.json** - Available scripts and dependencies

**Code Patterns**:
- Dependency injection with Inversify (`src/services/`)
- MCP tool registration (`src/tools/mcp/`)
- Error handling patterns (`src/utils/`)
- Type definitions (`src/types/`)
- ReAct agent patterns (`src/agents/react/`)

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
- [ ] ReAct agent completes multi-step reasoning

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

**ReAct Agent Usage**:
```typescript
// In ReActEngine or ReActAgent
const step: ReasoningStep = {
  stepId: `step_${iterationCount}`,
  thought: {
    reasoning: 'Analysis of the situation',
    plan: 'Concrete steps to take'
  },
  action: {
    tool: 'tool_name',
    purpose: 'Why using this tool',
    params: { key: 'value' }
  },
  isComplete: false,
  timestamp: new Date().toISOString()
};
```

---

## Troubleshooting

**Common Issues**:

- **Database connection fails**: Check `DATABASE_URL` in .env file
- **Discord bot won't start**: Verify `DISCORD_TOKEN` is valid
- **MCP tools not loading**: Check `MCP_ENABLED=true` and related configs
- **AI requests failing**: Verify API keys for OpenAI/Anthropic/Ollama
- **TypeScript errors**: Run `npm run typecheck` for detailed errors
- **Tests failing**: Ensure database is set up with `npm run db:sync`
- **ReAct agent not reasoning**: Check YAML formatting in LLM responses
- **ToT planning fails**: Ensure `ENABLE_TOT_PLANNING=true` and model supports it

**Debug Commands**:
```bash
npm run diagnose:github    # Debug GitHub integration
npm run mcp:status         # Check MCP server status
npm run react              # Test AI reasoning with clean logs
npm run react:clean        # Test with minimal logging
```

---

## AI Integration Patterns

**ReAct Agent Best Practices**:
- Keep reasoning steps focused and actionable
- Use YAML format for structured thought processes
- Validate tool parameters before execution
- Store all reasoning steps in memory for context
- Limit reasoning loops to prevent infinite iterations (max 8)
- Format tool results clearly for LLM consumption

**ToT Planning Integration**:
- Enable with `ENABLE_TOT_PLANNING=true`
- Works best with GPT-4 or larger Ollama models
- Creates 3-stage plans before reasoning
- Filters tools based on plan relevance
- Adds overhead but improves complex task handling

**Memory Management**:
- Use MemoryProvider for persistent storage
- In-memory cache for active reasoning sessions
- Context optimization for long reasoning chains
- Retrieve relevant memories for enhanced context

**Tool Selection**:
- Let ToT planner filter tools when enabled
- Otherwise, provide all available tools
- Clear tool descriptions improve selection
- Examples in tool schemas help LLM usage

**Remember**: Always run tests before committing. Use the modular architecture. Follow TypeScript strict typing. Update documentation for changes. Keep reasoning focused and avoid over-engineering.
