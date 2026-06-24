CREATE TABLE "EmailSyncSettings" (
  "workspaceId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "mode" TEXT NOT NULL DEFAULT 'interval',
  "intervalMinutes" INTEGER NOT NULL DEFAULT 5,
  "dailyAt" TEXT NOT NULL DEFAULT '03:00',
  "limit" INTEGER NOT NULL DEFAULT 25,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmailSyncSettings_pkey" PRIMARY KEY ("workspaceId")
);

ALTER TABLE "EmailSyncSettings"
ADD CONSTRAINT "EmailSyncSettings_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "EmailSyncSettings" ("workspaceId", "enabled", "mode", "intervalMinutes", "dailyAt", "limit", "updatedAt")
SELECT "id", true, 'interval', 5, '03:00', 25, CURRENT_TIMESTAMP
FROM "Workspace"
ON CONFLICT ("workspaceId") DO NOTHING;
