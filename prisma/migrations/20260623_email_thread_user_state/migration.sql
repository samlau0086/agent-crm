CREATE TABLE "EmailThreadState" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "category" TEXT,
  "deleted" BOOLEAN NOT NULL DEFAULT false,
  "important" BOOLEAN NOT NULL DEFAULT false,
  "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "read" BOOLEAN NOT NULL DEFAULT false,
  "snoozedUntil" TIMESTAMP(3),
  "starred" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailThreadState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailThreadState_workspaceId_threadId_userId_key" ON "EmailThreadState"("workspaceId", "threadId", "userId");
CREATE INDEX "EmailThreadState_workspaceId_userId_archived_idx" ON "EmailThreadState"("workspaceId", "userId", "archived");
CREATE INDEX "EmailThreadState_workspaceId_userId_deleted_idx" ON "EmailThreadState"("workspaceId", "userId", "deleted");
CREATE INDEX "EmailThreadState_workspaceId_userId_starred_idx" ON "EmailThreadState"("workspaceId", "userId", "starred");
CREATE INDEX "EmailThreadState_workspaceId_userId_important_idx" ON "EmailThreadState"("workspaceId", "userId", "important");
CREATE INDEX "EmailThreadState_workspaceId_userId_snoozedUntil_idx" ON "EmailThreadState"("workspaceId", "userId", "snoozedUntil");
CREATE INDEX "EmailThreadState_workspaceId_userId_category_idx" ON "EmailThreadState"("workspaceId", "userId", "category");

ALTER TABLE "EmailThreadState" ADD CONSTRAINT "EmailThreadState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmailThreadState" ADD CONSTRAINT "EmailThreadState_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailThreadState" ADD CONSTRAINT "EmailThreadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
