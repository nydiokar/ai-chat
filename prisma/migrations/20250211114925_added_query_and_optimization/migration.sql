/*
  Warnings:

  - You are about to drop the `MCPToolUsage` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `mcpToolId` on the `Tool` table. All the data in the column will be lost.
  - You are about to alter the column `metadata` on the `Tool` table. The data in that column could be lost. The data in that column will be cast from `Unsupported("json")` to `Json`.
  - You are about to alter the column `input` on the `ToolUsage` table. The data in that column could be lost. The data in that column will be cast from `Unsupported("json")` to `Json`.

*/
-- DropIndex
DROP INDEX "Conversation_model_createdAt_idx";

-- DropIndex
DROP INDEX "MCPToolUsage_createdAt_idx";

-- DropIndex
DROP INDEX "MCPToolUsage_conversationId_idx";

-- DropIndex
DROP INDEX "MCPToolUsage_toolId_idx";

-- DropIndex
DROP INDEX "Message_createdAt_role_idx";

-- DropIndex
DROP INDEX "Message_role_createdAt_idx";

-- DropIndex
DROP INDEX "Session_isActive_lastActivity_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "MCPToolUsage";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "PerformanceMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "timestamp" DATETIME NOT NULL,
    "cpuUsage" REAL NOT NULL,
    "memoryTotal" BIGINT NOT NULL,
    "memoryFree" BIGINT NOT NULL,
    "totalToolCalls" INTEGER NOT NULL,
    "toolSuccessRate" REAL NOT NULL,
    "averageQueryTime" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MCPTool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "toolId" TEXT,
    CONSTRAINT "MCPTool_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "MCPServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MCPTool_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MCPTool" ("createdAt", "description", "id", "isEnabled", "name", "serverId", "toolId", "updatedAt") SELECT "createdAt", "description", "id", "isEnabled", "name", "serverId", "toolId", "updatedAt" FROM "MCPTool";
DROP TABLE "MCPTool";
ALTER TABLE "new_MCPTool" RENAME TO "MCPTool";
CREATE UNIQUE INDEX "MCPTool_toolId_key" ON "MCPTool"("toolId");
CREATE INDEX "MCPTool_serverId_idx" ON "MCPTool"("serverId");
CREATE UNIQUE INDEX "MCPTool_serverId_name_key" ON "MCPTool"("serverId", "name");
CREATE TABLE "new_Tool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "toolType" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Tool" ("createdAt", "description", "id", "metadata", "name", "toolType", "updatedAt") SELECT "createdAt", "description", "id", "metadata", "name", "toolType", "updatedAt" FROM "Tool";
DROP TABLE "Tool";
ALTER TABLE "new_Tool" RENAME TO "Tool";
CREATE INDEX "Tool_toolType_idx" ON "Tool"("toolType");
CREATE INDEX "Tool_createdAt_idx" ON "Tool"("createdAt");
CREATE TABLE "new_ToolUsage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "toolId" TEXT NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "input" JSONB,
    "output" TEXT,
    "error" TEXT,
    "duration" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mcpToolId" TEXT,
    CONSTRAINT "ToolUsage_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ToolUsage_mcpToolId_fkey" FOREIGN KEY ("mcpToolId") REFERENCES "MCPTool" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ToolUsage" ("conversationId", "createdAt", "duration", "error", "id", "input", "output", "status", "toolId") SELECT "conversationId", "createdAt", "duration", "error", "id", "input", "output", "status", "toolId" FROM "ToolUsage";
DROP TABLE "ToolUsage";
ALTER TABLE "new_ToolUsage" RENAME TO "ToolUsage";
CREATE INDEX "ToolUsage_toolId_idx" ON "ToolUsage"("toolId");
CREATE INDEX "ToolUsage_conversationId_idx" ON "ToolUsage"("conversationId");
CREATE INDEX "ToolUsage_createdAt_idx" ON "ToolUsage"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
