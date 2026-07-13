ALTER TABLE "EmailThread" ADD COLUMN "remoteDeleted" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "EmailMessage"
  ADD COLUMN "imapMailbox" TEXT,
  ADD COLUMN "imapUid" TEXT,
  ADD COLUMN "imapUidValidity" TEXT,
  ADD COLUMN "imapOriginalMailbox" TEXT,
  ADD COLUMN "imapSyncStatus" TEXT,
  ADD COLUMN "imapSyncError" TEXT;

CREATE INDEX "EmailMessage_workspaceId_accountId_imapSyncStatus_idx"
  ON "EmailMessage"("workspaceId", "accountId", "imapSyncStatus");
