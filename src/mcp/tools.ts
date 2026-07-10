import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { CrmMcpApiError, type CrmMcpClient } from "@/mcp/client";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const objectKeySchema = z.string().trim().regex(/^[a-z][a-z0-9-]*s$/);
const idSchema = z.string().trim().min(1).max(200);
const smartReminderIdSchema = idSchema.refine((value) => /[A-Za-z_-]/.test(value), "Use a real reminderId returned by crm_get_today_best_actions or crm_list_smart_reminders; do not invent numeric ids.");
const optionalIdSchema = z.union([idSchema, z.literal(""), z.null()]).optional();
const recordFilterSchema = z
  .object({
    field: z.string().trim().min(1),
    operator: z.enum(["contains", "equals"]),
    value: z.string()
  })
  .strict();
const recordSortSchema = z
  .object({
    field: z.string().trim().min(1),
    direction: z.enum(["asc", "desc"])
  })
  .strict();
const recordWriteSchema = z
  .object({
    objectKey: objectKeySchema,
    title: z.string().trim().min(1),
    data: z.record(z.unknown()),
    stageKey: optionalIdSchema,
    ownerId: optionalIdSchema
  })
  .strict();
const changeReasonSchema = z.string().trim().min(1).max(1000).optional();
const metadataKeySchema = z.string().trim().regex(/^[a-z][a-z0-9_]*$/);
const fieldOptionSchema = z.object({ label: z.string().trim().min(1), value: z.string().trim().min(1) }).strict();
const pipelineStageSchema = z
  .object({
    key: z.string().trim().min(1),
    label: z.string().trim().min(1),
    probability: z.number().min(0).max(1),
    position: z.number().int().min(0),
    color: z.string().trim().min(1)
  })
  .strict();
const activityListSchema = z
  .object({
    recordId: idSchema.optional(),
    type: z.enum(["note", "call", "meeting", "task", "email", "stage_change"]).optional(),
    completed: z.boolean().optional(),
    archived: z.boolean().optional(),
    dueFrom: z.string().trim().min(1).optional(),
    dueTo: z.string().trim().min(1).optional()
  })
  .strict();
const emailAddressSchema = z.string().trim().email();
const emailSendSchema = z
  .object({
    accountId: idSchema,
    threadId: idSchema.optional(),
    recordId: idSchema.optional(),
    to: z.array(emailAddressSchema).min(1).max(100),
    cc: z.array(emailAddressSchema).max(100).optional(),
    bcc: z.array(emailAddressSchema).max(100).optional(),
    subject: z.string().trim().min(1).max(200),
    bodyText: z.string().trim().min(1),
    bodyHtml: z.string().trim().optional(),
    signatureId: idSchema.optional(),
    signatureName: z.string().trim().min(1).max(120).optional(),
    scheduledSendAt: z.string().trim().min(1).optional(),
    trackingEnabled: z.boolean().optional(),
    clientRequestId: z.string().trim().min(8).max(120).regex(/^[A-Za-z0-9._:-]+$/).optional()
  })
  .strict();

const schemas = {
  crm_health: z.object({}).strict(),
  crm_sales_daily_briefing: z
    .object({
      date: z.string().trim().min(1).optional(),
      timezoneOffsetMinutes: z.number().int().min(-720).max(840).optional()
    })
    .strict(),
  crm_get_today_best_actions: z.object({ limit: z.number().int().min(1).max(50).optional() }).strict(),
  crm_list_objects: z.object({}).strict(),
  crm_describe_object: z.object({ objectKey: objectKeySchema }).strict(),
  crm_find_contact: z
    .object({
      name: z.string().trim().optional(),
      email: emailAddressSchema.optional(),
      company: z.string().trim().optional(),
      limit: z.number().int().min(1).max(20).optional()
    })
    .strict(),
  crm_count_contacts: z.object({}).strict(),
  crm_list_contacts: z
    .object({
      q: z.string().trim().optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
      pool: z.enum(["public", "private", "all"]).optional()
    })
    .strict(),
  crm_search_records: z
    .object({
      objectKey: objectKeySchema,
      q: z.string().trim().optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
      filters: z.array(recordFilterSchema).max(50).optional(),
      sort: recordSortSchema.optional(),
      fields: z.array(z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)).max(100).optional(),
      pool: z.enum(["public", "private", "all"]).optional(),
      cursor: z.string().trim().min(1).optional(),
      keyset: z.boolean().optional()
    })
    .strict(),
  crm_get_record: z.object({ objectKey: objectKeySchema, recordId: idSchema }).strict(),
  crm_create_record: recordWriteSchema,
  crm_update_record: recordWriteSchema
    .partial({ title: true, data: true, stageKey: true, ownerId: true })
    .extend({
      objectKey: objectKeySchema,
      recordId: idSchema,
      changeReason: changeReasonSchema
    })
    .strict(),
  crm_delete_record: z.object({ objectKey: objectKeySchema, recordId: idSchema, changeReason: changeReasonSchema }).strict(),
  crm_transfer_record: z.object({ objectKey: objectKeySchema, recordId: idSchema, ownerId: z.union([idSchema, z.null()]).optional() }).strict(),
  crm_list_activities: activityListSchema,
  crm_create_activity: z
    .object({
      recordId: optionalIdSchema,
      type: z.enum(["note", "call", "meeting", "task", "email"]),
      title: z.string().trim().min(1),
      body: z.string().trim().optional(),
      dueAt: z.string().trim().min(1).optional(),
      completedAt: z.string().trim().min(1).optional()
    })
    .strict(),
  crm_update_activity: z
    .object({
      activityId: idSchema,
      title: z.string().trim().min(1).optional(),
      body: z.string().trim().optional(),
      dueAt: z.union([z.string().trim().min(1), z.null()]).optional(),
      completedAt: z.union([z.string().trim().min(1), z.null()]).optional(),
      archivedAt: z.union([z.string().trim().min(1), z.null()]).optional()
    })
    .strict(),
  crm_complete_task: z.object({ activityId: idSchema }).strict(),
  crm_delete_activity: z.object({ activityId: idSchema, changeReason: changeReasonSchema }).strict(),
  crm_list_smart_reminders: z
    .object({
      status: z.enum(["open", "done", "dismissed"]).optional(),
      snoozed: z.boolean().optional(),
      kind: z
        .enum(["today_best_action", "follow_up", "overdue", "email_reply", "deal_close", "risk", "portfolio_health", "data_quality", "customer_level", "pipeline_optimization"])
        .optional(),
      objectKey: objectKeySchema.optional(),
      recordId: idSchema.optional(),
      limit: z.number().int().min(1).max(50).optional()
    })
    .strict(),
  crm_generate_smart_reminders: z
    .object({
      objectKey: objectKeySchema.optional(),
      recordId: idSchema.optional(),
      force: z.boolean().optional(),
      daily: z.boolean().optional(),
      confirmRegenerate: z.literal(true)
    })
    .strict(),
  crm_convert_smart_reminder_to_task: z.object({ reminderId: smartReminderIdSchema }).strict(),
  crm_dismiss_duplicate_today_best_actions: z.object({}).strict(),
  crm_update_smart_reminder: z
    .object({
      reminderId: smartReminderIdSchema,
      status: z.enum(["open", "done", "dismissed"]).optional(),
      snoozedUntil: z.union([z.string().trim().min(1), z.literal(""), z.null()]).optional()
    })
    .strict(),
  crm_delete_smart_reminder: z.object({ reminderId: smartReminderIdSchema, changeReason: changeReasonSchema }).strict(),
  crm_ai_query: z.object({ question: z.string().trim().min(1), objectKey: objectKeySchema.optional() }).strict(),
  crm_list_email_accounts: z.object({}).strict(),
  crm_list_email_signatures: z.object({ accountId: idSchema.optional() }).strict(),
  crm_send_email: emailSendSchema,
  crm_list_email_threads: z
    .object({
      recordId: idSchema.optional(),
      mailSearch: z.string().trim().optional()
    })
    .strict(),
  crm_get_email_thread: z.object({ threadId: idSchema }).strict(),
  crm_list_email_messages: z.object({ threadId: idSchema }).strict(),
  crm_update_email_thread: z.object({ threadId: idSchema, recordId: z.union([idSchema, z.null()]).optional() }).strict(),
  crm_update_email_thread_state: z
    .object({
      threadId: idSchema,
      archived: z.boolean().optional(),
      category: z.union([z.enum(["primary", "promotions", "social", "updates"]), z.literal(""), z.null()]).optional(),
      deleted: z.boolean().optional(),
      important: z.boolean().optional(),
      labels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
      read: z.boolean().optional(),
      snoozedUntil: z.union([z.string().trim().min(1), z.literal(""), z.null()]).optional(),
      starred: z.boolean().optional()
    })
    .strict(),
  crm_delete_email_thread: z.object({ threadId: idSchema }).strict(),
  crm_advance_deal_stage: z.object({ dealId: idSchema, stageKey: z.string().trim().min(1), pipelineOrder: z.number().finite().optional() }).strict(),
  crm_claim_record: z.object({ objectKey: objectKeySchema, recordId: idSchema }).strict(),
  crm_release_record: z.object({ objectKey: objectKeySchema, recordId: idSchema }).strict(),
  crm_admin_create_object: z.object({ key: objectKeySchema, label: z.string().trim().min(1), pluralLabel: z.string().trim().min(1), description: z.string().trim().optional(), icon: z.string().trim().optional() }).strict(),
  crm_admin_update_object: z.object({ objectId: idSchema, label: z.string().trim().min(1).optional(), pluralLabel: z.string().trim().min(1).optional(), description: z.string().trim().optional(), icon: z.string().trim().optional() }).strict(),
  crm_admin_delete_object: z.object({ objectId: idSchema }).strict(),
  crm_admin_create_relation: z
    .object({
      fromObjectKey: objectKeySchema,
      toObjectKey: objectKeySchema,
      key: metadataKeySchema,
      label: z.string().trim().min(1),
      cardinality: z.enum(["one-to-one", "one-to-many", "many-to-many"])
    })
    .strict(),
  crm_admin_update_relation: z
    .object({
      relationId: idSchema,
      fromObjectKey: objectKeySchema.optional(),
      toObjectKey: objectKeySchema.optional(),
      key: metadataKeySchema.optional(),
      label: z.string().trim().min(1).optional(),
      cardinality: z.enum(["one-to-one", "one-to-many", "many-to-many"]).optional()
    })
    .strict(),
  crm_admin_delete_relation: z.object({ relationId: idSchema }).strict(),
  crm_admin_create_field: z
    .object({
      objectKey: objectKeySchema,
      key: z.string().trim().min(1),
      label: z.string().trim().min(1),
      type: z.enum(["text", "textarea", "number", "currency", "date", "select", "boolean", "user", "reference"]),
      required: z.boolean(),
      unique: z.boolean(),
      options: z.array(fieldOptionSchema).max(200).optional(),
      defaultValue: z.unknown().optional(),
      position: z.number().int().min(0).optional()
    })
    .strict(),
  crm_admin_update_field: z
    .object({
      fieldId: idSchema,
      label: z.string().trim().min(1).optional(),
      required: z.boolean().optional(),
      unique: z.boolean().optional(),
      options: z.array(fieldOptionSchema).max(200).optional(),
      defaultValue: z.unknown().optional(),
      position: z.number().int().min(0).optional()
    })
    .strict(),
  crm_admin_delete_field: z.object({ fieldId: idSchema }).strict(),
  crm_admin_create_pipeline: z.object({ objectKey: objectKeySchema, name: z.string().trim().min(1), isDefault: z.boolean(), stages: z.array(pipelineStageSchema).min(1).max(50) }).strict(),
  crm_admin_update_pipeline: z.object({ pipelineId: idSchema, objectKey: objectKeySchema.optional(), name: z.string().trim().min(1).optional(), isDefault: z.boolean().optional(), stages: z.array(pipelineStageSchema).min(1).max(50).optional() }).strict(),
  crm_admin_delete_pipeline: z.object({ pipelineId: idSchema }).strict()
};

type BaseCrmMcpToolName = keyof typeof schemas;
const toolAliases = {
  crmSalesDailyBriefing: "crm_sales_daily_briefing",
  crmGetTodayBestActions: "crm_get_today_best_actions",
  crmFindContact: "crm_find_contact",
  crmCountContacts: "crm_count_contacts",
  crmListContacts: "crm_list_contacts",
  crmSearchRecords: "crm_search_records",
  crmGetRecord: "crm_get_record",
  crmListSmartReminders: "crm_list_smart_reminders",
  crmGenerateSmartReminders: "crm_generate_smart_reminders",
  crmDismissDuplicateTodayBestActions: "crm_dismiss_duplicate_today_best_actions",
  crmUpdateSmartReminder: "crm_update_smart_reminder",
  crmDeleteSmartReminder: "crm_delete_smart_reminder",
  crmAiQuery: "crm_ai_query",
  crmListEmailSignatures: "crm_list_email_signatures",
  crmSendEmail: "crm_send_email"
} as const satisfies Record<string, BaseCrmMcpToolName>;

export type CrmMcpToolName = BaseCrmMcpToolName | keyof typeof toolAliases;
type RecordListLike = { records?: unknown[]; total?: unknown };

export const crmMcpToolDefinitions: Array<{
  name: CrmMcpToolName;
  title: string;
  description: string;
  inputSchema: (typeof schemas)[BaseCrmMcpToolName];
}> = [
  { name: "crm_health", title: "CRM health", description: "Check the remote CRM service health.", inputSchema: schemas.crm_health },
  { name: "crm_sales_daily_briefing", title: "Sales daily briefing", description: "Read an existing salesperson-style daily briefing. For ordinary today-best-action questions, use this read-only tool first; it never regenerates reminders.", inputSchema: schemas.crm_sales_daily_briefing },
  { name: "crm_get_today_best_actions", title: "Get today best actions", description: "Directly read existing open today-best-action smart reminders. Use this for user questions asking for today's best actions; it never regenerates reminders.", inputSchema: schemas.crm_get_today_best_actions },
  { name: "crm_list_objects", title: "List CRM objects", description: "List CRM object definitions visible to this API key.", inputSchema: schemas.crm_list_objects },
  { name: "crm_describe_object", title: "Describe CRM object", description: "Return object metadata, fields, relations, and pipelines for one object.", inputSchema: schemas.crm_describe_object },
  { name: "crm_find_contact", title: "Find contact", description: "Find contacts by name, email, or company text and return matching CRM contact records.", inputSchema: schemas.crm_find_contact },
  { name: "crm_count_contacts", title: "Count contacts", description: "Return the visible contacts count. Use this for questions asking how many contact records exist.", inputSchema: schemas.crm_count_contacts },
  { name: "crm_list_contacts", title: "List contacts", description: "List visible contact records directly without requiring objectKey inference.", inputSchema: schemas.crm_list_contacts },
  { name: "crm_search_records", title: "Search CRM records", description: "Search or list CRM records using existing CRM pagination and filters. Use this first for exact business lookups such as contact/company/deal/product/quote name, email, phone, owner, or field value.", inputSchema: schemas.crm_search_records },
  { name: "crm_get_record", title: "Get CRM record", description: "Fetch one CRM record by object key and record id. Use after search when the user asks for specific record details such as a contact email or company fields.", inputSchema: schemas.crm_get_record },
  { name: "crm_create_record", title: "Create CRM record", description: "Create a CRM record through the remote CRM API.", inputSchema: schemas.crm_create_record },
  { name: "crm_update_record", title: "Update CRM record", description: "Update a CRM record; approval responses are returned as-is.", inputSchema: schemas.crm_update_record },
  { name: "crm_delete_record", title: "Delete CRM record", description: "Delete or request deletion of a CRM record, respecting approval rules for contacts, companies, deals, products, and quotes.", inputSchema: schemas.crm_delete_record },
  { name: "crm_transfer_record", title: "Transfer CRM record", description: "Transfer a record owner or release ownership by setting ownerId null, respecting pool/admin permissions.", inputSchema: schemas.crm_transfer_record },
  { name: "crm_list_activities", title: "List CRM activities", description: "List CRM activities and tasks. Use type=task, completed=false, archived=false, and dueFrom/dueTo for today's tasks.", inputSchema: schemas.crm_list_activities },
  { name: "crm_create_activity", title: "Create CRM activity", description: "Create a note, call, meeting, task, or email activity.", inputSchema: schemas.crm_create_activity },
  { name: "crm_update_activity", title: "Update CRM activity", description: "Update an activity or task status.", inputSchema: schemas.crm_update_activity },
  { name: "crm_complete_task", title: "Complete task", description: "Mark a CRM task/activity complete using the current time.", inputSchema: schemas.crm_complete_task },
  { name: "crm_delete_activity", title: "Delete activity", description: "Delete or request deletion of an activity/task through the CRM approval path.", inputSchema: schemas.crm_delete_activity },
  { name: "crm_list_smart_reminders", title: "List smart reminders", description: "Read existing CRM smart reminders, including today's best actions. For ordinary today-best-action questions, use status=open, snoozed=false, kind=today_best_action. Do not generate unless the user explicitly asks to regenerate or refresh.", inputSchema: schemas.crm_list_smart_reminders },
  { name: "crm_generate_smart_reminders", title: "Regenerate smart reminders", description: "Regenerate or refresh smart reminders only when the user explicitly asks to regenerate, refresh, recalculate, or create new best actions. Do not use for ordinary today-best-action questions. Set confirmRegenerate=true only for explicit regeneration requests. Requires ai.use permission.", inputSchema: schemas.crm_generate_smart_reminders },
  { name: "crm_convert_smart_reminder_to_task", title: "Convert reminder to task", description: "Convert a smart reminder / today's best action into a concrete CRM task.", inputSchema: schemas.crm_convert_smart_reminder_to_task },
  { name: "crm_dismiss_duplicate_today_best_actions", title: "Dismiss duplicate today best actions", description: "Remove duplicate generated today-best-action reminders without requiring manual reminder ids. Use this when the user asks to delete, remove, or dismiss duplicate today's best action prompts.", inputSchema: schemas.crm_dismiss_duplicate_today_best_actions },
  { name: "crm_update_smart_reminder", title: "Update smart reminder", description: "Mark a real smart reminder open/done/dismissed or snooze it. Only use reminderId values returned in reminders by crm_get_today_best_actions or crm_list_smart_reminders; never invent ids from titles or positions.", inputSchema: schemas.crm_update_smart_reminder },
  { name: "crm_delete_smart_reminder", title: "Delete smart reminder", description: "Request deletion of a real smart reminder through the CRM approval path. Only use reminderId values returned in reminders by crm_get_today_best_actions or crm_list_smart_reminders; never invent ids.", inputSchema: schemas.crm_delete_smart_reminder },
  { name: "crm_ai_query", title: "Ask CRM AI query", description: "Ask a read-only analytical CRM question through /api/ai/query. Do not use this for exact record lookups; use crm_search_records and crm_get_record for contacts, companies, deals, products, quotes, tasks, and emails.", inputSchema: schemas.crm_ai_query },
  { name: "crm_list_email_accounts", title: "List email accounts", description: "List available email sending accounts so a salesperson can choose an accountId before sending mail.", inputSchema: schemas.crm_list_email_accounts },
  { name: "crm_list_email_signatures", title: "List email signatures", description: "List available CRM email signature templates. Use this before sending when the user asks to use a named signature such as Cigafun.", inputSchema: schemas.crm_list_email_signatures },
  { name: "crm_send_email", title: "Send CRM email", description: "Send or schedule an outbound CRM email through the normal CRM email queue, policies, permissions, tracking, and audit path. When the user says to use a named signature, pass signatureName, for example signatureName=\"Cigafun\"; do not type the signature name manually in bodyText.", inputSchema: schemas.crm_send_email },
  { name: "crm_list_email_threads", title: "List email threads", description: "List visible CRM email threads without modifying mail state.", inputSchema: schemas.crm_list_email_threads },
  { name: "crm_get_email_thread", title: "Get email thread", description: "Fetch one visible email thread.", inputSchema: schemas.crm_get_email_thread },
  { name: "crm_list_email_messages", title: "List email messages", description: "List messages in one visible email thread.", inputSchema: schemas.crm_list_email_messages },
  { name: "crm_update_email_thread", title: "Link email thread", description: "Link or unlink an email thread to a CRM record by setting recordId or null.", inputSchema: schemas.crm_update_email_thread },
  { name: "crm_update_email_thread_state", title: "Update email thread state", description: "Archive, trash, star, mark read, label, categorize, or snooze an email thread.", inputSchema: schemas.crm_update_email_thread_state },
  { name: "crm_delete_email_thread", title: "Delete email thread", description: "Delete an email thread through the CRM email API; requires normal write permission.", inputSchema: schemas.crm_delete_email_thread },
  { name: "crm_advance_deal_stage", title: "Advance deal stage", description: "Move a deal to another pipeline stage through the CRM stage update API.", inputSchema: schemas.crm_advance_deal_stage },
  { name: "crm_claim_record", title: "Claim CRM record", description: "Claim a public pool contact or company record as the salesperson, respecting pool limits.", inputSchema: schemas.crm_claim_record },
  { name: "crm_release_record", title: "Release CRM record", description: "Release an owned contact or company record back to the public pool.", inputSchema: schemas.crm_release_record },
  { name: "crm_admin_create_object", title: "Admin create object", description: "Admin: create a custom CRM object definition.", inputSchema: schemas.crm_admin_create_object },
  { name: "crm_admin_update_object", title: "Admin update object", description: "Admin: update a CRM object definition.", inputSchema: schemas.crm_admin_update_object },
  { name: "crm_admin_delete_object", title: "Admin delete object", description: "Admin: delete a CRM object definition when records or references do not block it.", inputSchema: schemas.crm_admin_delete_object },
  { name: "crm_admin_create_relation", title: "Admin create relation", description: "Admin: create a CRM relation definition between two objects.", inputSchema: schemas.crm_admin_create_relation },
  { name: "crm_admin_update_relation", title: "Admin update relation", description: "Admin: update a CRM relation definition.", inputSchema: schemas.crm_admin_update_relation },
  { name: "crm_admin_delete_relation", title: "Admin delete relation", description: "Admin: delete a CRM relation definition when existing data does not block it.", inputSchema: schemas.crm_admin_delete_relation },
  { name: "crm_admin_create_field", title: "Admin create field", description: "Admin: create a field definition for a CRM object.", inputSchema: schemas.crm_admin_create_field },
  { name: "crm_admin_update_field", title: "Admin update field", description: "Admin: update a field definition.", inputSchema: schemas.crm_admin_update_field },
  { name: "crm_admin_delete_field", title: "Admin delete field", description: "Admin: delete a field definition when data and views allow it.", inputSchema: schemas.crm_admin_delete_field },
  { name: "crm_admin_create_pipeline", title: "Admin create pipeline", description: "Admin: create a CRM pipeline.", inputSchema: schemas.crm_admin_create_pipeline },
  { name: "crm_admin_update_pipeline", title: "Admin update pipeline", description: "Admin: update a CRM pipeline and stages.", inputSchema: schemas.crm_admin_update_pipeline },
  { name: "crm_admin_delete_pipeline", title: "Admin delete pipeline", description: "Admin: delete a CRM pipeline when records do not depend on it.", inputSchema: schemas.crm_admin_delete_pipeline },
  { name: "crmSalesDailyBriefing", title: "Sales daily briefing alias", description: "Alias of crm_sales_daily_briefing for clients that prefer camelCase tool names.", inputSchema: schemas.crm_sales_daily_briefing },
  { name: "crmGetTodayBestActions", title: "Get today best actions alias", description: "Alias of crm_get_today_best_actions for clients that prefer camelCase tool names.", inputSchema: schemas.crm_get_today_best_actions },
  { name: "crmFindContact", title: "Find contact alias", description: "Alias of crm_find_contact for clients that prefer camelCase tool names.", inputSchema: schemas.crm_find_contact },
  { name: "crmCountContacts", title: "Count contacts alias", description: "Alias of crm_count_contacts for clients that prefer camelCase tool names.", inputSchema: schemas.crm_count_contacts },
  { name: "crmListContacts", title: "List contacts alias", description: "Alias of crm_list_contacts for clients that prefer camelCase tool names.", inputSchema: schemas.crm_list_contacts },
  { name: "crmSearchRecords", title: "Search CRM records alias", description: "Alias of crm_search_records for clients that prefer camelCase tool names.", inputSchema: schemas.crm_search_records },
  { name: "crmGetRecord", title: "Get CRM record alias", description: "Alias of crm_get_record for clients that prefer camelCase tool names.", inputSchema: schemas.crm_get_record },
  { name: "crmListSmartReminders", title: "List smart reminders alias", description: "Alias of crm_list_smart_reminders for clients that prefer camelCase tool names.", inputSchema: schemas.crm_list_smart_reminders },
  { name: "crmGenerateSmartReminders", title: "Regenerate smart reminders alias", description: "Alias of crm_generate_smart_reminders for clients that prefer camelCase tool names.", inputSchema: schemas.crm_generate_smart_reminders },
  { name: "crmDismissDuplicateTodayBestActions", title: "Dismiss duplicate today best actions alias", description: "Alias of crm_dismiss_duplicate_today_best_actions for clients that prefer camelCase tool names.", inputSchema: schemas.crm_dismiss_duplicate_today_best_actions },
  { name: "crmUpdateSmartReminder", title: "Update smart reminder alias", description: "Alias of crm_update_smart_reminder for clients that prefer camelCase tool names.", inputSchema: schemas.crm_update_smart_reminder },
  { name: "crmDeleteSmartReminder", title: "Delete smart reminder alias", description: "Alias of crm_delete_smart_reminder for clients that prefer camelCase tool names.", inputSchema: schemas.crm_delete_smart_reminder },
  { name: "crmAiQuery", title: "Ask CRM AI query alias", description: "Alias of crm_ai_query for clients that prefer camelCase tool names.", inputSchema: schemas.crm_ai_query },
  { name: "crmListEmailSignatures", title: "List email signatures alias", description: "Alias of crm_list_email_signatures for clients that prefer camelCase tool names.", inputSchema: schemas.crm_list_email_signatures },
  { name: "crmSendEmail", title: "Send CRM email alias", description: "Alias of crm_send_email for clients that prefer camelCase tool names.", inputSchema: schemas.crm_send_email }
];

export async function executeCrmMcpTool(name: CrmMcpToolName, rawArgs: unknown, client: CrmMcpClient): Promise<CallToolResult> {
  try {
    const canonicalName = canonicalToolName(name);
    const args = schemas[canonicalName].parse(rawArgs ?? {});
    const data = await dispatchTool(canonicalName, args, client);
    return toToolResult(data);
  } catch (error) {
    return toToolErrorResult(error);
  }
}

function canonicalToolName(name: CrmMcpToolName): BaseCrmMcpToolName {
  return name in toolAliases ? toolAliases[name as keyof typeof toolAliases] : (name as BaseCrmMcpToolName);
}

async function dispatchTool(name: BaseCrmMcpToolName, args: z.infer<(typeof schemas)[BaseCrmMcpToolName]>, client: CrmMcpClient): Promise<unknown> {
  switch (name) {
    case "crm_health":
      return client.get("/api/health");
    case "crm_sales_daily_briefing":
      return salesDailyBriefing(client, args as z.infer<typeof schemas.crm_sales_daily_briefing>);
    case "crm_get_today_best_actions":
      return getTodayBestActions(client, args as z.infer<typeof schemas.crm_get_today_best_actions>);
    case "crm_list_objects":
      return client.get("/api/object-definitions");
    case "crm_describe_object":
      return describeObject(client, args as z.infer<typeof schemas.crm_describe_object>);
    case "crm_find_contact":
      return findContact(client, args as z.infer<typeof schemas.crm_find_contact>);
    case "crm_count_contacts":
      return countContacts(client);
    case "crm_list_contacts":
      return listContacts(client, args as z.infer<typeof schemas.crm_list_contacts>);
    case "crm_search_records":
      return searchRecords(client, args as z.infer<typeof schemas.crm_search_records>);
    case "crm_get_record": {
      const input = args as z.infer<typeof schemas.crm_get_record>;
      return client.get(`/api/records/${encodeURIComponent(input.objectKey)}/${encodeURIComponent(input.recordId)}`);
    }
    case "crm_create_record": {
      const input = args as z.infer<typeof schemas.crm_create_record>;
      return client.post(`/api/records/${encodeURIComponent(input.objectKey)}`, stripUndefined({ title: input.title, data: input.data, stageKey: input.stageKey, ownerId: input.ownerId }));
    }
    case "crm_update_record": {
      const input = args as z.infer<typeof schemas.crm_update_record>;
      return client.patch(
        `/api/records/${encodeURIComponent(input.objectKey)}/${encodeURIComponent(input.recordId)}`,
        stripUndefined({ title: input.title, data: input.data, stageKey: input.stageKey, ownerId: input.ownerId, changeReason: input.changeReason })
      );
    }
    case "crm_delete_record": {
      const input = args as z.infer<typeof schemas.crm_delete_record>;
      return client.delete(`/api/records/${encodeURIComponent(input.objectKey)}/${encodeURIComponent(input.recordId)}`, stripUndefined({ changeReason: input.changeReason }));
    }
    case "crm_transfer_record": {
      const input = args as z.infer<typeof schemas.crm_transfer_record>;
      return client.post(`/api/records/${encodeURIComponent(input.objectKey)}/${encodeURIComponent(input.recordId)}/transfer`, stripUndefined({ ownerId: input.ownerId }));
    }
    case "crm_list_activities":
      return client.get("/api/activities", { query: args as z.infer<typeof schemas.crm_list_activities> });
    case "crm_create_activity":
      return client.post("/api/activities", stripUndefined(args as z.infer<typeof schemas.crm_create_activity>));
    case "crm_update_activity": {
      const input = args as z.infer<typeof schemas.crm_update_activity>;
      return client.patch(`/api/activities/${encodeURIComponent(input.activityId)}`, stripUndefined({ ...input, activityId: undefined }));
    }
    case "crm_complete_task": {
      const input = args as z.infer<typeof schemas.crm_complete_task>;
      return client.patch(`/api/activities/${encodeURIComponent(input.activityId)}`, { completedAt: new Date().toISOString() });
    }
    case "crm_delete_activity": {
      const input = args as z.infer<typeof schemas.crm_delete_activity>;
      return client.delete(`/api/activities/${encodeURIComponent(input.activityId)}`, stripUndefined({ changeReason: input.changeReason }));
    }
    case "crm_list_smart_reminders":
      return listSmartReminders(client, args as z.infer<typeof schemas.crm_list_smart_reminders>);
    case "crm_generate_smart_reminders":
      return generateSmartReminders(client, args as z.infer<typeof schemas.crm_generate_smart_reminders>);
    case "crm_convert_smart_reminder_to_task": {
      const input = args as z.infer<typeof schemas.crm_convert_smart_reminder_to_task>;
      return client.post(`/api/smart-reminders/${encodeURIComponent(input.reminderId)}/convert-task`);
    }
    case "crm_dismiss_duplicate_today_best_actions":
      return dismissDuplicateTodayBestActions(client);
    case "crm_update_smart_reminder": {
      const input = args as z.infer<typeof schemas.crm_update_smart_reminder>;
      return client.patch(`/api/smart-reminders/${encodeURIComponent(input.reminderId)}`, stripUndefined({ status: input.status, snoozedUntil: input.snoozedUntil }));
    }
    case "crm_delete_smart_reminder": {
      const input = args as z.infer<typeof schemas.crm_delete_smart_reminder>;
      return client.delete(`/api/smart-reminders/${encodeURIComponent(input.reminderId)}`, stripUndefined({ changeReason: input.changeReason }));
    }
    case "crm_ai_query":
      return client.post("/api/ai/query", args);
    case "crm_list_email_accounts":
      return client.get("/api/email/accounts");
    case "crm_list_email_signatures":
      return listEmailSignatures(client, args as z.infer<typeof schemas.crm_list_email_signatures>);
    case "crm_send_email":
      return sendEmail(client, args as z.infer<typeof schemas.crm_send_email>);
    case "crm_list_email_threads":
      return client.get("/api/email/threads", { query: args as z.infer<typeof schemas.crm_list_email_threads> });
    case "crm_get_email_thread": {
      const input = args as z.infer<typeof schemas.crm_get_email_thread>;
      return client.get(`/api/email/threads/${encodeURIComponent(input.threadId)}`);
    }
    case "crm_list_email_messages": {
      const input = args as z.infer<typeof schemas.crm_list_email_messages>;
      return client.get(`/api/email/threads/${encodeURIComponent(input.threadId)}/messages`);
    }
    case "crm_update_email_thread": {
      const input = args as z.infer<typeof schemas.crm_update_email_thread>;
      return client.patch(`/api/email/threads/${encodeURIComponent(input.threadId)}`, stripUndefined({ recordId: input.recordId }));
    }
    case "crm_update_email_thread_state": {
      const input = args as z.infer<typeof schemas.crm_update_email_thread_state>;
      return client.patch(`/api/email/threads/${encodeURIComponent(input.threadId)}/state`, stripUndefined({ ...input, threadId: undefined }));
    }
    case "crm_delete_email_thread": {
      const input = args as z.infer<typeof schemas.crm_delete_email_thread>;
      return client.delete(`/api/email/threads/${encodeURIComponent(input.threadId)}`);
    }
    case "crm_advance_deal_stage": {
      const input = args as z.infer<typeof schemas.crm_advance_deal_stage>;
      return client.patch(`/api/records/deals/${encodeURIComponent(input.dealId)}/stage`, stripUndefined({ stageKey: input.stageKey, pipelineOrder: input.pipelineOrder }));
    }
    case "crm_claim_record": {
      const input = args as z.infer<typeof schemas.crm_claim_record>;
      return client.post(`/api/records/${encodeURIComponent(input.objectKey)}/${encodeURIComponent(input.recordId)}/claim`);
    }
    case "crm_release_record": {
      const input = args as z.infer<typeof schemas.crm_release_record>;
      return client.post(`/api/records/${encodeURIComponent(input.objectKey)}/${encodeURIComponent(input.recordId)}/release`);
    }
    case "crm_admin_create_object":
      return client.post("/api/object-definitions", stripUndefined(args as z.infer<typeof schemas.crm_admin_create_object>));
    case "crm_admin_update_object": {
      const input = args as z.infer<typeof schemas.crm_admin_update_object>;
      return client.patch(`/api/object-definitions/${encodeURIComponent(input.objectId)}`, stripUndefined({ ...input, objectId: undefined }));
    }
    case "crm_admin_delete_object": {
      const input = args as z.infer<typeof schemas.crm_admin_delete_object>;
      return client.delete(`/api/object-definitions/${encodeURIComponent(input.objectId)}`);
    }
    case "crm_admin_create_relation":
      return client.post("/api/relation-definitions", stripUndefined(args as z.infer<typeof schemas.crm_admin_create_relation>));
    case "crm_admin_update_relation": {
      const input = args as z.infer<typeof schemas.crm_admin_update_relation>;
      return client.patch(`/api/relation-definitions/${encodeURIComponent(input.relationId)}`, stripUndefined({ ...input, relationId: undefined }));
    }
    case "crm_admin_delete_relation": {
      const input = args as z.infer<typeof schemas.crm_admin_delete_relation>;
      return client.delete(`/api/relation-definitions/${encodeURIComponent(input.relationId)}`);
    }
    case "crm_admin_create_field":
      return client.post("/api/field-definitions", stripUndefined(args as z.infer<typeof schemas.crm_admin_create_field>));
    case "crm_admin_update_field": {
      const input = args as z.infer<typeof schemas.crm_admin_update_field>;
      return client.patch(`/api/field-definitions/${encodeURIComponent(input.fieldId)}`, stripUndefined({ ...input, fieldId: undefined }));
    }
    case "crm_admin_delete_field": {
      const input = args as z.infer<typeof schemas.crm_admin_delete_field>;
      return client.delete(`/api/field-definitions/${encodeURIComponent(input.fieldId)}`);
    }
    case "crm_admin_create_pipeline":
      return client.post("/api/pipelines", stripUndefined(args as z.infer<typeof schemas.crm_admin_create_pipeline>));
    case "crm_admin_update_pipeline": {
      const input = args as z.infer<typeof schemas.crm_admin_update_pipeline>;
      return client.patch(`/api/pipelines/${encodeURIComponent(input.pipelineId)}`, stripUndefined({ ...input, pipelineId: undefined }));
    }
    case "crm_admin_delete_pipeline": {
      const input = args as z.infer<typeof schemas.crm_admin_delete_pipeline>;
      return client.delete(`/api/pipelines/${encodeURIComponent(input.pipelineId)}`);
    }
    default:
      throw new Error(`Unsupported MCP tool: ${name satisfies never}`);
  }
}

async function describeObject(client: CrmMcpClient, input: z.infer<typeof schemas.crm_describe_object>): Promise<unknown> {
  const [objects, fields, relations, pipelines] = await Promise.all([
    client.get<Array<{ key: string }>>("/api/object-definitions"),
    client.get("/api/field-definitions", { query: { objectKey: input.objectKey } }),
    client.get<Array<{ fromObjectKey: string; toObjectKey: string }>>("/api/relation-definitions"),
    client.get<Array<{ objectKey: string }>>("/api/pipelines")
  ]);
  const object = objects.find((candidate) => candidate.key === input.objectKey);
  return {
    object,
    fields,
    relations: relations.filter((relation) => relation.fromObjectKey === input.objectKey || relation.toObjectKey === input.objectKey),
    pipelines: pipelines.filter((pipeline) => pipeline.objectKey === input.objectKey)
  };
}

async function salesDailyBriefing(client: CrmMcpClient, input: z.infer<typeof schemas.crm_sales_daily_briefing>): Promise<unknown> {
  const { start, end } = dayBounds(input.date, input.timezoneOffsetMinutes);
  const [bestActions, todayTasks, overdueTasks, recentEmailThreads] = await Promise.all([
    client.get("/api/smart-reminders", { query: { status: "open", snoozed: false, kind: "today_best_action" } }),
    client.get("/api/activities", { query: { type: "task", completed: false, archived: false, dueFrom: start, dueTo: end } }),
    client.get("/api/activities", { query: { type: "task", completed: false, archived: false, dueTo: start } }),
    client.get("/api/email/threads")
  ]);

  return {
    date: start.slice(0, 10),
    window: { start, end },
    bestActions,
    todayTasks,
    overdueTasks,
    recentEmailThreads: Array.isArray(recentEmailThreads) ? recentEmailThreads.slice(0, 10) : recentEmailThreads
  };
}

async function getTodayBestActions(client: CrmMcpClient, input: z.infer<typeof schemas.crm_get_today_best_actions>): Promise<unknown> {
  const limit = input.limit ?? 10;
  const reminders = await client.get("/api/smart-reminders", { query: { status: "open", snoozed: false, kind: "today_best_action", limit } });
  if (!Array.isArray(reminders)) {
    return reminders;
  }
  if (reminders.length > 0) {
    return { source: "generated_smart_reminders", reminders, count: reminders.length };
  }

  const { start, end } = dayBounds(undefined);
  const [todayTasksResult, overdueTasksResult, contactsResult, dealsResult] = await Promise.allSettled([
    client.get("/api/activities", { query: { type: "task", completed: false, archived: false, dueFrom: start, dueTo: end } }),
    client.get("/api/activities", { query: { type: "task", completed: false, archived: false, dueTo: start } }),
    client.get("/api/records/contacts", { query: { page: 1, pageSize: Math.min(5, limit), pool: "all", fields: ["email", "phone", "company", "jobTitle"] } }),
    client.get("/api/records/deals", { query: { page: 1, pageSize: Math.min(5, limit), pool: "all" } })
  ]);
  const todayTasks = settledValue(todayTasksResult);
  const overdueTasks = settledValue(overdueTasksResult);
  const contacts = settledValue(contactsResult);
  const deals = settledValue(dealsResult);
  const todayTaskItems = asArray(todayTasks).slice(0, limit);
  const overdueTaskItems = asArray(overdueTasks).slice(0, limit);
  const contactList = asRecordList(contacts);
  const dealList = asRecordList(deals);
  const fallbackActions = [
    ...overdueTaskItems.map((item) => ({ kind: "overdue_task", title: titleOf(item, "Follow up overdue task"), source: item })),
    ...todayTaskItems.map((item) => ({ kind: "today_task", title: titleOf(item, "Complete today's task"), source: item })),
    ...dealList.records.slice(0, Math.max(0, limit - overdueTaskItems.length - todayTaskItems.length)).map((item) => ({ kind: "deal_follow_up", title: titleOf(item, "Review open deal"), source: item })),
    ...contactList.records.slice(0, Math.max(0, limit - overdueTaskItems.length - todayTaskItems.length - dealList.records.length)).map((item) => ({ kind: "contact_follow_up", title: titleOf(item, "Review contact"), source: item }))
  ].slice(0, limit);

  return {
    source: "crm_read_fallback",
    reminders: [],
    count: 0,
    fallbackActions,
    diagnostics: {
      todayTaskCount: todayTaskItems.length,
      overdueTaskCount: overdueTaskItems.length,
      visibleContactTotal: contactList.total,
      visibleDealTotal: dealList.total,
      errors: [settledError(todayTasksResult, "todayTasks"), settledError(overdueTasksResult, "overdueTasks"), settledError(contactsResult, "contacts"), settledError(dealsResult, "deals")].filter(Boolean)
    },
    emptyState: "No generated today-best-action reminders exist. fallbackActions are read-only CRM candidates, not smart reminder ids. Do not call crm_update_smart_reminder unless the user first selects a real reminder id returned in reminders."
  };
}

function findContact(client: CrmMcpClient, input: z.infer<typeof schemas.crm_find_contact>): Promise<unknown> {
  const q = input.email ?? input.name ?? input.company ?? "";
  return client.get("/api/records/contacts", {
    query: {
      q,
      pageSize: input.limit ?? 10,
      fields: ["email", "phone", "company", "companyId", "contactMethods", "jobTitle", "country"],
      pool: "all"
    }
  });
}

async function countContacts(client: CrmMcpClient): Promise<unknown> {
  const result = await client.get("/api/records/contacts", { query: { pageSize: 1, page: 1, pool: "all" } });
  if (result && typeof result === "object" && "total" in result) {
    return { objectKey: "contacts", total: (result as { total: unknown }).total };
  }
  return result;
}

function listContacts(client: CrmMcpClient, input: z.infer<typeof schemas.crm_list_contacts>): Promise<unknown> {
  return client.get("/api/records/contacts", {
    query: {
      q: input.q,
      page: input.page,
      pageSize: input.pageSize ?? defaultPageSize(),
      pool: input.pool ?? "all",
      fields: ["email", "phone", "company", "companyId", "contactMethods", "jobTitle", "country"]
    }
  });
}

async function dismissDuplicateTodayBestActions(client: CrmMcpClient): Promise<unknown> {
  const reminders = await client.get("/api/smart-reminders", { query: { status: "open", snoozed: false, kind: "today_best_action", limit: 50 } });
  if (!Array.isArray(reminders) || reminders.length === 0) {
    return { dismissed: [], kept: [], count: 0, emptyState: "No generated open today-best-action reminders exist, so there are no duplicates to dismiss." };
  }
  const seen = new Set<string>();
  const kept: unknown[] = [];
  const duplicates: Array<{ id: string; title: string }> = [];
  for (const reminder of reminders) {
    const title = titleOf(reminder, "today_best_action");
    const key = normalizeDuplicateKey(title);
    const id = idOf(reminder);
    if (!seen.has(key)) {
      seen.add(key);
      kept.push(reminder);
    } else if (id) {
      duplicates.push({ id, title });
    }
  }
  const dismissed = [];
  for (const duplicate of duplicates) {
    const result = await client.patch(`/api/smart-reminders/${encodeURIComponent(duplicate.id)}`, { status: "dismissed", snoozedUntil: null });
    dismissed.push({ ...duplicate, result });
  }
  return { dismissed, kept, count: dismissed.length };
}

function settledValue(result: PromiseSettledResult<unknown>): unknown {
  return result.status === "fulfilled" ? result.value : undefined;
}

function settledError(result: PromiseSettledResult<unknown>, scope: string): { scope: string; message: string } | undefined {
  return result.status === "rejected" ? { scope, message: result.reason instanceof Error ? result.reason.message : String(result.reason) } : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecordList(value: unknown): { records: unknown[]; total: unknown } {
  if (value && typeof value === "object") {
    const list = value as RecordListLike;
    return { records: Array.isArray(list.records) ? list.records : [], total: list.total ?? 0 };
  }
  return { records: [], total: 0 };
}

function titleOf(value: unknown, fallback: string): string {
  if (value && typeof value === "object") {
    const record = value as { title?: unknown; subject?: unknown; name?: unknown };
    return String(record.title ?? record.subject ?? record.name ?? fallback);
  }
  return fallback;
}

function idOf(value: unknown): string | undefined {
  if (value && typeof value === "object") {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id.trim() ? id : undefined;
  }
  return undefined;
}

function normalizeDuplicateKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function generateSmartReminders(client: CrmMcpClient, input: z.infer<typeof schemas.crm_generate_smart_reminders>): Promise<unknown> {
  return client.post(
    "/api/smart-reminders/generate",
    stripUndefined({ objectKey: input.objectKey, recordId: input.recordId, force: input.force, daily: input.daily })
  );
}

async function listSmartReminders(client: CrmMcpClient, input: z.infer<typeof schemas.crm_list_smart_reminders>): Promise<unknown> {
  const reminders = await client.get("/api/smart-reminders", { query: input });
  if (!Array.isArray(reminders)) {
    return reminders;
  }

  const isTodayBestActionQuery = input.kind === "today_best_action";
  return {
    reminders,
    count: reminders.length,
    ...(reminders.length === 0
      ? {
          emptyState: isTodayBestActionQuery
            ? "No existing generated today-best-action reminders were found. This does not prove there is no work to do. Ask the user whether to regenerate/refresh best actions before calling crm_generate_smart_reminders."
            : "No existing smart reminders matched the filters."
        }
      : {})
  };
}

function searchRecords(client: CrmMcpClient, input: z.infer<typeof schemas.crm_search_records>): Promise<unknown> {
  return client.get(`/api/records/${encodeURIComponent(input.objectKey)}`, {
    query: {
      q: input.q,
      page: input.page,
      pageSize: input.pageSize ?? defaultPageSize(),
      filters: input.filters,
      sortField: input.sort?.field,
      sortDirection: input.sort?.direction,
      fields: input.fields,
      pool: input.pool,
      cursor: input.cursor,
      keyset: input.keyset ? "1" : undefined
    }
  });
}

async function listEmailSignatures(client: CrmMcpClient, input: z.infer<typeof schemas.crm_list_email_signatures>): Promise<unknown> {
  const signatures = await client.get("/api/email/signatures");
  if (!input.accountId || !Array.isArray(signatures)) {
    return signatures;
  }
  return signatures.filter((signature) => {
    if (!signature || typeof signature !== "object") {
      return false;
    }
    const accountId = (signature as { accountId?: unknown }).accountId;
    return accountId === undefined || accountId === null || accountId === input.accountId;
  });
}

function sendEmail(client: CrmMcpClient, input: z.infer<typeof schemas.crm_send_email>): Promise<unknown> {
  return client.post(
    "/api/email/send",
    stripUndefined({
      ...input,
      clientRequestId: input.clientRequestId ?? createEmailClientRequestId(input)
    })
  );
}

function createEmailClientRequestId(input: z.infer<typeof schemas.crm_send_email>): string {
  const stablePayload = {
    accountId: input.accountId,
    to: input.to.map((email) => email.toLowerCase()),
    cc: input.cc?.map((email) => email.toLowerCase()),
    bcc: input.bcc?.map((email) => email.toLowerCase()),
    subject: input.subject,
    bodyText: input.bodyText,
    bodyHtml: input.bodyHtml,
    signatureId: input.signatureId,
    signatureName: input.signatureName?.toLowerCase(),
    scheduledSendAt: input.scheduledSendAt
  };
  const digest = createHash("sha256").update(JSON.stringify(stablePayload)).digest("hex").slice(0, 48);
  return `mcp:${digest}`;
}

function dayBounds(dateInput: string | undefined, timezoneOffsetMinutes = -new Date().getTimezoneOffset()): { start: string; end: string } {
  const now = new Date();
  const base = dateInput ? new Date(dateInput) : now;
  const offsetMs = timezoneOffsetMinutes * 60_000;
  const local = new Date(base.getTime() + offsetMs);
  const startLocal = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 0, 0, 0, 0));
  const endLocal = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 23, 59, 59, 999));
  return {
    start: new Date(startLocal.getTime() - offsetMs).toISOString(),
    end: new Date(endLocal.getTime() - offsetMs).toISOString()
  };
}

function defaultPageSize(): number {
  const configured = Number(process.env.MCP_CRM_DEFAULT_PAGE_SIZE);
  if (Number.isInteger(configured) && configured > 0) {
    return Math.min(configured, MAX_PAGE_SIZE);
  }
  return DEFAULT_PAGE_SIZE;
}

function toToolResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    ...(isStructuredContent(data) ? { structuredContent: data } : {})
  };
}

function toToolErrorResult(error: unknown): CallToolResult {
  const payload =
    error instanceof CrmMcpApiError
      ? {
          error: error.message,
          code: error.code,
          status: error.status,
          method: error.method,
          path: error.path,
          details: error.details
        }
      : error instanceof z.ZodError
        ? { error: "Invalid MCP tool arguments", code: "VALIDATION_ERROR", details: error.flatten() }
        : error instanceof Error
          ? { error: error.message }
          : { error: "Unknown MCP tool error" };

  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload
  };
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function isStructuredContent(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
