INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-contact-country-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'country', '国家/地区', 'text', false, false, NULL, NULL, true, 6
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'contacts'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = false, "unique" = false, "isSystem" = true, "position" = EXCLUDED."position";

UPDATE "FieldDefinition" field_definition
SET "position" = 7
FROM "ObjectDefinition" object_definition
WHERE field_definition."objectDefinitionId" = object_definition."id"
  AND object_definition."key" = 'contacts'
  AND field_definition."key" = 'address'
  AND field_definition."position" < 7;

UPDATE "FieldDefinition" field_definition
SET "position" = 8
FROM "ObjectDefinition" object_definition
WHERE field_definition."objectDefinitionId" = object_definition."id"
  AND object_definition."key" = 'contacts'
  AND field_definition."key" = 'avatarUrl'
  AND field_definition."position" < 8;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-company-country-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'country', '国家/地区', 'text', false, false, NULL, NULL, true, 3
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'companies'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = false, "unique" = false, "isSystem" = true, "position" = EXCLUDED."position";

UPDATE "FieldDefinition" field_definition
SET "position" = 4
FROM "ObjectDefinition" object_definition
WHERE field_definition."objectDefinitionId" = object_definition."id"
  AND object_definition."key" = 'companies'
  AND field_definition."key" = 'billingAddresses'
  AND field_definition."position" < 4;

UPDATE "FieldDefinition" field_definition
SET "position" = 5
FROM "ObjectDefinition" object_definition
WHERE field_definition."objectDefinitionId" = object_definition."id"
  AND object_definition."key" = 'companies'
  AND field_definition."key" = 'shippingAddresses'
  AND field_definition."position" < 5;

UPDATE "FieldDefinition" field_definition
SET "position" = 6
FROM "ObjectDefinition" object_definition
WHERE field_definition."objectDefinitionId" = object_definition."id"
  AND object_definition."key" = 'companies'
  AND field_definition."key" = 'logoUrl'
  AND field_definition."position" < 6;

UPDATE "SavedView"
SET "columns" = ARRAY['title', 'email', 'phone', 'companyId', 'country', 'birthday', 'gender']
WHERE "objectDefinitionId" IN (SELECT "id" FROM "ObjectDefinition" WHERE "key" = 'contacts') AND "isDefault" = true;

UPDATE "SavedView"
SET "columns" = ARRAY['title', 'domain', 'industry', 'country', 'billingAddresses', 'shippingAddresses']
WHERE "objectDefinitionId" IN (SELECT "id" FROM "ObjectDefinition" WHERE "key" = 'companies') AND "isDefault" = true;
