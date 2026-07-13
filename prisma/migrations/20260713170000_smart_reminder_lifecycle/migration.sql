ALTER TABLE "SmartReminder"
  ADD COLUMN "issueKey" TEXT,
  ADD COLUMN "basePriority" TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN "consecutiveDays" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastEscalatedAt" TIMESTAMP(3),
  ADD COLUMN "nextEligibleAt" TIMESTAMP(3),
  ADD COLUMN "completionEvidence" JSONB,
  ADD COLUMN "resolutionRule" JSONB,
  ADD COLUMN "linkedTaskId" TEXT;

UPDATE "SmartReminder"
SET
  "basePriority" = "priority",
  "firstSeenAt" = "createdAt",
  "lastSeenAt" = "updatedAt";

-- Older versions prefixed the idempotency key with YYYY-MM-DD. Keep only the
-- newest row for an exact historical issue active and retain older rows as
-- dismissed history. More flexible semantic matching happens in application code.
WITH ranked AS (
  SELECT
    "id",
    regexp_replace("idempotencyKey", '^\\d{4}-\\d{2}-\\d{2}:', '') AS issue_key,
    row_number() OVER (
      PARTITION BY "workspaceId", "userId", regexp_replace("idempotencyKey", '^\\d{4}-\\d{2}-\\d{2}:', '')
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS row_number
  FROM "SmartReminder"
), latest AS (
  SELECT "id", issue_key FROM ranked WHERE row_number = 1
)
UPDATE "SmartReminder" AS reminder
SET "issueKey" = latest.issue_key
FROM latest
WHERE reminder."id" = latest."id";

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "workspaceId", "userId", regexp_replace("idempotencyKey", '^\\d{4}-\\d{2}-\\d{2}:', '')
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS row_number
  FROM "SmartReminder"
)
UPDATE "SmartReminder" AS reminder
SET
  "status" = 'dismissed',
  "dismissedAt" = COALESCE(reminder."dismissedAt", CURRENT_TIMESTAMP)
FROM ranked
WHERE reminder."id" = ranked."id"
  AND ranked.row_number > 1
  AND reminder."status" = 'open';

CREATE UNIQUE INDEX "SmartReminder_workspaceId_userId_issueKey_key"
  ON "SmartReminder"("workspaceId", "userId", "issueKey");
CREATE INDEX "SmartReminder_workspaceId_userId_issueKey_status_idx"
  ON "SmartReminder"("workspaceId", "userId", "issueKey", "status");
