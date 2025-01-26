/*
  Warnings:

  - You are about to drop the `MCPTool` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "MCPTool";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MCPToolUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "toolId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "input" JSONB,
    "output" TEXT,
    "duration" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversationId" INTEGER,
    CONSTRAINT "MCPToolUsage_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "MCPServer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MCPToolUsage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MCPToolUsage" ("conversationId", "createdAt", "error", "id", "serverId", "success", "toolId") SELECT "conversationId", "createdAt", "error", "id", "serverId", "success", "toolId" FROM "MCPToolUsage";
DROP TABLE "MCPToolUsage";
ALTER TABLE "new_MCPToolUsage" RENAME TO "MCPToolUsage";
CREATE INDEX "MCPToolUsage_toolId_idx" ON "MCPToolUsage"("toolId");
CREATE INDEX "MCPToolUsage_serverId_idx" ON "MCPToolUsage"("serverId");
CREATE INDEX "MCPToolUsage_createdAt_idx" ON "MCPToolUsage"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
