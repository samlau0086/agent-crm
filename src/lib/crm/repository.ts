import { Prisma, type PrismaClient } from "@prisma/client";
import { createApiKeyToken, getApiKeyTokenPrefix, hashApiKeyToken } from "@/lib/auth/api-key";
import { permissionCatalog } from "@/lib/auth/permissions";
import { assertValidWebhookEvents, assertValidWebhookUrl, assertWebhookDeliveryTarget, buildWebhookSignatureHeader, createWebhookSecret, getWebhookSecretPrefix } from "@/lib/integrations/webhook";
import { hashPassword } from "@/lib/auth/password";
import {
  createPasswordSetupToken,
  hashPasswordSetupToken,
  PASSWORD_SETUP_MAX_AGE_SECONDS,
  type PasswordSetupPurpose
} from "@/lib/auth/password-setup";
import { canManageAllRecords, requirePermission } from "@/lib/auth/rbac";
import { destroySessionsForUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getBackgroundJobExecutor } from "@/lib/jobs/executor";
import { ApiError } from "@/lib/api-error";
import { buildCsv } from "@/lib/crm/csv";
import { buildCsvImportIssuesCsv } from "@/lib/crm/import-issues";
import { AUDIT_DEFAULT_PAGE_SIZE, AUDIT_EXPORT_MAX_PAGE_SIZE, normalizePage, normalizePageSize, RECORD_DEFAULT_PAGE_SIZE, RECORD_MAX_PAGE_SIZE } from "@/lib/crm/pagination";
import {
  buildEmailAssistantContext as buildEmailAssistantPromptContext,
  createDefaultEmailAiSettings,
  normalizeAiAgentSettings,
  normalizeEmailAiFeatures,
  type EmailAssistantContext,
  type EmailAssistantPurpose
} from "@/lib/email/assistant";
import { scheduleEmailAutomationsBestEffort } from "@/lib/email/automations";
import { decryptEmailConnectionConfig, encryptEmailConnectionConfig } from "@/lib/email/connection-config";
import { getEmailProviderCapability } from "@/lib/email/providers";
import type {
  Activity,
  ApiKey,
  AuditAction,
  AuditLog,
  AuditLogQuery,
  CreatedApiKey,
  CsvImportConflict,
  CsvImportMapping,
  CsvImportResult,
  CsvImportStrategy,
  CsvImportPreview,
  CsvImportJobSourcePayload,
  CsvImportJob,
  CrmRecord,
  DashboardSummary,
  EmailAccount,
  EmailAttachment,
  EmailAiGenerationAuditInput,
  EmailAiSettings,
  EmailConnectionConfig,
  EmailMessage,
  EmailThreadState,
  EmailThread,
  FieldDefinition,
  ImportPreset,
  ImportJobQueueSummary,
  KnowledgeArticle,
  ObjectDefinition,
  Permission,
  Pipeline,
  RecordListQuery,
  RecordListResult,
  RelationDefinition,
  RequestContext,
  Role,
  SavedView,
  Team,
  User,
  CreatedWebhookEndpoint,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEvent,
  WebhookDeliveryStatus
} from "@/lib/crm/types";
import { assertValidFieldDefinition, validateRecordPayload } from "@/lib/crm/validation";
import { normalizeQuoteRecordData, validateQuoteRecordData } from "@/lib/crm/quotes";

type PrismaContext = PrismaClient;

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
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
  roleId: string | null;
  teamId: string | null;
  active: boolean;
  disabledAt?: Date | null;
}): User {
  return {
    id: user.id,
    workspaceId: user.workspaceId,
    email: user.email,
    name: user.name,
    roleId: user.roleId ?? "",
    teamId: user.teamId ?? undefined,
    active: user.active,
    disabledAt: user.disabledAt?.toISOString()
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
  encryptedConnectionConfig?: string | null;
  lastConnectionError?: string | null;
  createdById: string;
  lastSyncedAt: Date | null;
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
    connectionConfigured: Boolean(account.encryptedConnectionConfig),
    lastConnectionError: account.lastConnectionError ?? undefined,
    createdById: account.createdById,
    lastSyncedAt: account.lastSyncedAt?.toISOString(),
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString()
  };
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
  sentAt: Date | null;
  receivedAt: Date | null;
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
    sentAt: message.sentAt?.toISOString(),
    receivedAt: message.receivedAt?.toISOString(),
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
    updatedAt: article.updatedAt.toISOString()
  };
}

function mapEmailAiSettings(settings: {
  workspaceId: string;
  features: Prisma.JsonValue;
  agents?: Prisma.JsonValue;
  defaultLocale: string;
  requireSourceLinks: boolean;
  maxHistoryMessages: number;
  maxKnowledgeArticles: number;
  maxContextChars: number;
  updatedAt: Date;
}): EmailAiSettings {
  return {
    workspaceId: settings.workspaceId,
    features: normalizeEmailAiFeatures(settings.features as Partial<EmailAiSettings["features"]>),
    agents: normalizeAiAgentSettings(settings.agents),
    defaultLocale: settings.defaultLocale,
    requireSourceLinks: settings.requireSourceLinks,
    maxHistoryMessages: settings.maxHistoryMessages,
    maxKnowledgeArticles: settings.maxKnowledgeArticles,
    maxContextChars: settings.maxContextChars,
    updatedAt: settings.updatedAt.toISOString()
  };
}

function mapRole(role: { id: string; workspaceId: string; name: string; permissions: string[] }): Role {
  return {
    id: role.id,
    workspaceId: role.workspaceId,
    name: role.name,
    permissions: role.permissions as Role["permissions"]
  };
}

function mapTeam(team: { id: string; workspaceId: string; name: string }): Team {
  return {
    id: team.id,
    workspaceId: team.workspaceId,
    name: team.name
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
    data: asRecord(record.data),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
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
        ...(typeof item.recordId === "string" && item.recordId.trim() ? { recordId: item.recordId.trim() } : {}),
        ...(typeof item.activityId === "string" && item.activityId.trim() ? { activityId: item.activityId.trim() } : {}),
        ...(typeof item.messageId === "string" && item.messageId.trim() ? { messageId: item.messageId.trim() } : {}),
        ...(typeof item.knowledgeArticleId === "string" && item.knowledgeArticleId.trim() ? { knowledgeArticleId: item.knowledgeArticleId.trim() } : {})
      };
    })
    .filter((source): source is NonNullable<EmailThread["aiAnalysisSources"]>[number] => Boolean(source))
    .slice(0, 20);
}

function normalizeEmailThreadCategory(value: unknown): EmailThread["category"] {
  return value === "primary" || value === "promotions" || value === "social" || value === "updates" ? value : undefined;
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
      Partial<Pick<EmailAccount, "syncEnabled" | "sendEnabled" | "status">> & { connectionConfig?: EmailConnectionConfig }
  ): Promise<EmailAccount> {
    requirePermission(context, "crm.admin");
    const toggles = normalizeEmailAccountToggles(input.provider, {
      syncEnabled: input.syncEnabled ?? false,
      sendEnabled: input.sendEnabled ?? false
    });
    const emailAddress = normalizeEmailAddress(input.emailAddress);
    await this.assertEmailAccountEmailAvailable(context, emailAddress);
    const account = await this.db.emailAccount.create({
      data: {
        workspaceId: context.workspaceId,
        name: normalizeRequiredText(input.name, "Email account name"),
        emailAddress,
        provider: input.provider,
        status: input.status ?? "draft",
        syncEnabled: toggles.syncEnabled,
        sendEnabled: toggles.sendEnabled,
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
    data.syncEnabled = toggles.syncEnabled;
    data.sendEnabled = toggles.sendEnabled;
    if (input.connectionConfig) {
      data.encryptedConnectionConfig = encryptEmailConnectionConfig(input.connectionConfig);
      data.lastConnectionError = null;
      if (input.status === undefined && existing.status === "draft") {
        data.status = "active";
      }
    }
    if (input.clearConnectionConfig) {
      data.encryptedConnectionConfig = null;
      data.lastConnectionError = null;
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

  async listEmailThreads(context: RequestContext, recordId?: string): Promise<EmailThread[]> {
    requirePermission(context, "crm.read");
    if (recordId) {
      await this.assertVisibleRecord(context, recordId);
    }
    const threads = await this.db.emailThread.findMany({
      where: {
        workspaceId: context.workspaceId,
        ...(recordId ? { recordId } : await this.emailThreadAccessWhere(context))
      },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }]
    });
    const states = await this.db.emailThreadState.findMany({
      where: { workspaceId: context.workspaceId, userId: context.user.id, threadId: { in: threads.map((thread) => thread.id) } }
    });
    const stateByThreadId = new Map(states.map((state) => [state.threadId, state]));
    return threads.map((thread) => mapEmailThread(thread, stateByThreadId.get(thread.id)));
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
    const state = await this.db.emailThreadState.findUnique({
      where: { workspaceId_threadId_userId: { workspaceId: context.workspaceId, threadId: updated.id, userId: context.user.id } }
    });
    return mapEmailThread(updated, state);
  }

  async deleteEmailThread(context: RequestContext, threadId: string): Promise<void> {
    requirePermission(context, "crm.write");
    const thread = await this.assertEmailThread(context, threadId);
    await this.db.$transaction([
      this.db.emailMessage.deleteMany({ where: { workspaceId: context.workspaceId, threadId: thread.id } }),
      this.db.emailThreadState.deleteMany({ where: { workspaceId: context.workspaceId, threadId: thread.id } }),
      this.db.emailThread.delete({ where: { id: thread.id } })
    ]);
    await this.writeAuditLog(context, "delete", "email_thread", thread.id, {
      summary: `Deleted email thread ${thread.subject}`,
      details: { threadId: thread.id, subject: thread.subject }
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
      Partial<Pick<EmailMessage, "threadId" | "cc" | "bcc" | "bodyHtml" | "attachments" | "aiAssisted" | "aiPurpose" | "aiSourceMessageId" | "aiSources" | "aiGeneratedAt" | "externalMessageId" | "clientRequestId" | "status" | "sendAttemptedAt" | "sentAt" | "receivedAt" | "createdById">> & {
        recordId?: string;
    }
  ): Promise<EmailMessage> {
    requirePermission(context, "crm.write");
    const account = await this.assertEmailAccount(context, input.accountId);
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
    const autoLinkedRecord = requestedRecord
      ? undefined
      : await this.findVisibleRecordByEmailParticipants(context, account.emailAddress, [input.from, ...input.to, ...(input.cc ?? [])]);
    const linkedRecordId = requestedRecord?.id ?? autoLinkedRecord?.id;
    const thread = input.threadId
        ? await this.assertEmailThread(context, input.threadId)
      : (await this.findMatchingEmailThread(context, account.id, account.emailAddress, input.subject, [input.from, ...input.to, ...(input.cc ?? [])], linkedRecordId)) ??
        mapEmailThread(
            await this.db.emailThread.create({
              data: {
                workspaceId: context.workspaceId,
                accountId: account.id,
                subject: normalizeRequiredText(input.subject, "Email subject"),
                participantEmails: uniqueEmails([input.from, ...input.to]),
                recordId: linkedRecordId
              }
            })
          );
    if (thread.accountId !== account.id) {
      throw new Error("Email thread does not belong to this account");
    }
    const linkedRecord = requestedRecord ?? (thread.recordId ? await this.assertVisibleRecord(context, thread.recordId) : undefined) ?? autoLinkedRecord;
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
    const attachments = normalizeEmailAttachments(input.attachments);
    let message: Awaited<ReturnType<typeof this.db.emailMessage.create>>;
    try {
      message = await this.db.emailMessage.create({
        data: {
          workspaceId: context.workspaceId,
          threadId: thread.id,
          accountId: account.id,
          direction: input.direction,
          status,
          fromAddress: normalizeEmailAddress(input.from),
          toAddresses: uniqueEmails(input.to),
          ccAddresses: uniqueEmails(input.cc ?? []),
          bccAddresses: uniqueEmails(input.bcc ?? []),
          subject: normalizeRequiredText(input.subject, "Email subject"),
          bodyText: normalizeRequiredText(input.bodyText, "Email body"),
          bodyHtml: input.bodyHtml?.trim() || undefined,
          attachments: attachments ? ((attachments as unknown) as Prisma.InputJsonValue) : Prisma.JsonNull,
          aiAssisted: input.aiAssisted ?? false,
          aiPurpose: input.aiPurpose,
          aiSourceMessageId,
          aiSources: aiSources.length ? (aiSources as Prisma.InputJsonValue) : Prisma.JsonNull,
          aiGeneratedAt: input.aiGeneratedAt ? new Date(input.aiGeneratedAt) : undefined,
          externalMessageId: normalizedExternalMessageId,
          clientRequestId: normalizedClientRequestId,
          failureReason: status === "failed" ? "Delivery failed" : undefined,
          sendAttemptedAt: input.sendAttemptedAt ? new Date(input.sendAttemptedAt) : status === "sending" ? new Date() : undefined,
          sentAt,
          receivedAt,
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
    const participantEmails = uniqueEmails([...thread.participantEmails, mappedMessage.from, ...mappedMessage.to, ...(mappedMessage.cc ?? [])]);
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
    scheduleEmailAutomationsBestEffort(context, this, getBackgroundJobExecutor(this), mappedMessage, settings);
    return mappedMessage;
  }

  async sendEmailMessage(
    context: RequestContext,
    input: Pick<EmailMessage, "accountId" | "to" | "subject" | "bodyText"> &
      Partial<Pick<EmailMessage, "threadId" | "cc" | "bcc" | "bodyHtml" | "attachments" | "aiAssisted" | "aiPurpose" | "aiSourceMessageId" | "aiSources" | "aiGeneratedAt" | "externalMessageId" | "clientRequestId">> & { recordId?: string }
  ): Promise<EmailMessage> {
    requirePermission(context, "crm.write");
    const account = await this.assertEmailAccount(context, input.accountId);
    if (!account.sendEnabled || account.status !== "active") {
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
      Partial<Pick<EmailMessage, "threadId" | "cc" | "bcc" | "bodyHtml" | "attachments" | "aiAssisted" | "aiPurpose" | "aiSourceMessageId" | "aiSources" | "aiGeneratedAt" | "clientRequestId">> & { recordId?: string }
  ): Promise<EmailMessage> {
    requirePermission(context, "crm.write");
    const account = await this.assertEmailAccount(context, input.accountId);
    if (!account.sendEnabled || account.status !== "active") {
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
    if (status === "sent" && existing.status !== "sent") {
      const settings = await this.ensureEmailAiSettings(context.workspaceId);
      scheduleEmailAutomationsBestEffort(context, this, getBackgroundJobExecutor(this), mappedMessage, settings);
    }
    return mappedMessage;
  }

  async claimEmailMessageForSending(context: RequestContext, messageId: string): Promise<{ message: EmailMessage; claimed: boolean }> {
    requirePermission(context, "crm.write");
    const existing = await this.getEmailMessage(context, messageId);
    const staleBefore = emailSendClaimStaleBefore();
    const isClaimableSending = existing.status === "sending" && isEmailSendClaimStale(existing.sendAttemptedAt, staleBefore);
    if (existing.direction !== "outbound" || (existing.status !== "queued" && existing.status !== "failed" && !isClaimableSending)) {
      return { message: existing, claimed: false };
    }
    const now = new Date();
    const result = await this.db.emailMessage.updateMany({
      where: {
        id: existing.id,
        workspaceId: context.workspaceId,
        direction: "outbound",
        OR: [
          { status: { in: ["queued", "failed"] } },
          {
            status: "sending",
            OR: [{ sendAttemptedAt: null }, { sendAttemptedAt: { lt: staleBefore } }]
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
    requirePermission(context, "crm.admin");
    const account = await this.assertEmailAccount(context, accountId);
    if (!account.syncEnabled || account.status !== "active") {
      throw new Error("Email account is not enabled for sync");
    }

    const updated = await this.db.emailAccount.update({
      where: { id: account.id },
      data: { lastSyncedAt: new Date() }
    });
    await this.writeAuditLog(context, "update", "email_account", account.id, {
      summary: `Synced email account ${account.emailAddress}`,
      details: { provider: account.provider, importedCount: 0 }
    });
    return { account: mapEmailAccount(updated), importedCount: 0, status: "synced" };
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
    const account = await this.db.emailAccount.update({
      where: { id: accountId },
      data: {
        encryptedConnectionConfig: encryptEmailConnectionConfig(config),
        lastConnectionError: null,
        status: "active"
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
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });
    return articles.map(mapKnowledgeArticle);
  }

  async getKnowledgeArticle(context: RequestContext, articleId: string): Promise<KnowledgeArticle> {
    requirePermission(context, "crm.read");
    const article = await this.db.knowledgeArticle.findFirst({
      where: { id: articleId, workspaceId: context.workspaceId }
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
    return mapKnowledgeArticle(article);
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
    const article = await this.db.knowledgeArticle.update({
      where: { id: existing.id },
      data: {
        title: input.title !== undefined ? normalizeRequiredText(input.title, "Knowledge title") : undefined,
        body: input.body !== undefined ? normalizeRequiredText(input.body, "Knowledge body") : undefined,
        tags: input.tags !== undefined ? uniqueTags(input.tags) : undefined,
        active: input.active
      }
    });
    await this.writeAuditLog(context, "update", "knowledge_article", article.id, {
      summary: `Updated knowledge article ${article.title}`,
      details: { tags: article.tags, active: article.active }
    });
    return mapKnowledgeArticle(article);
  }

  async deleteKnowledgeArticle(context: RequestContext, articleId: string): Promise<void> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.knowledgeArticle.findFirst({
      where: { id: articleId, workspaceId: context.workspaceId }
    });
    if (!existing) {
      throw new Error("Knowledge article not found");
    }
    const article = await this.db.knowledgeArticle.update({
      where: { id: existing.id },
      data: { active: false }
    });
    await this.writeAuditLog(context, "update", "knowledge_article", article.id, {
      summary: `Disabled knowledge article ${article.title}`,
      details: { active: false }
    });
  }

  async getEmailAiSettings(context: RequestContext): Promise<EmailAiSettings> {
    requirePermission(context, "crm.read");
    return this.ensureEmailAiSettings(context.workspaceId);
  }

  async updateEmailAiSettings(
    context: RequestContext,
    patch: Partial<Omit<EmailAiSettings, "workspaceId" | "updatedAt" | "features" | "agents">> & {
      features?: Partial<EmailAiSettings["features"]>;
      agents?: unknown;
    }
  ): Promise<EmailAiSettings> {
    requirePermission(context, "crm.admin");
    const current = await this.ensureEmailAiSettings(context.workspaceId);
    const features = normalizeEmailAiFeatures({ ...current.features, ...(patch.features ?? {}) });
    const agents = patch.agents !== undefined ? normalizeAiAgentSettings(patch.agents) : normalizeAiAgentSettings(current.agents);
    const updated = await this.db.emailAiSettings.update({
      where: { workspaceId: context.workspaceId },
      data: {
        features: features as Prisma.InputJsonValue,
        agents: agents as unknown as Prisma.InputJsonValue,
        defaultLocale: patch.defaultLocale?.trim() || current.defaultLocale,
        requireSourceLinks: patch.requireSourceLinks ?? current.requireSourceLinks,
        maxHistoryMessages: normalizeIntegerLimit(patch.maxHistoryMessages ?? current.maxHistoryMessages, 1, 20),
        maxKnowledgeArticles: normalizeIntegerLimit(patch.maxKnowledgeArticles ?? current.maxKnowledgeArticles, 0, 20),
        maxContextChars: normalizeIntegerLimit(patch.maxContextChars ?? current.maxContextChars, 1000, 20000)
      }
    });
    await this.writeAuditLog(context, "update", "email_ai_settings", context.workspaceId, {
      summary: "Updated email AI settings",
      details: { features: updated.features, defaultLocale: updated.defaultLocale, agentCount: agents.length }
    });
    return mapEmailAiSettings(updated);
  }

  async buildEmailAssistantContext(
    context: RequestContext,
    input: { purpose: EmailAssistantPurpose; recordId?: string; threadId?: string; sourceMessageId?: string; targetLocale?: string }
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
    const knowledgeArticles = await this.listKnowledgeArticles(context, true);

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
      targetLocale: input.targetLocale
    });
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

  async createTeam(context: RequestContext, input: Pick<Team, "name">): Promise<Team> {
    requirePermission(context, "crm.admin");
    const name = normalizeTeamName(input.name);
    await this.assertTeamNameAvailable(context, name);

    const team = await this.db.team.create({
      data: {
        workspaceId: context.workspaceId,
        name
      }
    });

    await this.writeAuditLog(context, "create", "team", team.id, {
      summary: `Created team ${team.name}`,
      details: { name: team.name }
    });

    return mapTeam(team);
  }

  async updateTeam(context: RequestContext, id: string, patch: Partial<Pick<Team, "name">>): Promise<Team> {
    requirePermission(context, "crm.admin");
    const existing = await this.db.team.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== context.workspaceId) {
      throw new Error("Team not found");
    }

    const name = normalizeTeamName(patch.name ?? existing.name);
    if (name !== existing.name) {
      await this.assertTeamNameAvailable(context, name, id);
    }
    const team = await this.db.team.update({ where: { id }, data: { name } });

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
      recentActivities: recentActivities.map(mapActivity)
    };
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
    const accessWhere = await this.recordAccessWhere(context);
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
      query: normalizeRecordListQuery(query, safePage, pageSize)
    };
  }

  async exportRecordsCsv(context: RequestContext, objectKey: string, query: RecordListQuery = {}): Promise<string> {
    requirePermission(context, "crm.read");
    await this.requireObject(context, objectKey);
    const fields = await this.listFieldDefinitions(context, objectKey);
    const result = await this.queryRecords(context, objectKey, { ...query, page: 1, pageSize: 200 });
    const headers = ["id", "title", "stageKey", "ownerId", "createdAt", "updatedAt", ...fields.map((field) => field.key)];
    return buildCsv(
      headers,
      result.records.map((record) => ({
        id: record.id,
        title: record.title,
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
    const headers = ["title", ...fields.map((field) => field.key)];
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
        ...(await this.recordAccessWhere(context))
      }
    });
    if (!record) {
      throw new Error("Record not found");
    }
    return mapRecord(record);
  }

  async createRecord(context: RequestContext, objectKey: string, input: Pick<CrmRecord, "title" | "data" | "stageKey" | "ownerId">): Promise<CrmRecord> {
    requirePermission(context, "crm.write");
    await this.requireObject(context, objectKey);
    const fields = await this.listFieldDefinitions(context, objectKey);
    const existing = await this.listRecordsForValidation(context, objectKey);
    const data = objectKey === "quotes" ? normalizeQuoteRecordData(input.data, await this.listRecordsForValidation(context, "currencies")) : input.data;
    if (objectKey === "quotes") {
      validateQuoteRecordData(data, await this.listRecordsForValidation(context, "products"));
    }
    validateRecordPayload(fields, data, existing);
    await this.assertRecordReferences(context, fields, data, true);

    const record = await this.db.crmRecord.create({
      data: {
        workspaceId: context.workspaceId,
        objectKey,
        title: input.title,
        stageKey: input.stageKey,
        ownerId: canManageAllRecords(context) ? input.ownerId ?? context.user.id : context.user.id,
        data: data as Prisma.InputJsonValue
      }
    });

    await this.writeAuditLog(context, "create", "record", record.id, {
      objectKey,
      summary: `Created ${objectKey} record ${record.title}`,
      details: { title: record.title, ownerId: record.ownerId, stageKey: record.stageKey }
    });

    const mapped = mapRecord(record);
    this.emitWebhookEvent(context, "record.created", {
      recordId: mapped.id,
      objectKey: mapped.objectKey,
      title: mapped.title,
      ownerId: mapped.ownerId
    });
    return mapped;
  }

  async updateRecord(
    context: RequestContext,
    objectKey: string,
    recordId: string,
    patch: Partial<Pick<CrmRecord, "title" | "data" | "stageKey" | "ownerId">>
  ): Promise<CrmRecord> {
    requirePermission(context, "crm.write");
    const current = await this.getRecord(context, objectKey, recordId);
    const mergedData = { ...current.data, ...(patch.data ?? {}) };
    const nextData = objectKey === "quotes" ? normalizeQuoteRecordData(mergedData, await this.listRecordsForValidation(context, "currencies")) : mergedData;
    const fields = await this.listFieldDefinitions(context, objectKey);
    if (objectKey === "quotes") {
      validateQuoteRecordData(nextData, await this.listRecordsForValidation(context, "products"));
    }
    validateRecordPayload(fields, nextData, await this.listRecordsForValidation(context, objectKey), recordId);
    await this.assertRecordReferences(context, fields, nextData, true);

    const updated = await this.db.crmRecord.update({
      where: { id: recordId },
      data: {
        title: patch.title ?? current.title,
        data: nextData as Prisma.InputJsonValue,
        ownerId: canManageAllRecords(context) ? patch.ownerId ?? current.ownerId : current.ownerId,
        stageKey: patch.stageKey ?? current.stageKey
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
      details: { patch, previousStageKey: current.stageKey, nextStageKey: updated.stageKey }
    });

    const mapped = mapRecord(updated);
    this.emitWebhookEvent(context, "record.updated", {
      recordId: mapped.id,
      objectKey: mapped.objectKey,
      title: mapped.title,
      previousStageKey: current.stageKey,
      nextStageKey: mapped.stageKey,
      ownerId: mapped.ownerId
    });
    return mapped;
  }

  async deleteRecord(context: RequestContext, objectKey: string, recordId: string): Promise<void> {
    requirePermission(context, "crm.write");
    const record = await this.getRecord(context, objectKey, recordId);
    await this.db.activity.deleteMany({ where: { recordId } });
    await this.db.crmRecord.delete({ where: { id: recordId } });
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

  async listActivities(context: RequestContext, recordId?: string): Promise<Activity[]> {
    requirePermission(context, "crm.read");
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
    const activities = await this.db.activity.findMany({
      where: {
        workspaceId: context.workspaceId,
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

  async createActivity(context: RequestContext, input: Omit<Activity, "id" | "workspaceId" | "createdAt" | "actorId">): Promise<Activity> {
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
    const created = await this.db.activity.create({
      data: {
        workspaceId: context.workspaceId,
        recordId: input.recordId,
        type: input.type,
        title: input.title,
        body: input.body,
        actorId: context.user.id,
        dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
        completedAt: input.completedAt ? new Date(input.completedAt) : undefined
      }
    });
    await this.writeAuditLog(context, "create", "activity", created.id, {
      summary: `Created ${created.type} activity ${created.title}`,
      details: { recordId: created.recordId, type: created.type, title: created.title }
    });
    const mapped = mapActivity(created);
    this.emitWebhookEvent(context, "activity.created", {
      activityId: mapped.id,
      recordId: mapped.recordId,
      type: mapped.type,
      title: mapped.title
    });
    return mapped;
  }

  async updateActivity(
    context: RequestContext,
    activityId: string,
    patch: Partial<Pick<Activity, "title" | "body">> & { dueAt?: string | null; completedAt?: string | null; archivedAt?: string | null }
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

    const updated = await this.db.activity.update({
      where: { id: activityId },
      data: {
        title: patch.title,
        body: patch.body,
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
          created.push(await this.createRecord(context, objectKey, { title: row.title, data }));
          continue;
        }

        if (row.status === "conflict" && strategy === "update-existing") {
          const existingRecordId = getSingleConflictRecordId(row.conflicts);
          if (existingRecordId) {
            const data = coerceRow(row.values, fields);
            updated.push(await this.updateRecord(context, objectKey, existingRecordId, { title: row.title, data }));
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
    const webhooks = await this.db.webhookEndpoint.findMany({
      where: {
        workspaceId: context.workspaceId,
        active: true,
        events: { has: event }
      },
      orderBy: { createdAt: "asc" }
    });

    const deliveries: WebhookDelivery[] = [];
    for (const webhook of webhooks) {
      deliveries.push(await this.deliverWebhook(context, webhook, event, data));
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

  private emitWebhookEvent(context: RequestContext, event: WebhookEvent, data: Record<string, unknown>): void {
    void getBackgroundJobExecutor(this)
      .runWebhookEvent(context, { event, data })
      .catch((error) => {
        console.error(`Failed to enqueue webhook event ${event}`, error);
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
    const existing = await this.listRecordsForValidation(context, objectKey);
    const errors: string[] = [];
    const previewRows: CsvImportPreview["rows"] = [];
    const draftRecords: CrmRecord[] = [];
    const conflicts: CsvImportConflict[] = [];
    let creatableRows = 0;

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const rowErrors: string[] = [];
      const rowConflicts: CsvImportConflict[] = [];
      let title = "";

      try {
        const mappedRow = applyCsvImportMapping(row, normalizedMapping);
        title = String(mappedRow.title ?? mappedRow.name ?? "").trim();
        if (!title) {
          throw new Error("Missing title or name column");
        }
        const data = coerceRow(mappedRow, fields);
        rowConflicts.push(...findCsvImportConflicts(rowNumber, fields, data, existing));
        validateRecordPayload(fields, data, draftRecords);
        await this.assertRecordReferences(context, fields, data, true);
        if (rowConflicts.length === 0) {
          draftRecords.push({
            id: `csv-row-${rowNumber}`,
            workspaceId: context.workspaceId,
            objectKey,
            title,
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

      errors.push(...rowErrors.map((item) => `Row ${rowNumber}: ${item}`));
      errors.push(...rowConflicts.map((conflict) => formatCsvImportConflict(conflict)));
      conflicts.push(...rowConflicts);
      previewRows.push({
        rowNumber,
        title,
        status: rowErrors.length > 0 ? "error" : rowConflicts.length > 0 ? "conflict" : "ready",
        errors: rowErrors,
        conflicts: rowConflicts,
        values: applyCsvImportMapping(row, normalizedMapping)
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
            ...(requireVisibleRecord ? await this.recordAccessWhere(context) : {})
          },
          select: { id: true }
        });
        if (!targetRecord) {
          throw new Error(`${field.label} references a missing record`);
        }
      }
    }
  }

  private async recordAccessWhere(context: RequestContext): Promise<Prisma.CrmRecordWhereInput> {
    if (canManageAllRecords(context)) {
      return {};
    }

    const ownerIds = await this.visibleOwnerIds(context);
    return { ownerId: { in: ownerIds } };
  }

  private async recordQuerySql(context: RequestContext, objectKey: string, query: RecordListQuery): Promise<Prisma.Sql> {
    const filters = query.filters?.filter((filter) => filter.field && filter.value.trim()) ?? [];
    const clauses: Prisma.Sql[] = [Prisma.sql`"workspaceId" = ${context.workspaceId}`, Prisma.sql`"objectKey" = ${objectKey}`];

    if (!canManageAllRecords(context)) {
      clauses.push(Prisma.sql`"ownerId" IN (${Prisma.join(await this.visibleOwnerIds(context))})`);
    }

    for (const filter of filters) {
      clauses.push(recordFilterSql(filter.field, filter.operator, filter.value));
    }

    const search = query.q?.trim();
    if (search) {
      clauses.push(Prisma.sql`(lower("title") LIKE '%' || lower(${search}) || '%' OR lower("data"::text) LIKE '%' || lower(${search}) || '%')`);
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
    const records = await this.db.crmRecord.findMany({ where: { id: { in: rows.map((row) => row.id) } } });
    return records.map(mapRecord).sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
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
        defaultLocale: defaults.defaultLocale,
        requireSourceLinks: defaults.requireSourceLinks,
        maxHistoryMessages: defaults.maxHistoryMessages,
        maxKnowledgeArticles: defaults.maxKnowledgeArticles,
        maxContextChars: defaults.maxContextChars
      }
    });
    return mapEmailAiSettings(created);
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
    const participantSet = new Set(participants.map(normalizeEmailAddress).filter((email) => email !== accountAddress));
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
        const normalized = normalizeEmailAddress(email);
        return normalized !== accountAddress && participantSet.has(normalized);
      });
    });
    if (!match) {
      return undefined;
    }
    return match.recordId ? this.assertEmailThread(context, match.id) : match;
  }

  private async findVisibleRecordByEmailParticipants(context: RequestContext, accountEmail: string, participants: string[]): Promise<CrmRecord | undefined> {
    const accountAddress = normalizeEmailAddress(accountEmail);
    const emails = Array.from(new Set(participants.map((participant) => normalizeEmailAddress(participant)).filter((email) => email !== accountAddress)));
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
    const columnKeys = new Set(["title", "ownerId", "stageKey", ...fieldKeys]);
    const queryKeys = new Set(["title", "ownerId", "stageKey", "createdAt", "updatedAt", ...fieldKeys]);

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

function sortDirectionSql(direction: "asc" | "desc"): Prisma.Sql {
  return direction === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
}

function recordFilterSql(field: string, operator: "contains" | "equals", value: string): Prisma.Sql {
  const normalized = value.trim();
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

  return operator === "equals"
    ? Prisma.sql`lower("data"->>${field}) = lower(${normalized})`
    : Prisma.sql`lower("data"->>${field}) LIKE '%' || lower(${normalized}) || '%'`;
}

function recordOrderBySql(sort: RecordListQuery["sort"]): Prisma.Sql {
  if (!sort?.field) {
    return Prisma.sql`"updatedAt" DESC, "id" ASC`;
  }

  if (sort.field === "createdAt" || sort.field === "updatedAt") {
    return Prisma.sql`${Prisma.raw(`"${sort.field}"`)} ${sortDirectionSql(sort.direction)}, "title" ${sortDirectionSql(sort.direction)}, "id" ASC`;
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
  return {
    page,
    pageSize,
    q: query.q?.trim() || undefined,
    filters: query.filters?.filter((filter) => filter.field && filter.value.trim()),
    sort: query.sort?.field ? query.sort : undefined
  };
}

function isBlankValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function normalizeGovernedValue(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : JSON.stringify(value);
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
  return ["title", "name", "rowNumber", "status", "issues"].includes(header);
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

function uniqueEmails(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeEmailAddress)));
}

function normalizeEmailSubject(value: string): string {
  return value
    .trim()
    .replace(/^(\s*(re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function uniqueTags(values: string[]): string[] {
  return Array.from(new Set(values.map((tag) => tag.trim().toLowerCase()).filter(Boolean))).slice(0, 50);
}

function normalizeIntegerLimit(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
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

function recordDataHasEmail(data: unknown, emailAddress: string): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return false;
  }
  const normalizedEmail = normalizeEmailAddress(emailAddress);
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
  return [...methodEmails, ...fieldEmails].some((value) =>
    value
      .split(/[,\s;]+/)
      .map(normalizeEmailAddress)
      .includes(normalizedEmail)
  );
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

function buildImportTemplateExampleRow(fields: FieldDefinition[]): Record<string, unknown> {
  return {
    title: "Example record",
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
      label: "名称",
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

function normalizeEmailAiProviderError(value: string | undefined): string | undefined {
  const normalized = value?.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 500) : undefined;
}
