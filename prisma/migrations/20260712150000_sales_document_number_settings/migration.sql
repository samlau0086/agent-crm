CREATE TABLE "SalesDocumentNumberSetting" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "pattern" TEXT NOT NULL,
  "sequencePadding" INTEGER NOT NULL DEFAULT 4,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesDocumentNumberSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesDocumentDailySequence" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "localDate" TEXT NOT NULL,
  "value" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesDocumentDailySequence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesDocumentNumberSetting_workspaceId_objectKey_key" ON "SalesDocumentNumberSetting"("workspaceId", "objectKey");
CREATE INDEX "SalesDocumentNumberSetting_workspaceId_idx" ON "SalesDocumentNumberSetting"("workspaceId");
CREATE UNIQUE INDEX "SalesDocumentDailySequence_workspaceId_objectKey_localDate_key" ON "SalesDocumentDailySequence"("workspaceId", "objectKey", "localDate");
CREATE INDEX "SalesDocumentDailySequence_workspaceId_localDate_idx" ON "SalesDocumentDailySequence"("workspaceId", "localDate");
ALTER TABLE "SalesDocumentNumberSetting" ADD CONSTRAINT "SalesDocumentNumberSetting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesDocumentDailySequence" ADD CONSTRAINT "SalesDocumentDailySequence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

