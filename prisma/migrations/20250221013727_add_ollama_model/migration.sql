-- First create a new table with the constraint
CREATE TABLE "new_Conversation" (
    "id" INTEGER NOT NULL PRIMARY KEY,
    "model" TEXT NOT NULL CHECK (model IN ('gpt', 'claude', 'deepseek', 'ollama')),
    "title" TEXT,
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "discordChannelId" TEXT,
    "discordGuildId" TEXT
);

-- Copy data from the old table
INSERT INTO "new_Conversation" SELECT * FROM "Conversation";

-- Drop the old table
DROP TABLE "Conversation";

-- Rename the new table to the original name
ALTER TABLE "new_Conversation" RENAME TO "Conversation";

-- Recreate indexes
CREATE INDEX "Conversation_createdAt_idx" ON "Conversation"("createdAt");
CREATE INDEX "Conversation_discordGuildId_discordChannelId_idx" ON "Conversation"("discordGuildId", "discordChannelId");
