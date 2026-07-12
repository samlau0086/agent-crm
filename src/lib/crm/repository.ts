import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { createApiKeyToken, getApiKeyTokenPrefix, hashApiKeyToken } from "@/lib/auth/api-key";
import { permissionCatalog } from "@/lib/auth/permissions";
import { assertValidWebhookEvents, assertValidWebhookUrl, assertWebhookDeliveryTarget, buildWebhookSignatureHeader, createWebhookSecret, expandWebhookEventsForPayload, getWebhookSecretPrefix } from "@/lib/integrations/webhook";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  createPasswordSetupToken,
  hashPasswordSetupToken,
  PASSWORD_SETUP_MAX_AGE_SECONDS,
  type PasswordSetupPurpose
} from "@/lib/auth/password-setup";
import { canManageAllRecords, requirePermission } from "@/lib/auth/rbac";
import { destroyOtherSessionsForUser, destroySessionsForUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getBackgroundJobExecutor } from "@/lib/jobs/executor";
import { ApiError } from "@/lib/api-error";
import { buildCsv } from "@/lib/crm/csv";
import { buildCsvImportIssuesCsv } from "@/lib/crm/import-issues";
import { defaultSalesDocumentNumberSetting, previewSalesDocumentNumber, renderSalesDocumentNumber, salesDocumentLocalDate, validateSalesDocumentNumberRule } from "@/lib/crm/document-numbering";
import { AUDIT_DEFAULT_PAGE_SIZE, AUDIT_EXPORT_MAX_PAGE_SIZE, normalizePage, normalizePageSize, RECORD_DEFAULT_PAGE_SIZE, RECORD_MAX_PAGE_SIZE } from "@/lib/crm/pagination";
import { isContactMethodsAdditionOnly, previousRecordApprovalPatch, stripRecordApprovalMetadata } from "@/lib/crm/record-approval";
import { decryptAiProviderConfig, decryptAiProviderSettingsBundle, encryptAiProviderSettingsBundle, mergeAiProviderConfigSecrets, mergeAiProviderProfilesSecrets, normalizeAiProviderConfig, publicAiProviderConfig, publicAiProviderProfiles, resolveAiProviderConfigForAgent } from "@/lib/ai/provider-config";
import { createEmbedding } from "@/lib/ai/embeddings";
import { getGlobalAiAgentSetting, listAiAgentDefinitions, normalizeGlobalAiAgentSetting, normalizeGlobalAiAgentSettings, smartReminderPlannerAgentKey } from "@/lib/ai/agents";
import { runAiAgent } from "@/lib/ai/harness";
import {
  buildEmailAssistantContext as buildEmailAssistantPromptContext,
  canRunEmailClassification,
  createDefaultEmailAiSettings,
  normalizeEmailAiFeatures,
  type EmailAssistantContext,
  type EmailAssistantPurpose
} from "@/lib/email/assistant";
import { scheduleEmailAutomationsBestEffort } from "@/lib/email/automations";
import { decryptEmailConnectionConfig, encryptEmailConnectionConfig, getInboundConnectionConfig, normalizeEmailConnectionConfig } from "@/lib/email/connection-config";
import { getEmailProviderCapability } from "@/lib/email/providers";
import { appendEmailTrackingHtml, buildTrackingEvent, createEmailTrackingId } from "@/lib/email/tracking";
import {
  chunkKnowledgeArticle,
  defaultKnowledgeVectorSettings,
  normalizeKnowledgeVectorSettings,
  normalizeVectorError,
  scoreKnowledgeArticle,
  summarizeKnowledgeVectorStatus,
  toPgVectorLiteral
} from "@/lib/knowledge/vectorization";
import type {
  Activity,
  ActivityListQuery,
  ApiKey,
  AuditAction,
  AuditLog,
  AuditLogQuery,
  CreatedApiKey,
  CustomerLevel,
  CustomerLevelSettings,
  CustomerLevelSuggestion,
  CrmPoolLevelKey,
  CrmPoolLevelRule,
  CsvImportConflict,
  CsvImportMapping,
  CsvImportResult,
  CsvImportStrategy,
  CsvImportPreview,
  CsvImportJobSourcePayload,
  CsvImportJob,
  CrmPoolSettings,
  CrmRecord,
  DashboardSummary,
  EmailAccount,
  EmailAttachment,
  EmailAiGenerationAuditInput,
  EmailAiSettings,
  EmailSyncSettings,
  DocumentTemplate,
  SalesDocumentNumberSetting,
  SalesDocumentNumberPreview,
  AiAgentRunLog,
  AiAgentRunResult,
  AiAgentSetting,
  AiProviderConfig,
  AiProviderProfile,
  EmailConnectionConfig,
  EmailMessage,
  EmailSignature,
  EmailThreadState,
  EmailThread,
  EmailThreadListQuery,
  FieldDefinition,
  ImportPreset,
  ImportJobQueueSummary,
  KnowledgeArticle,
  KnowledgeVectorSettings,
  MediaAsset,
  NotificationChannel,
  NotificationChannelType,
  NotificationEvent,
  ObjectDefinition,
  Permission,
  Pipeline,
  RecordChangeRequest,
  RecordListQuery,
  RecordListResult,
  RecordPoolActionResult,
  RecordPoolAutoReclaimResult,
  RelationDefinition,
  RequestContext,
  Role,
  SavedView,
  SmartReminder,
  SmartReminderKind,
  SmartReminderPriority,
  SmartReminderRun,
  SmartReminderSettings,
  Team,
  TalkMessage,
  User,
  CreatedWebhookEndpoint,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEvent,
  WebhookDeliveryStatus,
  WorkflowAction,
  WorkflowActionApproval,
  WorkflowAiGenerationRequest,
  WorkflowAiGenerationResult,
  WorkflowCondition,
  WorkflowDefinition,
  WorkflowResume,
  WorkflowRun,
  WorkflowTrigger
} from "@/lib/crm/types";
import { assertValidFieldDefinition, validateRecordPayload } from "@/lib/crm/validation";
import {
  buildSalesDocumentConversionData,
  isSalesDocumentObjectKey,
  normalizeSalesDocumentRecordData,
  salesDocumentObjectKeys,
  salesDocumentNextObjectKey,
  salesDocumentNumberField,
  salesDocumentTitles,
  validateSalesDocumentRecordData,
  type SalesDocumentObjectKey
} from "@/lib/crm/quotes";
import {
  buildWorkflowIdempotencyKey,
  buildWorkflowTestIdempotencyKey,
  didWorkflowConditionsPass,
  evaluateWorkflowCondition,
  evaluateWorkflowConditions,
  graphToLegacyWorkflow,
  isHighRiskWorkflowAction,
  normalizeWorkflowGraph,
  renderWorkflowTextTemplate,
  workflowNodeToAction,
  workflowNodeToCondition,
  workflowMatchesEvent
} from "@/lib/workflows/core";
import { generateWorkflowWithAiDesigner } from "@/lib/workflows/ai-designer";

type PrismaContext = typeof prisma;
type TalkMessageTargetInput = { type: "record"; objectKey: string; recordId: string } | { type: "email_thread"; threadId: string };
type EmailThreadCommandScope = { recordIds: Set<string>; emails: Set<string> };
const POOL_OBJECT_KEYS = ["contacts", "companies"] as const;
const EDIT_APPROVAL_OBJECT_KEYS = ["contacts", "companies", "deals"] as const;
const DELETE_APPROVAL_OBJECT_KEYS = ["contacts", "companies", "deals", "products", "quotes", "salesorders", "proformainvoices", "commercialinvoices"] as const;
type SmartReminderCandidate = {
  kind: SmartReminderKind;
  priority: SmartReminderPriority;
  title: string;
  body?: string;
  actionLabel?: string;
  objectKey?: string;
  recordId?: string;
  dueAt?: string;
  sources: SmartReminder["sources"];
  score: number;
};
type SmartReminderGenerationContext = {
  user: { id: string; name: string; email: string };
  records: Array<Pick<CrmRecord, "id" | "objectKey" | "title" | "stageKey" | "ownerId" | "data" | "updatedAt">>;
  tasks: Activity[];
  recentActivities: Activity[];
  emailThreads: EmailThread[];
  knowledge: KnowledgeArticle[];
  portfolioMetrics: SmartReminderPortfolioMetrics;
};
type SmartReminderPortfolioMetrics = {
  totals: { contacts: number; companies: number; deals: number; publicPool: number; privatePool: number; unowned: number };
  customerLevels: Record<"A" | "B" | "C" | "D" | "unrated", number>;
  dataQuality: {
    lowCompletenessContacts: number;
    lowCompletenessCompanies: number;
    averageContactCompleteness: number;
    averageCompanyCompleteness: number;
  };
  stale: { noActivity7Days: number; noActivity14Days: number; noActivity30Days: number; stalePrivateRecords: number };
  deals: { highValueStalled: number; closingSoon: number; totalOpenAmount: number };
};

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function findWorkflowEdge<T extends { sourceNodeId: string; sourceHandle: string; targetNodeId: string }>(edges: T[], nodeId: string, handle: string): T | undefined {
  return edges.find((edge) => edge.sourceNodeId === nodeId && edge.sourceHandle === handle);
}

function switchOutputHandle(node: { config: Record<string, unknown> }, value: unknown): string {
  const actual = String(value ?? "").trim();
  const cases = Array.isArray(node.config.cases)
    ? node.config.cases.filter((item): item is string => typeof item === "string")
    : typeof node.config.cases === "string"
      ? node.config.cases.split(/[,\n;]/).map((item) => item.trim()).filter(Boolean)
      : [];
  return cases.includes(actual) ? `case:${actual}` : "default";
}

function toJsonObject<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function toJsonArray<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? [])) as Prisma.InputJsonValue;
}

function mapWorkflowDefinition(row: Record<string, unknown>): WorkflowDefinition {
  const trigger = normalizeWorkflowTrigger(row.trigger);
  const conditions = normalizeWorkflowConditions(row.conditions);
  const actions = normalizeWorkflowActions(row.actions);
  return {
    id: String(row.id),
    workspaceId: String(row.workspaceId),
    name: String(row.name ?? ""),
    description: typeof row.description === "string" ? row.description : undefined,
    goal: String(row.goal ?? ""),
    status: normalizeWorkflowStatus(row.status),
    trigger,
    conditions,
    actions,
    graph: normalizeWorkflowGraph(row.graph, { trigger, conditions, actions }),
    createdById: String(row.createdById ?? ""),
    version: Number(row.version ?? 1),
    lastRunAt: row.lastRunAt instanceof Date ? row.lastRunAt.toISOString() : typeof row.lastRunAt === "string" ? row.lastRunAt : undefined,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? new Date().toISOString()),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt ?? new Date().toISOString())
  };
}

function mapWorkflowRun(row: Record<string, unknown>): WorkflowRun {
  return {
    id: String(row.id),
    workspaceId: String(row.workspaceId),
    workflowId: String(row.workflowId),
    status: normalizeWorkflowRunStatus(row.status),
    triggerEvent: String(row.triggerEvent ?? ""),
    triggerData: isJsonRecord(row.triggerData) ? row.triggerData : {},
    idempotencyKey: typeof row.idempotencyKey === "string" ? row.idempotencyKey : undefined,
    conditionResults: Array.isArray(row.conditionResults) ? (row.conditionResults as WorkflowRun["conditionResults"]) : [],
    actionResults: Array.isArray(row.actionResults) ? (row.actionResults as WorkflowRun["actionResults"]) : [],
    nodeResults: Array.isArray(row.nodeResults) ? (row.nodeResults as WorkflowRun["nodeResults"]) : undefined,
    errorMessage: typeof row.errorMessage === "string" ? row.errorMessage : undefined,
    startedAt: row.startedAt instanceof Date ? row.startedAt.toISOString() : String(row.startedAt ?? new Date().toISOString()),
    completedAt: row.completedAt instanceof Date ? row.completedAt.toISOString() : typeof row.completedAt === "string" ? row.completedAt : undefined,
    durationMs: typeof row.durationMs === "number" ? row.durationMs : undefined
  };
}

function mapWorkflowApproval(row: Record<string, unknown>): WorkflowActionApproval {
  return {
    id: String(row.id),
    workspaceId: String(row.workspaceId),
    workflowId: String(row.workflowId),
    runId: typeof row.runId === "string" ? row.runId : undefined,
    actionKey: String(row.actionKey ?? ""),
    actionType: String(row.actionType ?? "") as WorkflowActionApproval["actionType"],
    status: row.status === "approved" || row.status === "rejected" ? row.status : "pending",
    summary: String(row.summary ?? ""),
    payload: isJsonRecord(row.payload) ? row.payload : {},
    requestedById: String(row.requestedById ?? ""),
    reviewedById: typeof row.reviewedById === "string" ? row.reviewedById : undefined,
    reviewNote: typeof row.reviewNote === "string" ? row.reviewNote : undefined,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? new Date().toISOString()),
    reviewedAt: row.reviewedAt instanceof Date ? row.reviewedAt.toISOString() : typeof row.reviewedAt === "string" ? row.reviewedAt : undefined
  };
}

function normalizeWorkflowStatus(value: unknown): WorkflowDefinition["status"] {
  return value === "active" || value === "disabled" || value === "archived" ? value : "draft";
}

function normalizeWorkflowRunStatus(value: unknown): WorkflowRun["status"] {
  return value === "waiting" || value === "completed" || value === "failed" || value === "skipped" || value === "approval_required" ? value : "running";
}

function normalizeWorkflowResumeStatus(value: unknown): WorkflowResume["status"] {
  return value === "completed" || value === "cancelled" || value === "failed" ? value : "pending";
}

function workflowGraphRunStatus(
  actionResults: WorkflowRun["actionResults"],
  nodeResults: NonNullable<WorkflowRun["nodeResults"]>
): WorkflowRun["status"] {
  if (actionResults.some((result) => result.status === "failed") || nodeResults.some((result) => result.status === "failed")) return "failed";
  if (nodeResults.at(-1)?.status === "waiting") return "waiting";
  if (actionResults.some((result) => result.status === "approval_required") || nodeResults.some((result) => result.status === "approval_required")) return "approval_required";
  if (nodeResults.some((result) => result.status === "completed")) return "completed";
  return "skipped";
}

function workflowDelayResumeAt(amount: number, unit: string, from = new Date()): Date {
  const multiplier = unit === "minutes" ? 60_000 : unit === "hours" ? 60 * 60_000 : 24 * 60 * 60_000;
  return new Date(from.getTime() + amount * multiplier);
}

function workflowDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function workflowMonthDay(value: Date): string {
  return value.toISOString().slice(5, 10);
}

function workflowReplySince(triggerData: Record<string, unknown>, lookbackDays: number): Date {
  const candidates = [triggerData.waitStartedAt, triggerData.sentAt, triggerData.createdAt, triggerData.scheduledAt]
    .filter((value): value is string => typeof value === "string")
    .map((value) => new Date(value))
    .filter((value) => Number.isFinite(value.getTime()));
  return candidates[0] ?? new Date(Date.now() - lookbackDays * 24 * 60 * 60_000);
}

function normalizeWorkflowEmail(value: string): string {
  return value.trim().toLowerCase();
}

function parseWorkflowDate(value: unknown): Date | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function workflowDateMatchConfig(workflow: WorkflowDefinition): { objectKey?: string; field: string } | undefined {
  const triggerConfig = isJsonRecord(workflow.trigger.config) ? workflow.trigger.config : {};
  const triggerField = typeof triggerConfig.dateField === "string" ? triggerConfig.dateField : undefined;
  if (triggerField) {
    return { objectKey: typeof triggerConfig.objectKey === "string" ? triggerConfig.objectKey : workflow.trigger.objectKey, field: triggerField };
  }
  const node = workflow.graph?.nodes.find((candidate) =>
    (candidate.type === "if" || candidate.type === "switch") &&
    (candidate.config.dateMatch === true || candidate.config.dateMatchMode === "annual" || candidate.config.field === "birthday")
  );
  const field = typeof node?.config.field === "string" ? node.config.field : undefined;
  return field ? { objectKey: workflow.graph?.scope.objectKey ?? workflow.trigger.objectKey, field } : undefined;
}

function normalizeWorkflowTrigger(value: unknown): WorkflowTrigger {
  if (!isJsonRecord(value)) {
    return { type: "manual", event: "manual.run" };
  }
  const type = value.type === "crm_event" || value.type === "email_event" || value.type === "task_event" || value.type === "schedule" ? value.type : "manual";
  const event = typeof value.event === "string" ? value.event : "manual.run";
  return {
    type,
    event: event as WorkflowTrigger["event"],
    objectKey: typeof value.objectKey === "string" ? value.objectKey : undefined,
    config: isJsonRecord(value.config) ? value.config : undefined,
    schedule: normalizeWorkflowSchedule(value.schedule)
  };
}

function normalizeWorkflowSchedule(value: unknown): WorkflowTrigger["schedule"] | undefined {
  if (!isJsonRecord(value)) return undefined;
  const mode = value.mode === "weekly" || value.mode === "interval" ? value.mode : value.mode === "daily" ? "daily" : undefined;
  if (!mode) return undefined;
  return {
    mode,
    dailyAt: typeof value.dailyAt === "string" ? value.dailyAt : undefined,
    weekday: typeof value.weekday === "number" ? value.weekday : undefined,
    intervalMinutes: typeof value.intervalMinutes === "number" ? value.intervalMinutes : undefined
  };
}

function normalizeWorkflowConditions(value: unknown): WorkflowCondition[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isJsonRecord).map((condition, index) => ({
    key: typeof condition.key === "string" ? condition.key : `condition-${index + 1}`,
    type:
      condition.type === "activity" ||
      condition.type === "email_behavior" ||
      condition.type === "ai" ||
      condition.type === "if" ||
      condition.type === "switch" ||
      condition.type === "loop"
        ? condition.type
        : "field",
    field: typeof condition.field === "string" ? condition.field : undefined,
    operator: typeof condition.operator === "string" ? (condition.operator as WorkflowCondition["operator"]) : "equals",
    value: condition.value,
    prompt: typeof condition.prompt === "string" ? condition.prompt : undefined,
    config: isJsonRecord(condition.config) ? condition.config : undefined
  }));
}

function normalizeWorkflowActions(value: unknown): WorkflowAction[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isJsonRecord).map((action, index) => ({
    key: typeof action.key === "string" ? action.key : `action-${index + 1}`,
    type: typeof action.type === "string" ? (action.type as WorkflowAction["type"]) : "create_activity",
    name: typeof action.name === "string" ? action.name : `Action ${index + 1}`,
    requiresApproval: typeof action.requiresApproval === "boolean" ? action.requiresApproval : undefined,
    config: isJsonRecord(action.config) ? action.config : {}
  }));
}

function normalizeContactMethodsForApproval(value: unknown): Array<Record<string, unknown> & { id: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index) => {
      if (!isJsonRecord(item)) {
        return undefined;
      }
      const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : `method-${index}`;
      return { ...item, id };
    })
    .filter((method): method is Record<string, unknown> & { id: string } => Boolean(method));
}

function mergeContactMethodsForApproval(currentValue: unknown, approvedValue: unknown): unknown {
  if (!Array.isArray(approvedValue)) {
    return approvedValue;
  }
  const currentMethods = normalizeContactMethodsForApproval(currentValue);
  const approvedMethods = normalizeContactMethodsForApproval(approvedValue);
  const merged = new Map<string, Record<string, unknown>>();
  for (const method of currentMethods) {
    merged.set(method.id, method);
  }
  for (const method of approvedMethods) {
    merged.set(method.id, method);
  }
  return [...merged.values()];
}

function canMergeApprovedContactMethodPatch(currentValue: unknown, approvedValue: unknown): boolean {
  if (!Array.isArray(approvedValue)) {
    return false;
  }
  const currentMethods = normalizeContactMethodsForApproval(currentValue);
  const approvedMethods = normalizeContactMethodsForApproval(approvedValue);
  if (currentMethods.length === 0 || approvedMethods.length < currentMethods.length) {
    return false;
  }
  const approvedIds = new Set(approvedMethods.map((method) => method.id));
  return currentMethods.every((method) => approvedIds.has(method.id));
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const DEFAULT_EMAIL_SEND_CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const MIN_EMAIL_SEND_CLAIM_TIMEOUT_MS = 60 * 1000;

function emailSendClaimStaleBefore(now = new Date()): Date {
  return new Date(now.getTime() - emailSendClaimTimeoutMs());
}

function emailSendClaimTimeoutMs(): number {
  const configured = Number(process.env.EMAIL_SEND_CLAIM_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_EMAIL_SEND_CLAIM_TIMEOUT_MS;
  }
  return Math.max(MIN_EMAIL_SEND_CLAIM_TIMEOUT_MS, Math.floor(configured));
}

function isPoolObjectKey(objectKey: string): boolean {
  return POOL_OBJECT_KEYS.includes(objectKey as (typeof POOL_OBJECT_KEYS)[number]);
}

function requiresEditApproval(objectKey: string): boolean {
  return EDIT_APPROVAL_OBJECT_KEYS.includes(objectKey as (typeof EDIT_APPROVAL_OBJECT_KEYS)[number]);
}

function requiresDeleteApproval(objectKey: string): boolean {
  return DELETE_APPROVAL_OBJECT_KEYS.includes(objectKey as (typeof DELETE_APPROVAL_OBJECT_KEYS)[number]);
}

function isEmailSendClaimStale(sendAttemptedAt: string | undefined, staleBefore: Date): boolean {
  if (!sendAttemptedAt) {
    return true;
  }
  const attemptedAt = new Date(sendAttemptedAt);
  return Number.isNaN(attemptedAt.getTime()) || attemptedAt < staleBefore;
}

function asStages(value: Prisma.JsonValue): Pipeline["stages"] {
  return ((value ?? []) as unknown) as Pipeline["stages"];
}

function mapUser(user: {
  id: string;
  workspaceId: string;
  email: string;
  name: string;
  avatarMediaAssetId?: string | null;
  roleId: string | null;
  teamId: string | null;
  emailListDisplayMode?: string | null;
  active: boolean;
  disabledAt?: Date | null;
}): User {
  return {
    id: user.id,
    workspaceId: user.workspaceId,
    email: user.email,
    name: user.name,
    avatarMediaAssetId: user.avatarMediaAssetId ?? undefined,
    roleId: user.roleId ?? "",
    teamId: user.teamId ?? undefined,
    emailListDisplayMode: user.emailListDisplayMode === "message" ? "message" : "thread",
    active: user.active,
    disabledAt: user.disabledAt?.toISOString()
  };
}

function mapWorkflowResume(row: Record<string, unknown>): WorkflowResume {
  return {
    id: String(row.id),
    workspaceId: String(row.workspaceId),
    workflowId: String(row.workflowId),
    runId: String(row.runId),
    nodeId: String(row.nodeId),
    resumeAt: row.resumeAt instanceof Date ? row.resumeAt.toISOString() : String(row.resumeAt ?? new Date().toISOString()),
    triggerData: isJsonRecord(row.triggerData) ? row.triggerData : {},
    status: normalizeWorkflowResumeStatus(row.status),
    idempotencyKey: String(row.idempotencyKey ?? ""),
    errorMessage: typeof row.errorMessage === "string" ? row.errorMessage : undefined,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? new Date().toISOString()),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt ?? new Date().toISOString())
  };
}

function mapApiKey(apiKey: {
  id: string;
  workspaceId: string;
  name: string;
  tokenPrefix: string;
  permissions: string[];
  createdById: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ApiKey {
  return {
    id: apiKey.id,
    workspaceId: apiKey.workspaceId,
    name: apiKey.name,
    tokenPrefix: apiKey.tokenPrefix,
    permissions: apiKey.permissions as ApiKey["permissions"],
    createdById: apiKey.createdById,
    expiresAt: apiKey.expiresAt?.toISOString(),
    revokedAt: apiKey.revokedAt?.toISOString(),
    lastUsedAt: apiKey.lastUsedAt?.toISOString(),
    createdAt: apiKey.createdAt.toISOString(),
    updatedAt: apiKey.updatedAt.toISOString()
  };
}

function mapWebhookEndpoint(webhook: {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  events: string[];
  secretPrefix: string;
  active: boolean;
  createdById: string;
  lastDeliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): WebhookEndpoint {
  return {
    id: webhook.id,
    workspaceId: webhook.workspaceId,
    name: webhook.name,
    url: webhook.url,
    events: webhook.events as WebhookEndpoint["events"],
    secretPrefix: webhook.secretPrefix,
    active: webhook.active,
    createdById: webhook.createdById,
    lastDeliveredAt: webhook.lastDeliveredAt?.toISOString(),
    createdAt: webhook.createdAt.toISOString(),
    updatedAt: webhook.updatedAt.toISOString()
  };
}

function mapNotificationChannel(channel: {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  events: string[];
  config: Prisma.JsonValue;
  active: boolean;
  createdById: string;
  lastNotifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): NotificationChannel {
  return {
    id: channel.id,
    workspaceId: channel.workspaceId,
    name: channel.name,
    type: channel.type as NotificationChannel["type"],
    events: channel.events as NotificationChannel["events"],
    config: asRecord(channel.config),
    active: channel.active,
    createdById: channel.createdById,
    lastNotifiedAt: channel.lastNotifiedAt?.toISOString(),
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString()
  };
}

function mapWebhookDelivery(delivery: {
  id: string;
  workspaceId: string;
  webhookId: string;
  event: string;
  status: string;
  attempts: number;
  requestBody: Prisma.JsonValue;
  responseStatus: number | null;
  responseBody: string | null;
  errorMessage: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
}): WebhookDelivery {
  return {
    id: delivery.id,
    workspaceId: delivery.workspaceId,
    webhookId: delivery.webhookId,
    event: delivery.event as WebhookDelivery["event"],
    status: delivery.status as WebhookDelivery["status"],
    attempts: delivery.attempts,
    requestBody: asRecord(delivery.requestBody),
    responseStatus: delivery.responseStatus ?? undefined,
    responseBody: delivery.responseBody ?? undefined,
    errorMessage: delivery.errorMessage ?? undefined,
    createdAt: delivery.createdAt.toISOString(),
    deliveredAt: delivery.deliveredAt?.toISOString()
  };
}

function mapEmailAccount(account: {
  id: string;
  workspaceId: string;
  name: string;
  emailAddress: string;
  provider: string;
  status: string;
  syncEnabled: boolean;
  sendEnabled: boolean;
  defaultSignatureId?: string | null;
  encryptedConnectionConfig?: string | null;
  lastConnectionError?: string | null;
  createdById: string;
  lastSyncedAt: Date | null;
  lastSyncStatus?: string | null;
  lastSyncStartedAt?: Date | null;
  lastSyncFinishedAt?: Date | null;
  lastSyncScannedCount?: number | null;
  lastSyncImportedCount?: number | null;
  lastSyncSkippedDuplicateCount?: number | null;
  lastSyncError?: string | null;
  imapUidValidity?: string | null;
  imapLastSeenUid?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): EmailAccount {
  return {
    id: account.id,
    workspaceId: account.workspaceId,
    name: account.name,
    emailAddress: account.emailAddress,
    provider: account.provider as EmailAccount["provider"],
    status: account.status as EmailAccount["status"],
    syncEnabled: account.syncEnabled,
    sendEnabled: account.sendEnabled,
    defaultSignatureId: account.defaultSignatureId ?? undefined,
    connectionConfigured: Boolean(account.encryptedConnectionConfig),
    lastConnectionError: account.lastConnectionError ?? undefined,
    createdById: account.createdById,
    lastSyncedAt: account.lastSyncedAt?.toISOString(),
    lastSyncStatus: (account.lastSyncStatus as EmailAccount["lastSyncStatus"]) ?? undefined,
    lastSyncStartedAt: account.lastSyncStartedAt?.toISOString(),
    lastSyncFinishedAt: account.lastSyncFinishedAt?.toISOString(),
    lastSyncScannedCount: account.lastSyncScannedCount ?? undefined,
    lastSyncImportedCount: account.lastSyncImportedCount ?? undefined,
    lastSyncSkippedDuplicateCount: account.lastSyncSkippedDuplicateCount ?? undefined,
    lastSyncError: account.lastSyncError ?? undefined,
    imapUidValidity: account.imapUidValidity ?? undefined,
    imapLastSeenUid: account.imapLastSeenUid ?? undefined,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString()
  };
}

function mapEmailSignature(signature: {
  id: string;
  workspaceId: string;
  accountId: string | null;
  name: string;
  bodyText: string;
  bodyHtml: string | null;
  isDefault: boolean;
  active: boolean;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}): EmailSignature {
  return {
    id: signature.id,
    workspaceId: signature.workspaceId,
    accountId: signature.accountId ?? undefined,
    name: signature.name,
    bodyText: signature.bodyText,
    bodyHtml: signature.bodyHtml ?? undefined,
    isDefault: signature.isDefault,
    active: signature.active,
    createdById: signature.createdById,
    createdAt: signature.createdAt.toISOString(),
    updatedAt: signature.updatedAt.toISOString()
  };
}

function mergeEmailConnectionConfigSecrets(existing: EmailConnectionConfig | undefined, next: EmailConnectionConfig): EmailConnectionConfig {
  if (!existing) {
    return normalizeEmailConnectionConfig(next);
  }
  const normalizedExisting = normalizeEmailConnectionConfig(existing);
  const existingServicesById = new Map((normalizedExisting.outboundServices ?? []).map((service) => [service.id, service]));
  const nextInbound = next.inbound;
  const inbound = nextInbound
    ? {
        ...nextInbound,
        password: nextInbound.password ?? normalizedExisting.inbound?.password,
        accessToken: nextInbound.accessToken ?? normalizedExisting.inbound?.accessToken,
        refreshToken: nextInbound.refreshToken ?? normalizedExisting.inbound?.refreshToken,
        tokenType: nextInbound.tokenType ?? normalizedExisting.inbound?.tokenType
      }
    : nextInbound;
  const outboundServices = (next.outboundServices ?? []).map((service) => {
    const existingService = existingServicesById.get(service.id);
    return {
      ...service,
      password: service.password ?? existingService?.password,
      resendApiKey: service.resendApiKey ?? existingService?.resendApiKey
    };
  });
  return normalizeEmailConnectionConfig({
    ...next,
    inbound,
    outboundServices,
    password: next.password ?? normalizedExisting.password,
    accessToken: next.accessToken ?? normalizedExisting.accessToken,
    refreshToken: next.refreshToken ?? normalizedExisting.refreshToken,
    tokenType: next.tokenType ?? normalizedExisting.tokenType
  });
}

function mapEmailThread(thread: {
  id: string;
  workspaceId: string;
  accountId: string;
  subject: string;
  participantEmails: string[];
  recordId: string | null;
  summary: string | null;
  summaryUpdatedAt: Date | null;
  aiAnalysis: string | null;
  aiAnalysisSources: Prisma.JsonValue | null;
  aiAnalysisUpdatedAt: Date | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}, state?: {
  archived: boolean;
  category: string | null;
  deleted: boolean;
  important: boolean;
  labels: string[];
  read: boolean;
  snoozedUntil: Date | null;
  starred: boolean;
} | null): EmailThread {
  return {
    id: thread.id,
    workspaceId: thread.workspaceId,
    accountId: thread.accountId,
    subject: thread.subject,
    participantEmails: thread.participantEmails,
    recordId: thread.recordId ?? undefined,
    summary: thread.summary ?? undefined,
    summaryUpdatedAt: thread.summaryUpdatedAt?.toISOString(),
    aiAnalysis: thread.aiAnalysis ?? undefined,
    aiAnalysisSources: normalizeEmailAiSources(thread.aiAnalysisSources),
    aiAnalysisUpdatedAt: thread.aiAnalysisUpdatedAt?.toISOString(),
    lastMessageAt: thread.lastMessageAt?.toISOString(),
    archived: state?.archived ?? false,
    category: normalizeEmailThreadCategory(state?.category),
    deleted: state?.deleted ?? false,
    important: state?.important ?? false,
    labels: normalizeEmailThreadLabels(state?.labels),
    read: state?.read ?? false,
    snoozedUntil: state?.snoozedUntil?.toISOString(),
    starred: state?.starred ?? false,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString()
  };
}

function mapEmailMessage(message: {
  id: string;
  workspaceId: string;
  threadId: string;
  accountId: string;
  direction: string;
  status: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  attachments: Prisma.JsonValue | null;
  translatedBodyText: string | null;
  translatedLocale: string | null;
  translatedSources: Prisma.JsonValue | null;
  translatedAt: Date | null;
  aiAssisted: boolean;
  aiPurpose: string | null;
  aiSourceMessageId: string | null;
  aiSources: Prisma.JsonValue | null;
  aiGeneratedAt: Date | null;
  externalMessageId: string | null;
  clientRequestId: string | null;
  failureReason: string | null;
  sendAttemptedAt: Date | null;
  scheduledSendAt: Date | null;
  sentAt: Date | null;
  receivedAt: Date | null;
  trackingEnabled: boolean;
  trackingId: string | null;
  trackingEvents: Prisma.JsonValue | null;
  inboundMetadata: Prisma.JsonValue | null;
  groupSendMode: boolean;
  createdById: string | null;
  createdAt: Date;
}): EmailMessage {
  return {
    id: message.id,
    workspaceId: message.workspaceId,
    threadId: message.threadId,
    accountId: message.accountId,
    direction: message.direction as EmailMessage["direction"],
    status: message.status as EmailMessage["status"],
    from: message.fromAddress,
    to: message.toAddresses,
    cc: message.ccAddresses.length ? message.ccAddresses : undefined,
    bcc: message.bccAddresses.length ? message.bccAddresses : undefined,
    subject: message.subject,
    bodyText: message.bodyText,
    bodyHtml: message.bodyHtml ?? undefined,
    attachments: normalizeEmailAttachments(message.attachments),
    translatedBodyText: message.translatedBodyText ?? undefined,
    translatedLocale: message.translatedLocale ?? undefined,
    translatedSources: normalizeEmailAiSources(message.translatedSources),
    translatedAt: message.translatedAt?.toISOString(),
    aiAssisted: message.aiAssisted || undefined,
    aiPurpose: (message.aiPurpose as EmailMessage["aiPurpose"]) ?? undefined,
    aiSourceMessageId: message.aiSourceMessageId ?? undefined,
    aiSources: normalizeEmailAiSources(message.aiSources),
    aiGeneratedAt: message.aiGeneratedAt?.toISOString(),
    externalMessageId: message.externalMessageId ?? undefined,
    clientRequestId: message.clientRequestId ?? undefined,
    failureReason: message.failureReason ?? undefined,
    sendAttemptedAt: message.sendAttemptedAt?.toISOString(),
    scheduledSendAt: message.scheduledSendAt?.toISOString(),
    sentAt: message.sentAt?.toISOString(),
    receivedAt: message.receivedAt?.toISOString(),
    trackingEnabled: message.trackingEnabled || undefined,
    trackingId: message.trackingId ?? undefined,
    trackingEvents: normalizeEmailTrackingEvents(message.trackingEvents),
    inboundMetadata: normalizeEmailInboundMetadata(message.inboundMetadata),
    groupSendMode: message.groupSendMode || undefined,
    createdById: message.createdById ?? undefined,
    createdAt: message.createdAt.toISOString()
  };
}

function mapKnowledgeArticle(article: {
  id: string;
  workspaceId: string;
  title: string;
  body: string;
  tags: string[];
  active: boolean;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  embeddingChunks?: Array<{
    status: string;
    errorMessage: string | null;
    embeddingModel: string;
    dimensions: number;
    indexedAt: Date | null;
    updatedAt: Date;
  }>;
}): KnowledgeArticle {
  return {
    id: article.id,
    workspaceId: article.workspaceId,
    title: article.title,
    body: article.body,
    tags: article.tags,
    active: article.active,
    createdById: article.createdById,
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt.toISOString(),
    vectorStatus: article.embeddingChunks
      ? summarizeKnowledgeVectorStatus(
          article.embeddingChunks.map((chunk) => ({
            status: chunk.status === "failed" ? "failed" : chunk.status === "stale" ? "stale" : "indexed",
            errorMessage: chunk.errorMessage ?? undefined,
            embeddingModel: chunk.embeddingModel,
            dimensions: chunk.dimensions,
            indexedAt: chunk.indexedAt?.toISOString(),
            updatedAt: chunk.updatedAt.toISOString()
          }))
        )
      : undefined
  };
}

function mapKnowledgeVectorSettings(settings: {
  workspaceId: string;
  enabled: boolean;
  providerProfileKey: string;
  embeddingModel: string;
  dimensions: number;
  chunkSizeChars: number;
  chunkOverlapChars: number;
  topK: number;
  similarityThreshold: number;
  updatedAt: Date;
}): KnowledgeVectorSettings {
  return normalizeKnowledgeVectorSettings(settings.workspaceId, {
    enabled: settings.enabled,
    providerProfileKey: settings.providerProfileKey,
    embeddingModel: settings.embeddingModel,
    dimensions: settings.dimensions,
    chunkSizeChars: settings.chunkSizeChars,
    chunkOverlapChars: settings.chunkOverlapChars,
    topK: settings.topK,
    similarityThreshold: settings.similarityThreshold,
    updatedAt: settings.updatedAt.toISOString()
  });
}

function mapTalkMessage(message: {
  id: string;
  workspaceId: string;
  targetType: string;
  objectKey: string | null;
  recordId: string | null;
  threadId: string | null;
  role: string;
  content: string;
  sources: Prisma.JsonValue | null;
  knowledgeArticleId: string | null;
  createdById: string;
  createdAt: Date;
}): TalkMessage {
  return {
    id: message.id,
    workspaceId: message.workspaceId,
    targetType: message.targetType === "email_thread" ? "email_thread" : "record",
    objectKey: message.objectKey ?? undefined,
    recordId: message.recordId ?? undefined,
    threadId: message.threadId ?? undefined,
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
    sources: normalizeTalkSources(message.sources),
    knowledgeArticleId: message.knowledgeArticleId ?? undefined,
    createdById: message.createdById,
    createdAt: message.createdAt.toISOString()
  };
}

function mapMediaAsset(asset: {
  id: string;
  workspaceId: string;
  name: string;
  contentType: string;
  size: number;
  contentBase64: string;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}): MediaAsset {
  return {
    id: asset.id,
    workspaceId: asset.workspaceId,
    name: asset.name,
    contentType: asset.contentType,
    size: asset.size,
    contentBase64: asset.contentBase64,
    createdById: asset.createdById,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString()
  };
}

function mapEmailAiSettings(settings: {
  workspaceId: string;
  features: Prisma.JsonValue;
  agents?: Prisma.JsonValue;
  encryptedProviderConfig?: string | null;
  defaultLocale: string;
  requireSourceLinks: boolean;
  maxHistoryMessages: number;
  maxKnowledgeArticles: number;
  maxContextChars: number;
  updatedAt: Date;
}): EmailAiSettings {
  const providerBundle = readAiProviderSettingsBundleFromEncrypted(settings.encryptedProviderConfig);
  return {
    workspaceId: settings.workspaceId,
    features: normalizeEmailAiFeatures(settings.features as Partial<EmailAiSettings["features"]>),
    agents: normalizeGlobalAiAgentSettings(settings.agents),
    providerConfig: publicAiProviderConfig(providerBundle.providerConfig),
    providerProfiles: publicAiProviderProfiles(providerBundle.providerProfiles),
    defaultLocale: settings.defaultLocale,
    requireSourceLinks: settings.requireSourceLinks,
    maxHistoryMessages: settings.maxHistoryMessages,
    maxKnowledgeArticles: settings.maxKnowledgeArticles,
    maxContextChars: settings.maxContextChars,
    updatedAt: settings.updatedAt.toISOString()
  };
}

function mapEmailSyncSettings(settings: {
  workspaceId: string;
  enabled: boolean;
  mode: string;
  intervalMinutes: number;
  dailyAt: string;
  limit: number;
  updatedAt: Date;
}): EmailSyncSettings {
  return {
    workspaceId: settings.workspaceId,
    enabled: settings.enabled,
    mode: settings.mode === "daily" ? "daily" : "interval",
    intervalMinutes: normalizeIntegerLimit(settings.intervalMinutes, 1, 1440),
    dailyAt: normalizeDailyTime(settings.dailyAt),
    limit: normalizeIntegerLimit(settings.limit, 1, 100),
    updatedAt: settings.updatedAt.toISOString()
  };
}

const crmPoolLevelKeys: CrmPoolLevelKey[] = ["A", "B", "C", "D", "unrated"];

const defaultCrmPoolLevelRules: CrmPoolLevelRule[] = [
  { level: "A", enabled: true, privateLimit: 20, autoReclaimDays: 60 },
  { level: "B", enabled: true, privateLimit: 40, autoReclaimDays: 45 },
  { level: "C", enabled: true, privateLimit: 80, autoReclaimDays: 30 },
  { level: "D", enabled: true, privateLimit: 100, autoReclaimDays: 14 },
  { level: "unrated", enabled: true, privateLimit: 100, autoReclaimDays: 21 }
];

function normalizeCrmPoolLevelRules(value: Prisma.JsonValue | unknown): CrmPoolLevelRule[] {
  const raw = Array.isArray(value) ? value : [];
  return crmPoolLevelKeys.map((level) => {
    const fallback = defaultCrmPoolLevelRules.find((rule) => rule.level === level) ?? { level, enabled: true };
    const candidate = raw.find((item) => isJsonRecord(item) && item.level === level);
    if (!isJsonRecord(candidate)) {
      return { ...fallback };
    }
    const privateLimit = typeof candidate.privateLimit === "number" ? normalizeIntegerLimit(candidate.privateLimit, 1, 100000) : undefined;
    const autoReclaimDays = typeof candidate.autoReclaimDays === "number" ? normalizeIntegerLimit(candidate.autoReclaimDays, 1, 3650) : undefined;
    return {
      level,
      enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : fallback.enabled,
      privateLimit,
      autoReclaimDays
    };
  });
}

function crmPoolLevelRulesToJson(rules: CrmPoolLevelRule[]): Prisma.InputJsonValue {
  return rules.map((rule) => {
    const output: Record<string, string | boolean | number> = {
      level: rule.level,
      enabled: rule.enabled
    };
    if (rule.privateLimit !== undefined) {
      output.privateLimit = rule.privateLimit;
    }
    if (rule.autoReclaimDays !== undefined) {
      output.autoReclaimDays = rule.autoReclaimDays;
    }
    return output;
  });
}

function getCrmPoolLevelRule(settings: CrmPoolSettings, level: CrmPoolLevelKey): CrmPoolLevelRule | undefined {
  const rule = settings.levelRules.find((candidate) => candidate.level === level);
  return rule?.enabled ? rule : undefined;
}

function getEffectivePoolLevelPrivateLimit(settings: CrmPoolSettings, level: CrmPoolLevelKey): number {
  return normalizeIntegerLimit(getCrmPoolLevelRule(settings, level)?.privateLimit ?? settings.privateLimit, 1, 100000);
}

function getEffectivePoolLevelReclaimDays(settings: CrmPoolSettings, level: CrmPoolLevelKey): number {
  return normalizeIntegerLimit(getCrmPoolLevelRule(settings, level)?.autoReclaimDays ?? settings.autoReclaimDays, 1, 3650);
}

function getCrmPoolLevelFromRecord(record: Pick<CrmRecord, "data">): CrmPoolLevelKey {
  return getRecordCustomerLevel(record) ?? "unrated";
}

function getValidCustomerLevelValue(value: unknown): CustomerLevel | undefined {
  return value === "A" || value === "B" || value === "C" || value === "D" ? value : undefined;
}

function getContactTempCustomerLevel(record: Pick<CrmRecord, "data">): CrmPoolLevelKey {
  return getValidCustomerLevelValue(record.data.contactTempCustomerLevel) ?? "unrated";
}

function normalizeContactCustomerLevelData(data: Record<string, unknown>): Record<string, unknown> {
  const nextData = { ...data };
  const hasCompany = typeof nextData.companyId === "string" && nextData.companyId.trim().length > 0;
  const legacyLevel = getValidCustomerLevelValue(nextData.customerLevel);
  delete nextData.customerLevel;
  delete nextData.customerLevelSuggested;
  delete nextData.customerLevelScore;
  delete nextData.customerLevelReasons;
  delete nextData.customerLevelSuggestedAt;
  if (hasCompany) {
    delete nextData.contactTempCustomerLevel;
  } else if (!getValidCustomerLevelValue(nextData.contactTempCustomerLevel) && legacyLevel) {
    nextData.contactTempCustomerLevel = legacyLevel;
  }
  return nextData;
}

function mapCrmPoolSettings(settings: {
  workspaceId: string;
  enabled: boolean;
  objectKeys: string[];
  privateLimit: number;
  autoReclaimEnabled: boolean;
  autoReclaimDays: number;
  levelRules: Prisma.JsonValue;
  lastAutoReclaimAt: Date | null;
  lastAutoReclaimCount: number;
  updatedAt: Date;
}): CrmPoolSettings {
  const privateLimit = normalizeIntegerLimit(settings.privateLimit, 1, 100000);
  const autoReclaimDays = normalizeIntegerLimit(settings.autoReclaimDays, 1, 3650);
  return {
    workspaceId: settings.workspaceId,
    enabled: settings.enabled,
    objectKeys: settings.objectKeys.filter(isPoolObjectKey),
    privateLimit,
    autoReclaimEnabled: settings.autoReclaimEnabled,
    autoReclaimDays,
    levelRules: normalizeCrmPoolLevelRules(settings.levelRules),
    lastAutoReclaimAt: settings.lastAutoReclaimAt?.toISOString(),
    lastAutoReclaimCount: settings.lastAutoReclaimCount,
    updatedAt: settings.updatedAt.toISOString()
  };
}

const defaultCustomerLevelDefinitions: CustomerLevelSettings["levels"] = [
  { value: "A", label: "A 级客户", color: "#16a34a", position: 1, enabled: true, minScore: 85, maxScore: 100 },
  { value: "B", label: "B 级客户", color: "#2563eb", position: 2, enabled: true, minScore: 70, maxScore: 84 },
  { value: "C", label: "C 级客户", color: "#f59e0b", position: 3, enabled: true, minScore: 45, maxScore: 69 },
  { value: "D", label: "D 级客户", color: "#ef4444", position: 4, enabled: true, minScore: 0, maxScore: 44 }
];

const defaultCustomerLevelRules: CustomerLevelSettings["rules"] = {
  dealAmount: 30,
  dealStage: 20,
  recentActivity: 15,
  emailEngagement: 15,
  inactivity: 10,
  overdueTasks: 10
};

function mapCustomerLevelSettings(settings: {
  workspaceId: string;
  enabled: boolean;
  levels: Prisma.JsonValue;
  rules: Prisma.JsonValue;
  updatedAt: Date;
}): CustomerLevelSettings {
  return {
    workspaceId: settings.workspaceId,
    enabled: settings.enabled,
    levels: normalizeCustomerLevelDefinitions(settings.levels),
    rules: normalizeCustomerLevelRules(settings.rules),
    updatedAt: settings.updatedAt.toISOString()
  };
}

function normalizeCustomerLevelDefinitions(value: Prisma.JsonValue | unknown): CustomerLevelSettings["levels"] {
  const raw = Array.isArray(value) ? value : [];
  const byValue = new Map(defaultCustomerLevelDefinitions.map((level) => [level.value, level]));
  for (const item of raw) {
    if (!isJsonRecord(item)) {
      continue;
    }
    const levelValue = typeof item.value === "string" && ["A", "B", "C", "D"].includes(item.value) ? (item.value as CustomerLevel) : undefined;
    if (!levelValue) {
      continue;
    }
    const fallback = byValue.get(levelValue) ?? defaultCustomerLevelDefinitions[0];
    byValue.set(levelValue, {
      value: levelValue,
      label: typeof item.label === "string" && item.label.trim() ? item.label.trim().slice(0, 80) : fallback.label,
      color: typeof item.color === "string" && item.color.trim() ? item.color.trim().slice(0, 40) : fallback.color,
      position: normalizeIntegerLimit(Number(item.position), 0, 100),
      enabled: typeof item.enabled === "boolean" ? item.enabled : fallback.enabled,
      minScore: normalizeScoreNumber(item.minScore, fallback.minScore),
      maxScore: normalizeScoreNumber(item.maxScore, fallback.maxScore)
    });
  }
  return [...byValue.values()].sort((a, b) => a.position - b.position);
}

function normalizeCustomerLevelRules(value: Prisma.JsonValue | unknown): CustomerLevelSettings["rules"] {
  const raw = isJsonRecord(value) ? value : {};
  return {
    dealAmount: normalizeScoreNumber(raw.dealAmount, defaultCustomerLevelRules.dealAmount),
    dealStage: normalizeScoreNumber(raw.dealStage, defaultCustomerLevelRules.dealStage),
    recentActivity: normalizeScoreNumber(raw.recentActivity, defaultCustomerLevelRules.recentActivity),
    emailEngagement: normalizeScoreNumber(raw.emailEngagement, defaultCustomerLevelRules.emailEngagement),
    inactivity: normalizeScoreNumber(raw.inactivity, defaultCustomerLevelRules.inactivity),
    overdueTasks: normalizeScoreNumber(raw.overdueTasks, defaultCustomerLevelRules.overdueTasks)
  };
}

function normalizeScoreNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function customerLevelForScore(settings: CustomerLevelSettings, score: number): CustomerLevel {
  const enabled = settings.levels.filter((level) => level.enabled).sort((a, b) => a.position - b.position);
  const match = enabled.find((level) => score >= level.minScore && score <= level.maxScore);
  return match?.value ?? enabled[enabled.length - 1]?.value ?? "D";
}

function isCustomerLevelObjectKey(objectKey: string): objectKey is "contacts" | "companies" {
  return objectKey === "contacts" || objectKey === "companies";
}

function isCustomerLevelSuggestionObjectKey(objectKey: string): objectKey is "companies" {
  return objectKey === "companies";
}

function extractCustomerLevelPatch(patch: Prisma.JsonValue | null): { previousLevel?: string; nextLevel?: string } | undefined {
  if (!isJsonRecord(patch)) {
    return undefined;
  }
  const nextData = isJsonRecord(patch.data) ? patch.data : {};
  const previousPatch = previousRecordApprovalPatch(patch as RecordChangeRequest["patch"]);
  const previousData = isJsonRecord(previousPatch.data) ? previousPatch.data : {};
  const levelKey = Object.prototype.hasOwnProperty.call(nextData, "customerLevel")
    ? "customerLevel"
    : Object.prototype.hasOwnProperty.call(nextData, "contactTempCustomerLevel")
      ? "contactTempCustomerLevel"
      : undefined;
  if (!levelKey) {
    return undefined;
  }
  const nextLevel = typeof nextData[levelKey] === "string" ? nextData[levelKey] : undefined;
  const previousLevel = typeof previousData[levelKey] === "string" ? previousData[levelKey] : undefined;
  return { previousLevel, nextLevel };
}

function mapRecordChangeRequest(request: {
  id: string;
  workspaceId: string;
  objectKey: string;
  recordId: string;
  action: string;
  status: string;
  reason: string;
  requestedById: string;
  reviewedById: string | null;
  reviewNote: string | null;
  patch: Prisma.JsonValue | null;
  recordTitle: string;
  createdAt: Date;
  reviewedAt: Date | null;
}): RecordChangeRequest {
  return {
    id: request.id,
    workspaceId: request.workspaceId,
    objectKey: request.objectKey,
    recordId: request.recordId,
    action: request.action as RecordChangeRequest["action"],
    status: request.status as RecordChangeRequest["status"],
    reason: request.reason,
    requestedById: request.requestedById,
    reviewedById: request.reviewedById ?? undefined,
    reviewNote: request.reviewNote ?? undefined,
    patch: request.patch ? (request.patch as RecordChangeRequest["patch"]) : undefined,
    recordTitle: request.recordTitle,
    createdAt: request.createdAt.toISOString(),
    reviewedAt: request.reviewedAt?.toISOString()
  };
}

function readAiProviderConfigFromEncrypted(value?: string | null): AiProviderConfig {
  if (!value) {
    return normalizeAiProviderConfig(undefined);
  }
  try {
    return decryptAiProviderConfig(value);
  } catch {
    return normalizeAiProviderConfig(undefined);
  }
}

function readAiProviderSettingsBundleFromEncrypted(value?: string | null): { providerConfig: AiProviderConfig; providerProfiles: AiProviderProfile[] } {
  try {
    return decryptAiProviderSettingsBundle(value);
  } catch {
    const providerConfig = readAiProviderConfigFromEncrypted(value);
    return { providerConfig, providerProfiles: [] };
  }
}

function mapRole(role: { id: string; workspaceId: string; name: string; permissions: string[] }): Role {
  return {
    id: role.id,
    workspaceId: role.workspaceId,
    name: role.name,
    permissions: role.permissions as Role["permissions"]
  };
}

function mapTeam(team: { id: string; workspaceId: string; name: string; companyName: string | null; address: string | null; phone: string | null; email: string | null; website: string | null; whatsapp: string | null }): Team {
  return {
    id: team.id,
    workspaceId: team.workspaceId,
    name: team.name,
    companyName: team.companyName ?? undefined,
    address: team.address ?? undefined,
    phone: team.phone ?? undefined,
    email: team.email ?? undefined,
    website: team.website ?? undefined,
    whatsapp: team.whatsapp ?? undefined
  };
}

function mapObjectDefinition(object: {
  id: string;
  workspaceId: string;
  key: string;
  label: string;
  pluralLabel: string;
  description: string | null;
  icon: string | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ObjectDefinition {
  return {
    id: object.id,
    workspaceId: object.workspaceId,
    key: object.key,
    label: object.label,
    pluralLabel: object.pluralLabel,
    description: object.description ?? undefined,
    icon: object.icon ?? undefined,
    isSystem: object.isSystem,
    createdAt: object.createdAt.toISOString(),
    updatedAt: object.updatedAt.toISOString()
  };
}

function mapFieldDefinition(field: {
  id: string;
  workspaceId: string;
  key: string;
  label: string;
  type: string;
  required: boolean;
  unique: boolean;
  options: Prisma.JsonValue | null;
  defaultValue: Prisma.JsonValue | null;
  isSystem: boolean;
  position: number;
  objectDefinition: { key: string };
}): FieldDefinition {
  return {
    id: field.id,
    workspaceId: field.workspaceId,
    objectKey: field.objectDefinition.key,
    key: field.key,
    label: field.label,
    type: field.type as FieldDefinition["type"],
    required: field.required,
    unique: field.unique,
    options: (field.options as FieldDefinition["options"]) ?? undefined,
    defaultValue: field.defaultValue ?? undefined,
    isSystem: field.isSystem,
    position: field.position
  };
}

function mapRecord(record: {
  id: string;
  workspaceId: string;
  objectKey: string;
  title: string;
  stageKey: string | null;
  ownerId: string | null;
  tags: string[];
  tagColors: Prisma.JsonValue;
  data: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}): CrmRecord {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    objectKey: record.objectKey,
    title: record.title,
    stageKey: record.stageKey ?? undefined,
    ownerId: record.ownerId ?? undefined,
    tags: record.tags ?? [],
    tagColors: normalizeTagColors(asRecord(record.tagColors), record.tags ?? []),
    data: asRecord(record.data),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

function mapDocumentTemplate(template: {
  id: string;
  workspaceId: string;
  objectKey: string;
  name: string;
  active: boolean;
  isDefault: boolean;
  templateJson: Prisma.JsonValue;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}): DocumentTemplate {
  return {
    id: template.id,
    workspaceId: template.workspaceId,
    objectKey: template.objectKey,
    name: template.name,
    active: template.active,
    isDefault: template.isDefault,
    templateJson: asRecord(template.templateJson),
    createdById: template.createdById,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString()
  };
}

function mapPipeline(pipeline: {
  id: string;
  workspaceId: string;
  objectKey: string;
  name: string;
  isDefault: boolean;
  stages: Prisma.JsonValue;
}): Pipeline {
  return {
    id: pipeline.id,
    workspaceId: pipeline.workspaceId,
    objectKey: pipeline.objectKey,
    name: pipeline.name,
    isDefault: pipeline.isDefault,
    stages: asStages(pipeline.stages)
  };
}

function mapActivity(activity: {
  id: string;
  workspaceId: string;
  recordId: string | null;
  type: string;
  title: string;
  body: string | null;
  tags: string[];
  tagColors: Prisma.JsonValue;
  actorId: string | null;
  dueAt: Date | null;
  completedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
}): Activity {
  return {
    id: activity.id,
    workspaceId: activity.workspaceId,
    recordId: activity.recordId ?? undefined,
    type: activity.type as Activity["type"],
    title: activity.title,
    body: activity.body ?? undefined,
    tags: activity.tags ?? [],
    tagColors: normalizeTagColors(asRecord(activity.tagColors), activity.tags ?? []),
    actorId: activity.actorId ?? undefined,
    dueAt: activity.dueAt?.toISOString(),
    completedAt: activity.completedAt?.toISOString(),
    archivedAt: activity.archivedAt?.toISOString(),
    createdAt: activity.createdAt.toISOString()
  };
}

function mapAuditLog(log: {
  id: string;
  workspaceId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  objectKey: string | null;
  summary: string;
  details: Prisma.JsonValue | null;
  createdAt: Date;
}): AuditLog {
  return {
    id: log.id,
    workspaceId: log.workspaceId,
    actorId: log.actorId ?? undefined,
    action: log.action as AuditLog["action"],
    entityType: log.entityType,
    entityId: log.entityId ?? undefined,
    objectKey: log.objectKey ?? undefined,
    summary: log.summary,
    details: (log.details as AuditLog["details"]) ?? undefined,
    createdAt: log.createdAt.toISOString()
  };
}

function mapImportJob(job: {
  id: string;
  workspaceId: string;
  objectKey: string;
  status: string;
  strategy: string;
  totalRows: number;
  createdCount: number;
  errorCount: number;
  aborted: boolean;
  errorMessage: string | null;
  preview: Prisma.JsonValue | null;
  result: Prisma.JsonValue | null;
  sourcePayload?: Prisma.JsonValue | null;
  requestedById: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}): CsvImportJob {
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    objectKey: job.objectKey,
    status: job.status as CsvImportJob["status"],
    strategy: job.strategy as CsvImportJob["strategy"],
    totalRows: job.totalRows,
    createdCount: job.createdCount,
    errorCount: job.errorCount,
    aborted: job.aborted,
    errorMessage: job.errorMessage ?? undefined,
    preview: ((job.preview as unknown) as CsvImportJob["preview"]) ?? undefined,
    result: ((job.result as unknown) as CsvImportJob["result"]) ?? undefined,
    sourcePayload: mapImportJobSourcePayload(job.sourcePayload, job.objectKey, job.strategy),
    requestedById: job.requestedById ?? undefined,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString(),
    completedAt: job.completedAt?.toISOString()
  };
}

function mapImportPreset(preset: {
  id: string;
  workspaceId: string;
  objectKey: string;
  name: string;
  strategy: string;
  mapping: Prisma.JsonValue | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ImportPreset {
  return {
    id: preset.id,
    workspaceId: preset.workspaceId,
    objectKey: preset.objectKey,
    name: preset.name,
    strategy: preset.strategy as ImportPreset["strategy"],
    mapping: normalizeCsvImportMapping((preset.mapping as CsvImportMapping | undefined) ?? undefined),
    createdById: preset.createdById ?? undefined,
    createdAt: preset.createdAt.toISOString(),
    updatedAt: preset.updatedAt.toISOString()
  };
}

function mapImportJobSourcePayload(value: Prisma.JsonValue | null | undefined, fallbackObjectKey: string, fallbackStrategy: string): CsvImportJobSourcePayload | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  try {
    return normalizeImportJobSourcePayload(value, fallbackObjectKey, fallbackStrategy);
  } catch {
    return undefined;
  }
}

function normalizeEmailAttachments(value: unknown): EmailAttachment[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const attachments = value
    .map((item): EmailAttachment | undefined => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const attachment = item as Partial<EmailAttachment>;
      const fileName = typeof attachment.fileName === "string" ? attachment.fileName.trim() : "";
      if (!fileName) {
        return undefined;
      }
      return {
        ...(typeof attachment.id === "string" && attachment.id.trim() ? { id: attachment.id.trim() } : {}),
        fileName,
        contentType: typeof attachment.contentType === "string" && attachment.contentType.trim() ? attachment.contentType.trim() : "application/octet-stream",
        size: Number.isFinite(Number(attachment.size)) ? Math.max(0, Math.floor(Number(attachment.size))) : 0,
        ...(typeof attachment.contentBase64 === "string" && attachment.contentBase64.trim() ? { contentBase64: attachment.contentBase64.trim() } : {}),
        ...(typeof attachment.contentId === "string" && attachment.contentId.trim() ? { contentId: attachment.contentId.trim() } : {}),
        ...(attachment.disposition === "inline" ? { disposition: "inline" as const } : attachment.disposition === "attachment" ? { disposition: "attachment" as const } : {}),
        ...(typeof attachment.providerMessageId === "string" && attachment.providerMessageId.trim() ? { providerMessageId: attachment.providerMessageId.trim() } : {}),
        ...(typeof attachment.providerAttachmentId === "string" && attachment.providerAttachmentId.trim() ? { providerAttachmentId: attachment.providerAttachmentId.trim() } : {}),
        ...(typeof attachment.externalUrl === "string" && attachment.externalUrl.trim() ? { externalUrl: attachment.externalUrl.trim() } : {})
      };
    })
    .filter((attachment): attachment is EmailAttachment => Boolean(attachment));
  return attachments.length ? attachments : undefined;
}

function normalizeEmailTrackingEvents(value: unknown): EmailMessage["trackingEvents"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const events = value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const event = item as Record<string, unknown>;
      const type = event.type === "open" || event.type === "click" ? event.type : undefined;
      const occurredAt = typeof event.occurredAt === "string" ? event.occurredAt : "";
      if (!type || !occurredAt) {
        return undefined;
      }
      return {
        type,
        occurredAt,
        ...(typeof event.ip === "string" && event.ip.trim() ? { ip: event.ip.trim() } : {}),
        ...(typeof event.country === "string" && event.country.trim() ? { country: event.country.trim() } : {}),
        ...(typeof event.timezone === "string" && event.timezone.trim() ? { timezone: event.timezone.trim() } : {}),
        ...(typeof event.userAgent === "string" && event.userAgent.trim() ? { userAgent: event.userAgent.trim() } : {}),
        ...(typeof event.url === "string" && event.url.trim() ? { url: event.url.trim() } : {})
      };
    })
    .filter((event): event is NonNullable<EmailMessage["trackingEvents"]>[number] => Boolean(event));
  return events.length ? events : undefined;
}

function normalizeEmailInboundMetadata(value: unknown): EmailMessage["inboundMetadata"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  return {
    ...(typeof input.sourceIp === "string" && input.sourceIp.trim() ? { sourceIp: input.sourceIp.trim() } : {}),
    ...(typeof input.country === "string" && input.country.trim() ? { country: input.country.trim() } : {}),
    ...(typeof input.timezone === "string" && input.timezone.trim() ? { timezone: input.timezone.trim() } : {}),
    ...(typeof input.userAgent === "string" && input.userAgent.trim() ? { userAgent: input.userAgent.trim() } : {}),
    ...(typeof input.receivedHeader === "string" && input.receivedHeader.trim() ? { receivedHeader: input.receivedHeader.trim().slice(0, 2000) } : {}),
    ...(typeof input.sourceMailbox === "string" && input.sourceMailbox.trim() ? { sourceMailbox: input.sourceMailbox.trim().slice(0, 200) } : {}),
    ...(input.sourceMailboxRole === "inbox" || input.sourceMailboxRole === "spam" ? { sourceMailboxRole: input.sourceMailboxRole } : {})
  };
}

function normalizeEmailAiSources(value: unknown): NonNullable<EmailThread["aiAnalysisSources"]> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((source) => {
      if (!source || typeof source !== "object") {
        return undefined;
      }
      const item = source as Record<string, unknown>;
      const label = typeof item.label === "string" ? item.label.trim() : "";
      if (!label) {
        return undefined;
      }
      return {
        label,
        ...(typeof item.objectKey === "string" && item.objectKey.trim() ? { objectKey: item.objectKey.trim() } : {}),
        ...(typeof item.recordId === "string" && item.recordId.trim() ? { recordId: item.recordId.trim() } : {}),
        ...(typeof item.activityId === "string" && item.activityId.trim() ? { activityId: item.activityId.trim() } : {}),
        ...(typeof item.messageId === "string" && item.messageId.trim() ? { messageId: item.messageId.trim() } : {}),
        ...(typeof item.knowledgeArticleId === "string" && item.knowledgeArticleId.trim() ? { knowledgeArticleId: item.knowledgeArticleId.trim() } : {})
      };
    })
    .filter((source): source is NonNullable<EmailThread["aiAnalysisSources"]>[number] => Boolean(source))
    .slice(0, 20);
}

function normalizeTalkSources(value: unknown): TalkMessage["sources"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const sources = value
    .map((source) => {
      if (!source || typeof source !== "object") {
        return undefined;
      }
      const item = source as Record<string, unknown>;
      const label = typeof item.label === "string" ? item.label.trim().slice(0, 200) : "";
      if (!label) {
        return undefined;
      }
      return {
        label,
        ...(typeof item.objectKey === "string" && item.objectKey.trim() ? { objectKey: item.objectKey.trim() } : {}),
        ...(typeof item.recordId === "string" && item.recordId.trim() ? { recordId: item.recordId.trim() } : {}),
        ...(typeof item.messageId === "string" && item.messageId.trim() ? { messageId: item.messageId.trim() } : {}),
        ...(typeof item.knowledgeArticleId === "string" && item.knowledgeArticleId.trim() ? { knowledgeArticleId: item.knowledgeArticleId.trim() } : {})
      };
    })
    .filter((source): source is NonNullable<TalkMessage["sources"]>[number] => Boolean(source))
    .slice(0, 20);
  return sources.length ? sources : undefined;
}

function talkMessageTargetWhere(target: TalkMessageTargetInput): Prisma.TalkMessageWhereInput {
  return target.type === "record"
    ? { targetType: "record", objectKey: target.objectKey, recordId: target.recordId }
    : { targetType: "email_thread", threadId: target.threadId };
}

function normalizeEmailThreadCategory(value: unknown): EmailThread["category"] {
  return value === "primary" || value === "promotions" || value === "social" || value === "updates" ? value : undefined;
}

function classifyEmailCategory(message: EmailMessage): NonNullable<EmailThread["category"]> {
  const text = `${message.from} ${message.subject} ${message.bodyText}`.toLowerCase();
  if (/(unsubscribe|sale|discount|coupon|offer|promo|promotion|limited time|shop|store|newsletter|marketing|骞垮憡|淇冮攢|浼樻儬|鎶樻墸|璁㈤槄)/.test(text)) {
    return "promotions";
  }
  if (/(linkedin|facebook|instagram|twitter|x\.com|wechat|whatsapp|social|follower|connection|commented|liked|绀句氦|鍏虫敞|璇勮|鐐硅禐)/.test(text)) {
    return "social";
  }
  if (/(receipt|invoice|statement|security|alert|notification|update|verify|verification|password|billing|report|system|鎻愰啋|閫氱煡|鏇存柊|璐﹀崟|楠岃瘉|瀹夊叏)/.test(text)) {
    return "updates";
  }
  return "primary";
}

function normalizeEmailThreadLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter((label): label is string => typeof label === "string")
        .map((label) => label.trim())
        .filter(Boolean)
        .map((label) => label.slice(0, 40))
    )
  ).slice(0, 20);
}

function assertEmailOutboundAiPurpose(
  direction: EmailMessage["direction"],
  aiAssisted: boolean | undefined,
  aiPurpose: EmailMessage["aiPurpose"],
  aiGeneratedAt?: string
): void {
  if (direction !== "outbound" || !aiAssisted) {
    return;
  }
  if (!aiPurpose) {
    throw new Error("AI assisted outbound email requires aiPurpose");
  }
  if (aiPurpose !== "draft" && aiPurpose !== "translate") {
    throw new Error("AI assisted outbound email purpose must be draft or translate");
  }
  if (!aiGeneratedAt || Number.isNaN(Date.parse(aiGeneratedAt))) {
    throw new Error("AI assisted outbound email requires aiGeneratedAt");
  }
}

function assertEmailAiRecordThreadAlignment(recordId: string | undefined, thread: EmailThread | undefined): void {
  if (!recordId || !thread?.recordId) {
    return;
  }
  if (recordId !== thread.recordId) {
    throw new Error("Email AI context record does not match the selected thread");
  }
}

function normalizeImportJobSourcePayload(
  value: Prisma.JsonValue | null,
  fallbackObjectKey: string,
  fallbackStrategy: string
): CsvImportJobSourcePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Import job cannot be retried because its source payload is missing");
  }

  const payload = value as Record<string, unknown>;
  const objectKey = typeof payload.objectKey === "string" ? payload.objectKey : fallbackObjectKey;
  const csv = typeof payload.csv === "string" ? payload.csv : "";
  const strategy = normalizeCsvImportStrategy(payload.strategy, fallbackStrategy);
  const mapping = normalizeCsvImportMapping((payload.mapping as CsvImportMapping | undefined) ?? undefined);
  const presetId = typeof payload.presetId === "string" && payload.presetId.trim() ? payload.presetId.trim() : undefined;
  const presetName = typeof payload.presetName === "string" && payload.presetName.trim() ? payload.presetName.trim() : undefined;

  if (!csv.trim()) {
    throw new Error("Import job cannot be retried because its source CSV is missing");
  }

  return { objectKey, csv, strategy, mapping, presetId, presetName };
}

function normalizeCsvImportStrategy(value: unknown, fallback: unknown): CsvImportStrategy {
  if (value === "all-or-nothing" || value === "update-existing" || value === "skip-invalid") {
    return value;
  }
  if (fallback === "all-or-nothing" || fallback === "update-existing") {
    return fallback;
  }
  return "skip-invalid";
}

function mapSavedView(view: {
  id: string;
  workspaceId: string;
  name: string;
  columns: string[];
  filters: Prisma.JsonValue | null;
  sort: Prisma.JsonValue | null;
  isDefault: boolean;
  objectDefinition: { key: string };
}): SavedView {
  return {
    id: view.id,
    workspaceId: view.workspaceId,
    objectKey: view.objectDefinition.key,
    name: view.name,
    columns: view.columns,
    filters: ((view.filters as unknown) as SavedView["filters"]) ?? undefined,
    sort: ((view.sort as unknown) as SavedView["sort"]) ?? undefined,
    isDefault: view.isDefault
  };
}

function mapRelationDefinition(relation: {
  id: string;
  workspaceId: string;
  fromObjectKey: string;
  toObjectKey: string;
  key: string;
  label: string;
  cardinality: string;
}): RelationDefinition {
  return {
    id: relation.id,
    workspaceId: relation.workspaceId,
    fromObjectKey: relation.fromObjectKey,
    toObjectKey: relation.toObjectKey,
    key: relation.key,
    label: relation.label,
    cardinality: relation.cardinality as RelationDefinition["cardinality"]
  };
}

export async function getRequestContextByUserId(userId: string): Promise<RequestContext> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true }
  });

  if (!user || !user.role || !user.active) {
    throw new Error("Current user is not available");
  }

  return {
    workspaceId: user.workspaceId,
    user: mapUser(user),
    role: mapRole(user.role)
  };
}

export async function getRequestContextByApiKeyToken(token: string): Promise<RequestContext | null> {
  const apiKey = await prisma.apiKey.findUnique({
    where: { tokenHash: hashApiKeyToken(token) },
    include: { createdBy: { include: { role: true } } }
  });

  if (!apiKey || apiKey.revokedAt || (apiKey.expiresAt && apiKey.expiresAt <= new Date()) || !apiKey.createdBy.active) {
    return null;
  }

  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() }
  });

  return {
    workspaceId: apiKey.workspaceId,
    user: mapUser(apiKey.createdBy),
    role: {
      id: `api-key:${apiKey.id}`,
      workspaceId: apiKey.workspaceId,
      name: `API Key: ${apiKey.name}`,
      permissions: apiKey.permissions as Role["permissions"]
    }
  };
}

export class PrismaCrmRepository {
  private readonly db: PrismaContext;

  constructor(db: PrismaContext = prisma) {
    this.db = db;
  }

  async getUsers(context: RequestContext): Promise<User[]> {
    requirePermission(context, "crm.read");
    const users = await this.db.user.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: { createdAt: "asc" }
    });
    return users.map(mapUser);
  }

  async createUser(
    context: RequestContext,
    input: Pick<User, "email" | "name" | "roleId"> & Pick<Partial<User>, "teamId" | "active"> & { password: string }
  ): Promise<User> {
    requirePermission(context, "crm.admin");
    const data = await this.normalizeUserInput(context, input);
    const password = input.password.trim();
    if (password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }

    const active = input.active ?? true;
    const user = await this.db.user.create({
      data: {
        workspaceId: context.workspaceId,
        email: data.email,
        name: data.name,
        roleId: data.roleId,
        teamId: data.teamId,
        active,
        disabledAt: active ? null : new Date(),
        passwordHash: hashPassword(password)
      }
    });

    await this.writeAuditLog(context, "create", "user", user.id, {
      summary: `Created user ${user.email}`,
      details: { email: user.email, name: user.name, roleId: user.roleId, teamId: user.teamId, active: user.active }
    });

    return mapUser(user);
  }

  async listApiKeys(context: RequestContext): Promise<ApiKey[]> {
    requirePermission(context, "crm.admin");
    const keys = await this.db.apiKey.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: { createdAt: "desc" }
    });
    return keys.map(mapApiKey);
  }

  async createApiKey(
    context: RequestContext,
    input: { name: string; permissions: Permission[]; expiresAt?: string }
  ): Promise<CreatedApiKey> {
    requirePermission(context, "crm.admin");
    const data = normalizeApiKeyInput(input);
    const token = createApiKeyToken();
    const apiKey = await this.db.apiKey.create({
      data: {
        workspaceId: context.workspaceId,
        name: data.name,
        tokenHash: hashApiKeyToken(token),
        tokenPrefix: getApiKeyTokenPrefix(token),
        permissions: data.permissions,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
        createdById: context.user.id
      }
    });
    await this.writeAuditLog(context, "create", "api_key", apiKey.id, {
      summary: `Created API key ${apiKey.name}`,
      details: { permissions: apiKey.permissions, expiresAt: apiKey.expiresAt?.toISOString() }
    });
    return { apiKey: mapApiKey(apiKey), token };
  }

  async revokeApiKey(context: RequestContext, id: string): Promise<ApiKey> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.apiKey.findFirst({ where: { id, workspaceId: context.workspaceId } });
    if (!existing) {
      throw new Error("API key not found");
    }
    const revoked = await this.db.apiKey.update({
      where: { id },
      data: { revokedAt: existing.revokedAt ?? new Date() }
    });
    await this.writeAuditLog(context, "update", "api_key", id, {
      summary: `Revoked API key ${revoked.name}`,
      details: { tokenPrefix: revoked.tokenPrefix }
    });
    return mapApiKey(revoked);
  }

  async listWebhooks(context: RequestContext): Promise<WebhookEndpoint[]> {
    requirePermission(context, "crm.admin");
    const webhooks = await this.db.webhookEndpoint.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: { createdAt: "desc" }
    });
    return webhooks.map(mapWebhookEndpoint);
  }

  async createWebhook(
    context: RequestContext,
    input: { name: string; url: string; events: string[]; active?: boolean }
  ): Promise<CreatedWebhookEndpoint> {
    requirePermission(context, "crm.admin");
    const data = normalizeWebhookInput(input);
    const secret = createWebhookSecret();
    const webhook = await this.db.webhookEndpoint.create({
      data: {
        workspaceId: context.workspaceId,
        name: data.name,
        url: data.url,
        events: data.events,
        secret,
        secretPrefix: getWebhookSecretPrefix(secret),
        active: data.active,
        createdById: context.user.id
      }
    });
    await this.writeAuditLog(context, "create", "webhook", webhook.id, {
      summary: `Created webhook ${webhook.name}`,
      details: { url: webhook.url, events: webhook.events, active: webhook.active }
    });
    return { webhook: mapWebhookEndpoint(webhook), secret };
  }

  async updateWebhook(
    context: RequestContext,
    id: string,
    patch: Partial<{ name: string; url: string; events: string[]; active: boolean }>
  ): Promise<WebhookEndpoint> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.webhookEndpoint.findFirst({ where: { id, workspaceId: context.workspaceId } });
    if (!existing) {
      throw new Error("Webhook not found");
    }
    const data = normalizeWebhookInput({
      name: patch.name ?? existing.name,
      url: patch.url ?? existing.url,
      events: patch.events ?? existing.events,
      active: patch.active ?? existing.active
    });
    const updated = await this.db.webhookEndpoint.update({
      where: { id },
      data
    });
    await this.writeAuditLog(context, "update", "webhook", id, {
      summary: `Updated webhook ${updated.name}`,
      details: { url: updated.url, events: updated.events, active: updated.active }
    });
    return mapWebhookEndpoint(updated);
  }

  async deleteWebhook(context: RequestContext, id: string): Promise<void> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.webhookEndpoint.findFirst({ where: { id, workspaceId: context.workspaceId } });
    if (!existing) {
      throw new Error("Webhook not found");
    }
    await this.db.webhookDelivery.deleteMany({ where: { webhookId: id, workspaceId: context.workspaceId } });
    await this.db.webhookEndpoint.delete({ where: { id } });
    await this.writeAuditLog(context, "delete", "webhook", id, {
      summary: `Deleted webhook ${existing.name}`,
      details: { url: existing.url, events: existing.events }
    });
  }

  async listWorkflows(context: RequestContext): Promise<WorkflowDefinition[]> {
    requirePermission(context, "workflow.read");
    const rows = await this.workflowTables().workflowDefinition.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: [{ updatedAt: "desc" }]
    });
    return rows.map((row: Record<string, unknown>) => mapWorkflowDefinition(row));
  }

  async getWorkflow(context: RequestContext, id: string): Promise<WorkflowDefinition> {
    requirePermission(context, "workflow.read");
    const row = await this.workflowTables().workflowDefinition.findFirst({ where: { id, workspaceId: context.workspaceId } });
    if (!row) {
      throw new Error("Workflow not found");
    }
    return mapWorkflowDefinition(row);
  }

  async createWorkflow(
    context: RequestContext,
    input: Omit<WorkflowDefinition, "id" | "workspaceId" | "createdById" | "createdAt" | "updatedAt" | "version" | "lastRunAt" | "status"> & Partial<Pick<WorkflowDefinition, "version" | "status">>
  ): Promise<WorkflowDefinition> {
    requirePermission(context, "workflow.write");
    const graph = input.graph ? normalizeWorkflowGraph(input.graph, input) : undefined;
    const legacy = graph ? graphToLegacyWorkflow(graph) : input;
    const row = await this.workflowTables().workflowDefinition.create({
      data: {
        workspaceId: context.workspaceId,
        name: normalizeRequiredText(input.name, "Workflow name"),
        description: input.description?.trim() || undefined,
        goal: normalizeRequiredText(input.goal, "Workflow goal"),
        status: input.status ?? "draft",
        trigger: toJsonObject(legacy.trigger),
        conditions: toJsonArray(legacy.conditions ?? []),
        actions: toJsonArray(legacy.actions ?? []),
        graph: graph ? toJsonObject(graph) : undefined,
        version: input.version ?? 1,
        createdById: context.user.id
      }
    });
    const workflow = mapWorkflowDefinition(row);
    await this.writeAuditLog(context, "workflow.created", "workflow", workflow.id, {
      summary: `Created workflow ${workflow.name}`,
      details: { status: workflow.status, trigger: workflow.trigger, actionCount: workflow.actions.length }
    });
    return workflow;
  }

  async updateWorkflow(
    context: RequestContext,
    id: string,
    patch: Partial<Omit<WorkflowDefinition, "id" | "workspaceId" | "createdById" | "createdAt" | "updatedAt" | "lastRunAt">>
  ): Promise<WorkflowDefinition> {
    requirePermission(context, "workflow.write");
    const existing = await this.getWorkflow(context, id);
    const graph = patch.graph ? normalizeWorkflowGraph(patch.graph, patch.trigger && patch.conditions && patch.actions ? patch as Pick<WorkflowDefinition, "trigger" | "conditions" | "actions"> : existing) : undefined;
    const legacy = graph ? graphToLegacyWorkflow(graph) : undefined;
    const row = await this.workflowTables().workflowDefinition.update({
      where: { id },
      data: {
        name: patch.name !== undefined ? normalizeRequiredText(patch.name, "Workflow name") : undefined,
        description: patch.description !== undefined ? patch.description?.trim() || null : undefined,
        goal: patch.goal !== undefined ? normalizeRequiredText(patch.goal, "Workflow goal") : undefined,
        status: patch.status,
        trigger: legacy ? toJsonObject(legacy.trigger) : patch.trigger ? toJsonObject(patch.trigger) : undefined,
        conditions: legacy ? toJsonArray(legacy.conditions) : patch.conditions ? toJsonArray(patch.conditions) : undefined,
        actions: legacy ? toJsonArray(legacy.actions) : patch.actions ? toJsonArray(patch.actions) : undefined,
        graph: graph ? toJsonObject(graph) : undefined,
        version: patch.version
      }
    });
    const workflow = mapWorkflowDefinition(row);
    await this.writeAuditLog(context, "workflow.updated", "workflow", workflow.id, {
      summary: `Updated workflow ${workflow.name}`,
      details: { previousStatus: existing.status, status: workflow.status }
    });
    return workflow;
  }

  async deleteWorkflow(context: RequestContext, id: string): Promise<void> {
    requirePermission(context, "workflow.admin");
    const existing = await this.getWorkflow(context, id);
    await this.workflowTables().workflowDefinition.delete({ where: { id } });
    await this.writeAuditLog(context, "workflow.deleted", "workflow", id, {
      summary: `Deleted workflow ${existing.name}`,
      details: { status: existing.status }
    });
  }

  async enableWorkflow(context: RequestContext, id: string): Promise<WorkflowDefinition> {
    requirePermission(context, "workflow.admin");
    const workflow = await this.updateWorkflow(context, id, { status: "active" });
    await this.writeAuditLog(context, "workflow.enabled", "workflow", id, { summary: `Enabled workflow ${workflow.name}` });
    return workflow;
  }

  async disableWorkflow(context: RequestContext, id: string): Promise<WorkflowDefinition> {
    requirePermission(context, "workflow.admin");
    const workflow = await this.updateWorkflow(context, id, { status: "disabled" });
    await this.writeAuditLog(context, "workflow.disabled", "workflow", id, { summary: `Disabled workflow ${workflow.name}` });
    return workflow;
  }

  async generateWorkflow(context: RequestContext, input: WorkflowAiGenerationRequest): Promise<WorkflowAiGenerationResult> {
    requirePermission(context, "workflow.write");
    let recordTitle = input.recordTitle;
    if (!recordTitle && input.objectKey && input.recordId) {
      const record = await this.db.crmRecord.findFirst({
        where: {
          id: input.recordId,
          workspaceId: context.workspaceId,
          objectKey: input.objectKey
        },
        select: { title: true }
      });
      recordTitle = record?.title;
    }
    const settings = await this.ensureEmailAiSettings(context.workspaceId);
    const providerConfig = await this.getEmailAiProviderConfigForWorkspace(context.workspaceId);
    return generateWorkflowWithAiDesigner({ ...input, recordTitle }, { settings, providerConfig });
  }

  async listWorkflowRuns(context: RequestContext, workflowId?: string): Promise<WorkflowRun[]> {
    requirePermission(context, "workflow.read");
    const rows = await this.workflowTables().workflowRun.findMany({
      where: { workspaceId: context.workspaceId, ...(workflowId ? { workflowId } : {}) },
      orderBy: { startedAt: "desc" },
      take: 100
    });
    return rows.map((row: Record<string, unknown>) => mapWorkflowRun(row));
  }

  async listWorkflowApprovals(context: RequestContext): Promise<WorkflowActionApproval[]> {
    requirePermission(context, "workflow.read");
    const rows = await this.workflowTables().workflowActionApproval.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    return rows.map((row: Record<string, unknown>) => mapWorkflowApproval(row));
  }

  async getSalesDocumentNumberSettings(context: RequestContext): Promise<SalesDocumentNumberSetting[]> {
    requirePermission(context, "crm.read");
    const rows = await this.db.salesDocumentNumberSetting.findMany({ where: { workspaceId: context.workspaceId } });
    return salesDocumentObjectKeys.map((objectKey) => {
      const row = rows.find((candidate) => candidate.objectKey === objectKey);
      return row
        ? { workspaceId: row.workspaceId, objectKey, pattern: row.pattern, sequencePadding: row.sequencePadding, updatedAt: row.updatedAt.toISOString() }
        : defaultSalesDocumentNumberSetting(context.workspaceId, objectKey);
    });
  }

  async updateSalesDocumentNumberSettings(
    context: RequestContext,
    settings: Array<Pick<SalesDocumentNumberSetting, "objectKey" | "pattern" | "sequencePadding">>
  ): Promise<SalesDocumentNumberSetting[]> {
    requirePermission(context, "crm.admin");
    settings.forEach((setting) => validateSalesDocumentNumberRule(setting.pattern, setting.sequencePadding));
    await this.db.$transaction(
      settings.map((setting) => this.db.salesDocumentNumberSetting.upsert({
        where: { workspaceId_objectKey: { workspaceId: context.workspaceId, objectKey: setting.objectKey } },
        create: { workspaceId: context.workspaceId, objectKey: setting.objectKey, pattern: setting.pattern.trim(), sequencePadding: setting.sequencePadding },
        update: { pattern: setting.pattern.trim(), sequencePadding: setting.sequencePadding }
      }))
    );
    return this.getSalesDocumentNumberSettings(context);
  }

  async previewSalesDocumentNumber(context: RequestContext, objectKey: SalesDocumentObjectKey, now = new Date()): Promise<SalesDocumentNumberPreview> {
    requirePermission(context, "crm.write");
    const row = await this.db.salesDocumentNumberSetting.findUnique({ where: { workspaceId_objectKey: { workspaceId: context.workspaceId, objectKey } } });
    const setting = row
      ? { workspaceId: row.workspaceId, objectKey, pattern: row.pattern, sequencePadding: row.sequencePadding, updatedAt: row.updatedAt.toISOString() } as SalesDocumentNumberSetting
      : defaultSalesDocumentNumberSetting(context.workspaceId, objectKey);
    return { objectKey, preview: previewSalesDocumentNumber(setting, now), pattern: setting.pattern, sequencePadding: setting.sequencePadding };
  }

  async listWorkflowResumes(context: RequestContext, workflowId?: string): Promise<WorkflowResume[]> {
    requirePermission(context, "workflow.read");
    const rows = await this.workflowTables().workflowResume.findMany({
      where: { workspaceId: context.workspaceId, ...(workflowId ? { workflowId } : {}) },
      orderBy: { resumeAt: "asc" },
      take: 100
    });
    return rows.map((row: Record<string, unknown>) => mapWorkflowResume(row));
  }

  async testWorkflow(context: RequestContext, workflowId: string, data: Record<string, unknown> = {}): Promise<WorkflowRun> {
    requirePermission(context, "workflow.write");
    const workflow = await this.getWorkflow(context, workflowId);
    const run = await this.runSingleWorkflow(context, workflow, "manual.run", data, { test: true });
    if (!run) {
      throw new Error("Workflow test did not produce a run");
    }
    return run;
  }

  async runWorkflowsForEvent(
    context: RequestContext,
    event: string,
    data: Record<string, unknown>,
    options: { workflowId?: string; idempotencyKey?: string; test?: boolean } = {}
  ): Promise<WorkflowRun[]> {
    const workflows = options.workflowId
      ? [
          await this.workflowTables()
            .workflowDefinition.findFirst({ where: { id: options.workflowId, workspaceId: context.workspaceId } })
            .then((row: Record<string, unknown> | null) => {
              if (!row) throw new Error("Workflow not found");
              return mapWorkflowDefinition(row);
            })
        ]
      : await this.workflowTables()
          .workflowDefinition.findMany({ where: { workspaceId: context.workspaceId, status: "active" }, orderBy: { updatedAt: "desc" } })
          .then((rows: Array<Record<string, unknown>>) => rows.map(mapWorkflowDefinition).filter((workflow) => workflowMatchesEvent(workflow, event, data)));
    const runs: WorkflowRun[] = [];
    for (const workflow of workflows) {
      const run = await this.runSingleWorkflow(context, workflow, event, data, options).catch(async (error) => {
        const message = error instanceof Error ? error.message : "Workflow run failed";
        await this.writeAuditLog(context, "workflow.run_failed", "workflow", workflow.id, {
          summary: `Workflow ${workflow.name} failed: ${message}`,
          details: { event, data }
        });
        return undefined;
      });
      if (run) {
        runs.push(run);
      }
    }
    return runs;
  }

  async runWorkflowResume(context: RequestContext, resumeId: string): Promise<WorkflowRun | undefined> {
    requirePermission(context, "workflow.write");
    const row = await this.workflowTables().workflowResume.findFirst({ where: { id: resumeId, workspaceId: context.workspaceId } });
    if (!row) throw new Error("Workflow resume not found");
    const resume = mapWorkflowResume(row);
    if (resume.status !== "pending") {
      return undefined;
    }
    const workflow = await this.getWorkflow(context, resume.workflowId);
    const existingRun = await this.workflowTables().workflowRun.findFirst({ where: { id: resume.runId, workspaceId: context.workspaceId } });
    if (!existingRun) throw new Error("Workflow run not found");
    const startedAt = new Date(existingRun.startedAt as Date | string);
    const run = mapWorkflowRun(existingRun);
    const record = await this.workflowRecordFromData(context, resume.triggerData);
    try {
      const graphResults = await this.runWorkflowGraph(context, workflow, resume.triggerData, record, run.id, {
        startNodeId: resume.nodeId,
        previousNodeResults: run.nodeResults ?? []
      });
      const finalStatus = workflowGraphRunStatus(graphResults.actionResults, graphResults.nodeResults);
      await this.workflowTables().workflowResume.update({ where: { id: resume.id }, data: { status: "completed", errorMessage: null } });
      const updatedRun = mapWorkflowRun(
        await this.workflowTables().workflowRun.update({
          where: { id: run.id },
          data: {
            status: finalStatus,
            conditionResults: toJsonArray([...(run.conditionResults ?? []), ...graphResults.conditionResults]),
            actionResults: toJsonArray([...(run.actionResults ?? []), ...graphResults.actionResults]),
            nodeResults: toJsonArray(graphResults.nodeResults),
            completedAt: finalStatus === "waiting" ? null : new Date(),
            durationMs: Date.now() - startedAt.getTime()
          }
        })
      );
      await this.workflowTables().workflowDefinition.update({ where: { id: workflow.id }, data: { lastRunAt: new Date() } });
      return updatedRun;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workflow resume failed";
      await this.workflowTables().workflowResume.update({ where: { id: resume.id }, data: { status: "failed", errorMessage: message } });
      await this.workflowTables().workflowRun.update({ where: { id: run.id }, data: { status: "failed", errorMessage: message, completedAt: new Date(), durationMs: Date.now() - startedAt.getTime() } });
      throw error;
    }
  }

  async runWorkflowResumeScan(context: RequestContext, options: { limit?: number; now?: Date } = {}): Promise<{ scanned: number; resumed: number; runs: WorkflowRun[] }> {
    requirePermission(context, "workflow.write");
    const now = options.now ?? new Date();
    const rows = await this.workflowTables().workflowResume.findMany({
      where: { workspaceId: context.workspaceId, status: "pending", resumeAt: { lte: now } },
      orderBy: { resumeAt: "asc" },
      take: Math.min(Math.max(options.limit ?? 25, 1), 100)
    });
    const runs: WorkflowRun[] = [];
    for (const row of rows) {
      const run = await this.runWorkflowResume(context, String(row.id));
      if (run) runs.push(run);
    }
    return { scanned: rows.length, resumed: runs.length, runs };
  }

  async runWorkflowScheduleScan(context: RequestContext, options: { now?: Date; limit?: number } = {}): Promise<{ scanned: number; triggered: number; runs: WorkflowRun[] }> {
    requirePermission(context, "workflow.write");
    const now = options.now ?? new Date();
    const todayKey = workflowDateKey(now);
    const workflows = await this.workflowTables()
      .workflowDefinition.findMany({ where: { workspaceId: context.workspaceId, status: "active" }, orderBy: { updatedAt: "desc" } })
      .then((rows: Array<Record<string, unknown>>) => rows.map(mapWorkflowDefinition).filter((workflow) => workflow.trigger.type === "schedule" && workflow.trigger.event === "schedule.daily"));
    const runs: WorkflowRun[] = [];
    let scanned = 0;
    for (const workflow of workflows.slice(0, Math.min(Math.max(options.limit ?? 50, 1), 200))) {
      scanned += 1;
      const dateConfig = workflowDateMatchConfig(workflow);
      if (!dateConfig) {
        const idempotencyKey = `${workflow.id}:schedule.daily:${todayKey}`;
        const existing = await this.workflowTables().workflowRun.findFirst({ where: { workspaceId: context.workspaceId, workflowId: workflow.id, idempotencyKey } });
        if (existing) continue;
        const [run] = await this.runWorkflowsForEvent(context, "schedule.daily", { scheduledAt: now.toISOString(), date: todayKey }, { workflowId: workflow.id, idempotencyKey });
        if (run) runs.push(run);
        continue;
      }
      const objectKey = dateConfig.objectKey ?? workflow.trigger.objectKey ?? workflow.graph?.scope.objectKey ?? "contacts";
      const records = await this.listRecords(context, objectKey);
      for (const record of records) {
        const raw = record.data[dateConfig.field];
        const recordDate = parseWorkflowDate(raw);
        if (!recordDate || workflowMonthDay(recordDate) !== workflowMonthDay(now)) continue;
        const idempotencyKey = `${workflow.id}:schedule.daily:${record.id}:${dateConfig.field}:${todayKey}`;
        const existing = await this.workflowTables().workflowRun.findFirst({ where: { workspaceId: context.workspaceId, workflowId: workflow.id, idempotencyKey } });
        if (existing) continue;
        const [run] = await this.runWorkflowsForEvent(
          context,
          "schedule.daily",
          { objectKey, recordId: record.id, title: record.title, scheduledAt: now.toISOString(), date: todayKey, dateField: dateConfig.field, dateValue: String(raw), dateMatch: true },
          { workflowId: workflow.id, idempotencyKey }
        );
        if (run) runs.push(run);
      }
    }
    return { scanned, triggered: runs.length, runs };
  }

  async reviewWorkflowApproval(context: RequestContext, approvalId: string, decision: "approved" | "rejected", note?: string): Promise<WorkflowActionApproval> {
    requirePermission(context, "workflow.admin");
    const approvalRow = await this.workflowTables().workflowActionApproval.findFirst({ where: { id: approvalId, workspaceId: context.workspaceId } });
    if (!approvalRow) {
      throw new Error("Workflow approval not found");
    }
    const approval = mapWorkflowApproval(approvalRow);
    if (approval.status !== "pending") {
      return approval;
    }
    const updatedRow = await this.workflowTables().workflowActionApproval.update({
      where: { id: approvalId },
      data: {
        status: decision,
        reviewedById: context.user.id,
        reviewNote: note?.trim() || undefined,
        reviewedAt: new Date()
      }
    });
    const updated = mapWorkflowApproval(updatedRow);
    await this.writeAuditLog(context, decision === "approved" ? "workflow.action_approved" : "workflow.action_rejected", "workflow_approval", approvalId, {
      summary: `${decision === "approved" ? "Approved" : "Rejected"} workflow action ${approval.actionKey}`,
      details: { workflowId: approval.workflowId, runId: approval.runId, note }
    });
    if (decision === "approved") {
      const payload = approval.payload;
      const action = isJsonRecord(payload.action) ? normalizeWorkflowActions([payload.action])[0] : undefined;
      if (action) {
        const workflow = await this.getWorkflow(context, approval.workflowId);
        const triggerData = isJsonRecord(payload.triggerData) ? payload.triggerData : {};
        const record = await this.workflowRecordFromData(context, triggerData);
        await this.executeWorkflowAction(context, workflow, action, triggerData, record, approval.runId);
      }
    }
    return updated;
  }

  async listNotificationChannels(context: RequestContext): Promise<NotificationChannel[]> {
    requirePermission(context, "crm.admin");
    const channels = await this.db.notificationChannel.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: { createdAt: "desc" }
    });
    return channels.map(mapNotificationChannel);
  }

  async createNotificationChannel(
    context: RequestContext,
    input: { name: string; type: NotificationChannelType; events: string[]; config: Record<string, unknown>; active?: boolean }
  ): Promise<NotificationChannel> {
    requirePermission(context, "crm.admin");
    const data = normalizeNotificationChannelInput(input);
    const channel = await this.db.notificationChannel.create({
      data: {
        workspaceId: context.workspaceId,
        name: data.name,
        type: data.type,
        events: data.events,
        config: data.config as Prisma.InputJsonValue,
        active: data.active,
        createdById: context.user.id
      }
    });
    await this.writeAuditLog(context, "create", "notification_channel", channel.id, {
      summary: `Created notification channel ${channel.name}`,
      details: { type: channel.type, events: channel.events, active: channel.active }
    });
    return mapNotificationChannel(channel);
  }

  async updateNotificationChannel(
    context: RequestContext,
    id: string,
    patch: Partial<{ name: string; type: NotificationChannelType; events: string[]; config: Record<string, unknown>; active: boolean }>
  ): Promise<NotificationChannel> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.notificationChannel.findFirst({ where: { id, workspaceId: context.workspaceId } });
    if (!existing) {
      throw new Error("Notification channel not found");
    }
    const data = normalizeNotificationChannelInput({
      name: patch.name ?? existing.name,
      type: patch.type ?? (existing.type as NotificationChannelType),
      events: patch.events ?? existing.events,
      config: patch.config ?? asRecord(existing.config),
      active: patch.active ?? existing.active
    });
    const updated = await this.db.notificationChannel.update({
      where: { id },
      data: {
        name: data.name,
        type: data.type,
        events: data.events,
        config: data.config as Prisma.InputJsonValue,
        active: data.active
      }
    });
    await this.writeAuditLog(context, "update", "notification_channel", updated.id, {
      summary: `Updated notification channel ${updated.name}`,
      details: { type: updated.type, events: updated.events, active: updated.active }
    });
    return mapNotificationChannel(updated);
  }

  async deleteNotificationChannel(context: RequestContext, id: string): Promise<void> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.notificationChannel.findFirst({ where: { id, workspaceId: context.workspaceId } });
    if (!existing) {
      throw new Error("Notification channel not found");
    }
    await this.db.notificationChannel.delete({ where: { id } });
    await this.writeAuditLog(context, "delete", "notification_channel", existing.id, {
      summary: `Deleted notification channel ${existing.name}`,
      details: { type: existing.type, events: existing.events }
    });
  }

  async listWebhookDeliveries(
    context: RequestContext,
    webhookId?: string,
    query: { status?: WebhookDeliveryStatus; event?: WebhookEvent; limit?: number } = {}
  ): Promise<WebhookDelivery[]> {
    requirePermission(context, "crm.admin");
    const deliveries = await this.db.webhookDelivery.findMany({
      where: {
        workspaceId: context.workspaceId,
        ...(webhookId ? { webhookId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.event ? { event: query.event } : {})
      },
      orderBy: { createdAt: "desc" },
      take: query.limit ?? 50
    });
    return deliveries.map(mapWebhookDelivery);
  }

  async testWebhook(context: RequestContext, id: string): Promise<WebhookDelivery> {
    requirePermission(context, "crm.admin");
    const webhook = await this.db.webhookEndpoint.findFirst({ where: { id, workspaceId: context.workspaceId } });
    if (!webhook) {
      throw new Error("Webhook not found");
    }
    if (!webhook.active) {
      throw new Error("Webhook is inactive");
    }
    return this.deliverWebhook(context, webhook, "webhook.test", {
      workspaceId: context.workspaceId,
      webhookId: webhook.id,
      sentById: context.user.id,
      test: true
    });
  }

  async retryWebhookDelivery(context: RequestContext, webhookId: string, deliveryId: string): Promise<WebhookDelivery> {
    requirePermission(context, "crm.admin");
    const webhook = await this.db.webhookEndpoint.findFirst({ where: { id: webhookId, workspaceId: context.workspaceId } });
    if (!webhook) {
      throw new Error("Webhook not found");
    }
    if (!webhook.active) {
      throw new Error("Webhook is inactive");
    }

    const delivery = await this.db.webhookDelivery.findFirst({
      where: { id: deliveryId, webhookId, workspaceId: context.workspaceId }
    });
    if (!delivery) {
      throw new Error("Webhook delivery not found");
    }

    const requestBody = asRecord(delivery.requestBody);
    const data = asRecord(requestBody.data as Prisma.JsonValue);
    return this.deliverWebhook(context, webhook, delivery.event as WebhookEvent, data, delivery.attempts + 1);
  }

  async listEmailAccounts(context: RequestContext): Promise<EmailAccount[]> {
    requirePermission(context, "crm.read");
    const accounts = await this.db.emailAccount.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: [{ emailAddress: "asc" }, { createdAt: "asc" }]
    });
    return accounts.map(mapEmailAccount);
  }

  async getEmailAccount(context: RequestContext, accountId: string): Promise<EmailAccount> {
    requirePermission(context, "crm.read");
    return this.assertEmailAccount(context, accountId);
  }

  async createEmailAccount(
    context: RequestContext,
    input: Pick<EmailAccount, "name" | "emailAddress" | "provider"> &
      Partial<Pick<EmailAccount, "syncEnabled" | "sendEnabled" | "status">> & { defaultSignatureId?: string | null; connectionConfig?: EmailConnectionConfig }
  ): Promise<EmailAccount> {
    requirePermission(context, "crm.admin");
    const toggles = normalizeEmailAccountToggles(input.provider, {
      syncEnabled: input.syncEnabled ?? false,
      sendEnabled: input.sendEnabled ?? false
    });
    const emailAddress = normalizeEmailAddress(input.emailAddress);
    await this.assertEmailAccountEmailAvailable(context, emailAddress);
    const defaultSignatureId = await this.normalizeEmailAccountDefaultSignatureId(context, input.defaultSignatureId);
    const account = await this.db.emailAccount.create({
      data: {
        workspaceId: context.workspaceId,
        name: normalizeRequiredText(input.name, "Email account name"),
        emailAddress,
        provider: input.provider,
        status: input.status ?? "draft",
        syncEnabled: toggles.syncEnabled,
        sendEnabled: toggles.sendEnabled,
        defaultSignatureId,
        encryptedConnectionConfig: input.connectionConfig ? encryptEmailConnectionConfig(input.connectionConfig) : undefined,
        lastConnectionError: null,
        createdById: context.user.id
      }
    });
    await this.writeAuditLog(context, "create", "email_account", account.id, {
      summary: `Created email account ${account.emailAddress}`,
      details: { provider: account.provider, syncEnabled: account.syncEnabled, sendEnabled: account.sendEnabled }
    });
    return mapEmailAccount(account);
  }

  async updateEmailAccount(
    context: RequestContext,
    accountId: string,
    input: Partial<Pick<EmailAccount, "name" | "emailAddress" | "provider" | "syncEnabled" | "sendEnabled" | "status">> & {
      defaultSignatureId?: string | null;
      connectionConfig?: EmailConnectionConfig;
      clearConnectionConfig?: boolean;
    }
  ): Promise<EmailAccount> {
    requirePermission(context, "crm.admin");
    const existing = await this.assertEmailAccount(context, accountId);
    const data: Prisma.EmailAccountUpdateInput = {};
    const provider = input.provider ?? existing.provider;
    const toggles = normalizeEmailAccountToggles(provider, {
      syncEnabled: input.syncEnabled ?? existing.syncEnabled,
      sendEnabled: input.sendEnabled ?? existing.sendEnabled
    });
    const emailAddress = input.emailAddress !== undefined ? normalizeEmailAddress(input.emailAddress) : existing.emailAddress;
    await this.assertEmailAccountEmailAvailable(context, emailAddress, existing.id);
    if (input.name !== undefined) data.name = normalizeRequiredText(input.name, "Email account name");
    if (input.emailAddress !== undefined) data.emailAddress = emailAddress;
    if (input.provider !== undefined) data.provider = input.provider;
    if (input.status !== undefined) data.status = input.status;
    if (input.defaultSignatureId !== undefined) {
      data.defaultSignatureId = await this.normalizeEmailAccountDefaultSignatureId(context, input.defaultSignatureId, existing.id);
    }
    data.syncEnabled = toggles.syncEnabled;
    data.sendEnabled = toggles.sendEnabled;
    if (input.provider !== undefined && input.provider !== existing.provider) {
      data.imapUidValidity = null;
      data.imapLastSeenUid = null;
    }
    if (input.connectionConfig) {
      const existingConfig = await this.getEmailAccountConnectionConfig(context, existing.id);
      const mergedConfig = mergeEmailConnectionConfigSecrets(existingConfig, input.connectionConfig);
      if (shouldResetImapSyncCursor(existing.provider, existingConfig, mergedConfig)) {
        data.imapUidValidity = null;
        data.imapLastSeenUid = null;
      }
      data.encryptedConnectionConfig = encryptEmailConnectionConfig(mergeEmailConnectionConfigSecrets(existingConfig, input.connectionConfig));
      data.lastConnectionError = null;
      if (input.status === undefined && existing.status === "draft") {
        data.status = "active";
      }
    }
    if (input.clearConnectionConfig) {
      data.encryptedConnectionConfig = null;
      data.lastConnectionError = null;
      data.imapUidValidity = null;
      data.imapLastSeenUid = null;
      if (input.status === undefined) {
        data.status = "draft";
      }
    }
    const account = await this.db.emailAccount.update({
      where: { id: existing.id },
      data
    });
    await this.writeAuditLog(context, "update", "email_account", account.id, {
      summary: `Updated email account ${account.emailAddress}`,
      details: {
        provider: account.provider,
        status: account.status,
        syncEnabled: account.syncEnabled,
        sendEnabled: account.sendEnabled,
        connectionConfigured: Boolean(account.encryptedConnectionConfig)
      }
    });
    return mapEmailAccount(account);
  }

  async deleteEmailAccount(context: RequestContext, accountId: string): Promise<void> {
    requirePermission(context, "crm.admin");
    const existing = await this.assertEmailAccount(context, accountId);
    const messageCount = await this.db.emailMessage.count({
      where: { workspaceId: context.workspaceId, accountId: existing.id }
    });
    if (messageCount > 0) {
      const account = await this.db.emailAccount.update({
        where: { id: existing.id },
        data: {
          status: "disabled",
          syncEnabled: false,
          sendEnabled: false
        }
      });
      await this.writeAuditLog(context, "update", "email_account", account.id, {
        summary: `Disabled email account ${account.emailAddress}`,
        details: { reason: "account has email history", messageCount }
      });
      return;
    }

    await this.db.emailAccount.delete({ where: { id: existing.id } });
    await this.writeAuditLog(context, "delete", "email_account", existing.id, {
      summary: `Deleted email account ${existing.emailAddress}`,
      details: { provider: existing.provider }
    });
  }

  async listEmailSignatures(context: RequestContext): Promise<EmailSignature[]> {
    requirePermission(context, "crm.read");
    await this.ensureDefaultEmailSignatures(context);
    const signatures = await this.db.emailSignature.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: [{ active: "desc" }, { isDefault: "desc" }, { name: "asc" }, { createdAt: "asc" }]
    });
    return signatures.map(mapEmailSignature);
  }

  async createEmailSignature(
    context: RequestContext,
    input: Pick<EmailSignature, "name" | "bodyText"> & Partial<Pick<EmailSignature, "bodyHtml" | "isDefault" | "active">> & { accountId?: string | null }
  ): Promise<EmailSignature> {
    requirePermission(context, "crm.admin");
    const accountId = await this.normalizeEmailSignatureAccountId(context, input.accountId);
    if (input.isDefault) {
      await this.clearDefaultEmailSignatures(context.workspaceId, accountId);
    }
    const signature = await this.db.emailSignature.create({
      data: {
        workspaceId: context.workspaceId,
        accountId,
        name: normalizeRequiredText(input.name, "Email signature name"),
        bodyText: normalizeRequiredText(input.bodyText, "Email signature body"),
        bodyHtml: input.bodyHtml?.trim() || null,
        isDefault: input.isDefault ?? false,
        active: input.active ?? true,
        createdById: context.user.id
      }
    });
    await this.writeAuditLog(context, "create", "email_signature", signature.id, {
      summary: `Created email signature ${signature.name}`,
      details: { accountId: signature.accountId, isDefault: signature.isDefault, active: signature.active }
    });
    return mapEmailSignature(signature);
  }

  async updateEmailSignature(
    context: RequestContext,
    signatureId: string,
    patch: Partial<Pick<EmailSignature, "name" | "bodyText" | "bodyHtml" | "isDefault" | "active">> & { accountId?: string | null }
  ): Promise<EmailSignature> {
    requirePermission(context, "crm.admin");
    const existing = await this.assertEmailSignature(context, signatureId);
    const accountId = patch.accountId !== undefined ? await this.normalizeEmailSignatureAccountId(context, patch.accountId) : existing.accountId ?? null;
    if (patch.isDefault === true || (patch.isDefault === undefined && existing.isDefault && accountId !== (existing.accountId ?? null))) {
      await this.clearDefaultEmailSignatures(context.workspaceId, accountId, existing.id);
    }
    const signature = await this.db.emailSignature.update({
      where: { id: existing.id },
      data: {
        accountId,
        name: patch.name !== undefined ? normalizeRequiredText(patch.name, "Email signature name") : undefined,
        bodyText: patch.bodyText !== undefined ? normalizeRequiredText(patch.bodyText, "Email signature body") : undefined,
        bodyHtml: patch.bodyHtml !== undefined ? patch.bodyHtml.trim() || null : undefined,
        isDefault: patch.isDefault,
        active: patch.active
      }
    });
    await this.writeAuditLog(context, "update", "email_signature", signature.id, {
      summary: `Updated email signature ${signature.name}`,
      details: { accountId: signature.accountId, isDefault: signature.isDefault, active: signature.active }
    });
    if (signature.active === false) {
      await this.db.emailAccount.updateMany({
        where: { workspaceId: context.workspaceId, defaultSignatureId: signature.id },
        data: { defaultSignatureId: null }
      });
    }
    return mapEmailSignature(signature);
  }

  async deleteEmailSignature(context: RequestContext, signatureId: string): Promise<void> {
    requirePermission(context, "crm.admin");
    const existing = await this.assertEmailSignature(context, signatureId);
    await this.db.emailAccount.updateMany({
      where: { workspaceId: context.workspaceId, defaultSignatureId: existing.id },
      data: { defaultSignatureId: null }
    });
    await this.db.emailSignature.delete({ where: { id: existing.id } });
    await this.writeAuditLog(context, "delete", "email_signature", existing.id, {
      summary: `Deleted email signature ${existing.name}`,
      details: { accountId: existing.accountId, isDefault: existing.isDefault }
    });
  }

  async listEmailThreads(context: RequestContext, input?: string | EmailThreadListQuery): Promise<EmailThread[]> {
    requirePermission(context, "crm.read");
    const query = normalizeEmailThreadListQuery(input);
    const recordId = query.recordId;
    if (recordId) {
      await this.assertVisibleRecord(context, recordId);
    }
    const commandScope = query.command ? await this.resolveEmailThreadCommandScope(context, query.command) : undefined;
    const threads = await this.db.emailThread.findMany({
      where: {
        workspaceId: context.workspaceId,
        ...(recordId ? { recordId } : await this.emailThreadAccessWhere(context))
      },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }]
    });
    const filteredThreads = commandScope ? threads.filter((thread) => emailThreadMatchesCommandScope(mapEmailThread(thread), commandScope)) : threads;
    const states = await this.db.emailThreadState.findMany({
      where: { workspaceId: context.workspaceId, userId: context.user.id, threadId: { in: filteredThreads.map((thread) => thread.id) } }
    });
    const stateByThreadId = new Map(states.map((state) => [state.threadId, state]));
    return filteredThreads.map((thread) => mapEmailThread(thread, stateByThreadId.get(thread.id)));
  }

  async getEmailThread(context: RequestContext, threadId: string): Promise<EmailThread> {
    requirePermission(context, "crm.read");
    return this.assertEmailThread(context, threadId);
  }

  async updateEmailThreadState(
    context: RequestContext,
    threadId: string,
    input: Partial<Pick<EmailThreadState, "archived" | "deleted" | "important" | "labels" | "read" | "starred">> & {
      category?: EmailThreadState["category"] | "" | null;
      snoozedUntil?: string | null;
    }
  ): Promise<EmailThread> {
    requirePermission(context, "crm.read");
    const thread = await this.assertEmailThread(context, threadId);
    const data: Prisma.EmailThreadStateUncheckedCreateInput & Prisma.EmailThreadStateUncheckedUpdateInput = {
      workspaceId: context.workspaceId,
      threadId: thread.id,
      userId: context.user.id
    };
    if (typeof input.archived === "boolean") data.archived = input.archived;
    if (Object.prototype.hasOwnProperty.call(input, "category")) data.category = input.category ? normalizeEmailThreadCategory(input.category) ?? null : null;
    if (typeof input.deleted === "boolean") data.deleted = input.deleted;
    if (typeof input.important === "boolean") data.important = input.important;
    if (Array.isArray(input.labels)) data.labels = normalizeEmailThreadLabels(input.labels);
    if (typeof input.read === "boolean") data.read = input.read;
    if (Object.prototype.hasOwnProperty.call(input, "snoozedUntil")) {
      data.snoozedUntil = input.snoozedUntil ? new Date(input.snoozedUntil) : null;
    }
    if (typeof input.starred === "boolean") data.starred = input.starred;
    const state = await this.db.emailThreadState.upsert({
      where: { workspaceId_threadId_userId: { workspaceId: context.workspaceId, threadId: thread.id, userId: context.user.id } },
      create: data,
      update: data
    });
    return mapEmailThread(
      await this.db.emailThread.findUniqueOrThrow({ where: { id: thread.id } }),
      state
    );
  }

  async updateEmailThread(context: RequestContext, threadId: string, input: { recordId?: string | null }): Promise<EmailThread> {
    requirePermission(context, "crm.write");
    const thread = await this.assertEmailThread(context, threadId);
    const data: Prisma.EmailThreadUpdateInput = {};
    const previousRecordId = thread.recordId;
    if (Object.prototype.hasOwnProperty.call(input, "recordId")) {
      data.recordId = input.recordId ? (await this.assertVisibleRecord(context, input.recordId)).id : null;
    }
    const updated = await this.db.emailThread.update({
      where: { id: thread.id },
      data
    });
    await this.writeAuditLog(context, "update", "email_thread", thread.id, {
      summary: `Updated email thread link ${thread.subject}`,
      details: { threadId: thread.id, previousRecordId, recordId: updated.recordId ?? undefined }
    });
    this.emitWebhookEvent(context, "email.thread.updated", {
      threadId: updated.id,
      subject: updated.subject,
      previousRecordId,
      recordId: updated.recordId ?? undefined
    });
    const state = await this.db.emailThreadState.findUnique({
      where: { workspaceId_threadId_userId: { workspaceId: context.workspaceId, threadId: updated.id, userId: context.user.id } }
    });
    return mapEmailThread(updated, state);
  }

  async deleteEmailThread(context: RequestContext, threadId: string): Promise<void> {
    requirePermission(context, "crm.write");
    const thread = await this.assertEmailThread(context, threadId);
    const deletedMessages = await this.db.emailMessage.findMany({
      where: {
        workspaceId: context.workspaceId,
        threadId: thread.id
      },
      select: { id: true, accountId: true, externalMessageId: true }
    });
    const deletedMessageIds = new Set(deletedMessages.map((message) => message.id));
    const relatedReminders = await this.db.smartReminder.findMany({
      where: { workspaceId: context.workspaceId },
      select: { id: true, objectKey: true, recordId: true, sources: true }
    });
    const relatedReminderIds = relatedReminders
      .filter((reminder) => smartReminderReferencesDeletedEmailThread(reminder, thread.id, deletedMessageIds))
      .map((reminder) => reminder.id);
    const deletedExternalMessages = deletedMessages.filter((message) => message.externalMessageId);
    await this.db.$transaction([
      ...(deletedExternalMessages.length
        ? [
            this.db.emailDeletedMessage.createMany({
              data: deletedExternalMessages.map((message) => ({
                workspaceId: context.workspaceId,
                accountId: message.accountId,
                externalMessageId: message.externalMessageId!,
                threadId: thread.id,
                deletedById: context.user.id
              })),
              skipDuplicates: true
            })
          ]
        : []),
      ...(relatedReminderIds.length
        ? [
            this.db.smartReminder.deleteMany({
              where: { workspaceId: context.workspaceId, id: { in: relatedReminderIds } }
            })
          ]
        : []),
      this.db.emailMessage.deleteMany({ where: { workspaceId: context.workspaceId, threadId: thread.id } }),
      this.db.emailThreadState.deleteMany({ where: { workspaceId: context.workspaceId, threadId: thread.id } }),
      this.db.emailThread.delete({ where: { id: thread.id } })
    ]);
    await this.writeAuditLog(context, "delete", "email_thread", thread.id, {
      summary: `Deleted email thread ${thread.subject}`,
      details: { threadId: thread.id, subject: thread.subject }
    });
    this.emitWebhookEvent(context, "email.thread.deleted", {
      threadId: thread.id,
      subject: thread.subject,
      recordId: thread.recordId ?? undefined
    });
  }

  async listEmailMessages(context: RequestContext, threadId: string): Promise<EmailMessage[]> {
    requirePermission(context, "crm.read");
    await this.assertEmailThread(context, threadId);
    const messages = await this.db.emailMessage.findMany({
      where: { workspaceId: context.workspaceId, threadId },
      orderBy: { createdAt: "asc" }
    });
    return messages.map(mapEmailMessage);
  }

  async updateEmailThreadSummary(context: RequestContext, threadId: string, summary: string): Promise<EmailThread> {
    requirePermission(context, "crm.write");
    const thread = await this.assertEmailThread(context, threadId);
    const updated = await this.db.emailThread.update({
      where: { id: thread.id },
      data: {
        summary: normalizeRequiredText(summary, "Email thread summary"),
        summaryUpdatedAt: new Date()
      }
    });
    await this.writeAuditLog(context, "update", "email_thread", thread.id, {
      summary: `Updated email thread summary ${thread.subject}`,
      details: { threadId: thread.id, summaryLength: updated.summary?.length ?? 0 }
    });
    const state = await this.db.emailThreadState.findUnique({
      where: { workspaceId_threadId_userId: { workspaceId: context.workspaceId, threadId: updated.id, userId: context.user.id } }
    });
    return mapEmailThread(updated, state);
  }

  async updateEmailThreadAnalysis(context: RequestContext, threadId: string, analysis: string, sources: EmailThread["aiAnalysisSources"] = []): Promise<EmailThread> {
    requirePermission(context, "crm.write");
    const thread = await this.assertEmailThread(context, threadId);
    const aiAnalysisSources = await this.assertVisibleEmailAiSources(context, sources);
    const updated = await this.db.emailThread.update({
      where: { id: thread.id },
      data: {
        aiAnalysis: normalizeRequiredText(analysis, "Email thread analysis"),
        aiAnalysisSources: aiAnalysisSources as Prisma.InputJsonValue,
        aiAnalysisUpdatedAt: new Date()
      }
    });
    await this.writeAuditLog(context, "update", "email_thread", thread.id, {
      summary: `Updated email thread analysis ${thread.subject}`,
      details: { threadId: thread.id, analysisLength: updated.aiAnalysis?.length ?? 0, sourceCount: aiAnalysisSources.length }
    });
    const state = await this.db.emailThreadState.findUnique({
      where: { workspaceId_threadId_userId: { workspaceId: context.workspaceId, threadId: updated.id, userId: context.user.id } }
    });
    return mapEmailThread(updated, state);
  }

  async recordEmailMessage(
    context: RequestContext,
    input: Pick<EmailMessage, "accountId" | "direction" | "from" | "to" | "subject" | "bodyText"> &
      Partial<Pick<EmailMessage, "threadId" | "cc" | "bcc" | "bodyHtml" | "attachments" | "translatedBodyText" | "translatedLocale" | "translatedSources" | "translatedAt" | "aiAssisted" | "aiPurpose" | "aiSourceMessageId" | "aiSources" | "aiGeneratedAt" | "externalMessageId" | "clientRequestId" | "status" | "sendAttemptedAt" | "scheduledSendAt" | "sentAt" | "receivedAt" | "trackingEnabled" | "trackingId" | "trackingEvents" | "inboundMetadata" | "groupSendMode" | "createdById">> & {
        recordId?: string;
        skipAutoLink?: boolean;
    }
  ): Promise<EmailMessage> {
    requirePermission(context, "crm.write");
    const account = await this.assertEmailAccount(context, input.accountId);
    const accountAddress = normalizeEmailAddress(account.emailAddress);
    const fromAddress = normalizeMessageFromAddress(input.direction, input.from);
    const toAddresses = normalizeMessageRecipientAddresses(input.direction, input.to, accountAddress);
    const ccAddresses = normalizeMessageRecipientAddresses(input.direction, input.cc ?? []);
    const bccAddresses = normalizeMessageRecipientAddresses(input.direction, input.bcc ?? []);
    const messageParticipants = [fromAddress, ...toAddresses, ...ccAddresses];
    const normalizedExternalMessageId = input.externalMessageId?.trim() || undefined;
    const normalizedClientRequestId = input.clientRequestId?.trim() || undefined;
    const createdById = input.createdById ?? context.user.id;
    if (normalizedExternalMessageId) {
      const existing = await this.db.emailMessage.findFirst({
        where: {
          workspaceId: context.workspaceId,
          accountId: account.id,
          externalMessageId: normalizedExternalMessageId
        }
      });
      if (existing) {
        return mapEmailMessage(existing);
      }
    }
    if (normalizedClientRequestId) {
      const existing = await this.db.emailMessage.findFirst({
        where: {
          workspaceId: context.workspaceId,
          accountId: account.id,
          direction: input.direction,
          createdById,
          clientRequestId: normalizedClientRequestId
        }
      });
      if (existing) {
        return mapEmailMessage(existing);
      }
    }
    const requestedRecord = input.recordId ? await this.assertVisibleRecord(context, input.recordId) : undefined;
    const autoLinkedRecord = requestedRecord || input.skipAutoLink
      ? undefined
      : await this.findVisibleRecordByEmailParticipants(context, account.emailAddress, messageParticipants);
    const linkedRecordId = requestedRecord?.id ?? autoLinkedRecord?.id;
    const thread = input.threadId
        ? await this.assertEmailThread(context, input.threadId)
      : (!input.skipAutoLink ? await this.findMatchingEmailThread(context, account.id, account.emailAddress, input.subject, messageParticipants, linkedRecordId) : undefined) ??
        mapEmailThread(
            await this.db.emailThread.create({
              data: {
                workspaceId: context.workspaceId,
                accountId: account.id,
                subject: normalizeRequiredText(input.subject, "Email subject"),
                participantEmails: uniqueValidEmails([fromAddress, ...toAddresses]),
                recordId: linkedRecordId
              }
            })
          );
    if (thread.accountId !== account.id) {
      throw new Error("Email thread does not belong to this account");
    }
    const linkedRecord = input.skipAutoLink ? requestedRecord : requestedRecord ?? (thread.recordId ? await this.assertVisibleRecord(context, thread.recordId) : undefined) ?? autoLinkedRecord;
    const aiSourceMessageId = input.aiSourceMessageId?.trim() || undefined;
    if (aiSourceMessageId) {
      await this.getEmailMessage(context, aiSourceMessageId);
    }
    assertEmailOutboundAiPurpose(input.direction, input.aiAssisted, input.aiPurpose, input.aiGeneratedAt);
    if (input.aiAssisted) {
      requirePermission(context, "ai.use");
    }
    const aiSources = input.aiAssisted ? await this.assertVisibleEmailAiSources(context, input.aiSources) : [];
    const settings = await this.ensureEmailAiSettings(context.workspaceId);
    if (input.aiAssisted && settings.requireSourceLinks && aiSources.length === 0) {
      throw new Error("AI assisted email requires at least one visible source");
    }

    const status = input.status ?? (input.direction === "inbound" ? "received" : "sent");
    const sentAt = input.sentAt ? new Date(input.sentAt) : status === "sent" ? new Date() : undefined;
    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : status === "received" ? new Date() : undefined;
    const scheduledSendAt = input.scheduledSendAt ? new Date(input.scheduledSendAt) : undefined;
    const trackingEnabled = input.direction === "outbound" && input.trackingEnabled === true;
    const trackingId = trackingEnabled ? input.trackingId?.trim() || createEmailTrackingId() : undefined;
    const attachments = normalizeEmailAttachments(input.attachments);
    const translatedSources = input.translatedSources ? await this.assertVisibleEmailAiSources(context, input.translatedSources) : [];
    let message: Awaited<ReturnType<typeof this.db.emailMessage.create>>;
    try {
      message = await this.db.emailMessage.create({
        data: {
          workspaceId: context.workspaceId,
          threadId: thread.id,
          accountId: account.id,
          direction: input.direction,
          status,
          fromAddress,
          toAddresses,
          ccAddresses,
          bccAddresses,
          subject: normalizeRequiredText(input.subject, "Email subject"),
          bodyText: normalizeRequiredText(input.bodyText, "Email body"),
          bodyHtml: trackingEnabled ? appendEmailTrackingHtml(input.bodyHtml?.trim() || undefined, trackingId!) : input.bodyHtml?.trim() || undefined,
          attachments: attachments ? ((attachments as unknown) as Prisma.InputJsonValue) : Prisma.JsonNull,
          translatedBodyText: input.translatedBodyText?.trim() || undefined,
          translatedLocale: input.translatedLocale?.trim() || undefined,
          translatedSources: translatedSources.length ? (translatedSources as Prisma.InputJsonValue) : Prisma.JsonNull,
          translatedAt: input.translatedAt ? new Date(input.translatedAt) : undefined,
          aiAssisted: input.aiAssisted ?? false,
          aiPurpose: input.aiPurpose,
          aiSourceMessageId,
          aiSources: aiSources.length ? (aiSources as Prisma.InputJsonValue) : Prisma.JsonNull,
          aiGeneratedAt: input.aiGeneratedAt ? new Date(input.aiGeneratedAt) : undefined,
          externalMessageId: normalizedExternalMessageId,
          clientRequestId: normalizedClientRequestId,
          failureReason: status === "failed" ? "Delivery failed" : undefined,
          sendAttemptedAt: input.sendAttemptedAt ? new Date(input.sendAttemptedAt) : status === "sending" ? new Date() : undefined,
          scheduledSendAt,
          sentAt,
          receivedAt,
          trackingEnabled,
          trackingId,
          trackingEvents: input.trackingEvents ? ((normalizeEmailTrackingEvents(input.trackingEvents) as unknown) as Prisma.InputJsonValue) : Prisma.JsonNull,
          inboundMetadata: input.inboundMetadata ? (normalizeEmailInboundMetadata(input.inboundMetadata) as Prisma.InputJsonValue) : Prisma.JsonNull,
          groupSendMode: input.groupSendMode ?? false,
          createdById
        }
      });
    } catch (error) {
      if (normalizedClientRequestId && isPrismaUniqueConstraintError(error)) {
        const existing = await this.db.emailMessage.findFirst({
          where: {
            workspaceId: context.workspaceId,
            accountId: account.id,
            direction: input.direction,
            createdById,
            clientRequestId: normalizedClientRequestId
          }
        });
        if (existing) {
          return mapEmailMessage(existing);
        }
      }
      throw error;
    }

    const mappedMessage = mapEmailMessage(message);
    const participantEmails = uniqueValidEmails([...thread.participantEmails, mappedMessage.from, ...mappedMessage.to, ...(mappedMessage.cc ?? [])]);
    const threadMessages = await this.db.emailMessage.findMany({
      where: { workspaceId: context.workspaceId, threadId: thread.id },
      orderBy: { createdAt: "asc" }
    });
    const shouldWriteLocalSummary = !settings.features.auto_summarize || !thread.summaryUpdatedAt;
    await this.db.emailThread.update({
      where: { id: thread.id },
      data: {
        participantEmails,
        recordId: linkedRecord?.id ?? thread.recordId,
        lastMessageAt: new Date(emailMessageTime(mappedMessage)),
        ...(shouldWriteLocalSummary
          ? {
              summary: summarizeEmailThread(threadMessages.map(mapEmailMessage)),
              ...(!settings.features.auto_summarize ? { summaryUpdatedAt: new Date() } : {})
            }
          : {})
      }
    });
    if (mappedMessage.direction === "inbound" && mappedMessage.status === "received" && canRunEmailClassification(context, settings) && context.role.permissions.includes("crm.read")) {
      await this.updateEmailThreadState(context, thread.id, { category: classifyEmailCategory(mappedMessage) });
    }

    if (linkedRecord) {
      await this.createActivity(context, {
        recordId: linkedRecord.id,
        type: "email",
        title: `${emailActivityVerb(mappedMessage.status, input.direction)} email: ${mappedMessage.subject}`,
        body: mappedMessage.bodyText
      });
    }
    await this.writeAuditLog(context, "create", "email_message", message.id, {
      objectKey: linkedRecord?.objectKey,
      summary: `Recorded email ${mappedMessage.subject}`,
      details: {
        direction: mappedMessage.direction,
        status: mappedMessage.status,
        threadId: mappedMessage.threadId,
        recordId: linkedRecord?.id,
        attachmentCount: mappedMessage.attachments?.length ?? 0,
        aiAssisted: mappedMessage.aiAssisted ?? false,
        aiPurpose: mappedMessage.aiPurpose,
        aiSourceMessageId: mappedMessage.aiSourceMessageId,
        aiSourceCount: mappedMessage.aiSources?.length ?? 0
      }
    });
    this.emitEmailMessageEvents(context, mappedMessage, linkedRecord?.id, { includeCreated: true });
    scheduleEmailAutomationsBestEffort(context, this, getBackgroundJobExecutor(this), mappedMessage, settings);
    return mappedMessage;
  }

  async sendEmailMessage(
    context: RequestContext,
    input: Pick<EmailMessage, "accountId" | "to" | "subject" | "bodyText"> &
      Partial<Pick<EmailMessage, "threadId" | "cc" | "bcc" | "bodyHtml" | "attachments" | "translatedBodyText" | "translatedLocale" | "translatedSources" | "translatedAt" | "aiAssisted" | "aiPurpose" | "aiSourceMessageId" | "aiSources" | "aiGeneratedAt" | "externalMessageId" | "clientRequestId" | "trackingEnabled" | "trackingId" | "groupSendMode">> & { recordId?: string; skipAutoLink?: boolean }
  ): Promise<EmailMessage> {
    requirePermission(context, "crm.write");
    const account = await this.assertEmailAccount(context, input.accountId);
    if (!account.sendEnabled || account.status === "disabled") {
      throw new Error("Email account is not enabled for sending");
    }

    return this.recordEmailMessage(context, {
      ...input,
      direction: "outbound",
      from: account.emailAddress,
      status: "sent",
      sentAt: new Date().toISOString()
    });
  }

  async queueEmailMessage(
    context: RequestContext,
    input: Pick<EmailMessage, "accountId" | "to" | "subject" | "bodyText"> &
      Partial<Pick<EmailMessage, "threadId" | "cc" | "bcc" | "bodyHtml" | "attachments" | "translatedBodyText" | "translatedLocale" | "translatedSources" | "translatedAt" | "aiAssisted" | "aiPurpose" | "aiSourceMessageId" | "aiSources" | "aiGeneratedAt" | "clientRequestId" | "scheduledSendAt" | "trackingEnabled" | "groupSendMode">> & { recordId?: string; skipAutoLink?: boolean }
  ): Promise<EmailMessage> {
    requirePermission(context, "crm.write");
    const account = await this.assertEmailAccount(context, input.accountId);
    if (!account.sendEnabled || account.status === "disabled") {
      throw new Error("Email account is not enabled for sending");
    }

    return this.recordEmailMessage(context, {
      ...input,
      direction: "outbound",
      from: account.emailAddress,
      status: "queued"
    });
  }

  async getEmailMessage(context: RequestContext, messageId: string): Promise<EmailMessage> {
    requirePermission(context, "crm.read");
    const message = await this.db.emailMessage.findFirst({
      where: { id: messageId, workspaceId: context.workspaceId }
    });
    if (!message) {
      throw new Error("Email message not found");
    }
    const thread = await this.assertEmailThread(context, message.threadId);
    if (thread.accountId !== message.accountId) {
      throw new Error("Email message thread mismatch");
    }
    return mapEmailMessage(message);
  }

  async findEmailMessageByExternalId(context: RequestContext, accountId: string, externalMessageId: string): Promise<EmailMessage | undefined> {
    requirePermission(context, "crm.read");
    await this.assertEmailAccount(context, accountId);
    const normalizedExternalMessageId = externalMessageId.trim();
    if (!normalizedExternalMessageId) {
      return undefined;
    }
    const message = await this.db.emailMessage.findFirst({
      where: {
        workspaceId: context.workspaceId,
        accountId,
        externalMessageId: normalizedExternalMessageId
      }
    });
    return message ? mapEmailMessage(message) : undefined;
  }

  async isEmailExternalMessageDeleted(context: RequestContext, accountId: string, externalMessageId: string): Promise<boolean> {
    requirePermission(context, "crm.read");
    await this.assertEmailAccount(context, accountId);
    const normalizedExternalMessageId = externalMessageId.trim();
    if (!normalizedExternalMessageId) {
      return false;
    }
    const deleted = await this.db.emailDeletedMessage.findUnique({
      where: {
        workspaceId_accountId_externalMessageId: {
          workspaceId: context.workspaceId,
          accountId,
          externalMessageId: normalizedExternalMessageId
        }
      },
      select: { id: true }
    });
    return Boolean(deleted);
  }

  async listEmailSendingMessages(context: RequestContext, limit = 50): Promise<EmailMessage[]> {
    requirePermission(context, "crm.admin");
    const messages = await this.db.emailMessage.findMany({
      where: {
        workspaceId: context.workspaceId,
        direction: "outbound",
        status: "sending"
      },
      orderBy: [{ sendAttemptedAt: "asc" }, { createdAt: "asc" }],
      take: normalizeIntegerLimit(limit, 1, 100)
    });
    return messages.map(mapEmailMessage);
  }

  async listDueQueuedEmailMessagesForWorker(limit = 25): Promise<EmailMessage[]> {
    const now = new Date();
    const messages = await this.db.emailMessage.findMany({
      where: {
        direction: "outbound",
        status: "queued",
        OR: [{ scheduledSendAt: null }, { scheduledSendAt: { lte: now } }]
      },
      orderBy: [{ scheduledSendAt: "asc" }, { createdAt: "asc" }],
      take: normalizeIntegerLimit(limit, 1, 100)
    });
    return messages.map(mapEmailMessage);
  }

  async updateEmailMessageStatus(
    context: RequestContext,
    messageId: string,
    status: EmailMessage["status"],
    options: { externalMessageId?: string; failureReason?: string | null } = {}
  ): Promise<EmailMessage> {
    requirePermission(context, "crm.write");
    const existing = await this.getEmailMessage(context, messageId);
    const now = new Date();
    const updated = await this.db.emailMessage.update({
      where: { id: existing.id },
      data: {
        status,
        sentAt: status === "sent" ? now : null,
        sendAttemptedAt: status === "sending" ? now : status === "queued" ? null : undefined,
        scheduledSendAt: status === "sent" ? null : undefined,
        externalMessageId: options.externalMessageId?.trim() || undefined,
        failureReason:
          status === "failed"
            ? options.failureReason?.trim() || "Delivery failed"
            : status === "queued" || status === "sending" || status === "sent"
              ? null
              : undefined
      }
    });
    const mappedMessage = mapEmailMessage(updated);
    await this.writeAuditLog(context, "update", "email_message", existing.id, {
      summary: `Updated email status ${mappedMessage.subject}`,
      details: { status, previousStatus: existing.status, threadId: existing.threadId }
    });
    if (mappedMessage.status !== existing.status) {
      const thread = await this.db.emailThread.findUnique({ where: { id: mappedMessage.threadId }, select: { recordId: true } });
      this.emitEmailMessageEvents(context, mappedMessage, thread?.recordId ?? undefined, { includeCreated: false });
    }
    if (status === "sent" && existing.status !== "sent") {
      const settings = await this.ensureEmailAiSettings(context.workspaceId);
      scheduleEmailAutomationsBestEffort(context, this, getBackgroundJobExecutor(this), mappedMessage, settings);
    }
    return mappedMessage;
  }

  async recordEmailTrackingEvent(
    trackingId: string,
    input: { type: "open" | "click"; ip?: string; userAgent?: string; url?: string; country?: string; timezone?: string }
  ): Promise<EmailMessage | undefined> {
    const normalizedTrackingId = trackingId.trim();
    if (!normalizedTrackingId) {
      return undefined;
    }
    const existing = await this.db.emailMessage.findFirst({
      where: { trackingId: normalizedTrackingId, trackingEnabled: true }
    });
    if (!existing) {
      return undefined;
    }
    const events = normalizeEmailTrackingEvents(existing.trackingEvents) ?? [];
    const nextEvents = [...events, buildTrackingEvent(input.type, input)].slice(-200);
    const updated = await this.db.emailMessage.update({
      where: { id: existing.id },
      data: { trackingEvents: (nextEvents as unknown) as Prisma.InputJsonValue }
    });
    return mapEmailMessage(updated);
  }

  async claimEmailMessageForSending(context: RequestContext, messageId: string): Promise<{ message: EmailMessage; claimed: boolean }> {
    requirePermission(context, "crm.write");
    const existing = await this.getEmailMessage(context, messageId);
    const staleBefore = emailSendClaimStaleBefore();
    const isClaimableSending = existing.status === "sending" && isEmailSendClaimStale(existing.sendAttemptedAt, staleBefore);
    const scheduledAt = existing.scheduledSendAt ? new Date(existing.scheduledSendAt) : undefined;
    if (scheduledAt && scheduledAt.getTime() > Date.now() && existing.status === "queued") {
      return { message: existing, claimed: false };
    }
    if (existing.direction !== "outbound" || (existing.status !== "queued" && existing.status !== "failed" && !isClaimableSending)) {
      return { message: existing, claimed: false };
    }
    const now = new Date();
    const result = await this.db.emailMessage.updateMany({
      where: {
        id: existing.id,
        workspaceId: context.workspaceId,
        direction: "outbound",
        AND: [
          {
            OR: [
              { status: { in: ["queued", "failed"] } },
              {
                status: "sending",
                OR: [{ sendAttemptedAt: null }, { sendAttemptedAt: { lt: staleBefore } }]
              }
            ]
          },
          {
            OR: [{ scheduledSendAt: null }, { scheduledSendAt: { lte: now } }, { status: { not: "queued" } }]
          }
        ]
      },
      data: {
        status: "sending",
        sendAttemptedAt: now,
        sentAt: null,
        failureReason: null
      }
    });
    const claimed = await this.getEmailMessage(context, messageId);
    if (result.count > 0) {
      await this.writeAuditLog(context, "update", "email_message", existing.id, {
        summary: `Claimed email send ${claimed.subject}`,
        details: { status: claimed.status, previousStatus: existing.status, threadId: claimed.threadId }
      });
    }
    return { message: claimed, claimed: result.count > 0 };
  }

  async updateEmailMessageTranslation(context: RequestContext, messageId: string, text: string, locale: string, sources: EmailMessage["translatedSources"] = []): Promise<EmailMessage> {
    requirePermission(context, "crm.write");
    const existing = await this.getEmailMessage(context, messageId);
    const translatedSources = await this.assertVisibleEmailAiSources(context, sources);
    const updated = await this.db.emailMessage.update({
      where: { id: existing.id },
      data: {
        translatedBodyText: normalizeRequiredText(text, "Email translation"),
        translatedLocale: normalizeRequiredText(locale, "Translation locale"),
        translatedSources: translatedSources as Prisma.InputJsonValue,
        translatedAt: new Date()
      }
    });
    const mappedMessage = mapEmailMessage(updated);
    await this.writeAuditLog(context, "update", "email_message", existing.id, {
      summary: `Translated email ${mappedMessage.subject}`,
      details: { threadId: existing.threadId, locale: mappedMessage.translatedLocale, sourceCount: translatedSources.length }
    });
    return mappedMessage;
  }

  async syncEmailAccount(context: RequestContext, accountId: string): Promise<{ account: EmailAccount; importedCount: number; status: string }> {
    const account = await this.markEmailAccountSyncCompleted(context, accountId, {
      importedCount: 0,
      scannedCount: 0,
      skippedDuplicateCount: 0
    });
    return { account, importedCount: 0, status: "synced" };
  }

  async markEmailAccountSyncQueued(context: RequestContext, accountId: string): Promise<EmailAccount> {
    requirePermission(context, "crm.admin");
    const account = await this.assertEmailAccount(context, accountId);
    if (!account.syncEnabled || (account.status !== "active" && account.status !== "error")) {
      throw new Error("Email account is not enabled for sync");
    }
    const updated = await this.db.emailAccount.update({
      where: { id: account.id },
      data: {
        lastSyncStatus: "queued",
        lastSyncStartedAt: null,
        lastSyncFinishedAt: null,
        lastSyncScannedCount: 0,
        lastSyncImportedCount: 0,
        lastSyncSkippedDuplicateCount: 0,
        lastSyncError: null
      }
    });
    return mapEmailAccount(updated);
  }

  async markEmailAccountSyncRunning(context: RequestContext, accountId: string): Promise<EmailAccount> {
    requirePermission(context, "crm.admin");
    const account = await this.assertEmailAccount(context, accountId);
    if (!account.syncEnabled || (account.status !== "active" && account.status !== "error")) {
      throw new Error("Email account is not enabled for sync");
    }
    const updated = await this.db.emailAccount.update({
      where: { id: account.id },
      data: {
        lastSyncStatus: "running",
        lastSyncStartedAt: new Date(),
        lastSyncFinishedAt: null,
        lastSyncScannedCount: 0,
        lastSyncImportedCount: 0,
        lastSyncSkippedDuplicateCount: 0,
        lastSyncError: null
      }
    });
    return mapEmailAccount(updated);
  }

  async markEmailAccountSyncCompleted(
    context: RequestContext,
    accountId: string,
    result: { importedCount: number; scannedCount?: number; skippedDuplicateCount?: number; imapUidValidity?: string; imapLastSeenUid?: string; syncMode?: "incremental" | "full" }
  ): Promise<EmailAccount> {
    requirePermission(context, "crm.admin");
    const account = await this.assertEmailAccount(context, accountId);
    if (!account.syncEnabled || (account.status !== "active" && account.status !== "error")) {
      throw new Error("Email account is not enabled for sync");
    }
    const updated = await this.db.emailAccount.update({
      where: { id: account.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncStatus: "synced",
        lastSyncFinishedAt: new Date(),
        lastSyncScannedCount: result.scannedCount ?? result.importedCount,
        lastSyncImportedCount: result.importedCount,
        lastSyncSkippedDuplicateCount: result.skippedDuplicateCount ?? 0,
        lastSyncError: null,
        ...(result.imapUidValidity !== undefined ? { imapUidValidity: result.imapUidValidity } : {}),
        ...(result.imapLastSeenUid !== undefined ? { imapLastSeenUid: result.imapLastSeenUid } : {})
      }
    });
    await this.writeAuditLog(context, "update", "email_account", account.id, {
      summary: `${result.syncMode === "full" ? "Full resynced" : "Synced"} email account ${account.emailAddress}`,
      details: {
        provider: account.provider,
        syncMode: result.syncMode ?? "incremental",
        scannedCount: result.scannedCount ?? result.importedCount,
        importedCount: result.importedCount,
        skippedDuplicateCount: result.skippedDuplicateCount ?? 0
      }
    });
    return mapEmailAccount(updated);
  }

  async markEmailAccountSyncFailed(context: RequestContext, accountId: string, errorMessage: string): Promise<EmailAccount> {
    requirePermission(context, "crm.admin");
    const account = await this.assertEmailAccount(context, accountId);
    const normalizedError = errorMessage.trim() || "Mailbox sync failed";
    const updated = await this.db.emailAccount.update({
      where: { id: account.id },
      data: {
        lastSyncStatus: "failed",
        lastSyncFinishedAt: new Date(),
        lastSyncError: normalizedError
      }
    });
    await this.writeAuditLog(context, "update", "email_account", account.id, {
      summary: `Email account sync failed ${account.emailAddress}`,
      details: { provider: account.provider, error: normalizedError }
    });
    return mapEmailAccount(updated);
  }

  async getEmailAccountConnectionConfig(context: RequestContext, accountId: string): Promise<EmailConnectionConfig | undefined> {
    requirePermission(context, "crm.write");
    const account = await this.db.emailAccount.findFirst({
      where: { id: accountId, workspaceId: context.workspaceId },
      select: { encryptedConnectionConfig: true }
    });
    if (!account) {
      throw new Error("Email account not found");
    }
    return account.encryptedConnectionConfig ? decryptEmailConnectionConfig(account.encryptedConnectionConfig) : undefined;
  }

  async updateEmailAccountConnectionConfig(context: RequestContext, accountId: string, config: EmailConnectionConfig): Promise<EmailAccount> {
    requirePermission(context, "crm.write");
    const existing = await this.assertEmailAccount(context, accountId);
    const existingConfig = await this.getEmailAccountConnectionConfig(context, existing.id);
    const account = await this.db.emailAccount.update({
      where: { id: accountId },
      data: {
        encryptedConnectionConfig: encryptEmailConnectionConfig(config),
        lastConnectionError: null,
        status: "active",
        ...(shouldResetImapSyncCursor(existing.provider, existingConfig, config) ? { imapUidValidity: null, imapLastSeenUid: null } : {})
      }
    });
    if (existing.status !== "active" || existing.lastConnectionError) {
      await this.writeAuditLog(context, "update", "email_account", account.id, {
        summary: `Email account connection restored ${account.emailAddress}`,
        details: {
          previousStatus: existing.status,
          previousError: existing.lastConnectionError ?? null,
          provider: account.provider
        }
      });
    }
    return mapEmailAccount(account);
  }

  async markEmailAccountConnectionError(context: RequestContext, accountId: string, errorMessage: string | null): Promise<EmailAccount> {
    requirePermission(context, "crm.write");
    const existing = await this.assertEmailAccount(context, accountId);
    const normalizedError = errorMessage?.trim() || null;
    const nextStatus = normalizedError ? "error" : "active";
    const account = await this.db.emailAccount.update({
      where: { id: accountId },
      data: {
        status: nextStatus,
        lastConnectionError: normalizedError
      }
    });
    if (existing.status !== nextStatus || (existing.lastConnectionError ?? null) !== normalizedError) {
      await this.writeAuditLog(context, "update", "email_account", account.id, {
        summary: normalizedError
          ? `Email account connection failed ${account.emailAddress}`
          : `Email account connection restored ${account.emailAddress}`,
        details: {
          previousStatus: existing.status,
          status: nextStatus,
          previousError: existing.lastConnectionError ?? null,
          error: normalizedError,
          provider: account.provider
        }
      });
    }
    return mapEmailAccount(account);
  }

  async listKnowledgeArticles(context: RequestContext, activeOnly = true): Promise<KnowledgeArticle[]> {
    requirePermission(context, "crm.read");
    const articles = await this.db.knowledgeArticle.findMany({
      where: { workspaceId: context.workspaceId, ...(activeOnly ? { active: true } : {}) },
      include: {
        embeddingChunks: {
          select: { status: true, errorMessage: true, embeddingModel: true, dimensions: true, indexedAt: true, updatedAt: true },
          orderBy: { chunkIndex: "asc" }
        }
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });
    return articles.map(mapKnowledgeArticle);
  }

  async getKnowledgeArticle(context: RequestContext, articleId: string): Promise<KnowledgeArticle> {
    requirePermission(context, "crm.read");
    const article = await this.db.knowledgeArticle.findFirst({
      where: { id: articleId, workspaceId: context.workspaceId },
      include: {
        embeddingChunks: {
          select: { status: true, errorMessage: true, embeddingModel: true, dimensions: true, indexedAt: true, updatedAt: true },
          orderBy: { chunkIndex: "asc" }
        }
      }
    });
    if (!article) {
      throw new Error("Knowledge article not found");
    }
    return mapKnowledgeArticle(article);
  }

  async createKnowledgeArticle(
    context: RequestContext,
    input: Pick<KnowledgeArticle, "title" | "body"> & Partial<Pick<KnowledgeArticle, "tags" | "active">>
  ): Promise<KnowledgeArticle> {
    requirePermission(context, "crm.admin");
    const article = await this.db.knowledgeArticle.create({
      data: {
        workspaceId: context.workspaceId,
        title: normalizeRequiredText(input.title, "Knowledge title"),
        body: normalizeRequiredText(input.body, "Knowledge body"),
        tags: uniqueTags(input.tags ?? []),
        active: input.active ?? true,
        createdById: context.user.id
      }
    });
    await this.writeAuditLog(context, "create", "knowledge_article", article.id, {
      summary: `Created knowledge article ${article.title}`,
      details: { tags: article.tags, active: article.active }
    });
    return this.getKnowledgeArticle(context, article.id);
  }

  async updateKnowledgeArticle(
    context: RequestContext,
    articleId: string,
    input: Partial<Pick<KnowledgeArticle, "title" | "body" | "tags" | "active">>
  ): Promise<KnowledgeArticle> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.knowledgeArticle.findFirst({
      where: { id: articleId, workspaceId: context.workspaceId }
    });
    if (!existing) {
      throw new Error("Knowledge article not found");
    }
    const contentChanged = input.title !== undefined || input.body !== undefined || input.tags !== undefined || input.active !== undefined;
    const article = await this.db.knowledgeArticle.update({
      where: { id: existing.id },
      data: {
        title: input.title !== undefined ? normalizeRequiredText(input.title, "Knowledge title") : undefined,
        body: input.body !== undefined ? normalizeRequiredText(input.body, "Knowledge body") : undefined,
        tags: input.tags !== undefined ? uniqueTags(input.tags) : undefined,
        active: input.active
      }
    });
    if (contentChanged) {
      await this.db.knowledgeEmbeddingChunk.updateMany({
        where: { workspaceId: context.workspaceId, articleId: article.id },
        data: { status: "stale", errorMessage: null }
      });
    }
    await this.writeAuditLog(context, "update", "knowledge_article", article.id, {
      summary: `Updated knowledge article ${article.title}`,
      details: { tags: article.tags, active: article.active }
    });
    return this.getKnowledgeArticle(context, article.id);
  }

  async deleteKnowledgeArticle(context: RequestContext, articleId: string): Promise<void> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.knowledgeArticle.findFirst({
      where: { id: articleId, workspaceId: context.workspaceId }
    });
    if (!existing) {
      throw new Error("Knowledge article not found");
    }
    await this.db.$transaction([
      this.db.knowledgeEmbeddingChunk.deleteMany({ where: { workspaceId: context.workspaceId, articleId: existing.id } }),
      this.db.knowledgeArticle.delete({ where: { id: existing.id } })
    ]);
    await this.writeAuditLog(context, "delete", "knowledge_article", existing.id, {
      summary: `Deleted knowledge article ${existing.title}`,
      details: { tags: existing.tags, active: existing.active }
    });
  }

  async getKnowledgeVectorSettings(context: RequestContext): Promise<KnowledgeVectorSettings> {
    requirePermission(context, "crm.read");
    return this.ensureKnowledgeVectorSettings(context.workspaceId);
  }

  async updateKnowledgeVectorSettings(context: RequestContext, patch: Partial<Omit<KnowledgeVectorSettings, "workspaceId" | "updatedAt">>): Promise<KnowledgeVectorSettings> {
    requirePermission(context, "crm.admin");
    const current = await this.ensureKnowledgeVectorSettings(context.workspaceId);
    const normalized = normalizeKnowledgeVectorSettings(context.workspaceId, { ...current, ...patch });
    const updated = await this.db.knowledgeVectorSettings.update({
      where: { workspaceId: context.workspaceId },
      data: {
        enabled: normalized.enabled,
        providerProfileKey: normalized.providerProfileKey,
        embeddingModel: normalized.embeddingModel,
        dimensions: normalized.dimensions,
        chunkSizeChars: normalized.chunkSizeChars,
        chunkOverlapChars: normalized.chunkOverlapChars,
        topK: normalized.topK,
        similarityThreshold: normalized.similarityThreshold
      }
    });
    await this.writeAuditLog(context, "update", "knowledge_vector_settings", context.workspaceId, {
      summary: "Updated knowledge vector settings",
      details: {
        enabled: updated.enabled,
        providerProfileKey: updated.providerProfileKey,
        embeddingModel: updated.embeddingModel,
        dimensions: updated.dimensions,
        topK: updated.topK
      }
    });
    return mapKnowledgeVectorSettings(updated);
  }

  async vectorizeKnowledgeArticle(context: RequestContext, articleId: string): Promise<KnowledgeArticle> {
    requirePermission(context, "crm.admin");
    const settings = await this.ensureKnowledgeVectorSettings(context.workspaceId);
    const article = await this.db.knowledgeArticle.findFirst({
      where: { id: articleId, workspaceId: context.workspaceId }
    });
    if (!article) {
      throw new Error("Knowledge article not found");
    }
    await this.db.knowledgeEmbeddingChunk.deleteMany({ where: { workspaceId: context.workspaceId, articleId: article.id } });
    if (!article.active) {
      return this.getKnowledgeArticle(context, article.id);
    }

    const chunks = chunkKnowledgeArticle(mapKnowledgeArticle(article), settings);
    if (chunks.length === 0) {
      return this.getKnowledgeArticle(context, article.id);
    }

    try {
      const providerConfig = await this.resolveKnowledgeEmbeddingProviderConfig(context.workspaceId, settings);
      for (const [chunkIndex, chunkText] of chunks.entries()) {
        const embedding = await createEmbedding({
          config: providerConfig,
          text: chunkText,
          model: settings.embeddingModel,
          dimensions: settings.dimensions
        });
        await this.db.$executeRaw`
          INSERT INTO "KnowledgeEmbeddingChunk" (
            "id", "workspaceId", "articleId", "chunkIndex", "chunkText", "embedding", "embeddingModel", "dimensions", "status", "indexedAt", "createdAt", "updatedAt"
          )
          VALUES (
            ${randomUUID()}, ${context.workspaceId}, ${article.id}, ${chunkIndex}, ${chunkText}, ${toPgVectorLiteral(embedding)}::vector, ${settings.embeddingModel}, ${embedding.length}, 'indexed', now(), now(), now()
          )
        `;
      }
      await this.writeAuditLog(context, "update", "knowledge_vector_index", article.id, {
        summary: `Vectorized knowledge article ${article.title}`,
        details: { chunkCount: chunks.length, embeddingModel: settings.embeddingModel, dimensions: settings.dimensions }
      });
    } catch (error) {
      const message = normalizeVectorError(error);
      await this.db.knowledgeEmbeddingChunk.create({
        data: {
          workspaceId: context.workspaceId,
          articleId: article.id,
          chunkIndex: 0,
          chunkText: chunks[0]?.slice(0, settings.chunkSizeChars) ?? article.title,
          embeddingModel: settings.embeddingModel,
          dimensions: settings.dimensions,
          status: "failed",
          errorMessage: message,
          indexedAt: new Date()
        }
      });
      await this.writeAuditLog(context, "update", "knowledge_vector_index", article.id, {
        summary: `Knowledge vectorization failed for ${article.title}`,
        details: { error: message }
      });
    }
    return this.getKnowledgeArticle(context, article.id);
  }

  async vectorizeKnowledgeArticles(context: RequestContext): Promise<{ articles: KnowledgeArticle[]; indexed: number; failed: number }> {
    requirePermission(context, "crm.admin");
    const articles = await this.db.knowledgeArticle.findMany({
      where: { workspaceId: context.workspaceId, active: true },
      select: { id: true }
    });
    const updated: KnowledgeArticle[] = [];
    for (const article of articles) {
      updated.push(await this.vectorizeKnowledgeArticle(context, article.id));
    }
    return {
      articles: updated,
      indexed: updated.filter((article) => article.vectorStatus?.state === "indexed").length,
      failed: updated.filter((article) => article.vectorStatus?.state === "failed").length
    };
  }

  async listRelevantKnowledgeArticles(context: RequestContext, queryText: string, limit = 5): Promise<KnowledgeArticle[]> {
    requirePermission(context, "crm.read");
    const normalizedLimit = normalizeIntegerLimit(limit, 1, 20);
    const vectorMatches = await this.searchKnowledgeArticlesByVector(context, queryText, normalizedLimit);
    if (vectorMatches.length > 0) {
      return vectorMatches;
    }
    const articles = await this.listKnowledgeArticles(context, true);
    return articles
      .map((article, index) => ({ article, index, score: scoreKnowledgeArticle(article, queryText) }))
      .sort((left, right) => right.score - left.score || right.article.updatedAt.localeCompare(left.article.updatedAt) || left.index - right.index)
      .slice(0, normalizedLimit)
      .map((item) => item.article);
  }

  async listTalkMessages(context: RequestContext, target: TalkMessageTargetInput): Promise<TalkMessage[]> {
    requirePermission(context, "ai.use");
    await this.assertTalkTargetAccess(context, target);
    const messages = await this.db.talkMessage.findMany({
      where: { workspaceId: context.workspaceId, ...talkMessageTargetWhere(target) },
      orderBy: { createdAt: "asc" },
      take: 200
    });
    return messages.map(mapTalkMessage);
  }

  async createTalkMessage(
    context: RequestContext,
    input: TalkMessageTargetInput & Pick<TalkMessage, "role" | "content"> & Partial<Pick<TalkMessage, "sources" | "knowledgeArticleId">>
  ): Promise<TalkMessage> {
    requirePermission(context, "ai.use");
    await this.assertTalkTargetAccess(context, input);
    if (input.knowledgeArticleId) {
      await this.getKnowledgeArticle(context, input.knowledgeArticleId);
    }
    const message = await this.db.talkMessage.create({
      data: {
        workspaceId: context.workspaceId,
        targetType: input.type,
        objectKey: input.type === "record" ? input.objectKey : null,
        recordId: input.type === "record" ? input.recordId : null,
        threadId: input.type === "email_thread" ? input.threadId : null,
        role: input.role === "assistant" ? "assistant" : "user",
        content: normalizeRequiredText(input.content, "Talk message"),
        sources: normalizeTalkSources(input.sources) ?? Prisma.JsonNull,
        knowledgeArticleId: input.knowledgeArticleId ?? null,
        createdById: context.user.id
      }
    });
    return mapTalkMessage(message);
  }

  async markTalkMessageKnowledgeArticle(context: RequestContext, messageId: string, knowledgeArticleId: string): Promise<TalkMessage> {
    requirePermission(context, "ai.use");
    await this.getKnowledgeArticle(context, knowledgeArticleId);
    const existing = await this.db.talkMessage.findFirst({ where: { id: messageId, workspaceId: context.workspaceId } });
    if (!existing) {
      throw new Error("Talk message not found");
    }
    const message = await this.db.talkMessage.update({
      where: { id: existing.id },
      data: { knowledgeArticleId }
    });
    await this.writeAuditLog(context, "update", "talk_message", message.id, {
      summary: "Marked talk message as RAG knowledge",
      details: { knowledgeArticleId }
    });
    return mapTalkMessage(message);
  }

  async deleteTalkMessage(context: RequestContext, messageId: string): Promise<void> {
    requirePermission(context, "ai.use");
    const existing = await this.db.talkMessage.findFirst({ where: { id: messageId, workspaceId: context.workspaceId } });
    if (!existing) {
      throw new Error("Talk message not found");
    }
    await this.db.talkMessage.delete({ where: { id: existing.id } });
    await this.writeAuditLog(context, "delete", "talk_message", existing.id, {
      summary: "Deleted talk message",
      details: { role: existing.role, targetType: existing.targetType }
    });
  }

  async listMediaAssets(context: RequestContext): Promise<MediaAsset[]> {
    requirePermission(context, "crm.read");
    const assets = await this.db.mediaAsset.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: [{ createdAt: "desc" }, { name: "asc" }],
      take: 200
    });
    return assets.map(mapMediaAsset);
  }

  async getMediaAsset(context: RequestContext, assetId: string): Promise<MediaAsset | undefined> {
    requirePermission(context, "crm.read");
    const asset = await this.db.mediaAsset.findFirst({
      where: { id: assetId, workspaceId: context.workspaceId }
    });
    return asset ? mapMediaAsset(asset) : undefined;
  }

  async createMediaAsset(
    context: RequestContext,
    input: Pick<MediaAsset, "name" | "contentType" | "size" | "contentBase64">
  ): Promise<MediaAsset> {
    requirePermission(context, "crm.write");
    const asset = await this.db.mediaAsset.create({
      data: {
        workspaceId: context.workspaceId,
        name: normalizeRequiredText(input.name, "Media name"),
        contentType: input.contentType,
        size: input.size,
        contentBase64: input.contentBase64,
        createdById: context.user.id
      }
    });
    await this.writeAuditLog(context, "create", "media_asset", asset.id, {
      summary: `Created media asset ${asset.name}`,
      details: { contentType: asset.contentType, size: asset.size }
    });
    return mapMediaAsset(asset);
  }

  async createCurrentUserAvatarMediaAsset(
    context: RequestContext,
    input: Pick<MediaAsset, "name" | "contentType" | "size" | "contentBase64">
  ): Promise<MediaAsset> {
    if (!input.contentType.toLowerCase().startsWith("image/")) {
      throw new ApiError(400, "VALIDATION_ERROR", "Avatar must be an image");
    }
    const asset = await this.db.mediaAsset.create({
      data: {
        workspaceId: context.workspaceId,
        name: normalizeRequiredText(input.name, "Avatar name"),
        contentType: input.contentType,
        size: input.size,
        contentBase64: input.contentBase64,
        createdById: context.user.id
      }
    });
    await this.writeAuditLog(context, "create", "media_asset", asset.id, {
      summary: `Uploaded avatar asset ${asset.name}`,
      details: { contentType: asset.contentType, size: asset.size, purpose: "user_avatar" }
    });
    return mapMediaAsset(asset);
  }

  async updateMediaAsset(
    context: RequestContext,
    assetId: string,
    patch: Partial<Pick<MediaAsset, "name" | "contentType" | "size" | "contentBase64">>
  ): Promise<MediaAsset> {
    requirePermission(context, "crm.write");
    const existing = await this.db.mediaAsset.findFirst({
      where: { id: assetId, workspaceId: context.workspaceId }
    });
    if (!existing) {
      throw new Error("Media asset not found");
    }
    const asset = await this.db.mediaAsset.update({
      where: { id: assetId },
      data: {
        name: patch.name !== undefined ? normalizeRequiredText(patch.name, "Media name") : undefined,
        contentType: patch.contentType,
        size: patch.size,
        contentBase64: patch.contentBase64
      }
    });
    await this.writeAuditLog(context, "update", "media_asset", asset.id, {
      summary: `Updated media asset ${asset.name}`,
      details: { contentType: asset.contentType, size: asset.size }
    });
    return mapMediaAsset(asset);
  }

  async deleteMediaAsset(context: RequestContext, assetId: string): Promise<void> {
    requirePermission(context, "crm.write");
    const existing = await this.db.mediaAsset.findFirst({
      where: { id: assetId, workspaceId: context.workspaceId }
    });
    if (!existing) {
      throw new Error("Media asset not found");
    }
    await this.db.mediaAsset.delete({ where: { id: assetId } });
    await this.writeAuditLog(context, "delete", "media_asset", existing.id, {
      summary: `Deleted media asset ${existing.name}`,
      details: { contentType: existing.contentType, size: existing.size }
    });
  }

  async getEmailAiSettings(context: RequestContext): Promise<EmailAiSettings> {
    requirePermission(context, "crm.read");
    return this.ensureEmailAiSettings(context.workspaceId);
  }

  async getAiProviderConfigForAgent(context: RequestContext, agent: AiAgentSetting): Promise<AiProviderConfig> {
    requirePermission(context, "ai.use");
    const providerConfig = await this.getEmailAiProviderConfigForWorkspace(context.workspaceId);
    const profiles = await this.getEmailAiProviderProfilesForWorkspace(context.workspaceId);
    return resolveAiProviderConfigForAgent(providerConfig, profiles, agent);
  }

  async listAiAgents(context: RequestContext): Promise<AiAgentSetting[]> {
    requirePermission(context, "ai.admin");
    const settings = await this.ensureEmailAiSettings(context.workspaceId);
    return normalizeGlobalAiAgentSettings(settings.agents);
  }

  async updateAiAgent(context: RequestContext, agentKey: string, patch: Partial<AiAgentSetting>): Promise<AiAgentSetting> {
    requirePermission(context, "ai.admin");
    const settings = await this.ensureEmailAiSettings(context.workspaceId);
    const agents = normalizeGlobalAiAgentSettings(settings.agents);
    const current = agents.find((agent) => agent.key === agentKey) ?? getGlobalAiAgentSetting({ agents }, agentKey);
    if (!current) {
      throw new Error("AI agent is not available");
    }
    const updatedAgent = normalizeGlobalAiAgentSetting({ ...current, ...patch, key: agentKey }, current);
    const nextAgents = agents.map((agent) => (agent.key === agentKey ? updatedAgent : agent));
    await this.db.emailAiSettings.update({
      where: { workspaceId: context.workspaceId },
      data: { agents: nextAgents as unknown as Prisma.InputJsonValue }
    });
    await this.writeAuditLog(context, "update", "ai_agent", agentKey, {
      summary: `Updated AI agent ${updatedAgent.name}`,
      details: { agentKey, enabled: updatedAgent.enabled, model: updatedAgent.model, outputSchema: updatedAgent.outputSchema }
    });
    return updatedAgent;
  }

  async testAiAgent(
    context: RequestContext,
    agentKey: string,
    input: { task: string; userPrompt?: string; objectKey?: string; recordId?: string; threadId?: string; dryRun?: boolean }
  ): Promise<AiAgentRunResult> {
    requirePermission(context, "ai.admin");
    const settings = await this.ensureEmailAiSettings(context.workspaceId);
    const agent = getGlobalAiAgentSetting(settings, agentKey);
    if (!agent) {
      throw new Error("AI agent is not available");
    }
    const providerConfig = await this.getEmailAiProviderConfigForWorkspace(context.workspaceId);
    const harnessContext = await this.buildAiAgentHarnessContext(context, input);
    const result = await runAiAgent(
      {
        agentKey,
        task: input.task,
        userPrompt: input.userPrompt,
        context: harnessContext.context,
        expectedOutput: agent.outputSchema,
        dryRun: input.dryRun
      },
      { agent, providerConfig, providerProfiles: settings.providerProfiles, sources: harnessContext.sources }
    );
    await this.writeAuditLog(context, "create", "ai_agent_run", agentKey, {
      summary: `Ran AI agent ${agent.name}`,
      details: {
        agentKey,
        agentName: agent.name,
        generationMode: result.generationMode,
        provider: result.provider,
        model: result.model,
        promptChars: result.budget.promptChars,
        outputChars: result.budget.outputChars,
        error: result.error
      }
    });
    return result;
  }

  async listAiAgentRuns(context: RequestContext, agentKey: string): Promise<AiAgentRunLog[]> {
    requirePermission(context, "ai.admin");
    const logs = await this.db.auditLog.findMany({
      where: { workspaceId: context.workspaceId, entityType: "ai_agent_run", entityId: agentKey },
      orderBy: { createdAt: "desc" },
      take: 50
    });
    return logs.map((log) => {
      const details = asRecord(log.details ?? {});
      return {
        id: log.id,
        agentKey: String(details.agentKey ?? agentKey),
        agentName: typeof details.agentName === "string" ? details.agentName : undefined,
        generationMode: typeof details.generationMode === "string" ? details.generationMode as AiAgentRunLog["generationMode"] : undefined,
        provider: typeof details.provider === "string" ? details.provider as AiAgentRunLog["provider"] : undefined,
        model: typeof details.model === "string" ? details.model : undefined,
        promptChars: typeof details.promptChars === "number" ? details.promptChars : undefined,
        outputChars: typeof details.outputChars === "number" ? details.outputChars : undefined,
        error: typeof details.error === "string" ? details.error : undefined,
        createdAt: log.createdAt.toISOString(),
        createdById: log.actorId ?? undefined
      };
    });
  }

  async updateEmailAiSettings(
    context: RequestContext,
    patch: Partial<Omit<EmailAiSettings, "workspaceId" | "updatedAt" | "features" | "agents" | "providerConfig">> & {
      features?: Partial<EmailAiSettings["features"]>;
      agents?: unknown;
      providerConfig?: Partial<AiProviderConfig>;
      providerProfiles?: unknown;
    }
  ): Promise<EmailAiSettings> {
    requirePermission(context, "ai.admin");
    const current = await this.ensureEmailAiSettings(context.workspaceId);
    const features = normalizeEmailAiFeatures({ ...current.features, ...(patch.features ?? {}) });
    const agents = patch.agents !== undefined ? normalizeGlobalAiAgentSettings(patch.agents) : normalizeGlobalAiAgentSettings(current.agents);
    const currentProviderConfig = await this.getEmailAiProviderConfigForWorkspace(context.workspaceId);
    const currentProviderProfiles = await this.getEmailAiProviderProfilesForWorkspace(context.workspaceId);
    const providerConfig = patch.providerConfig !== undefined ? mergeAiProviderConfigSecrets(currentProviderConfig, patch.providerConfig) : undefined;
    const providerProfiles = patch.providerProfiles !== undefined ? mergeAiProviderProfilesSecrets(currentProviderProfiles, patch.providerProfiles, providerConfig ?? currentProviderConfig) : undefined;
    const updated = await this.db.emailAiSettings.update({
      where: { workspaceId: context.workspaceId },
      data: {
        features: features as Prisma.InputJsonValue,
        agents: agents as unknown as Prisma.InputJsonValue,
        ...(providerConfig || providerProfiles ? { encryptedProviderConfig: encryptAiProviderSettingsBundle({ providerConfig: providerConfig ?? currentProviderConfig, providerProfiles: providerProfiles ?? currentProviderProfiles }) } : {}),
        defaultLocale: patch.defaultLocale?.trim() || current.defaultLocale,
        requireSourceLinks: patch.requireSourceLinks ?? current.requireSourceLinks,
        maxHistoryMessages: normalizeIntegerLimit(patch.maxHistoryMessages ?? current.maxHistoryMessages, 1, 20),
        maxKnowledgeArticles: normalizeIntegerLimit(patch.maxKnowledgeArticles ?? current.maxKnowledgeArticles, 0, 20),
        maxContextChars: normalizeIntegerLimit(patch.maxContextChars ?? current.maxContextChars, 1000, 20000)
      }
    });
    await this.writeAuditLog(context, "update", "email_ai_settings", context.workspaceId, {
      summary: "Updated email AI settings",
      details: { features: updated.features, defaultLocale: updated.defaultLocale, agentCount: agents.length, provider: providerConfig?.provider ?? current.providerConfig.provider }
    });
    return mapEmailAiSettings(updated);
  }

  async getEmailAiProviderConfig(context: RequestContext): Promise<AiProviderConfig> {
    requirePermission(context, "ai.use");
    return this.getEmailAiProviderConfigForWorkspace(context.workspaceId);
  }

  private async buildAiAgentHarnessContext(
    context: RequestContext,
    input: { objectKey?: string; recordId?: string; threadId?: string }
  ): Promise<{ context: Record<string, unknown>; sources: AiAgentRunResult["sources"] }> {
    const payload: Record<string, unknown> = {};
    const sources: AiAgentRunResult["sources"] = [];
    if (input.objectKey && input.recordId) {
      const record = await this.getRecord(context, input.objectKey, input.recordId);
      const fields = await this.listFieldDefinitions(context, input.objectKey);
      const activities = await this.listActivities(context, record.id);
      payload.record = {
        id: record.id,
        objectKey: record.objectKey,
        title: record.title,
        stageKey: record.stageKey,
        ownerId: record.ownerId,
        data: record.data
      };
      payload.fields = fields.map((field) => ({ key: field.key, label: field.label, type: field.type }));
      payload.activities = activities.slice(0, 12).map((activity) => ({
        id: activity.id,
        type: activity.type,
        title: activity.title,
        body: activity.body,
        dueAt: activity.dueAt,
        completedAt: activity.completedAt,
        createdAt: activity.createdAt
      }));
      sources.push({ label: record.title, objectKey: record.objectKey, recordId: record.id });
    }
    if (input.threadId) {
      const thread = await this.getEmailThread(context, input.threadId);
      const messages = await this.listEmailMessages(context, thread.id);
      payload.emailThread = {
        id: thread.id,
        subject: thread.subject,
        participantEmails: thread.participantEmails,
        summary: thread.summary,
        aiAnalysis: thread.aiAnalysis,
        lastMessageAt: thread.lastMessageAt,
        messages: messages.slice(-10).map((message) => ({
          id: message.id,
          direction: message.direction,
          status: message.status,
          from: message.from,
          to: message.to,
          subject: message.subject,
          bodyText: message.bodyText.slice(0, 2000),
          createdAt: message.createdAt
        }))
      };
      sources.push({ label: thread.subject, messageId: thread.id });
    }
    const knowledgeQuery = [
      input.objectKey,
      input.recordId,
      input.threadId,
      typeof payload.record === "object" ? JSON.stringify(payload.record).slice(0, 1200) : "",
      typeof payload.emailThread === "object" ? JSON.stringify(payload.emailThread).slice(0, 1200) : ""
    ]
      .filter(Boolean)
      .join("\n");
    const knowledgeArticles = await this.listRelevantKnowledgeArticles(context, knowledgeQuery, 5);
    payload.knowledgeArticles = knowledgeArticles.slice(0, 5).map((article) => ({
      id: article.id,
      title: article.title,
      tags: article.tags,
      body: article.body.slice(0, 1200)
    }));
    sources.push(...knowledgeArticles.slice(0, 3).map((article) => ({ label: article.title, knowledgeArticleId: article.id })));
    payload.user = { id: context.user.id, name: context.user.name, email: context.user.email };
    payload.workspaceId = context.workspaceId;
    return { context: payload, sources };
  }

  async getEmailSyncSettings(context: RequestContext): Promise<EmailSyncSettings> {
    requirePermission(context, "crm.admin");
    return this.ensureEmailSyncSettings(context.workspaceId);
  }

  async updateEmailSyncSettings(context: RequestContext, patch: Partial<Omit<EmailSyncSettings, "workspaceId" | "updatedAt">>): Promise<EmailSyncSettings> {
    requirePermission(context, "crm.admin");
    const current = await this.ensureEmailSyncSettings(context.workspaceId);
    const updated = await this.db.emailSyncSettings.update({
      where: { workspaceId: context.workspaceId },
      data: {
        enabled: patch.enabled ?? current.enabled,
        mode: patch.mode === "daily" ? "daily" : patch.mode === "interval" ? "interval" : current.mode,
        intervalMinutes: normalizeIntegerLimit(patch.intervalMinutes ?? current.intervalMinutes, 1, 1440),
        dailyAt: normalizeDailyTime(patch.dailyAt ?? current.dailyAt),
        limit: normalizeIntegerLimit(patch.limit ?? current.limit, 1, 100)
      }
    });
    await this.writeAuditLog(context, "update", "email_sync_settings", context.workspaceId, {
      summary: "Updated email sync schedule settings",
      details: { enabled: updated.enabled, mode: updated.mode, intervalMinutes: updated.intervalMinutes, dailyAt: updated.dailyAt, limit: updated.limit }
    });
    return mapEmailSyncSettings(updated);
  }

  async getPoolSettings(context: RequestContext): Promise<CrmPoolSettings> {
    requirePermission(context, "crm.read");
    return this.ensureCrmPoolSettings(context.workspaceId);
  }

  async updatePoolSettings(context: RequestContext, patch: Partial<Omit<CrmPoolSettings, "workspaceId" | "objectKeys" | "lastAutoReclaimAt" | "lastAutoReclaimCount" | "updatedAt">>): Promise<CrmPoolSettings> {
    requirePermission(context, "crm.pool.manage");
    const current = await this.ensureCrmPoolSettings(context.workspaceId);
    const updated = await this.db.crmPoolSettings.update({
      where: { workspaceId: context.workspaceId },
      data: {
        enabled: patch.enabled ?? current.enabled,
        privateLimit: normalizeIntegerLimit(patch.privateLimit ?? current.privateLimit, 1, 100000),
        autoReclaimEnabled: patch.autoReclaimEnabled ?? current.autoReclaimEnabled,
        autoReclaimDays: normalizeIntegerLimit(patch.autoReclaimDays ?? current.autoReclaimDays, 1, 3650),
        levelRules: crmPoolLevelRulesToJson(normalizeCrmPoolLevelRules(patch.levelRules ?? current.levelRules))
      }
    });
    await this.writeAuditLog(context, "update", "crm_pool_settings", context.workspaceId, {
      summary: "Updated CRM pool settings",
      details: {
        enabled: updated.enabled,
        privateLimit: updated.privateLimit,
        autoReclaimEnabled: updated.autoReclaimEnabled,
        autoReclaimDays: updated.autoReclaimDays,
        levelRules: updated.levelRules
      }
    });
    return mapCrmPoolSettings(updated);
  }

  async buildEmailAssistantContext(
    context: RequestContext,
    input: {
      purpose: EmailAssistantPurpose;
      objectKey?: string;
      recordId?: string;
      threadId?: string;
      sourceMessageId?: string;
      targetLocale?: string;
      productIds?: string[];
      productQuery?: string;
      userPrompt?: string;
      sourceText?: string;
    }
  ): Promise<EmailAssistantContext> {
    requirePermission(context, "ai.use");
    const settings = await this.ensureEmailAiSettings(context.workspaceId);
    const sourceMessage = input.sourceMessageId ? await this.getEmailMessage(context, input.sourceMessageId) : undefined;
    const thread = input.threadId
      ? await this.assertEmailThread(context, input.threadId)
      : sourceMessage
        ? await this.assertEmailThread(context, sourceMessage.threadId)
        : undefined;
    if (sourceMessage && thread && sourceMessage.threadId !== thread.id) {
      throw new Error("Source email message does not belong to this thread");
    }
    assertEmailAiRecordThreadAlignment(input.recordId, thread);
    const recordId = input.recordId ?? thread?.recordId;
    const record = recordId ? await this.assertVisibleRecord(context, recordId) : undefined;
    const fields = record ? await this.listFieldDefinitions(context, record.objectKey) : [];
    const activities = record ? await this.listActivities(context, record.id) : [];
    const messages = thread ? await this.listEmailMessages(context, thread.id) : [];
    const knowledgeQuery = [
      input.userPrompt,
      input.productQuery,
      input.sourceText,
      input.targetLocale,
      record?.title,
      record ? JSON.stringify(record.data).slice(0, 1200) : "",
      thread?.subject,
      thread?.summary,
      sourceMessage?.subject,
      sourceMessage?.bodyText,
      ...messages.flatMap((message) => [message.subject, message.bodyText.slice(0, 1200)]),
      ...activities.flatMap((activity) => [activity.title, activity.body])
    ]
      .filter(Boolean)
      .join("\n");
    const knowledgeArticles = await this.listRelevantKnowledgeArticles(
      context,
      knowledgeQuery,
      settings.maxKnowledgeArticles
    );
    const products = await this.loadEmailAssistantProducts(context, {
      productIds: input.productIds,
      productQuery: input.productQuery,
      userPrompt: input.userPrompt,
      sourceText: input.sourceText,
      record,
      thread,
      sourceMessage,
      messages
    });

    return buildEmailAssistantPromptContext({
      settings,
      purpose: input.purpose,
      record,
      fields,
      activities,
      thread,
      messages,
      sourceMessage,
      knowledgeArticles,
      knowledgeArticlesRanked: true,
      products,
      productQuery: input.productQuery,
      userPrompt: input.userPrompt,
      sourceText: input.sourceText,
      targetLocale: input.targetLocale
    });
  }

  private async loadEmailAssistantProducts(
    context: RequestContext,
    input: {
      productIds?: string[];
      productQuery?: string;
      userPrompt?: string;
      sourceText?: string;
      record?: CrmRecord;
      thread?: EmailThread;
      sourceMessage?: EmailMessage;
      messages?: EmailMessage[];
    }
  ): Promise<CrmRecord[]> {
    const productsById = new Map<string, CrmRecord>();
    for (const productId of Array.from(new Set(input.productIds ?? [])).slice(0, 10)) {
      const record = await this.assertVisibleRecord(context, productId);
      if (record.objectKey === "products" && record.data.active !== false) {
        productsById.set(record.id, record);
      }
    }

    const queryText = [
      input.productQuery,
      input.userPrompt,
      input.sourceText,
      input.thread?.subject,
      input.sourceMessage?.subject,
      input.sourceMessage?.bodyText,
      ...(input.messages ?? []).flatMap((message) => [message.subject, message.bodyText]),
      input.record?.title,
      input.record ? JSON.stringify(input.record.data).slice(0, 1200) : undefined
    ]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join("\n")
      .slice(0, 1500);

    if (queryText.trim().length >= 2) {
      const result = await this.queryRecords(context, "products", {
        q: queryText.slice(0, 500),
        pageSize: 20,
        fields: ["title", "sku", "description", "unitPrice", "unitPriceCurrency", "billingCycle", "mainImageUrl", "attachments", "active"],
        keyset: true
      });
      for (const product of result.records) {
        if (product.data.active !== false) {
          productsById.set(product.id, product);
        }
      }
    }

    return Array.from(productsById.values()).slice(0, 20);
  }

  async recordEmailAiGeneration(context: RequestContext, input: EmailAiGenerationAuditInput): Promise<void> {
    requirePermission(context, "ai.use");
    await this.writeAuditLog(context, "create", "email_ai_generation", input.threadId ?? input.sourceMessageId ?? input.recordId, {
      summary: `${input.enabled ? "Generated" : "Skipped"} email AI ${input.purpose}`,
      details: {
        purpose: input.purpose,
        enabled: input.enabled,
        recordId: input.recordId,
        threadId: input.threadId,
        sourceMessageId: input.sourceMessageId,
        sourceCount: input.sourceCount,
        sourceLabels: input.sourceLabels?.slice(0, 10),
        targetLocale: input.targetLocale,
        userPromptLength: input.userPromptLength ?? 0,
        sourceTextLength: input.sourceTextLength ?? 0,
        resultTextLength: input.resultTextLength ?? 0,
        contextCharCount: input.contextCharCount ?? 0,
        maxContextChars: input.maxContextChars ?? 0,
        modelPromptChars: input.modelPromptChars ?? 0,
        contextTruncated: input.contextTruncated ?? false,
        outputTruncated: input.outputTruncated ?? false,
        generationMode: input.generationMode,
        providerError: normalizeEmailAiProviderError(input.providerError),
        suggestedSubjectProvided: input.suggestedSubjectProvided ?? false,
        persisted: input.persisted,
        automationFailed: input.automationFailed ?? false,
        errorMessage: input.errorMessage
      }
    });
  }

  async updateUser(
    context: RequestContext,
    id: string,
    patch: Partial<Pick<User, "email" | "name" | "roleId" | "teamId" | "active">> & { password?: string }
  ): Promise<User> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.user.findUnique({ where: { id }, include: { role: true } });
    if (!existing || existing.workspaceId !== context.workspaceId) {
      throw new Error("User not found");
    }

    const data = await this.normalizeUserInput(context, {
      email: patch.email ?? existing.email,
      name: patch.name ?? existing.name,
      roleId: patch.roleId ?? existing.roleId ?? "",
      teamId: Object.prototype.hasOwnProperty.call(patch, "teamId") ? patch.teamId : existing.teamId ?? undefined
    });
    if (existing.role?.permissions.includes("crm.admin") && data.roleId !== existing.roleId) {
      const targetRole = await this.db.role.findUnique({ where: { id: data.roleId }, select: { permissions: true } });
      if (!targetRole?.permissions.includes("crm.admin")) {
        await this.assertWorkspaceKeepsAdminUserAfterUserRoleChange(context, id);
      }
    }
    if (existing.active && patch.active === false && existing.role?.permissions.includes("crm.admin")) {
      await this.assertWorkspaceKeepsAdminUserAfterUserRoleChange(context, id);
    }

    const password = patch.password?.trim();
    const active = patch.active ?? existing.active;
    const user = await this.db.user.update({
      where: { id },
      data: {
        email: data.email,
        name: data.name,
        roleId: data.roleId,
        teamId: data.teamId,
        active,
        disabledAt: active ? null : existing.disabledAt ?? new Date(),
        ...(password ? { passwordHash: hashPassword(password) } : {})
      }
    });
    if (!active) {
      await destroySessionsForUser(id);
    }

    await this.writeAuditLog(context, "update", "user", id, {
      summary: `Updated user ${user.email}`,
      details: {
        email: user.email,
        name: user.name,
        roleId: user.roleId,
        teamId: user.teamId,
        active: user.active,
        passwordChanged: Boolean(password)
      }
    });

    return mapUser(user);
  }

  async updateCurrentUserPreferences(
    context: RequestContext,
    patch: Partial<Pick<User, "emailListDisplayMode">>
  ): Promise<User> {
    const user = await this.db.user.update({
      where: {
        id: context.user.id
      },
      data: {
        ...(patch.emailListDisplayMode ? { emailListDisplayMode: patch.emailListDisplayMode } : {})
      }
    });
    return mapUser(user);
  }

  async updateCurrentUserProfile(
    context: RequestContext,
    patch: Partial<Pick<User, "name">> & { avatarMediaAssetId?: string | null }
  ): Promise<User> {
    const data: { name?: string; avatarMediaAssetId?: string | null } = {};
    if (patch.name !== undefined) {
      data.name = normalizeRequiredText(patch.name, "User name");
    }
    if (Object.prototype.hasOwnProperty.call(patch, "avatarMediaAssetId")) {
      const avatarMediaAssetId = patch.avatarMediaAssetId?.trim() || null;
      if (avatarMediaAssetId) {
        const asset = await this.db.mediaAsset.findFirst({
          where: { id: avatarMediaAssetId, workspaceId: context.workspaceId }
        });
        if (!asset) {
          throw new Error("Avatar media asset not found");
        }
        if (!asset.contentType.toLowerCase().startsWith("image/")) {
          throw new ApiError(400, "VALIDATION_ERROR", "Avatar must be an image");
        }
      }
      data.avatarMediaAssetId = avatarMediaAssetId;
    }
    if (Object.keys(data).length === 0) {
      return context.user;
    }
    const user = await this.db.user.update({
      where: { id: context.user.id },
      data
    });
    await this.writeAuditLog(context, "update", "user", user.id, {
      summary: "Updated own profile",
      details: { name: user.name, avatarMediaAssetId: user.avatarMediaAssetId }
    });
    return mapUser(user);
  }

  async updateCurrentUserPassword(
    context: RequestContext,
    input: { currentPassword: string; newPassword: string },
    currentSessionToken: string
  ): Promise<User> {
    const user = await this.db.user.findFirst({
      where: { id: context.user.id, workspaceId: context.workspaceId },
      select: { id: true, passwordHash: true }
    });
    if (!user) {
      throw new Error("User not found");
    }
    if (!verifyPassword(input.currentPassword, user.passwordHash)) {
      throw new ApiError(400, "VALIDATION_ERROR", "Current password is incorrect");
    }
    if (input.newPassword.trim().length < 8) {
      throw new ApiError(400, "VALIDATION_ERROR", "Password must be at least 8 characters");
    }
    const updated = await this.db.user.update({
      where: { id: context.user.id },
      data: { passwordHash: hashPassword(input.newPassword) }
    });
    await destroyOtherSessionsForUser(context.user.id, currentSessionToken);
    await this.writeAuditLog(context, "update", "user", user.id, {
      summary: "Changed own password",
      details: { passwordChanged: true, otherSessionsRevoked: true }
    });
    return mapUser(updated);
  }

  async createPasswordSetupLink(
    context: RequestContext,
    id: string,
    origin: string,
    purpose: PasswordSetupPurpose = "reset"
  ): Promise<{ url: string; expiresAt: string; purpose: PasswordSetupPurpose }> {
    requirePermission(context, "crm.admin");
    const user = await this.db.user.findUnique({ where: { id } });
    if (!user || user.workspaceId !== context.workspaceId) {
      throw new Error("User not found");
    }
    if (!user.active) {
      throw new Error("Disabled users cannot receive password setup links");
    }

    const now = new Date();
    const token = createPasswordSetupToken();
    const expiresAt = new Date(now.getTime() + PASSWORD_SETUP_MAX_AGE_SECONDS * 1000);

    await this.db.passwordSetupToken.updateMany({
      where: {
        workspaceId: context.workspaceId,
        userId: id,
        purpose,
        usedAt: null,
        expiresAt: { gt: now }
      },
      data: { usedAt: now }
    });

    await this.db.passwordSetupToken.create({
      data: {
        workspaceId: context.workspaceId,
        userId: id,
        tokenHash: hashPasswordSetupToken(token),
        purpose,
        expiresAt,
        createdById: context.user.id
      }
    });

    const url = new URL("/setup-password", origin);
    url.searchParams.set("token", token);

    await this.writeAuditLog(context, "update", "user", id, {
      summary: `Generated password setup link for ${user.email}`,
      details: { email: user.email, purpose, expiresAt: expiresAt.toISOString() }
    });

    return { url: url.toString(), expiresAt: expiresAt.toISOString(), purpose };
  }

  async listTeams(context: RequestContext): Promise<Team[]> {
    requirePermission(context, "crm.read");
    const teams = await this.db.team.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: { name: "asc" }
    });
    return teams.map(mapTeam);
  }

  async createTeam(context: RequestContext, input: Omit<Team, "id" | "workspaceId">): Promise<Team> {
    requirePermission(context, "crm.admin");
    const name = normalizeTeamName(input.name);
    await this.assertTeamNameAvailable(context, name);

    const team = await this.db.team.create({
      data: {
        workspaceId: context.workspaceId,
        name,
        ...normalizeTeamBusinessInformation(input)
      }
    });

    await this.writeAuditLog(context, "create", "team", team.id, {
      summary: `Created team ${team.name}`,
      details: { name: team.name }
    });

    return mapTeam(team);
  }

  async updateTeam(context: RequestContext, id: string, patch: Partial<Omit<Team, "id" | "workspaceId">>): Promise<Team> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.team.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== context.workspaceId) {
      throw new Error("Team not found");
    }

    const name = normalizeTeamName(patch.name ?? existing.name);
    if (name !== existing.name) {
      await this.assertTeamNameAvailable(context, name, id);
    }
    const team = await this.db.team.update({ where: { id }, data: { name, ...normalizeTeamBusinessInformation(patch) } });

    await this.writeAuditLog(context, "update", "team", id, {
      summary: `Updated team ${team.name}`,
      details: { name: team.name }
    });

    return mapTeam(team);
  }

  async deleteTeam(context: RequestContext, id: string): Promise<void> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.team.findUnique({
      where: { id },
      include: { users: { select: { id: true } } }
    });
    if (!existing || existing.workspaceId !== context.workspaceId) {
      throw new Error("Team not found");
    }
    if (existing.users.length > 0) {
      throw new Error(`Team is assigned to ${existing.users.length} users and cannot be deleted`);
    }

    await this.db.team.delete({ where: { id } });
    await this.writeAuditLog(context, "delete", "team", id, {
      summary: `Deleted team ${existing.name}`,
      details: { name: existing.name }
    });
  }

  async listRoles(context: RequestContext): Promise<Role[]> {
    requirePermission(context, "crm.admin");
    const roles = await this.db.role.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: { name: "asc" }
    });
    return roles.map(mapRole);
  }

  async createRole(context: RequestContext, input: Pick<Role, "name" | "permissions">): Promise<Role> {
    requirePermission(context, "crm.admin");
    const data = normalizeRoleInput(input);
    await this.assertRoleNameAvailable(context, data.name);

    const role = await this.db.role.create({
      data: {
        workspaceId: context.workspaceId,
        name: data.name,
        permissions: data.permissions
      }
    });

    await this.writeAuditLog(context, "create", "role", role.id, {
      summary: `Created role ${role.name}`,
      details: { name: role.name, permissions: role.permissions }
    });

    return mapRole(role);
  }

  async updateRole(context: RequestContext, id: string, patch: Partial<Pick<Role, "name" | "permissions">>): Promise<Role> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.role.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== context.workspaceId) {
      throw new Error("Role not found");
    }

    const data = normalizeRoleInput({
      name: patch.name ?? existing.name,
      permissions: patch.permissions ?? (existing.permissions as Role["permissions"])
    });
    if (data.name !== existing.name) {
      await this.assertRoleNameAvailable(context, data.name, id);
    }
    if (existing.permissions.includes("crm.admin") && !data.permissions.includes("crm.admin")) {
      await this.assertWorkspaceKeepsAdminUser(context, id);
    }

    const role = await this.db.role.update({
      where: { id },
      data
    });

    await this.writeAuditLog(context, "update", "role", id, {
      summary: `Updated role ${role.name}`,
      details: { patch: data }
    });

    return mapRole(role);
  }

  async deleteRole(context: RequestContext, id: string): Promise<void> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.role.findUnique({
      where: { id },
      include: { users: { select: { id: true } } }
    });
    if (!existing || existing.workspaceId !== context.workspaceId) {
      throw new Error("Role not found");
    }
    if (existing.users.length > 0) {
      throw new Error(`Role is assigned to ${existing.users.length} users and cannot be deleted`);
    }

    await this.db.role.delete({ where: { id } });
    await this.writeAuditLog(context, "delete", "role", id, {
      summary: `Deleted role ${existing.name}`,
      details: { name: existing.name, permissions: existing.permissions }
    });
  }

  async listAuditLogs(context: RequestContext, query: AuditLogQuery = {}): Promise<AuditLog[]> {
    requirePermission(context, "crm.admin");
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize, { defaultSize: AUDIT_DEFAULT_PAGE_SIZE, maxSize: AUDIT_EXPORT_MAX_PAGE_SIZE });
    const logs = await this.db.auditLog.findMany({
      where: {
        workspaceId: context.workspaceId,
        ...(query.action ? { action: query.action } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.objectKey ? { objectKey: query.objectKey } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.q
          ? {
              OR: [
                { summary: { contains: query.q, mode: "insensitive" } },
                { entityType: { contains: query.q, mode: "insensitive" } },
                { entityId: { contains: query.q, mode: "insensitive" } }
              ]
            }
          : {})
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    });
    return logs.map(mapAuditLog);
  }

  async exportAuditLogsCsv(context: RequestContext, query: AuditLogQuery = {}): Promise<string> {
    requirePermission(context, "crm.admin");
    const logs = await this.listAuditLogs(context, { ...query, page: 1, pageSize: 1000 });
    const headers = ["id", "createdAt", "action", "entityType", "entityId", "objectKey", "actorId", "summary", "details"];
    return buildCsv(
      headers,
      logs.map((log) => ({
        id: log.id,
        createdAt: log.createdAt,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        objectKey: log.objectKey,
        actorId: log.actorId,
        summary: log.summary,
        details: log.details
      }))
    );
  }

  async writeSystemAuditLog(input: {
    workspaceId: string;
    actorId?: string;
    action: AuditAction;
    entityType: string;
    entityId?: string;
    objectKey?: string;
    summary: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.auditLog.create({
      data: {
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        objectKey: input.objectKey,
        summary: input.summary,
        details: input.details as Prisma.InputJsonValue | undefined
      }
    });
  }

  async getDashboardSummary(context: RequestContext): Promise<DashboardSummary> {
    requirePermission(context, "crm.read");
    const accessWhere = await this.recordAccessWhere(context);
    const activityWhere = await this.visibleActivityWhere(context);
    const recordCounts = await this.db.crmRecord.groupBy({
      by: ["objectKey"],
      where: {
        workspaceId: context.workspaceId,
        ...accessWhere
      },
      _count: { _all: true }
    });
    const deals = await this.db.crmRecord.findMany({
      where: {
        workspaceId: context.workspaceId,
        objectKey: "deals",
        ...accessWhere
      },
      orderBy: { updatedAt: "desc" },
      take: 50
    });
    const openTasks = await this.db.activity.findMany({
      where: {
        ...activityWhere,
        type: "task",
        completedAt: null,
        archivedAt: null
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 50
    });
    const openTaskCount = await this.db.activity.count({
      where: {
        ...activityWhere,
        type: "task",
        completedAt: null,
        archivedAt: null
      }
    });
    const recentActivities = await this.db.activity.findMany({
      where: activityWhere,
      orderBy: { createdAt: "desc" },
      take: 100
    });

    return {
      recordCounts: Object.fromEntries(recordCounts.map((item) => [item.objectKey, item._count._all])),
      totalPipeline: await this.sumDealAmount(context),
      openTaskCount,
      deals: deals.map(mapRecord),
      openTasks: openTasks.map(mapActivity),
      recentActivities: recentActivities.map(mapActivity),
      smartReminders: context.role.permissions.includes("ai.use") ? await this.listSmartReminders(context, { status: "open", snoozed: false, limit: 10 }) : []
    };
  }

  async getSmartReminderSettings(context: RequestContext): Promise<SmartReminderSettings> {
    requirePermission(context, "crm.read");
    return this.ensureSmartReminderSettings(context.workspaceId);
  }

  async updateSmartReminderSettings(
    context: RequestContext,
    patch: Partial<Pick<SmartReminderSettings, "enabled" | "dailyAt" | "maxPerUser" | "objectKeys" | "notifyCreated" | "notifyDailyDigest">>
  ): Promise<SmartReminderSettings> {
    requirePermission(context, "ai.admin");
    const current = await this.ensureSmartReminderSettings(context.workspaceId);
    const nextObjectKeys = Array.isArray(patch.objectKeys)
      ? patch.objectKeys.filter((key) => ["contacts", "companies", "deals", "emails", "tasks", "activities"].includes(key)).slice(0, 10)
      : current.objectKeys;
    const updated = await this.db.smartReminderSettings.update({
      where: { workspaceId: context.workspaceId },
      data: {
        enabled: patch.enabled ?? current.enabled,
        dailyAt: patch.dailyAt && /^([01]\d|2[0-3]):([0-5]\d)$/.test(patch.dailyAt) ? patch.dailyAt : current.dailyAt,
        maxPerUser: patch.maxPerUser ? Math.max(1, Math.min(50, Math.floor(patch.maxPerUser))) : current.maxPerUser,
        objectKeys: nextObjectKeys.length > 0 ? nextObjectKeys : current.objectKeys,
        notifyCreated: patch.notifyCreated ?? current.notifyCreated,
        notifyDailyDigest: patch.notifyDailyDigest ?? current.notifyDailyDigest
      }
    });
    await this.writeAuditLog(context, "update", "smart_reminder_settings", context.workspaceId, {
      summary: "Updated smart reminder settings",
      details: { patch }
    });
    return mapSmartReminderSettings(updated);
  }

  async getCustomerLevelSettings(context: RequestContext): Promise<CustomerLevelSettings> {
    requirePermission(context, "crm.read");
    return this.ensureCustomerLevelSettings(context.workspaceId);
  }

  async updateCustomerLevelSettings(
    context: RequestContext,
    patch: Partial<Pick<CustomerLevelSettings, "enabled" | "levels" | "rules">>
  ): Promise<CustomerLevelSettings> {
    requirePermission(context, "crm.admin");
    const current = await this.ensureCustomerLevelSettings(context.workspaceId);
    const updated = await this.db.customerLevelSettings.update({
      where: { workspaceId: context.workspaceId },
      data: {
        enabled: patch.enabled ?? current.enabled,
        levels: normalizeCustomerLevelDefinitions(patch.levels ?? current.levels) as unknown as Prisma.InputJsonValue,
        rules: normalizeCustomerLevelRules(patch.rules ?? current.rules) as unknown as Prisma.InputJsonValue
      }
    });
    await this.writeAuditLog(context, "update", "customer_level_settings", context.workspaceId, {
      summary: "Updated customer level settings",
      details: { patch }
    });
    return mapCustomerLevelSettings(updated);
  }

  async suggestCustomerLevel(context: RequestContext, objectKey: string, recordId: string): Promise<{ record: CrmRecord; suggestion: CustomerLevelSuggestion }> {
    requirePermission(context, "crm.write");
    if (!isCustomerLevelSuggestionObjectKey(objectKey)) {
      throw new Error("客户等级建议仅支持公司");
    }
    const record = await this.getRecord(context, objectKey, recordId);
    const settings = await this.ensureCustomerLevelSettings(context.workspaceId);
    const suggestion = await this.calculateCustomerLevelSuggestion(context, record, settings);
    const updated = await this.db.crmRecord.update({
      where: { id: record.id },
      data: {
        data: {
          ...record.data,
          customerLevelSuggested: suggestion.level,
          customerLevelScore: suggestion.score,
          customerLevelReasons: suggestion.reasons,
          customerLevelSuggestedAt: suggestion.suggestedAt
        } as Prisma.InputJsonValue
      }
    });
    await this.writeAuditLog(context, "customer_level.suggested", "record", record.id, {
      objectKey,
      summary: `Suggested customer level ${suggestion.level} for ${record.title}`,
      details: suggestion as unknown as Record<string, unknown>
    });
    return { record: mapRecord(updated), suggestion };
  }

  async generateCustomerLevelSuggestions(
    context: RequestContext,
    input: { objectKey?: "companies"; recordId?: string } = {}
  ): Promise<{ records: CrmRecord[]; suggestions: CustomerLevelSuggestion[] }> {
    requirePermission(context, "crm.write");
    const objectKeys = input.objectKey ? [input.objectKey] : (["companies"] as const);
    const updatedRecords: CrmRecord[] = [];
    const suggestions: CustomerLevelSuggestion[] = [];
    for (const objectKey of objectKeys) {
      const records = input.recordId
        ? [await this.getRecord(context, objectKey, input.recordId)]
        : await this.findCustomerLevelCandidateRecords(context, objectKey);
      for (const record of records) {
        const result = await this.suggestCustomerLevel(context, objectKey, record.id);
        updatedRecords.push(result.record);
        suggestions.push(result.suggestion);
      }
    }
    return { records: updatedRecords, suggestions };
  }

  async requestCustomerLevelChange(
    context: RequestContext,
    objectKey: string,
    recordId: string,
    input: { level: CustomerLevel | ""; changeReason: string }
  ): Promise<RecordChangeRequest> {
    requirePermission(context, "crm.write");
    if (!isCustomerLevelObjectKey(objectKey)) {
      throw new Error("客户等级仅支持联系人和公司");
    }
    const record = await this.getRecord(context, objectKey, recordId);
    const nextLevel = input.level || null;
    const levelKey = objectKey === "contacts" ? "contactTempCustomerLevel" : "customerLevel";
    if (objectKey === "contacts" && typeof record.data.companyId === "string" && record.data.companyId.trim()) {
      throw new Error("联系人已关联公司，请到公司记录修改客户等级");
    }
    const currentLevel = typeof record.data[levelKey] === "string" ? record.data[levelKey] : null;
    if (currentLevel === nextLevel) {
      throw new Error("客户等级没有变化");
    }
    const request = await this.requestRecordUpdate(
      context,
      objectKey,
      recordId,
      {
        data: {
          [levelKey]: nextLevel
        },
        __previous: {
          data: {
            [levelKey]: currentLevel
          }
        }
      } as RecordChangeRequest["patch"],
      input.changeReason
    );
    if ("status" in request) {
      await this.writeAuditLog(context, "customer_level.change_requested", "record_change_request", request.id, {
        objectKey,
        summary: `Requested customer level change for ${record.title}`,
        details: { recordId, previousLevel: currentLevel, nextLevel, reason: input.changeReason }
      });
      return request;
    }
    throw new Error("客户等级修改必须进入审批");
  }

  private async ensureCustomerLevelSettings(workspaceId: string): Promise<CustomerLevelSettings> {
    const existing = await this.db.customerLevelSettings.findUnique({ where: { workspaceId } });
    if (existing) {
      return mapCustomerLevelSettings(existing);
    }
    const created = await this.db.customerLevelSettings.create({
      data: {
        workspaceId,
        enabled: true,
        levels: defaultCustomerLevelDefinitions as unknown as Prisma.InputJsonValue,
        rules: defaultCustomerLevelRules as unknown as Prisma.InputJsonValue
      }
    });
    return mapCustomerLevelSettings(created);
  }

  private async findCustomerLevelCandidateRecords(context: RequestContext, objectKey: "contacts" | "companies"): Promise<CrmRecord[]> {
    const records = await this.db.crmRecord.findMany({
      where: {
        workspaceId: context.workspaceId,
        objectKey,
        ...(await this.recordAccessWhere(context, objectKey))
      },
      orderBy: { updatedAt: "desc" },
      take: 200
    });
    return records.map(mapRecord);
  }

  private async calculateCustomerLevelSuggestion(
    context: RequestContext,
    record: CrmRecord,
    settings: CustomerLevelSettings
  ): Promise<CustomerLevelSuggestion> {
    const relatedCompanyId = record.objectKey === "companies" ? record.id : typeof record.data.companyId === "string" ? record.data.companyId : undefined;
    const relatedDeals = relatedCompanyId
      ? await this.db.crmRecord.findMany({
          where: {
            workspaceId: context.workspaceId,
            objectKey: "deals",
            data: { path: ["companyId"], equals: relatedCompanyId },
            ...(await this.recordAccessWhere(context, "deals"))
          },
          take: 100
        })
      : [];
    const relatedActivities = await this.db.activity.findMany({
      where: {
        workspaceId: context.workspaceId,
        OR: [
          { recordId: record.id },
          ...(relatedCompanyId && relatedCompanyId !== record.id ? [{ recordId: relatedCompanyId }] : [])
        ]
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    const relatedThreads = await this.db.emailThread.findMany({
      where: {
        workspaceId: context.workspaceId,
        recordId: { in: [record.id, ...(relatedCompanyId && relatedCompanyId !== record.id ? [relatedCompanyId] : [])] }
      },
      orderBy: { lastMessageAt: "desc" },
      take: 50
    });
    const maxDealAmount = Math.max(0, ...relatedDeals.map((deal) => Number(asRecord(deal.data).amount ?? asRecord(deal.data).totalAmount ?? 0)).filter(Number.isFinite));
    const pipeline = await this.db.pipeline.findFirst({
      where: { workspaceId: context.workspaceId, objectKey: "deals", isDefault: true }
    });
    const stageProbabilities = new Map(asStages(pipeline?.stages ?? []).map((stage) => [stage.key, stage.probability]));
    const maxStageProbability = Math.max(0, ...relatedDeals.map((deal) => stageProbabilities.get(deal.stageKey ?? "") ?? 0));
    const latestActivityAt = relatedActivities[0]?.createdAt;
    const latestEmailAt = relatedThreads[0]?.lastMessageAt ?? relatedThreads[0]?.updatedAt;
    const latestTouchAt = [record.updatedAt ? new Date(record.updatedAt) : undefined, latestActivityAt, latestEmailAt].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0];
    const daysSinceTouch = latestTouchAt ? Math.floor((Date.now() - latestTouchAt.getTime()) / 86_400_000) : 999;
    const overdueTasks = relatedActivities.filter((activity) => activity.type === "task" && !activity.completedAt && activity.dueAt && activity.dueAt.getTime() < Date.now()).length;

    const dealAmountScore = maxDealAmount >= 100000 ? 100 : maxDealAmount >= 20000 ? 75 : maxDealAmount > 0 ? 45 : 15;
    const dealStageScore = Math.round(maxStageProbability * 100);
    const recentActivityScore = daysSinceTouch <= 7 ? 100 : daysSinceTouch <= 30 ? 70 : daysSinceTouch <= 90 ? 35 : 10;
    const emailEngagementScore = relatedThreads.length > 0 ? Math.min(100, 55 + relatedThreads.length * 10) : 20;
    const inactivityScore = daysSinceTouch <= 7 ? 100 : daysSinceTouch <= 30 ? 75 : daysSinceTouch <= 90 ? 35 : 0;
    const overdueTasksScore = overdueTasks === 0 ? 100 : overdueTasks === 1 ? 55 : 20;
    const weightedScore =
      dealAmountScore * settings.rules.dealAmount +
      dealStageScore * settings.rules.dealStage +
      recentActivityScore * settings.rules.recentActivity +
      emailEngagementScore * settings.rules.emailEngagement +
      inactivityScore * settings.rules.inactivity +
      overdueTasksScore * settings.rules.overdueTasks;
    const totalWeight = Object.values(settings.rules).reduce((sum, value) => sum + value, 0) || 1;
    const score = Math.round(weightedScore / totalWeight);
    const level = customerLevelForScore(settings, score);
    const reasons = [
      relatedDeals.length > 0 ? `关联交易 ${relatedDeals.length} 笔，最高金额 ${Math.round(maxDealAmount).toLocaleString()}` : "暂无关联交易",
      maxStageProbability > 0 ? `最高交易阶段概率 ${Math.round(maxStageProbability * 100)}%` : "暂无有效交易阶段",
      daysSinceTouch < 999 ? `最近 ${daysSinceTouch} 天内有跟进或邮件触达` : "暂无可识别的跟进记录",
      relatedThreads.length > 0 ? `关联邮件线程 ${relatedThreads.length} 条` : "暂无关联邮件互动",
      overdueTasks > 0 ? `存在 ${overdueTasks} 个逾期任务，建议优先处理` : "暂无逾期任务"
    ];
    return {
      objectKey: record.objectKey,
      recordId: record.id,
      level,
      score,
      reasons,
      suggestedAt: new Date().toISOString()
    };
  }

  async listSmartReminders(
    context: RequestContext,
    query: { status?: SmartReminder["status"]; snoozed?: boolean; objectKey?: string; recordId?: string; kind?: SmartReminderKind; limit?: number } = {}
  ): Promise<SmartReminder[]> {
    requirePermission(context, "ai.use");
    const now = new Date();
    const where: Prisma.SmartReminderWhereInput = {
      workspaceId: context.workspaceId,
      ...(canManageAllRecords(context) ? {} : { userId: context.user.id }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.objectKey ? { objectKey: query.objectKey } : {}),
      ...(query.recordId ? { recordId: query.recordId } : {}),
      ...(query.snoozed === false ? { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] } : {})
    };
    const reminders = await this.db.smartReminder.findMany({
      where,
      orderBy: [{ priority: "desc" }, { dueAt: "asc" }, { score: "desc" }, { createdAt: "desc" }],
      take: Math.max(1, Math.min(100, query.limit ?? 50))
    });
    const visibleReminders = await this.pruneStaleSmartReminderRecordSources(context, reminders.map(mapSmartReminder));
    return visibleReminders.sort(compareSmartReminders);
  }

  async generateSmartReminders(
    context: RequestContext,
    input: { objectKey?: string; recordId?: string; force?: boolean; daily?: boolean } = {}
  ): Promise<{ reminders: SmartReminder[]; run: SmartReminderRun }> {
    requirePermission(context, "ai.use");
    const startedAt = Date.now();
    const settings = await this.ensureSmartReminderSettings(context.workspaceId);
    const run = await this.db.smartReminderRun.create({
      data: {
        workspaceId: context.workspaceId,
        userId: context.user.id,
        status: "running",
        scope: { userId: context.user.id, objectKey: input.objectKey, recordId: input.recordId, force: input.force, daily: input.daily } as Prisma.InputJsonValue,
        agentKey: smartReminderPlannerAgentKey
      }
    });
    try {
      const contextPayload = await this.buildSmartReminderContext(context, { ...input, objectKeys: settings.objectKeys });
      const aiCandidates = await this.generateAiSmartReminderCandidates(context, contextPayload).catch(() => []);
      const fallbackCandidates = buildFallbackSmartReminderCandidates(context, contextPayload);
      const candidates = dedupeSmartReminderCandidates([...aiCandidates, ...fallbackCandidates])
        .sort((a, b) => b.score - a.score)
        .slice(0, settings.maxPerUser);
      const reminders: SmartReminder[] = [];
      for (const candidate of candidates) {
        const created = await this.upsertSmartReminderCandidate(context, candidate);
        reminders.push(created);
      }
      const completed = await this.db.smartReminderRun.update({
        where: { id: run.id },
        data: {
          status: "completed",
          generatedCount: reminders.length,
          fallback: aiCandidates.length === 0,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt
        }
      });
      if (settings.notifyDailyDigest && reminders.length > 0) {
        this.emitNotificationEvent(context, "ai.reminder.daily_digest", {
          title: `今日最佳行动 ${reminders.length} 条`,
          userId: context.user.id,
          reminderCount: reminders.length
        });
      }
      return { reminders, run: mapSmartReminderRun(completed) };
    } catch (error) {
      const completed = await this.db.smartReminderRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          fallback: true,
          errorMessage: normalizeErrorMessage(error),
          completedAt: new Date(),
          durationMs: Date.now() - startedAt
        }
      });
      this.emitNotificationEvent(context, "ai.reminder.failed", {
        title: "AI 智能提醒生成失败",
        userId: context.user.id,
        error: normalizeErrorMessage(error)
      });
      return { reminders: [], run: mapSmartReminderRun(completed) };
    }
  }

  async runDailySmartReminderGenerationIfDue(
    context: RequestContext
  ): Promise<{ ran: boolean; reason?: string; reminders: number; runId?: string }> {
    requirePermission(context, "ai.use");
    const settings = await this.ensureSmartReminderSettings(context.workspaceId);
    if (!settings.enabled) {
      return { ran: false, reason: "disabled", reminders: 0 };
    }
    const windowStart = smartReminderDailyWindowStart(settings.dailyAt);
    if (Date.now() < windowStart.getTime()) {
      return { ran: false, reason: "not_due", reminders: 0 };
    }
    const existing = await this.db.smartReminderRun.findFirst({
      where: {
        workspaceId: context.workspaceId,
        userId: context.user.id,
        startedAt: { gte: windowStart },
        scope: { path: ["daily"], equals: true }
      },
      orderBy: { startedAt: "desc" }
    });
    if (existing) {
      return { ran: false, reason: "already_ran", reminders: existing.generatedCount, runId: existing.id };
    }
    const result = await this.generateSmartReminders(context, { daily: true });
    return { ran: true, reminders: result.reminders.length, runId: result.run.id };
  }

  async updateSmartReminder(
    context: RequestContext,
    id: string,
    patch: { status?: SmartReminder["status"]; snoozedUntil?: string | null }
  ): Promise<SmartReminder> {
    requirePermission(context, "ai.use");
    const existing = await this.getSmartReminderForAction(context, id);
    const status = patch.status ?? existing.status;
    const now = new Date();
    const updated = await this.db.smartReminder.update({
      where: { id },
      data: {
        status,
        snoozedUntil: patch.snoozedUntil === undefined ? undefined : patch.snoozedUntil ? new Date(patch.snoozedUntil) : null,
        completedAt: status === "done" ? now : status === "open" ? null : undefined,
        dismissedAt: status === "dismissed" ? now : status === "open" ? null : undefined
      }
    });
    await this.writeAuditLog(context, "update", "smart_reminder", id, {
      summary: `Updated smart reminder ${updated.title}`,
      details: { status, snoozedUntil: patch.snoozedUntil }
    });
    return mapSmartReminder(updated);
  }

  async convertSmartReminderToTask(context: RequestContext, id: string): Promise<{ reminder: SmartReminder; task: Activity }> {
    requirePermission(context, "crm.write");
    const reminder = await this.getSmartReminderForAction(context, id);
    const taskDueAt = reminder.dueAt ? new Date(reminder.dueAt).toISOString() : smartReminderDefaultDueAt();
    const task = await this.createActivity(context, {
      recordId: reminder.recordId,
      type: "task",
      title: reminder.actionLabel || reminder.title,
      body: reminder.body,
      dueAt: taskDueAt,
      completedAt: undefined,
      archivedAt: undefined
    });
    const updated = await this.updateSmartReminder(context, id, { status: "done" });
    return { reminder: updated, task };
  }

  async requestSmartReminderDelete(context: RequestContext, id: string, reason: string): Promise<RecordChangeRequest> {
    requirePermission(context, "ai.use");
    const cleanedReason = reason.trim();
    if (cleanedReason.length < 1) {
      throw new Error("请填写删除原因");
    }
    const reminder = await this.getSmartReminderForAction(context, id);
    const existingRequest = await this.db.recordChangeRequest.findFirst({
      where: {
        workspaceId: context.workspaceId,
        objectKey: "smart_reminders",
        recordId: reminder.id,
        action: "delete",
        status: "pending"
      }
    });
    if (existingRequest) {
      return mapRecordChangeRequest(existingRequest);
    }
    const request = await this.db.recordChangeRequest.create({
      data: {
        workspaceId: context.workspaceId,
        objectKey: "smart_reminders",
        recordId: reminder.id,
        action: "delete",
        status: "pending",
        reason: cleanedReason,
        requestedById: context.user.id,
        recordTitle: reminder.title,
        patch: toJsonObject({
          smartReminder: {
            kind: reminder.kind,
            priority: reminder.priority,
            title: reminder.title,
            body: reminder.body,
            actionLabel: reminder.actionLabel,
            dueAt: reminder.dueAt,
            status: reminder.status,
            snoozedUntil: reminder.snoozedUntil,
            sources: reminder.sources,
            createdAt: reminder.createdAt
          }
        })
      }
    });
    await this.writeAuditLog(context, "record.change_requested", "record_change_request", request.id, {
      objectKey: "smart_reminders",
      summary: `Requested delete approval for smart reminder ${reminder.title}`,
      details: { reminderId: reminder.id, action: "delete", reason: cleanedReason, priority: reminder.priority, kind: reminder.kind }
    });
    return mapRecordChangeRequest(request);
  }

  async deleteSmartReminder(context: RequestContext, id: string): Promise<void> {
    requirePermission(context, "ai.use");
    const reminder = await this.getSmartReminderForAction(context, id);
    await this.db.smartReminder.delete({ where: { id: reminder.id } });
    await this.writeAuditLog(context, "delete", "smart_reminder", id, {
      summary: `Deleted smart reminder ${reminder.title}`,
      details: { reminderId: reminder.id, priority: reminder.priority, kind: reminder.kind }
    });
  }

  async listObjectDefinitions(context: RequestContext): Promise<ObjectDefinition[]> {
    requirePermission(context, "crm.read");
    const objects = await this.db.objectDefinition.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }]
    });
    return objects.map(mapObjectDefinition);
  }

  async createObjectDefinition(
    context: RequestContext,
    input: Pick<ObjectDefinition, "key" | "label" | "pluralLabel" | "description" | "icon">
  ): Promise<ObjectDefinition> {
    requirePermission(context, "crm.admin");
    if (!/^[a-z][a-z0-9-]*s$/.test(input.key)) {
      throw new Error("Object key must be plural lowercase, for example partners");
    }

    const object = await this.db.objectDefinition.create({
      data: {
        workspaceId: context.workspaceId,
        key: input.key,
        label: input.label,
        pluralLabel: input.pluralLabel,
        description: input.description,
        icon: input.icon,
        isSystem: false
      }
    });

    await this.writeAuditLog(context, "create", "object_definition", object.id, {
      objectKey: object.key,
      summary: `Created object definition ${object.key}`,
      details: { label: object.label, pluralLabel: object.pluralLabel }
    });

    return mapObjectDefinition(object);
  }

  async updateObjectDefinition(
    context: RequestContext,
    id: string,
    patch: Partial<Pick<ObjectDefinition, "label" | "pluralLabel" | "description" | "icon">>
  ): Promise<ObjectDefinition> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.objectDefinition.findUnique({
      where: { id },
      select: { id: true, workspaceId: true }
    });
    if (!existing || existing.workspaceId !== context.workspaceId) {
      throw new Error("Object definition not found");
    }
    const updated = await this.db.objectDefinition.update({
      where: { id },
      data: patch
    });
    await this.writeAuditLog(context, "update", "object_definition", id, {
      objectKey: updated.key,
      summary: `Updated object definition ${updated.key}`,
      details: { patch }
    });
    return mapObjectDefinition(updated);
  }

  async deleteObjectDefinition(context: RequestContext, id: string): Promise<void> {
    requirePermission(context, "crm.admin");
    const object = await this.db.objectDefinition.findUnique({
      where: { id },
      select: { id: true, key: true, isSystem: true, workspaceId: true }
    });
    if (!object || object.workspaceId !== context.workspaceId) {
      throw new Error("Object definition not found");
    }
    if (object.isSystem) {
      throw new Error("System objects cannot be deleted");
    }
    await this.assertObjectCanBeDeleted(context, object);

    await this.db.fieldDefinition.deleteMany({ where: { objectDefinitionId: id } });
    await this.db.relationDefinition.deleteMany({
      where: {
        workspaceId: context.workspaceId,
        OR: [{ fromObjectKey: object.key }, { toObjectKey: object.key }]
      }
    });
    await this.db.pipeline.deleteMany({ where: { workspaceId: context.workspaceId, objectKey: object.key } });
    await this.db.savedView.deleteMany({ where: { objectDefinitionId: id } });
    await this.db.crmRecord.deleteMany({ where: { workspaceId: context.workspaceId, objectKey: object.key } });
    await this.db.objectDefinition.delete({ where: { id } });
    await this.writeAuditLog(context, "delete", "object_definition", id, {
      objectKey: object.key,
      summary: `Deleted object definition ${object.key}`,
      details: { key: object.key }
    });
  }

  async listFieldDefinitions(context: RequestContext, objectKey?: string): Promise<FieldDefinition[]> {
    requirePermission(context, "crm.read");
    const fields = await this.db.fieldDefinition.findMany({
      where: {
        workspaceId: context.workspaceId,
        ...(objectKey ? { objectDefinition: { key: objectKey } } : {})
      },
      include: { objectDefinition: { select: { key: true } } },
      orderBy: [{ objectDefinitionId: "asc" }, { position: "asc" }]
    });

    return fields.map(mapFieldDefinition);
  }

  async createFieldDefinition(
    context: RequestContext,
    input: Omit<FieldDefinition, "id" | "workspaceId" | "isSystem" | "position"> & { position?: number }
  ): Promise<FieldDefinition> {
    requirePermission(context, "crm.admin");
    assertValidFieldDefinition(input);
    const object = await this.requireObject(context, input.objectKey);
    await this.assertFieldReferenceTarget(context, input);
    await this.assertFieldCompatibleWithRecords(context, {
      ...input,
      id: "pending-field",
      workspaceId: context.workspaceId,
      isSystem: false,
      position: input.position ?? 0
    });
    const count = await this.db.fieldDefinition.count({
      where: { objectDefinitionId: object.id }
    });

    const created = await this.db.fieldDefinition.create({
      data: {
        workspaceId: context.workspaceId,
        objectDefinitionId: object.id,
        key: input.key,
        label: input.label,
        type: input.type,
        required: input.required,
        unique: input.unique,
        options: input.options as Prisma.InputJsonValue | undefined,
        defaultValue: input.defaultValue as Prisma.InputJsonValue | undefined,
        isSystem: false,
        position: input.position ?? count + 1
      },
      include: { objectDefinition: { select: { key: true } } }
    });

    await this.writeAuditLog(context, "create", "field_definition", created.id, {
      objectKey: input.objectKey,
      summary: `Created field ${input.objectKey}.${created.key}`,
      details: { key: created.key, type: created.type, required: created.required }
    });

    return mapFieldDefinition(created);
  }

  async updateFieldDefinition(
    context: RequestContext,
    id: string,
    patch: Partial<Pick<FieldDefinition, "label" | "required" | "unique" | "options" | "defaultValue" | "position">>
  ): Promise<FieldDefinition> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.fieldDefinition.findUnique({
      where: { id },
      include: { objectDefinition: { select: { key: true } } }
    });
    if (!existing || existing.workspaceId !== context.workspaceId) {
      throw new Error("Field definition not found");
    }

    assertValidFieldDefinition({
      key: existing.key,
      label: patch.label ?? existing.label,
      type: existing.type as FieldDefinition["type"],
      options: (patch.options as FieldDefinition["options"]) ?? (((existing.options as unknown) as FieldDefinition["options"]) ?? undefined)
    });
    const nextField: FieldDefinition = {
      id: existing.id,
      workspaceId: existing.workspaceId,
      objectKey: existing.objectDefinition.key,
      key: existing.key,
      label: patch.label ?? existing.label,
      type: existing.type as FieldDefinition["type"],
      required: patch.required ?? existing.required,
      unique: patch.unique ?? existing.unique,
      options: (patch.options as FieldDefinition["options"]) ?? (((existing.options as unknown) as FieldDefinition["options"]) ?? undefined),
      defaultValue: patch.defaultValue ?? existing.defaultValue ?? undefined,
      isSystem: existing.isSystem,
      position: patch.position ?? existing.position
    };
    await this.assertFieldReferenceTarget(context, nextField);
    await this.assertFieldCompatibleWithRecords(context, nextField);

    const updated = await this.db.fieldDefinition.update({
      where: { id },
      data: {
        label: patch.label,
        required: patch.required,
        unique: patch.unique,
        options: patch.options as Prisma.InputJsonValue | undefined,
        defaultValue: patch.defaultValue as Prisma.InputJsonValue | undefined,
        position: patch.position
      },
      include: { objectDefinition: { select: { key: true } } }
    });

    await this.writeAuditLog(context, "update", "field_definition", id, {
      objectKey: updated.objectDefinition.key,
      summary: `Updated field ${updated.objectDefinition.key}.${updated.key}`,
      details: { patch }
    });

    return mapFieldDefinition(updated);
  }

  async deleteFieldDefinition(context: RequestContext, id: string): Promise<void> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.fieldDefinition.findUnique({
      where: { id },
      include: { objectDefinition: { select: { key: true } } }
    });
    if (!existing || existing.workspaceId !== context.workspaceId) {
      throw new Error("Field definition not found");
    }
    if (existing.isSystem) {
      throw new Error("System fields cannot be deleted");
    }
    await this.assertFieldCanBeDeleted(context, mapFieldDefinition(existing));
    await this.db.fieldDefinition.delete({ where: { id } });
    await this.writeAuditLog(context, "delete", "field_definition", id, {
      objectKey: existing.objectDefinition.key,
      summary: `Deleted field ${existing.objectDefinition.key}.${existing.key}`,
      details: { key: existing.key }
    });
  }

  async listRelationDefinitions(context: RequestContext): Promise<RelationDefinition[]> {
    requirePermission(context, "crm.read");
    const relations = await this.db.relationDefinition.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: { key: "asc" }
    });
    return relations.map(mapRelationDefinition);
  }

  async createRelationDefinition(
    context: RequestContext,
    input: Omit<RelationDefinition, "id" | "workspaceId">
  ): Promise<RelationDefinition> {
    requirePermission(context, "crm.admin");
    await this.requireObject(context, input.fromObjectKey);
    await this.requireObject(context, input.toObjectKey);
    const created = await this.db.relationDefinition.create({
      data: {
        workspaceId: context.workspaceId,
        fromObjectKey: input.fromObjectKey,
        toObjectKey: input.toObjectKey,
        key: input.key,
        label: input.label,
        cardinality: input.cardinality
      }
    });
    await this.writeAuditLog(context, "create", "relation_definition", created.id, {
      summary: `Created relation ${created.key}`,
      details: { fromObjectKey: created.fromObjectKey, toObjectKey: created.toObjectKey, cardinality: created.cardinality }
    });
    return mapRelationDefinition(created);
  }

  async updateRelationDefinition(
    context: RequestContext,
    id: string,
    patch: Partial<Omit<RelationDefinition, "id" | "workspaceId">>
  ): Promise<RelationDefinition> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.relationDefinition.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== context.workspaceId) {
      throw new Error("Relation definition not found");
    }
    if (patch.fromObjectKey) {
      await this.requireObject(context, patch.fromObjectKey);
    }
    if (patch.toObjectKey) {
      await this.requireObject(context, patch.toObjectKey);
    }
    const nextRelation = { ...mapRelationDefinition(existing), ...patch };
    if (nextRelation.fromObjectKey !== existing.fromObjectKey || nextRelation.toObjectKey !== existing.toObjectKey) {
      await this.assertRelationCanBeDeleted(context, mapRelationDefinition(existing));
    }
    const updated = await this.db.relationDefinition.update({
      where: { id },
      data: patch
    });
    await this.writeAuditLog(context, "update", "relation_definition", id, {
      summary: `Updated relation ${updated.key}`,
      details: { patch }
    });
    return mapRelationDefinition(updated);
  }

  async deleteRelationDefinition(context: RequestContext, id: string): Promise<void> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.relationDefinition.findUnique({
      where: { id }
    });
    if (!existing || existing.workspaceId !== context.workspaceId) {
      throw new Error("Relation definition not found");
    }
    await this.assertRelationCanBeDeleted(context, mapRelationDefinition(existing));
    await this.db.relationDefinition.delete({ where: { id } });
    await this.writeAuditLog(context, "delete", "relation_definition", id, {
      summary: `Deleted relation ${existing.key}`,
      details: { key: existing.key }
    });
  }

  async listRecords(context: RequestContext, objectKey: string): Promise<CrmRecord[]> {
    requirePermission(context, "crm.read");
    await this.requireObject(context, objectKey);
    const accessWhere = await this.recordAccessWhere(context, objectKey);
    const records = await this.db.crmRecord.findMany({
      where: {
        workspaceId: context.workspaceId,
        objectKey,
        ...accessWhere
      },
      orderBy: { updatedAt: "desc" }
    });
    return records.map(mapRecord);
  }

  async queryRecords(context: RequestContext, objectKey: string, query: RecordListQuery = {}): Promise<RecordListResult> {
    requirePermission(context, "crm.read");
    await this.requireObject(context, objectKey);
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize, { defaultSize: RECORD_DEFAULT_PAGE_SIZE, maxSize: RECORD_MAX_PAGE_SIZE });
    const normalizedQuery = normalizeRecordListQuery(query, page, pageSize);
    const whereSql = await this.recordQuerySql(context, objectKey, normalizedQuery);
    if (canUseKeysetPagination(normalizedQuery)) {
      const keysetPage = await this.findRecordsKeysetPage(whereSql, normalizedQuery, pageSize);
      return {
        records: keysetPage.records,
        total: -1,
        page,
        pageSize,
        pageCount: keysetPage.nextCursor ? page + 1 : page,
        nextCursor: keysetPage.nextCursor,
        paginationMode: "keyset",
        query: normalizedQuery
      };
    }

    const countRows = await this.db.$queryRaw<Array<{ total: string | number | bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS total
      FROM "CrmRecord"
      WHERE ${whereSql}
    `);
    const total = Number(countRows[0]?.total ?? 0);
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, pageCount);
    const start = (safePage - 1) * pageSize;
    const records = await this.findRecordsPage(whereSql, normalizedQuery, start, pageSize);

    return {
      records,
      total,
      page: safePage,
      pageSize,
      pageCount,
      paginationMode: "offset",
      query: normalizeRecordListQuery(query, safePage, pageSize)
    };
  }

  async exportRecordsCsv(context: RequestContext, objectKey: string, query: RecordListQuery = {}): Promise<string> {
    requirePermission(context, "crm.read");
    await this.requireObject(context, objectKey);
    const fields = await this.listFieldDefinitions(context, objectKey);
    const result = await this.queryRecords(context, objectKey, { ...query, page: 1, pageSize: 200 });
    const headers = ["id", "title", "tags", "stageKey", "ownerId", "createdAt", "updatedAt", ...fields.map((field) => field.key)];
    return buildCsv(
      headers,
      result.records.map((record) => ({
        id: record.id,
        title: record.title,
        tags: record.tags.join("; "),
        stageKey: record.stageKey,
        ownerId: record.ownerId,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        ...record.data
      }))
    );
  }

  async exportImportTemplateCsv(context: RequestContext, objectKey: string): Promise<string> {
    requirePermission(context, "crm.import");
    await this.requireObject(context, objectKey);
    const fields = await this.listFieldDefinitions(context, objectKey);
    const headers = ["title", "tags", ...fields.map((field) => field.key)];
    return buildCsv(headers, [buildImportTemplateExampleRow(fields)]);
  }

  async exportImportTemplateFieldGuideCsv(context: RequestContext, objectKey: string): Promise<string> {
    requirePermission(context, "crm.import");
    await this.requireObject(context, objectKey);
    const fields = await this.listFieldDefinitions(context, objectKey);
    const objects = await this.listObjectDefinitions(context);
    return buildImportTemplateFieldGuideCsv(fields, objects);
  }

  async getRecord(context: RequestContext, objectKey: string, recordId: string): Promise<CrmRecord> {
    requirePermission(context, "crm.read");
    const record = await this.db.crmRecord.findFirst({
      where: {
        id: recordId,
        workspaceId: context.workspaceId,
        objectKey,
        ...(await this.recordAccessWhere(context, objectKey))
      }
    });
    if (!record) {
      throw new Error("Record not found");
    }
    return mapRecord(record);
  }

  async listDocumentTemplates(context: RequestContext, objectKey?: string): Promise<DocumentTemplate[]> {
    requirePermission(context, "crm.read");
    if (objectKey && !isSalesDocumentObjectKey(objectKey)) {
      throw new ApiError(400, "VALIDATION_ERROR", "PDF templates are only supported for sales documents");
    }
    const templates = await this.db.documentTemplate.findMany({
      where: {
        workspaceId: context.workspaceId,
        ...(objectKey ? { objectKey } : {})
      },
      orderBy: [{ objectKey: "asc" }, { isDefault: "desc" }, { updatedAt: "desc" }]
    });
    return templates.map(mapDocumentTemplate);
  }

  async getDocumentTemplate(context: RequestContext, id: string): Promise<DocumentTemplate> {
    requirePermission(context, "crm.read");
    const template = await this.db.documentTemplate.findFirst({
      where: { id, workspaceId: context.workspaceId }
    });
    if (!template) {
      throw new Error("Document template not found");
    }
    return mapDocumentTemplate(template);
  }

  async getDefaultDocumentTemplate(context: RequestContext, objectKey: string): Promise<DocumentTemplate> {
    requirePermission(context, "crm.read");
    if (!isSalesDocumentObjectKey(objectKey)) {
      throw new ApiError(400, "VALIDATION_ERROR", "PDF templates are only supported for sales documents");
    }
    const template = await this.db.documentTemplate.findFirst({
      where: { workspaceId: context.workspaceId, objectKey, active: true, isDefault: true },
      orderBy: { updatedAt: "desc" }
    });
    if (template) {
      return mapDocumentTemplate(template);
    }
    const fallback = await this.db.documentTemplate.findFirst({
      where: { workspaceId: context.workspaceId, objectKey, active: true },
      orderBy: { updatedAt: "desc" }
    });
    if (!fallback) {
      throw new Error("No active PDF template found");
    }
    return mapDocumentTemplate(fallback);
  }

  async createDocumentTemplate(
    context: RequestContext,
    input: Pick<DocumentTemplate, "objectKey" | "name" | "active" | "isDefault" | "templateJson">
  ): Promise<DocumentTemplate> {
    requirePermission(context, "crm.admin");
    if (!isSalesDocumentObjectKey(input.objectKey)) {
      throw new ApiError(400, "VALIDATION_ERROR", "PDF templates are only supported for sales documents");
    }
    const created = await this.db.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.documentTemplate.updateMany({
          where: { workspaceId: context.workspaceId, objectKey: input.objectKey },
          data: { isDefault: false }
        });
      }
      return tx.documentTemplate.create({
        data: {
          workspaceId: context.workspaceId,
          objectKey: input.objectKey,
          name: input.name,
          active: input.active,
          isDefault: input.isDefault,
          templateJson: input.templateJson as Prisma.InputJsonValue,
          createdById: context.user.id
        }
      });
    });
    await this.writeAuditLog(context, "create", "document_template", created.id, {
      objectKey: created.objectKey,
      summary: `Created PDF template ${created.name}`,
      details: { objectKey: created.objectKey, isDefault: created.isDefault }
    });
    return mapDocumentTemplate(created);
  }

  async updateDocumentTemplate(
    context: RequestContext,
    id: string,
    patch: Partial<Pick<DocumentTemplate, "name" | "active" | "isDefault" | "templateJson">>
  ): Promise<DocumentTemplate> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.documentTemplate.findFirst({ where: { id, workspaceId: context.workspaceId } });
    if (!existing) {
      throw new Error("Document template not found");
    }
    const updated = await this.db.$transaction(async (tx) => {
      if (patch.isDefault) {
        await tx.documentTemplate.updateMany({
          where: { workspaceId: context.workspaceId, objectKey: existing.objectKey, id: { not: id } },
          data: { isDefault: false }
        });
      }
      return tx.documentTemplate.update({
        where: { id },
        data: {
          name: patch.name,
          active: patch.active,
          isDefault: patch.isDefault,
          templateJson: patch.templateJson as Prisma.InputJsonValue | undefined
        }
      });
    });
    await this.writeAuditLog(context, "update", "document_template", id, {
      objectKey: updated.objectKey,
      summary: `Updated PDF template ${updated.name}`,
      details: { patch }
    });
    return mapDocumentTemplate(updated);
  }

  async deleteDocumentTemplate(context: RequestContext, id: string): Promise<void> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.documentTemplate.findFirst({ where: { id, workspaceId: context.workspaceId } });
    if (!existing) {
      throw new Error("Document template not found");
    }
    await this.db.documentTemplate.delete({ where: { id } });
    await this.writeAuditLog(context, "delete", "document_template", id, {
      objectKey: existing.objectKey,
      summary: `Deleted PDF template ${existing.name}`,
      details: { objectKey: existing.objectKey }
    });
  }

  async generateSalesDocumentNumber(context: RequestContext, objectKey: SalesDocumentObjectKey, nowDate = new Date()): Promise<string> {
    requirePermission(context, "crm.write");
    const settingRow = await this.db.salesDocumentNumberSetting.findUnique({ where: { workspaceId_objectKey: { workspaceId: context.workspaceId, objectKey } } });
    const setting = settingRow
      ? { workspaceId: settingRow.workspaceId, objectKey, pattern: settingRow.pattern, sequencePadding: settingRow.sequencePadding, updatedAt: settingRow.updatedAt.toISOString() } as SalesDocumentNumberSetting
      : defaultSalesDocumentNumberSetting(context.workspaceId, objectKey);
    const sequence = await this.db.salesDocumentDailySequence.upsert({
      where: { workspaceId_objectKey_localDate: { workspaceId: context.workspaceId, objectKey, localDate: salesDocumentLocalDate(nowDate) } },
      create: { workspaceId: context.workspaceId, objectKey, localDate: salesDocumentLocalDate(nowDate), value: 1 },
      update: { value: { increment: 1 } }
    });
    return renderSalesDocumentNumber(setting.pattern, setting.sequencePadding, { now: nowDate, recordId: randomUUID(), sequence: sequence.value });
  }

  async convertSalesDocument(context: RequestContext, objectKey: string, recordId: string, targetObjectKey: string): Promise<CrmRecord> {
    requirePermission(context, "crm.write");
    if (!isSalesDocumentObjectKey(objectKey) || !isSalesDocumentObjectKey(targetObjectKey)) {
      throw new ApiError(400, "VALIDATION_ERROR", "Unsupported sales document conversion");
    }
    const expectedTarget = salesDocumentNextObjectKey[objectKey];
    if (expectedTarget !== targetObjectKey) {
      throw new ApiError(400, "VALIDATION_ERROR", `Cannot convert ${objectKey} to ${targetObjectKey}`);
    }
    const source = await this.getRecord(context, objectKey, recordId);
    const created = await this.createRecord(context, targetObjectKey, {
      title: `${salesDocumentTitles[targetObjectKey]} - ${source.title}`,
      ownerId: source.ownerId,
      tags: source.tags,
      tagColors: source.tagColors,
      data: buildSalesDocumentConversionData(source, targetObjectKey, ""),
      autoGenerateNumber: true
    });
    await this.writeAuditLog(context, "create", "record_conversion", created.id, {
      objectKey: targetObjectKey,
      summary: `Converted ${objectKey} ${source.title} to ${targetObjectKey} ${created.title}`,
      details: { sourceObjectKey: objectKey, sourceRecordId: recordId, targetObjectKey, targetRecordId: created.id }
    });
    return created;
  }

  async createRecord(context: RequestContext, objectKey: string, input: Pick<CrmRecord, "title" | "data" | "stageKey" | "ownerId"> & { tags?: string[]; tagColors?: Record<string, string>; autoGenerateNumber?: boolean }): Promise<CrmRecord> {
    requirePermission(context, "crm.write");
    await this.requireObject(context, objectKey);
    const fields = await this.listFieldDefinitions(context, objectKey);
    let data =
      isSalesDocumentObjectKey(objectKey)
        ? normalizeSalesDocumentRecordData(objectKey, input.data, await this.listRecordsForValidation(context, "currencies"))
        : objectKey === "contacts"
          ? normalizeContactCustomerLevelData(input.data)
          : input.data;
    const numberField = isSalesDocumentObjectKey(objectKey) ? salesDocumentNumberField(objectKey) : undefined;
    const shouldGenerateNumber = Boolean(numberField && (input.autoGenerateNumber || !String(data[numberField] ?? "").trim()));
    if (numberField && shouldGenerateNumber) {
      data = { ...data, [numberField]: "pending-auto-number" };
    }
    if (isSalesDocumentObjectKey(objectKey)) {
      validateSalesDocumentRecordData(objectKey, data, await this.listRecordsForValidation(context, "products"));
    }
    const existing = await this.listRecordsForUniqueValidation(context, objectKey, fields, data);
    validateRecordPayload(fields, data, existing);
    await this.assertRecordReferences(context, fields, data, true);

    const tags = uniqueTags(input.tags ?? []);
    const recordId = randomUUID();
    const ownerId = canManageAllRecords(context) ? input.ownerId ?? context.user.id : context.user.id;
    const tagColors = normalizeTagColors(input.tagColors ?? {}, tags);
    const record = isSalesDocumentObjectKey(objectKey)
      ? await this.db.$transaction(async (tx) => {
          const now = new Date();
          const localDate = salesDocumentLocalDate(now);
          const sequence = await tx.salesDocumentDailySequence.upsert({
            where: { workspaceId_objectKey_localDate: { workspaceId: context.workspaceId, objectKey, localDate } },
            create: { workspaceId: context.workspaceId, objectKey, localDate, value: 1 },
            update: { value: { increment: 1 } }
          });
          let finalData = data;
          if (shouldGenerateNumber && numberField) {
            const row = await tx.salesDocumentNumberSetting.findUnique({ where: { workspaceId_objectKey: { workspaceId: context.workspaceId, objectKey } } });
            const setting = row
              ? { workspaceId: row.workspaceId, objectKey, pattern: row.pattern, sequencePadding: row.sequencePadding, updatedAt: row.updatedAt.toISOString() } as SalesDocumentNumberSetting
              : defaultSalesDocumentNumberSetting(context.workspaceId, objectKey);
            finalData = { ...data, [numberField]: renderSalesDocumentNumber(setting.pattern, setting.sequencePadding, { now, recordId, sequence: sequence.value }) };
            validateRecordPayload(fields, finalData, existing);
            const duplicate = await tx.crmRecord.count({ where: { workspaceId: context.workspaceId, objectKey, data: { path: [numberField], equals: finalData[numberField] as string } } });
            if (duplicate) throw new ApiError(409, "CONFLICT", "Generated document number already exists; update the numbering rule and try again");
          }
          return tx.crmRecord.create({ data: { id: recordId, workspaceId: context.workspaceId, objectKey, title: input.title, stageKey: input.stageKey, ownerId, tags, tagColors: tagColors as Prisma.InputJsonValue, data: finalData as Prisma.InputJsonValue } });
        })
      : await this.db.crmRecord.create({
          data: { id: recordId, workspaceId: context.workspaceId, objectKey, title: input.title, stageKey: input.stageKey, ownerId, tags, tagColors: tagColors as Prisma.InputJsonValue, data: data as Prisma.InputJsonValue }
        });

    await this.writeAuditLog(context, "create", "record", record.id, {
      objectKey,
      summary: `Created ${objectKey} record ${record.title}`,
      details: { title: record.title, ownerId: record.ownerId, stageKey: record.stageKey, tags: record.tags }
    });

    const mapped = mapRecord(record);
    this.emitWebhookEvent(context, "record.created", {
      recordId: mapped.id,
      objectKey: mapped.objectKey,
    title: mapped.title,
      ownerId: mapped.ownerId,
      tags: mapped.tags
    });
    return mapped;
  }

  async updateRecord(
    context: RequestContext,
    objectKey: string,
    recordId: string,
    patch: Partial<Pick<CrmRecord, "title" | "data" | "stageKey" | "ownerId" | "tags" | "tagColors">>
  ): Promise<CrmRecord> {
    requirePermission(context, "crm.write");
    const current = await this.getRecord(context, objectKey, recordId);
    const { nextData } = await this.validateRecordPatch(context, objectKey, recordId, current, patch);
    const nextTags = patch.tags !== undefined ? uniqueTags(patch.tags) : current.tags;
    const nextTagColors = normalizeTagColors(patch.tagColors ?? current.tagColors ?? {}, nextTags);

    const updated = await this.db.crmRecord.update({
      where: { id: recordId },
      data: {
        title: patch.title ?? current.title,
        data: nextData as Prisma.InputJsonValue,
        ownerId: canManageAllRecords(context) ? patch.ownerId ?? current.ownerId : current.ownerId,
        stageKey: patch.stageKey ?? current.stageKey,
        tags: patch.tags !== undefined ? nextTags : undefined,
        tagColors: patch.tags !== undefined || patch.tagColors !== undefined ? (nextTagColors as Prisma.InputJsonValue) : undefined
      }
    });

    if (objectKey === "deals" && patch.stageKey !== undefined && patch.stageKey !== current.stageKey) {
      await this.db.activity.create({
        data: {
          workspaceId: context.workspaceId,
          recordId,
          type: "stage_change",
          title: `Stage changed: ${current.stageKey ?? "none"} -> ${patch.stageKey ?? "none"}`,
          actorId: context.user.id
        }
      });
    }

    await this.writeAuditLog(context, "update", "record", recordId, {
      objectKey,
      summary: `Updated ${objectKey} record ${updated.title}`,
      details: { patch, previousStageKey: current.stageKey, nextStageKey: updated.stageKey, previousTags: current.tags, nextTags: updated.tags }
    });

    const mapped = mapRecord(updated);
    this.emitWebhookEvent(context, "record.updated", {
      recordId: mapped.id,
      objectKey: mapped.objectKey,
      title: mapped.title,
      previousStageKey: current.stageKey,
      nextStageKey: mapped.stageKey,
      ownerId: mapped.ownerId,
      tags: mapped.tags
    });
    return mapped;
  }

  private async validateRecordPatch(
    context: RequestContext,
    objectKey: string,
    recordId: string,
    current: CrmRecord,
    patch: Partial<Pick<CrmRecord, "title" | "data" | "stageKey" | "ownerId" | "tags" | "tagColors">>
  ): Promise<{ nextData: Record<string, unknown>; fields: FieldDefinition[] }> {
    if (patch.tags !== undefined) {
      uniqueTags(patch.tags);
    }
    if (patch.tagColors !== undefined) {
      normalizeTagColors(patch.tagColors, patch.tags ?? current.tags);
    }
    const mergedData = { ...current.data, ...(patch.data ?? {}) };
    const nextData =
      isSalesDocumentObjectKey(objectKey)
        ? normalizeSalesDocumentRecordData(objectKey, mergedData, await this.listRecordsForValidation(context, "currencies"))
        : objectKey === "contacts"
          ? normalizeContactCustomerLevelData(mergedData)
          : mergedData;
    const fields = await this.listFieldDefinitions(context, objectKey);
    if (isSalesDocumentObjectKey(objectKey)) {
      validateSalesDocumentRecordData(objectKey, nextData, await this.listRecordsForValidation(context, "products"));
    }
    validateRecordPayload(fields, nextData, await this.listRecordsForUniqueValidation(context, objectKey, fields, nextData, recordId), recordId);
    await this.assertRecordReferences(context, fields, nextData, true);
    return { nextData, fields };
  }

  private async resolveEffectivePoolLevelForRecord(
    context: RequestContext,
    record: Pick<CrmRecord, "id" | "objectKey" | "data">
  ): Promise<CrmPoolLevelKey> {
    return (await this.resolveEffectivePoolLevelsForRecords(context, [record])).get(record.id) ?? "unrated";
  }

  private async resolveEffectivePoolLevelsForRecords(
    context: RequestContext,
    records: Array<Pick<CrmRecord, "id" | "objectKey" | "data">>
  ): Promise<Map<string, CrmPoolLevelKey>> {
    const companyIds = Array.from(
      new Set(
        records
          .filter((record) => record.objectKey === "contacts")
          .map((record) => (typeof record.data.companyId === "string" ? record.data.companyId.trim() : ""))
          .filter(Boolean)
      )
    );
    const companies = companyIds.length
      ? await this.db.crmRecord.findMany({
          where: { workspaceId: context.workspaceId, objectKey: "companies", id: { in: companyIds } },
          select: { id: true, data: true }
        })
      : [];
    const companyLevels = new Map(
      companies.map((company) => [
        company.id,
        getCrmPoolLevelFromRecord({ data: isJsonRecord(company.data) ? company.data : {} })
      ])
    );
    return new Map(
      records.map((record) => {
        if (record.objectKey === "contacts") {
          const companyId = typeof record.data.companyId === "string" ? record.data.companyId.trim() : "";
          return [record.id, companyId ? companyLevels.get(companyId) ?? "unrated" : getContactTempCustomerLevel(record)];
        }
        return [record.id, getCrmPoolLevelFromRecord(record)];
      })
    );
  }

  async claimRecord(context: RequestContext, objectKey: string, recordId: string): Promise<RecordPoolActionResult> {
    requirePermission(context, "crm.write");
    await this.assertPoolObjectEnabled(context, objectKey);
    const current = await this.getRecord(context, objectKey, recordId);
    if (current.ownerId) {
      throw new Error("该记录已在私海中，不能重复领取");
    }
    const settings = await this.ensureCrmPoolSettings(context.workspaceId);
    const customerLevel = await this.resolveEffectivePoolLevelForRecord(context, current);
    const levelPrivateLimit = getEffectivePoolLevelPrivateLimit(settings, customerLevel);
    const privateCount = await this.db.crmRecord.count({
      where: {
        workspaceId: context.workspaceId,
        objectKey: { in: settings.objectKeys },
        ownerId: context.user.id
      }
    });
    if (privateCount >= settings.privateLimit) {
      throw new Error(`你的私海已达到上限 ${settings.privateLimit} 条，请先释放或转移记录`);
    }
    const privateRecordsForLevelCheck = await this.db.crmRecord.findMany({
      where: {
        workspaceId: context.workspaceId,
        objectKey: { in: settings.objectKeys },
        ownerId: context.user.id
      },
      select: { id: true, objectKey: true, data: true }
    });
    const privateRecordLevels = await this.resolveEffectivePoolLevelsForRecords(
      context,
      privateRecordsForLevelCheck.map((record) => ({
        id: record.id,
        objectKey: record.objectKey,
        data: isJsonRecord(record.data) ? record.data : {}
      }))
    );
    const levelPrivateCount = privateRecordsForLevelCheck.filter((record) => privateRecordLevels.get(record.id) === customerLevel).length;
    if (levelPrivateCount >= levelPrivateLimit) {
      const label = customerLevel === "unrated" ? "未评级" : `${customerLevel} 级`;
      throw new Error(`你的${label}客户私海已达到上限 ${levelPrivateLimit} 条，请先释放或转移该等级记录`);
    }
    const updated = await this.db.crmRecord.update({
      where: { id: recordId },
      data: { ownerId: context.user.id }
    });
    await this.writeAuditLog(context, "record.claimed", "record", recordId, {
      objectKey,
      summary: `Claimed ${objectKey} record ${updated.title}`,
      details: { previousOwnerId: current.ownerId, ownerId: updated.ownerId, customerLevel, privateLimit: settings.privateLimit, levelPrivateLimit }
    });
    const mapped = mapRecord(updated);
    this.emitWebhookEvent(context, "record.updated", {
      recordId: mapped.id,
      objectKey,
      title: mapped.title,
      previousOwnerId: current.ownerId,
      ownerId: mapped.ownerId
    });
    return { record: mapped, previousOwnerId: current.ownerId, ownerId: mapped.ownerId };
  }

  async releaseRecord(context: RequestContext, objectKey: string, recordId: string): Promise<RecordPoolActionResult> {
    requirePermission(context, "crm.write");
    await this.assertPoolObjectEnabled(context, objectKey);
    const current = await this.getRecord(context, objectKey, recordId);
    if (!current.ownerId) {
      throw new Error("该记录已经在公海中");
    }
    if (current.ownerId !== context.user.id && !context.role.permissions.includes("crm.pool.manage")) {
      requirePermission(context, "crm.pool.manage");
    }
    const updated = await this.db.crmRecord.update({
      where: { id: recordId },
      data: { ownerId: null }
    });
    await this.writeAuditLog(context, "record.released", "record", recordId, {
      objectKey,
      summary: `Released ${objectKey} record ${updated.title} to public pool`,
      details: { previousOwnerId: current.ownerId, ownerId: null }
    });
    const mapped = mapRecord(updated);
    this.emitWebhookEvent(context, "record.updated", {
      recordId: mapped.id,
      objectKey,
      title: mapped.title,
      previousOwnerId: current.ownerId,
      ownerId: mapped.ownerId
    });
    return { record: mapped, previousOwnerId: current.ownerId, ownerId: mapped.ownerId };
  }

  async transferRecord(context: RequestContext, objectKey: string, recordId: string, ownerId?: string | null): Promise<RecordPoolActionResult> {
    requirePermission(context, "crm.pool.manage");
    await this.assertPoolObjectEnabled(context, objectKey);
    const current = await this.getRecord(context, objectKey, recordId);
    if (ownerId) {
      const user = await this.db.user.findFirst({
        where: { id: ownerId, workspaceId: context.workspaceId, active: true },
        select: { id: true }
      });
      if (!user) {
        throw new Error("鐩爣璐熻矗浜轰笉瀛樺湪鎴栧凡鍋滅敤");
      }
    }
    const updated = await this.db.crmRecord.update({
      where: { id: recordId },
      data: { ownerId: ownerId ?? null }
    });
    await this.writeAuditLog(context, "record.transferred", "record", recordId, {
      objectKey,
      summary: `Transferred ${objectKey} record ${updated.title}`,
      details: { previousOwnerId: current.ownerId, ownerId: updated.ownerId }
    });
    const mapped = mapRecord(updated);
    this.emitWebhookEvent(context, "record.updated", {
      recordId: mapped.id,
      objectKey,
      title: mapped.title,
      previousOwnerId: current.ownerId,
      ownerId: mapped.ownerId
    });
    return { record: mapped, previousOwnerId: current.ownerId, ownerId: mapped.ownerId };
  }

  async runPoolAutoReclaim(context: RequestContext): Promise<RecordPoolAutoReclaimResult> {
    requirePermission(context, "crm.pool.manage");
    const settings = await this.ensureCrmPoolSettings(context.workspaceId);
    const ranAt = new Date();
    if (!settings.enabled || !settings.autoReclaimEnabled) {
      return { scanned: 0, reclaimed: 0, reclaimedRecordIds: [], ranAt: ranAt.toISOString() };
    }
    const records = await this.db.crmRecord.findMany({
      where: {
        workspaceId: context.workspaceId,
        objectKey: { in: settings.objectKeys },
        ownerId: { not: null }
      },
      select: { id: true, objectKey: true, title: true, ownerId: true, data: true, updatedAt: true }
    });
    const reclaimedRecordIds: string[] = [];
    const effectiveLevels = await this.resolveEffectivePoolLevelsForRecords(
      context,
      records.map((record) => ({
        id: record.id,
        objectKey: record.objectKey,
        data: isJsonRecord(record.data) ? record.data : {}
      }))
    );
    for (const record of records) {
      const latestActivity = await this.db.activity.findFirst({
        where: { workspaceId: context.workspaceId, recordId: record.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true }
      });
      const latestThread = await this.db.emailThread.findFirst({
        where: { workspaceId: context.workspaceId, recordId: record.id },
        orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
        select: { lastMessageAt: true, updatedAt: true }
      });
      const latestFollowUpAt = new Date(
        Math.max(
          record.updatedAt.getTime(),
          latestActivity?.createdAt.getTime() ?? 0,
          (latestThread?.lastMessageAt ?? latestThread?.updatedAt)?.getTime() ?? 0
        )
      );
      const customerLevel = effectiveLevels.get(record.id) ?? "unrated";
      const effectiveAutoReclaimDays = getEffectivePoolLevelReclaimDays(settings, customerLevel);
      const cutoff = new Date(ranAt.getTime() - effectiveAutoReclaimDays * 24 * 60 * 60 * 1000);
      if (latestFollowUpAt >= cutoff) {
        continue;
      }
      await this.db.crmRecord.update({ where: { id: record.id }, data: { ownerId: null } });
      reclaimedRecordIds.push(record.id);
      await this.writeAuditLog(context, "record.auto_reclaimed", "record", record.id, {
        objectKey: record.objectKey,
        summary: `Auto reclaimed ${record.objectKey} record ${record.title}`,
        details: {
          previousOwnerId: record.ownerId,
          ownerId: null,
          customerLevel,
          latestFollowUpAt: latestFollowUpAt.toISOString(),
          autoReclaimDays: effectiveAutoReclaimDays,
          globalAutoReclaimDays: settings.autoReclaimDays
        }
      });
      this.emitWebhookEvent(context, "record.updated", {
        recordId: record.id,
        objectKey: record.objectKey,
        title: record.title,
        previousOwnerId: record.ownerId,
        ownerId: undefined
      });
    }
    await this.db.crmPoolSettings.update({
      where: { workspaceId: context.workspaceId },
      data: { lastAutoReclaimAt: ranAt, lastAutoReclaimCount: reclaimedRecordIds.length }
    });
    return { scanned: records.length, reclaimed: reclaimedRecordIds.length, reclaimedRecordIds, ranAt: ranAt.toISOString() };
  }

  async deleteRecord(context: RequestContext, objectKey: string, recordId: string): Promise<void> {
    requirePermission(context, "crm.write");
    const record = await this.getRecord(context, objectKey, recordId);
    await this.db.$transaction(async (tx) => {
      await tx.emailThread.updateMany({
        where: { workspaceId: context.workspaceId, recordId },
        data: { recordId: null }
      });
      await tx.talkMessage.deleteMany({
        where: { workspaceId: context.workspaceId, targetType: "record", objectKey, recordId }
      });
      await tx.activity.deleteMany({ where: { workspaceId: context.workspaceId, recordId } });
      await tx.smartReminder.deleteMany({
        where: {
          workspaceId: context.workspaceId,
          OR: [
            { recordId },
            { sources: { array_contains: [{ objectKey, recordId }] } }
          ]
        }
      });
      await tx.crmRecord.delete({ where: { id: recordId, workspaceId: context.workspaceId, objectKey } });
    });
    await this.writeAuditLog(context, "delete", "record", recordId, {
      objectKey,
      summary: `Deleted ${objectKey} record ${record.title}`,
      details: { title: record.title }
    });
    this.emitWebhookEvent(context, "record.deleted", {
      recordId,
      objectKey,
      title: record.title
    });
  }

  async listRecordChangeRequests(context: RequestContext, status: RecordChangeRequest["status"] | "all" = "pending"): Promise<RecordChangeRequest[]> {
    requirePermission(context, "crm.read");
    const canViewAllRequests = canManageAllRecords(context);
    const requests = await this.db.recordChangeRequest.findMany({
      where: {
        workspaceId: context.workspaceId,
        ...(status === "all" ? {} : { status }),
        ...(canViewAllRequests ? {} : { requestedById: context.user.id })
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    return requests.map(mapRecordChangeRequest);
  }

  async requestRecordUpdate(
    context: RequestContext,
    objectKey: string,
    recordId: string,
    patch: RecordChangeRequest["patch"],
    reason: string
  ): Promise<RecordChangeRequest | CrmRecord> {
    requirePermission(context, "crm.write");
    if (!requiresEditApproval(objectKey)) {
      throw new Error("This object does not require update approval");
    }
    const cleanedReason = reason.trim();
    if (cleanedReason.length < 1) {
      throw new Error("请填写修改原因");
    }
    const current = await this.getRecord(context, objectKey, recordId);
    await this.validateRecordPatch(context, objectKey, recordId, current, stripRecordApprovalMetadata(patch));
    const request = await this.db.recordChangeRequest.create({
      data: {
        workspaceId: context.workspaceId,
        objectKey,
        recordId,
        action: "update",
        status: "pending",
        reason: cleanedReason,
        requestedById: context.user.id,
        patch: toJsonObject(patch),
        recordTitle: current.title
      }
    });
    await this.writeAuditLog(context, "record.change_requested", "record_change_request", request.id, {
      objectKey,
      summary: `Requested update approval for ${objectKey} record ${current.title}`,
      details: { recordId, action: "update", reason: cleanedReason }
    });
    return mapRecordChangeRequest(request);
  }

  async requestRecordDelete(context: RequestContext, objectKey: string, recordId: string, reason: string): Promise<RecordChangeRequest> {
    requirePermission(context, "crm.write");
    if (!requiresDeleteApproval(objectKey)) {
      throw new Error("This object does not require delete approval");
    }
    const cleanedReason = reason.trim();
    if (cleanedReason.length < 1) {
      throw new Error("请填写删除原因");
    }
    const current = await this.getRecord(context, objectKey, recordId);
    const request = await this.db.recordChangeRequest.create({
      data: {
        workspaceId: context.workspaceId,
        objectKey,
        recordId,
        action: "delete",
        status: "pending",
        reason: cleanedReason,
        requestedById: context.user.id,
        recordTitle: current.title
      }
    });
    await this.writeAuditLog(context, "record.change_requested", "record_change_request", request.id, {
      objectKey,
      summary: `Requested delete approval for ${objectKey} record ${current.title}`,
      details: { recordId, action: "delete", reason: cleanedReason }
    });
    return mapRecordChangeRequest(request);
  }

  async requestActivityDelete(context: RequestContext, activityId: string, reason: string): Promise<RecordChangeRequest> {
    requirePermission(context, "crm.write");
    const cleanedReason = reason.trim();
    if (cleanedReason.length < 1) {
      throw new Error("请填写删除原因");
    }
    const activity = await this.getActivity(context, activityId);
    const existingRequest = await this.db.recordChangeRequest.findFirst({
      where: {
        workspaceId: context.workspaceId,
        objectKey: "activities",
        recordId: activity.id,
        action: "delete",
        status: "pending"
      }
    });
    if (existingRequest) {
      return mapRecordChangeRequest(existingRequest);
    }
    const request = await this.db.recordChangeRequest.create({
      data: {
        workspaceId: context.workspaceId,
        objectKey: "activities",
        recordId: activity.id,
        action: "delete",
        status: "pending",
        reason: cleanedReason,
        requestedById: context.user.id,
        recordTitle: activity.title,
        patch: toJsonObject({
          activity: {
            recordId: activity.recordId,
            type: activity.type,
            title: activity.title,
            body: activity.body,
            tags: activity.tags,
            tagColors: activity.tagColors,
            dueAt: activity.dueAt,
            completedAt: activity.completedAt,
            archivedAt: activity.archivedAt,
            createdAt: activity.createdAt
          }
        })
      }
    });
    await this.writeAuditLog(context, "record.change_requested", "record_change_request", request.id, {
      objectKey: "activities",
      summary: `Requested delete approval for activity ${activity.title}`,
      details: { activityId: activity.id, action: "delete", reason: cleanedReason, type: activity.type, recordId: activity.recordId }
    });
    return mapRecordChangeRequest(request);
  }

  async cancelRecordChangeRequest(context: RequestContext, requestId: string): Promise<RecordChangeRequest> {
    requirePermission(context, "crm.write");
    const request = await this.db.recordChangeRequest.findFirst({
      where: { id: requestId, workspaceId: context.workspaceId }
    });
    if (!request) {
      throw new Error("审批申请不存在");
    }
    if (request.status !== "pending") {
      throw new Error("瀹℃壒鐢宠宸茬粡澶勭悊");
    }
    const canCancel = canManageAllRecords(context) || request.requestedById === context.user.id;
    if (!canCancel) {
      throw new Error("只能取消自己提交的审批申请");
    }
    const cancelled = await this.db.recordChangeRequest.update({
      where: { id: requestId },
      data: {
        status: "cancelled",
        reviewedById: context.user.id,
        reviewNote: "Cancelled by requester",
        reviewedAt: new Date()
      }
    });
    await this.writeAuditLog(context, "record.change_cancelled", "record_change_request", request.id, {
      objectKey: request.objectKey,
      summary: `Cancelled ${request.action} request for ${request.objectKey} record ${request.recordTitle}`,
      details: { recordId: request.recordId, action: request.action }
    });
    return mapRecordChangeRequest(cancelled);
  }

  async reviewRecordChangeRequest(
    context: RequestContext,
    requestId: string,
    input: { decision: "approve" | "reject"; reviewNote?: string }
  ): Promise<RecordChangeRequest> {
    requirePermission(context, "crm.admin");
    const request = await this.db.recordChangeRequest.findFirst({
      where: { id: requestId, workspaceId: context.workspaceId }
    });
    if (!request) {
      throw new Error("审批申请不存在");
    }
    if (request.status !== "pending") {
      throw new Error("瀹℃壒鐢宠宸茬粡澶勭悊");
    }
    const reviewedAt = new Date();
    if (input.decision === "reject") {
      const rejected = await this.db.recordChangeRequest.update({
        where: { id: requestId },
        data: {
          status: "rejected",
          reviewedById: context.user.id,
          reviewNote: input.reviewNote?.trim() || undefined,
          reviewedAt
        }
      });
      await this.writeAuditLog(context, "record.change_rejected", "record_change_request", request.id, {
        objectKey: request.objectKey,
        summary: `Rejected ${request.action} request for ${request.objectKey} record ${request.recordTitle}`,
        details: { recordId: request.recordId, action: request.action, reviewNote: input.reviewNote }
      });
      return mapRecordChangeRequest(rejected);
    }

    if (request.action === "update") {
      await this.updateRecord(context, request.objectKey, request.recordId, await this.buildApprovedRecordPatch(request));
      const customerLevelPatch = extractCustomerLevelPatch(request.patch);
      if (customerLevelPatch) {
        await this.writeAuditLog(context, "customer_level.changed", "record", request.recordId, {
          objectKey: request.objectKey,
          summary: `Changed customer level for ${request.recordTitle}`,
          details: customerLevelPatch
        });
      }
    } else if (request.action === "delete" && request.objectKey === "activities") {
      await this.deleteActivity(context, request.recordId);
    } else if (request.action === "delete" && request.objectKey === "smart_reminders") {
      await this.deleteSmartReminder(context, request.recordId);
    } else if (request.action === "delete") {
      await this.deleteRecord(context, request.objectKey, request.recordId);
    } else {
      throw new Error("Unsupported change request action");
    }

    const approved = await this.db.recordChangeRequest.update({
      where: { id: requestId },
      data: {
        status: "approved",
        reviewedById: context.user.id,
        reviewNote: input.reviewNote?.trim() || undefined,
        reviewedAt
      }
    });
    await this.writeAuditLog(context, "record.change_approved", "record_change_request", request.id, {
      objectKey: request.objectKey,
      summary: `Approved ${request.action} request for ${request.objectKey} record ${request.recordTitle}`,
      details: { recordId: request.recordId, action: request.action, reviewNote: input.reviewNote }
    });
    return mapRecordChangeRequest(approved);
  }

  private async buildApprovedRecordPatch(request: {
    workspaceId: string;
    objectKey: string;
    recordId: string;
    patch: Prisma.JsonValue | null;
  }): Promise<Partial<Pick<CrmRecord, "title" | "data" | "stageKey" | "ownerId" | "tags" | "tagColors">>> {
    const patch = stripRecordApprovalMetadata((request.patch ?? {}) as RecordChangeRequest["patch"]);
    if (request.objectKey !== "contacts" || !isJsonRecord(patch.data) || !Object.prototype.hasOwnProperty.call(patch.data, "contactMethods")) {
      return patch;
    }
    const previousPatch = previousRecordApprovalPatch((request.patch ?? {}) as RecordChangeRequest["patch"]);
    const previousData = isJsonRecord(previousPatch.data) ? previousPatch.data : {};
    const nextContactMethods = patch.data.contactMethods;
    const previousContactMethods = previousData.contactMethods;
    const current = await this.db.crmRecord.findFirst({
      where: { workspaceId: request.workspaceId, objectKey: request.objectKey, id: request.recordId },
      select: { data: true }
    });
    const currentData = isJsonRecord(current?.data) ? current.data : {};
    const shouldMergeContactMethods =
      isContactMethodsAdditionOnly(previousContactMethods, nextContactMethods) ||
      canMergeApprovedContactMethodPatch(currentData.contactMethods, nextContactMethods);
    if (!shouldMergeContactMethods) {
      return patch;
    }
    return {
      ...patch,
      data: {
        ...patch.data,
        contactMethods: mergeContactMethodsForApproval(currentData.contactMethods, nextContactMethods)
      }
    };
  }

  async listPipelines(context: RequestContext): Promise<Pipeline[]> {
    requirePermission(context, "crm.read");
    const pipelines = await this.db.pipeline.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }]
    });
    return pipelines.map(mapPipeline);
  }

  async createPipeline(context: RequestContext, input: Omit<Pipeline, "id" | "workspaceId">): Promise<Pipeline> {
    requirePermission(context, "crm.admin");
    await this.requireObject(context, input.objectKey);
    const created = await this.db.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.pipeline.updateMany({
          where: { workspaceId: context.workspaceId, objectKey: input.objectKey },
          data: { isDefault: false }
        });
      }
      return tx.pipeline.create({
        data: {
          workspaceId: context.workspaceId,
          objectKey: input.objectKey,
          name: input.name,
          isDefault: input.isDefault,
          stages: (input.stages as unknown) as Prisma.InputJsonValue
        }
      });
    });
    await this.writeAuditLog(context, "create", "pipeline", created.id, {
      objectKey: created.objectKey,
      summary: `Created pipeline ${created.name}`,
      details: { objectKey: created.objectKey, isDefault: created.isDefault, stages: asStages(created.stages).map((stage) => stage.key) }
    });
    return mapPipeline(created);
  }

  async updatePipeline(
    context: RequestContext,
    id: string,
    patch: Partial<Omit<Pipeline, "id" | "workspaceId">>
  ): Promise<Pipeline> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.pipeline.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== context.workspaceId) {
      throw new Error("Pipeline not found");
    }

    const objectKey = patch.objectKey ?? existing.objectKey;
    await this.requireObject(context, objectKey);
    const currentPipeline = mapPipeline(existing);
    const nextPipeline: Pipeline = {
      ...currentPipeline,
      ...patch,
      objectKey,
      stages: patch.stages ?? currentPipeline.stages
    };
    await this.assertPipelineChangeSafe(context, currentPipeline, nextPipeline);
    const updated = await this.db.$transaction(async (tx) => {
      if (patch.isDefault) {
        await tx.pipeline.updateMany({
          where: { workspaceId: context.workspaceId, objectKey },
          data: { isDefault: false }
        });
      }
      return tx.pipeline.update({
        where: { id },
        data: {
          objectKey: patch.objectKey,
          name: patch.name,
          isDefault: patch.isDefault,
          stages: patch.stages ? ((patch.stages as unknown) as Prisma.InputJsonValue) : undefined
        }
      });
    });

    await this.writeAuditLog(context, "update", "pipeline", id, {
      objectKey,
      summary: `Updated pipeline ${updated.name}`,
      details: { patch }
    });

    return mapPipeline(updated);
  }

  async deletePipeline(context: RequestContext, id: string): Promise<void> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.pipeline.findUnique({
      where: { id }
    });
    if (!existing || existing.workspaceId !== context.workspaceId) {
      throw new Error("Pipeline not found");
    }
    await this.assertPipelineCanBeDeleted(context, mapPipeline(existing));
    await this.db.pipeline.delete({ where: { id } });
    await this.writeAuditLog(context, "delete", "pipeline", id, {
      objectKey: existing.objectKey,
      summary: `Deleted pipeline ${existing.name}`,
      details: { name: existing.name }
    });
  }

  async listActivities(context: RequestContext, input: string | ActivityListQuery = {}): Promise<Activity[]> {
    requirePermission(context, "crm.read");
    const query = typeof input === "string" ? { recordId: input } : input;
    const recordId = query.recordId;
    if (recordId) {
      const record = await this.db.crmRecord.findFirst({
        where: {
          id: recordId,
          workspaceId: context.workspaceId,
          ...(await this.recordAccessWhere(context))
        },
        select: { id: true }
      });
      if (!record) {
        return [];
      }
    }

    const visibleRecordIds = await this.visibleRecordIds(context);
    const dueFrom = query.dueFrom ? new Date(query.dueFrom) : undefined;
    const dueTo = query.dueTo ? new Date(query.dueTo) : undefined;
    const activities = await this.db.activity.findMany({
      where: {
        workspaceId: context.workspaceId,
        ...(query.type ? { type: query.type } : {}),
        ...(query.completed === true ? { completedAt: { not: null } } : query.completed === false ? { completedAt: null } : {}),
        ...(query.archived === true ? { archivedAt: { not: null } } : query.archived === false ? { archivedAt: null } : {}),
        ...(query.tags?.length ? { tags: { hasEvery: uniqueTags(query.tags) } } : {}),
        ...(dueFrom || dueTo
          ? {
              dueAt: {
                ...(dueFrom ? { gte: dueFrom } : {}),
                ...(dueTo ? { lte: dueTo } : {})
              }
            }
          : {}),
        ...(recordId
          ? { recordId }
          : {
              OR: [
                { recordId: { in: visibleRecordIds } },
                ...(canManageAllRecords(context) ? [{ recordId: null }] : [{ recordId: null, actorId: context.user.id }])
              ]
            })
      },
      orderBy: { createdAt: "desc" }
    });
    return activities.map(mapActivity);
  }

  async getActivity(context: RequestContext, activityId: string): Promise<Activity> {
    requirePermission(context, "crm.read");
    const activity = await this.db.activity.findFirst({
      where: {
        id: activityId,
        ...(await this.visibleActivityWhere(context))
      }
    });
    if (!activity) {
      throw new Error("Activity not found");
    }
    return mapActivity(activity);
  }

  async createActivity(context: RequestContext, input: Omit<Activity, "id" | "workspaceId" | "createdAt" | "actorId" | "tags" | "tagColors"> & { tags?: string[]; tagColors?: Record<string, string> }): Promise<Activity> {
    requirePermission(context, "crm.write");
    if (input.recordId) {
      const record = await this.db.crmRecord.findFirst({
        where: {
          id: input.recordId,
          workspaceId: context.workspaceId,
          ...(await this.recordAccessWhere(context))
        },
        select: { id: true }
      });
      if (!record) {
        throw new Error("Record not found");
      }
    }
    const tags = uniqueTags(input.tags ?? []);
    const created = await this.db.activity.create({
      data: {
        workspaceId: context.workspaceId,
        recordId: input.recordId,
        type: input.type,
        title: input.title,
        body: input.body,
        tags,
        tagColors: normalizeTagColors(input.tagColors ?? {}, tags) as Prisma.InputJsonValue,
        actorId: context.user.id,
        dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
        completedAt: input.completedAt ? new Date(input.completedAt) : undefined
      }
    });
    await this.writeAuditLog(context, "create", "activity", created.id, {
      summary: `Created ${created.type} activity ${created.title}`,
      details: { recordId: created.recordId, type: created.type, title: created.title, tags: created.tags }
    });
    const mapped = mapActivity(created);
    this.emitWebhookEvent(context, "activity.created", {
      activityId: mapped.id,
      recordId: mapped.recordId,
      type: mapped.type,
      title: mapped.title,
      tags: mapped.tags
    });
    return mapped;
  }

  async updateActivity(
    context: RequestContext,
    activityId: string,
    patch: Partial<Pick<Activity, "title" | "body" | "tags" | "tagColors">> & { dueAt?: string | null; completedAt?: string | null; archivedAt?: string | null }
  ): Promise<Activity> {
    requirePermission(context, "crm.write");
    const existing = await this.db.activity.findFirst({
      where: { id: activityId, workspaceId: context.workspaceId }
    });
    if (!existing) {
      throw new Error("Activity not found");
    }
    if (existing.recordId) {
      const record = await this.db.crmRecord.findFirst({
        where: {
          id: existing.recordId,
          workspaceId: context.workspaceId,
          ...(await this.recordAccessWhere(context))
        },
        select: { id: true }
      });
      if (!record) {
        throw new Error("Activity not found");
      }
    } else if (!canManageAllRecords(context) && existing.actorId !== context.user.id) {
      throw new Error("Activity not found");
    }

    const nextTags = patch.tags !== undefined ? uniqueTags(patch.tags) : existing.tags;
    const nextTagColors = normalizeTagColors(patch.tagColors ?? asRecord(existing.tagColors), nextTags);
    const updated = await this.db.activity.update({
      where: { id: activityId },
      data: {
        title: patch.title,
        body: patch.body,
        tags: patch.tags !== undefined ? nextTags : undefined,
        tagColors: patch.tags !== undefined || patch.tagColors !== undefined ? (nextTagColors as Prisma.InputJsonValue) : undefined,
        dueAt: patch.dueAt ? new Date(patch.dueAt) : patch.dueAt === null ? null : undefined,
        completedAt: patch.completedAt ? new Date(patch.completedAt) : patch.completedAt === null ? null : undefined,
        archivedAt: patch.archivedAt ? new Date(patch.archivedAt) : patch.archivedAt === null ? null : undefined
      }
    });
    await this.writeAuditLog(context, "update", "activity", updated.id, {
      summary: `Updated activity ${updated.title}`,
      details: { patch, recordId: updated.recordId, type: updated.type }
    });
    return mapActivity(updated);
  }

  async deleteActivity(context: RequestContext, activityId: string): Promise<void> {
    requirePermission(context, "crm.write");
    const existing = await this.db.activity.findFirst({
      where: { id: activityId, workspaceId: context.workspaceId }
    });
    if (!existing) {
      throw new Error("Activity not found");
    }
    if (existing.recordId) {
      const record = await this.db.crmRecord.findFirst({
        where: {
          id: existing.recordId,
          workspaceId: context.workspaceId,
          ...(await this.recordAccessWhere(context))
        },
        select: { id: true }
      });
      if (!record) {
        throw new Error("Activity not found");
      }
    } else if (!canManageAllRecords(context) && existing.actorId !== context.user.id) {
      throw new Error("Activity not found");
    }

    await this.db.activity.delete({ where: { id: activityId } });
    await this.writeAuditLog(context, "delete", "activity", existing.id, {
      summary: `Deleted activity ${existing.title}`,
      details: { recordId: existing.recordId, type: existing.type, title: existing.title }
    });
  }

  async listSavedViews(context: RequestContext, objectKey?: string): Promise<SavedView[]> {
    requirePermission(context, "crm.read");
    const views = await this.db.savedView.findMany({
      where: {
        workspaceId: context.workspaceId,
        ...(objectKey ? { objectDefinition: { key: objectKey } } : {})
      },
      include: { objectDefinition: { select: { key: true } } },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }]
    });

    return views.map(mapSavedView);
  }

  async createSavedView(context: RequestContext, input: Omit<SavedView, "id" | "workspaceId">): Promise<SavedView> {
    requirePermission(context, "crm.admin");
    const object = await this.requireObject(context, input.objectKey);
    await this.assertSavedViewFields(context, input);
    const created = await this.db.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.savedView.updateMany({
          where: { workspaceId: context.workspaceId, objectDefinitionId: object.id },
          data: { isDefault: false }
        });
      }
      return tx.savedView.create({
        data: {
          workspaceId: context.workspaceId,
          objectDefinitionId: object.id,
          name: input.name,
          columns: input.columns,
          filters: input.filters as Prisma.InputJsonValue | undefined,
          sort: input.sort as Prisma.InputJsonValue | undefined,
          isDefault: input.isDefault
        },
        include: { objectDefinition: { select: { key: true } } }
      });
    });
    await this.writeAuditLog(context, "create", "saved_view", created.id, {
      objectKey: input.objectKey,
      summary: `Created saved view ${created.name}`,
      details: { columns: created.columns, filters: created.filters, sort: created.sort, isDefault: created.isDefault }
    });
    return mapSavedView(created);
  }

  async updateSavedView(
    context: RequestContext,
    id: string,
    patch: Partial<Omit<SavedView, "id" | "workspaceId">>
  ): Promise<SavedView> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.savedView.findUnique({
      where: { id },
      include: { objectDefinition: { select: { id: true, key: true } } }
    });
    if (!existing || existing.workspaceId !== context.workspaceId) {
      throw new Error("Saved view not found");
    }

    const object =
      patch.objectKey && patch.objectKey !== existing.objectDefinition.key
        ? await this.requireObject(context, patch.objectKey)
        : existing.objectDefinition;
    await this.assertSavedViewFields(context, {
      objectKey: object.key,
      columns: patch.columns ?? existing.columns,
      filters: patch.filters ?? (((existing.filters as unknown) as SavedView["filters"]) ?? undefined),
      sort: patch.sort ?? (((existing.sort as unknown) as SavedView["sort"]) ?? undefined)
    });

    const updated = await this.db.$transaction(async (tx) => {
      if (patch.isDefault) {
        await tx.savedView.updateMany({
          where: { workspaceId: context.workspaceId, objectDefinitionId: object.id },
          data: { isDefault: false }
        });
      }
      return tx.savedView.update({
        where: { id },
        data: {
          objectDefinitionId: object.id,
          name: patch.name,
          columns: patch.columns,
          filters: patch.filters as Prisma.InputJsonValue | undefined,
          sort: patch.sort as Prisma.InputJsonValue | undefined,
          isDefault: patch.isDefault
        },
        include: { objectDefinition: { select: { key: true } } }
      });
    });

    await this.writeAuditLog(context, "update", "saved_view", id, {
      objectKey: object.key,
      summary: `Updated saved view ${updated.name}`,
      details: { patch }
    });

    return mapSavedView(updated);
  }

  async deleteSavedView(context: RequestContext, id: string): Promise<void> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.savedView.findUnique({
      where: { id },
      include: { objectDefinition: { select: { key: true } } }
    });
    if (!existing || existing.workspaceId !== context.workspaceId) {
      throw new Error("Saved view not found");
    }
    await this.db.savedView.delete({ where: { id } });
    await this.writeAuditLog(context, "delete", "saved_view", id, {
      objectKey: existing.objectDefinition.key,
      summary: `Deleted saved view ${existing.name}`,
      details: { name: existing.name }
    });
  }

  async importCsv(
    context: RequestContext,
    objectKey: string,
    csv: string,
    strategy: CsvImportStrategy = "skip-invalid",
    mapping?: CsvImportMapping
  ): Promise<CsvImportResult> {
    requirePermission(context, "crm.import");
    const preview = await this.previewCsvImport(context, objectKey, csv, mapping);
    const created: CrmRecord[] = [];
    const updated: CrmRecord[] = [];
    const fields = await this.listFieldDefinitions(context, objectKey);
    const errors: string[] = [];
    const aborted = strategy === "all-or-nothing" && (preview.errorRows > 0 || preview.conflictRows > 0);

    if (!aborted) {
      for (const row of preview.rows) {
        if (row.status === "ready") {
          const data = coerceRow(row.values, fields);
          created.push(await this.createRecord(context, objectKey, { title: row.title, tags: parseTagsCell(row.values.tags), data }));
          continue;
        }

        if (row.status === "conflict" && strategy === "update-existing") {
          const existingRecordId = getSingleConflictRecordId(row.conflicts);
          if (existingRecordId) {
            const data = coerceRow(row.values, fields);
            updated.push(await this.updateRecord(context, objectKey, existingRecordId, { title: row.title, tags: parseTagsCell(row.values.tags), data }));
            continue;
          }
        }

        errors.push(...formatCsvImportRowIssues(row));
      }
    } else {
      errors.push(...preview.errors);
    }

    await this.writeAuditLog(context, "import", "csv_import", undefined, {
      objectKey,
      summary: `Imported CSV into ${objectKey}: ${created.length} created, ${updated.length} updated, ${errors.length} failed${aborted ? " (aborted)" : ""}`,
      details: { totalRows: preview.totalRows, created: created.length, updated: updated.length, errors: errors.length, conflicts: preview.conflictRows, strategy, aborted }
    });

    return { created, updated, errors, strategy, aborted, preview };
  }

  async listImportJobs(context: RequestContext, objectKey?: string): Promise<CsvImportJob[]> {
    requirePermission(context, "crm.import");
    const jobs = await this.db.importJob.findMany({
      where: {
        workspaceId: context.workspaceId,
        ...(objectKey ? { objectKey } : {})
      },
      orderBy: { createdAt: "desc" },
      take: 50
    });
    return jobs.map(mapImportJob);
  }

  async getImportJob(context: RequestContext, jobId: string): Promise<CsvImportJob> {
    requirePermission(context, "crm.import");
    const job = await this.db.importJob.findFirst({ where: { id: jobId, workspaceId: context.workspaceId } });
    if (!job) {
      throw new Error("Import job not found");
    }
    return mapImportJob(job);
  }

  async exportImportJobIssuesCsv(context: RequestContext, jobId: string): Promise<string> {
    return buildCsvImportIssuesCsv(await this.getImportJob(context, jobId));
  }

  async listImportPresets(context: RequestContext, objectKey?: string): Promise<ImportPreset[]> {
    requirePermission(context, "crm.import");
    const presets = await this.db.importPreset.findMany({
      where: {
        workspaceId: context.workspaceId,
        ...(objectKey ? { objectKey } : {})
      },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }]
    });
    return presets.map(mapImportPreset);
  }

  async createImportPreset(
    context: RequestContext,
    input: { objectKey: string; name: string; strategy?: CsvImportStrategy; mapping?: CsvImportMapping }
  ): Promise<ImportPreset> {
    requirePermission(context, "crm.import");
    await this.requireObject(context, input.objectKey);
    const fields = await this.listFieldDefinitions(context, input.objectKey);
    const mapping = normalizeCsvImportMapping(input.mapping);
    assertCsvImportMappingTargets(fields, mapping);
    const name = normalizeImportPresetName(input.name);
    const strategy = input.strategy ?? "skip-invalid";
    const created = await this.db.importPreset.create({
      data: {
        workspaceId: context.workspaceId,
        objectKey: input.objectKey,
        name,
        strategy,
        mapping: mapping as Prisma.InputJsonValue | undefined,
        createdById: context.user.id
      }
    });
    await this.writeAuditLog(context, "import", "import_preset", created.id, {
      objectKey: created.objectKey,
      summary: `Created import preset ${created.name} for ${created.objectKey}`,
      details: { strategy: created.strategy, mapping: mapping ?? {} }
    });
    return mapImportPreset(created);
  }

  async updateImportPreset(
    context: RequestContext,
    id: string,
    patch: Partial<Pick<ImportPreset, "name" | "strategy" | "mapping">>
  ): Promise<ImportPreset> {
    requirePermission(context, "crm.import");
    const existing = await this.db.importPreset.findFirst({ where: { id, workspaceId: context.workspaceId } });
    if (!existing) {
      throw new Error("Import preset not found");
    }
    const fields = await this.listFieldDefinitions(context, existing.objectKey);
    const mapping = patch.mapping === undefined ? normalizeCsvImportMapping((existing.mapping as CsvImportMapping | undefined) ?? undefined) : normalizeCsvImportMapping(patch.mapping);
    assertCsvImportMappingTargets(fields, mapping);
    const name = patch.name === undefined ? existing.name : normalizeImportPresetName(patch.name);
    const duplicate = await this.db.importPreset.findFirst({
      where: {
        workspaceId: context.workspaceId,
        objectKey: existing.objectKey,
        name,
        NOT: { id }
      },
      select: { id: true }
    });
    if (duplicate) {
      throw new Error(`Import preset ${name} already exists for ${existing.objectKey}`);
    }

    const updated = await this.db.importPreset.update({
      where: { id },
      data: {
        name,
        strategy: patch.strategy ?? existing.strategy,
        mapping: patch.mapping === undefined ? undefined : ((mapping ?? Prisma.JsonNull) as Prisma.InputJsonValue)
      }
    });
    await this.writeAuditLog(context, "import", "import_preset", updated.id, {
      objectKey: updated.objectKey,
      summary: `Updated import preset ${updated.name} for ${updated.objectKey}`,
      details: { strategy: updated.strategy, mapping: mapping ?? {} }
    });
    return mapImportPreset(updated);
  }

  async deleteImportPreset(context: RequestContext, id: string): Promise<void> {
    requirePermission(context, "crm.import");
    const preset = await this.db.importPreset.findFirst({ where: { id, workspaceId: context.workspaceId } });
    if (!preset) {
      throw new Error("Import preset not found");
    }
    await this.db.importPreset.delete({ where: { id } });
    await this.writeAuditLog(context, "delete", "import_preset", id, {
      objectKey: preset.objectKey,
      summary: `Deleted import preset ${preset.name} for ${preset.objectKey}`,
      details: { name: preset.name, strategy: preset.strategy }
    });
  }

  async getImportJobQueueSummary(context: RequestContext): Promise<ImportJobQueueSummary> {
    requirePermission(context, "crm.admin");
    const [statusCounts, recentJobs, recentFailures, deadLettered] = await Promise.all([
      this.db.importJob.groupBy({
        by: ["status"],
        where: { workspaceId: context.workspaceId },
        _count: { _all: true }
      }),
      this.db.importJob.findMany({
        where: { workspaceId: context.workspaceId },
        orderBy: { createdAt: "desc" },
        take: 10
      }),
      this.db.importJob.findMany({
        where: { workspaceId: context.workspaceId, status: "failed" },
        orderBy: { completedAt: "desc" },
        take: 5
      }),
      this.db.auditLog.count({
        where: {
          workspaceId: context.workspaceId,
          action: "import",
          entityType: "import_job",
          summary: { contains: "dead letter", mode: "insensitive" }
        }
      })
    ]);
    const counts = Object.fromEntries(statusCounts.map((item) => [item.status, item._count._all]));
    const mappedRecentJobs = recentJobs.map(mapImportJob);
    return {
      total: statusCounts.reduce((sum, item) => sum + item._count._all, 0),
      queued: counts.queued ?? 0,
      processing: counts.processing ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      cancelled: counts.cancelled ?? 0,
      deadLettered,
      lastUpdatedAt: mappedRecentJobs[0]?.createdAt,
      recentJobs: mappedRecentJobs,
      recentFailures: recentFailures.map(mapImportJob)
    };
  }

  async createCsvImportJob(
    context: RequestContext,
    input: { objectKey: string; csv: string; strategy?: CsvImportStrategy; mapping?: CsvImportMapping; presetId?: string; presetName?: string }
  ): Promise<CsvImportJob> {
    const job = await this.createQueuedCsvImportJob(context, input);
    return this.runCsvImportJob(context, job.id, input);
  }

  async createQueuedCsvImportJob(
    context: RequestContext,
    input: { objectKey: string; csv: string; strategy?: CsvImportStrategy; mapping?: CsvImportMapping; presetId?: string; presetName?: string }
  ): Promise<CsvImportJob> {
    requirePermission(context, "crm.import");
    const strategy = input.strategy ?? "skip-invalid";
    await this.requireObject(context, input.objectKey);
    const mapping = normalizeCsvImportMapping(input.mapping);
    const sourcePayload: CsvImportJobSourcePayload = {
      objectKey: input.objectKey,
      csv: input.csv,
      strategy,
      ...(mapping ? { mapping } : {}),
      ...(input.presetId ? { presetId: input.presetId } : {}),
      ...(input.presetName ? { presetName: input.presetName } : {})
    };
    const job = await this.db.importJob.create({
      data: {
        workspaceId: context.workspaceId,
        objectKey: input.objectKey,
        status: "queued",
        strategy,
        sourcePayload: sourcePayload as unknown as Prisma.InputJsonValue,
        requestedById: context.user.id
      }
    });

    return mapImportJob(job);
  }

  async cancelCsvImportJob(context: RequestContext, jobId: string): Promise<CsvImportJob> {
    requirePermission(context, "crm.import");
    const job = await this.db.importJob.findFirst({ where: { id: jobId, workspaceId: context.workspaceId } });
    if (!job) {
      throw new Error("Import job not found");
    }
    if (job.status !== "queued") {
      throw new Error("Only queued import jobs can be cancelled");
    }

    const updated = await this.db.importJob.update({
      where: { id: jobId },
      data: {
        status: "cancelled",
        completedAt: new Date()
      }
    });
    await this.writeAuditLog(context, "import", "import_job", updated.id, {
      objectKey: updated.objectKey,
      summary: `Cancelled CSV import job for ${updated.objectKey}`,
      details: { previousStatus: job.status }
    });
    return mapImportJob(updated);
  }

  async createRetryCsvImportJob(
    context: RequestContext,
    jobId: string
  ): Promise<{ job: CsvImportJob; payload: CsvImportJobSourcePayload }> {
    return this.createCopiedImportJob(context, jobId, ["failed", "cancelled"]);
  }

  async createRerunCsvImportJob(
    context: RequestContext,
    jobId: string
  ): Promise<{ job: CsvImportJob; payload: CsvImportJobSourcePayload }> {
    return this.createCopiedImportJob(context, jobId, ["completed", "failed", "cancelled"]);
  }

  async markCsvImportJobFailedFromWorker(
    workspaceId: string,
    jobId: string,
    objectKey: string,
    message: string
  ): Promise<CsvImportJob | undefined> {
    const existing = await this.db.importJob.findFirst({ where: { id: jobId, workspaceId } });
    if (!existing || existing.status === "completed" || existing.status === "cancelled") {
      return undefined;
    }

    const failed = await this.db.importJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        errorMessage: message,
        completedAt: new Date()
      }
    });
    await this.db.auditLog.create({
      data: {
        workspaceId,
        action: "import",
        entityType: "import_job",
        entityId: jobId,
        objectKey,
        summary: `CSV import job moved to dead letter queue for ${objectKey}: ${message}`,
        details: { error: message, source: "worker" } as Prisma.InputJsonValue
      }
    });
    return mapImportJob(failed);
  }

  async runCsvImportJob(
    context: RequestContext,
    jobId: string,
    input: { objectKey: string; csv: string; strategy?: CsvImportStrategy; mapping?: CsvImportMapping; presetId?: string; presetName?: string }
  ): Promise<CsvImportJob> {
    requirePermission(context, "crm.import");
    const strategy = input.strategy ?? "skip-invalid";
    const existing = await this.db.importJob.findFirst({ where: { id: jobId, workspaceId: context.workspaceId } });
    if (!existing) {
      throw new Error("Import job not found");
    }
    if (existing.status === "cancelled") {
      return mapImportJob(existing);
    }
    if (existing.status !== "queued") {
      throw new Error("Only queued import jobs can be processed");
    }

    await this.db.importJob.update({
      where: { id: jobId },
      data: {
        status: "processing",
        startedAt: new Date()
      }
    });

    try {
      const result = await this.importCsv(context, input.objectKey, input.csv, strategy, input.mapping);
      const updated = await this.db.importJob.update({
        where: { id: jobId },
        data: {
          status: "completed",
          totalRows: result.preview.totalRows,
          createdCount: result.created.length,
          errorCount: result.errors.length,
          aborted: result.aborted,
          preview: result.preview as unknown as Prisma.InputJsonValue,
          result: result as unknown as Prisma.InputJsonValue,
          completedAt: new Date()
        }
      });
      await this.writeAuditLog(context, "import", "import_job", updated.id, {
        objectKey: input.objectKey,
        summary: `Completed CSV import job for ${input.objectKey}: ${result.created.length} created, ${result.errors.length} failed`,
        details: { strategy, totalRows: result.preview.totalRows, created: result.created.length, errors: result.errors.length, aborted: result.aborted }
      });
      const mapped = mapImportJob(updated);
      this.emitWebhookEvent(context, "import.completed", {
        jobId: mapped.id,
        objectKey: mapped.objectKey,
        totalRows: mapped.totalRows,
        createdCount: mapped.createdCount,
        errorCount: mapped.errorCount,
        aborted: mapped.aborted,
        strategy: mapped.strategy
      });
      return mapped;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import job failed";
      const failed = await this.db.importJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          errorMessage: message,
          completedAt: new Date()
        }
      });
      await this.writeAuditLog(context, "import", "import_job", failed.id, {
        objectKey: input.objectKey,
        summary: `Failed CSV import job for ${input.objectKey}: ${message}`,
        details: { strategy, error: message }
      });
      const mapped = mapImportJob(failed);
      this.emitWebhookEvent(context, "import.failed", {
        jobId: mapped.id,
        objectKey: mapped.objectKey,
        errorMessage: mapped.errorMessage,
        strategy: mapped.strategy
      });
      return mapped;
    }
  }

  async deliverWebhookEvent(context: RequestContext, event: WebhookEvent, data: Record<string, unknown>): Promise<WebhookDelivery[]> {
    const events = expandWebhookEventsForPayload(event, data);
    const webhooks = await this.db.webhookEndpoint.findMany({
      where: {
        workspaceId: context.workspaceId,
        active: true,
        events: { hasSome: events }
      },
      orderBy: { createdAt: "asc" }
    });

    const deliveries: WebhookDelivery[] = [];
    for (const webhook of webhooks) {
      for (const matchedEvent of events.filter((candidate) => webhook.events.includes(candidate))) {
        deliveries.push(await this.deliverWebhook(context, webhook, matchedEvent, data));
      }
    }
    return deliveries;
  }

  private async createCopiedImportJob(
    context: RequestContext,
    jobId: string,
    allowedStatuses: Array<"completed" | "failed" | "cancelled">
  ): Promise<{ job: CsvImportJob; payload: CsvImportJobSourcePayload }> {
    requirePermission(context, "crm.import");
    const source = await this.db.importJob.findFirst({ where: { id: jobId, workspaceId: context.workspaceId } });
    if (!source) {
      throw new Error("Import job not found");
    }
    if (!allowedStatuses.includes(source.status as "completed" | "failed" | "cancelled")) {
      throw new Error(`Import job with status ${source.status} cannot be copied`);
    }

    const payload = normalizeImportJobSourcePayload(source.sourcePayload, source.objectKey, source.strategy);
    const job = await this.createQueuedCsvImportJob(context, payload);
    await this.writeAuditLog(context, "import", "import_job", job.id, {
      objectKey: payload.objectKey,
      summary: `Created CSV import job from ${source.id}`,
      details: { sourceJobId: source.id, sourceStatus: source.status, strategy: payload.strategy }
    });
    return { job, payload };
  }

  private workflowTables(): {
    workflowDefinition: {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
      findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
      create: (args: unknown) => Promise<Record<string, unknown>>;
      update: (args: unknown) => Promise<Record<string, unknown>>;
      updateMany: (args: unknown) => Promise<unknown>;
      delete: (args: unknown) => Promise<Record<string, unknown>>;
    };
    workflowRun: {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
      findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
      create: (args: unknown) => Promise<Record<string, unknown>>;
      update: (args: unknown) => Promise<Record<string, unknown>>;
    };
    workflowResume: {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
      findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
      create: (args: unknown) => Promise<Record<string, unknown>>;
      update: (args: unknown) => Promise<Record<string, unknown>>;
    };
    workflowActionApproval: {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
      findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
      create: (args: unknown) => Promise<Record<string, unknown>>;
      update: (args: unknown) => Promise<Record<string, unknown>>;
    };
  } {
    return this.db as unknown as ReturnType<PrismaCrmRepository["workflowTables"]>;
  }

  private async runSingleWorkflow(
    context: RequestContext,
    workflow: WorkflowDefinition,
    event: string,
    data: Record<string, unknown>,
    options: { idempotencyKey?: string; test?: boolean } = {}
  ): Promise<WorkflowRun | undefined> {
    if (!options.test && !workflowMatchesEvent(workflow, event, data)) {
      return undefined;
    }
    const idempotencyKey = options.test
      ? buildWorkflowTestIdempotencyKey(workflow, event)
      : options.idempotencyKey ?? buildWorkflowIdempotencyKey(workflow, event, data);
    if (!options.test && idempotencyKey) {
      const existing = await this.workflowTables().workflowRun.findFirst({ where: { workspaceId: context.workspaceId, workflowId: workflow.id, idempotencyKey } });
      if (existing) {
        return mapWorkflowRun(existing);
      }
    }

    const startedAt = new Date();
    let run = mapWorkflowRun(
      await this.workflowTables().workflowRun.create({
        data: {
          workspaceId: context.workspaceId,
          workflowId: workflow.id,
          status: "running",
          triggerEvent: event,
          triggerData: toJsonObject(data),
          idempotencyKey
        }
      })
    );
    await this.writeAuditLog(context, "workflow.run_started", "workflow", workflow.id, {
      summary: `Started workflow ${workflow.name}`,
      details: { runId: run.id, event, test: options.test ?? false }
    });

    const record = await this.workflowRecordFromData(context, data);
    if (workflow.graph) {
      const graphResults = await this.runWorkflowGraph(context, workflow, data, record, run.id, options);
      const finalStatus = workflowGraphRunStatus(graphResults.actionResults, graphResults.nodeResults);
      run = mapWorkflowRun(
        await this.workflowTables().workflowRun.update({
          where: { id: run.id },
          data: {
            status: finalStatus,
            conditionResults: toJsonArray(graphResults.conditionResults),
            actionResults: toJsonArray(graphResults.actionResults),
            nodeResults: toJsonArray(graphResults.nodeResults),
            completedAt: finalStatus === "waiting" ? null : new Date(),
            durationMs: Date.now() - startedAt.getTime()
          }
        })
      );
      await this.workflowTables().workflowDefinition.update({ where: { id: workflow.id }, data: { lastRunAt: new Date() } });
      await this.writeAuditLog(context, finalStatus === "failed" ? "workflow.run_failed" : "workflow.run_completed", "workflow", workflow.id, {
        summary: `Workflow ${workflow.name} ${finalStatus}`,
        details: { runId: run.id, event, nodeResults: graphResults.nodeResults, actionResults: graphResults.actionResults }
      });
      return run;
    }
    const conditionResults = evaluateWorkflowConditions(workflow, data, record);
    if (!didWorkflowConditionsPass(conditionResults)) {
      run = mapWorkflowRun(
        await this.workflowTables().workflowRun.update({
          where: { id: run.id },
          data: {
            status: "skipped",
            conditionResults: toJsonArray(conditionResults),
            actionResults: toJsonArray([]),
            completedAt: new Date(),
            durationMs: Date.now() - startedAt.getTime()
          }
        })
      );
      return run;
    }

    const actionResults: WorkflowRun["actionResults"] = [];
    for (const action of workflow.actions) {
      if (options.test) {
        actionResults.push({ actionKey: action.key, status: isHighRiskWorkflowAction(action) ? "approval_required" : "completed", message: "Test run only; action was not executed." });
        continue;
      }
      if (isHighRiskWorkflowAction(action)) {
        const approval = await this.createWorkflowActionApproval(context, workflow, run.id, action, data, record);
        actionResults.push({ actionKey: action.key, status: "approval_required", message: `Approval required: ${approval.id}` });
        continue;
      }
      actionResults.push(await this.executeWorkflowAction(context, workflow, action, data, record, run.id));
    }

    const finalStatus = actionResults.some((result) => result.status === "failed")
      ? "failed"
      : actionResults.some((result) => result.status === "approval_required")
        ? "approval_required"
        : "completed";
    run = mapWorkflowRun(
      await this.workflowTables().workflowRun.update({
        where: { id: run.id },
        data: {
          status: finalStatus,
          conditionResults: toJsonArray(conditionResults),
          actionResults: toJsonArray(actionResults),
          completedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime()
        }
      })
    );
    await this.workflowTables().workflowDefinition.update({ where: { id: workflow.id }, data: { lastRunAt: new Date() } });
    await this.writeAuditLog(context, finalStatus === "failed" ? "workflow.run_failed" : "workflow.run_completed", "workflow", workflow.id, {
      summary: `Workflow ${workflow.name} ${finalStatus}`,
      details: { runId: run.id, event, actionResults }
    });
    return run;
  }

  private async runWorkflowGraph(
    context: RequestContext,
    workflow: WorkflowDefinition,
    triggerData: Record<string, unknown>,
    record: CrmRecord | undefined,
    runId: string,
    options: { test?: boolean; startNodeId?: string; previousNodeResults?: NonNullable<WorkflowRun["nodeResults"]> } = {}
  ): Promise<{
    conditionResults: WorkflowRun["conditionResults"];
    actionResults: WorkflowRun["actionResults"];
    nodeResults: NonNullable<WorkflowRun["nodeResults"]>;
  }> {
    const graph = workflow.graph ? normalizeWorkflowGraph(workflow.graph, workflow) : normalizeWorkflowGraph(undefined, workflow);
    const conditionResults: WorkflowRun["conditionResults"] = [];
    const actionResults: WorkflowRun["actionResults"] = [];
    const nodeResults: NonNullable<WorkflowRun["nodeResults"]> = [...(options.previousNodeResults ?? [])];
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const visits = new Map<string, number>();
    let current = options.startNodeId ?? graph.nodes.find((node) => node.type === "start")?.id ?? "start";
    for (let step = 0; step < 200 && current; step += 1) {
      const node = nodeById.get(current);
      if (!node) break;
      const startedAt = new Date().toISOString();
      let outputHandle = "main";
      let status: NonNullable<WorkflowRun["nodeResults"]>[number]["status"] = "completed";
      let message = "";
      visits.set(node.id, (visits.get(node.id) ?? 0) + 1);

      if (node.type === "end") {
        nodeResults.push({ nodeId: node.id, status, outputHandle: "end", message: "Ended workflow", startedAt, completedAt: new Date().toISOString() });
        break;
      }

      if (node.type === "start") {
        message = graph.scope.mode === "record" ? `Record scoped: ${graph.scope.recordTitle ?? graph.scope.recordId}` : graph.scope.mode === "object" ? `Object scoped: ${graph.scope.objectKey}` : "Global workflow";
      } else if (node.type === "wait_delay") {
        const amount = Math.max(1, Math.min(Number(node.config.delayAmount ?? 1) || 1, 365));
        const unit = node.config.delayUnit === "hours" || node.config.delayUnit === "minutes" ? node.config.delayUnit : "days";
        outputHandle = "after_delay";
        if (options.test) {
          message = `Test run: would wait ${amount} ${unit}.`;
        } else {
          const nextEdge = findWorkflowEdge(graph.edges, node.id, outputHandle) ?? findWorkflowEdge(graph.edges, node.id, "main") ?? findWorkflowEdge(graph.edges, node.id, "default");
          const resumeAt = workflowDelayResumeAt(amount, unit);
          const resume = await this.createWorkflowResume(context, workflow, runId, nextEdge?.targetNodeId ?? "end", resumeAt, {
            ...triggerData,
            waitStartedAt: startedAt,
            waitNodeId: node.id,
            waitAmount: amount,
            waitUnit: unit
          });
          status = "waiting";
          message = `Waiting until ${resume.resumeAt}; resume node ${resume.nodeId}.`;
          nodeResults.push({ nodeId: node.id, status, outputHandle, message, startedAt, completedAt: new Date().toISOString(), resumeAt: resume.resumeAt });
          break;
        }
      } else if (node.type === "wait_reply") {
        const replyResult = await this.evaluateWorkflowReplyNode(context, node, triggerData, record);
        conditionResults.push({ key: replyResult.key, passed: replyResult.replied, actualValue: replyResult.actualValue });
        outputHandle = replyResult.replied ? "replied" : "not_replied";
        message = replyResult.replied ? `Reply detected${replyResult.messageId ? `: ${replyResult.messageId}` : ""}.` : "No reply detected.";
      } else if (node.type === "if" || node.type === "switch" || node.type === "loop") {
        const condition = workflowNodeToCondition(node);
        const result = evaluateWorkflowCondition(condition, triggerData, record);
        conditionResults.push({ key: condition.key, passed: result.passed, actualValue: result.actualValue });
        if (node.type === "switch") {
          outputHandle = switchOutputHandle(node, result.actualValue);
        } else if (node.type === "loop") {
          const maxIterations = Math.min(Number(node.config.maxIterations ?? condition.config?.maxIterations ?? 100) || 100, 100);
          outputHandle = (visits.get(node.id) ?? 1) >= maxIterations || !result.passed ? "break" : "continue";
        } else {
          outputHandle = result.passed ? "true" : "false";
        }
        message = `Output: ${outputHandle}`;
      } else {
        const action = workflowNodeToAction(node);
        let actionResult: WorkflowRun["actionResults"][number];
        if (options.test) {
          actionResult = { actionKey: action.key, status: isHighRiskWorkflowAction(action) ? "approval_required" : "completed", message: "Test run only; action was not executed." };
        } else if (isHighRiskWorkflowAction(action)) {
          const approval = await this.createWorkflowActionApproval(context, workflow, runId, action, triggerData, record);
          actionResult = { actionKey: action.key, status: "approval_required", message: `Approval required: ${approval.id}` };
        } else {
          actionResult = await this.executeWorkflowAction(context, workflow, action, triggerData, record, runId);
        }
        actionResults.push(actionResult);
        status = actionResult.status;
        message = actionResult.message ?? "";
        if (node.type === "ai_agent") {
          outputHandle = status === "failed" ? "failed" : status === "approval_required" || action.config.requireHumanReview !== false ? "needs_review" : "done";
        }
      }

      nodeResults.push({ nodeId: node.id, status, outputHandle, message, startedAt, completedAt: new Date().toISOString() });
      const nextEdge = findWorkflowEdge(graph.edges, node.id, outputHandle) ?? findWorkflowEdge(graph.edges, node.id, "main") ?? findWorkflowEdge(graph.edges, node.id, "default");
      current = nextEdge?.targetNodeId ?? "";
    }
    return { conditionResults, actionResults, nodeResults };
  }

  private async createWorkflowResume(
    context: RequestContext,
    workflow: WorkflowDefinition,
    runId: string,
    nodeId: string,
    resumeAt: Date,
    triggerData: Record<string, unknown>
  ): Promise<WorkflowResume> {
    const waitNodeId = typeof triggerData.waitNodeId === "string" ? triggerData.waitNodeId : nodeId;
    const waitStartedAt = typeof triggerData.waitStartedAt === "string" ? triggerData.waitStartedAt : new Date().toISOString();
    const idempotencyKey = `${runId}:${waitNodeId}:${nodeId}:${waitStartedAt}`;
    const existing = await this.workflowTables().workflowResume.findFirst({ where: { workspaceId: context.workspaceId, idempotencyKey } });
    if (existing) return mapWorkflowResume(existing);
    const row = await this.workflowTables().workflowResume.create({
      data: {
        workspaceId: context.workspaceId,
        workflowId: workflow.id,
        runId,
        nodeId,
        resumeAt,
        triggerData: toJsonObject(triggerData),
        status: "pending",
        idempotencyKey
      }
    });
    return mapWorkflowResume(row);
  }

  private async evaluateWorkflowReplyNode(
    context: RequestContext,
    node: { config: Record<string, unknown>; id: string },
    triggerData: Record<string, unknown>,
    record?: CrmRecord
  ): Promise<{ key: string; replied: boolean; actualValue?: unknown; messageId?: string }> {
    const fallback = evaluateWorkflowCondition(workflowNodeToCondition({ id: node.id, type: "wait_reply", label: node.id, position: { x: 0, y: 0 }, config: node.config }), triggerData, record);
    const lookbackDays = Math.max(1, Math.min(Number(node.config.lookbackDays ?? triggerData.waitAmount ?? 7) || 7, 365));
    const since = workflowReplySince(triggerData, lookbackDays);
    const threadId = typeof triggerData.threadId === "string" ? triggerData.threadId : undefined;
    const recordId = typeof triggerData.recordId === "string" ? triggerData.recordId : record?.id;
    const contactEmail = normalizeWorkflowEmail(typeof record?.data.email === "string" ? record.data.email : typeof triggerData.from === "string" ? triggerData.from : "");
    const threadRows = threadId
      ? [{ id: threadId }]
      : recordId
        ? await this.db.emailThread.findMany({ where: { workspaceId: context.workspaceId, recordId }, select: { id: true } })
        : [];
    const threadIds = threadRows.map((thread) => thread.id);
    const or: Array<Record<string, unknown>> = [];
    if (threadIds.length) or.push({ threadId: { in: threadIds } });
    if (contactEmail) or.push({ fromAddress: { equals: contactEmail, mode: "insensitive" } });
    if (!or.length) {
      return { key: node.id, replied: fallback.passed, actualValue: fallback.actualValue };
    }
    const message = await this.db.emailMessage.findFirst({
      where: {
        workspaceId: context.workspaceId,
        direction: "inbound",
        status: "received",
        OR: or,
        createdAt: { gte: since }
      },
      orderBy: { createdAt: "asc" }
    });
    return {
      key: node.id,
      replied: Boolean(message) || fallback.passed,
      actualValue: message ? { messageId: message.id, receivedAt: message.receivedAt?.toISOString() ?? message.createdAt.toISOString() } : fallback.actualValue,
      messageId: message?.id
    };
  }

  private async workflowRecordFromData(context: RequestContext, data: Record<string, unknown>): Promise<CrmRecord | undefined> {
    const recordId = typeof data.recordId === "string" ? data.recordId : undefined;
    const objectKey = typeof data.objectKey === "string" ? data.objectKey : undefined;
    if (!recordId || !objectKey) {
      return undefined;
    }
    try {
      return await this.getRecord(context, objectKey, recordId);
    } catch {
      return undefined;
    }
  }

  private async createWorkflowActionApproval(
    context: RequestContext,
    workflow: WorkflowDefinition,
    runId: string,
    action: WorkflowAction,
    triggerData: Record<string, unknown>,
    record?: CrmRecord
  ): Promise<WorkflowActionApproval> {
    const row = await this.workflowTables().workflowActionApproval.create({
      data: {
        workspaceId: context.workspaceId,
        workflowId: workflow.id,
        runId,
        actionKey: action.key,
        actionType: action.type,
        status: "pending",
        summary: `${workflow.name}: ${action.name}`,
        payload: toJsonObject({ action, triggerData, recordId: record?.id, objectKey: record?.objectKey }),
        requestedById: context.user.id
      }
    });
    const approval = mapWorkflowApproval(row);
    await this.writeAuditLog(context, "workflow.action_approval_requested", "workflow_approval", approval.id, {
      summary: `Workflow action requires approval: ${action.name}`,
      details: { workflowId: workflow.id, runId, actionType: action.type }
    });
    return approval;
  }

  private async executeWorkflowAction(
    context: RequestContext,
    workflow: WorkflowDefinition,
    action: WorkflowAction,
    triggerData: Record<string, unknown>,
    record?: CrmRecord,
    runId?: string
  ): Promise<WorkflowRun["actionResults"][number]> {
    try {
      if (action.type === "run_ai_agent") {
        const goal = renderWorkflowTextTemplate(action.config.goal ?? action.name, triggerData, record) || action.name;
        const allowedTools = Array.isArray(action.config.allowedTools)
          ? action.config.allowedTools.filter((tool): tool is string => typeof tool === "string")
          : ["create_task", "create_email_draft", "notify"];
        const plan = [
          `AI Agent plan: ${goal}`,
          `Context: ${record ? `${record.objectKey}/${record.title}` : "no linked record"}`,
          `Knowledge base: ${action.config.useKnowledge === false ? "disabled" : "enabled"}`,
          `Allowed tools: ${allowedTools.join(", ")}`,
          action.config.autoExecuteTools === true ? "Tool execution: automatic tools require approval policy." : "Tool execution: plan only; downstream nodes should perform actions."
        ].join("\n");
        if (record) {
          await this.createActivity(context, {
            recordId: record.id,
            type: "note",
            title: "AI Agent plan",
            body: plan
          });
        }
        return { actionKey: action.key, status: "completed", message: plan };
      }

      if (action.type === "create_activity") {
        if (!record) throw new Error("Workflow action requires a linked CRM record");
        const type = typeof action.config.activityType === "string" ? action.config.activityType : "task";
        const dueInDays = typeof action.config.dueInDays === "number" ? action.config.dueInDays : undefined;
        const dueAt = dueInDays ? new Date(Date.now() + dueInDays * 24 * 60 * 60 * 1000).toISOString() : undefined;
        const title = renderWorkflowTextTemplate(action.config.title ?? action.name, triggerData, record) || action.name;
        if (type === "task" && action.config.preventDuplicate !== false) {
          const existingTask = (await this.listActivities(context, record.id)).find((activity) => activity.type === "task" && !activity.completedAt && !activity.archivedAt && activity.title === title);
          if (existingTask) {
            return { actionKey: action.key, status: "skipped", message: `Skipped duplicate task ${existingTask.id}` };
          }
        }
        const ownerHint = typeof action.config.assigneeMode === "string" ? `Assignee: ${action.config.assigneeMode}${typeof action.config.assigneeUserId === "string" ? ` (${action.config.assigneeUserId})` : ""}` : "";
        const priorityHint = typeof action.config.priority === "string" ? `Priority: ${action.config.priority}` : "";
        const body = [renderWorkflowTextTemplate(action.config.body, triggerData, record), ownerHint, priorityHint].filter(Boolean).join("\n");
        const activity = await this.createActivity(context, {
          recordId: record.id,
          type: type as Activity["type"],
          title,
          body,
          dueAt
        });
        return { actionKey: action.key, status: "completed", message: `Created activity ${activity.id}` };
      }

      if (action.type === "send_email") {
        const accountId = typeof action.config.accountId === "string" ? action.config.accountId : undefined;
        const account = accountId
          ? await this.assertEmailAccount(context, accountId)
          : (await this.listEmailAccounts(context)).find((candidate) => candidate.sendEnabled && candidate.status === "active");
        if (!account) throw new Error("No active send-enabled email account");
        const to = Array.isArray(action.config.to)
          ? action.config.to.filter((value): value is string => typeof value === "string").map((value) => renderWorkflowTextTemplate(value, triggerData, record)).filter(Boolean)
          : [typeof triggerData.from === "string" ? triggerData.from : typeof record?.data.email === "string" ? record.data.email : ""].filter(Boolean);
        const cc = Array.isArray(action.config.cc) ? action.config.cc.filter((value): value is string => typeof value === "string").map((value) => renderWorkflowTextTemplate(value, triggerData, record)).filter(Boolean) : undefined;
        const bcc = Array.isArray(action.config.bcc) ? action.config.bcc.filter((value): value is string => typeof value === "string").map((value) => renderWorkflowTextTemplate(value, triggerData, record)).filter(Boolean) : undefined;
        if (to.length === 0) throw new Error("No email recipient");
        const message = await this.recordEmailMessage(context, {
          accountId: account.id,
          direction: "outbound",
          from: account.emailAddress,
          to,
          cc,
          bcc,
          subject: renderWorkflowTextTemplate(action.config.subject ?? `Re: ${record?.title ?? workflow.name}`, triggerData, record),
          bodyText: renderWorkflowTextTemplate(action.config.bodyText ?? action.config.body ?? "", triggerData, record),
          bodyHtml: renderWorkflowTextTemplate(action.config.bodyHtml, triggerData, record) || undefined,
          status: action.config.mode === "draft" ? "draft" : "queued",
          recordId: record?.id,
          clientRequestId: runId ? `workflow:${runId}:${action.key}` : undefined,
          aiAssisted: Boolean(action.config.aiAssisted),
          skipAutoLink: true
        });
        return { actionKey: action.key, status: "completed", message: `Created email ${message.id}` };
      }

      if (action.type === "update_stage") {
        if (!record || record.objectKey !== "deals") throw new Error("Stage update requires a deal record");
        const stageKey = typeof action.config.stageKey === "string" ? action.config.stageKey : undefined;
        if (!stageKey) throw new Error("stageKey is required");
        const updated = await this.updateRecord(context, record.objectKey, record.id, { stageKey });
        return { actionKey: action.key, status: "completed", message: `Updated deal stage to ${updated.stageKey}` };
      }

      if (action.type === "update_record") {
        if (!record) throw new Error("Record update requires a linked CRM record");
        const patch = isJsonRecord(action.config.patch) ? action.config.patch : {};
        const updated = await this.updateRecord(context, record.objectKey, record.id, {
          title: typeof patch.title === "string" ? patch.title : undefined,
          data: isJsonRecord(patch.data) ? patch.data : undefined,
          ownerId: typeof patch.ownerId === "string" ? patch.ownerId : undefined,
          stageKey: typeof patch.stageKey === "string" ? patch.stageKey : undefined
        });
        return { actionKey: action.key, status: "completed", message: `Updated record ${updated.id}` };
      }

      if (action.type === "create_knowledge_article") {
        const article = await this.createKnowledgeArticle(context, {
          title: renderWorkflowTextTemplate(action.config.title ?? workflow.name, triggerData, record),
          body: renderWorkflowTextTemplate(action.config.content ?? action.config.body ?? "", triggerData, record),
          tags: Array.isArray(action.config.tags) ? action.config.tags.filter((tag): tag is string => typeof tag === "string") : ["workflow"]
        });
        return { actionKey: action.key, status: "completed", message: `Created knowledge article ${article.id}` };
      }

      if (action.type === "notify") {
        this.emitNotificationEvent(context, "workflow.run_completed", { workflowId: workflow.id, actionKey: action.key, ...triggerData });
        return { actionKey: action.key, status: "completed", message: "Notification dispatched" };
      }

      return { actionKey: action.key, status: "failed", message: `Unsupported action type ${action.type}` };
    } catch (error) {
      return { actionKey: action.key, status: "failed", message: error instanceof Error ? error.message : "Action failed" };
    }
  }

  private emitWebhookEvent(context: RequestContext, event: WebhookEvent, data: Record<string, unknown>): void {
    void getBackgroundJobExecutor(this)
      .runWebhookEvent(context, { event, data })
      .catch((error) => {
        console.error(`Failed to enqueue webhook event ${event}`, error);
      });
    void getBackgroundJobExecutor(this)
      .runWorkflowJob(context, { event, data })
      .catch((error) => {
        console.error(`Failed to enqueue workflow event ${event}`, error);
      });
    this.emitNotificationEvent(context, event, data);
  }

  private emitEmailMessageEvents(context: RequestContext, message: EmailMessage, recordId: string | undefined, options: { includeCreated: boolean }): void {
    const data = buildEmailMessageEventPayload(message, recordId);
    if (options.includeCreated) {
      this.emitWebhookEvent(context, "email.message.created", data);
    }
    const lifecycleEvent = emailMessageLifecycleEvent(message);
    if (lifecycleEvent) {
      this.emitWebhookEvent(context, lifecycleEvent, data);
    }
  }

  private emitNotificationEvent(context: RequestContext, event: NotificationEvent, data: Record<string, unknown>): void {
    void this.deliverNotificationEvent(context, event, data).catch((error) => {
      console.error(`Failed to deliver notification event ${event}`, error);
    });
  }

  private async deliverNotificationEvent(context: RequestContext, event: NotificationEvent, data: Record<string, unknown>): Promise<void> {
    const channels = await this.db.notificationChannel.findMany({
      where: {
        workspaceId: context.workspaceId,
        active: true,
        events: { has: event }
      },
      orderBy: { createdAt: "asc" }
    });
    for (const channel of channels) {
      await this.deliverNotificationChannel(context, mapNotificationChannel(channel), event, data).catch(async (error) => {
        await this.writeAuditLog(context, "create", "notification_delivery", channel.id, {
          summary: `Failed notification ${channel.name}: ${error instanceof Error ? error.message : "unknown error"}`,
          details: { channelId: channel.id, event, type: channel.type }
        });
      });
    }
  }

  private async deliverNotificationChannel(context: RequestContext, channel: NotificationChannel, event: NotificationEvent, data: Record<string, unknown>): Promise<void> {
    const title = `AI Agent CRM: ${event}`;
    const body = buildNotificationBody(event, data);
    if (channel.type === "bark") {
      const endpoint = typeof channel.config.barkEndpoint === "string" ? channel.config.barkEndpoint : "https://api.day.app";
      const deviceKey = typeof channel.config.barkDeviceKey === "string" ? channel.config.barkDeviceKey.trim() : "";
      if (!deviceKey) {
        throw new Error("Bark device key is required");
      }
      const url = `${endpoint.replace(/\/$/, "")}/${encodeURIComponent(deviceKey)}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
      await assertWebhookDeliveryTarget(url);
      await fetchWithTimeout(url, { method: "GET", headers: { "user-agent": "ai-agent-crm-notification/1.0" } });
    } else if (channel.type === "webhook") {
      const url = typeof channel.config.url === "string" ? channel.config.url.trim() : "";
      if (!url) {
        throw new Error("Webhook notification URL is required");
      }
      await assertWebhookDeliveryTarget(url);
      await fetchWithTimeout(url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "ai-agent-crm-notification/1.0" },
        body: JSON.stringify({ event, title, body, data, channelId: channel.id, createdAt: new Date().toISOString() })
      });
    } else if (channel.type === "email") {
      const recipients = Array.isArray(channel.config.recipients) ? channel.config.recipients.filter((item): item is string => typeof item === "string" && item.includes("@")) : [];
      if (!recipients.length) {
        throw new Error("Email notification recipients are required");
      }
      const configuredAccountId = typeof channel.config.accountId === "string" ? channel.config.accountId : "";
      const account =
        (configuredAccountId ? await this.db.emailAccount.findFirst({ where: { id: configuredAccountId, workspaceId: context.workspaceId } }) : null) ??
        (await this.db.emailAccount.findFirst({ where: { workspaceId: context.workspaceId, status: "active", sendEnabled: true }, orderBy: { createdAt: "asc" } }));
      if (!account) {
        throw new Error("No active email account is available for notifications");
      }
      await this.queueEmailMessage(context, {
        accountId: account.id,
        to: recipients,
        subject: title,
        bodyText: body,
        clientRequestId: `notification-${channel.id}-${event}-${Date.now()}`
      });
    }
    await this.db.notificationChannel.update({
      where: { id: channel.id },
      data: { lastNotifiedAt: new Date() }
    });
    await this.writeAuditLog(context, "create", "notification_delivery", channel.id, {
      summary: `Delivered notification ${channel.name}: ${event}`,
      details: { channelId: channel.id, event, type: channel.type }
    });
  }

  private async deliverWebhook(
    context: RequestContext,
    webhook: {
      id: string;
      workspaceId: string;
      name: string;
      url: string;
      secret: string;
    },
    event: WebhookDelivery["event"],
    data: Record<string, unknown>,
    attempts = 1
  ): Promise<WebhookDelivery> {
    const requestBody = {
      id: `evt_${Date.now()}`,
      event,
      createdAt: new Date().toISOString(),
      data
    };
    const payload = JSON.stringify(requestBody);
    const delivery = await this.db.webhookDelivery.create({
      data: {
        workspaceId: webhook.workspaceId,
        webhookId: webhook.id,
        event,
        status: "pending",
        attempts,
        requestBody: requestBody as Prisma.InputJsonValue
      }
    });

    try {
      await assertWebhookDeliveryTarget(webhook.url);
      const response = await fetchWithTimeout(webhook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "ai-agent-crm-webhook/1.0",
          "x-crm-event": event,
          "x-crm-delivery": delivery.id,
          "x-crm-signature": buildWebhookSignatureHeader(webhook.secret, payload)
        },
        body: payload
      });
      const responseBody = await response.text().catch(() => "");
      const updated = await this.db.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: response.ok ? "success" : "failed",
          responseStatus: response.status,
          responseBody: responseBody.slice(0, 2000),
          errorMessage: response.ok ? null : `Webhook returned HTTP ${response.status}`,
          deliveredAt: new Date()
        }
      });
      await this.db.webhookEndpoint.update({
        where: { id: webhook.id },
        data: { lastDeliveredAt: new Date() }
      });
      await this.writeAuditLog(context, "create", "webhook_delivery", updated.id, {
        summary: `Delivered webhook ${webhook.name}: ${updated.status}`,
        details: { webhookId: webhook.id, event, status: updated.status, responseStatus: updated.responseStatus }
      });
      return mapWebhookDelivery(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Webhook delivery failed";
      const failed = await this.db.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "failed",
          errorMessage: message,
          deliveredAt: new Date()
        }
      });
      await this.writeAuditLog(context, "create", "webhook_delivery", failed.id, {
        summary: `Failed webhook ${webhook.name}: ${message}`,
        details: { webhookId: webhook.id, event, error: message }
      });
      return mapWebhookDelivery(failed);
    }
  }

  async previewCsvImport(context: RequestContext, objectKey: string, csv: string, mapping?: CsvImportMapping): Promise<CsvImportPreview> {
    requirePermission(context, "crm.import");
    await this.requireObject(context, objectKey);
    const rows = parseCsv(csv);
    const headers = splitCsvLine(csv.trim().split(/\r?\n/)[0] ?? "");
    const normalizedMapping = normalizeCsvImportMapping(mapping);
    const fields = await this.listFieldDefinitions(context, objectKey);
    assertCsvImportMappingTargets(fields, normalizedMapping);
    const errors: string[] = [];
    const previewRows: CsvImportPreview["rows"] = [];
    const draftRecords: CrmRecord[] = [];
    const conflicts: CsvImportConflict[] = [];
    let creatableRows = 0;
    const preparedRows = rows.map((row, index) => {
      const rowNumber = index + 2;
      const rowErrors: string[] = [];
      let title = "";
      let data: Record<string, unknown> | undefined;
      const mappedRow = applyCsvImportMapping(row, normalizedMapping);

      try {
        title = String(mappedRow.title ?? mappedRow.name ?? "").trim();
        if (!title) {
          throw new Error("Missing title or name column");
        }
        parseTagsCell(mappedRow.tags);
        data = coerceRow(mappedRow, fields);
      } catch (error) {
        rowErrors.push(error instanceof Error ? error.message : "Import failed");
      }

      return { row, rowNumber, title, data, rowErrors, mappedRow };
    });
    const existing = await this.listRecordsForCsvConflictCandidates(
      context,
      objectKey,
      fields,
      preparedRows.map((row) => row.data).filter((data): data is Record<string, unknown> => Boolean(data))
    );

    for (const preparedRow of preparedRows) {
      const rowConflicts: CsvImportConflict[] = [];
      const rowErrors = [...preparedRow.rowErrors];

      try {
        if (!preparedRow.data) {
          errors.push(...rowErrors.map((item) => `Row ${preparedRow.rowNumber}: ${item}`));
          previewRows.push({
            rowNumber: preparedRow.rowNumber,
            title: preparedRow.title,
            status: "error",
            errors: rowErrors,
            conflicts: rowConflicts,
            values: preparedRow.mappedRow
          });
          continue;
        }
        const data = preparedRow.data;
        rowConflicts.push(...findCsvImportConflicts(preparedRow.rowNumber, fields, data, existing));
        validateRecordPayload(fields, data, draftRecords);
        await this.assertRecordReferences(context, fields, data, true);
        if (rowConflicts.length === 0) {
          const tags = parseTagsCell(preparedRow.mappedRow.tags);
          draftRecords.push({
            id: `csv-row-${preparedRow.rowNumber}`,
            workspaceId: context.workspaceId,
            objectKey,
            title: preparedRow.title,
            tags,
            tagColors: normalizeTagColors({}, tags),
            ownerId: context.user.id,
            data,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          creatableRows += 1;
        }
      } catch (error) {
        rowErrors.push(error instanceof Error ? error.message : "Import failed");
      }

      errors.push(...rowErrors.map((item) => `Row ${preparedRow.rowNumber}: ${item}`));
      errors.push(...rowConflicts.map((conflict) => formatCsvImportConflict(conflict)));
      conflicts.push(...rowConflicts);
      previewRows.push({
        rowNumber: preparedRow.rowNumber,
        title: preparedRow.title,
        status: rowErrors.length > 0 ? "error" : rowConflicts.length > 0 ? "conflict" : "ready",
        errors: rowErrors,
        conflicts: rowConflicts,
        values: preparedRow.mappedRow
      });
    }

    return {
      headers,
      totalRows: rows.length,
      creatableRows,
      errorRows: previewRows.filter((row) => row.status === "error").length,
      conflictRows: previewRows.filter((row) => row.status === "conflict").length,
      errors,
      conflicts,
      mappedFields: fields
        .filter((field) => headers.includes(field.key) || Object.values(normalizedMapping ?? {}).includes(field.key))
        .map((field) => ({ key: field.key, label: field.label, type: field.type })),
      unmappedHeaders: headers.filter(
        (header) =>
          !isIgnoredCsvImportHeader(header) &&
          !normalizedMapping?.[header] &&
          !fields.some((field) => field.key === header)
      ),
      rows: previewRows
    };
  }

  private async assertObjectCanBeDeleted(
    context: RequestContext,
    object: { id: string; key: string; workspaceId: string; isSystem: boolean }
  ): Promise<void> {
    const recordCount = await this.db.crmRecord.count({
      where: { workspaceId: context.workspaceId, objectKey: object.key }
    });
    if (recordCount > 0) {
      throw new Error(`${object.key} cannot be deleted because it still has ${recordCount} records`);
    }

    const fields = await this.listFieldDefinitions(context);
    const inboundField = fields.find(
      (field) =>
        field.objectKey !== object.key &&
        field.type === "reference" &&
        field.options?.some((option) => option.value === object.key)
    );
    if (inboundField) {
      throw new Error(`${object.key} cannot be deleted because field ${inboundField.objectKey}.${inboundField.key} still references it`);
    }

    const relation = await this.db.relationDefinition.findFirst({
      where: {
        workspaceId: context.workspaceId,
        OR: [{ fromObjectKey: object.key }, { toObjectKey: object.key }]
      }
    });
    if (relation) {
      throw new Error(`${object.key} cannot be deleted because relation ${relation.key} still uses it`);
    }
  }

  private async listRecordsForValidation(context: RequestContext, objectKey: string): Promise<CrmRecord[]> {
    const records = await this.db.crmRecord.findMany({
      where: {
        workspaceId: context.workspaceId,
        objectKey
      },
      orderBy: { updatedAt: "desc" }
    });
    return records.map(mapRecord);
  }

  private async listRecordsForUniqueValidation(
    context: RequestContext,
    objectKey: string,
    fields: FieldDefinition[],
    data: Record<string, unknown>,
    currentRecordId?: string
  ): Promise<CrmRecord[]> {
    const uniqueClauses = fields
      .filter((field) => field.unique && !isBlankValue(data[field.key]))
      .map((field) => {
        const column = recordJsonTextSql(field.key);
        return Prisma.sql`(${column} IS NOT NULL AND ${column} <> '' AND lower(${column}) = lower(${String(data[field.key])}))`;
      });

    if (uniqueClauses.length === 0) {
      return [];
    }

    const currentRecordFilter = currentRecordId ? Prisma.sql`AND "id" <> ${currentRecordId}` : Prisma.empty;
    const records = await this.db.$queryRaw<Parameters<typeof mapRecord>[0][]>(Prisma.sql`
      SELECT "id", "workspaceId", "objectKey", "title", "stageKey", "ownerId", "data", "createdAt", "updatedAt"
      FROM "CrmRecord"
      WHERE "workspaceId" = ${context.workspaceId}
        AND "objectKey" = ${objectKey}
        ${currentRecordFilter}
        AND (${Prisma.join(uniqueClauses, " OR ")})
    `);

    return records.map(mapRecord);
  }

  private async listRecordsForCsvConflictCandidates(
    context: RequestContext,
    objectKey: string,
    fields: FieldDefinition[],
    rowsData: Array<Record<string, unknown>>
  ): Promise<CrmRecord[]> {
    const uniqueFields = fields.filter((field) => field.unique);
    if (uniqueFields.length === 0 || rowsData.length === 0) {
      return [];
    }

    const recordsById = new Map<string, CrmRecord>();
    for (const field of uniqueFields) {
      const values = Array.from(
        new Set(
          rowsData
            .map((data) => data[field.key])
            .filter((value) => !isBlankValue(value))
            .map(normalizeGovernedValue)
        )
      );
      for (const chunk of chunkArray(values, 500)) {
        if (chunk.length === 0) {
          continue;
        }
        const column = recordJsonTextSql(field.key);
        const records = await this.db.$queryRaw<Parameters<typeof mapRecord>[0][]>(Prisma.sql`
          SELECT "id", "workspaceId", "objectKey", "title", "stageKey", "ownerId", "data", "createdAt", "updatedAt"
          FROM "CrmRecord"
          WHERE "workspaceId" = ${context.workspaceId}
            AND "objectKey" = ${objectKey}
            AND lower(${column}) IN (${Prisma.join(chunk)})
        `);
        for (const record of records.map(mapRecord)) {
          recordsById.set(record.id, record);
        }
      }
    }

    return [...recordsById.values()];
  }

  private async assertRelationCanBeDeleted(context: RequestContext, relation: RelationDefinition): Promise<void> {
    const fields = await this.listFieldDefinitions(context);
    const referenceFields = fields.filter(
      (field) =>
        field.type === "reference" &&
        ((field.objectKey === relation.fromObjectKey && field.options?.some((option) => option.value === relation.toObjectKey)) ||
          (field.objectKey === relation.toObjectKey && field.options?.some((option) => option.value === relation.fromObjectKey)))
    );

    for (const field of referenceFields) {
      const recordUsingRelation = (await this.listRecordsForValidation(context, field.objectKey)).find((record) => !isBlankValue(record.data[field.key]));
      if (recordUsingRelation) {
        throw new Error(`${relation.key} cannot be deleted because record ${recordUsingRelation.id} still uses field ${field.objectKey}.${field.key}`);
      }
    }
  }

  private async assertPipelineCanBeDeleted(context: RequestContext, pipeline: Pipeline): Promise<void> {
    const recordUsingPipeline = (await this.listRecordsForValidation(context, pipeline.objectKey)).find((record) => !isBlankValue(record.stageKey));
    if (recordUsingPipeline) {
      throw new Error(`${pipeline.name} cannot be deleted because record ${recordUsingPipeline.id} still uses a pipeline stage`);
    }
  }

  private async assertPipelineChangeSafe(context: RequestContext, current: Pipeline, next: Pipeline): Promise<void> {
    const currentStageKeys = new Set(current.stages.map((stage) => stage.key));
    const nextStageKeys = new Set((next.stages ?? current.stages).map((stage) => stage.key));
    const removedStageKeys = [...currentStageKeys].filter((stageKey) => !nextStageKeys.has(stageKey));

    if (next.objectKey !== current.objectKey) {
      const recordUsingPipeline = (await this.listRecordsForValidation(context, current.objectKey)).find((record) => !isBlankValue(record.stageKey));
      if (recordUsingPipeline) {
        throw new Error(`${current.name} cannot change object because record ${recordUsingPipeline.id} still uses a pipeline stage`);
      }
    }

    if (removedStageKeys.length > 0) {
      const recordUsingRemovedStage = (await this.listRecordsForValidation(context, current.objectKey)).find(
        (record) => typeof record.stageKey === "string" && removedStageKeys.includes(record.stageKey)
      );
      if (recordUsingRemovedStage) {
        throw new Error(`${current.name} cannot remove stage ${recordUsingRemovedStage.stageKey} because record ${recordUsingRemovedStage.id} still uses it`);
      }
    }
  }

  private async assertFieldReferenceTarget(context: RequestContext, field: Pick<FieldDefinition, "type" | "options" | "label">): Promise<void> {
    if (field.type !== "reference") {
      return;
    }

    const targetObjectKey = field.options?.[0]?.value;
    if (!targetObjectKey) {
      throw new Error(`${field.label} must configure a referenced object`);
    }
    await this.requireObject(context, targetObjectKey);
  }

  private async assertFieldCompatibleWithRecords(context: RequestContext, field: FieldDefinition): Promise<void> {
    const records = await this.listRecordsForValidation(context, field.objectKey);
    const values = records.map((record) => record.data[field.key]).filter((value) => !isBlankValue(value));

    if (field.required && values.length < records.length) {
      throw new Error(`${field.label} cannot be required because existing records have empty values`);
    }

    if (field.unique) {
      const seen = new Map<string, string>();
      for (const record of records) {
        const value = record.data[field.key];
        if (isBlankValue(value)) {
          continue;
        }

        const normalized = normalizeGovernedValue(value);
        const duplicateRecordId = seen.get(normalized);
        if (duplicateRecordId) {
          throw new Error(`${field.label} cannot be unique because records ${duplicateRecordId} and ${record.id} already share a value`);
        }
        seen.set(normalized, record.id);
      }
    }

    if (field.type === "select") {
      const allowed = new Set((field.options ?? []).map((option) => option.value));
      const invalidRecord = records.find((record) => {
        const value = record.data[field.key];
        return !isBlankValue(value) && (typeof value !== "string" || !allowed.has(value));
      });
      if (invalidRecord) {
        throw new Error(`${field.label} options would invalidate existing record ${invalidRecord.id}`);
      }
    }

    if (field.type === "reference" || field.type === "user") {
      for (const record of records) {
        await this.assertRecordReferences(context, [field], record.data, false);
      }
    }
  }

  private async assertFieldCanBeDeleted(context: RequestContext, field: FieldDefinition): Promise<void> {
    const records = await this.listRecordsForValidation(context, field.objectKey);
    const recordUsingField = records.find((record) => !isBlankValue(record.data[field.key]));
    if (recordUsingField) {
      throw new Error(`${field.label} cannot be deleted because record ${recordUsingField.id} still has data`);
    }

    const views = await this.db.savedView.findMany({
      where: { workspaceId: context.workspaceId, objectDefinition: { key: field.objectKey } },
      include: { objectDefinition: { select: { key: true } } }
    });
    const viewUsingField = views.map(mapSavedView).find(
      (view) => view.columns.includes(field.key) || view.sort?.field === field.key || view.filters?.some((filter) => filter.field === field.key)
    );
    if (viewUsingField) {
      throw new Error(`${field.label} cannot be deleted because saved view ${viewUsingField.name} still uses it`);
    }
  }

  private async assertRecordReferences(
    context: RequestContext,
    fields: FieldDefinition[],
    data: Record<string, unknown>,
    requireVisibleRecord: boolean
  ): Promise<void> {
    for (const field of fields) {
      const value = data[field.key];
      if (isBlankValue(value)) {
        continue;
      }

      if (field.type === "user") {
        const exists = await this.db.user.findFirst({
          where: { workspaceId: context.workspaceId, id: String(value) },
          select: { id: true }
        });
        if (!exists) {
          throw new Error(`${field.label} references a missing user`);
        }
      }

      if (field.type === "reference") {
        const targetObjectKey = field.options?.[0]?.value;
        if (!targetObjectKey || typeof value !== "string") {
          throw new Error(`${field.label} references an invalid record`);
        }

        const targetRecord = await this.db.crmRecord.findFirst({
          where: {
            id: value,
            workspaceId: context.workspaceId,
            objectKey: targetObjectKey,
            ...(requireVisibleRecord ? await this.recordAccessWhere(context, targetObjectKey) : {})
          },
          select: { id: true }
        });
        if (!targetRecord) {
          throw new Error(`${field.label} references a missing record`);
        }
      }
    }
  }

  private async recordAccessWhere(context: RequestContext, objectKey?: string, pool?: RecordListQuery["pool"]): Promise<Prisma.CrmRecordWhereInput> {
    const settings = objectKey && isPoolObjectKey(objectKey) ? await this.ensureCrmPoolSettings(context.workspaceId) : undefined;
    const poolEnabled = Boolean(settings?.enabled && settings.objectKeys.includes(objectKey ?? ""));

    if (objectKey && poolEnabled) {
      if (canManageAllRecords(context)) {
        if (pool === "public") return { ownerId: null };
        if (pool === "private") return { ownerId: { not: null } };
        return {};
      }
      if (pool === "public") return { ownerId: null };
      if (pool === "private") return { ownerId: context.user.id };
      return { OR: [{ ownerId: null }, { ownerId: context.user.id }] };
    }

    if (!objectKey && !canManageAllRecords(context)) {
      const ownerIds = await this.visibleOwnerIds(context);
      return {
        OR: [
          {
            objectKey: { in: [...POOL_OBJECT_KEYS] },
            OR: [{ ownerId: null }, { ownerId: context.user.id }]
          },
          {
            objectKey: { notIn: [...POOL_OBJECT_KEYS] },
            ownerId: { in: ownerIds }
          }
        ]
      };
    }

    if (canManageAllRecords(context)) {
      return {};
    }

    const ownerIds = await this.visibleOwnerIds(context);
    return { ownerId: { in: ownerIds } };
  }

  private async recordQuerySql(context: RequestContext, objectKey: string, query: RecordListQuery): Promise<Prisma.Sql> {
    const filters = query.filters?.filter((filter) => filter.field && filter.value.trim()) ?? [];
    const clauses: Prisma.Sql[] = [Prisma.sql`"workspaceId" = ${context.workspaceId}`, Prisma.sql`"objectKey" = ${objectKey}`];

    const settings = isPoolObjectKey(objectKey) ? await this.ensureCrmPoolSettings(context.workspaceId) : undefined;
    const poolEnabled = Boolean(settings?.enabled && settings.objectKeys.includes(objectKey));
    if (poolEnabled) {
      if (query.pool === "public") {
        clauses.push(Prisma.sql`"ownerId" IS NULL`);
      } else if (query.pool === "private") {
        clauses.push(canManageAllRecords(context) ? Prisma.sql`"ownerId" IS NOT NULL` : Prisma.sql`"ownerId" = ${context.user.id}`);
      } else if (!canManageAllRecords(context)) {
        clauses.push(Prisma.sql`("ownerId" IS NULL OR "ownerId" = ${context.user.id})`);
      }
    } else if (!canManageAllRecords(context)) {
      clauses.push(Prisma.sql`"ownerId" IN (${Prisma.join(await this.visibleOwnerIds(context))})`);
    }

    for (const filter of filters) {
      clauses.push(recordFilterSql(objectKey, filter.field, filter.operator, filter.value));
    }

    const tagFilters = uniqueTags(query.tags ?? []);
    if (tagFilters.length > 0) {
      clauses.push(Prisma.sql`"tags" @> ${tagFilters}::text[]`);
    }

    const search = query.q?.trim();
    if (search) {
      clauses.push(recordSearchSql(objectKey, search));
    }

    return Prisma.sql`(${Prisma.join(clauses, " AND ")})`;
  }

  private async findRecordsPage(
    whereSql: Prisma.Sql,
    query: RecordListQuery,
    skip: number,
    take: number
  ): Promise<CrmRecord[]> {
    const orderBySql = recordOrderBySql(query.sort);
    const rows = await this.db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "CrmRecord"
      WHERE ${whereSql}
      ORDER BY ${orderBySql}
      OFFSET ${skip}
      LIMIT ${take}
    `);

    if (rows.length === 0) {
      return [];
    }

    const order = new Map(rows.map((row, index) => [row.id, index]));
    const records = await this.findRecordsByIds(rows.map((row) => row.id), query.fields);
    return records.map(mapRecord).sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
  }

  private async findRecordsKeysetPage(whereSql: Prisma.Sql, query: RecordListQuery, take: number): Promise<{ records: CrmRecord[]; nextCursor?: string }> {
    const cursor = decodeRecordCursor(query.cursor);
    const cursorSql = cursor
      ? Prisma.sql`AND ("updatedAt" < ${cursor.updatedAt} OR ("updatedAt" = ${cursor.updatedAt} AND "id" > ${cursor.id}))`
      : Prisma.empty;
    const rows = await this.db.$queryRaw<Array<{ id: string; updatedAt: Date }>>(Prisma.sql`
      SELECT "id", "updatedAt"
      FROM "CrmRecord"
      WHERE ${whereSql}
        ${cursorSql}
      ORDER BY "updatedAt" DESC, "id" ASC
      LIMIT ${take + 1}
    `);
    const visibleRows = rows.slice(0, take);
    if (visibleRows.length === 0) {
      return { records: [] };
    }

    const order = new Map(visibleRows.map((row, index) => [row.id, index]));
    const records = (await this.findRecordsByIds(visibleRows.map((row) => row.id), query.fields))
      .map(mapRecord)
      .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
    const lastRow = visibleRows[visibleRows.length - 1];
    return {
      records,
      nextCursor: rows.length > take ? encodeRecordCursor(lastRow.updatedAt, lastRow.id) : undefined
    };
  }

  private async findRecordsByIds(ids: string[], fields?: string[]): Promise<Parameters<typeof mapRecord>[0][]> {
    if (ids.length === 0) {
      return [];
    }

    const dataSql = recordDataProjectionSql(fields);
    return this.db.$queryRaw<Parameters<typeof mapRecord>[0][]>(Prisma.sql`
      SELECT "id", "workspaceId", "objectKey", "title", "stageKey", "ownerId", "tags", "tagColors", ${dataSql} AS "data", "createdAt", "updatedAt"
      FROM "CrmRecord"
      WHERE "id" IN (${Prisma.join(ids)})
    `);
  }

  private async visibleActivityWhere(context: RequestContext): Promise<Prisma.ActivityWhereInput> {
    const accessWhere = await this.recordAccessWhere(context);
    return {
      workspaceId: context.workspaceId,
      OR: [
        {
          record: {
            is: {
              workspaceId: context.workspaceId,
              ...accessWhere
            }
          }
        },
        canManageAllRecords(context) ? { recordId: null } : { recordId: null, actorId: context.user.id }
      ]
    };
  }

  private async sumDealAmount(context: RequestContext): Promise<number> {
    const ownerFilter = canManageAllRecords(context)
      ? Prisma.empty
      : Prisma.sql`AND "ownerId" IN (${Prisma.join(await this.visibleOwnerIds(context))})`;
    const rows = await this.db.$queryRaw<Array<{ total: string | number | null }>>(Prisma.sql`
      SELECT COALESCE(
        SUM(
          CASE
            WHEN ("data"->>'amount') ~ '^-?[0-9]+(\.[0-9]+)?$'
            THEN ("data"->>'amount')::numeric
            ELSE 0
          END
        ),
        0
      ) AS total
      FROM "CrmRecord"
      WHERE "workspaceId" = ${context.workspaceId}
        AND "objectKey" = 'deals'
        ${ownerFilter}
    `);

    return Number(rows[0]?.total ?? 0);
  }

  private async visibleOwnerIds(context: RequestContext): Promise<string[]> {
    const teamUserIds = context.user.teamId
      ? await this.db.user.findMany({
          where: { workspaceId: context.workspaceId, teamId: context.user.teamId },
          select: { id: true }
        })
      : [];

    return Array.from(new Set([context.user.id, ...teamUserIds.map((user) => user.id)]));
  }

  private async visibleRecordIds(context: RequestContext): Promise<string[]> {
    const records = await this.db.crmRecord.findMany({
      where: {
        workspaceId: context.workspaceId,
        ...(await this.recordAccessWhere(context))
      },
      select: { id: true }
    });

    return records.map((record) => record.id);
  }

  private async assertRoleNameAvailable(context: RequestContext, name: string, currentRoleId?: string): Promise<void> {
    const duplicate = await this.db.role.findFirst({
      where: {
        workspaceId: context.workspaceId,
        name,
        id: currentRoleId ? { not: currentRoleId } : undefined
      },
      select: { id: true }
    });
    if (duplicate) {
      throw new Error("Role name already exists");
    }
  }

  private async assertPoolObjectEnabled(context: RequestContext, objectKey: string): Promise<void> {
    await this.requireObject(context, objectKey);
    const settings = await this.ensureCrmPoolSettings(context.workspaceId);
    if (!settings.enabled || !settings.objectKeys.includes(objectKey)) {
      throw new Error("公海/私海机制仅支持已启用的联系人和公司对象");
    }
  }

  private async assertTeamNameAvailable(context: RequestContext, name: string, currentTeamId?: string): Promise<void> {
    const duplicate = await this.db.team.findFirst({
      where: {
        workspaceId: context.workspaceId,
        name,
        id: currentTeamId ? { not: currentTeamId } : undefined
      },
      select: { id: true }
    });
    if (duplicate) {
      throw new Error("Team name already exists");
    }
  }

  private async assertWorkspaceKeepsAdminUser(context: RequestContext, demotedRoleId: string): Promise<void> {
    const adminUsers = await this.db.user.findMany({
      where: {
        workspaceId: context.workspaceId,
        roleId: { not: demotedRoleId }
      },
      include: { role: true }
    });
    if (!adminUsers.some((user) => user.role?.permissions.includes("crm.admin"))) {
      throw new Error("At least one user must keep crm.admin permission");
    }
  }

  private async assertWorkspaceKeepsAdminUserAfterUserRoleChange(context: RequestContext, changedUserId: string): Promise<void> {
    const adminUsers = await this.db.user.findMany({
      where: {
        workspaceId: context.workspaceId,
        id: { not: changedUserId }
      },
      include: { role: true }
    });
    if (!adminUsers.some((user) => user.role?.permissions.includes("crm.admin"))) {
      throw new Error("At least one user must keep crm.admin permission");
    }
  }

  private async normalizeUserInput(
    context: RequestContext,
    input: Pick<User, "email" | "name" | "roleId"> & Pick<Partial<User>, "teamId">
  ): Promise<Pick<User, "email" | "name" | "roleId"> & Pick<Partial<User>, "teamId">> {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    const roleId = input.roleId.trim();
    const teamId = input.teamId?.trim() || undefined;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("User email must be valid");
    }
    if (!name) {
      throw new Error("User name is required");
    }

    const role = await this.db.role.findFirst({
      where: { id: roleId, workspaceId: context.workspaceId },
      select: { id: true }
    });
    if (!role) {
      throw new Error("Role not found");
    }

    if (teamId) {
      const team = await this.db.team.findFirst({
        where: { id: teamId, workspaceId: context.workspaceId },
        select: { id: true }
      });
      if (!team) {
        throw new Error("Team not found");
      }
    }

    return { email, name, roleId, teamId };
  }

  private async ensureEmailAiSettings(workspaceId: string): Promise<EmailAiSettings> {
    const settings = await this.db.emailAiSettings.findUnique({ where: { workspaceId } });
    if (settings) {
      return mapEmailAiSettings(settings);
    }
    const defaults = createDefaultEmailAiSettings(workspaceId, new Date().toISOString());
    const created = await this.db.emailAiSettings.create({
      data: {
        workspaceId,
        features: defaults.features as Prisma.InputJsonValue,
        agents: defaults.agents as unknown as Prisma.InputJsonValue,
        encryptedProviderConfig: null,
        defaultLocale: defaults.defaultLocale,
        requireSourceLinks: defaults.requireSourceLinks,
        maxHistoryMessages: defaults.maxHistoryMessages,
        maxKnowledgeArticles: defaults.maxKnowledgeArticles,
        maxContextChars: defaults.maxContextChars
      }
    });
    return mapEmailAiSettings(created);
  }

  private async ensureSmartReminderSettings(workspaceId: string): Promise<SmartReminderSettings> {
    const settings = await this.db.smartReminderSettings.findUnique({ where: { workspaceId } });
    if (settings) {
      return mapSmartReminderSettings(settings);
    }
    const created = await this.db.smartReminderSettings.create({
      data: {
        workspaceId,
        enabled: true,
        dailyAt: "08:30",
        maxPerUser: 10,
        objectKeys: ["contacts", "companies", "deals", "emails", "tasks", "activities"],
        notifyCreated: false,
        notifyDailyDigest: false
      }
    });
    return mapSmartReminderSettings(created);
  }

  private async buildSmartReminderContext(
    context: RequestContext,
    input: { objectKey?: string; recordId?: string; objectKeys?: string[] }
  ): Promise<SmartReminderGenerationContext> {
    const accessWhere = await this.recordAccessWhere(context);
    const activityWhere = await this.visibleActivityWhere(context);
    const enabledKeys = new Set(input.objectKeys?.length ? input.objectKeys : ["contacts", "companies", "deals", "emails", "tasks", "activities"]);
    const crmObjectKeys = ["contacts", "companies", "deals"].filter((key) => enabledKeys.has(key));
    const recordWhere: Prisma.CrmRecordWhereInput = {
      workspaceId: context.workspaceId,
      ...(input.objectKey ? { objectKey: input.objectKey } : { objectKey: { in: crmObjectKeys } }),
      ...(input.recordId ? { id: input.recordId } : {}),
      ...accessWhere
    };
    const [records, tasks, recentActivities, emailThreads, knowledge] = await Promise.all([
      this.db.crmRecord.findMany({ where: recordWhere, orderBy: { updatedAt: "asc" }, take: 80 }),
      enabledKeys.has("tasks")
        ? this.db.activity.findMany({
            where: { ...activityWhere, type: "task", completedAt: null, archivedAt: null },
            orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
            take: 80
          })
        : Promise.resolve([]),
      enabledKeys.has("activities") ? this.db.activity.findMany({ where: activityWhere, orderBy: { createdAt: "desc" }, take: 120 }) : Promise.resolve([]),
      enabledKeys.has("emails")
        ? this.db.emailThread.findMany({
            where: {
              workspaceId: context.workspaceId,
              ...(input.recordId ? { recordId: input.recordId } : {})
            },
            orderBy: { lastMessageAt: "desc" },
            take: 40
          })
        : Promise.resolve([]),
      this.db.knowledgeArticle.findMany({ where: { workspaceId: context.workspaceId, active: true }, orderBy: { updatedAt: "desc" }, take: 6 })
    ]);
    const mappedRecords = records.map(mapRecord);
    const visibleRecordIds = new Set(mappedRecords.map((record) => record.id));
    const mappedTasks = tasks.map(mapActivity).filter((activity) => !activity.recordId || visibleRecordIds.has(activity.recordId));
    const mappedRecentActivities = recentActivities.map(mapActivity).filter((activity) => !activity.recordId || visibleRecordIds.has(activity.recordId)).slice(0, 80);
    const mappedEmailThreads = emailThreads.map((thread) => mapEmailThread(thread)).filter((thread) => !thread.recordId || visibleRecordIds.has(thread.recordId)).slice(0, 30);
    return {
      user: { id: context.user.id, name: context.user.name, email: context.user.email },
      records: mappedRecords,
      tasks: mappedTasks,
      recentActivities: mappedRecentActivities,
      emailThreads: mappedEmailThreads,
      knowledge: knowledge.map(mapKnowledgeArticle),
      portfolioMetrics: buildSmartReminderPortfolioMetrics({
        records: mappedRecords,
        tasks: mappedTasks,
        recentActivities: mappedRecentActivities,
        emailThreads: mappedEmailThreads
      })
    };
  }

  private async generateAiSmartReminderCandidates(
    context: RequestContext,
    payload: SmartReminderGenerationContext
  ): Promise<SmartReminderCandidate[]> {
    const settings = await this.ensureEmailAiSettings(context.workspaceId);
    const agent = getGlobalAiAgentSetting(settings, smartReminderPlannerAgentKey);
    if (!agent) {
      return [];
    }
    const providerConfig = await this.getEmailAiProviderConfigForWorkspace(context.workspaceId);
    const result = await runAiAgent(
      {
        agentKey: smartReminderPlannerAgentKey,
        task: "生成今日最佳行动、组合运营、数据质量、客户等级、管道推进和跟进行动建议。优化整体销售产出。只返回 JSON，title、body、actionLabel 使用简体中文。",
        context: {
          user: payload.user,
          portfolioMetrics: payload.portfolioMetrics,
          records: payload.records.slice(0, 60).map((record) => ({
            id: record.id,
            objectKey: record.objectKey,
            title: record.title,
            stageKey: record.stageKey,
            ownerId: record.ownerId,
            updatedAt: record.updatedAt,
            data: record.data
          })),
          tasks: payload.tasks.slice(0, 40),
          recentActivities: payload.recentActivities.slice(0, 40),
          emailThreads: payload.emailThreads.slice(0, 20).map((thread) => ({
            id: thread.id,
            recordId: thread.recordId,
            subject: thread.subject,
            summary: thread.summary,
            aiAnalysis: thread.aiAnalysis,
            lastMessageAt: thread.lastMessageAt
          })),
          knowledge: payload.knowledge.slice(0, 4).map((article) => ({ title: article.title, tags: article.tags, body: article.body.slice(0, 800) }))
        },
        expectedOutput: "text"
      },
      { agent, providerConfig, providerProfiles: settings.providerProfiles }
    );
    return parseSmartReminderCandidates(result.structured ?? result.text, payload);
  }

  private async upsertSmartReminderCandidate(context: RequestContext, candidate: SmartReminderCandidate): Promise<SmartReminder> {
    const settings = await this.ensureSmartReminderSettings(context.workspaceId);
    const dateKey = new Date().toISOString().slice(0, 10);
    const idempotencyKey = [
      dateKey,
      candidate.kind,
      candidate.objectKey ?? "none",
      candidate.recordId ?? "none",
      normalizeIdempotencyText(candidate.title)
    ].join(":");
    const reminder = await this.db.smartReminder.upsert({
      where: {
        workspaceId_userId_idempotencyKey: {
          workspaceId: context.workspaceId,
          userId: context.user.id,
          idempotencyKey
        }
      },
      create: {
        workspaceId: context.workspaceId,
        userId: context.user.id,
        objectKey: candidate.objectKey,
        recordId: candidate.recordId,
        kind: candidate.kind,
        priority: candidate.priority,
        title: candidate.title,
        body: candidate.body,
        actionLabel: candidate.actionLabel,
        dueAt: candidate.dueAt ? new Date(candidate.dueAt) : undefined,
        sources: candidate.sources as unknown as Prisma.InputJsonValue,
        score: candidate.score,
        idempotencyKey,
        generatedByAgentKey: smartReminderPlannerAgentKey
      },
      update: {
        priority: candidate.priority,
        body: candidate.body,
        actionLabel: candidate.actionLabel,
        dueAt: candidate.dueAt ? new Date(candidate.dueAt) : undefined,
        sources: candidate.sources as unknown as Prisma.InputJsonValue,
        score: candidate.score,
        status: "open"
      }
    });
    const mapped = mapSmartReminder(reminder);
    if (settings.notifyCreated) {
      this.emitNotificationEvent(context, "ai.reminder.created", {
        reminderId: mapped.id,
        title: mapped.title,
        objectKey: mapped.objectKey,
        recordId: mapped.recordId,
        priority: mapped.priority,
        dueAt: mapped.dueAt
      });
    }
    return mapped;
  }

  private async getSmartReminderForAction(context: RequestContext, id: string): Promise<SmartReminder> {
    const reminder = await this.db.smartReminder.findFirst({
      where: {
        id,
        workspaceId: context.workspaceId,
        ...(canManageAllRecords(context) ? {} : { userId: context.user.id })
      }
    });
    if (!reminder) {
      throw new Error("Smart reminder not found");
    }
    return mapSmartReminder(reminder);
  }

  private async pruneStaleSmartReminderRecordSources(context: RequestContext, reminders: SmartReminder[]): Promise<SmartReminder[]> {
    const referencedRecords = new Map<string, { objectKey: string; recordId: string }>();
    const referencedEmailThreadIds = new Set<string>();
    const referencedEmailMessageIds = new Set<string>();
    for (const reminder of reminders) {
      if (reminder.objectKey && reminder.recordId) {
        if (isSmartReminderEmailReference(reminder.objectKey)) {
          referencedEmailThreadIds.add(reminder.recordId);
          referencedEmailMessageIds.add(reminder.recordId);
        } else {
          referencedRecords.set(`${reminder.objectKey}:${reminder.recordId}`, { objectKey: reminder.objectKey, recordId: reminder.recordId });
        }
      }
      for (const source of reminder.sources) {
        if (source.objectKey && source.recordId) {
          if (isSmartReminderEmailReference(source.objectKey)) {
            referencedEmailThreadIds.add(source.recordId);
            referencedEmailMessageIds.add(source.recordId);
          } else {
            referencedRecords.set(`${source.objectKey}:${source.recordId}`, { objectKey: source.objectKey, recordId: source.recordId });
          }
        }
        if (source.threadId) {
          referencedEmailThreadIds.add(source.threadId);
        }
        if (source.messageId) {
          referencedEmailMessageIds.add(source.messageId);
        }
      }
    }
    if (referencedRecords.size === 0 && referencedEmailThreadIds.size === 0 && referencedEmailMessageIds.size === 0) {
      return reminders;
    }

    const existingRecords =
      referencedRecords.size > 0
        ? await this.db.crmRecord.findMany({
            where: {
              workspaceId: context.workspaceId,
              OR: Array.from(referencedRecords.values()).map((reference) => ({ id: reference.recordId, objectKey: reference.objectKey }))
            },
            select: { id: true, objectKey: true }
          })
        : [];
    const existingRecordKeys = new Set(existingRecords.map((record) => `${record.objectKey}:${record.id}`));
    const visibleEmailThreadIds = await this.visibleEmailThreadIds(context, referencedEmailThreadIds);
    const visibleEmailMessageIds = await this.visibleEmailMessageIds(context, referencedEmailMessageIds);
    const staleReminderIds: string[] = [];
    const sourceUpdates: Array<{ id: string; sources: SmartReminder["sources"] }> = [];
    const visibleReminders: SmartReminder[] = [];

    for (const reminder of reminders) {
      if (reminder.objectKey && reminder.recordId && !smartReminderTargetExists(reminder.objectKey, reminder.recordId, existingRecordKeys, visibleEmailThreadIds, visibleEmailMessageIds)) {
        staleReminderIds.push(reminder.id);
        continue;
      }

      let hadReferencedSources = false;
      let changedSources = false;
      const sources = reminder.sources.filter((source) => {
        let exists = true;
        if (source.objectKey && source.recordId) {
          hadReferencedSources = true;
          exists = smartReminderTargetExists(source.objectKey, source.recordId, existingRecordKeys, visibleEmailThreadIds, visibleEmailMessageIds);
        }
        if (exists && source.threadId) {
          hadReferencedSources = true;
          exists = visibleEmailThreadIds.has(source.threadId);
        }
        if (exists && source.messageId) {
          hadReferencedSources = true;
          exists = visibleEmailMessageIds.has(source.messageId);
        }
        if (!exists) {
          changedSources = true;
        }
        return exists;
      });

      if (!reminder.recordId && hadReferencedSources && sources.length === 0) {
        staleReminderIds.push(reminder.id);
        continue;
      }
      if (changedSources) {
        sourceUpdates.push({ id: reminder.id, sources });
      }
      visibleReminders.push(changedSources ? { ...reminder, sources } : reminder);
    }

    if (staleReminderIds.length > 0) {
      await this.db.smartReminder.deleteMany({
        where: { workspaceId: context.workspaceId, id: { in: staleReminderIds } }
      });
    }
    await Promise.all(sourceUpdates.map((update) =>
      this.db.smartReminder.update({
        where: { id: update.id },
        data: { sources: toJsonArray(update.sources) }
      })
    ));
    return visibleReminders;
  }

  private async visibleEmailThreadIds(context: RequestContext, threadIds: Set<string>): Promise<Set<string>> {
    const visible = new Set<string>();
    await Promise.all(Array.from(threadIds).map(async (threadId) => {
      try {
        await this.assertEmailThread(context, threadId);
        visible.add(threadId);
      } catch {
        // Stale or inaccessible smart reminder source.
      }
    }));
    return visible;
  }

  private async visibleEmailMessageIds(context: RequestContext, messageIds: Set<string>): Promise<Set<string>> {
    const visible = new Set<string>();
    await Promise.all(Array.from(messageIds).map(async (messageId) => {
      try {
        await this.getEmailMessage(context, messageId);
        visible.add(messageId);
      } catch {
        // Stale or inaccessible smart reminder source.
      }
    }));
    return visible;
  }

  private async getEmailAiProviderConfigForWorkspace(workspaceId: string): Promise<AiProviderConfig> {
    const settings = await this.db.emailAiSettings.findUnique({ where: { workspaceId } });
    const bundle = readAiProviderSettingsBundleFromEncrypted(settings?.encryptedProviderConfig);
    return resolveAiProviderConfigForAgent(bundle.providerConfig, bundle.providerProfiles, {});
  }

  private async getEmailAiProviderProfilesForWorkspace(workspaceId: string): Promise<AiProviderProfile[]> {
    const settings = await this.db.emailAiSettings.findUnique({ where: { workspaceId } });
    return readAiProviderSettingsBundleFromEncrypted(settings?.encryptedProviderConfig).providerProfiles;
  }

  private async ensureKnowledgeVectorSettings(workspaceId: string): Promise<KnowledgeVectorSettings> {
    const settings = await this.db.knowledgeVectorSettings.findUnique({ where: { workspaceId } });
    if (settings) {
      return mapKnowledgeVectorSettings(settings);
    }
    const defaults = normalizeKnowledgeVectorSettings(workspaceId, defaultKnowledgeVectorSettings);
    const created = await this.db.knowledgeVectorSettings.create({
      data: {
        workspaceId,
        enabled: defaults.enabled,
        providerProfileKey: defaults.providerProfileKey,
        embeddingModel: defaults.embeddingModel,
        dimensions: defaults.dimensions,
        chunkSizeChars: defaults.chunkSizeChars,
        chunkOverlapChars: defaults.chunkOverlapChars,
        topK: defaults.topK,
        similarityThreshold: defaults.similarityThreshold
      }
    });
    return mapKnowledgeVectorSettings(created);
  }

  private async resolveKnowledgeEmbeddingProviderConfig(workspaceId: string, settings: KnowledgeVectorSettings): Promise<AiProviderConfig> {
    const providerConfig = await this.getEmailAiProviderConfigForWorkspace(workspaceId);
    const providerProfiles = await this.getEmailAiProviderProfilesForWorkspace(workspaceId);
    return resolveAiProviderConfigForAgent(providerConfig, providerProfiles, {
      providerProfileKey: settings.providerProfileKey,
      model: settings.embeddingModel
    });
  }

  private async searchKnowledgeArticlesByVector(context: RequestContext, queryText: string, limit: number): Promise<KnowledgeArticle[]> {
    const settings = await this.ensureKnowledgeVectorSettings(context.workspaceId);
    if (!settings.enabled || !queryText.trim()) {
      return [];
    }
    try {
      const providerConfig = await this.resolveKnowledgeEmbeddingProviderConfig(context.workspaceId, settings);
      const embedding = await createEmbedding({
        config: providerConfig,
        text: queryText,
        model: settings.embeddingModel,
        dimensions: settings.dimensions
      });
      const rows = await this.db.$queryRaw<
        Array<{
          id: string;
          workspaceId: string;
          title: string;
          body: string;
          tags: string[];
          active: boolean;
          createdById: string;
          createdAt: Date;
          updatedAt: Date;
          chunkText: string;
          similarity: number;
          status: string;
          errorMessage: string | null;
          embeddingModel: string;
          dimensions: number;
          indexedAt: Date | null;
          chunkUpdatedAt: Date;
        }>
      >`
        SELECT
          article."id",
          article."workspaceId",
          article."title",
          article."body",
          article."tags",
          article."active",
          article."createdById",
          article."createdAt",
          article."updatedAt",
          chunk."chunkText",
          1 - (chunk."embedding" <=> ${toPgVectorLiteral(embedding)}::vector) AS "similarity",
          chunk."status",
          chunk."errorMessage",
          chunk."embeddingModel",
          chunk."dimensions",
          chunk."indexedAt",
          chunk."updatedAt" AS "chunkUpdatedAt"
        FROM "KnowledgeEmbeddingChunk" chunk
        INNER JOIN "KnowledgeArticle" article ON article."id" = chunk."articleId"
        WHERE chunk."workspaceId" = ${context.workspaceId}
          AND article."active" = true
          AND chunk."status" = 'indexed'
          AND chunk."embedding" IS NOT NULL
        ORDER BY chunk."embedding" <=> ${toPgVectorLiteral(embedding)}::vector
        LIMIT ${limit}
      `;
      const byArticleId = new Map<string, KnowledgeArticle>();
      for (const row of rows) {
        if (row.similarity < settings.similarityThreshold || byArticleId.has(row.id)) {
          continue;
        }
        byArticleId.set(
          row.id,
          mapKnowledgeArticle({
            id: row.id,
            workspaceId: row.workspaceId,
            title: row.title,
            body: row.chunkText,
            tags: row.tags,
            active: row.active,
            createdById: row.createdById,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            embeddingChunks: [
              {
                status: row.status,
                errorMessage: row.errorMessage,
                embeddingModel: row.embeddingModel,
                dimensions: row.dimensions,
                indexedAt: row.indexedAt,
                updatedAt: row.chunkUpdatedAt
              }
            ]
          })
        );
      }
      return Array.from(byArticleId.values()).slice(0, limit);
    } catch {
      return [];
    }
  }

  private async ensureEmailSyncSettings(workspaceId: string): Promise<EmailSyncSettings> {
    const settings = await this.db.emailSyncSettings.findUnique({ where: { workspaceId } });
    if (settings) {
      return mapEmailSyncSettings(settings);
    }
    const created = await this.db.emailSyncSettings.create({
      data: {
        workspaceId,
        enabled: true,
        mode: "interval",
        intervalMinutes: 5,
        dailyAt: "03:00",
        limit: 25
      }
    });
    return mapEmailSyncSettings(created);
  }

  private async ensureCrmPoolSettings(workspaceId: string): Promise<CrmPoolSettings> {
    const settings = await this.db.crmPoolSettings.findUnique({ where: { workspaceId } });
    if (settings) {
      return mapCrmPoolSettings(settings);
    }
    const created = await this.db.crmPoolSettings.create({
      data: {
        workspaceId,
        objectKeys: [...POOL_OBJECT_KEYS],
        privateLimit: 100,
        autoReclaimEnabled: true,
        autoReclaimDays: 30,
        levelRules: defaultCrmPoolLevelRules as unknown as Prisma.InputJsonValue
      }
    });
    return mapCrmPoolSettings(created);
  }

  private async ensureDefaultEmailSignatures(context: RequestContext): Promise<void> {
    const count = await this.db.emailSignature.count({ where: { workspaceId: context.workspaceId } });
    if (count > 0) {
      return;
    }
    await this.db.emailSignature.createMany({
      data: [
        {
          id: `email_signature_default_${context.workspaceId}`,
          workspaceId: context.workspaceId,
          accountId: null,
          name: "榛樿绛惧悕",
          bodyText: "Best regards,\n{{senderEmail}}",
          bodyHtml: "<p>Best regards,<br>{{senderEmail}}</p>",
          isDefault: true,
          active: true,
          createdById: context.user.id
        },
        {
          id: `email_signature_cn_sales_${context.workspaceId}`,
          workspaceId: context.workspaceId,
          accountId: null,
          name: "涓枃鍟嗗姟绛惧悕",
          bodyText: "璋㈣阿锛孿n{{senderEmail}}",
          bodyHtml: "<p>璋㈣阿锛?br>{{senderEmail}}</p>",
          isDefault: false,
          active: true,
          createdById: context.user.id
        }
      ],
      skipDuplicates: true
    });
  }

  private async clearDefaultEmailSignatures(workspaceId: string, accountId: string | null, exceptSignatureId?: string): Promise<void> {
    await this.db.emailSignature.updateMany({
      where: {
        workspaceId,
        accountId,
        isDefault: true,
        ...(exceptSignatureId ? { id: { not: exceptSignatureId } } : {})
      },
      data: { isDefault: false }
    });
  }

  private async normalizeEmailSignatureAccountId(context: RequestContext, accountId?: string | null): Promise<string | null> {
    const normalized = accountId?.trim();
    if (!normalized) {
      return null;
    }
    await this.assertEmailAccount(context, normalized);
    return normalized;
  }

  private async normalizeEmailAccountDefaultSignatureId(context: RequestContext, signatureId?: string | null, accountId?: string): Promise<string | null> {
    const normalized = signatureId?.trim();
    if (!normalized) {
      return null;
    }
    const signature = await this.assertEmailSignature(context, normalized);
    if (!signature.active) {
      throw new Error("Default email signature must be active");
    }
    if (signature.accountId && signature.accountId !== accountId) {
      throw new Error("Default email signature must be global or belong to this account");
    }
    return signature.id;
  }

  private async assertEmailSignature(context: RequestContext, signatureId: string): Promise<EmailSignature> {
    const signature = await this.db.emailSignature.findFirst({
      where: { id: signatureId, workspaceId: context.workspaceId }
    });
    if (!signature) {
      throw new Error("Email signature not found");
    }
    return mapEmailSignature(signature);
  }

  private async assertEmailAccount(context: RequestContext, accountId: string): Promise<EmailAccount> {
    const account = await this.db.emailAccount.findFirst({
      where: { id: accountId, workspaceId: context.workspaceId }
    });
    if (!account) {
      throw new Error("Email account not found");
    }
    return mapEmailAccount(account);
  }

  private async assertEmailAccountEmailAvailable(context: RequestContext, emailAddress: string, exceptAccountId?: string): Promise<void> {
    const existing = await this.db.emailAccount.findFirst({
      where: {
        workspaceId: context.workspaceId,
        emailAddress,
        ...(exceptAccountId ? { id: { not: exceptAccountId } } : {})
      },
      select: { id: true }
    });
    if (existing) {
      throw new Error("Email account address already exists");
    }
  }

  private async assertEmailThread(context: RequestContext, threadId: string): Promise<EmailThread> {
    const thread = await this.db.emailThread.findFirst({
      where: { id: threadId, workspaceId: context.workspaceId }
    });
    if (!thread) {
      throw new Error("Email thread not found");
    }
    if (thread.recordId) {
      await this.assertVisibleRecord(context, thread.recordId);
    } else if (!canManageAllRecords(context)) {
      const ownMessageCount = await this.db.emailMessage.count({
        where: { workspaceId: context.workspaceId, threadId: thread.id, createdById: context.user.id }
      });
      if (ownMessageCount === 0) {
        throw new Error("Email thread not found");
      }
    }
    const state = await this.db.emailThreadState.findUnique({
      where: { workspaceId_threadId_userId: { workspaceId: context.workspaceId, threadId: thread.id, userId: context.user.id } }
    });
    return mapEmailThread(thread, state);
  }

  private async assertTalkTargetAccess(context: RequestContext, target: TalkMessageTargetInput): Promise<void> {
    if (target.type === "record") {
      await this.getRecord(context, target.objectKey, target.recordId);
      return;
    }
    await this.assertEmailThread(context, target.threadId);
  }

  private async emailThreadAccessWhere(context: RequestContext): Promise<Prisma.EmailThreadWhereInput> {
    if (canManageAllRecords(context)) {
      return {};
    }

    const ownerIds = await this.visibleOwnerIds(context);
    const visibleRecords = await this.db.crmRecord.findMany({
      where: { workspaceId: context.workspaceId, ownerId: { in: ownerIds } },
      select: { id: true }
    });
    const ownMessages = await this.db.emailMessage.findMany({
      where: { workspaceId: context.workspaceId, createdById: context.user.id },
      select: { threadId: true },
      distinct: ["threadId"]
    });

    return {
      OR: [
        { recordId: { in: visibleRecords.map((record) => record.id) } },
        { recordId: null, id: { in: ownMessages.map((message) => message.threadId) } }
      ]
    };
  }

  private async findMatchingEmailThread(
    context: RequestContext,
    accountId: string,
    accountEmail: string,
    subject: string,
    participants: string[],
    recordId?: string
  ): Promise<EmailThread | undefined> {
    const normalizedSubject = normalizeEmailSubject(subject);
    if (!normalizedSubject) {
      return undefined;
    }
    const accountAddress = normalizeEmailAddress(accountEmail);
    const participantSet = new Set(uniqueValidEmails(participants).filter((email) => email !== accountAddress));
    const threads = await this.db.emailThread.findMany({
      where: {
        workspaceId: context.workspaceId,
        accountId,
        ...(recordId ? { OR: [{ recordId }, { recordId: null }] } : {})
      },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      take: 50
    });
    const match = threads.map((thread) => mapEmailThread(thread)).find((thread) => {
      if (normalizeEmailSubject(thread.subject) !== normalizedSubject) {
        return false;
      }
      if (recordId && thread.recordId === recordId) {
        return true;
      }
      return thread.participantEmails.some((email) => {
        const normalized = tryNormalizeEmailAddress(email);
        return normalized !== undefined && normalized !== accountAddress && participantSet.has(normalized);
      });
    });
    if (!match) {
      return undefined;
    }
    return match.recordId ? this.assertEmailThread(context, match.id) : match;
  }

  private async findVisibleRecordByEmailParticipants(context: RequestContext, accountEmail: string, participants: string[]): Promise<CrmRecord | undefined> {
    const accountAddress = normalizeEmailAddress(accountEmail);
    const emails = uniqueValidEmails(participants).filter((email) => email !== accountAddress);
    for (const email of emails) {
      const records = await this.db.crmRecord.findMany({
        where: {
          workspaceId: context.workspaceId,
          objectKey: "contacts",
          ...(await this.recordAccessWhere(context))
        },
        orderBy: [{ updatedAt: "desc" }]
      });
      const record = records.find((candidate) => recordDataHasEmail(candidate.data, email));
      if (record) {
        return mapRecord(record);
      }
    }
    return undefined;
  }

  private async assertVisibleRecord(context: RequestContext, recordId: string): Promise<CrmRecord> {
    const record = await this.db.crmRecord.findFirst({
      where: {
        id: recordId,
        workspaceId: context.workspaceId,
        ...(await this.recordAccessWhere(context))
      }
    });
    if (!record) {
      throw new Error("Record not found");
    }
    return mapRecord(record);
  }

  private async resolveEmailThreadCommandScope(context: RequestContext, command: NonNullable<EmailThreadListQuery["command"]>): Promise<EmailThreadCommandScope> {
    const value = command.value.trim().toLowerCase();
    if (!value) {
      return { recordIds: new Set(), emails: new Set() };
    }
    const rows = await this.db.crmRecord.findMany({
      where: {
        workspaceId: context.workspaceId,
        objectKey: { in: ["contacts", "companies", "deals"] },
        ...(await this.recordAccessWhere(context))
      }
    });
    const visibleRecords = rows.map(mapRecord);
    const recordIds = new Set<string>();
    const emails = new Set<string>();
    const addContact = (contact: CrmRecord) => {
      recordIds.add(contact.id);
      getRecordEmailAddresses(contact).forEach((email) => emails.add(email));
    };
    const addCompany = (company: CrmRecord) => {
      recordIds.add(company.id);
      visibleRecords
        .filter((record) => record.objectKey === "contacts" && recordReferencesId(record.data.companyId, company.id))
        .forEach(addContact);
    };

    if (command.type === "contact") {
      visibleRecords
        .filter((record) => record.objectKey === "contacts" && `${record.title} ${getRecordEmailAddresses(record).join(" ")}`.toLowerCase().includes(value))
        .forEach(addContact);
      return { recordIds, emails };
    }

    if (command.type === "company") {
      visibleRecords.filter((record) => record.objectKey === "companies" && record.title.toLowerCase().includes(value)).forEach(addCompany);
      return { recordIds, emails };
    }

    visibleRecords
      .filter((record) => record.objectKey === "deals" && record.title.toLowerCase().includes(value))
      .forEach((deal) => {
        recordIds.add(deal.id);
        const companyId = typeof deal.data.companyId === "string" ? deal.data.companyId : "";
        const company = companyId ? visibleRecords.find((record) => record.objectKey === "companies" && record.id === companyId) : undefined;
        if (company) {
          addCompany(company);
        }
      });
    return { recordIds, emails };
  }

  private async assertVisibleEmailAiSources(context: RequestContext, sources: unknown): Promise<NonNullable<EmailThread["aiAnalysisSources"]>> {
    const normalizedSources = normalizeEmailAiSources(sources);
    for (const source of normalizedSources) {
      if (source.recordId) {
        await this.assertVisibleRecord(context, source.recordId);
      }
      if (source.messageId) {
        await this.getEmailMessage(context, source.messageId);
      }
      if (source.activityId) {
        const activity = await this.db.activity.findFirst({
          where: {
            id: source.activityId,
            ...(await this.visibleActivityWhere(context))
          },
          select: { id: true }
        });
        if (!activity) {
          throw new Error("Activity not found");
        }
      }
      if (source.knowledgeArticleId) {
        const article = await this.db.knowledgeArticle.findFirst({
          where: { id: source.knowledgeArticleId, workspaceId: context.workspaceId },
          select: { id: true }
        });
        if (!article) {
          throw new Error("Knowledge article not found");
        }
      }
    }
    return normalizedSources;
  }

  private async writeAuditLog(
    context: RequestContext,
    action: AuditAction,
    entityType: string,
    entityId: string | undefined,
    input: Pick<AuditLog, "summary"> & Pick<Partial<AuditLog>, "objectKey" | "details">
  ): Promise<void> {
    await this.db.auditLog.create({
      data: {
        workspaceId: context.workspaceId,
        actorId: context.user.id,
        action,
        entityType,
        entityId,
        objectKey: input.objectKey,
        summary: input.summary,
        details: input.details as Prisma.InputJsonValue | undefined
      }
    });
  }

  private async requireObject(context: RequestContext, objectKey: string) {
    const object = await this.db.objectDefinition.findFirst({
      where: {
        workspaceId: context.workspaceId,
        key: objectKey
      }
    });
    if (!object) {
      throw new Error(`Object not found: ${objectKey}`);
    }
    return object;
  }

  private async assertSavedViewFields(context: RequestContext, view: Pick<SavedView, "objectKey" | "columns" | "filters" | "sort">): Promise<void> {
    const fieldKeys = new Set((await this.listFieldDefinitions(context, view.objectKey)).map((field) => field.key));
    const columnKeys = new Set(["title", "ownerId", "stageKey", "tags", ...fieldKeys]);
    const queryKeys = new Set(["title", "ownerId", "stageKey", "tags", "createdAt", "updatedAt", ...fieldKeys]);

    for (const column of view.columns) {
      if (!columnKeys.has(column)) {
        throw new ApiError(400, "VALIDATION_ERROR", `Saved view references unknown column ${column}`);
      }
    }

    for (const filter of view.filters ?? []) {
      if (!queryKeys.has(filter.field)) {
        throw new ApiError(400, "VALIDATION_ERROR", `Saved view references unknown filter field ${filter.field}`);
      }
    }

    if (view.sort?.field && !queryKeys.has(view.sort.field)) {
      throw new ApiError(400, "VALIDATION_ERROR", `Saved view references unknown sort field ${view.sort.field}`);
    }
  }
}

export function getCrmRepository(): PrismaCrmRepository {
  return new PrismaCrmRepository();
}

function buildQueryView(workspaceId: string, objectKey: string, query: RecordListQuery): SavedView {
  return {
    id: "query-view",
    workspaceId,
    objectKey,
    name: "Query",
    columns: ["title"],
    filters: query.filters,
    sort: query.sort,
    isDefault: false
  };
}

function normalizeRoleInput(input: Pick<Role, "name" | "permissions">): Pick<Role, "name" | "permissions"> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Role name is required");
  }

  const allowedPermissions = new Set(permissionCatalog.map((permission) => permission.key));
  const permissions = Array.from(new Set(input.permissions)).filter((permission) => allowedPermissions.has(permission));
  if (permissions.length === 0) {
    throw new Error("Role must include at least one permission");
  }

  if (permissions.length !== new Set(input.permissions).size) {
    throw new Error("Role contains unsupported permissions");
  }

  return { name, permissions };
}

function normalizeApiKeyInput(input: { name: string; permissions: Permission[]; expiresAt?: string }): { name: string; permissions: Permission[]; expiresAt?: string } {
  const name = input.name.trim();
  if (!name) {
    throw new Error("API key name is required");
  }

  const allowedPermissions = new Set<Permission>(["crm.read", "crm.write", "crm.import", "ai.use"]);
  const requestedPermissions = Array.from(new Set(input.permissions));
  const permissions = requestedPermissions.filter((permission) => allowedPermissions.has(permission));
  if (permissions.length !== requestedPermissions.length) {
    throw new Error("API key contains unsupported permissions");
  }
  if (permissions.length === 0) {
    throw new Error("API key must include at least one non-admin permission");
  }

  const expiresAt = input.expiresAt?.trim();
  if (expiresAt && Number.isNaN(new Date(expiresAt).getTime())) {
    throw new Error("API key expiration is invalid");
  }

  return { name, permissions, expiresAt: expiresAt || undefined };
}

function normalizeWebhookInput(input: { name: string; url: string; events: string[]; active?: boolean }): { name: string; url: string; events: WebhookEndpoint["events"]; active: boolean } {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Webhook name is required");
  }

  const url = assertValidWebhookUrl(input.url);

  return {
    name,
    url,
    events: assertValidWebhookEvents(input.events),
    active: input.active ?? true
  };
}

function normalizeNotificationChannelInput(input: {
  name: string;
  type: NotificationChannelType;
  events: string[];
  config: Record<string, unknown>;
  active?: boolean;
}): { name: string; type: NotificationChannelType; events: NotificationEvent[]; config: Record<string, unknown>; active: boolean } {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Notification channel name is required");
  }
  if (!["bark", "webhook", "email"].includes(input.type)) {
    throw new Error("Notification channel type is unsupported");
  }
  const events = assertValidWebhookEvents(input.events);
  const config = asRecord(input.config as Prisma.JsonValue);
  if (input.type === "bark" && typeof config.barkDeviceKey !== "string") {
    throw new Error("Bark device key is required");
  }
  if (input.type === "webhook" && typeof config.url !== "string") {
    throw new Error("Webhook URL is required");
  }
  if (input.type === "email" && (!Array.isArray(config.recipients) || config.recipients.length === 0)) {
    throw new Error("Email recipients are required");
  }
  return {
    name,
    type: input.type,
    events,
    config,
    active: input.active ?? true
  };
}

function buildNotificationBody(event: NotificationEvent, data: Record<string, unknown>): string {
  const lines = [
    `Event: ${event}`,
    typeof data.title === "string" ? `Title: ${data.title}` : "",
    typeof data.objectKey === "string" ? `Object: ${data.objectKey}` : "",
    typeof data.recordId === "string" ? `Record ID: ${data.recordId}` : "",
    typeof data.activityId === "string" ? `Activity ID: ${data.activityId}` : "",
    `Time: ${new Date().toISOString()}`
  ].filter(Boolean);
  return lines.join("\n");
}

function normalizeSmartReminderKind(value: string): SmartReminderKind {
  return [
    "today_best_action",
    "follow_up",
    "overdue",
    "email_reply",
    "deal_close",
    "risk",
    "portfolio_health",
    "data_quality",
    "customer_level",
    "pipeline_optimization"
  ].includes(value)
    ? (value as SmartReminderKind)
    : "follow_up";
}

function normalizeSmartReminderPriority(value: string): SmartReminderPriority {
  return ["low", "medium", "high", "urgent"].includes(value) ? (value as SmartReminderPriority) : "medium";
}

function smartReminderDailyWindowStart(value: string): Date {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  const hours = match ? Number(match[1]) : 8;
  const minutes = match ? Number(match[2]) : 30;
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setHours(hours, minutes, 0, 0);
  return windowStart;
}

function compareSmartReminders(a: SmartReminder, b: SmartReminder): number {
  const priority = smartReminderPriorityWeight(b.priority) - smartReminderPriorityWeight(a.priority);
  if (priority !== 0) return priority;
  const dueA = a.dueAt ? Date.parse(a.dueAt) : Number.MAX_SAFE_INTEGER;
  const dueB = b.dueAt ? Date.parse(b.dueAt) : Number.MAX_SAFE_INTEGER;
  if (dueA !== dueB) return dueA - dueB;
  return b.score - a.score;
}

function smartReminderPriorityWeight(priority: SmartReminderPriority): number {
  return { low: 1, medium: 2, high: 3, urgent: 4 }[priority];
}

function buildSmartReminderPortfolioMetrics(payload: Pick<SmartReminderGenerationContext, "records" | "tasks" | "recentActivities" | "emailThreads">): SmartReminderPortfolioMetrics {
  const now = Date.now();
  const metrics: SmartReminderPortfolioMetrics = {
    totals: { contacts: 0, companies: 0, deals: 0, publicPool: 0, privatePool: 0, unowned: 0 },
    customerLevels: { A: 0, B: 0, C: 0, D: 0, unrated: 0 },
    dataQuality: { lowCompletenessContacts: 0, lowCompletenessCompanies: 0, averageContactCompleteness: 0, averageCompanyCompleteness: 0 },
    stale: { noActivity7Days: 0, noActivity14Days: 0, noActivity30Days: 0, stalePrivateRecords: 0 },
    deals: { highValueStalled: 0, closingSoon: 0, totalOpenAmount: 0 }
  };
  const contactScores: number[] = [];
  const companyScores: number[] = [];
  for (const record of payload.records) {
    if (record.objectKey === "contacts") metrics.totals.contacts += 1;
    if (record.objectKey === "companies") metrics.totals.companies += 1;
    if (record.objectKey === "deals") metrics.totals.deals += 1;
    if (["contacts", "companies"].includes(record.objectKey)) {
      if (record.ownerId) metrics.totals.privatePool += 1;
      else metrics.totals.publicPool += 1;
      if (!record.ownerId) metrics.totals.unowned += 1;
      const level = getEffectiveRecordCustomerLevel(record, payload.records);
      metrics.customerLevels[level ?? "unrated"] += 1;
      const completeness = calculateRecordCompleteness(record, payload.records);
      if (record.objectKey === "contacts") {
        contactScores.push(completeness.score);
        if (completeness.score < 70) metrics.dataQuality.lowCompletenessContacts += 1;
      }
      if (record.objectKey === "companies") {
        companyScores.push(completeness.score);
        if (completeness.score < 70) metrics.dataQuality.lowCompletenessCompanies += 1;
      }
      const lastTouchedAt = getRecordLastTouchedAt(record, payload);
      const ageDays = (now - lastTouchedAt.getTime()) / (24 * 60 * 60 * 1000);
      if (ageDays >= 7) metrics.stale.noActivity7Days += 1;
      if (ageDays >= 14) metrics.stale.noActivity14Days += 1;
      if (ageDays >= 30) metrics.stale.noActivity30Days += 1;
      if (record.ownerId && ageDays >= 14) metrics.stale.stalePrivateRecords += 1;
    }
    if (record.objectKey === "deals") {
      const amount = getRecordAmount(record);
      metrics.deals.totalOpenAmount += amount;
      const lastTouchedAt = getRecordLastTouchedAt(record, payload);
      if (amount >= 50000 && now - lastTouchedAt.getTime() >= 7 * 24 * 60 * 60 * 1000) {
        metrics.deals.highValueStalled += 1;
      }
      const expectedCloseRaw = getStringField(record.data, "expectedCloseDate") || getStringField(record.data, "closeDate");
      const expectedCloseAt = expectedCloseRaw ? new Date(expectedCloseRaw) : undefined;
      if (expectedCloseAt && expectedCloseAt.getTime() >= now && expectedCloseAt.getTime() <= now + 7 * 24 * 60 * 60 * 1000) {
        metrics.deals.closingSoon += 1;
      }
    }
  }
  metrics.dataQuality.averageContactCompleteness = averageRounded(contactScores);
  metrics.dataQuality.averageCompanyCompleteness = averageRounded(companyScores);
  return metrics;
}

function averageRounded(values: number[]): number {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function getStringField(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function getRecordCustomerLevel(record: Pick<CrmRecord, "data">): "A" | "B" | "C" | "D" | undefined {
  const level = getStringField(record.data, "customerLevel").toUpperCase();
  return ["A", "B", "C", "D"].includes(level) ? (level as "A" | "B" | "C" | "D") : undefined;
}

function getEffectiveRecordCustomerLevel(
  record: Pick<CrmRecord, "objectKey" | "data">,
  records: Array<Pick<CrmRecord, "id" | "objectKey" | "data">> = []
): "A" | "B" | "C" | "D" | undefined {
  if (record.objectKey !== "contacts") {
    return getRecordCustomerLevel(record);
  }
  const companyId = getStringField(record.data, "companyId");
  if (companyId) {
    const company = records.find((candidate) => candidate.objectKey === "companies" && candidate.id === companyId);
    return company ? getRecordCustomerLevel(company) : undefined;
  }
  const level = getStringField(record.data, "contactTempCustomerLevel").toUpperCase();
  return ["A", "B", "C", "D"].includes(level) ? (level as "A" | "B" | "C" | "D") : undefined;
}

function isHighCustomerLevel(
  record: Pick<CrmRecord, "objectKey" | "data">,
  records: Array<Pick<CrmRecord, "id" | "objectKey" | "data">> = []
): boolean {
  return ["A", "B"].includes(getEffectiveRecordCustomerLevel(record, records) ?? "");
}

function calculateRecordCompleteness(
  record: Pick<CrmRecord, "objectKey" | "title" | "data">,
  records: Array<Pick<CrmRecord, "id" | "objectKey" | "data">> = []
): { score: number; missing: string[] } {
  const data = record.data ?? {};
  const contactMethods = Array.isArray(data.contactMethods) ? data.contactMethods : [];
  const companyAddresses = Array.isArray(data.addresses) ? data.addresses : [];
  const checks =
    record.objectKey === "companies"
      ? [
          ["名称", Boolean(record.title)],
          ["域名/行业", Boolean(getStringField(data, "domain") || getStringField(data, "industry"))],
          ["地址", Boolean(getStringField(data, "address") || companyAddresses.length)],
          ["主联系人", Boolean(getStringField(data, "primaryContactId") || getStringField(data, "primaryContactEmail"))],
          ["客户等级", Boolean(getEffectiveRecordCustomerLevel(record, records))]
        ]
      : [
          ["名称", Boolean(record.title)],
          ["公司", Boolean(getStringField(data, "companyId") || getStringField(data, "company"))],
          ["主联系方式", Boolean(getStringField(data, "email") || getStringField(data, "phone") || contactMethods.length)],
          ["国家/地区", Boolean(getStringField(data, "country"))],
          ["偏好语言", Boolean(getStringField(data, "preferredLanguage"))],
          ["客户等级", Boolean(getEffectiveRecordCustomerLevel(record, records))]
        ];
  const passed = checks.filter(([, ok]) => ok).length;
  return { score: Math.round((passed / checks.length) * 100), missing: checks.filter(([, ok]) => !ok).map(([label]) => String(label)) };
}

function getRecordLastTouchedAt(
  record: Pick<CrmRecord, "id" | "updatedAt">,
  payload: Pick<SmartReminderGenerationContext, "recentActivities" | "emailThreads">
): Date {
  const candidates = [new Date(record.updatedAt)];
  for (const activity of payload.recentActivities) {
    if (activity.recordId === record.id) {
      candidates.push(new Date(activity.createdAt));
    }
  }
  for (const thread of payload.emailThreads) {
    if (thread.recordId === record.id && thread.lastMessageAt) {
      candidates.push(new Date(thread.lastMessageAt));
    }
  }
  return candidates.sort((left, right) => right.getTime() - left.getTime())[0] ?? new Date(record.updatedAt);
}

function getRecordAmount(record: Pick<CrmRecord, "data">): number {
  const data = record.data ?? {};
  const value = data.amount ?? data.totalAmount ?? data.value;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

function smartReminderSourcesFor(records: Array<Pick<CrmRecord, "id" | "objectKey" | "title">>, limit = 5): SmartReminder["sources"] {
  return records.slice(0, limit).map((record) => ({ label: record.title, objectKey: record.objectKey, recordId: record.id }));
}

function buildFallbackSmartReminderCandidates(context: RequestContext, payload: SmartReminderGenerationContext): SmartReminderCandidate[] {
  const now = new Date();
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const candidates: SmartReminderCandidate[] = [];

  for (const task of payload.tasks) {
    const dueAt = task.dueAt ? new Date(task.dueAt) : undefined;
    if (dueAt && dueAt < now) {
      candidates.push({
        kind: "overdue",
        priority: "urgent",
        title: `逾期任务：${task.title}`,
        body: task.body || "该任务已逾期，建议今天处理或重新安排。",
        actionLabel: "处理逾期任务",
        objectKey: task.recordId ? undefined : "tasks",
        recordId: task.recordId,
        dueAt: task.dueAt,
        sources: [{ label: task.title, recordId: task.recordId, activityId: task.id }],
        score: 95
      });
    } else if (dueAt && dueAt <= todayEnd) {
      candidates.push({
        kind: "today_best_action",
        priority: "high",
        title: `今日任务：${task.title}`,
        body: task.body || "该任务今天到期，建议优先完成。",
        actionLabel: "完成今日任务",
        recordId: task.recordId,
        dueAt: task.dueAt,
        sources: [{ label: task.title, recordId: task.recordId, activityId: task.id }],
        score: 82
      });
    }
  }

  for (const record of payload.records) {
    const lastActivity = payload.recentActivities.find((activity) => activity.recordId === record.id);
    const lastTouchedAt = lastActivity?.createdAt ? new Date(lastActivity.createdAt) : new Date(record.updatedAt);
    const data = record.data ?? {};
    if (record.objectKey === "deals") {
      const expectedCloseRaw = typeof data.expectedCloseDate === "string" ? data.expectedCloseDate : typeof data.closeDate === "string" ? data.closeDate : "";
      const expectedCloseAt = expectedCloseRaw ? new Date(expectedCloseRaw) : undefined;
      if (expectedCloseAt && expectedCloseAt >= now && expectedCloseAt <= sevenDaysAhead) {
        candidates.push({
          kind: "deal_close",
          priority: "high",
          title: `推进临近成交：${record.title}`,
          body: `预计成交日临近（${expectedCloseAt.toISOString().slice(0, 10)}），建议确认阻塞点、下一步和报价有效期。`,
          actionLabel: "安排成交推进",
          objectKey: record.objectKey,
          recordId: record.id,
          dueAt: expectedCloseAt.toISOString(),
          sources: [{ label: record.title, objectKey: record.objectKey, recordId: record.id }],
          score: 88
        });
      }
      if (lastTouchedAt < sevenDaysAgo) {
        candidates.push({
          kind: "follow_up",
          priority: "medium",
          title: `7 天未跟进交易：${record.title}`,
          body: "该交易最近 7 天没有新的活动记录，建议联系客户确认当前状态。",
          actionLabel: "创建跟进任务",
          objectKey: record.objectKey,
          recordId: record.id,
          dueAt: todayEnd.toISOString(),
          sources: [{ label: record.title, objectKey: record.objectKey, recordId: record.id }],
          score: 72
        });
      }
    } else if (["contacts", "companies"].includes(record.objectKey) && lastTouchedAt < sevenDaysAgo) {
      const highLevel = isHighCustomerLevel(record, payload.records);
      candidates.push({
        kind: highLevel ? "customer_level" : "follow_up",
        priority: highLevel ? "high" : record.ownerId === context.user.id ? "medium" : "low",
        title: highLevel ? `高等级客户久未跟进：${record.title}` : `客户久未跟进：${record.title}`,
        body: highLevel ? "该 A/B 级客户最近缺少活动记录，建议今天优先确认需求、预算或下一步。" : "该客户最近缺少活动记录，建议查看邮件历史并安排一次低打扰跟进。",
        actionLabel: highLevel ? "优先跟进高等级客户" : "安排客户跟进",
        objectKey: record.objectKey,
        recordId: record.id,
        dueAt: todayEnd.toISOString(),
        sources: [{ label: record.title, objectKey: record.objectKey, recordId: record.id }],
        score: highLevel ? 86 : 64
      });
    }
  }

  for (const thread of payload.emailThreads) {
    if (!thread.recordId || !thread.lastMessageAt) continue;
    const lastMessageAt = new Date(thread.lastMessageAt);
    if (lastMessageAt >= sevenDaysAgo) {
      const record = payload.records.find((item) => item.id === thread.recordId);
      candidates.push({
        kind: "email_reply",
        priority: "high",
        title: `处理邮件跟进：${thread.subject}`,
        body: thread.summary || thread.aiAnalysis || "最近有客户邮件线程需要确认是否回复或继续跟进。",
        actionLabel: "查看邮件并回复",
        objectKey: record?.objectKey,
        recordId: thread.recordId,
        dueAt: todayEnd.toISOString(),
        sources: [{ label: thread.subject, objectKey: record?.objectKey, recordId: thread.recordId, threadId: thread.id }],
        score: 78
      });
    }
  }

  const contactRecords = payload.records.filter((record) => record.objectKey === "contacts");
  const companyRecords = payload.records.filter((record) => record.objectKey === "companies");
  const unratedContacts = contactRecords.filter((record) => !getEffectiveRecordCustomerLevel(record, payload.records));
  const unratedCompanies = companyRecords.filter((record) => !getRecordCustomerLevel(record));
  const lowCompletenessContacts = contactRecords
    .map((record) => ({ record, completeness: calculateRecordCompleteness(record, payload.records) }))
    .filter((item) => item.completeness.score < 70);
  const lowCompletenessCompanies = companyRecords
    .map((record) => ({ record, completeness: calculateRecordCompleteness(record, payload.records) }))
    .filter((item) => item.completeness.score < 70);
  const stalePrivateRecords = [...contactRecords, ...companyRecords].filter((record) => {
    if (!record.ownerId) return false;
    return getRecordLastTouchedAt(record, payload) < new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  });
  const highValueStalledDeals = payload.records.filter((record) => {
    if (record.objectKey !== "deals") return false;
    return getRecordAmount(record) >= 50000 && getRecordLastTouchedAt(record, payload) < sevenDaysAgo;
  });

  if (unratedContacts.length + unratedCompanies.length >= 3) {
    candidates.push({
      kind: "customer_level",
      priority: "medium",
      title: `处理 ${unratedContacts.length + unratedCompanies.length} 个未评级客户`,
      body: `当前可见客户中有 ${unratedContacts.length} 个联系人、${unratedCompanies.length} 个公司未评级。建议批量刷新建议等级，再优先确认近期有邮件互动或交易关联的客户。`,
      actionLabel: "处理未评级客户",
      objectKey: unratedContacts.length >= unratedCompanies.length ? "contacts" : "companies",
      dueAt: todayEnd.toISOString(),
      sources: smartReminderSourcesFor([...unratedContacts, ...unratedCompanies]),
      score: 80
    });
  }

  if (lowCompletenessContacts.length + lowCompletenessCompanies.length >= 3) {
    const examples = [...lowCompletenessContacts, ...lowCompletenessCompanies].slice(0, 3);
    candidates.push({
      kind: "data_quality",
      priority: "medium",
      title: `补齐 ${lowCompletenessContacts.length + lowCompletenessCompanies.length} 个低完整度客户资料`,
      body: `资料完整度偏低会影响 AI 推荐、自动化筛选和销售分层。优先补齐：${examples
        .map((item) => `${item.record.title} 缺 ${item.completeness.missing.slice(0, 2).join("/")}`)
        .join("；")}`,
      actionLabel: "补齐关键字段",
      objectKey: lowCompletenessContacts.length >= lowCompletenessCompanies.length ? "contacts" : "companies",
      dueAt: todayEnd.toISOString(),
      sources: smartReminderSourcesFor(examples.map((item) => item.record)),
      score: 77
    });
  }

  if (stalePrivateRecords.length >= 5) {
    candidates.push({
      kind: "portfolio_health",
      priority: "medium",
      title: `梳理 ${stalePrivateRecords.length} 个长期未跟进私海客户`,
      body: "私海客户长期无活动会占用跟进容量。建议分组处理：A/B 级优先跟进，低价值且长期无响应的客户考虑释放或进入低频培育。",
      actionLabel: "优化私海客户结构",
      objectKey: "contacts",
      dueAt: todayEnd.toISOString(),
      sources: smartReminderSourcesFor(stalePrivateRecords),
      score: 75
    });
  }

  if (highValueStalledDeals.length > 0) {
    candidates.push({
      kind: "pipeline_optimization",
      priority: "high",
      title: `推进 ${highValueStalledDeals.length} 个高金额停滞交易`,
      body: `这些交易金额较高但 7 天内缺少推进动作，合计约 ${Math.round(highValueStalledDeals.reduce((sum, record) => sum + getRecordAmount(record), 0)).toLocaleString()}。建议确认阻塞点、决策人和下一步时间。`,
      actionLabel: "推进高价值交易",
      objectKey: "deals",
      dueAt: todayEnd.toISOString(),
      sources: smartReminderSourcesFor(highValueStalledDeals),
      score: 90
    });
  }

  return candidates;
}

function parseSmartReminderCandidates(value: unknown, payload: SmartReminderGenerationContext): SmartReminderCandidate[] {
  const parsed = typeof value === "string" ? parseJsonObject(value) : value;
  const reminders = isJsonRecord(parsed) && Array.isArray(parsed.reminders) ? parsed.reminders : Array.isArray(parsed) ? parsed : [];
  const visibleRecordIds = new Set(payload.records.map((record) => record.id));
  return reminders
    .filter(isJsonRecord)
    .map((raw): SmartReminderCandidate | undefined => {
      const recordId = typeof raw.recordId === "string" && visibleRecordIds.has(raw.recordId) ? raw.recordId : undefined;
      const record = recordId ? payload.records.find((item) => item.id === recordId) : undefined;
      const title = normalizeShortText(raw.title, "");
      if (!title) return undefined;
      const sourceList = Array.isArray(raw.sources) ? raw.sources.filter(isJsonRecord) : [];
      const kind = normalizeSmartReminderKind(typeof raw.kind === "string" ? raw.kind : "");
      return {
        kind,
        priority: normalizeSmartReminderPriority(typeof raw.priority === "string" ? raw.priority : ""),
        title,
        body: normalizeOptionalText(raw.body, 1000),
        actionLabel: normalizeOptionalText(raw.actionLabel, 80),
        objectKey: typeof raw.objectKey === "string" ? raw.objectKey : record?.objectKey,
        recordId,
        dueAt: normalizeOptionalDate(raw.dueAt) ?? smartReminderDefaultDueAt(),
        sources: sourceList.length > 0 ? sourceList.map((source) => ({
          label: normalizeShortText(source.label, "AI source"),
          objectKey: typeof source.objectKey === "string" ? source.objectKey : record?.objectKey,
          recordId: typeof source.recordId === "string" && visibleRecordIds.has(source.recordId) ? source.recordId : recordId,
          threadId: typeof source.threadId === "string" ? source.threadId : undefined,
          activityId: typeof source.activityId === "string" ? source.activityId : undefined,
          messageId: typeof source.messageId === "string" ? source.messageId : undefined
        })) : record ? [{ label: record.title, objectKey: record.objectKey, recordId: record.id }] : [],
        score: normalizeScore(raw.score, 70)
      };
    })
    .filter((candidate): candidate is SmartReminderCandidate => Boolean(candidate));
}

function dedupeSmartReminderCandidates(candidates: SmartReminderCandidate[]): SmartReminderCandidate[] {
  const byKey = new Map<string, SmartReminderCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.objectKey ?? ""}:${candidate.recordId ?? ""}:${normalizeIdempotencyText(candidate.title)}`;
    const existing = byKey.get(key);
    if (!existing || candidate.score > existing.score) {
      byKey.set(key, candidate);
    }
  }
  return Array.from(byKey.values());
}

function parseJsonObject(value: string): unknown {
  const text = value.match(/\{[\s\S]*\}/)?.[0] ?? value;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function normalizeShortText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 160) : fallback;
}

function normalizeOptionalText(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

function normalizeOptionalDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function smartReminderDefaultDueAt(now = new Date()): string {
  const dueAt = new Date(now);
  dueAt.setHours(23, 59, 59, 999);
  return dueAt.toISOString();
}

function normalizeScore(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
}

function normalizeIdempotencyText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "reminder";
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeTeamName(input: string): string {
  const name = input.trim();
  if (!name) {
    throw new Error("Team name is required");
  }
  return name;
}

function normalizeTeamBusinessInformation(input: Partial<Team>) {
  return {
    companyName: normalizeOptionalTeamText(input.companyName),
    address: normalizeOptionalTeamText(input.address),
    phone: normalizeOptionalTeamText(input.phone),
    email: normalizeOptionalTeamText(input.email),
    website: normalizeOptionalTeamText(input.website),
    whatsapp: normalizeOptionalTeamText(input.whatsapp)
  };
}

function normalizeOptionalTeamText(value: string | undefined): string | null | undefined {
  return value === undefined ? undefined : value.trim() || null;
}

function sortDirectionSql(direction: "asc" | "desc"): Prisma.Sql {
  return direction === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
}

function recordFilterSql(objectKey: string, field: string, operator: "contains" | "equals", value: string): Prisma.Sql {
  const normalized = value.trim();
  if (field === "tags") {
    const tag = normalized.toLowerCase();
    return operator === "equals"
      ? Prisma.sql`${tag} = ANY("tags")`
      : Prisma.sql`EXISTS (SELECT 1 FROM unnest("tags") AS record_tag WHERE lower(record_tag) LIKE '%' || lower(${normalized}) || '%')`;
  }
  if (field === "title" || field === "stageKey" || field === "ownerId") {
    const column = Prisma.raw(`"${field}"`);
    return operator === "equals"
      ? Prisma.sql`lower(${column}) = lower(${normalized})`
      : Prisma.sql`lower(${column}) LIKE '%' || lower(${normalized}) || '%'`;
  }
  if (field === "createdAt" || field === "updatedAt") {
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      return Prisma.sql`FALSE`;
    }
    const column = Prisma.raw(`"${field}"`);
    return operator === "equals" ? Prisma.sql`${column} = ${parsed}` : Prisma.sql`${column} >= ${parsed}`;
  }

  const column = recordJsonTextSql(field);
  if (objectKey === "contacts" && field === "companyId" && operator === "equals") {
    return Prisma.sql`${column} = ${normalized}`;
  }

  return operator === "equals"
    ? Prisma.sql`lower(${column}) = lower(${normalized})`
    : Prisma.sql`lower(${column}) LIKE '%' || lower(${normalized}) || '%'`;
}

function recordSearchSql(objectKey: string, search: string): Prisma.Sql {
  const clauses: Prisma.Sql[] = [
    Prisma.sql`lower("title") LIKE '%' || lower(${search}) || '%'`,
    Prisma.sql`EXISTS (SELECT 1 FROM unnest("tags") AS record_tag WHERE lower(record_tag) LIKE '%' || lower(${search}) || '%')`
  ];

  if (objectKey === "contacts") {
    clauses.push(Prisma.sql`lower("data"->>'email') LIKE '%' || lower(${search}) || '%'`);
    clauses.push(Prisma.sql`lower("data"->>'phone') LIKE '%' || lower(${search}) || '%'`);
    clauses.push(Prisma.sql`lower("data"->>'contactMethods') LIKE '%' || lower(${search}) || '%'`);
    return Prisma.sql`(${Prisma.join(clauses, " OR ")})`;
  }

  if (objectKey === "companies") {
    clauses.push(Prisma.sql`lower("data"->>'domain') LIKE '%' || lower(${search}) || '%'`);
    clauses.push(Prisma.sql`lower("data"->>'industry') LIKE '%' || lower(${search}) || '%'`);
    return Prisma.sql`(${Prisma.join(clauses, " OR ")})`;
  }

  clauses.push(Prisma.sql`lower("data"::text) LIKE '%' || lower(${search}) || '%'`);
  return Prisma.sql`(${Prisma.join(clauses, " OR ")})`;
}

function recordJsonTextSql(field: string): Prisma.Sql {
  switch (field) {
    case "companyId":
      return Prisma.sql`"data"->>'companyId'`;
    case "contactMethods":
      return Prisma.sql`"data"->>'contactMethods'`;
    case "domain":
      return Prisma.sql`"data"->>'domain'`;
    case "email":
      return Prisma.sql`"data"->>'email'`;
    case "industry":
      return Prisma.sql`"data"->>'industry'`;
    case "phone":
      return Prisma.sql`"data"->>'phone'`;
    default:
      return Prisma.sql`"data"->>${field}`;
  }
}

function recordDataProjectionSql(fields?: string[]): Prisma.Sql {
  const projectedFields = normalizeProjectedRecordFields(fields).filter((field) => field !== "title" && field !== "tags");
  if (projectedFields.length === 0) {
    return Prisma.sql`"data"`;
  }

  const entries = projectedFields.flatMap((field) => [Prisma.sql`${field}`, Prisma.sql`"data"->${field}`]);
  return Prisma.sql`jsonb_strip_nulls(jsonb_build_object(${Prisma.join(entries)}))`;
}

function normalizeProjectedRecordFields(fields?: string[]): string[] {
  if (!fields?.length) {
    return [];
  }
  return Array.from(new Set(fields.filter((field) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(field))));
}

function canUseKeysetPagination(query: RecordListQuery): boolean {
  if (!query.keyset && !query.cursor) {
    return false;
  }
  return !query.sort || (query.sort.field === "updatedAt" && query.sort.direction === "desc");
}

function encodeRecordCursor(updatedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ updatedAt: updatedAt.toISOString(), id }), "utf8").toString("base64url");
}

function decodeRecordCursor(cursor?: string): { updatedAt: Date; id: string } | undefined {
  if (!cursor) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { updatedAt?: unknown; id?: unknown };
    const updatedAt = typeof parsed.updatedAt === "string" ? new Date(parsed.updatedAt) : undefined;
    if (!updatedAt || Number.isNaN(updatedAt.getTime()) || typeof parsed.id !== "string" || !parsed.id) {
      return undefined;
    }
    return { updatedAt, id: parsed.id };
  } catch {
    return undefined;
  }
}

function recordOrderBySql(sort: RecordListQuery["sort"]): Prisma.Sql {
  if (!sort?.field) {
    return Prisma.sql`"updatedAt" DESC, "id" ASC`;
  }

  if (sort.field === "createdAt" || sort.field === "updatedAt") {
    return Prisma.sql`${Prisma.raw(`"${sort.field}"`)} ${sortDirectionSql(sort.direction)}, "title" ${sortDirectionSql(sort.direction)}, "id" ASC`;
  }
  if (sort.field === "tags") {
    return Prisma.sql`lower(array_to_string("tags", ' ')) ${sortDirectionSql(sort.direction)}, lower("title") ${sortDirectionSql(sort.direction)}, "id" ASC`;
  }
  if (sort.field === "title" || sort.field === "stageKey" || sort.field === "ownerId") {
    return Prisma.sql`lower(${Prisma.raw(`"${sort.field}"`)}) ${sortDirectionSql(sort.direction)}, lower("title") ${sortDirectionSql(sort.direction)}, "id" ASC`;
  }

  return Prisma.sql`
    CASE WHEN "data"->>${sort.field} IS NULL OR "data"->>${sort.field} = '' THEN 1 ELSE 0 END ASC,
    CASE
      WHEN ("data"->>${sort.field}) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN ("data"->>${sort.field})::numeric
      ELSE NULL
    END ${sortDirectionSql(sort.direction)},
    lower("data"->>${sort.field}) ${sortDirectionSql(sort.direction)},
    lower("title") ${sortDirectionSql(sort.direction)},
    "id" ASC
  `;
}

function normalizeRecordListQuery(query: RecordListQuery, page: number, pageSize: number): RecordListQuery {
  const tags = uniqueTags(query.tags ?? []);
  return {
    page,
    pageSize,
    q: query.q?.trim() || undefined,
    filters: query.filters?.filter((filter) => filter.field && filter.value.trim()),
    sort: query.sort?.field ? query.sort : undefined,
    cursor: query.cursor?.trim() || undefined,
    keyset: Boolean(query.keyset || query.cursor),
    fields: normalizeProjectedRecordFields(query.fields),
    pool: query.pool === "public" || query.pool === "private" || query.pool === "all" ? query.pool : undefined,
    tags: tags.length ? tags : undefined
  };
}

function isBlankValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function normalizeGovernedValue(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : JSON.stringify(value);
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function normalizeCsvImportMapping(mapping?: CsvImportMapping): CsvImportMapping | undefined {
  if (!mapping) {
    return undefined;
  }
  const normalized = Object.fromEntries(
    Object.entries(mapping)
      .map(([header, target]) => [header.trim(), target.trim()])
      .filter(([header, target]) => header && target)
  );
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeImportPresetName(name: string): string {
  const normalized = name.trim();
  if (!normalized) {
    throw new Error("Import preset name is required");
  }
  return normalized;
}

function isIgnoredCsvImportHeader(header: string): boolean {
  return ["title", "name", "tags", "rowNumber", "status", "issues"].includes(header);
}

function applyCsvImportMapping(row: Record<string, string>, mapping?: CsvImportMapping): Record<string, string> {
  if (!mapping) {
    return row;
  }

  return Object.entries(row).reduce<Record<string, string>>((mappedRow, [header, value]) => {
    mappedRow[header] = value;
    const target = mapping[header];
    if (target) {
      mappedRow[target] = value;
    }
    return mappedRow;
  }, {});
}

function assertCsvImportMappingTargets(fields: FieldDefinition[], mapping?: CsvImportMapping): void {
  if (!mapping) {
    return;
  }
  const allowedTargets = new Set(["title", "name", ...fields.map((field) => field.key)]);
  const usedTargets = new Set<string>();
  for (const [header, target] of Object.entries(mapping)) {
    if (!allowedTargets.has(target)) {
      throw new Error(`CSV mapping for ${header} targets unknown field ${target}`);
    }
    if (usedTargets.has(target)) {
      throw new Error(`CSV mapping targets ${target} more than once`);
    }
    usedTargets.add(target);
  }
}

function findCsvImportConflicts(
  rowNumber: number,
  fields: FieldDefinition[],
  data: Record<string, unknown>,
  existingRecords: CrmRecord[]
): CsvImportConflict[] {
  const conflicts: CsvImportConflict[] = [];
  for (const field of fields) {
    if (!field.unique) {
      continue;
    }

    const value = data[field.key];
    if (isBlankValue(value)) {
      continue;
    }

    const normalized = normalizeGovernedValue(value);
    const existing = existingRecords.find((record) => !isBlankValue(record.data[field.key]) && normalizeGovernedValue(record.data[field.key]) === normalized);
    if (existing) {
      conflicts.push({
        rowNumber,
        fieldKey: field.key,
        fieldLabel: field.label,
        value: String(value),
        existingRecordId: existing.id,
        existingRecordTitle: existing.title
      });
    }
  }
  return conflicts;
}

function formatCsvImportConflict(conflict: CsvImportConflict): string {
  return `Row ${conflict.rowNumber}: ${conflict.fieldLabel} conflicts with existing record ${conflict.existingRecordTitle} (${conflict.existingRecordId})`;
}

function formatCsvImportRowIssues(row: CsvImportPreview["rows"][number]): string[] {
  return [...row.errors.map((error) => `Row ${row.rowNumber}: ${error}`), ...row.conflicts.map((conflict) => formatCsvImportConflict(conflict))];
}

function getSingleConflictRecordId(conflicts: CsvImportConflict[]): string | undefined {
  const ids = new Set(conflicts.map((conflict) => conflict.existingRecordId));
  return ids.size === 1 ? [...ids][0] : undefined;
}

function parseCsv(csv: string): Array<Record<string, string>> {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error("CSV must include headers and at least one row");
  }

  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = values[index] ?? "";
      return row;
    }, {});
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function normalizeEmailAddress(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Email address must be valid");
  }
  return email;
}

function normalizeEmailThreadListQuery(input?: string | EmailThreadListQuery): EmailThreadListQuery {
  return typeof input === "string" ? { recordId: input } : input ?? {};
}

function uniqueEmails(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeEmailAddress)));
}

function tryNormalizeEmailAddress(value: string | undefined | null): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return normalizeEmailAddress(value);
  } catch {
    return undefined;
  }
}

function uniqueValidEmails(values: string[]): string[] {
  return Array.from(new Set(values.map(tryNormalizeEmailAddress).filter((email): email is string => Boolean(email))));
}

function normalizeMessageFromAddress(direction: EmailMessage["direction"], value: string): string {
  const normalized = tryNormalizeEmailAddress(value);
  if (normalized) {
    return normalized;
  }
  if (direction === "inbound") {
    return "unknown-sender@invalid.local";
  }
  return normalizeEmailAddress(value);
}

function normalizeMessageRecipientAddresses(direction: EmailMessage["direction"], values: string[], inboundFallback?: string): string[] {
  if (direction !== "inbound") {
    return uniqueEmails(values);
  }
  const normalized = uniqueValidEmails(values);
  if (normalized.length > 0) {
    return normalized;
  }
  return inboundFallback ? [inboundFallback] : [];
}

function normalizeEmailSubject(value: string): string {
  return value
    .trim()
    .replace(/^(\s*(re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function uniqueTags(values: string[]): string[] {
  const tags = values.map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  const tooLong = tags.find((tag) => tag.length > 40);
  if (tooLong) {
    throw new Error("Tags must be at most 40 characters");
  }
  const uniqueTags = Array.from(new Set(tags));
  if (uniqueTags.length > 50) {
    throw new Error("Tags must include at most 50 values");
  }
  return uniqueTags;
}

const tagColorPalette = ["cyan", "mint", "sky", "amber", "rose", "violet", "slate", "navy"] as const;
const allowedTagColors = new Set<string>(tagColorPalette);

function normalizeTagColors(values: Record<string, unknown>, tags: string[]): Record<string, string> {
  const normalizedTags = uniqueTags(tags);
  const colors: Record<string, string> = {};
  for (const [index, tag] of normalizedTags.entries()) {
    const color = values[tag];
    colors[tag] = typeof color === "string" && allowedTagColors.has(color) ? color : tagColorPalette[index % tagColorPalette.length];
  }
  return colors;
}

function normalizeIntegerLimit(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeDailyTime(value: string): string {
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1]}:${match[2]}` : "03:00";
}

function emailActivityVerb(status: EmailMessage["status"], direction: EmailMessage["direction"]): string {
  if (direction === "inbound") {
    return "Received";
  }
  if (status === "queued") {
    return "Queued";
  }
  if (status === "failed") {
    return "Failed";
  }
  return "Sent";
}

function buildEmailMessageEventPayload(message: EmailMessage, recordId?: string): Record<string, unknown> {
  return {
    messageId: message.id,
    threadId: message.threadId,
    accountId: message.accountId,
    direction: message.direction,
    status: message.status,
    subject: message.subject,
    from: message.from,
    to: message.to,
    cc: message.cc ?? [],
    bcc: message.bcc ?? [],
    sentAt: message.sentAt,
    receivedAt: message.receivedAt,
    scheduledSendAt: message.scheduledSendAt,
    failureReason: message.failureReason,
    recordId
  };
}

function mapSmartReminderSettings(settings: {
  workspaceId: string;
  enabled: boolean;
  dailyAt: string;
  maxPerUser: number;
  objectKeys: string[];
  notifyCreated: boolean;
  notifyDailyDigest: boolean;
  updatedAt: Date;
}): SmartReminderSettings {
  return {
    workspaceId: settings.workspaceId,
    enabled: settings.enabled,
    dailyAt: settings.dailyAt,
    maxPerUser: settings.maxPerUser,
    objectKeys: settings.objectKeys,
    notifyCreated: settings.notifyCreated,
    notifyDailyDigest: settings.notifyDailyDigest,
    updatedAt: settings.updatedAt.toISOString()
  };
}

function smartReminderReferencesDeletedEmailThread(
  reminder: { objectKey?: string | null; recordId?: string | null; sources?: Prisma.JsonValue | null },
  threadId: string,
  messageIds: Set<string>
): boolean {
  const directlyLinkedId = reminder.recordId ?? "";
  if ((reminder.objectKey === "emails" || reminder.objectKey === "emailThreads") && (directlyLinkedId === threadId || messageIds.has(directlyLinkedId))) {
    return true;
  }
  if (!Array.isArray(reminder.sources)) {
    return false;
  }
  return reminder.sources.some((source) => {
    if (!isJsonRecord(source)) return false;
    const sourceThreadId = typeof source.threadId === "string" ? source.threadId : "";
    const sourceMessageId = typeof source.messageId === "string" ? source.messageId : "";
    return sourceThreadId === threadId || Boolean(sourceMessageId && messageIds.has(sourceMessageId));
  });
}

function isSmartReminderEmailReference(objectKey: string): boolean {
  return ["emails", "emailThreads", "email-threads", "emailMessages", "email-messages"].includes(objectKey);
}

function smartReminderTargetExists(
  objectKey: string,
  recordId: string,
  existingRecordKeys: Set<string>,
  visibleEmailThreadIds: Set<string>,
  visibleEmailMessageIds: Set<string>
): boolean {
  if (isSmartReminderEmailReference(objectKey)) {
    return visibleEmailThreadIds.has(recordId) || visibleEmailMessageIds.has(recordId);
  }
  return existingRecordKeys.has(`${objectKey}:${recordId}`);
}

function mapSmartReminder(reminder: {
  id: string;
  workspaceId: string;
  userId: string;
  objectKey: string | null;
  recordId: string | null;
  kind: string;
  priority: string;
  title: string;
  body: string | null;
  actionLabel: string | null;
  dueAt: Date | null;
  status: string;
  snoozedUntil: Date | null;
  sources: Prisma.JsonValue | null;
  score: number;
  idempotencyKey: string;
  generatedByAgentKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  dismissedAt: Date | null;
}): SmartReminder {
  const sources = Array.isArray(reminder.sources)
    ? reminder.sources.flatMap((source) => {
        if (!isJsonRecord(source)) return [];
        return [{
          label: typeof source.label === "string" ? source.label : "Source",
          objectKey: typeof source.objectKey === "string" ? source.objectKey : undefined,
          recordId: typeof source.recordId === "string" ? source.recordId : undefined,
          activityId: typeof source.activityId === "string" ? source.activityId : undefined,
          threadId: typeof source.threadId === "string" ? source.threadId : undefined,
          messageId: typeof source.messageId === "string" ? source.messageId : undefined
        }];
      })
    : [];
  return {
    id: reminder.id,
    workspaceId: reminder.workspaceId,
    userId: reminder.userId,
    objectKey: reminder.objectKey ?? undefined,
    recordId: reminder.recordId ?? undefined,
    kind: normalizeSmartReminderKind(reminder.kind),
    priority: normalizeSmartReminderPriority(reminder.priority),
    title: reminder.title,
    body: reminder.body ?? undefined,
    actionLabel: reminder.actionLabel ?? undefined,
    dueAt: reminder.dueAt?.toISOString(),
    status: reminder.status === "done" || reminder.status === "dismissed" ? reminder.status : "open",
    snoozedUntil: reminder.snoozedUntil?.toISOString(),
    sources,
    score: reminder.score,
    idempotencyKey: reminder.idempotencyKey,
    generatedByAgentKey: reminder.generatedByAgentKey as SmartReminder["generatedByAgentKey"],
    createdAt: reminder.createdAt.toISOString(),
    updatedAt: reminder.updatedAt.toISOString(),
    completedAt: reminder.completedAt?.toISOString(),
    dismissedAt: reminder.dismissedAt?.toISOString()
  };
}

function mapSmartReminderRun(run: {
  id: string;
  workspaceId: string;
  userId: string | null;
  status: string;
  scope: Prisma.JsonValue;
  generatedCount: number;
  fallback: boolean;
  agentKey: string | null;
  provider: string | null;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
}): SmartReminderRun {
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    userId: run.userId ?? undefined,
    status: run.status === "completed" || run.status === "failed" ? run.status : "running",
    scope: asRecord(run.scope),
    generatedCount: run.generatedCount,
    fallback: run.fallback,
    agentKey: run.agentKey as SmartReminderRun["agentKey"],
    provider: run.provider ?? undefined,
    errorMessage: run.errorMessage ?? undefined,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString(),
    durationMs: run.durationMs ?? undefined
  };
}

function emailMessageLifecycleEvent(message: Pick<EmailMessage, "direction" | "status">): WebhookEvent | undefined {
  if (message.direction === "inbound" && message.status === "received") {
    return "email.message.received";
  }
  if (message.direction === "outbound" && message.status === "queued") {
    return "email.message.queued";
  }
  if (message.direction === "outbound" && message.status === "sent") {
    return "email.message.sent";
  }
  if (message.direction === "outbound" && message.status === "failed") {
    return "email.message.failed";
  }
  return undefined;
}

function normalizeEmailCandidates(value: string): string[] {
  return uniqueValidEmails(value.split(/[,\s;<>]+/).filter(Boolean));
}

function getRecordEmailAddresses(record: Pick<CrmRecord, "data">): string[] {
  if (!record.data || typeof record.data !== "object" || Array.isArray(record.data)) {
    return [];
  }
  const data = record.data as Record<string, unknown>;
  const contactMethods = Array.isArray(data.contactMethods) ? data.contactMethods : [];
  const methodEmails = contactMethods.flatMap((method) => {
    if (!method || typeof method !== "object" || Array.isArray(method)) {
      return [];
    }
    const methodRecord = method as Record<string, unknown>;
    return typeof methodRecord.value === "string" && (methodRecord.type === "email" || methodRecord.value.includes("@")) ? [methodRecord.value] : [];
  });
  const fieldEmails = Object.entries(data).flatMap(([key, value]) => {
    if (typeof value !== "string") {
      return [];
    }
    if (!key.toLowerCase().includes("email") && !value.includes("@")) {
      return [];
    }
    return [value];
  });
  return Array.from(new Set([...methodEmails, ...fieldEmails].flatMap(normalizeEmailCandidates)));
}

function recordDataHasEmail(data: unknown, emailAddress: string): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return false;
  }
  const normalizedEmail = tryNormalizeEmailAddress(emailAddress);
  if (!normalizedEmail) {
    return false;
  }
  const record = data as Record<string, unknown>;
  const contactMethods = Array.isArray(record.contactMethods) ? record.contactMethods : [];
  const methodEmails = contactMethods.flatMap((method) => {
    if (!method || typeof method !== "object" || Array.isArray(method)) {
      return [];
    }
    const methodRecord = method as Record<string, unknown>;
    return typeof methodRecord.value === "string" && (methodRecord.type === "email" || methodRecord.value.includes("@")) ? [methodRecord.value] : [];
  });
  const fieldEmails = Object.entries(record).flatMap(([key, value]) => {
    if (typeof value !== "string") {
      return [];
    }
    if (!key.toLowerCase().includes("email") && !value.includes("@")) {
      return [];
    }
    return [value];
  });
  return [...methodEmails, ...fieldEmails].some((value) => normalizeEmailCandidates(value).includes(normalizedEmail));
}

function recordReferencesId(value: unknown, recordId: string): boolean {
  if (!recordId) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim() === recordId;
  }
  if (Array.isArray(value)) {
    return value.some((item) => recordReferencesId(item, recordId));
  }
  if (value && typeof value === "object") {
    const candidate = value as { id?: unknown; recordId?: unknown; value?: unknown };
    return [candidate.id, candidate.recordId, candidate.value].some((item) => recordReferencesId(item, recordId));
  }
  return false;
}

function emailThreadMatchesCommandScope(thread: EmailThread, scope: EmailThreadCommandScope): boolean {
  if (thread.recordId && scope.recordIds.has(thread.recordId)) {
    return true;
  }
  return thread.participantEmails.some((email) => {
    const normalized = tryNormalizeEmailAddress(email);
    return normalized !== undefined && scope.emails.has(normalized);
  });
}

function emailMessageTime(message: EmailMessage): string {
  return message.receivedAt ?? message.sentAt ?? message.createdAt;
}

function summarizeEmailThread(messages: EmailMessage[]): string {
  const ordered = messages.filter(isEmailMessageCommittedForSummary).sort((left, right) => emailMessageTime(left).localeCompare(emailMessageTime(right)));
  const latest = ordered
    .slice(-5)
    .map((message) => `${message.direction}: ${message.subject} (${message.status})`)
    .join("; ");
  return latest || "No email messages yet.";
}

function isEmailMessageCommittedForSummary(message: EmailMessage): boolean {
  return message.direction === "inbound" ? message.status === "received" : message.status === "sent";
}

function coerceRow(row: Record<string, string>, fields: FieldDefinition[]): Record<string, unknown> {
  return fields.reduce<Record<string, unknown>>((data, field) => {
    if (!(field.key in row)) {
      return data;
    }

    const raw = row[field.key];
    if (raw === "") {
      return data;
    }

    if (field.type === "number" || field.type === "currency") {
      data[field.key] = Number(raw);
    } else if (field.type === "boolean") {
      data[field.key] = ["true", "1", "yes", "y"].includes(raw.toLowerCase());
    } else {
      data[field.key] = raw;
    }

    return data;
  }, {});
}

function parseTagsCell(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  return uniqueTags(value.split(/[,;\uFF1B\uFF0C]/));
}

function buildImportTemplateExampleRow(fields: FieldDefinition[]): Record<string, unknown> {
  return {
    title: "Example record",
    tags: "vip; prospect",
    ...Object.fromEntries(fields.map((field) => [field.key, importTemplateExampleValue(field)]))
  };
}

const importTemplateFieldGuideHeaders = [
  "column",
  "label",
  "type",
  "required",
  "unique",
  "defaultValue",
  "allowedValues",
  "referenceObject",
  "exampleValue",
  "notes"
];

function buildImportTemplateFieldGuideCsv(fields: FieldDefinition[], objects: ObjectDefinition[]): string {
  return buildCsv(importTemplateFieldGuideHeaders, [
    {
      column: "title",
      label: "鍚嶇О",
      type: "text",
      required: "yes",
      unique: "no",
      defaultValue: "",
      allowedValues: "",
      referenceObject: "",
      exampleValue: "Example record",
      notes: "Record title; required for every import row."
    },
    ...fields.map((field) => buildImportTemplateFieldGuideRow(field, objects))
  ]);
}

function buildImportTemplateFieldGuideRow(field: FieldDefinition, objects: ObjectDefinition[]): Record<string, unknown> {
  return {
    column: field.key,
    label: field.label,
    type: field.type,
    required: field.required ? "yes" : "no",
    unique: field.unique ? "yes" : "no",
    defaultValue: formatImportTemplateGuideValue(field.defaultValue),
    allowedValues: field.type === "select" ? formatImportTemplateGuideOptions(field) : "",
    referenceObject: field.type === "reference" ? formatImportTemplateGuideReference(field, objects) : "",
    exampleValue: importTemplateExampleValue(field),
    notes: importTemplateFieldGuideNotes(field)
  };
}

function formatImportTemplateGuideOptions(field: FieldDefinition): string {
  return (field.options ?? []).map((option) => `${option.label}=${option.value}`).join("; ");
}

function formatImportTemplateGuideReference(field: FieldDefinition, objects: ObjectDefinition[]): string {
  const objectKey = field.options?.[0]?.value ?? "";
  const object = objects.find((candidate) => candidate.key === objectKey);
  return object ? `${object.label} (${object.key})` : objectKey;
}

function formatImportTemplateGuideValue(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function importTemplateFieldGuideNotes(field: FieldDefinition): string {
  if (field.type === "select") return "Use one of the allowed values, not the display label.";
  if (field.type === "reference") return "Use the target CRM record id.";
  if (field.type === "user") return "Use an active user id.";
  if (field.type === "boolean") return "Accepted true values include true, 1, yes, y.";
  if (field.type === "date") return "Use YYYY-MM-DD.";
  if (field.type === "number" || field.type === "currency") return "Use digits without thousands separators.";
  return "";
}

function importTemplateExampleValue(field: FieldDefinition): string {
  if (field.defaultValue !== undefined && field.defaultValue !== null && field.defaultValue !== "") {
    return String(field.defaultValue);
  }
  if (field.type === "number") return "100";
  if (field.type === "currency") return "1000";
  if (field.type === "date") return "2026-01-31";
  if (field.type === "boolean") return "true";
  if (field.type === "select") return field.options?.[0]?.value ?? "";
  if (field.type === "user") return "user-id";
  if (field.type === "reference") return "record-id";
  return "";
}

function normalizeEmailAccountToggles(provider: EmailAccount["provider"], toggles: Pick<EmailAccount, "syncEnabled" | "sendEnabled">): Pick<EmailAccount, "syncEnabled" | "sendEnabled"> {
  const capability = getEmailProviderCapability(provider);
  return {
    syncEnabled: capability.supportsSync ? toggles.syncEnabled : false,
    sendEnabled: capability.supportsSend ? toggles.sendEnabled : false
  };
}

function shouldResetImapSyncCursor(provider: EmailAccount["provider"], currentConfig: EmailConnectionConfig | undefined, nextConfig: EmailConnectionConfig): boolean {
  if (provider !== "smtp_imap") {
    return true;
  }
  if (!currentConfig) {
    return false;
  }
  const current = getInboundConnectionConfig(currentConfig);
  const next = getInboundConnectionConfig(nextConfig);
  const currentEndpoint = [
    current.syncProtocol ?? "imap",
    current.imapHost ?? "",
    current.imapPort ?? "",
    current.imapSecure === false ? "plain" : "tls",
    current.mailbox ?? "INBOX",
    JSON.stringify(current.mailboxMapping ?? {}),
    current.username ?? ""
  ].join("|");
  const nextEndpoint = [
    next.syncProtocol ?? "imap",
    next.imapHost ?? "",
    next.imapPort ?? "",
    next.imapSecure === false ? "plain" : "tls",
    next.mailbox ?? "INBOX",
    JSON.stringify(next.mailboxMapping ?? {}),
    next.username ?? ""
  ].join("|");
  return currentEndpoint !== nextEndpoint;
}

function normalizeEmailAiProviderError(value: string | undefined): string | undefined {
  const normalized = value?.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 500) : undefined;
}
