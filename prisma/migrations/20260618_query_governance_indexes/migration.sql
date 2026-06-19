-- Query and governance indexes for larger private CRM deployments.
-- Keep these aligned with prisma/schema.prisma where Prisma can express them.

-- User/team visibility and admin metadata screens.
CREATE INDEX "User_workspaceId_teamId_idx" ON "User"("workspaceId", "teamId");
CREATE INDEX "User_workspaceId_roleId_idx" ON "User"("workspaceId", "roleId");
CREATE INDEX "Team_workspaceId_name_idx" ON "Team"("workspaceId", "name");
CREATE INDEX "Role_workspaceId_name_idx" ON "Role"("workspaceId", "name");

-- Metadata listing, validation, and dependency checks.
CREATE INDEX "ObjectDefinition_workspaceId_isSystem_createdAt_idx" ON "ObjectDefinition"("workspaceId", "isSystem", "createdAt");
CREATE INDEX "FieldDefinition_workspaceId_objectDefinitionId_position_idx" ON "FieldDefinition"("workspaceId", "objectDefinitionId", "position");
CREATE INDEX "FieldDefinition_workspaceId_type_idx" ON "FieldDefinition"("workspaceId", "type");
CREATE INDEX "RelationDefinition_workspaceId_fromObjectKey_idx" ON "RelationDefinition"("workspaceId", "fromObjectKey");
CREATE INDEX "RelationDefinition_workspaceId_toObjectKey_idx" ON "RelationDefinition"("workspaceId", "toObjectKey");

-- Record access, list views, pipeline stage guards, and validation scans.
CREATE INDEX "CrmRecord_workspaceId_objectKey_updatedAt_idx" ON "CrmRecord"("workspaceId", "objectKey", "updatedAt");
CREATE INDEX "CrmRecord_workspaceId_objectKey_ownerId_idx" ON "CrmRecord"("workspaceId", "objectKey", "ownerId");
CREATE INDEX "CrmRecord_workspaceId_objectKey_stageKey_idx" ON "CrmRecord"("workspaceId", "objectKey", "stageKey");
CREATE INDEX "CrmRecord_workspaceId_ownerId_idx" ON "CrmRecord"("workspaceId", "ownerId");
CREATE INDEX "CrmRecord_data_gin_idx" ON "CrmRecord" USING GIN ("data");

-- Pipeline lookup and default-pipeline integrity. The partial unique index enforces
-- the same invariant the application keeps when creating/updating defaults.
CREATE INDEX "Pipeline_workspaceId_objectKey_idx" ON "Pipeline"("workspaceId", "objectKey");
CREATE INDEX "Pipeline_workspaceId_objectKey_isDefault_idx" ON "Pipeline"("workspaceId", "objectKey", "isDefault");
CREATE UNIQUE INDEX "Pipeline_one_default_per_object_idx" ON "Pipeline"("workspaceId", "objectKey") WHERE "isDefault" = true;
CREATE INDEX "Pipeline_stages_gin_idx" ON "Pipeline" USING GIN ("stages");

-- Timelines, task lists, and activity ownership checks.
CREATE INDEX "Activity_workspaceId_recordId_createdAt_idx" ON "Activity"("workspaceId", "recordId", "createdAt");
CREATE INDEX "Activity_workspaceId_type_completedAt_dueAt_idx" ON "Activity"("workspaceId", "type", "completedAt", "dueAt");
CREATE INDEX "Activity_workspaceId_actorId_createdAt_idx" ON "Activity"("workspaceId", "actorId", "createdAt");

-- Audit trail filtering and JSON detail lookups.
CREATE INDEX "AuditLog_workspaceId_objectKey_createdAt_idx" ON "AuditLog"("workspaceId", "objectKey", "createdAt");
CREATE INDEX "AuditLog_workspaceId_actorId_createdAt_idx" ON "AuditLog"("workspaceId", "actorId", "createdAt");
CREATE INDEX "AuditLog_workspaceId_action_createdAt_idx" ON "AuditLog"("workspaceId", "action", "createdAt");
CREATE INDEX "AuditLog_details_gin_idx" ON "AuditLog" USING GIN ("details");

-- Saved view listing and future filter/sort dependency checks.
CREATE INDEX "SavedView_workspaceId_objectDefinitionId_isDefault_idx" ON "SavedView"("workspaceId", "objectDefinitionId", "isDefault");
CREATE INDEX "SavedView_workspaceId_objectDefinitionId_name_idx" ON "SavedView"("workspaceId", "objectDefinitionId", "name");
CREATE INDEX "SavedView_filters_gin_idx" ON "SavedView" USING GIN ("filters");
CREATE INDEX "SavedView_sort_gin_idx" ON "SavedView" USING GIN ("sort");
