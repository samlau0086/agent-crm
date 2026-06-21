ALTER TABLE "EmailMessage" ADD COLUMN "sendAttemptedAt" TIMESTAMP(3);

CREATE INDEX "EmailMessage_workspaceId_status_sendAttemptedAt_idx"
  ON "EmailMessage"("workspaceId", "status", "sendAttemptedAt");
