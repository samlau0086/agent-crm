CREATE TABLE "SmartReminderSettings" (
  "workspaceId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "dailyAt" TEXT NOT NULL DEFAULT '08:30',
  "maxPerUser" INTEGER NOT NULL DEFAULT 10,
  "objectKeys" TEXT[] NOT NULL DEFAULT ARRAY['contacts', 'companies', 'deals', 'emails', 'tasks', 'activities']::TEXT[],
  "notifyCreated" BOOLEAN NOT NULL DEFAULT false,
  "notifyDailyDigest" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SmartReminderSettings_pkey" PRIMARY KEY ("workspaceId")
);

CREATE TABLE "SmartReminder" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "objectKey" TEXT,
  "recordId" TEXT,
  "kind" TEXT NOT NULL,
  "priority" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "actionLabel" TEXT,
  "dueAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'open',
  "snoozedUntil" TIMESTAMP(3),
  "sources" JSONB,
  "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "idempotencyKey" TEXT NOT NULL,
  "generatedByAgentKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "dismissedAt" TIMESTAMP(3),

  CONSTRAINT "SmartReminder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmartReminderRun" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT,
  "status" TEXT NOT NULL,
  "scope" JSONB NOT NULL,
  "generatedCount" INTEGER NOT NULL DEFAULT 0,
  "fallback" BOOLEAN NOT NULL DEFAULT false,
  "agentKey" TEXT,
  "provider" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "durationMs" INTEGER,

  CONSTRAINT "SmartReminderRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmartReminder_workspaceId_userId_idempotencyKey_key" ON "SmartReminder"("workspaceId", "userId", "idempotencyKey");
CREATE INDEX "SmartReminder_workspaceId_userId_status_dueAt_idx" ON "SmartReminder"("workspaceId", "userId", "status", "dueAt");
CREATE INDEX "SmartReminder_workspaceId_objectKey_recordId_idx" ON "SmartReminder"("workspaceId", "objectKey", "recordId");
CREATE INDEX "SmartReminder_workspaceId_createdAt_idx" ON "SmartReminder"("workspaceId", "createdAt");
CREATE INDEX "SmartReminderRun_workspaceId_userId_startedAt_idx" ON "SmartReminderRun"("workspaceId", "userId", "startedAt");
CREATE INDEX "SmartReminderRun_workspaceId_status_startedAt_idx" ON "SmartReminderRun"("workspaceId", "status", "startedAt");

ALTER TABLE "SmartReminderSettings" ADD CONSTRAINT "SmartReminderSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartReminder" ADD CONSTRAINT "SmartReminder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartReminder" ADD CONSTRAINT "SmartReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartReminder" ADD CONSTRAINT "SmartReminder_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "CrmRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SmartReminderRun" ADD CONSTRAINT "SmartReminderRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmartReminderRun" ADD CONSTRAINT "SmartReminderRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
