ALTER TABLE "CrmRecord" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Activity" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "CrmRecord_tags_gin_idx" ON "CrmRecord" USING GIN ("tags");
CREATE INDEX "Activity_tags_gin_idx" ON "Activity" USING GIN ("tags");
