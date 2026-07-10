import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CrmMcpApiError, type CrmMcpClient } from "@/mcp/client";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const objectKeySchema = z.string().trim().regex(/^[a-z][a-z0-9-]*s$/);
const idSchema = z.string().trim().min(1).max(200);
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
      changeReason: z.string().trim().min(1).max(1000).optional()
    })
    .strict(),
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
  crm_list_smart_reminders: z
    .object({
      status: z.enum(["open", "done", "dismissed"]).optional(),
      snoozed: z.boolean().optional(),
      kind: z
        .enum(["today_best_action", "follow_up", "overdue", "email_reply", "deal_close", "risk", "portfolio_health", "data_quality", "customer_level", "pipeline_optimization"])
        .optional(),
      objectKey: objectKeySchema.optional(),
      recordId: idSchema.optional()
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
  crm_convert_smart_reminder_to_task: z.object({ reminderId: idSchema }).strict(),
  crm_ai_query: z.object({ question: z.string().trim().min(1), objectKey: objectKeySchema.optional() }).strict(),
  crm_list_email_accounts: z.object({}).strict(),
  crm_send_email: emailSendSchema,
  crm_list_email_threads: z
    .object({
      recordId: idSchema.optional(),
      mailSearch: z.string().trim().optional()
    })
    .strict(),
  crm_get_email_thread: z.object({ threadId: idSchema }).strict(),
  crm_list_email_messages: z.object({ threadId: idSchema }).strict(),
  crm_advance_deal_stage: z.object({ dealId: idSchema, stageKey: z.string().trim().min(1), pipelineOrder: z.number().finite().optional() }).strict(),
  crm_claim_record: z.object({ objectKey: objectKeySchema, recordId: idSchema }).strict(),
  crm_release_record: z.object({ objectKey: objectKeySchema, recordId: idSchema }).strict()
};

export type CrmMcpToolName = keyof typeof schemas;

export const crmMcpToolDefinitions: Array<{
  name: CrmMcpToolName;
  title: string;
  description: string;
  inputSchema: (typeof schemas)[CrmMcpToolName];
}> = [
  { name: "crm_health", title: "CRM health", description: "Check the remote CRM service health.", inputSchema: schemas.crm_health },
  { name: "crm_sales_daily_briefing", title: "Sales daily briefing", description: "Read an existing salesperson-style daily briefing. For 'today's best actions' or '今日最佳行动', use this read-only tool first; it never regenerates reminders.", inputSchema: schemas.crm_sales_daily_briefing },
  { name: "crm_list_objects", title: "List CRM objects", description: "List CRM object definitions visible to this API key.", inputSchema: schemas.crm_list_objects },
  { name: "crm_describe_object", title: "Describe CRM object", description: "Return object metadata, fields, relations, and pipelines for one object.", inputSchema: schemas.crm_describe_object },
  { name: "crm_find_contact", title: "Find contact", description: "Find contacts by name, email, or company text and return matching CRM contact records.", inputSchema: schemas.crm_find_contact },
  { name: "crm_search_records", title: "Search CRM records", description: "Search or list CRM records using existing CRM pagination and filters.", inputSchema: schemas.crm_search_records },
  { name: "crm_get_record", title: "Get CRM record", description: "Fetch one CRM record by object key and record id.", inputSchema: schemas.crm_get_record },
  { name: "crm_create_record", title: "Create CRM record", description: "Create a CRM record through the remote CRM API.", inputSchema: schemas.crm_create_record },
  { name: "crm_update_record", title: "Update CRM record", description: "Update a CRM record; approval responses are returned as-is.", inputSchema: schemas.crm_update_record },
  { name: "crm_list_activities", title: "List CRM activities", description: "List CRM activities and tasks. Use type=task, completed=false, archived=false, and dueFrom/dueTo for today's tasks.", inputSchema: schemas.crm_list_activities },
  { name: "crm_create_activity", title: "Create CRM activity", description: "Create a note, call, meeting, task, or email activity.", inputSchema: schemas.crm_create_activity },
  { name: "crm_update_activity", title: "Update CRM activity", description: "Update an activity or task status.", inputSchema: schemas.crm_update_activity },
  { name: "crm_complete_task", title: "Complete task", description: "Mark a CRM task/activity complete using the current time.", inputSchema: schemas.crm_complete_task },
  { name: "crm_list_smart_reminders", title: "List smart reminders", description: "Read existing CRM smart reminders, including today's best actions. For 'today's best actions' or '今日最佳行动', use status=open, snoozed=false, kind=today_best_action. Do not generate unless the user explicitly asks to regenerate or refresh.", inputSchema: schemas.crm_list_smart_reminders },
  { name: "crm_generate_smart_reminders", title: "Regenerate smart reminders", description: "Regenerate or refresh smart reminders only when the user explicitly asks to regenerate, refresh, recalculate, or create new best actions. Do not use for ordinary questions like '今日最佳行动'. Set confirmRegenerate=true only for explicit regeneration requests. Requires ai.use permission.", inputSchema: schemas.crm_generate_smart_reminders },
  { name: "crm_convert_smart_reminder_to_task", title: "Convert reminder to task", description: "Convert a smart reminder / today's best action into a concrete CRM task.", inputSchema: schemas.crm_convert_smart_reminder_to_task },
  { name: "crm_ai_query", title: "Ask CRM AI query", description: "Ask a read-only natural-language CRM question through /api/ai/query.", inputSchema: schemas.crm_ai_query },
  { name: "crm_list_email_accounts", title: "List email accounts", description: "List available email sending accounts so a salesperson can choose an accountId before sending mail.", inputSchema: schemas.crm_list_email_accounts },
  { name: "crm_send_email", title: "Send CRM email", description: "Send or schedule an outbound CRM email through the normal CRM email queue, policies, permissions, tracking, and audit path.", inputSchema: schemas.crm_send_email },
  { name: "crm_list_email_threads", title: "List email threads", description: "List visible CRM email threads without modifying mail state.", inputSchema: schemas.crm_list_email_threads },
  { name: "crm_get_email_thread", title: "Get email thread", description: "Fetch one visible email thread.", inputSchema: schemas.crm_get_email_thread },
  { name: "crm_list_email_messages", title: "List email messages", description: "List messages in one visible email thread.", inputSchema: schemas.crm_list_email_messages },
  { name: "crm_advance_deal_stage", title: "Advance deal stage", description: "Move a deal to another pipeline stage through the CRM stage update API.", inputSchema: schemas.crm_advance_deal_stage },
  { name: "crm_claim_record", title: "Claim CRM record", description: "Claim a public pool contact or company record as the salesperson, respecting pool limits.", inputSchema: schemas.crm_claim_record },
  { name: "crm_release_record", title: "Release CRM record", description: "Release an owned contact or company record back to the public pool.", inputSchema: schemas.crm_release_record }
];

export async function executeCrmMcpTool(name: CrmMcpToolName, rawArgs: unknown, client: CrmMcpClient): Promise<CallToolResult> {
  try {
    const args = schemas[name].parse(rawArgs ?? {});
    const data = await dispatchTool(name, args, client);
    return toToolResult(data);
  } catch (error) {
    return toToolErrorResult(error);
  }
}

async function dispatchTool(name: CrmMcpToolName, args: z.infer<(typeof schemas)[CrmMcpToolName]>, client: CrmMcpClient): Promise<unknown> {
  switch (name) {
    case "crm_health":
      return client.get("/api/health");
    case "crm_sales_daily_briefing":
      return salesDailyBriefing(client, args as z.infer<typeof schemas.crm_sales_daily_briefing>);
    case "crm_list_objects":
      return client.get("/api/object-definitions");
    case "crm_describe_object":
      return describeObject(client, args as z.infer<typeof schemas.crm_describe_object>);
    case "crm_find_contact":
      return findContact(client, args as z.infer<typeof schemas.crm_find_contact>);
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
    case "crm_list_smart_reminders":
      return client.get("/api/smart-reminders", { query: args as z.infer<typeof schemas.crm_list_smart_reminders> });
    case "crm_generate_smart_reminders":
      return generateSmartReminders(client, args as z.infer<typeof schemas.crm_generate_smart_reminders>);
    case "crm_convert_smart_reminder_to_task": {
      const input = args as z.infer<typeof schemas.crm_convert_smart_reminder_to_task>;
      return client.post(`/api/smart-reminders/${encodeURIComponent(input.reminderId)}/convert-task`);
    }
    case "crm_ai_query":
      return client.post("/api/ai/query", args);
    case "crm_list_email_accounts":
      return client.get("/api/email/accounts");
    case "crm_send_email":
      return client.post("/api/email/send", stripUndefined(args as z.infer<typeof schemas.crm_send_email>));
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

function generateSmartReminders(client: CrmMcpClient, input: z.infer<typeof schemas.crm_generate_smart_reminders>): Promise<unknown> {
  return client.post(
    "/api/smart-reminders/generate",
    stripUndefined({ objectKey: input.objectKey, recordId: input.recordId, force: input.force, daily: input.daily })
  );
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
