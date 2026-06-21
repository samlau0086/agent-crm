ALTER TABLE "EmailMessage" ADD COLUMN "clientRequestId" TEXT;

CREATE INDEX "EmailMessage_workspaceId_accountId_clientRequestId_idx"
  ON "EmailMessage"("workspaceId", "accountId", "clientRequestId");

CREATE UNIQUE INDEX "EmailMessage_workspaceId_accountId_createdById_clientRequestId_key"
  ON "EmailMessage"("workspaceId", "accountId", "createdById", "clientRequestId")
  WHERE "clientRequestId" IS NOT NULL;
