CREATE TABLE "RecordChangeRequest" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reason" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "reviewNote" TEXT,
  "patch" JSONB,
  "recordTitle" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),

  CONSTRAINT "RecordChangeRequest_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RecordChangeRequest"
  ADD CONSTRAINT "RecordChangeRequest_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "RecordChangeRequest_workspaceId_status_createdAt_idx"
  ON "RecordChangeRequest"("workspaceId", "status", "createdAt");

CREATE INDEX "RecordChangeRequest_workspaceId_objectKey_recordId_idx"
  ON "RecordChangeRequest"("workspaceId", "objectKey", "recordId");

CREATE INDEX "RecordChangeRequest_workspaceId_requestedById_createdAt_idx"
  ON "RecordChangeRequest"("workspaceId", "requestedById", "createdAt");
