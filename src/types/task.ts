
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
  DELETED = 'DELETED'
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
}

export interface TaskWithRelations extends Task {
  creator: User;
  assignee?: User;
  subTasks: Task[];
  parentTask?: Task;
  history: TaskHistory[];
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
}

export interface TaskFilters {
  creatorId?: string;
  assigneeId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  limit?: number;
  offset?: number;
}

export interface TaskListResult {
  tasks: TaskWithRelations[];
  total: number;
}

export interface UserTasks {
  created: TaskWithRelations[];
  assigned: TaskWithRelations[];
}
