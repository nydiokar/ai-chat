/*
  Warnings:

  - You are about to drop the `mCPServer` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "mCPServer";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "MCPServer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
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
    CONSTRAINT "MCPTool_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "MCPServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MCPTool" ("createdAt", "description", "id", "isEnabled", "name", "serverId", "updatedAt") SELECT "createdAt", "description", "id", "isEnabled", "name", "serverId", "updatedAt" FROM "MCPTool";
DROP TABLE "MCPTool";
ALTER TABLE "new_MCPTool" RENAME TO "MCPTool";
CREATE INDEX "MCPTool_serverId_idx" ON "MCPTool"("serverId");
CREATE UNIQUE INDEX "MCPTool_serverId_name_key" ON "MCPTool"("serverId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
