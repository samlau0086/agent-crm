CREATE TABLE "EmailSignature" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "accountId" TEXT,
  "name" TEXT NOT NULL,
  "bodyText" TEXT NOT NULL,
  "bodyHtml" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmailSignature_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailSignature_workspaceId_accountId_active_idx" ON "EmailSignature"("workspaceId", "accountId", "active");
CREATE INDEX "EmailSignature_workspaceId_isDefault_idx" ON "EmailSignature"("workspaceId", "isDefault");
CREATE INDEX "EmailSignature_workspaceId_createdById_idx" ON "EmailSignature"("workspaceId", "createdById");

ALTER TABLE "EmailSignature" ADD CONSTRAINT "EmailSignature_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailSignature" ADD CONSTRAINT "EmailSignature_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailSignature" ADD CONSTRAINT "EmailSignature_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
