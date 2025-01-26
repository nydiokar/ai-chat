/*
  Warnings:

  - The primary key for the `MCPToolUsage` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `serverId` on the `MCPToolUsage` table. All the data in the column will be lost.
  - You are about to drop the column `success` on the `MCPToolUsage` table. All the data in the column will be lost.
  - You are about to alter the column `id` on the `MCPToolUsage` table. The data in that column could be lost. The data in that column will be cast from `String` to `Int`.
  - Made the column `conversationId` on table `MCPToolUsage` required. This step will fail if there are existing NULL values in that column.
  - Made the column `duration` on table `MCPToolUsage` required. This step will fail if there are existing NULL values in that column.

*/
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_MCPToolUsage" ("conversationId", "createdAt", "duration", "error", "id", "input", "output", "status", "toolId") SELECT "conversationId", "createdAt", "duration", "error", "id", "input", "output", "status", "toolId" FROM "MCPToolUsage";
DROP TABLE "MCPToolUsage";
ALTER TABLE "new_MCPToolUsage" RENAME TO "MCPToolUsage";
CREATE INDEX "MCPToolUsage_toolId_idx" ON "MCPToolUsage"("toolId");
CREATE INDEX "MCPToolUsage_conversationId_idx" ON "MCPToolUsage"("conversationId");
CREATE INDEX "MCPToolUsage_createdAt_idx" ON "MCPToolUsage"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
