/*
  Warnings:

  - You are about to alter the column `recurrencePattern` on the `Task` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "dueDate" DATETIME,
    "completedAt" DATETIME,
    "creatorId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "conversationId" INTEGER,
    "tags" JSONB NOT NULL,
    "metadata" JSONB,
    "parentTaskId" INTEGER,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurrencePattern" JSONB,
    "originalTaskId" INTEGER,
    CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_originalTaskId_fkey" FOREIGN KEY ("originalTaskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("assigneeId", "completedAt", "conversationId", "createdAt", "creatorId", "description", "dueDate", "id", "isRecurring", "metadata", "originalTaskId", "parentTaskId", "priority", "recurrencePattern", "status", "tags", "title", "updatedAt") SELECT "assigneeId", "completedAt", "conversationId", "createdAt", "creatorId", "description", "dueDate", "id", coalesce("isRecurring", false) AS "isRecurring", "metadata", "originalTaskId", "parentTaskId", "priority", "recurrencePattern", "status", "tags", "title", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_creatorId_idx" ON "Task"("creatorId");
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");
CREATE INDEX "Task_status_idx" ON "Task"("status");
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");
CREATE INDEX "Task_conversationId_idx" ON "Task"("conversationId");
CREATE INDEX "Task_isRecurring_idx" ON "Task"("isRecurring");
CREATE INDEX "Task_originalTaskId_idx" ON "Task"("originalTaskId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
