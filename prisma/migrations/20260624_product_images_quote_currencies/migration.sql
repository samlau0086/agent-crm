INSERT INTO "ObjectDefinition" ("id", "workspaceId", "key", "label", "pluralLabel", "description", "icon", "isSystem", "createdAt", "updatedAt")
SELECT 'obj-currency-' || "id", "id", 'currencies', '货币', '货币', '报价和产品价格使用的币种与汇率', 'BadgeDollarSign', true, now(), now()
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-product-main-image-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'mainImageUrl', '主图 URL', 'text', false, false, NULL, NULL, true, 2
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'products'
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-product-unit-price-currency-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'unitPriceCurrency', '单价币种', 'text', true, false, NULL, '"CNY"'::jsonb, true, 4
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'products'
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-quote-currency-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'quoteCurrency', '报价币种', 'text', true, false, NULL, '"CNY"'::jsonb, true, 4
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'quotes'
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-currency-code-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'code', '币种代码', 'text', true, true, NULL, NULL, true, 1
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'currencies'
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-currency-label-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'label', '名称', 'text', true, false, NULL, NULL, true, 2
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'currencies'
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-currency-symbol-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'symbol', '符号', 'text', false, false, NULL, NULL, true, 3
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'currencies'
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-currency-rate-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'rateToBase', '对基准汇率', 'number', true, false, NULL, '1'::jsonb, true, 4
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'currencies'
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-currency-base-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'isBase', '基准币种', 'boolean', false, false, NULL, 'false'::jsonb, true, 5
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'currencies'
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-currency-active-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'active', '启用', 'boolean', false, false, NULL, 'true'::jsonb, true, 6
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'currencies'
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

UPDATE "FieldDefinition" SET "position" = 3 WHERE "objectDefinitionId" IN (SELECT "id" FROM "ObjectDefinition" WHERE "key" = 'products') AND "key" = 'unitPrice';
UPDATE "FieldDefinition" SET "position" = 5 WHERE "objectDefinitionId" IN (SELECT "id" FROM "ObjectDefinition" WHERE "key" = 'products') AND "key" = 'description';
UPDATE "FieldDefinition" SET "position" = 6 WHERE "objectDefinitionId" IN (SELECT "id" FROM "ObjectDefinition" WHERE "key" = 'products') AND "key" = 'billingCycle';
UPDATE "FieldDefinition" SET "position" = 7 WHERE "objectDefinitionId" IN (SELECT "id" FROM "ObjectDefinition" WHERE "key" = 'products') AND "key" = 'active';
UPDATE "FieldDefinition" SET "position" = 5 WHERE "objectDefinitionId" IN (SELECT "id" FROM "ObjectDefinition" WHERE "key" = 'quotes') AND "key" = 'paymentTerm';
UPDATE "FieldDefinition" SET "position" = 6 WHERE "objectDefinitionId" IN (SELECT "id" FROM "ObjectDefinition" WHERE "key" = 'quotes') AND "key" = 'totalAmount';
UPDATE "FieldDefinition" SET "position" = 7 WHERE "objectDefinitionId" IN (SELECT "id" FROM "ObjectDefinition" WHERE "key" = 'quotes') AND "key" = 'status';
UPDATE "FieldDefinition" SET "position" = 8 WHERE "objectDefinitionId" IN (SELECT "id" FROM "ObjectDefinition" WHERE "key" = 'quotes') AND "key" = 'validUntil';

INSERT INTO "CrmRecord" ("id", "workspaceId", "objectKey", "title", "ownerId", "data", "createdAt", "updatedAt")
SELECT 'currency-cny-' || workspace."id", workspace."id", 'currencies', 'CNY · 人民币', admin_user."id", '{"code":"CNY","label":"人民币","symbol":"¥","rateToBase":1,"isBase":true,"active":true}'::jsonb, now(), now()
FROM "Workspace" workspace
JOIN LATERAL (
  SELECT "id" FROM "User" WHERE "workspaceId" = workspace."id" ORDER BY "createdAt" ASC LIMIT 1
) admin_user ON true
WHERE NOT EXISTS (
  SELECT 1 FROM "CrmRecord" existing WHERE existing."workspaceId" = workspace."id" AND existing."objectKey" = 'currencies' AND existing."data"->>'code' = 'CNY'
);

INSERT INTO "CrmRecord" ("id", "workspaceId", "objectKey", "title", "ownerId", "data", "createdAt", "updatedAt")
SELECT 'currency-usd-' || workspace."id", workspace."id", 'currencies', 'USD · 美元', admin_user."id", '{"code":"USD","label":"美元","symbol":"$","rateToBase":7.2,"isBase":false,"active":true}'::jsonb, now(), now()
FROM "Workspace" workspace
JOIN LATERAL (
  SELECT "id" FROM "User" WHERE "workspaceId" = workspace."id" ORDER BY "createdAt" ASC LIMIT 1
) admin_user ON true
WHERE NOT EXISTS (
  SELECT 1 FROM "CrmRecord" existing WHERE existing."workspaceId" = workspace."id" AND existing."objectKey" = 'currencies' AND existing."data"->>'code' = 'USD'
);

INSERT INTO "CrmRecord" ("id", "workspaceId", "objectKey", "title", "ownerId", "data", "createdAt", "updatedAt")
SELECT 'currency-eur-' || workspace."id", workspace."id", 'currencies', 'EUR · 欧元', admin_user."id", '{"code":"EUR","label":"欧元","symbol":"€","rateToBase":7.8,"isBase":false,"active":true}'::jsonb, now(), now()
FROM "Workspace" workspace
JOIN LATERAL (
  SELECT "id" FROM "User" WHERE "workspaceId" = workspace."id" ORDER BY "createdAt" ASC LIMIT 1
) admin_user ON true
WHERE NOT EXISTS (
  SELECT 1 FROM "CrmRecord" existing WHERE existing."workspaceId" = workspace."id" AND existing."objectKey" = 'currencies' AND existing."data"->>'code' = 'EUR'
);

UPDATE "CrmRecord"
SET "data" = jsonb_set(
    jsonb_set("data", '{unitPriceCurrency}', COALESCE("data"->'unitPriceCurrency', '"CNY"'::jsonb), true),
    '{mainImageUrl}',
    COALESCE("data"->'mainImageUrl', '""'::jsonb),
    true
  ),
  "updatedAt" = now()
WHERE "objectKey" = 'products';

UPDATE "CrmRecord"
SET "data" = jsonb_set(
    jsonb_set(
      jsonb_set("data", '{quoteCurrency}', COALESCE("data"->'quoteCurrency', '"CNY"'::jsonb), true),
      '{lineItems}',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_set(
              jsonb_set(line_item.value, '{currency}', COALESCE(line_item.value->'currency', COALESCE("CrmRecord"."data"->'quoteCurrency', '"CNY"'::jsonb)), true),
              '{imageUrl}',
              COALESCE(line_item.value->'imageUrl', COALESCE(product."data"->'mainImageUrl', '""'::jsonb)),
              true
            )
          )
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof("CrmRecord"."data"->'lineItems') = 'array' THEN "CrmRecord"."data"->'lineItems'
              ELSE '[]'::jsonb
            END
          ) line_item(value)
          LEFT JOIN "CrmRecord" product
            ON product."workspaceId" = "CrmRecord"."workspaceId"
           AND product."objectKey" = 'products'
           AND product."id" = line_item.value->>'productId'
        ),
        '[]'::jsonb
      ),
      true
    ),
    '{fees}',
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_set(fee.value, '{currency}', COALESCE(fee.value->'currency', COALESCE("CrmRecord"."data"->'quoteCurrency', '"CNY"'::jsonb)), true))
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof("CrmRecord"."data"->'fees') = 'array' THEN "CrmRecord"."data"->'fees'
            ELSE '[]'::jsonb
          END
        ) fee(value)
      ),
      '[]'::jsonb
    ),
    true
  ),
  "updatedAt" = now()
WHERE "objectKey" = 'quotes';

UPDATE "SavedView"
SET "columns" = ARRAY['title', 'mainImageUrl', 'sku', 'unitPrice', 'unitPriceCurrency', 'billingCycle', 'active']
WHERE "objectDefinitionId" IN (SELECT "id" FROM "ObjectDefinition" WHERE "key" = 'products') AND "isDefault" = true;

UPDATE "SavedView"
SET "columns" = ARRAY['title', 'quoteNumber', 'companyId', 'contactId', 'quoteCurrency', 'paymentTerm', 'totalAmount', 'status']
WHERE "objectDefinitionId" IN (SELECT "id" FROM "ObjectDefinition" WHERE "key" = 'quotes') AND "isDefault" = true;

INSERT INTO "SavedView" ("id", "workspaceId", "objectDefinitionId", "name", "columns", "filters", "sort", "isDefault")
SELECT 'view-currencies-default-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", '全部货币', ARRAY['title', 'code', 'label', 'symbol', 'rateToBase', 'isBase', 'active'], NULL, '{"field":"code","direction":"asc"}'::jsonb, true
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'currencies'
ON CONFLICT ("id") DO NOTHING;
