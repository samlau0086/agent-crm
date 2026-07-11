ALTER TABLE "User" ADD COLUMN "avatarMediaAssetId" TEXT;

CREATE INDEX "User_workspaceId_avatarMediaAssetId_idx" ON "User"("workspaceId", "avatarMediaAssetId");

ALTER TABLE "User"
ADD CONSTRAINT "User_avatarMediaAssetId_fkey"
FOREIGN KEY ("avatarMediaAssetId")
REFERENCES "MediaAsset"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
