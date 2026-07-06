ALTER TABLE "EmailAccount"
  ADD COLUMN "lastSyncStatus" TEXT,
  ADD COLUMN "lastSyncStartedAt" TIMESTAMP(3),
  ADD COLUMN "lastSyncFinishedAt" TIMESTAMP(3),
  ADD COLUMN "lastSyncScannedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastSyncImportedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastSyncSkippedDuplicateCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastSyncError" TEXT;
