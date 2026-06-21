ALTER TABLE "EmailMessage"
  ADD COLUMN "aiAssisted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "aiPurpose" TEXT,
  ADD COLUMN "aiSourceMessageId" TEXT,
  ADD COLUMN "aiGeneratedAt" TIMESTAMP(3);

CREATE INDEX "EmailMessage_workspaceId_aiAssisted_createdAt_idx"
  ON "EmailMessage"("workspaceId", "aiAssisted", "createdAt");
