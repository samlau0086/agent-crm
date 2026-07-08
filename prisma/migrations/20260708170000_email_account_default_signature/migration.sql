ALTER TABLE "EmailAccount" ADD COLUMN "defaultSignatureId" TEXT;

CREATE INDEX "EmailAccount_workspaceId_defaultSignatureId_idx" ON "EmailAccount"("workspaceId", "defaultSignatureId");
