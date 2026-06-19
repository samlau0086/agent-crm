ALTER TABLE "User" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "disabledAt" TIMESTAMP(3);
CREATE INDEX "User_workspaceId_active_idx" ON "User"("workspaceId", "active");
