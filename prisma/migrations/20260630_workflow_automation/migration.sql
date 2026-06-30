CREATE TABLE "WorkflowDefinition" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "goal" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "trigger" JSONB NOT NULL,
  "conditions" JSONB NOT NULL,
  "actions" JSONB NOT NULL,
  "createdById" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "lastRunAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkflowDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowRun" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "triggerEvent" TEXT NOT NULL,
  "triggerData" JSONB NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "conditionResults" JSONB,
  "actionResults" JSONB,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowActionApproval" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "runId" TEXT,
  "actionKey" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "summary" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "requestedById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "WorkflowActionApproval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkflowDefinition_workspaceId_status_updatedAt_idx" ON "WorkflowDefinition"("workspaceId", "status", "updatedAt");
CREATE INDEX "WorkflowDefinition_workspaceId_createdById_updatedAt_idx" ON "WorkflowDefinition"("workspaceId", "createdById", "updatedAt");

CREATE UNIQUE INDEX "WorkflowRun_workspaceId_workflowId_idempotencyKey_key" ON "WorkflowRun"("workspaceId", "workflowId", "idempotencyKey");
CREATE INDEX "WorkflowRun_workspaceId_workflowId_startedAt_idx" ON "WorkflowRun"("workspaceId", "workflowId", "startedAt");
CREATE INDEX "WorkflowRun_workspaceId_status_startedAt_idx" ON "WorkflowRun"("workspaceId", "status", "startedAt");

CREATE INDEX "WorkflowActionApproval_workspaceId_status_createdAt_idx" ON "WorkflowActionApproval"("workspaceId", "status", "createdAt");
CREATE INDEX "WorkflowActionApproval_workspaceId_workflowId_createdAt_idx" ON "WorkflowActionApproval"("workspaceId", "workflowId", "createdAt");
CREATE INDEX "WorkflowActionApproval_workspaceId_requestedById_createdAt_idx" ON "WorkflowActionApproval"("workspaceId", "requestedById", "createdAt");

ALTER TABLE "WorkflowDefinition"
  ADD CONSTRAINT "WorkflowDefinition_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowRun"
  ADD CONSTRAINT "WorkflowRun_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowRun"
  ADD CONSTRAINT "WorkflowRun_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "WorkflowDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowActionApproval"
  ADD CONSTRAINT "WorkflowActionApproval_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowActionApproval"
  ADD CONSTRAINT "WorkflowActionApproval_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "WorkflowDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowActionApproval"
  ADD CONSTRAINT "WorkflowActionApproval_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
