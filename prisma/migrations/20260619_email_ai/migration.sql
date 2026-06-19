-- Email platform and AI assistant settings.
CREATE TABLE "EmailAccount" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "emailAddress" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
  "sendEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT NOT NULL,
  "lastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailThread" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "participantEmails" TEXT[],
  "recordId" TEXT,
  "summary" TEXT,
  "summaryUpdatedAt" TIMESTAMP(3),
  "lastMessageAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailMessage" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "fromAddress" TEXT NOT NULL,
  "toAddresses" TEXT[],
  "ccAddresses" TEXT[],
  "bccAddresses" TEXT[],
  "subject" TEXT NOT NULL,
  "bodyText" TEXT NOT NULL,
  "bodyHtml" TEXT,
  "externalMessageId" TEXT,
  "sentAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeArticle" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "tags" TEXT[],
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailAiSettings" (
  "workspaceId" TEXT NOT NULL,
  "features" JSONB NOT NULL,
  "defaultLocale" TEXT NOT NULL DEFAULT 'zh-CN',
  "requireSourceLinks" BOOLEAN NOT NULL DEFAULT true,
  "maxHistoryMessages" INTEGER NOT NULL DEFAULT 8,
  "maxKnowledgeArticles" INTEGER NOT NULL DEFAULT 5,
  "maxContextChars" INTEGER NOT NULL DEFAULT 8000,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailAiSettings_pkey" PRIMARY KEY ("workspaceId")
);

CREATE UNIQUE INDEX "EmailAccount_workspaceId_emailAddress_key" ON "EmailAccount"("workspaceId", "emailAddress");
CREATE INDEX "EmailAccount_workspaceId_status_idx" ON "EmailAccount"("workspaceId", "status");
CREATE INDEX "EmailAccount_workspaceId_provider_idx" ON "EmailAccount"("workspaceId", "provider");
CREATE INDEX "EmailAccount_workspaceId_createdById_idx" ON "EmailAccount"("workspaceId", "createdById");

CREATE INDEX "EmailThread_workspaceId_accountId_updatedAt_idx" ON "EmailThread"("workspaceId", "accountId", "updatedAt");
CREATE INDEX "EmailThread_workspaceId_recordId_updatedAt_idx" ON "EmailThread"("workspaceId", "recordId", "updatedAt");
CREATE INDEX "EmailThread_workspaceId_lastMessageAt_idx" ON "EmailThread"("workspaceId", "lastMessageAt");

CREATE UNIQUE INDEX "EmailMessage_workspaceId_externalMessageId_key" ON "EmailMessage"("workspaceId", "externalMessageId");
CREATE INDEX "EmailMessage_workspaceId_threadId_createdAt_idx" ON "EmailMessage"("workspaceId", "threadId", "createdAt");
CREATE INDEX "EmailMessage_workspaceId_accountId_createdAt_idx" ON "EmailMessage"("workspaceId", "accountId", "createdAt");
CREATE INDEX "EmailMessage_workspaceId_direction_status_createdAt_idx" ON "EmailMessage"("workspaceId", "direction", "status", "createdAt");

CREATE INDEX "KnowledgeArticle_workspaceId_active_updatedAt_idx" ON "KnowledgeArticle"("workspaceId", "active", "updatedAt");
CREATE INDEX "KnowledgeArticle_workspaceId_createdById_createdAt_idx" ON "KnowledgeArticle"("workspaceId", "createdById", "createdAt");

ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmailAiSettings" ADD CONSTRAINT "EmailAiSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
