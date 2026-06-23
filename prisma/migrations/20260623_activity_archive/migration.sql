ALTER TABLE "Activity" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Activity_workspaceId_type_archivedAt_idx" ON "Activity"("workspaceId", "type", "archivedAt");
