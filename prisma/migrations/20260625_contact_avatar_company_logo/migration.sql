INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-contact-avatar-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'avatarUrl', 'Avatar URL', 'text', false, false, NULL, NULL, true, 7
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'contacts'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = false, "unique" = false, "isSystem" = true, "position" = EXCLUDED."position";

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-company-logo-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'logoUrl', 'Logo URL', 'text', false, false, NULL, NULL, true, 5
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'companies'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = false, "unique" = false, "isSystem" = true, "position" = EXCLUDED."position";
