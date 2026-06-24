UPDATE "FieldDefinition" field_definition
SET "required" = false
FROM "ObjectDefinition" object_definition
WHERE field_definition."objectDefinitionId" = object_definition."id"
  AND object_definition."key" = 'contacts'
  AND field_definition."key" = 'email';

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-contact-birthday-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'birthday', 'Birthday', 'date', false, false, NULL, NULL, true, 4
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'contacts'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = false, "unique" = false, "isSystem" = true, "position" = EXCLUDED."position";

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-contact-gender-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'gender', 'Gender', 'select', false, false, '[{"label":"Female","value":"female"},{"label":"Male","value":"male"},{"label":"Non-binary","value":"non_binary"},{"label":"Not disclosed","value":"not_disclosed"}]'::jsonb, NULL, true, 5
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'contacts'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = false, "unique" = false, "options" = EXCLUDED."options", "isSystem" = true, "position" = EXCLUDED."position";

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-contact-address-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'address', 'Address', 'textarea', false, false, NULL, NULL, true, 6
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'contacts'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = false, "unique" = false, "isSystem" = true, "position" = EXCLUDED."position";

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-company-billing-addresses-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'billingAddresses', 'Billing addresses', 'textarea', false, false, NULL, NULL, true, 3
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'companies'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = false, "unique" = false, "isSystem" = true, "position" = EXCLUDED."position";

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-company-shipping-addresses-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'shippingAddresses', 'Shipping addresses', 'textarea', false, false, NULL, NULL, true, 4
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'companies'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = false, "unique" = false, "isSystem" = true, "position" = EXCLUDED."position";

UPDATE "SavedView"
SET "columns" = ARRAY['title', 'email', 'phone', 'companyId', 'birthday', 'gender']
WHERE "objectDefinitionId" IN (SELECT "id" FROM "ObjectDefinition" WHERE "key" = 'contacts') AND "isDefault" = true;

UPDATE "SavedView"
SET "columns" = ARRAY['title', 'domain', 'industry', 'billingAddresses', 'shippingAddresses']
WHERE "objectDefinitionId" IN (SELECT "id" FROM "ObjectDefinition" WHERE "key" = 'companies') AND "isDefault" = true;

UPDATE "CrmRecord"
SET "data" = jsonb_set(jsonb_set("data", '{billingAddresses}', COALESCE("data"->'billingAddresses', '[]'::jsonb), true), '{shippingAddresses}', COALESCE("data"->'shippingAddresses', '[]'::jsonb), true),
    "updatedAt" = now()
WHERE "objectKey" = 'companies';
