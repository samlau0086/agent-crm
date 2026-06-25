CREATE TABLE "TalkMessage" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "objectKey" TEXT,
  "recordId" TEXT,
  "threadId" TEXT,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "sources" JSONB,
  "knowledgeArticleId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TalkMessage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TalkMessage"
  ADD CONSTRAINT "TalkMessage_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "TalkMessage_workspaceId_targetType_objectKey_recordId_createdAt_idx"
  ON "TalkMessage"("workspaceId", "targetType", "objectKey", "recordId", "createdAt");

CREATE INDEX "TalkMessage_workspaceId_targetType_threadId_createdAt_idx"
  ON "TalkMessage"("workspaceId", "targetType", "threadId", "createdAt");

CREATE INDEX "TalkMessage_workspaceId_knowledgeArticleId_idx"
  ON "TalkMessage"("workspaceId", "knowledgeArticleId");

CREATE INDEX "TalkMessage_workspaceId_createdById_createdAt_idx"
  ON "TalkMessage"("workspaceId", "createdById", "createdAt");
