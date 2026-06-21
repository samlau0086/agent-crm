DROP INDEX IF EXISTS "EmailMessage_workspaceId_externalMessageId_key";

CREATE UNIQUE INDEX "EmailMessage_workspaceId_accountId_externalMessageId_key"
  ON "EmailMessage"("workspaceId", "accountId", "externalMessageId");
