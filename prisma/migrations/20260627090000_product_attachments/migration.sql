INSERT INTO "FieldDefinition" (
  "id",
  "workspaceId",
  "objectDefinitionId",
  "key",
  "label",
  "type",
  "required",
  "unique",
  "options",
  "defaultValue",
  "isSystem",
  "position"
)
SELECT
  'field-product-attachments-' || object_definition."workspaceId",
  object_definition."workspaceId",
  object_definition."id",
  'attachments',
  '附件',
  'textarea',
  false,
  false,
  NULL,
  '[]'::jsonb,
  true,
  8
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'products'
ON CONFLICT ("id") DO NOTHING;

UPDATE "CrmRecord"
SET "data" = jsonb_set("data", '{attachments}', '[]'::jsonb, true)
WHERE "objectKey" = 'products'
  AND NOT ("data" ? 'attachments');
