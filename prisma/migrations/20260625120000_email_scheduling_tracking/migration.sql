ALTER TABLE "EmailMessage"
  ADD COLUMN "scheduledSendAt" TIMESTAMP(3),
  ADD COLUMN "trackingEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "trackingId" TEXT,
  ADD COLUMN "trackingEvents" JSONB,
  ADD COLUMN "inboundMetadata" JSONB,
  ADD COLUMN "groupSendMode" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "EmailMessage_trackingId_key" ON "EmailMessage"("trackingId");
CREATE INDEX "EmailMessage_workspaceId_status_scheduledSendAt_idx" ON "EmailMessage"("workspaceId", "status", "scheduledSendAt");
CREATE INDEX "EmailMessage_workspaceId_trackingId_idx" ON "EmailMessage"("workspaceId", "trackingId");
