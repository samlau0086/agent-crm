CREATE TABLE "CustomerLevelSettings" (
  "workspaceId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "levels" JSONB NOT NULL,
  "rules" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomerLevelSettings_pkey" PRIMARY KEY ("workspaceId")
);

ALTER TABLE "CustomerLevelSettings" ADD CONSTRAINT "CustomerLevelSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "CustomerLevelSettings" ("workspaceId", "enabled", "levels", "rules", "updatedAt")
SELECT
  workspace."id",
  true,
  '[
    {"value":"A","label":"A 级客户","color":"#16a34a","position":1,"enabled":true,"minScore":85,"maxScore":100},
    {"value":"B","label":"B 级客户","color":"#2563eb","position":2,"enabled":true,"minScore":70,"maxScore":84},
    {"value":"C","label":"C 级客户","color":"#f59e0b","position":3,"enabled":true,"minScore":45,"maxScore":69},
    {"value":"D","label":"D 级客户","color":"#ef4444","position":4,"enabled":true,"minScore":0,"maxScore":44}
  ]'::jsonb,
  '{"dealAmount":30,"dealStage":20,"recentActivity":15,"emailEngagement":15,"inactivity":10,"overdueTasks":10}'::jsonb,
  now()
FROM "Workspace" workspace
ON CONFLICT ("workspaceId") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "isSystem", "position")
SELECT 'field-' || object_definition."key" || '-customer-level-' || object_definition."workspaceId",
       object_definition."workspaceId",
       object_definition."id",
       'customerLevel',
       '客户等级',
       'select',
       false,
       false,
       '[{"label":"A 级客户","value":"A"},{"label":"B 级客户","value":"B"},{"label":"C 级客户","value":"C"},{"label":"D 级客户","value":"D"}]'::jsonb,
       true,
       CASE WHEN object_definition."key" = 'contacts' THEN 11 ELSE 9 END
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" IN ('contacts', 'companies')
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "isSystem", "position")
SELECT 'field-' || object_definition."key" || '-customer-level-suggested-' || object_definition."workspaceId",
       object_definition."workspaceId",
       object_definition."id",
       'customerLevelSuggested',
       '建议客户等级',
       'select',
       false,
       false,
       '[{"label":"A 级客户","value":"A"},{"label":"B 级客户","value":"B"},{"label":"C 级客户","value":"C"},{"label":"D 级客户","value":"D"}]'::jsonb,
       true,
       CASE WHEN object_definition."key" = 'contacts' THEN 12 ELSE 10 END
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" IN ('contacts', 'companies')
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "isSystem", "position")
SELECT 'field-' || object_definition."key" || '-customer-level-score-' || object_definition."workspaceId",
       object_definition."workspaceId",
       object_definition."id",
       'customerLevelScore',
       '客户等级评分',
       'number',
       false,
       false,
       true,
       CASE WHEN object_definition."key" = 'contacts' THEN 13 ELSE 11 END
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" IN ('contacts', 'companies')
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "isSystem", "position")
SELECT 'field-' || object_definition."key" || '-customer-level-reasons-' || object_definition."workspaceId",
       object_definition."workspaceId",
       object_definition."id",
       'customerLevelReasons',
       '客户等级建议原因',
       'textarea',
       false,
       false,
       true,
       CASE WHEN object_definition."key" = 'contacts' THEN 14 ELSE 12 END
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" IN ('contacts', 'companies')
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "isSystem", "position")
SELECT 'field-' || object_definition."key" || '-customer-level-suggested-at-' || object_definition."workspaceId",
       object_definition."workspaceId",
       object_definition."id",
       'customerLevelSuggestedAt',
       '客户等级建议时间',
       'text',
       false,
       false,
       true,
       CASE WHEN object_definition."key" = 'contacts' THEN 15 ELSE 13 END
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" IN ('contacts', 'companies')
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

UPDATE "SavedView"
SET "columns" = ARRAY['title', 'customerLevel', 'email', 'phone', 'companyId', 'country', 'birthday', 'gender']
WHERE "objectDefinitionId" IN (SELECT "id" FROM "ObjectDefinition" WHERE "key" = 'contacts')
  AND "isDefault" = true;

UPDATE "SavedView"
SET "columns" = ARRAY['title', 'customerLevel', 'domain', 'industry', 'country', 'billingAddresses', 'shippingAddresses']
WHERE "objectDefinitionId" IN (SELECT "id" FROM "ObjectDefinition" WHERE "key" = 'companies')
  AND "isDefault" = true;
