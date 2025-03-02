/*
  Warnings:

  - Made the column `mcpToolId` on table `ToolUsage` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ToolUsage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "toolId" TEXT,
    "conversationId" INTEGER NOT NULL,
    "input" JSONB,
    "output" TEXT,
    "error" TEXT,
    "duration" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mcpToolId" TEXT NOT NULL,
    CONSTRAINT "ToolUsage_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ToolUsage_mcpToolId_fkey" FOREIGN KEY ("mcpToolId") REFERENCES "MCPTool" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ToolUsage" ("conversationId", "createdAt", "duration", "error", "id", "input", "mcpToolId", "output", "status", "toolId") SELECT "conversationId", "createdAt", "duration", "error", "id", "input", "mcpToolId", "output", "status", "toolId" FROM "ToolUsage";
DROP TABLE "ToolUsage";
ALTER TABLE "new_ToolUsage" RENAME TO "ToolUsage";
CREATE INDEX "ToolUsage_toolId_idx" ON "ToolUsage"("toolId");
CREATE INDEX "ToolUsage_conversationId_idx" ON "ToolUsage"("conversationId");
CREATE INDEX "ToolUsage_createdAt_idx" ON "ToolUsage"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
