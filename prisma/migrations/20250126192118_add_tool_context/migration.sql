-- CreateTable
CREATE TABLE "MCPToolContext" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "toolId" TEXT NOT NULL,
    "contextData" JSONB NOT NULL,
    "lastRefreshed" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refreshCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MCPToolContext_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "MCPTool" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MCPToolContext_toolId_key" ON "MCPToolContext"("toolId");

-- CreateIndex
CREATE INDEX "MCPToolContext_toolId_idx" ON "MCPToolContext"("toolId");
