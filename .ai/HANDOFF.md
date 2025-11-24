# Session Handoff Protocol

---

## Starting a Session

### First Time
```
Read .ai/ folder for context, then begin work as outlined in GUIDE.md.
```

### Continuing Work
```
Read .ai/CONTEXT.md for current state, then continue from the next incomplete task.
```

---

## Ending a Session

1. **Update CONTEXT.md**:
   - Mark completed tasks `[x]`
   - Update "Active" section
   - Add blockers if any
   - Update timestamp
   - Update "Updated By"

2. **Commit**:
   ```bash
   # Ensure tests pass before committing
   npm test

   # Add changes
   git add .ai/CONTEXT.md [and other changed files]
   git commit -m "feat: brief description of work done"
   ```

   **For Kanebra project**: Always run tests before committing, use conventional commit format (feat, fix, docs, test, refactor)

3. **Summarize for User**:
   - What was completed
   - What's next
   - Any issues or blockers

---

## Handoff Between Agents

**Outgoing**:
- Complete current task if possible
- Update CONTEXT.md thoroughly
- Commit changes

**Incoming**:
- Read CONTEXT.md
- Continue from last task
- Update "Updated By"

---

## Recovery

### If Context is Unclear
1. Check git history: `git log --oneline -10`
2. Verify actual state: `ls -la`, `git status`
3. Check if database migrations are up to date: `npm run db:sync`
4. Verify environment configuration: check .env file
5. Update CONTEXT.md to reflect reality
6. Ask user if uncertain

### Kanebra-Specific Recovery
- **Database issues**: Run `npm run db:migrate:dev` and `npm run db:generate:dev`
- **Dependencies**: Run `npm install` and `npm run prisma:generate`
- **Environment**: Copy `.env.example` to `.env` and fill in API keys
- **Tests failing**: Run `npm run db:sync` to ensure test database is ready

---

**Keep CONTEXT.md updated and handoffs will be smooth.**

### Kanebra Development Tips
- Always test Discord bot functionality after changes
- Verify MCP tool registration works correctly
- Check AI service integrations with different providers
- Ensure database schema changes are properly migrated
- Test with both development and production configurations
