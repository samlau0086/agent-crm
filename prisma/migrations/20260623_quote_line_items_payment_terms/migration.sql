INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-product-description-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'description', '默认描述', 'textarea', false, false, NULL, NULL, true, 3
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'products'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = EXCLUDED."required", "unique" = EXCLUDED."unique", "isSystem" = true, "position" = EXCLUDED."position";

UPDATE "FieldDefinition" field_definition
SET "position" = 4
FROM "ObjectDefinition" object_definition
WHERE field_definition."objectDefinitionId" = object_definition."id"
  AND object_definition."key" = 'products'
  AND field_definition."key" = 'billingCycle';

UPDATE "FieldDefinition" field_definition
SET "position" = 5
FROM "ObjectDefinition" object_definition
WHERE field_definition."objectDefinitionId" = object_definition."id"
  AND object_definition."key" = 'products'
  AND field_definition."key" = 'active';

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-quote-payment-term-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'paymentTerm', 'Payment term', 'select', true, false, '[{"label":"见票即付","value":"due_on_receipt"},{"label":"Net 15","value":"net_15"},{"label":"Net 30","value":"net_30"},{"label":"Net 60","value":"net_60"}]'::jsonb, '"net_30"'::jsonb, true, 4
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'quotes'
ON CONFLICT ("objectDefinitionId", "key") DO UPDATE
SET "label" = EXCLUDED."label", "type" = EXCLUDED."type", "required" = EXCLUDED."required", "unique" = EXCLUDED."unique", "options" = EXCLUDED."options", "defaultValue" = EXCLUDED."defaultValue", "isSystem" = true, "position" = EXCLUDED."position";

UPDATE "FieldDefinition" field_definition
SET "position" = CASE field_definition."key"
  WHEN 'totalAmount' THEN 5
  WHEN 'status' THEN 6
  WHEN 'validUntil' THEN 7
  ELSE field_definition."position"
END
FROM "ObjectDefinition" object_definition
WHERE field_definition."objectDefinitionId" = object_definition."id"
  AND object_definition."key" = 'quotes'
  AND field_definition."key" IN ('totalAmount', 'status', 'validUntil');

UPDATE "CrmRecord" quote
SET "data" = jsonb_set(
  jsonb_set(
    jsonb_set(
      quote."data",
      '{paymentTerm}',
      COALESCE(quote."data"->'paymentTerm', '"net_30"'::jsonb),
      true
    ),
    '{fees}',
    COALESCE(quote."data"->'fees', '[]'::jsonb),
    true
  ),
  '{lineItems}',
  CASE
    WHEN quote."data" ? 'lineItems' THEN quote."data"->'lineItems'
    WHEN quote."data" ? 'productId' THEN jsonb_build_array(
      jsonb_build_object(
        'id', 'line-' || quote."id",
        'productId', quote."data"->>'productId',
        'productName', COALESCE(product."title", quote."data"->>'productId'),
        'sku', product."data"->>'sku',
        'description', product."data"->>'description',
        'quantity', 1,
        'unitPrice', COALESCE((product."data"->>'unitPrice')::numeric, COALESCE((quote."data"->>'totalAmount')::numeric, 0))
      )
    )
    ELSE '[]'::jsonb
  END,
  true
)
FROM "CrmRecord" product
WHERE quote."objectKey" = 'quotes'
  AND product."workspaceId" = quote."workspaceId"
  AND product."objectKey" = 'products'
  AND product."id" = quote."data"->>'productId';

UPDATE "CrmRecord" quote
SET "data" = jsonb_set(
  jsonb_set(
    jsonb_set(quote."data", '{paymentTerm}', COALESCE(quote."data"->'paymentTerm', '"net_30"'::jsonb), true),
    '{fees}', COALESCE(quote."data"->'fees', '[]'::jsonb), true
  ),
  '{lineItems}', COALESCE(quote."data"->'lineItems', '[]'::jsonb), true
)
WHERE quote."objectKey" = 'quotes'
  AND NOT (quote."data" ? 'productId');

UPDATE "SavedView" saved_view
SET "columns" = CASE
  WHEN 'paymentTerm' = ANY(array_remove(saved_view."columns", 'productId')) THEN array_remove(saved_view."columns", 'productId')
  ELSE array_append(array_remove(saved_view."columns", 'productId'), 'paymentTerm')
END
FROM "ObjectDefinition" object_definition
WHERE saved_view."objectDefinitionId" = object_definition."id"
  AND object_definition."key" = 'quotes';

DELETE FROM "FieldDefinition" field_definition
USING "ObjectDefinition" object_definition
WHERE field_definition."objectDefinitionId" = object_definition."id"
  AND object_definition."key" = 'quotes'
  AND field_definition."key" = 'productId'
  AND field_definition."isSystem" = true;
