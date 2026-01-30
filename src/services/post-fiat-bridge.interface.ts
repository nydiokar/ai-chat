import { TaskWithRelations, TaskStatus, TaskPriority } from "../types/task.js";

export type PostFiatEventType =
  | "TASK_CREATED"
  | "TASK_ASSIGNED"
  | "TASK_STATUS_CHANGED"
  | "TASK_COMPLETED";

export interface PostFiatActor {
  // Actor identifiers should be stable and resolvable to a wallet or DID.
  actorId: string;
  displayName?: string;
}

export interface PostFiatTaskSnapshot {
  taskId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  creatorId: string;
  assigneeId?: string;
  createdAtEpochMs: number;
  updatedAtEpochMs: number;
  dueAtEpochMs?: number;
  completedAtEpochMs?: number;
  tags: string[];
  // Metadata should be serialized as canonical JSON bytes for protobuf storage.
  metadataJson?: string;
  parentTaskId?: string;
  conversationId?: string;
}

export interface PostFiatTaskEventPayload {
  eventId: string;
  taskId: string;
  eventType: PostFiatEventType;
  actor: PostFiatActor;
  occurredAtEpochMs: number;
  prevEventCid?: string;
  // Optional snapshot for creation/critical transitions.
  snapshot?: PostFiatTaskSnapshot;
  // Assignment/status change specific fields.
  assigneeId?: string;
  previousStatus?: TaskStatus;
  newStatus?: TaskStatus;
}

export interface PostFiatPublishResult {
  cid: string; // IPFS CID of the protobuf-serialized event
  signature: string; // Signature over the event bytes or CID
  chainReference?: string; // On-chain tx hash or reference
}

export interface PostFiatVerificationResult {
  verified: boolean;
  reason?: string;
  chainReference?: string;
}

export interface PostFiatBridge {
  // Convert local task data to a protobuf-compatible event payload.
  buildEventPayload(
    eventType: PostFiatEventType,
    task: TaskWithRelations,
    actorId: string,
    options?: {
      prevEventCid?: string;
      assigneeId?: string;
      previousStatus?: TaskStatus;
      newStatus?: TaskStatus;
      includeSnapshot?: boolean;
    },
  ): PostFiatTaskEventPayload;

  // Serialize, store to IPFS, sign, and optionally anchor on-chain.
  publishTaskEvent(
    payload: PostFiatTaskEventPayload,
  ): Promise<PostFiatPublishResult>;

  // Convenience helpers for common lifecycle hooks.
  publishTaskCreated(
    task: TaskWithRelations,
    actorId: string,
    prevEventCid?: string,
  ): Promise<PostFiatPublishResult>;

  publishTaskAssigned(
    task: TaskWithRelations,
    actorId: string,
    assigneeId: string,
    prevEventCid?: string,
  ): Promise<PostFiatPublishResult>;

  publishTaskCompleted(
    task: TaskWithRelations,
    actorId: string,
    prevEventCid?: string,
  ): Promise<PostFiatPublishResult>;

  // Verify a task completion event against chain + IPFS payload.
  verifyCompletion(
    taskId: string,
    completionCid: string,
  ): Promise<PostFiatVerificationResult>;
}
