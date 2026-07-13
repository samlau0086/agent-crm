ALTER TABLE "DocumentTemplate"
ADD COLUMN IF NOT EXISTS "fileNamePattern" TEXT NOT NULL DEFAULT '$NUM';

UPDATE "DocumentTemplate"
SET "fileNamePattern" = "objectKey" || '-$NUM'
WHERE "fileNamePattern" = '$NUM';
