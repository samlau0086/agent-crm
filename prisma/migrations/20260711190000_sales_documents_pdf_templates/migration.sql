CREATE TABLE IF NOT EXISTS "DocumentTemplate" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "templateJson" JSONB NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'DocumentTemplate_workspaceId_fkey'
  ) THEN
    ALTER TABLE "DocumentTemplate"
      ADD CONSTRAINT "DocumentTemplate_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentTemplate_workspaceId_objectKey_name_key" ON "DocumentTemplate"("workspaceId", "objectKey", "name");
CREATE INDEX IF NOT EXISTS "DocumentTemplate_workspaceId_objectKey_active_idx" ON "DocumentTemplate"("workspaceId", "objectKey", "active");
CREATE INDEX IF NOT EXISTS "DocumentTemplate_workspaceId_objectKey_isDefault_idx" ON "DocumentTemplate"("workspaceId", "objectKey", "isDefault");

INSERT INTO "ObjectDefinition" ("id", "workspaceId", "key", "label", "pluralLabel", "description", "icon", "isSystem", "createdAt", "updatedAt")
SELECT 'obj-salesorder-' || "id", "id", 'salesorders', '销售订单', '销售订单', '可由报价转换生成的销售订单', 'ClipboardList', true, now(), now()
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO NOTHING;

INSERT INTO "ObjectDefinition" ("id", "workspaceId", "key", "label", "pluralLabel", "description", "icon", "isSystem", "createdAt", "updatedAt")
SELECT 'obj-proformainvoice-' || "id", "id", 'proformainvoices', '形式发票', '形式发票', '可由销售订单转换生成的形式发票', 'FileText', true, now(), now()
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO NOTHING;

INSERT INTO "ObjectDefinition" ("id", "workspaceId", "key", "label", "pluralLabel", "description", "icon", "isSystem", "createdAt", "updatedAt")
SELECT 'obj-commercialinvoice-' || "id", "id", 'commercialinvoices', '商业发票', '商业发票', '可由形式发票转换生成的商业发票', 'ReceiptText', true, now(), now()
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-quote-deal-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'dealId', '关联交易', 'reference', false, false, '[{"label":"交易","value":"deals"}]'::jsonb, NULL, true, 9
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'quotes'
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-quote-source-object-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'sourceObjectKey', '来源对象', 'text', false, false, NULL, NULL, true, 10
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'quotes'
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-quote-source-record-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'sourceRecordId', '来源记录', 'text', false, false, NULL, NULL, true, 11
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'quotes'
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-quote-converted-from-' || object_definition."workspaceId", object_definition."workspaceId", object_definition."id", 'convertedFromRecordId', '转换来源', 'text', false, false, NULL, NULL, true, 12
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'quotes'
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

WITH document_fields AS (
  SELECT * FROM (VALUES
    ('documentNumber', '单据编号', 'text', true, true, NULL::jsonb, NULL::jsonb, 1),
    ('companyId', '关联公司', 'reference', true, false, '[{"label":"公司","value":"companies"}]'::jsonb, NULL::jsonb, 2),
    ('contactId', '关联联系人', 'reference', true, false, '[{"label":"联系人","value":"contacts"}]'::jsonb, NULL::jsonb, 3),
    ('dealId', '关联交易', 'reference', false, false, '[{"label":"交易","value":"deals"}]'::jsonb, NULL::jsonb, 4),
    ('documentCurrency', '单据币种', 'text', true, false, NULL::jsonb, '"CNY"'::jsonb, 5),
    ('paymentTerm', '付款条款', 'select', true, false, '[{"label":"见票即付","value":"due_on_receipt"},{"label":"Net 15","value":"net_15"},{"label":"Net 30","value":"net_30"},{"label":"Net 60","value":"net_60"}]'::jsonb, '"net_30"'::jsonb, 6),
    ('totalAmount', '总金额', 'currency', true, false, NULL::jsonb, NULL::jsonb, 7),
    ('status', '状态', 'select', true, false, '[{"label":"草稿","value":"draft"},{"label":"已发送","value":"sent"},{"label":"已确认","value":"confirmed"},{"label":"已取消","value":"cancelled"}]'::jsonb, '"draft"'::jsonb, 8),
    ('issueDate', '出具日期', 'date', false, false, NULL::jsonb, NULL::jsonb, 9),
    ('dueDate', '到期日期', 'date', false, false, NULL::jsonb, NULL::jsonb, 10),
    ('notes', '备注', 'textarea', false, false, NULL::jsonb, NULL::jsonb, 11),
    ('sourceObjectKey', '来源对象', 'text', false, false, NULL::jsonb, NULL::jsonb, 12),
    ('sourceRecordId', '来源记录', 'text', false, false, NULL::jsonb, NULL::jsonb, 13),
    ('convertedFromRecordId', '转换来源', 'text', false, false, NULL::jsonb, NULL::jsonb, 14)
  ) AS field("key", "label", "type", "required", "unique", "options", "defaultValue", "position")
)
INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "defaultValue", "isSystem", "position")
SELECT 'field-' || object_definition."key" || '-' || document_fields."key" || '-' || object_definition."workspaceId",
       object_definition."workspaceId",
       object_definition."id",
       document_fields."key",
       document_fields."label",
       document_fields."type",
       document_fields."required",
       document_fields."unique",
       document_fields."options",
       document_fields."defaultValue",
       true,
       document_fields."position"
FROM "ObjectDefinition" object_definition
CROSS JOIN document_fields
WHERE object_definition."key" IN ('salesorders', 'proformainvoices', 'commercialinvoices')
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

INSERT INTO "RelationDefinition" ("id", "workspaceId", "fromObjectKey", "toObjectKey", "key", "label", "cardinality")
SELECT 'rel-company-salesorders-' || "id", "id", 'companies', 'salesorders', 'company_salesorders', '公司销售订单', 'one-to-many'
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO NOTHING;

INSERT INTO "RelationDefinition" ("id", "workspaceId", "fromObjectKey", "toObjectKey", "key", "label", "cardinality")
SELECT 'rel-contact-salesorders-' || "id", "id", 'contacts', 'salesorders', 'contact_salesorders', '联系人销售订单', 'one-to-many'
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO NOTHING;

INSERT INTO "RelationDefinition" ("id", "workspaceId", "fromObjectKey", "toObjectKey", "key", "label", "cardinality")
SELECT 'rel-deal-salesorders-' || "id", "id", 'deals', 'salesorders', 'deal_salesorders', '交易销售订单', 'one-to-many'
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO NOTHING;

INSERT INTO "RelationDefinition" ("id", "workspaceId", "fromObjectKey", "toObjectKey", "key", "label", "cardinality")
SELECT 'rel-company-proformainvoices-' || "id", "id", 'companies', 'proformainvoices', 'company_proformainvoices', '公司形式发票', 'one-to-many'
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO NOTHING;

INSERT INTO "RelationDefinition" ("id", "workspaceId", "fromObjectKey", "toObjectKey", "key", "label", "cardinality")
SELECT 'rel-contact-proformainvoices-' || "id", "id", 'contacts', 'proformainvoices', 'contact_proformainvoices', '联系人形式发票', 'one-to-many'
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO NOTHING;

INSERT INTO "RelationDefinition" ("id", "workspaceId", "fromObjectKey", "toObjectKey", "key", "label", "cardinality")
SELECT 'rel-deal-proformainvoices-' || "id", "id", 'deals', 'proformainvoices', 'deal_proformainvoices', '交易形式发票', 'one-to-many'
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO NOTHING;

INSERT INTO "RelationDefinition" ("id", "workspaceId", "fromObjectKey", "toObjectKey", "key", "label", "cardinality")
SELECT 'rel-company-commercialinvoices-' || "id", "id", 'companies', 'commercialinvoices', 'company_commercialinvoices', '公司商业发票', 'one-to-many'
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO NOTHING;

INSERT INTO "RelationDefinition" ("id", "workspaceId", "fromObjectKey", "toObjectKey", "key", "label", "cardinality")
SELECT 'rel-contact-commercialinvoices-' || "id", "id", 'contacts', 'commercialinvoices', 'contact_commercialinvoices', '联系人商业发票', 'one-to-many'
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO NOTHING;

INSERT INTO "RelationDefinition" ("id", "workspaceId", "fromObjectKey", "toObjectKey", "key", "label", "cardinality")
SELECT 'rel-deal-commercialinvoices-' || "id", "id", 'deals', 'commercialinvoices', 'deal_commercialinvoices', '交易商业发票', 'one-to-many'
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO NOTHING;

INSERT INTO "RelationDefinition" ("id", "workspaceId", "fromObjectKey", "toObjectKey", "key", "label", "cardinality")
SELECT 'rel-quote-salesorders-' || "id", "id", 'quotes', 'salesorders', 'quote_salesorders', '报价销售订单', 'one-to-many'
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO NOTHING;

INSERT INTO "RelationDefinition" ("id", "workspaceId", "fromObjectKey", "toObjectKey", "key", "label", "cardinality")
SELECT 'rel-salesorder-proformainvoices-' || "id", "id", 'salesorders', 'proformainvoices', 'salesorder_proformainvoices', '销售订单形式发票', 'one-to-many'
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO NOTHING;

INSERT INTO "RelationDefinition" ("id", "workspaceId", "fromObjectKey", "toObjectKey", "key", "label", "cardinality")
SELECT 'rel-proformainvoice-commercialinvoices-' || "id", "id", 'proformainvoices', 'commercialinvoices', 'proformainvoice_commercialinvoices', '形式发票商业发票', 'one-to-many'
FROM "Workspace"
ON CONFLICT ("workspaceId", "key") DO NOTHING;

INSERT INTO "SavedView" ("id", "workspaceId", "objectDefinitionId", "name", "columns", "filters", "sort", "isDefault")
SELECT 'view-' || object_definition."key" || '-default-' || object_definition."workspaceId",
       object_definition."workspaceId",
       object_definition."id",
       '全部' || object_definition."pluralLabel",
       ARRAY['title', 'documentNumber', 'companyId', 'contactId', 'documentCurrency', 'paymentTerm', 'totalAmount', 'status'],
       NULL,
       '{"field":"updatedAt","direction":"desc"}'::jsonb,
       true
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" IN ('salesorders', 'proformainvoices', 'commercialinvoices')
ON CONFLICT DO NOTHING;

INSERT INTO "DocumentTemplate" ("id", "workspaceId", "objectKey", "name", "active", "isDefault", "templateJson", "createdById", "createdAt", "updatedAt")
SELECT 'template-' || object_key || '-' || workspace."id",
       workspace."id",
       object_key,
       '默认 PDF 模板',
       true,
       true,
       '{
         "pageSize": "A4",
         "pageMargins": [40, 48, 40, 48],
         "content": [
           { "text": "{{documentTitle}}", "style": "header" },
           { "text": "Number: {{documentNumber}}", "style": "meta" },
           { "text": "Customer: {{company.title}} / {{contact.title}}", "style": "meta" },
           { "text": "Issue date: {{date record.data.issueDate}}", "style": "meta" },
           { "table": { "widths": ["*", "auto", "auto", "auto"], "body": "{{lineItemsTable}}" }, "layout": "lightHorizontalLines", "margin": [0, 16, 0, 8] },
           { "text": "Fees: {{money totals.feeSubtotal currency}}", "alignment": "right" },
           { "text": "Total: {{money totals.totalAmount currency}}", "style": "total" },
           { "text": "{{record.data.notes}}", "margin": [0, 16, 0, 0] }
         ],
         "styles": {
           "header": { "fontSize": 20, "bold": true, "margin": [0, 0, 0, 12] },
           "meta": { "fontSize": 10, "color": "#475569", "margin": [0, 2, 0, 0] },
           "total": { "fontSize": 14, "bold": true, "alignment": "right", "margin": [0, 8, 0, 0] }
         }
       }'::jsonb,
       COALESCE((SELECT "id" FROM "User" WHERE "workspaceId" = workspace."id" ORDER BY "createdAt" ASC LIMIT 1), 'system'),
       now(),
       now()
FROM "Workspace" workspace
CROSS JOIN (VALUES ('quotes'), ('salesorders'), ('proformainvoices'), ('commercialinvoices')) AS template_objects(object_key)
ON CONFLICT ("workspaceId", "objectKey", "name") DO NOTHING;

UPDATE "ObjectDefinition"
SET "label" = CASE "key"
  WHEN 'salesorders' THEN '销售订单'
  WHEN 'proformainvoices' THEN '形式发票'
  WHEN 'commercialinvoices' THEN '商业发票'
  ELSE "label"
END,
"pluralLabel" = CASE "key"
  WHEN 'salesorders' THEN '销售订单'
  WHEN 'proformainvoices' THEN '形式发票'
  WHEN 'commercialinvoices' THEN '商业发票'
  ELSE "pluralLabel"
END,
"description" = CASE "key"
  WHEN 'salesorders' THEN '可由报价转换生成的销售订单'
  WHEN 'proformainvoices' THEN '可由销售订单转换生成的形式发票'
  WHEN 'commercialinvoices' THEN '可由形式发票转换生成的商业发票'
  ELSE "description"
END
WHERE "key" IN ('salesorders', 'proformainvoices', 'commercialinvoices');

UPDATE "RelationDefinition"
SET "label" = CASE "key"
  WHEN 'company_salesorders' THEN '公司销售订单'
  WHEN 'contact_salesorders' THEN '联系人销售订单'
  WHEN 'deal_salesorders' THEN '交易销售订单'
  WHEN 'company_proformainvoices' THEN '公司形式发票'
  WHEN 'contact_proformainvoices' THEN '联系人形式发票'
  WHEN 'deal_proformainvoices' THEN '交易形式发票'
  WHEN 'company_commercialinvoices' THEN '公司商业发票'
  WHEN 'contact_commercialinvoices' THEN '联系人商业发票'
  WHEN 'deal_commercialinvoices' THEN '交易商业发票'
  WHEN 'quote_salesorders' THEN '报价销售订单'
  WHEN 'salesorder_proformainvoices' THEN '销售订单形式发票'
  WHEN 'proformainvoice_commercialinvoices' THEN '形式发票商业发票'
  ELSE "label"
END
WHERE "key" IN (
  'company_salesorders',
  'contact_salesorders',
  'deal_salesorders',
  'company_proformainvoices',
  'contact_proformainvoices',
  'deal_proformainvoices',
  'company_commercialinvoices',
  'contact_commercialinvoices',
  'deal_commercialinvoices',
  'quote_salesorders',
  'salesorder_proformainvoices',
  'proformainvoice_commercialinvoices'
);

UPDATE "FieldDefinition"
SET "label" = '付款条款'
WHERE "key" = 'paymentTerm'
  AND "objectKey" IN ('quotes', 'salesorders', 'proformainvoices', 'commercialinvoices');
