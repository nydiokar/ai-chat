-- CreateTable
CREATE TABLE "MCPTool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MCPTool_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "mCPServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MCPToolUsage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "toolId" TEXT NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "input" JSONB,
    "output" TEXT,
    "error" TEXT,
    "duration" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MCPToolUsage_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "MCPTool" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_MCPToolUsage" ("conversationId", "createdAt", "duration", "error", "id", "input", "output", "status", "toolId") SELECT "conversationId", "createdAt", "duration", "error", "id", "input", "output", "status", "toolId" FROM "MCPToolUsage";
DROP TABLE "MCPToolUsage";
ALTER TABLE "new_MCPToolUsage" RENAME TO "MCPToolUsage";
CREATE INDEX "MCPToolUsage_toolId_idx" ON "MCPToolUsage"("toolId");
CREATE INDEX "MCPToolUsage_conversationId_idx" ON "MCPToolUsage"("conversationId");
CREATE INDEX "MCPToolUsage_createdAt_idx" ON "MCPToolUsage"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "MCPTool_serverId_idx" ON "MCPTool"("serverId");

-- CreateIndex
CREATE UNIQUE INDEX "MCPTool_serverId_name_key" ON "MCPTool"("serverId", "name");
