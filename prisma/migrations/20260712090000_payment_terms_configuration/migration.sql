INSERT INTO "ObjectDefinition" ("id", "workspaceId", "key", "label", "pluralLabel", "description", "icon", "isSystem", "createdAt", "updatedAt")
SELECT 'obj-paymentterm-' || "id", "id", 'paymentterms', 'Payment Terms', 'Payment Terms', 'Payment terms and collection schedules used by sales documents', 'CreditCard', true, now(), now()
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO NOTHING;

WITH payment_term_fields AS (
  SELECT * FROM (VALUES
    ('code', 'System ID', 'text', true, true, NULL::jsonb, NULL::jsonb, 1),
    ('label', 'Label', 'text', true, false, NULL::jsonb, NULL::jsonb, 2),
    ('active', 'Active', 'boolean', false, false, NULL::jsonb, 'true'::jsonb, 3),
    ('mode', 'Collection structure', 'select', true, false, '[{"label":"Full payment","value":"full"},{"label":"Deposit / Balance","value":"deposit_balance"}]'::jsonb, '"full"'::jsonb, 4),
    ('fullPaymentMethod', 'Full payment method', 'text', false, false, NULL::jsonb, NULL::jsonb, 5),
    ('depositPaymentMethod', 'Deposit payment method', 'text', false, false, NULL::jsonb, NULL::jsonb, 6),
    ('balancePaymentMethod', 'Balance payment method', 'text', false, false, NULL::jsonb, NULL::jsonb, 7),
    ('depositType', 'Deposit type', 'select', true, false, '[{"label":"Percentage","value":"percentage"},{"label":"Fixed amount","value":"fixed"}]'::jsonb, '"percentage"'::jsonb, 8),
    ('depositValue', 'Deposit value', 'number', false, false, NULL::jsonb, '100'::jsonb, 9),
    ('paymentInstructions', 'Payment instructions', 'textarea', false, false, NULL::jsonb, NULL::jsonb, 10)
  ) AS field("key", "label", "type", "required", "unique", "options", "defaultValue", "position")
)
INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-paymentterm-' || payment_term_fields."key" || '-' || object_definition."workspaceId",
       object_definition."workspaceId",
       object_definition."id",
       payment_term_fields."key",
       payment_term_fields."label",
       payment_term_fields."type",
       payment_term_fields."required",
       payment_term_fields."unique",
       payment_term_fields."options",
       payment_term_fields."defaultValue",
       true,
       payment_term_fields."position"
FROM "ObjectDefinition" object_definition
CROSS JOIN payment_term_fields
WHERE object_definition."key" = 'paymentterms'
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

WITH default_terms AS (
  SELECT * FROM (VALUES
    ('paymentterm-due-on-receipt-', 'due_on_receipt', 'Due on receipt', '{"code":"due_on_receipt","label":"Due on receipt","active":true,"mode":"full","fullPaymentMethod":"Full Payment","depositType":"percentage","depositValue":100,"paymentInstructions":""}'::jsonb),
    ('paymentterm-net-15-', 'net_15', 'Net 15', '{"code":"net_15","label":"Net 15","active":true,"mode":"full","fullPaymentMethod":"Full Payment","depositType":"percentage","depositValue":100,"paymentInstructions":""}'::jsonb),
    ('paymentterm-net-30-', 'net_30', 'Net 30', '{"code":"net_30","label":"Net 30","active":true,"mode":"full","fullPaymentMethod":"Full Payment","depositType":"percentage","depositValue":100,"paymentInstructions":""}'::jsonb),
    ('paymentterm-net-60-', 'net_60', 'Net 60', '{"code":"net_60","label":"Net 60","active":true,"mode":"full","fullPaymentMethod":"Full Payment","depositType":"percentage","depositValue":100,"paymentInstructions":""}'::jsonb),
    ('paymentterm-advance-30-balance-70-', 'advance_30_balance_70', '30% Advance / 70% Balance', '{"code":"advance_30_balance_70","label":"30% Advance / 70% Balance","active":true,"mode":"deposit_balance","depositPaymentMethod":"Payment in Advance","balancePaymentMethod":"Balance","depositType":"percentage","depositValue":30,"paymentInstructions":""}'::jsonb)
  ) AS term("idPrefix", "code", "title", "data")
)
INSERT INTO "CrmRecord" ("id", "workspaceId", "objectKey", "title", "ownerId", "data", "createdAt", "updatedAt")
SELECT default_terms."idPrefix" || workspace."id",
       workspace."id",
       'paymentterms',
       default_terms."title",
       admin_user."id",
       default_terms."data",
       now(),
       now()
FROM "Workspace" workspace
JOIN LATERAL (
  SELECT "id" FROM "User" WHERE "workspaceId" = workspace."id" ORDER BY "createdAt" ASC LIMIT 1
) admin_user ON true
CROSS JOIN default_terms
WHERE NOT EXISTS (
  SELECT 1
  FROM "CrmRecord" existing
  WHERE existing."workspaceId" = workspace."id"
    AND existing."objectKey" = 'paymentterms'
    AND existing."data"->>'code' = default_terms."code"
);

UPDATE "FieldDefinition" field_definition
SET "options" = '[{"label":"Due on receipt","value":"due_on_receipt"},{"label":"Net 15","value":"net_15"},{"label":"Net 30","value":"net_30"},{"label":"Net 60","value":"net_60"},{"label":"30% Advance / 70% Balance","value":"advance_30_balance_70"}]'::jsonb
FROM "ObjectDefinition" object_definition
WHERE field_definition."objectDefinitionId" = object_definition."id"
  AND object_definition."key" IN ('quotes', 'salesorders', 'proformainvoices', 'commercialinvoices')
  AND field_definition."key" = 'paymentTerm';

INSERT INTO "SavedView" ("id", "workspaceId", "objectDefinitionId", "name", "columns", "filters", "sort", "isDefault")
SELECT 'view-paymentterms-default-' || object_definition."workspaceId",
       object_definition."workspaceId",
       object_definition."id",
       'All payment terms',
       ARRAY['title', 'code', 'label', 'mode', 'depositType', 'depositValue', 'active'],
       NULL,
       '{"field":"code","direction":"asc"}'::jsonb,
       true
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'paymentterms'
ON CONFLICT ("id") DO NOTHING;
