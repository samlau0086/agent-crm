import { z } from "zod";
import { isValidEmailAttachmentBase64, MAX_EMAIL_ATTACHMENT_BASE64_CHARS, MAX_EMAIL_ATTACHMENT_BYTES } from "@/lib/email/attachments";
import { MAX_OUTBOUND_EMAIL_RECIPIENTS, validateOutboundEmailRecipientPolicy } from "@/lib/email/outbound-policy";
import { isValidWebhookEvent } from "@/lib/integrations/webhook";
import type { WebhookEvent } from "@/lib/crm/types";

export const MAX_CSV_IMPORT_CHARS = 5_000_000;
export const MAX_IMPORT_MAPPING_FIELDS = 200;
export const MAX_SAVED_VIEW_COLUMNS = 100;
export const MAX_SAVED_VIEW_FILTERS = 50;
export const MAX_PIPELINE_STAGES = 50;
export const MAX_FIELD_OPTIONS = 200;
export const MAX_MEDIA_ASSET_BYTES = MAX_EMAIL_ATTACHMENT_BYTES;

export const objectKeySchema = z.string().trim().regex(/^[a-z][a-z0-9-]*s$/, "Object key must be plural lowercase, for example partners");
const keySchema = z.string().trim().regex(/^[a-z][a-z0-9_]*$/, "Key must start with a lowercase letter and contain only letters, numbers, and underscores");
const labelSchema = z.string().trim().min(1);
const optionalTextSchema = z.string().trim().optional();
const optionalIdSchema = z
  .union([z.string().min(1), z.literal(""), z.null()])
  .optional()
  .transform((value) => value || undefined);
const mediaAssetContentTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i, "contentType must be a valid MIME type");

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

const changeReasonSchema = z.string().trim().min(1).max(1000);

export const recordPatchWithReasonSchema = recordWriteSchema
  .partial()
  .extend({
    changeReason: changeReasonSchema.optional()
  })
  .strict();

export const recordStageUpdateSchema = z
  .object({
    stageKey: optionalIdSchema,
    pipelineOrder: z.number().finite().optional()
  })
  .strict();

export const recordDeleteRequestSchema = z
  .object({
    changeReason: changeReasonSchema.optional()
  })
  .strict();

export const customerLevelSchema = z.enum(["A", "B", "C", "D"]);

export const customerLevelDefinitionSchema = z
  .object({
    value: customerLevelSchema,
    label: labelSchema,
    color: z.string().trim().min(1).max(40),
    position: z.number().int().min(0).max(100),
    enabled: z.boolean(),
    minScore: z.number().min(0).max(100),
    maxScore: z.number().min(0).max(100)
  })
  .strict();

export const customerLevelRulesSchema = z
  .object({
    dealAmount: z.number().min(0).max(100),
    dealStage: z.number().min(0).max(100),
    recentActivity: z.number().min(0).max(100),
    emailEngagement: z.number().min(0).max(100),
    inactivity: z.number().min(0).max(100),
    overdueTasks: z.number().min(0).max(100)
  })
  .strict();

export const customerLevelSettingsUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    levels: z.array(customerLevelDefinitionSchema).min(1).max(4).optional(),
    rules: customerLevelRulesSchema.optional()
  })
  .strict();

export const customerLevelChangeRequestSchema = z
  .object({
    level: z.union([customerLevelSchema, z.literal("")]),
    changeReason: changeReasonSchema
  })
  .strict();

export const customerLevelSuggestionGenerateSchema = z
  .object({
    objectKey: z.enum(["companies"]).optional(),
    recordId: z.string().trim().min(1).optional()
  })
  .strict();

export const recordChangeRequestReviewSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    reviewNote: z.string().trim().max(1000).optional()
  })
  .strict();

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
    completedAt: z.union([z.string().trim().min(1), z.null()]).optional(),
    archivedAt: z.union([z.string().trim().min(1), z.null()]).optional()
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

export const permissionSchema = z.enum(["crm.read", "crm.write", "crm.import", "crm.pool.manage", "crm.admin", "workflow.read", "workflow.write", "workflow.admin", "ai.use", "ai.admin"]);

export const roleCreateSchema = z
  .object({
    name: labelSchema,
    permissions: z.array(permissionSchema).min(1)
  })
  .strict();

export const roleUpdateSchema = roleCreateSchema.partial().strict();

const crmPoolLevelKeySchema = z.enum(["A", "B", "C", "D", "unrated"]);

const crmPoolLevelRuleSchema = z
  .object({
    level: crmPoolLevelKeySchema,
    enabled: z.boolean().optional(),
    privateLimit: z.number().int().min(1).max(100000).nullable().optional(),
    autoReclaimDays: z.number().int().min(1).max(3650).nullable().optional()
  })
  .strict();

export const poolSettingsUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    privateLimit: z.number().int().min(1).max(100000).optional(),
    autoReclaimEnabled: z.boolean().optional(),
    autoReclaimDays: z.number().int().min(1).max(3650).optional(),
    levelRules: z.array(crmPoolLevelRuleSchema).max(5).optional()
  })
  .strict();

export const recordPoolTransferSchema = z
  .object({
    ownerId: z.union([z.string().trim().min(1), z.null()]).optional()
  })
  .strict();

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

export const webhookEventSchema = z.custom<WebhookEvent>((event) => typeof event === "string" && isValidWebhookEvent(event.trim()), "Unsupported webhook event");

export const webhookCreateSchema = z
  .object({
    name: labelSchema,
    url: z.string().trim().url(),
    events: z.array(webhookEventSchema).min(1),
    active: z.boolean().optional()
  })
  .strict();

export const webhookUpdateSchema = webhookCreateSchema.partial().strict();

export const notificationChannelTypeSchema = z.enum(["bark", "webhook", "email"]);

export const notificationChannelConfigSchema = z
  .object({
    barkEndpoint: z.string().trim().url().optional(),
    barkDeviceKey: z.string().trim().min(1).max(200).optional(),
    url: z.string().trim().url().optional(),
    recipients: z.array(z.string().trim().email()).max(MAX_OUTBOUND_EMAIL_RECIPIENTS).optional(),
    accountId: z.string().trim().min(1).optional()
  })
  .strict();

export const notificationChannelCreateSchema = z
  .object({
    name: labelSchema,
    type: notificationChannelTypeSchema,
    events: z.array(webhookEventSchema).min(1),
    config: notificationChannelConfigSchema,
    active: z.boolean().optional()
  })
  .strict();

export const notificationChannelUpdateSchema = notificationChannelCreateSchema.partial().strict();

export const smartReminderGenerateSchema = z
  .object({
    objectKey: objectKeySchema.optional(),
    recordId: z.string().trim().min(1).optional(),
    force: z.boolean().optional(),
    daily: z.boolean().optional()
  })
  .strict();

export const smartReminderUpdateSchema = z
  .object({
    status: z.enum(["open", "done", "dismissed"]).optional(),
    snoozedUntil: z.union([z.string().trim().datetime(), z.literal(""), z.null()]).optional()
  })
  .strict();

export const smartReminderSettingsUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    dailyAt: z.string().trim().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
    maxPerUser: z.number().int().min(1).max(50).optional(),
    objectKeys: z.array(z.string().trim().min(1)).max(10).optional(),
    notifyCreated: z.boolean().optional(),
    notifyDailyDigest: z.boolean().optional()
  })
  .strict();

export const userPreferencesUpdateSchema = z
  .object({
    emailListDisplayMode: z.enum(["thread", "message"]).optional()
  })
  .strict();

export const workflowTriggerSchema = z
  .object({
    type: z.enum(["crm_event", "email_event", "task_event", "schedule", "manual"]),
    event: z.string().trim().min(1).max(120).optional(),
    objectKey: objectKeySchema.optional(),
    config: z.record(z.unknown()).optional(),
    schedule: z
      .object({
        mode: z.enum(["daily", "weekly", "interval"]),
        dailyAt: z.string().trim().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
        weekday: z.number().int().min(0).max(6).optional(),
        intervalMinutes: z.number().int().min(1).max(10080).optional()
      })
      .strict()
      .optional()
  })
  .strict();

export const workflowConditionSchema = z
  .object({
    key: z.string().trim().min(1).max(120),
    type: z.enum(["field", "activity", "email_behavior", "ai", "if", "switch", "loop"]),
    field: z.string().trim().min(1).max(120).optional(),
    operator: z.enum(["equals", "not_equals", "contains", "not_contains", "gt", "gte", "lt", "lte", "exists", "not_exists"]).optional(),
    value: z.unknown().optional(),
    prompt: z.string().trim().max(2000).optional(),
    config: z.record(z.unknown()).optional()
  })
  .strict();

export const workflowActionSchema = z
  .object({
    key: z.string().trim().min(1).max(120),
    type: z.enum(["create_activity", "send_email", "update_stage", "update_record", "notify", "create_knowledge_article", "run_ai_agent"]),
    name: labelSchema,
    requiresApproval: z.boolean().optional(),
    config: z.record(z.unknown()).default({})
  })
  .strict();

export const workflowScopeSchema = z
  .object({
    mode: z.enum(["record", "object", "global"]),
    objectKey: objectKeySchema.optional(),
    recordId: z.string().trim().min(1).max(120).optional(),
    recordTitle: z.string().trim().max(200).optional()
  })
  .strict();

export const workflowNodeSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    type: z.enum(["start", "if", "switch", "loop", "wait_delay", "wait_reply", "ai_agent", "send_email", "create_email_draft", "create_task", "update_deal", "notify", "end"]),
    label: z.string().trim().min(1).max(200),
    position: z.object({ x: z.number(), y: z.number() }).strict(),
    config: z.record(z.unknown()).default({})
  })
  .strict();

export const workflowEdgeSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    sourceNodeId: z.string().trim().min(1).max(120),
    sourceHandle: z.string().trim().min(1).max(120),
    targetNodeId: z.string().trim().min(1).max(120)
  })
  .strict();

export const workflowGraphSchema = z
  .object({
    scope: workflowScopeSchema,
    nodes: z.array(workflowNodeSchema).min(2).max(100),
    edges: z.array(workflowEdgeSchema).max(200)
  })
  .strict();

export const workflowCreateSchema = z
  .object({
    name: labelSchema,
    description: optionalTextSchema,
    goal: z.string().trim().min(1).max(1000),
    status: z.enum(["draft", "active", "disabled", "archived"]).optional(),
    trigger: workflowTriggerSchema,
    conditions: z.array(workflowConditionSchema).max(20).default([]),
    actions: z.array(workflowActionSchema).max(20).default([]),
    graph: workflowGraphSchema.optional()
  })
  .strict();

export const workflowUpdateSchema = workflowCreateSchema.partial().strict();

export const workflowTestSchema = z
  .object({
    triggerData: z.record(z.unknown()).optional(),
    data: z.record(z.unknown()).optional()
  })
  .strict();

export const workflowGenerateSchema = z
  .object({
    goal: z.string().trim().min(1).max(1000),
    objectKey: objectKeySchema.optional(),
    recordId: z.string().trim().min(1).max(120).optional(),
    recordTitle: z.string().trim().max(200).optional(),
    audience: z.string().trim().max(500).optional(),
    constraints: z.string().trim().max(2000).optional()
  })
  .strict();

export const workflowApprovalReviewSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    reviewNote: z.string().trim().max(1000).optional()
  })
  .strict();

export const emailProviderSchema = z.enum(["smtp_imap", "gmail", "outlook", "custom"]);
export const emailAccountStatusSchema = z.enum(["draft", "active", "disabled", "error"]);
export const emailDirectionSchema = z.enum(["inbound", "outbound"]);
export const emailMessageStatusSchema = z.enum(["received", "draft", "queued", "sending", "sent", "failed"]);
export const emailAssistantPurposeSchema = z.enum(["draft", "translate", "context_analysis", "summarize"]);
export const emailOutboundAiPurposeSchema = z.enum(["draft", "translate"]);
export const emailAiFeatureSchema = z.enum(["draft", "translate", "auto_translate", "context_analysis", "auto_context_analysis", "auto_summarize"]);

const emailAddressSchema = z.string().trim().email();
const emailAddressListSchema = z.array(emailAddressSchema).max(100);
const emailAttachmentSchema = z
  .object({
    id: z.string().trim().min(1).max(200).optional(),
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(120).default("application/octet-stream"),
    size: z.number().int().min(0).max(MAX_EMAIL_ATTACHMENT_BYTES),
    contentBase64: z.string().trim().max(MAX_EMAIL_ATTACHMENT_BASE64_CHARS).optional(),
    contentId: z.string().trim().min(1).max(255).optional(),
    disposition: z.enum(["attachment", "inline"]).optional(),
    providerMessageId: z.string().trim().min(1).max(500).optional(),
    providerAttachmentId: z.string().trim().min(1).max(500).optional(),
    externalUrl: z.string().trim().url().max(2000).optional()
  })
  .strict()
  .refine((value) => !value.contentBase64 || isValidEmailAttachmentBase64(value.contentBase64), {
    message: "Attachment contentBase64 must be valid base64 or base64url text"
  });
const emailAttachmentsSchema = z.array(emailAttachmentSchema).max(10).optional();
const emailAiSourceSchema = z
  .object({
    label: z.string().trim().min(1).max(300),
    recordId: z.string().trim().min(1).max(200).optional(),
    activityId: z.string().trim().min(1).max(200).optional(),
    messageId: z.string().trim().min(1).max(200).optional(),
    knowledgeArticleId: z.string().trim().min(1).max(200).optional()
  })
  .strict();
const emailAiSourcesSchema = z.array(emailAiSourceSchema).max(20).optional();
const outboundEmailAttachmentsSchema = z
  .array(
    emailAttachmentSchema.refine((value) => Boolean(value.contentBase64?.trim()), {
      message: "Outbound attachments require contentBase64"
    })
  )
  .max(10)
  .optional();
const emailInboundConnectionConfigSchema = z
  .object({
    syncProtocol: z.literal("imap").optional(),
    imapHost: z.string().trim().min(1).optional(),
    imapPort: z.number().int().min(1).max(65535).optional(),
    imapSecure: z.boolean().optional(),
    username: z.string().trim().min(1).optional(),
    password: z.string().min(1).optional(),
    mailbox: z.string().trim().min(1).optional(),
    mailboxMapping: z
      .object({
        inbox: z.string().trim().min(1).optional(),
        sent: z.string().trim().min(1).optional(),
        spam: z.string().trim().min(1).optional(),
        trash: z.string().trim().min(1).optional(),
        archive: z.string().trim().min(1).optional()
      })
      .strict()
      .optional(),
    oauthProvider: z.enum(["gmail", "outlook", "custom"]).optional(),
    accessToken: z.string().trim().min(1).optional(),
    refreshToken: z.string().trim().min(1).optional(),
    tokenType: z.string().trim().min(1).optional(),
    expiresAt: z.string().datetime().optional(),
    scope: z.string().trim().min(1).optional()
  })
  .strict();
const emailOutboundServiceConfigSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(120),
    type: z.enum(["smtp", "resend"]),
    enabled: z.boolean().optional(),
    fromEmail: emailAddressSchema.optional(),
    smtpHost: z.string().trim().min(1).optional(),
    smtpPort: z.number().int().min(1).max(65535).optional(),
    smtpSecure: z.boolean().optional(),
    smtpStartTls: z.boolean().optional(),
    username: z.string().trim().min(1).optional(),
    password: z.string().min(1).optional(),
    resendApiKey: z.string().trim().min(1).optional()
  })
  .strict();
const emailConnectionConfigSchema = z
  .object({
    inbound: emailInboundConnectionConfigSchema.optional(),
    outboundServices: z.array(emailOutboundServiceConfigSchema).max(10).optional(),
    defaultOutboundServiceId: z.string().trim().min(1).max(80).optional(),
    smtpHost: z.string().trim().min(1).optional(),
    smtpPort: z.number().int().min(1).max(65535).optional(),
    smtpSecure: z.boolean().optional(),
    smtpStartTls: z.boolean().optional(),
    syncProtocol: z.literal("imap").optional(),
    imapHost: z.string().trim().min(1).optional(),
    imapPort: z.number().int().min(1).max(65535).optional(),
    imapSecure: z.boolean().optional(),
    username: z.string().trim().min(1).optional(),
    password: z.string().min(1).optional(),
    mailbox: z.string().trim().min(1).optional(),
    mailboxMapping: z
      .object({
        inbox: z.string().trim().min(1).optional(),
        sent: z.string().trim().min(1).optional(),
        spam: z.string().trim().min(1).optional(),
        trash: z.string().trim().min(1).optional(),
        archive: z.string().trim().min(1).optional()
      })
      .strict()
      .optional(),
    oauthProvider: z.enum(["gmail", "outlook", "custom"]).optional(),
    accessToken: z.string().trim().min(1).optional(),
    refreshToken: z.string().trim().min(1).optional(),
    tokenType: z.string().trim().min(1).optional(),
    expiresAt: z.string().datetime().optional(),
    scope: z.string().trim().min(1).optional()
  })
  .strict();

export const emailAccountCreateSchema = z
  .object({
    name: labelSchema,
    emailAddress: emailAddressSchema,
    provider: emailProviderSchema,
    status: emailAccountStatusSchema.optional(),
    syncEnabled: z.boolean().optional(),
    sendEnabled: z.boolean().optional(),
    defaultSignatureId: z.union([z.string().trim().min(1).max(200), z.literal(""), z.null()]).optional(),
    connectionConfig: emailConnectionConfigSchema.optional()
  })
  .strict();

export const emailAccountUpdateSchema = z
  .object({
    name: labelSchema.optional(),
    emailAddress: emailAddressSchema.optional(),
    provider: emailProviderSchema.optional(),
    status: emailAccountStatusSchema.optional(),
    syncEnabled: z.boolean().optional(),
    sendEnabled: z.boolean().optional(),
    defaultSignatureId: z.union([z.string().trim().min(1).max(200), z.literal(""), z.null()]).optional(),
    connectionConfig: emailConnectionConfigSchema.optional(),
    clearConnectionConfig: z.boolean().optional()
  })
  .strict()
  .refine((value) => !(value.connectionConfig && value.clearConnectionConfig), {
    message: "connectionConfig and clearConnectionConfig cannot be used together"
  });

export const emailSignatureCreateSchema = z
  .object({
    accountId: z.union([z.string().trim().min(1), z.literal(""), z.null()]).optional(),
    name: labelSchema,
    bodyText: z.string().trim().min(1).max(4000),
    bodyHtml: optionalTextSchema,
    isDefault: z.boolean().optional(),
    active: z.boolean().optional()
  })
  .strict();

export const emailSignatureUpdateSchema = z
  .object({
    accountId: z.union([z.string().trim().min(1), z.literal(""), z.null()]).optional(),
    name: labelSchema.optional(),
    bodyText: z.string().trim().min(1).max(4000).optional(),
    bodyHtml: optionalTextSchema,
    isDefault: z.boolean().optional(),
    active: z.boolean().optional()
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
    attachments: emailAttachmentsSchema,
    externalMessageId: optionalTextSchema,
    sentAt: z.string().trim().min(1).optional(),
    receivedAt: z.string().trim().min(1).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.direction !== "inbound") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["direction"],
        message: "Public email message creation only accepts inbound messages; use /api/email/send for outbound delivery"
      });
    }
    if (value.status && value.status !== "received") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "Inbound email message creation only accepts received status"
      });
    }
  });

export const emailSendSchema = z
  .object({
    accountId: z.string().trim().min(1),
    threadId: z.string().trim().min(1).optional(),
    recordId: z.string().trim().min(1).optional(),
    to: emailAddressListSchema.min(1),
    cc: emailAddressListSchema.optional(),
    bcc: emailAddressListSchema.optional(),
    subject: labelSchema,
    bodyText: z.string().trim().min(1),
    bodyHtml: optionalTextSchema,
    signatureId: z.string().trim().min(1).max(200).optional(),
    signatureName: z.string().trim().min(1).max(120).optional(),
    attachments: outboundEmailAttachmentsSchema,
    aiAssisted: z.boolean().optional(),
    aiPurpose: emailOutboundAiPurposeSchema.optional(),
    aiSourceMessageId: z.string().trim().min(1).optional(),
    aiSources: emailAiSourcesSchema,
    aiGeneratedAt: z.string().datetime().optional(),
    translatedBodyText: optionalTextSchema,
    translatedLocale: z.string().trim().min(2).max(20).optional(),
    translatedSources: emailAiSourcesSchema,
    translatedAt: z.string().datetime().optional(),
    scheduledSendAt: z.string().datetime().optional(),
    trackingEnabled: z.boolean().optional(),
    groupSendMode: z.boolean().optional(),
    skipAutoLink: z.boolean().optional(),
    clientRequestId: z.string().trim().min(8).max(120).regex(/^[A-Za-z0-9._:-]+$/).optional()
  })
  .strict()
  .superRefine((value, context) => {
    const policy = validateOutboundEmailRecipientPolicy(value);
    if (policy.total > MAX_OUTBOUND_EMAIL_RECIPIENTS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: `Outbound email recipients are limited to ${MAX_OUTBOUND_EMAIL_RECIPIENTS} total addresses across to, cc, and bcc`
      });
    }
    if (policy.duplicateRecipients.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: `Outbound email recipients must be unique across to, cc, and bcc: ${policy.duplicateRecipients.join(", ")}`
      });
    }
    if (value.aiAssisted && !value.aiPurpose) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["aiPurpose"],
        message: "aiPurpose is required when aiAssisted is true"
      });
    }
    if (value.aiAssisted && !value.aiGeneratedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["aiGeneratedAt"],
        message: "aiGeneratedAt is required when aiAssisted is true"
      });
    }
    if (!value.aiAssisted && (value.aiPurpose || value.aiSourceMessageId || value.aiSources?.length || value.aiGeneratedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["aiAssisted"],
        message: "AI provenance fields require aiAssisted to be true"
      });
    }
  });

export const emailSyncSchema = z
  .object({
    accountId: z.string().trim().min(1),
    limit: z.number().int().min(1).max(100).optional(),
    fullResync: z.boolean().optional()
  })
  .strict();

export const emailSyncAllSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    fullResync: z.boolean().optional()
  })
  .strict();

export const emailThreadUpdateSchema = z
  .object({
    recordId: z.union([z.string().trim().min(1), z.literal(""), z.null()]).optional()
  })
  .strict();

const emailThreadCategorySchema = z.enum(["primary", "promotions", "social", "updates"]);

export const emailThreadStateUpdateSchema = z
  .object({
    archived: z.boolean().optional(),
    category: z.union([emailThreadCategorySchema, z.literal(""), z.null()]).optional(),
    deleted: z.boolean().optional(),
    important: z.boolean().optional(),
    labels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    read: z.boolean().optional(),
    snoozedUntil: z.union([z.string().datetime(), z.literal(""), z.null()]).optional(),
    starred: z.boolean().optional()
  })
  .strict();

export const emailMessageTranslateSchema = z
  .object({
    targetLocale: z.string().trim().min(2).max(20).optional()
  })
  .strict();

export const emailConnectionTestSchema = emailSyncSchema.extend({
  scope: z.enum(["all", "inbound", "outbound"]).optional(),
  outboundServiceId: z.string().trim().min(1).max(120).optional()
});

export const emailOAuthStartSchema = z
  .object({
    provider: z.enum(["gmail", "outlook"]),
    emailAddress: emailAddressSchema,
    name: labelSchema.optional(),
    syncEnabled: z.boolean().optional(),
    sendEnabled: z.boolean().optional()
  })
  .strict();

const aiAgentContextPolicySchema = z
  .object({
    includeRecord: z.boolean().optional(),
    includeActivities: z.boolean().optional(),
    includeEmailThread: z.boolean().optional(),
    includeKnowledge: z.boolean().optional(),
    includeProducts: z.boolean().optional(),
    maxContextChars: z.number().int().min(1000).max(30000).optional(),
    maxHistoryMessages: z.number().int().min(1).max(50).optional()
  })
  .strict();

const aiAgentToolPolicySchema = z
  .object({
    allowRead: z.boolean().optional(),
    allowWrite: z.boolean().optional(),
    allowedTools: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    highRiskRequiresApproval: z.boolean().optional()
  })
  .strict();

const aiAgentProviderSchema = z.enum(["openai", "gemini", "openrouter", "custom", "openai-compatible"]);
const aiAgentScenarioSchema = z.enum(["email", "sales", "system"]);
const aiAgentOutputSchema = z.enum(["text", "email", "query", "workflow", "classification"]);

const aiAgentSettingSchema = z
  .object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_:-]{1,80}$/),
    name: labelSchema,
    scenario: aiAgentScenarioSchema,
    enabled: z.boolean(),
    providerProfileKey: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,60}$/).optional(),
    provider: aiAgentProviderSchema.optional(),
    baseUrl: z.string().trim().url().max(500).optional(),
    model: z.string().trim().min(1).max(120),
    agentMarkdown: z.string().trim().min(1).max(12000),
    contextPolicy: aiAgentContextPolicySchema.optional(),
    toolPolicy: aiAgentToolPolicySchema.optional(),
    outputSchema: aiAgentOutputSchema.optional(),
    maxOutputChars: z.number().int().min(500).max(12000)
  })
  .strict();

const aiProviderProfileSchema = z
  .object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,60}$/),
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean(),
    provider: aiAgentProviderSchema,
    baseUrl: z.string().trim().url().max(500),
    apiKey: z.string().trim().max(500).optional(),
    hasApiKey: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    model: z.string().trim().min(1).max(120),
    timeoutMs: z.number().int().min(1000).max(60000)
  })
  .strict();

export const emailAiSettingsUpdateSchema = z
  .object({
    features: z.record(emailAiFeatureSchema, z.boolean()).optional(),
    providerConfig: z
      .object({
        provider: aiAgentProviderSchema.optional(),
        baseUrl: z.string().trim().url().max(500).optional(),
        apiKey: z.string().trim().max(500).optional(),
        hasApiKey: z.boolean().optional(),
        model: z.string().trim().min(1).max(120).optional(),
        timeoutMs: z.number().int().min(1000).max(60000).optional()
      })
      .strict()
      .optional(),
    providerProfiles: z.array(aiProviderProfileSchema).max(20).optional(),
    agents: z
      .array(aiAgentSettingSchema)
      .max(40)
      .optional(),
    defaultLocale: z.string().trim().min(2).max(20).optional(),
    requireSourceLinks: z.boolean().optional(),
    maxHistoryMessages: z.number().int().min(1).max(20).optional(),
    maxKnowledgeArticles: z.number().int().min(0).max(20).optional(),
    maxContextChars: z.number().int().min(1000).max(20000).optional()
  })
  .strict();

export const aiAgentUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    scenario: aiAgentScenarioSchema.optional(),
    enabled: z.boolean().optional(),
    model: z.string().trim().min(1).max(120).optional(),
    providerProfileKey: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,60}$/).optional(),
    provider: aiAgentProviderSchema.optional(),
    baseUrl: z.string().trim().url().max(500).optional(),
    agentMarkdown: z.string().trim().min(1).max(12000).optional(),
    maxOutputChars: z.number().int().min(500).max(12000).optional(),
    contextPolicy: aiAgentContextPolicySchema.optional(),
    toolPolicy: aiAgentToolPolicySchema.optional(),
    outputSchema: aiAgentOutputSchema.optional()
  })
  .strict();

export const aiAgentTestSchema = z
  .object({
    task: z.string().trim().min(1).max(2000),
    userPrompt: z.string().trim().max(2000).optional(),
    objectKey: z.string().trim().regex(/^[a-z][a-z0-9_]*$/).optional(),
    recordId: z.string().trim().min(1).max(120).optional(),
    threadId: z.string().trim().min(1).max(120).optional(),
    dryRun: z.boolean().optional()
  })
  .strict();

export const emailSyncSettingsUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.enum(["interval", "daily"]).optional(),
    intervalMinutes: z.number().int().min(1).max(1440).optional(),
    dailyAt: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    limit: z.number().int().min(1).max(100).optional()
  })
  .strict();

export const aiTalkMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(4000)
  })
  .strict();

export const aiTalkTargetSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("record"),
      objectKey: z.string().trim().regex(/^[a-z][a-z0-9_]*$/),
      recordId: z.string().trim().min(1).max(120)
    })
    .strict(),
  z
    .object({
      type: z.literal("email_thread"),
      threadId: z.string().trim().min(1).max(120)
    })
    .strict()
]);

export const aiTalkRequestSchema = z
  .object({
    target: aiTalkTargetSchema,
    question: z.string().trim().max(2000),
    mode: z.enum(["chat", "suggestion"]).optional(),
    history: z.array(aiTalkMessageSchema).max(20).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode !== "suggestion" && value.question.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["question"],
        message: "Talk question is required"
      });
    }
  });

export const talkMessageCreateSchema = z
  .object({
    target: aiTalkTargetSchema,
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(4000),
    sources: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(200),
            objectKey: z.string().trim().regex(/^[a-z][a-z0-9_]*$/).optional(),
            recordId: z.string().trim().min(1).max(120).optional(),
            messageId: z.string().trim().min(1).max(120).optional(),
            knowledgeArticleId: z.string().trim().min(1).max(120).optional()
          })
          .strict()
      )
      .max(20)
      .optional(),
    knowledgeArticleId: z.string().trim().min(1).max(120).optional()
  })
  .strict();

export const talkMessageKnowledgePatchSchema = z
  .object({
    knowledgeArticleId: z.string().trim().min(1).max(120)
  })
  .strict();

export const emailAssistantContextSchema = z
  .object({
    purpose: emailAssistantPurposeSchema,
    recordId: z.string().trim().min(1).optional(),
    threadId: z.string().trim().min(1).optional(),
    sourceMessageId: z.string().trim().min(1).optional(),
    targetLocale: z.string().trim().min(2).max(20).optional(),
    productIds: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
    productQuery: z.string().trim().max(500).optional()
  })
  .strict();

export const emailAiGenerateSchema = emailAssistantContextSchema
  .extend({
    userPrompt: z.string().trim().max(2000).optional(),
    sourceText: z.string().trim().max(12000).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasCrmAnchor = Boolean(value.recordId || value.threadId || value.sourceMessageId);
    if (!hasCrmAnchor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recordId"],
        message: "Email AI generation requires a CRM record, email thread, or source email message"
      });
    }
    if (value.purpose === "draft" && !value.userPrompt && !hasCrmAnchor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["userPrompt"],
        message: "Draft generation requires a record, thread, source message, or user prompt"
      });
    }
    if (value.purpose === "translate" && !value.sourceText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceText"],
        message: "Translation requires source email text"
      });
    }
    if (value.purpose === "context_analysis" && !hasCrmAnchor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["threadId"],
        message: "Context analysis requires a CRM record, email thread, or source email message"
      });
    }
    if (value.purpose === "summarize" && !value.threadId && !value.sourceMessageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["threadId"],
        message: "Thread summarization requires an email thread or source email message"
      });
    }
  });

export const knowledgeArticleCreateSchema = z
  .object({
    title: labelSchema,
    body: z.string().trim().min(1),
    tags: z.array(z.string().trim().min(1)).max(50).optional(),
    active: z.boolean().optional()
  })
  .strict();

export const knowledgeArticleUpdateSchema = knowledgeArticleCreateSchema.partial().strict();

export const knowledgeVectorSettingsUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    providerProfileKey: z.string().trim().min(1).max(80).optional(),
    embeddingModel: z.string().trim().min(1).max(160).optional(),
    dimensions: z.number().int().min(128).max(8192).optional(),
    chunkSizeChars: z.number().int().min(200).max(8000).optional(),
    chunkOverlapChars: z.number().int().min(0).max(2000).optional(),
    topK: z.number().int().min(1).max(20).optional(),
    similarityThreshold: z.number().min(0).max(1).optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one vector setting is required"
  })
  .refine((value) => value.chunkOverlapChars === undefined || value.chunkSizeChars === undefined || value.chunkOverlapChars < value.chunkSizeChars, {
    path: ["chunkOverlapChars"],
    message: "chunkOverlapChars must be smaller than chunkSizeChars"
  });

const mediaAssetPayloadSchema = z.object({
  name: labelSchema.max(200),
  contentType: mediaAssetContentTypeSchema,
  size: z.number().int().min(1).max(MAX_MEDIA_ASSET_BYTES),
  contentBase64: z.string().trim().min(1).refine(isValidEmailAttachmentBase64, {
    message: "contentBase64 must be valid base64"
  })
});

export const mediaAssetCreateSchema = mediaAssetPayloadSchema
  .strict()
  .refine((value) => Buffer.from(value.contentBase64, "base64").length <= MAX_MEDIA_ASSET_BYTES, {
    path: ["contentBase64"],
    message: `Media asset must be at most ${MAX_MEDIA_ASSET_BYTES} bytes`
  });

export const mediaAssetUpdateSchema = mediaAssetPayloadSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one media asset field is required"
  })
  .refine((value) => !value.contentBase64 || Buffer.from(value.contentBase64, "base64").length <= MAX_MEDIA_ASSET_BYTES, {
    path: ["contentBase64"],
    message: `Media asset must be at most ${MAX_MEDIA_ASSET_BYTES} bytes`
  });

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
