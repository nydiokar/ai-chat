# Task Management System

## Overview

Kanebra's task management system provides advanced scheduling, dependency tracking, and collaborative task coordination with Discord integration.

## Core Features

### Task Lifecycle Management
- Task creation, assignment, and tracking
- Status progression (Open → In Progress → Completed)
- Priority levels and due dates
- Task history and audit trails

### Advanced Scheduling
- Recurring task patterns (daily, weekly, monthly)
- Cron-like custom scheduling
- Task dependencies and blocking relationships
- Automatic task spawning and chaining

### Collaboration Features
- Multi-user task assignment
- Task comments and discussion
- Progress visualization
- Notification system for updates

## Architecture

### Service Components

```typescript
// Core task management
class TaskManager {
  async createTask(taskData: TaskInput): Promise<Task>
  async updateTask(id: number, updates: Partial<Task>): Promise<Task>
  async assignTask(taskId: number, userId: string): Promise<void>
  async completeTask(taskId: number): Promise<void>
}

// Dependency management
class TaskDependencyService {
  async addDependency(taskId: number, dependsOnId: number): Promise<void>
  async resolveDependencies(taskId: number): Promise<Task[]>
  async detectCircularDependencies(taskIds: number[]): Promise<boolean>
}

// Scheduling system
class RecurrencePatternService {
  async scheduleNextOccurrence(task: Task): Promise<Date>
  async generateOccurrences(pattern: RecurrencePattern, limit: number): Promise<Date[]>
}
```

### Data Structures

```typescript
interface Task {
  id: number;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: Date;
  updatedAt: Date;
  dueDate?: Date;
  assigneeId?: string;
  creatorId: string;
  estimatedHours?: number;
  actualHours?: number;
  tags?: string[];
  metadata?: Record<string, any>;
  recurrence?: RecurrencePattern;
  parentTaskId?: number;
  dependencies: TaskDependency[];
  subtasks: Task[];
  history: TaskHistory[];
}

enum TaskStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  BLOCKED = 'BLOCKED'
}

interface RecurrencePattern {
  type: RecurrenceType;
  interval: number;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  endDate?: Date;
  endAfterOccurrences?: number;
  customPattern?: string;
}
```

## Discord Commands

### Task Management Commands

**Basic Task Operations**:
```
/task create "Fix login bug" --priority high --due 2025-12-01
/task list --status open --assignee @user
/task update 123 --status in-progress
/task complete 123
/task delete 123
```

**Advanced Features**:
```
/task assign 123 @user
/task depend 123 on 122    # Make task 123 depend on 122
/task recurring "Daily backup" --pattern "0 2 * * *" --type custom
/task progress 123 75      # Set progress to 75%
/task comment 123 "Started working on this"
```

**Query and Reporting**:
```
/tasks due today
/tasks overdue
/tasks by @user
/task stats              # Show productivity statistics
/task visualize 123      # Show task dependency graph
```

## Database Schema

### Core Tables
```sql
-- Main task table
CREATE TABLE Task (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status TaskStatus DEFAULT 'OPEN',
  priority TaskPriority DEFAULT 'MEDIUM',
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW(),
  dueDate TIMESTAMP,
  assigneeId VARCHAR(20),
  creatorId VARCHAR(20) NOT NULL,
  estimatedHours DECIMAL(6,2),
  actualHours DECIMAL(6,2),
  tags TEXT[],
  metadata JSONB,
  recurrence JSONB,
  parentTaskId INTEGER REFERENCES Task(id)
);

-- Task dependencies
CREATE TABLE TaskDependency (
  id SERIAL PRIMARY KEY,
  taskId INTEGER REFERENCES Task(id) ON DELETE CASCADE,
  dependsOnId INTEGER REFERENCES Task(id) ON DELETE CASCADE,
  createdAt TIMESTAMP DEFAULT NOW(),
  UNIQUE(taskId, dependsOnId)
);

-- Task history/audit
CREATE TABLE TaskHistory (
  id SERIAL PRIMARY KEY,
  taskId INTEGER REFERENCES Task(id) ON DELETE CASCADE,
  action TaskHistoryAction NOT NULL,
  oldValues JSONB,
  newValues JSONB,
  userId VARCHAR(20),
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Recurring task instances
CREATE TABLE TaskInstance (
  id SERIAL PRIMARY KEY,
  parentTaskId INTEGER REFERENCES Task(id) ON DELETE CASCADE,
  scheduledDate TIMESTAMP NOT NULL,
  completedDate TIMESTAMP,
  createdAt TIMESTAMP DEFAULT NOW()
);
```

## Dependency Management

### Dependency Types
- **Finish-to-Start**: Task B starts after Task A completes
- **Start-to-Start**: Task B starts when Task A starts
- **Finish-to-Finish**: Task B finishes when Task A finishes
- **Start-to-Finish**: Task B finishes when Task A starts

### Circular Dependency Prevention
```typescript
class DependencyValidator {
  async validateDependencies(taskId: number, newDependencies: number[]): Promise<boolean> {
    const graph = await this.buildDependencyGraph(taskId);
    return !this.hasCycle(graph, newDependencies);
  }

  private hasCycle(graph: Map<number, number[]>, newEdges: number[]): boolean {
    // Implement cycle detection using DFS or topological sort
  }
}
```

## Scheduling System

### Recurrence Patterns

**Simple Patterns**:
```typescript
const dailyBackup = {
  type: RecurrenceType.DAILY,
  interval: 1  // Every day
};

const weeklyReport = {
  type: RecurrenceType.WEEKLY,
  interval: 1,  // Every week
  daysOfWeek: [1]  // Monday
};
```

**Custom Cron Patterns**:
```typescript
const customSchedule = {
  type: RecurrenceType.CUSTOM,
  customPattern: "0 9 * * 1-5"  // 9 AM weekdays
};
```

### Task Spawning
```typescript
class TaskSpawningService {
  async spawnRecurringTasks(): Promise<void> {
    const dueTasks = await this.getDueRecurringTasks();

    for (const task of dueTasks) {
      const nextOccurrence = await this.calculateNextOccurrence(task);
      await this.createTaskInstance(task, nextOccurrence);
    }
  }
}
```

## Notification System

### Notification Types
- Task assignment notifications
- Due date reminders
- Dependency blocking alerts
- Completion celebrations

### Delivery Channels
- Discord direct messages
- Channel mentions
- Scheduled reminders

```typescript
class TaskNotificationService {
  async notifyTaskAssigned(task: Task, assigneeId: string): Promise<void> {
    const message = `You've been assigned: **${task.title}**`;
    await this.discordService.sendDM(assigneeId, message);
  }

  async sendDueDateReminder(task: Task): Promise<void> {
    const hoursUntilDue = this.calculateHoursUntilDue(task.dueDate);
    if (hoursUntilDue <= 24) {
      const message = `Task **${task.title}** is due in ${hoursUntilDue} hours`;
      await this.notifyAssignee(task, message);
    }
  }
}
```

## Visualization Features

### Dependency Graph Visualization
```typescript
class TaskVisualizationService {
  async generateDependencyGraph(taskId: number): Promise<string> {
    const dependencies = await this.getDependencyTree(taskId);
    return this.renderMermaidGraph(dependencies);
  }

  private renderMermaidGraph(tree: DependencyTree): string {
    // Generate Mermaid.js flowchart syntax
    return `graph TD
      A[Task A] --> B[Task B]
      B --> C[Task C]`;
  }
}
```

### Progress Tracking
- Task completion percentages
- Burndown charts
- Time tracking and estimation
- Productivity analytics

## Configuration

### Environment Variables
```env
# Task system settings
TASKS_ENABLED=true
MAX_TASKS_PER_USER=100
DEFAULT_DUE_DATE_DAYS=7

# Notification settings
TASK_NOTIFICATIONS_ENABLED=true
REMINDER_INTERVAL_HOURS=24
NOTIFICATION_COOLDOWN_MINUTES=60

# Scheduling settings
TASK_SCHEDULER_ENABLED=true
SCHEDULER_CHECK_INTERVAL_MINUTES=5
MAX_RECURRING_INSTANCES=1000
```

## Performance Optimization

### Indexing Strategy
```sql
-- Performance indexes
CREATE INDEX idx_task_status ON Task(status);
CREATE INDEX idx_task_assignee ON Task(assigneeId);
CREATE INDEX idx_task_due_date ON Task(dueDate);
CREATE INDEX idx_task_creator ON Task(creatorId);
CREATE INDEX idx_task_dependency_task ON TaskDependency(taskId);
CREATE INDEX idx_task_dependency_depends ON TaskDependency(dependsOnId);
```

### Query Optimization
- Efficient dependency resolution algorithms
- Cached user task lists
- Paginated result sets for large queries

## Security and Permissions

### Access Control
- Task creator permissions
- Assignee permissions
- Viewer permissions for team tasks

### Data Validation
- Input sanitization for task content
- SQL injection prevention
- XSS protection for web interfaces

## Testing Strategy

### Unit Tests
```typescript
describe('TaskManager', () => {
  it('should create task with valid data', async () => {
    const taskData = { title: 'Test Task', creatorId: '123' };
    const task = await taskManager.createTask(taskData);
    expect(task.title).to.equal('Test Task');
  });

  it('should prevent circular dependencies', async () => {
    // Test circular dependency detection
  });
});
```

### Integration Tests
- End-to-end task lifecycle testing
- Discord command integration
- Database consistency verification
- Notification delivery testing

## Monitoring and Analytics

### Key Metrics
- Task completion rates
- Average task duration
- Dependency complexity analysis
- User productivity trends

### Performance Monitoring
- Query execution times
- Notification delivery rates
- Scheduler performance
- Database connection pooling

## Future Enhancements

### Planned Features
- **Kanban Board**: Visual task management
- **Time Tracking**: Detailed time logging
- **Resource Allocation**: Team capacity planning
- **Integration APIs**: External system integration
- **Mobile App**: Native mobile task management

### Advanced Scheduling
- **Calendar Integration**: Google Calendar sync
- **Smart Scheduling**: AI-powered task timing
- **Resource Conflicts**: Automatic conflict resolution
- **Predictive Estimation**: ML-based time estimation

## Troubleshooting

### Common Issues

**Tasks Not Appearing**:
- Check database connectivity
- Verify user permissions
- Review task creation logs

**Notifications Not Sending**:
- Check Discord bot permissions
- Verify notification settings
- Review error logs

**Scheduling Not Working**:
- Check scheduler service status
- Verify cron patterns
- Review scheduling logs

### Debug Commands

```bash
# Test task creation
npm run tasks:test-create

# Check scheduler status
npm run tasks:scheduler-status

# View dependency graph
npm run tasks:visualize 123

# Monitor notifications
npm run tasks:notification-logs
```
