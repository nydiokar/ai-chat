-- Add new indexes for common query patterns
CREATE INDEX "Message_role_createdAt_idx" ON "Message"("role", "createdAt");
CREATE INDEX "Message_createdAt_role_idx" ON "Message"("createdAt", "role");
CREATE INDEX "Conversation_model_createdAt_idx" ON "Conversation"("model", "createdAt");
CREATE INDEX "Session_isActive_lastActivity_idx" ON "Session"("isActive", "lastActivity");

-- Create QueryMetrics table for analyzing query patterns
CREATE TABLE "QueryMetrics" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "queryHash" TEXT NOT NULL,
    "queryString" TEXT NOT NULL,
    "executionTime" INTEGER NOT NULL,
    "rowCount" INTEGER,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Add indexes for QueryMetrics
CREATE UNIQUE INDEX "QueryMetrics_queryHash_key" ON "QueryMetrics"("queryHash");
CREATE INDEX "QueryMetrics_executionTime_idx" ON "QueryMetrics"("executionTime");
CREATE INDEX "QueryMetrics_timestamp_idx" ON "QueryMetrics"("timestamp");
