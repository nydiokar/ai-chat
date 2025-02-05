-- CreateTable
CREATE TABLE "Message" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "content" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversationId" INTEGER NOT NULL,
    "tokenCount" INTEGER,
    "discordUserId" TEXT,
    "discordUsername" TEXT,
    "parentMessageId" INTEGER,
    "contextId" TEXT,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Message_contextId_fkey" FOREIGN KEY ("contextId") REFERENCES "ConversationContext" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "model" TEXT NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "branchId" TEXT,
    "parentMessageId" TEXT,
    "discordChannelId" TEXT,
    "discordGuildId" TEXT
);

-- CreateTable
CREATE TABLE "Session" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversationId" INTEGER NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivity" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Session_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MCPServer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MCPTool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MCPTool_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "MCPServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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

-- CreateTable
CREATE TABLE "MCPToolUsage" (
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

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "preferences" JSONB
);

-- CreateTable
CREATE TABLE "TaskHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "taskId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cache_metrics" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "misses" INTEGER NOT NULL DEFAULT 0,
    "lastAccessed" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Task" (
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
    CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConversationContext" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" INTEGER NOT NULL,
    "topics" JSONB NOT NULL,
    "entities" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationContext_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EntityRelationship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "strength" REAL NOT NULL,
    "lastUpdated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CommandUsagePattern" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "commandName" TEXT NOT NULL,
    "frequency" INTEGER NOT NULL DEFAULT 0,
    "lastUsed" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "successRate" REAL NOT NULL DEFAULT 0,
    "contexts" JSONB NOT NULL,
    CONSTRAINT "CommandUsagePattern_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserMemoryPreferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "lastUpdated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserMemoryPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_discordUserId_idx" ON "Message"("discordUserId");

-- CreateIndex
CREATE INDEX "Message_parentMessageId_idx" ON "Message"("parentMessageId");

-- CreateIndex
CREATE INDEX "Message_contextId_idx" ON "Message"("contextId");

-- CreateIndex
CREATE INDEX "Conversation_createdAt_idx" ON "Conversation"("createdAt");

-- CreateIndex
CREATE INDEX "Conversation_branchId_idx" ON "Conversation"("branchId");

-- CreateIndex
CREATE INDEX "Conversation_parentMessageId_idx" ON "Conversation"("parentMessageId");

-- CreateIndex
CREATE INDEX "Conversation_discordGuildId_discordChannelId_idx" ON "Conversation"("discordGuildId", "discordChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_conversationId_key" ON "Session"("conversationId");

-- CreateIndex
CREATE INDEX "Session_discordUserId_idx" ON "Session"("discordUserId");

-- CreateIndex
CREATE INDEX "Session_lastActivity_idx" ON "Session"("lastActivity");

-- CreateIndex
CREATE INDEX "MCPTool_serverId_idx" ON "MCPTool"("serverId");

-- CreateIndex
CREATE UNIQUE INDEX "MCPTool_serverId_name_key" ON "MCPTool"("serverId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MCPToolContext_toolId_key" ON "MCPToolContext"("toolId");

-- CreateIndex
CREATE INDEX "MCPToolContext_toolId_idx" ON "MCPToolContext"("toolId");

-- CreateIndex
CREATE INDEX "MCPToolUsage_toolId_idx" ON "MCPToolUsage"("toolId");

-- CreateIndex
CREATE INDEX "MCPToolUsage_conversationId_idx" ON "MCPToolUsage"("conversationId");

-- CreateIndex
CREATE INDEX "MCPToolUsage_createdAt_idx" ON "MCPToolUsage"("createdAt");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE INDEX "TaskHistory_taskId_idx" ON "TaskHistory"("taskId");

-- CreateIndex
CREATE INDEX "TaskHistory_userId_idx" ON "TaskHistory"("userId");

-- CreateIndex
CREATE INDEX "TaskHistory_createdAt_idx" ON "TaskHistory"("createdAt");

-- CreateIndex
CREATE INDEX "cache_metrics_hits_idx" ON "cache_metrics"("hits");

-- CreateIndex
CREATE INDEX "cache_metrics_lastAccessed_idx" ON "cache_metrics"("lastAccessed");

-- CreateIndex
CREATE INDEX "Task_creatorId_idx" ON "Task"("creatorId");

-- CreateIndex
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");

-- CreateIndex
CREATE INDEX "Task_conversationId_idx" ON "Task"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationContext_conversationId_idx" ON "ConversationContext"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationContext_timestamp_idx" ON "ConversationContext"("timestamp");

-- CreateIndex
CREATE INDEX "EntityRelationship_sourceId_idx" ON "EntityRelationship"("sourceId");

-- CreateIndex
CREATE INDEX "EntityRelationship_targetId_idx" ON "EntityRelationship"("targetId");

-- CreateIndex
CREATE INDEX "EntityRelationship_lastUpdated_idx" ON "EntityRelationship"("lastUpdated");

-- CreateIndex
CREATE UNIQUE INDEX "EntityRelationship_sourceId_targetId_relationType_key" ON "EntityRelationship"("sourceId", "targetId", "relationType");

-- CreateIndex
CREATE INDEX "CommandUsagePattern_userId_idx" ON "CommandUsagePattern"("userId");

-- CreateIndex
CREATE INDEX "CommandUsagePattern_lastUsed_idx" ON "CommandUsagePattern"("lastUsed");

-- CreateIndex
CREATE INDEX "CommandUsagePattern_frequency_idx" ON "CommandUsagePattern"("frequency");

-- CreateIndex
CREATE UNIQUE INDEX "CommandUsagePattern_userId_commandName_key" ON "CommandUsagePattern"("userId", "commandName");

-- CreateIndex
CREATE UNIQUE INDEX "UserMemoryPreferences_userId_key" ON "UserMemoryPreferences"("userId");

-- CreateIndex
CREATE INDEX "UserMemoryPreferences_lastUpdated_idx" ON "UserMemoryPreferences"("lastUpdated");
