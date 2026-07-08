CREATE TABLE "WorkflowResume" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "resumeAt" TIMESTAMP(3) NOT NULL,
  "triggerData" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "idempotencyKey" TEXT NOT NULL,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkflowResume_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkflowResume_workspaceId_idempotencyKey_key" ON "WorkflowResume"("workspaceId", "idempotencyKey");
CREATE INDEX "WorkflowResume_workspaceId_status_resumeAt_idx" ON "WorkflowResume"("workspaceId", "status", "resumeAt");
CREATE INDEX "WorkflowResume_workspaceId_workflowId_runId_idx" ON "WorkflowResume"("workspaceId", "workflowId", "runId");

ALTER TABLE "WorkflowResume" ADD CONSTRAINT "WorkflowResume_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowResume" ADD CONSTRAINT "WorkflowResume_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "WorkflowDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowResume" ADD CONSTRAINT "WorkflowResume_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
