-- Create Tool table
CREATE TABLE "Tool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "toolType" TEXT NOT NULL,
    "metadata" JSON,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "mcpToolId" TEXT
);

-- Create indexes for Tool
CREATE INDEX "Tool_toolType_idx" ON "Tool"("toolType");
CREATE INDEX "Tool_createdAt_idx" ON "Tool"("createdAt");

-- Modify MCPTool to include tool reference
ALTER TABLE "MCPTool" ADD COLUMN "toolId" TEXT;

-- Create ToolUsage table
CREATE TABLE "ToolUsage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "toolId" TEXT NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "input" JSON,
    "output" TEXT,
    "error" TEXT,
    "duration" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Create indexes for ToolUsage
CREATE INDEX "ToolUsage_toolId_idx" ON "ToolUsage"("toolId");
CREATE INDEX "ToolUsage_conversationId_idx" ON "ToolUsage"("conversationId");
CREATE INDEX "ToolUsage_createdAt_idx" ON "ToolUsage"("createdAt");
