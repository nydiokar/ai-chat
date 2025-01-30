-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "parentMessageId" TEXT;

-- CreateIndex
CREATE INDEX "Conversation_branchId_idx" ON "Conversation"("branchId");

-- CreateIndex
CREATE INDEX "Conversation_parentMessageId_idx" ON "Conversation"("parentMessageId");
