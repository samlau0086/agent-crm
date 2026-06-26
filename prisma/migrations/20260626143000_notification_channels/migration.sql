CREATE TABLE "NotificationChannel" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "events" TEXT[] NOT NULL,
  "config" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "lastNotifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationChannel_workspaceId_active_type_createdAt_idx" ON "NotificationChannel"("workspaceId", "active", "type", "createdAt");
CREATE INDEX "NotificationChannel_workspaceId_createdAt_idx" ON "NotificationChannel"("workspaceId", "createdAt");
CREATE INDEX "NotificationChannel_createdById_createdAt_idx" ON "NotificationChannel"("createdById", "createdAt");

ALTER TABLE "NotificationChannel"
  ADD CONSTRAINT "NotificationChannel_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationChannel"
  ADD CONSTRAINT "NotificationChannel_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
