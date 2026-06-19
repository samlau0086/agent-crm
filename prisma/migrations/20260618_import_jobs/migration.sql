CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "aborted" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "preview" JSONB,
    "result" JSONB,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportJob_workspaceId_createdAt_idx" ON "ImportJob"("workspaceId", "createdAt");
CREATE INDEX "ImportJob_workspaceId_objectKey_createdAt_idx" ON "ImportJob"("workspaceId", "objectKey", "createdAt");
CREATE INDEX "ImportJob_workspaceId_status_createdAt_idx" ON "ImportJob"("workspaceId", "status", "createdAt");
CREATE INDEX "ImportJob_workspaceId_requestedById_createdAt_idx" ON "ImportJob"("workspaceId", "requestedById", "createdAt");
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
