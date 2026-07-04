INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "isSystem", "position")
SELECT 'field-contact-preferred-language-' || object_definition."workspaceId",
       object_definition."workspaceId",
       object_definition."id",
       'preferredLanguage',
       '偏好语言',
       'text',
       false,
       false,
       true,
       9
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'contacts'
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "isSystem", "position")
SELECT 'field-contact-preferred-contact-window-' || object_definition."workspaceId",
       object_definition."workspaceId",
       object_definition."id",
       'preferredContactWindow',
       '偏好沟通时段',
       'textarea',
       false,
       false,
       true,
       10
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'contacts'
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "isSystem", "position")
SELECT 'field-company-preferred-language-' || object_definition."workspaceId",
       object_definition."workspaceId",
       object_definition."id",
       'preferredLanguage',
       '偏好语言',
       'text',
       false,
       false,
       true,
       7
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'companies'
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "isSystem", "position")
SELECT 'field-company-preferred-contact-window-' || object_definition."workspaceId",
       object_definition."workspaceId",
       object_definition."id",
       'preferredContactWindow',
       '偏好沟通时段',
       'textarea',
       false,
       false,
       true,
       8
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'companies'
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

UPDATE "CrmRecord"
SET "data" = jsonb_set(
      jsonb_set("data", '{preferredLanguage}', '"zh-CN"', true),
      '{preferredContactWindow}',
      '{"timezone":"Asia/Shanghai","daysOfWeek":[1,2,3,4,5],"startTime":"09:00","endTime":"18:00"}'::jsonb,
      true
    ),
    "updatedAt" = now()
WHERE "objectKey" IN ('contacts', 'companies')
  AND "id" IN ('contact-lin', 'company-acme')
  AND NOT ("data" ? 'preferredLanguage')
  AND NOT ("data" ? 'preferredContactWindow');
