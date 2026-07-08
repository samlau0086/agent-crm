CREATE TABLE "EmailDeletedMessage" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "externalMessageId" TEXT NOT NULL,
  "threadId" TEXT,
  "deletedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailDeletedMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailDeletedMessage_workspaceId_accountId_externalMessageId_key"
  ON "EmailDeletedMessage"("workspaceId", "accountId", "externalMessageId");

CREATE INDEX "EmailDeletedMessage_workspaceId_accountId_createdAt_idx"
  ON "EmailDeletedMessage"("workspaceId", "accountId", "createdAt");

CREATE INDEX "EmailDeletedMessage_workspaceId_threadId_idx"
  ON "EmailDeletedMessage"("workspaceId", "threadId");

ALTER TABLE "EmailDeletedMessage"
  ADD CONSTRAINT "EmailDeletedMessage_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailDeletedMessage"
  ADD CONSTRAINT "EmailDeletedMessage_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailDeletedMessage"
  ADD CONSTRAINT "EmailDeletedMessage_deletedById_fkey"
  FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
