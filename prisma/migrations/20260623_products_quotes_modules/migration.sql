INSERT INTO "ObjectDefinition" ("id", "workspaceId", "key", "label", "pluralLabel", "description", "icon", "isSystem", "createdAt", "updatedAt")
SELECT 'obj-product-' || "id", "id", 'products', '产品', '产品', '可报价的产品、订阅和服务', 'Package', true, now(), now()
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO UPDATE
SET
  "label" = EXCLUDED."label",
  "pluralLabel" = EXCLUDED."pluralLabel",
  "description" = EXCLUDED."description",
  "icon" = EXCLUDED."icon",
  "isSystem" = true,
  "updatedAt" = now();

INSERT INTO "ObjectDefinition" ("id", "workspaceId", "key", "label", "pluralLabel", "description", "icon", "isSystem", "createdAt", "updatedAt")
SELECT 'obj-quote-' || "id", "id", 'quotes', '报价', '报价', '关联联系人和公司的销售报价', 'FileText', true, now(), now()
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO UPDATE
SET
  "label" = EXCLUDED."label",
  "pluralLabel" = EXCLUDED."pluralLabel",
  "description" = EXCLUDED."description",
  "icon" = EXCLUDED."icon",
  "isSystem" = true,
  "updatedAt" = now();

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-product-sku-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'sku', 'SKU', 'text', true, true, NULL, NULL, true, 1
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'products'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = EXCLUDED."required", "unique" = EXCLUDED."unique", "isSystem" = true, "position" = EXCLUDED."position";

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-product-unit-price-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'unitPrice', '单价', 'currency', true, false, NULL, NULL, true, 2
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'products'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = EXCLUDED."required", "unique" = EXCLUDED."unique", "isSystem" = true, "position" = EXCLUDED."position";

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-product-billing-cycle-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'billingCycle', '计费周期', 'select', false, false, '[{"label":"一次性","value":"one_time"},{"label":"月付","value":"monthly"},{"label":"年付","value":"annual"}]'::jsonb, NULL, true, 3
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'products'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = EXCLUDED."required", "unique" = EXCLUDED."unique", "options" = EXCLUDED."options", "isSystem" = true, "position" = EXCLUDED."position";

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-product-active-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'active', '启用', 'boolean', false, false, NULL, 'true'::jsonb, true, 4
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'products'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = EXCLUDED."required", "unique" = EXCLUDED."unique", "defaultValue" = EXCLUDED."defaultValue", "isSystem" = true, "position" = EXCLUDED."position";

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-quote-number-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'quoteNumber', '报价编号', 'text', true, true, NULL, NULL, true, 1
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'quotes'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = EXCLUDED."required", "unique" = EXCLUDED."unique", "isSystem" = true, "position" = EXCLUDED."position";

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-quote-company-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'companyId', '关联公司', 'reference', true, false, '[{"label":"公司","value":"companies"}]'::jsonb, NULL, true, 2
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'quotes'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = EXCLUDED."required", "unique" = EXCLUDED."unique", "options" = EXCLUDED."options", "isSystem" = true, "position" = EXCLUDED."position";

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-quote-contact-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'contactId', '关联联系人', 'reference', true, false, '[{"label":"联系人","value":"contacts"}]'::jsonb, NULL, true, 3
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'quotes'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = EXCLUDED."required", "unique" = EXCLUDED."unique", "options" = EXCLUDED."options", "isSystem" = true, "position" = EXCLUDED."position";

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-quote-product-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'productId', '产品', 'reference', false, false, '[{"label":"产品","value":"products"}]'::jsonb, NULL, true, 4
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'quotes'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = EXCLUDED."required", "unique" = EXCLUDED."unique", "options" = EXCLUDED."options", "isSystem" = true, "position" = EXCLUDED."position";

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-quote-total-amount-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'totalAmount', '报价金额', 'currency', true, false, NULL, NULL, true, 5
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'quotes'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = EXCLUDED."required", "unique" = EXCLUDED."unique", "isSystem" = true, "position" = EXCLUDED."position";

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-quote-status-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'status', '状态', 'select', true, false, '[{"label":"草稿","value":"draft"},{"label":"已发送","value":"sent"},{"label":"已接受","value":"accepted"},{"label":"已拒绝","value":"declined"},{"label":"已过期","value":"expired"}]'::jsonb, '"draft"'::jsonb, true, 6
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'quotes'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = EXCLUDED."required", "unique" = EXCLUDED."unique", "options" = EXCLUDED."options", "defaultValue" = EXCLUDED."defaultValue", "isSystem" = true, "position" = EXCLUDED."position";

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-quote-valid-until-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'validUntil', '有效期至', 'date', false, false, NULL, NULL, true, 7
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'quotes'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = EXCLUDED."required", "unique" = EXCLUDED."unique", "isSystem" = true, "position" = EXCLUDED."position";

INSERT INTO "RelationDefinition" ("id", "workspaceId", "fromObjectKey", "toObjectKey", "key", "label", "cardinality")
SELECT 'rel-company-quotes-' || "id", "id", 'companies', 'quotes', 'company_quotes', '公司报价', 'one-to-many'
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO UPDATE
SET "fromObjectKey" = EXCLUDED."fromObjectKey", "toObjectKey" = EXCLUDED."toObjectKey", "label" = EXCLUDED."label", "cardinality" = EXCLUDED."cardinality";

INSERT INTO "RelationDefinition" ("id", "workspaceId", "fromObjectKey", "toObjectKey", "key", "label", "cardinality")
SELECT 'rel-contact-quotes-' || "id", "id", 'contacts', 'quotes', 'contact_quotes', '联系人报价', 'one-to-many'
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO UPDATE
SET "fromObjectKey" = EXCLUDED."fromObjectKey", "toObjectKey" = EXCLUDED."toObjectKey", "label" = EXCLUDED."label", "cardinality" = EXCLUDED."cardinality";

INSERT INTO "RelationDefinition" ("id", "workspaceId", "fromObjectKey", "toObjectKey", "key", "label", "cardinality")
SELECT 'rel-product-quotes-' || "id", "id", 'products', 'quotes', 'product_quotes', '产品报价', 'one-to-many'
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO UPDATE
SET "fromObjectKey" = EXCLUDED."fromObjectKey", "toObjectKey" = EXCLUDED."toObjectKey", "label" = EXCLUDED."label", "cardinality" = EXCLUDED."cardinality";

INSERT INTO "SavedView" ("id", "workspaceId", "objectDefinitionId", "name", "columns", "filters", "sort", "isDefault")
SELECT 'view-products-default-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", '全部产品', ARRAY['title', 'sku', 'unitPrice', 'billingCycle', 'active'], NULL, '{"field":"title","direction":"asc"}'::jsonb, true
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'products'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "SavedView" ("id", "workspaceId", "objectDefinitionId", "name", "columns", "filters", "sort", "isDefault")
SELECT 'view-quotes-default-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", '全部报价', ARRAY['title', 'quoteNumber', 'companyId', 'contactId', 'totalAmount', 'status'], NULL, '{"field":"updatedAt","direction":"desc"}'::jsonb, true
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'quotes'
ON CONFLICT ("id") DO NOTHING;
