import { z } from "zod";

export const MAX_CSV_IMPORT_CHARS = 5_000_000;
export const MAX_IMPORT_MAPPING_FIELDS = 200;
export const MAX_SAVED_VIEW_COLUMNS = 100;
export const MAX_SAVED_VIEW_FILTERS = 50;
export const MAX_PIPELINE_STAGES = 50;
export const MAX_FIELD_OPTIONS = 200;

export const objectKeySchema = z.string().trim().regex(/^[a-z][a-z0-9-]*s$/, "Object key must be plural lowercase, for example partners");
const keySchema = z.string().trim().regex(/^[a-z][a-z0-9_]*$/, "Key must start with a lowercase letter and contain only letters, numbers, and underscores");
const labelSchema = z.string().trim().min(1);
const optionalTextSchema = z.string().trim().optional();
const optionalIdSchema = z
  .union([z.string().min(1), z.literal(""), z.null()])
  .optional()
  .transform((value) => value || undefined);

export const fieldTypeSchema = z.enum(["text", "textarea", "number", "currency", "date", "select", "boolean", "user", "reference"]);

export const fieldOptionSchema = z
  .object({
    label: labelSchema,
    value: z.string().trim().min(1)
  })
  .strict();

export const objectDefinitionCreateSchema = z
  .object({
    key: objectKeySchema,
    label: labelSchema,
    pluralLabel: labelSchema,
    description: optionalTextSchema,
    icon: optionalTextSchema
  })
  .strict();

export const objectDefinitionUpdateSchema = z
  .object({
    label: labelSchema.optional(),
    pluralLabel: labelSchema.optional(),
    description: optionalTextSchema,
    icon: optionalTextSchema
  })
  .strict();

export const fieldDefinitionCreateSchema = z
  .object({
    objectKey: objectKeySchema,
    key: keySchema,
    label: labelSchema,
    type: fieldTypeSchema,
    required: z.boolean(),
    unique: z.boolean(),
    options: z.array(fieldOptionSchema).max(MAX_FIELD_OPTIONS).optional(),
    defaultValue: z.unknown().optional(),
    position: z.number().int().min(0).optional()
  })
  .strict();

export const fieldDefinitionUpdateSchema = z
  .object({
    label: labelSchema.optional(),
    required: z.boolean().optional(),
    unique: z.boolean().optional(),
    options: z.array(fieldOptionSchema).max(MAX_FIELD_OPTIONS).optional(),
    defaultValue: z.unknown().optional(),
    position: z.number().int().min(0).optional()
  })
  .strict();

export const relationDefinitionCreateSchema = z
  .object({
    fromObjectKey: objectKeySchema,
    toObjectKey: objectKeySchema,
    key: keySchema,
    label: labelSchema,
    cardinality: z.enum(["one-to-one", "one-to-many", "many-to-many"])
  })
  .strict();

export const relationDefinitionUpdateSchema = relationDefinitionCreateSchema.partial().strict();

export const pipelineStageSchema = z
  .object({
    key: keySchema,
    label: labelSchema,
    probability: z.number().min(0).max(1),
    position: z.number().int().min(0),
    color: z.string().trim().min(1)
  })
  .strict();

export const pipelineCreateSchema = z
  .object({
    objectKey: objectKeySchema,
    name: labelSchema,
    isDefault: z.boolean(),
    stages: z.array(pipelineStageSchema).min(1).max(MAX_PIPELINE_STAGES)
  })
  .strict();

export const pipelineUpdateSchema = pipelineCreateSchema.partial().strict();

export const recordWriteSchema = z
  .object({
    title: labelSchema,
    data: z.record(z.unknown()),
    stageKey: optionalIdSchema,
    ownerId: optionalIdSchema
  })
  .strict();

export const recordPatchSchema = recordWriteSchema.partial().strict();

export const recordFilterSchema = z
  .object({
    field: z.string().trim().min(1),
    operator: z.enum(["contains", "equals"]),
    value: z.string()
  })
  .strict();

export const recordSortDirectionSchema = z.enum(["asc", "desc"]);

export const recordSortSchema = z
  .object({
    field: z.string().trim().min(1),
    direction: recordSortDirectionSchema
  })
  .strict();

const limitedImportMappingSchema = z.record(z.string().trim().min(1)).refine((mapping) => Object.keys(mapping).length <= MAX_IMPORT_MAPPING_FIELDS, {
  message: `Import mapping can include at most ${MAX_IMPORT_MAPPING_FIELDS} fields`
});

export const csvImportSchema = z
  .object({
    objectKey: objectKeySchema,
    csv: z.string().min(1).max(MAX_CSV_IMPORT_CHARS),
    strategy: z.enum(["skip-invalid", "all-or-nothing", "update-existing"]).optional(),
    mapping: limitedImportMappingSchema.optional(),
    presetId: z.string().trim().min(1).optional(),
    presetName: labelSchema.optional()
  })
  .strict();

export const csvPreviewSchema = csvImportSchema.omit({ strategy: true, presetId: true, presetName: true }).strict();

export const importJobActionSchema = z
  .object({
    action: z.enum(["cancel", "retry", "rerun"])
  })
  .strict();

export const importPresetCreateSchema = z
  .object({
    objectKey: objectKeySchema,
    name: labelSchema,
    strategy: z.enum(["skip-invalid", "all-or-nothing", "update-existing"]).optional(),
    mapping: limitedImportMappingSchema.optional()
  })
  .strict();

export const importPresetUpdateSchema = z
  .object({
    name: labelSchema.optional(),
    strategy: z.enum(["skip-invalid", "all-or-nothing", "update-existing"]).optional(),
    mapping: limitedImportMappingSchema.optional()
  })
  .strict();

export const activityTypeSchema = z.enum(["note", "call", "meeting", "task", "email", "stage_change"]);

export const activityCreateSchema = z
  .object({
    recordId: optionalIdSchema,
    type: activityTypeSchema,
    title: labelSchema,
    body: optionalTextSchema,
    dueAt: z.string().trim().min(1).optional(),
    completedAt: z.string().trim().min(1).optional()
  })
  .strict();

export const activityUpdateSchema = z
  .object({
    title: labelSchema.optional(),
    body: optionalTextSchema,
    dueAt: z.union([z.string().trim().min(1), z.null()]).optional(),
    completedAt: z.union([z.string().trim().min(1), z.null()]).optional()
  })
  .strict();

export const savedViewCreateSchema = z
  .object({
    objectKey: objectKeySchema,
    name: labelSchema,
    columns: z.array(z.string().trim().min(1)).min(1).max(MAX_SAVED_VIEW_COLUMNS),
    filters: z.array(recordFilterSchema).max(MAX_SAVED_VIEW_FILTERS).optional(),
    sort: recordSortSchema.optional(),
    isDefault: z.boolean()
  })
  .strict();

export const savedViewUpdateSchema = savedViewCreateSchema.partial().strict();

export const permissionSchema = z.enum(["crm.read", "crm.write", "crm.import", "crm.admin", "ai.use"]);

export const roleCreateSchema = z
  .object({
    name: labelSchema,
    permissions: z.array(permissionSchema).min(1)
  })
  .strict();

export const roleUpdateSchema = roleCreateSchema.partial().strict();

export const apiKeyCreateSchema = z
  .object({
    name: labelSchema,
    permissions: z.array(permissionSchema).min(1),
    expiresAt: z.string().trim().min(1).optional()
  })
  .strict();

export const apiKeyUpdateSchema = z
  .object({
    action: z.enum(["revoke"])
  })
  .strict();

export const webhookEventSchema = z.enum(["record.created", "record.updated", "record.deleted", "activity.created", "import.completed", "import.failed", "webhook.test"]);

export const webhookCreateSchema = z
  .object({
    name: labelSchema,
    url: z.string().trim().url(),
    events: z.array(webhookEventSchema).min(1),
    active: z.boolean().optional()
  })
  .strict();

export const webhookUpdateSchema = webhookCreateSchema.partial().strict();

export const emailProviderSchema = z.enum(["smtp_imap", "gmail", "outlook", "custom"]);
export const emailAccountStatusSchema = z.enum(["draft", "active", "disabled", "error"]);
export const emailDirectionSchema = z.enum(["inbound", "outbound"]);
export const emailMessageStatusSchema = z.enum(["received", "draft", "queued", "sent", "failed"]);
export const emailAssistantPurposeSchema = z.enum(["draft", "translate", "context_analysis", "summarize"]);
export const emailAiFeatureSchema = z.enum(["draft", "translate", "context_analysis", "auto_summarize"]);

const emailAddressSchema = z.string().trim().email();
const emailAddressListSchema = z.array(emailAddressSchema).max(100);

export const emailAccountCreateSchema = z
  .object({
    name: labelSchema,
    emailAddress: emailAddressSchema,
    provider: emailProviderSchema,
    status: emailAccountStatusSchema.optional(),
    syncEnabled: z.boolean().optional(),
    sendEnabled: z.boolean().optional()
  })
  .strict();

export const emailMessageCreateSchema = z
  .object({
    accountId: z.string().trim().min(1),
    threadId: z.string().trim().min(1).optional(),
    recordId: z.string().trim().min(1).optional(),
    direction: emailDirectionSchema,
    status: emailMessageStatusSchema.optional(),
    from: emailAddressSchema,
    to: emailAddressListSchema.min(1),
    cc: emailAddressListSchema.optional(),
    bcc: emailAddressListSchema.optional(),
    subject: labelSchema,
    bodyText: z.string().trim().min(1),
    bodyHtml: optionalTextSchema,
    externalMessageId: optionalTextSchema,
    sentAt: z.string().trim().min(1).optional(),
    receivedAt: z.string().trim().min(1).optional()
  })
  .strict();

export const emailAiSettingsUpdateSchema = z
  .object({
    features: z.record(emailAiFeatureSchema, z.boolean()).optional(),
    defaultLocale: z.string().trim().min(2).max(20).optional(),
    requireSourceLinks: z.boolean().optional(),
    maxHistoryMessages: z.number().int().min(1).max(20).optional(),
    maxKnowledgeArticles: z.number().int().min(0).max(20).optional(),
    maxContextChars: z.number().int().min(1000).max(20000).optional()
  })
  .strict();

export const emailAssistantContextSchema = z
  .object({
    purpose: emailAssistantPurposeSchema,
    recordId: z.string().trim().min(1).optional(),
    threadId: z.string().trim().min(1).optional(),
    targetLocale: z.string().trim().min(2).max(20).optional()
  })
  .strict();

export const knowledgeArticleCreateSchema = z
  .object({
    title: labelSchema,
    body: z.string().trim().min(1),
    tags: z.array(z.string().trim().min(1)).max(50).optional(),
    active: z.boolean().optional()
  })
  .strict();

export const teamCreateSchema = z
  .object({
    name: labelSchema
  })
  .strict();

export const teamUpdateSchema = teamCreateSchema.partial().strict();

export const aiRecordRequestSchema = z
  .object({
    objectKey: objectKeySchema,
    recordId: z.string().trim().min(1)
  })
  .strict();

export const aiQuerySchema = z
  .object({
    question: z.string().trim().min(1),
    objectKey: objectKeySchema.optional()
  })
  .strict();

export const auditActionSchema = z.enum(["create", "update", "delete", "import", "api_error"]);
