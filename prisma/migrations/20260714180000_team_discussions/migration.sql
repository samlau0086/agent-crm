CREATE TABLE "DiscussionThread" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "targetKey" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "objectKey" TEXT,
  "targetId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiscussionThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscussionMessage" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "replyToId" TEXT,
  "body" TEXT NOT NULL,
  "editedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiscussionMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscussionAttachment" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "messageId" TEXT,
  "uploadedById" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscussionAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscussionMention" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscussionMention_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscussionReadState" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "lastReadAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiscussionReadState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscussionNotification" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscussionNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiscussionThread_workspaceId_targetKey_key" ON "DiscussionThread"("workspaceId", "targetKey");
CREATE INDEX "DiscussionThread_workspaceId_targetType_targetId_idx" ON "DiscussionThread"("workspaceId", "targetType", "targetId");
CREATE INDEX "DiscussionMessage_workspaceId_threadId_createdAt_id_idx" ON "DiscussionMessage"("workspaceId", "threadId", "createdAt", "id");
CREATE INDEX "DiscussionMessage_workspaceId_authorId_createdAt_idx" ON "DiscussionMessage"("workspaceId", "authorId", "createdAt");
CREATE INDEX "DiscussionAttachment_workspaceId_threadId_createdAt_idx" ON "DiscussionAttachment"("workspaceId", "threadId", "createdAt");
CREATE INDEX "DiscussionAttachment_workspaceId_messageId_idx" ON "DiscussionAttachment"("workspaceId", "messageId");
CREATE INDEX "DiscussionAttachment_workspaceId_uploadedById_createdAt_idx" ON "DiscussionAttachment"("workspaceId", "uploadedById", "createdAt");
CREATE UNIQUE INDEX "DiscussionMention_messageId_userId_key" ON "DiscussionMention"("messageId", "userId");
CREATE INDEX "DiscussionMention_workspaceId_userId_createdAt_idx" ON "DiscussionMention"("workspaceId", "userId", "createdAt");
CREATE UNIQUE INDEX "DiscussionReadState_workspaceId_threadId_userId_key" ON "DiscussionReadState"("workspaceId", "threadId", "userId");
CREATE INDEX "DiscussionReadState_workspaceId_userId_updatedAt_idx" ON "DiscussionReadState"("workspaceId", "userId", "updatedAt");
CREATE UNIQUE INDEX "DiscussionNotification_recipientId_messageId_type_key" ON "DiscussionNotification"("recipientId", "messageId", "type");
CREATE INDEX "DiscussionNotification_workspaceId_recipientId_readAt_createdAt_idx" ON "DiscussionNotification"("workspaceId", "recipientId", "readAt", "createdAt");

ALTER TABLE "DiscussionThread" ADD CONSTRAINT "DiscussionThread_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionMessage" ADD CONSTRAINT "DiscussionMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionMessage" ADD CONSTRAINT "DiscussionMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DiscussionThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionMessage" ADD CONSTRAINT "DiscussionMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscussionMessage" ADD CONSTRAINT "DiscussionMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "DiscussionMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DiscussionAttachment" ADD CONSTRAINT "DiscussionAttachment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionAttachment" ADD CONSTRAINT "DiscussionAttachment_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DiscussionThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionAttachment" ADD CONSTRAINT "DiscussionAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "DiscussionMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionAttachment" ADD CONSTRAINT "DiscussionAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscussionMention" ADD CONSTRAINT "DiscussionMention_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionMention" ADD CONSTRAINT "DiscussionMention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "DiscussionMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionMention" ADD CONSTRAINT "DiscussionMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionReadState" ADD CONSTRAINT "DiscussionReadState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionReadState" ADD CONSTRAINT "DiscussionReadState_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DiscussionThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionReadState" ADD CONSTRAINT "DiscussionReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionNotification" ADD CONSTRAINT "DiscussionNotification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionNotification" ADD CONSTRAINT "DiscussionNotification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionNotification" ADD CONSTRAINT "DiscussionNotification_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "DiscussionMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
