CREATE TABLE "ImportPreset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "mapping" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportPreset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImportPreset_workspaceId_objectKey_name_key" ON "ImportPreset"("workspaceId", "objectKey", "name");
CREATE INDEX "ImportPreset_workspaceId_objectKey_updatedAt_idx" ON "ImportPreset"("workspaceId", "objectKey", "updatedAt");
CREATE INDEX "ImportPreset_workspaceId_createdById_createdAt_idx" ON "ImportPreset"("workspaceId", "createdById", "createdAt");
ALTER TABLE "ImportPreset" ADD CONSTRAINT "ImportPreset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
