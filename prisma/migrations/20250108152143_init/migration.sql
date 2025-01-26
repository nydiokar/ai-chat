-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "discordChannelId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "discordGuildId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "discordUserId" TEXT;
ALTER TABLE "Message" ADD COLUMN "discordUsername" TEXT;

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

-- CreateIndex
CREATE UNIQUE INDEX "Session_conversationId_key" ON "Session"("conversationId");

-- CreateIndex
CREATE INDEX "Session_discordUserId_idx" ON "Session"("discordUserId");

-- CreateIndex
CREATE INDEX "Session_lastActivity_idx" ON "Session"("lastActivity");

-- CreateIndex
CREATE INDEX "Conversation_discordGuildId_discordChannelId_idx" ON "Conversation"("discordGuildId", "discordChannelId");

-- CreateIndex
CREATE INDEX "Message_discordUserId_idx" ON "Message"("discordUserId");
