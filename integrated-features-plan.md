# Integrated Features Plan

## Current Features Available
- AI Chat capabilities (OpenAI/Anthropic)
- Discord integration
- Database persistence (Prisma/SQLite)
- Session management
- CLI and Discord interfaces

## New Features Priority List

### PRIORITY 1: MCP Integration (Technical Foundation)
- This needs to come first as it enhances the bot's capabilities for all other features
- Follow the plan from mcp-integration-plan.md
- Essential for improved context and tool usage

### PRIORITY 2: Task & Project Management
This builds on top of the MCP integration and provides immediate user value.

Database Schema:
```prisma
model Task {
  id          Int       @id @default(autoincrement())
  type        String    // PROJECT_TASK, REVIEW, REMINDER
  title       String
  description String?
  dueDate     DateTime?
  status      String    // PENDING, DONE
  tags        String?   // Comma-separated
  notes       String?   // Findings/results
  url         String?   // Optional resource link
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}
```

Commands:
```
!task add "Build website" --type project
!task add "Check GymXYZ" --type reminder --due "tomorrow"
!tasks list
!task 123 note "Found good equipment"
```

### PRIORITY 3: Reminder System
Simple but effective reminder system that works with tasks.

Features:
- Daily check for upcoming tasks
- Discord notifications for due items
- Basic recurrence (daily, weekly, monthly)

### PRIORITY 4: Context Storage & Retrieval
Leverage MCP for enhanced context storage and retrieval.

Features:
- Store project contexts
- Save review findings
- Search through past notes
- Link related tasks/contexts

## Implementation Order

1. Core MCP Integration
   - Basic configuration
   - Server connection handling
   - Tool registration

2. Task Management System
   - Database schema updates
   - Basic CRUD commands
   - Simple task queries

3. Reminder System
   - Due date tracking
   - Basic notifications
   - Recurrence handling

4. Enhanced Context Features
   - Context storage
   - Search capabilities
   - Relationship tracking

## Why This Order?

1. MCP provides the technical foundation for better tool integration and context handling
2. Task management gives immediate user value
3. Reminders enhance the task management
4. Context features build on all previous capabilities

## Development Approach
- Implement one priority at a time
- Test thoroughly before moving to next priority
- Keep features simple initially
- Add complexity only when needed

## Notes for Implementation
- Start with core functionality
- Add features incrementally
- Use MCP capabilities where they add value
- Keep the interface simple and intuitive
- Focus on reliability over features

Would you like me to focus on implementing any specific part first?