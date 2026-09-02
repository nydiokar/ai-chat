# Kanebra AI Development Framework

AI agent contract and development guidelines for the Kanebra Discord bot project.

## Quick Start

### Getting Started with Kanebra Development

```bash
# Ensure you're in the Kanebra project root
cd /path/to/kanebra

# Read the current project state
cat .ai/CONTEXT.md

# Review development guidelines
cat .ai/RULES.md

# Check available tasks and references
cat .ai/GUIDE.md

# Tell your AI agent:
# "Read .ai/ folder and begin work on the next incomplete task"
```

## Kanebra AI Development Structure

```
.ai/
├── CONTEXT.md      # Current project state (updated by AI agents)
├── RULES.md        # TypeScript/Node.js development standards
├── GUIDE.md        # Kanebra-specific development references
├── HANDOFF.md      # Session management for AI collaboration
├── README.md       # This file - framework overview
└── init-ai.sh      # Initialization script
```

## Usage with Kanebra

Tell any AI assistant:
```
Read the .ai/ folder for Kanebra project context, rules, and current state.
Then continue development work as outlined in GUIDE.md, following the established patterns.
```

**Supported AI Tools**:
- ✅ Claude (Anthropic) - Recommended for complex reasoning
- ✅ GPT-4 (OpenAI) - Good for general development
- ✅ Cursor - Integrated development environment
- ✅ Aider - Specialized code assistance
- ✅ Continue - VS Code extension
- ✅ Any LLM with file system access

**Kanebra-Specific Setup**:
- Ensure Node.js 16+ and npm are installed
- Copy `.env.example` to `.env` and configure API keys
- Run `npm install && npm run prisma:generate`
- Start development with `npm run dev`

## Kanebra Project Customization

This .ai/ folder is already customized for the Kanebra project, which has comprehensive documentation:

**Extensive Documentation Available**:
- `README.md` - Complete project overview and setup
- `docs/` - Detailed architecture, features, and services
- `prisma/schema.prisma` - Database schema reference
- `package.json` - Dependencies and scripts
- Comprehensive test suite with Mocha/Chai

**Current GUIDE.md References**:
- Primary documentation sources
- Feature-specific guides (AI, tokens, tasks, MCP)
- Service documentation (memory, cache, performance)
- Build/run commands with npm scripts
- Testing strategies and coverage requirements
- Common patterns and troubleshooting

**No Additional Customization Needed**:
The framework is ready for AI-assisted development on Kanebra.

## File Roles

### CONTEXT.md (Mutable)
- **Who updates**: AI agent after each task
- **What it tracks**: Current progress, blockers, notes
- **Format**: Markdown with checkboxes

### RULES.md (Kanebra-Specific)
- **Who updates**: Humans only (rarely)
- **What it defines**: TypeScript/Node.js standards, Kanebra conventions
- **Format**: Numbered rules with project-specific additions

### GUIDE.md (Kanebra Reference)
- **Who updates**: Humans (as project evolves)
- **What it contains**: Kanebra documentation references, development workflow
- **Format**: Structured markdown with project-specific examples

### HANDOFF.md (Protocol)
- **Who updates**: Rarely
- **What it defines**: Session transfer process
- **Format**: Step-by-step procedures

## Benefits

**Universal**: Works with any LLM, any project
**Lightweight**: ~5KB total
**Self-updating**: AI keeps CONTEXT.md current
**Portable**: Copy to any project
**Simple**: 4 files, clear roles

## Kanebra Development Examples

### Adding a New Feature
```markdown
# Development workflow for new Kanebra features:

1. **Plan**: Review existing patterns in src/features/
2. **Implement**: Add service in src/services/ with DI
3. **Test**: Write unit tests and integration tests
4. **Document**: Update relevant docs/ files
5. **Deploy**: Test with PM2 in development mode

## Reference Files
- src/types/ - Add TypeScript interfaces
- src/services/ - Implement with dependency injection
- prisma/schema.prisma - Database schema updates
- docs/features/ - Feature documentation
```

### Debugging Issues
```markdown
# Common Kanebra debugging workflow:

1. **Reproduce**: Use test environment setup
2. **Logs**: Check winston logs with proper levels
3. **Database**: Verify Prisma queries and migrations
4. **MCP**: Test tool registration and execution
5. **AI**: Verify provider configurations

## Debug Commands
- npm run react              # Clean AI reasoning logs
- npm run mcp:status         # Check MCP server status
- npm run diagnose:github    # GitHub integration diagnostics
- npm run db:sync           # Database synchronization
```

## Kanebra Integration Notes

This AI development framework is specifically designed for the Kanebra project:

**Kanebra-Specific Features**:
- TypeScript/Node.js development standards
- MCP (Model Context Protocol) integration patterns
- Prisma database ORM conventions
- Discord.js bot development practices
- Comprehensive testing with Mocha/Chai/c8
- PM2 production deployment workflows

**Additional Resources**:
- MCP specification: https://modelcontextprotocol.io/
- Discord.js guide: https://discordjs.guide/
- Prisma documentation: https://www.prisma.io/docs

## Contributing

Improvements to template:
1. Keep it generic (works anywhere)
2. Keep it small (<10KB total)
3. Keep it universal (any LLM)
4. Test with different project types

## License

Public domain. Use anywhere.
