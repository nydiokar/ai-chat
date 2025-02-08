export enum TaskStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  BLOCKED = 'BLOCKED'
}

export enum TaskPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT'
}

export enum TaskHistoryAction {
  CREATED = 'CREATED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  ASSIGNED = 'ASSIGNED',
  UNASSIGNED = 'UNASSIGNED',
  UPDATED = 'UPDATED',
  DELETED = 'DELETED',
  SPAWN = 'SPAWN'
}

export enum RecurrenceType {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  CUSTOM = 'CUSTOM'
}

export interface RecurrencePattern {
  type: RecurrenceType;
  interval: number; // 1 for daily, 2 for every other day, etc.
  daysOfWeek?: number[]; // 0-6 for weekly recurrence
  dayOfMonth?: number; // 1-31 for monthly recurrence
  endDate?: Date;
  endAfterOccurrences?: number;
  customPattern?: string; // For custom cron-like patterns
}

export interface User {
  id: string;
  username: string;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
  preferences?: Record<string, any>;
}

export interface TaskHistory {
  id: number;
  taskId: number;
  userId: string;
  action: TaskHistoryAction;
  oldValue?: string;
  newValue?: string;
  note?: string;
  createdAt: Date;
  user: User;
}

export interface TaskHistoryEntry {
  taskId: number;
  userId: string;
  action: TaskHistoryAction;
  oldValue?: string;
  newValue?: string;
  note?: string;
}

export interface TaskDependency {
  id: number;
  blockedTaskId: number;
  blockerTaskId: number;
  dependencyType: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  // Optional populated task data
  blockedTask?: Task;
  blockerTask?: Task;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: Date;
  updatedAt: Date;
  dueDate?: Date;
  completedAt?: Date;
  creatorId: string;
  assigneeId?: string;
  conversationId?: number;
  tags: Record<string, any>;
  metadata?: Record<string, any>;
  parentTaskId?: number;
  isRecurring?: boolean;
  recurrencePattern?: RecurrencePattern;
  originalTaskId?: number; // For recurring task instances, points to the template task
}

export interface TaskWithRelations extends Task {
  creator: User;
  assignee?: User;
  subTasks: Task[];
  parentTask?: Task;
  history: TaskHistory[];
  recurringInstances?: Task[]; // Only populated for template tasks
  blockedBy: TaskDependency[]; // Tasks that block this task
  blocking: TaskDependency[]; // Tasks that this task blocks
}

export enum DependencyType {
  BLOCKS = 'BLOCKS',        // Complete blocker - task cannot start until blocker is done
  REQUIRED = 'REQUIRED',    // Required but can be worked on in parallel
  RELATED = 'RELATED',     // Informational relationship only
  SEQUENTIAL = 'SEQUENTIAL', // Must be completed in sequence
  PARALLEL = 'PARALLEL'     // Can be worked on simultaneously
}

export interface CreateTaskDTO {
  title: string;
  description: string;
  creatorId: string;
  priority?: TaskPriority;
  dueDate?: Date;
  assigneeId?: string;
  conversationId?: number;
  tags?: string[];
  metadata?: Record<string, any>;
  parentTaskId?: number;
  isRecurring?: boolean;
  recurrencePattern?: RecurrencePattern;
  dependencies?: {
    blockerTaskIds: number[];
    dependencyType?: DependencyType;
    metadata?: Record<string, any>;
  };
}

export interface UpdateTaskDTO {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: Date;
  assigneeId?: string;
  tags?: string[];
  metadata?: Record<string, any>;
  recurrencePattern?: RecurrencePattern;
}

export interface TaskFilters {
  creatorId?: string;
  assigneeId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  isRecurring?: boolean;
  limit?: number;
  offset?: number;
  parentTaskId?: number;
}

export interface TaskListResult {
  tasks: TaskWithRelations[];
  total: number;
}

export interface UserTasks {
  created: TaskWithRelations[];
  assigned: TaskWithRelations[];
}
