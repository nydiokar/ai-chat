-- AlterTable
ALTER TABLE "Message" ADD COLUMN "discordChannelId" TEXT;
ALTER TABLE "Message" ADD COLUMN "discordGuildId" TEXT;

-- CreateIndex
CREATE INDEX "Message_discordGuildId_discordChannelId_idx" ON "Message"("discordGuildId", "discordChannelId");
