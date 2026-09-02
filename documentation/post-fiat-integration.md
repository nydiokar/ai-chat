# Post Fiat Integration (Architectural Draft)

## Goal
Bridge the local AI Task Manager with the Post Fiat protocol so task creation, assignment, and completion can be verified on-chain. The core idea is to publish **immutable task events** to IPFS using Protobuf, then anchor their CIDs and signatures on-chain.

## Lifecycle Hooks (Current Code)
Primary lifecycle points are in `src/features/tasks/task-manager.ts`:
- `createTask(...)` -> Task Created
- `assignTask(...)` -> Task Assigned
- `updateTaskStatus(...)` -> Task Status Changed (Completed is a critical subtype)

These methods are the right integration points for emitting on-chain events once a bridge is implemented.

## Protobuf-Compatible Schema (Draft)
The local Task object is **not** directly serializable because of JSON fields (`tags`, `metadata`) and optional nested structures. The following Protobuf schema maps only what is needed for verifiable events and stores dynamic metadata as canonical JSON bytes.

```proto
syntax = "proto3";
package postfiat.task;

message Actor {
  string actor_id = 1;       // wallet or DID
  string display_name = 2;   // optional
}

message TaskSnapshot {
  string task_id = 1;
  string title = 2;
  string description = 3;
  string status = 4;         // TaskStatus
  string priority = 5;       // TaskPriority
  string creator_id = 6;
  string assignee_id = 7;    // optional
  int64 created_at_ms = 8;
  int64 updated_at_ms = 9;
  int64 due_at_ms = 10;      // optional
  int64 completed_at_ms = 11;// optional
  repeated string tags = 12;
  bytes metadata_json = 13;  // canonical JSON
  string parent_task_id = 14;// optional
  string conversation_id = 15;// optional
}

message TaskEvent {
  string event_id = 1;
  string task_id = 2;
  string event_type = 3;     // TASK_CREATED, TASK_ASSIGNED, TASK_STATUS_CHANGED, TASK_COMPLETED
  Actor actor = 4;
  int64 occurred_at_ms = 5;
  string prev_event_cid = 6; // optional
  TaskSnapshot snapshot = 7; // optional for creation/completion
  string assignee_id = 8;    // optional for assign
  string previous_status = 9;
  string new_status = 10;
}
```

### Mapping from Local Task -> Protobuf Snapshot
| Local Field | Proto Field | Notes |
| --- | --- | --- |
| `id` | `task_id` | Serialize as string for portability |
| `title` | `title` | Direct |
| `description` | `description` | Direct |
| `status` | `status` | Enum serialized as string |
| `priority` | `priority` | Enum serialized as string |
| `creatorId` | `creator_id` | Direct |
| `assigneeId` | `assignee_id` | Optional |
| `createdAt` | `created_at_ms` | Epoch ms UTC |
| `updatedAt` | `updated_at_ms` | Epoch ms UTC |
| `dueDate` | `due_at_ms` | Optional |
| `completedAt` | `completed_at_ms` | Optional |
| `tags` | `tags` | Normalize to string array |
| `metadata` | `metadata_json` | Canonical JSON bytes |
| `parentTaskId` | `parent_task_id` | Optional |
| `conversationId` | `conversation_id` | Optional |

## Data Flow (Discord -> DB -> Post Fiat)
1) **Discord Command** triggers task lifecycle methods in `TaskManager`.
2) **TaskManager** persists changes in Prisma (local DB) and adds history.
3) **PostFiatBridge** builds `TaskEvent` payload from the updated task + actor.
4) **Serialize Protobuf** with deterministic option.
5) **Publish to IPFS** to obtain CID.
6) **Sign CID or bytes** with actor’s key.
7) **Anchor on-chain**: record `{ cid, event_type, signer }` in Post Fiat protocol.

## Operational Notes
- Favor **event-based** storage for verification. A snapshot is optional and can be attached to creation/completion events.
- JSON fields (`metadata`) must be canonicalized (stable ordering) before converting to `bytes`.
- `tags` must be normalized to a string array in DB and bridge (current code uses JSON).

## Deliverables in This Proposal
- `src/services/post-fiat-bridge.interface.ts` defines event payloads and bridge API.
- This document specifies mapping and data flow for implementation.
