CREATE TABLE "CrmPoolSettings" (
  "workspaceId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "objectKeys" TEXT[] NOT NULL DEFAULT ARRAY['contacts', 'companies']::TEXT[],
  "privateLimit" INTEGER NOT NULL DEFAULT 100,
  "autoReclaimEnabled" BOOLEAN NOT NULL DEFAULT true,
  "autoReclaimDays" INTEGER NOT NULL DEFAULT 30,
  "lastAutoReclaimAt" TIMESTAMP(3),
  "lastAutoReclaimCount" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CrmPoolSettings_pkey" PRIMARY KEY ("workspaceId")
);

ALTER TABLE "CrmPoolSettings"
  ADD CONSTRAINT "CrmPoolSettings_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "CrmPoolSettings" ("workspaceId", "objectKeys")
SELECT "id", ARRAY['contacts', 'companies']::TEXT[]
FROM "Workspace"
ON CONFLICT ("workspaceId") DO NOTHING;

UPDATE "Role"
SET "permissions" = array_append("permissions", 'crm.pool.manage')
WHERE 'crm.admin' = ANY("permissions")
  AND NOT 'crm.pool.manage' = ANY("permissions");
