/*
  Warnings:

  - You are about to drop the `CacheMetrics` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "CacheMetrics_lastAccessed_idx";

-- DropIndex
DROP INDEX "CacheMetrics_hits_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "CacheMetrics";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "cache_metrics" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "misses" INTEGER NOT NULL DEFAULT 0,
    "lastAccessed" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Message" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "content" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversationId" INTEGER NOT NULL,
    "tokenCount" INTEGER,
    "discordUserId" TEXT,
    "discordUsername" TEXT,
    "parentMessageId" INTEGER,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Message" ("content", "conversationId", "createdAt", "discordUserId", "discordUsername", "id", "parentMessageId", "role", "tokenCount") SELECT "content", "conversationId", "createdAt", "discordUserId", "discordUsername", "id", "parentMessageId", "role", "tokenCount" FROM "Message";
DROP TABLE "Message";
ALTER TABLE "new_Message" RENAME TO "Message";
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE INDEX "Message_discordUserId_idx" ON "Message"("discordUserId");
CREATE INDEX "Message_parentMessageId_idx" ON "Message"("parentMessageId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "cache_metrics_hits_idx" ON "cache_metrics"("hits");

-- CreateIndex
CREATE INDEX "cache_metrics_lastAccessed_idx" ON "cache_metrics"("lastAccessed");
