-- Unify reusable and discussion media while retaining Base64 as a rollout fallback.
CREATE TYPE "MediaAssetScope" AS ENUM ('WORKSPACE', 'TARGET');

ALTER TABLE "MediaAsset"
  ALTER COLUMN "contentBase64" DROP NOT NULL,
  ADD COLUMN "storageKey" TEXT,
  ADD COLUMN "scope" "MediaAssetScope" NOT NULL DEFAULT 'WORKSPACE',
  ADD COLUMN "targetKey" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "DiscussionAttachment" ADD COLUMN "mediaAssetId" TEXT;

CREATE INDEX "MediaAsset_workspaceId_scope_targetKey_archivedAt_createdAt_idx"
  ON "MediaAsset"("workspaceId", "scope", "targetKey", "archivedAt", "createdAt");
CREATE INDEX "DiscussionAttachment_workspaceId_mediaAssetId_idx"
  ON "DiscussionAttachment"("workspaceId", "mediaAssetId");

ALTER TABLE "DiscussionAttachment"
  ADD CONSTRAINT "DiscussionAttachment_mediaAssetId_fkey"
  FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
