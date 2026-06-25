export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "currency"
  | "date"
  | "select"
  | "boolean"
  | "user"
  | "reference";

export type Permission =
  | "crm.read"
  | "crm.write"
  | "crm.import"
  | "crm.admin"
  | "ai.use"
  | "ai.admin";

export type EmailAiGenerationMode = "disabled" | "local" | "provider" | "provider_fallback" | "queued";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
}

export interface Role {
  id: string;
  workspaceId: string;
  name: string;
  permissions: Permission[];
}

export interface Team {
  id: string;
  workspaceId: string;
  name: string;
}

export interface User {
  id: string;
  workspaceId: string;
  email: string;
  name: string;
  roleId: string;
  teamId?: string;
  active: boolean;
  disabledAt?: string;
}

export interface ApiKey {
  id: string;
  workspaceId: string;
  name: string;
  tokenPrefix: string;
  permissions: Permission[];
  createdById: string;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedApiKey {
  apiKey: ApiKey;
  token: string;
}

export type WebhookEvent =
  | "record.created"
  | "record.updated"
  | "record.deleted"
  | "activity.created"
  | "import.completed"
  | "import.failed"
  | "webhook.test";

export type WebhookDeliveryStatus = "pending" | "success" | "failed";

export interface WebhookEndpoint {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  secretPrefix: string;
  active: boolean;
  createdById: string;
  lastDeliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedWebhookEndpoint {
  webhook: WebhookEndpoint;
  secret: string;
}

export interface WebhookDelivery {
  id: string;
  workspaceId: string;
  webhookId: string;
  event: WebhookEvent;
  status: WebhookDeliveryStatus;
  attempts: number;
  requestBody: Record<string, unknown>;
  responseStatus?: number;
  responseBody?: string;
  errorMessage?: string;
  createdAt: string;
  deliveredAt?: string;
}

export type EmailProviderType = "smtp_imap" | "gmail" | "outlook" | "custom";
export type EmailAccountStatus = "draft" | "active" | "disabled" | "error";
export type EmailDirection = "inbound" | "outbound";
export type EmailMessageStatus = "received" | "draft" | "queued" | "sending" | "sent" | "failed";
export type EmailAssistantPurpose = "draft" | "translate" | "context_analysis" | "summarize";
export type EmailAiFeature = "draft" | "translate" | "auto_translate" | "context_analysis" | "auto_context_analysis" | "auto_summarize";
export type AiProviderType = "openai" | "gemini" | "openrouter" | "custom" | "openai-compatible";

export interface EmailAccount {
  id: string;
  workspaceId: string;
  name: string;
  emailAddress: string;
  provider: EmailProviderType;
  status: EmailAccountStatus;
  syncEnabled: boolean;
  sendEnabled: boolean;
  connectionConfigured: boolean;
  lastConnectionError?: string;
  createdById: string;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailSignature {
  id: string;
  workspaceId: string;
  accountId?: string;
  name: string;
  bodyText: string;
  bodyHtml?: string;
  isDefault: boolean;
  active: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailConnectionConfig {
  inbound?: EmailInboundConnectionConfig;
  outboundServices?: EmailOutboundServiceConfig[];
  defaultOutboundServiceId?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpStartTls?: boolean;
  syncProtocol?: "imap" | "pop3";
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  pop3Host?: string;
  pop3Port?: number;
  pop3Secure?: boolean;
  username?: string;
  password?: string;
  mailbox?: string;
  oauthProvider?: "gmail" | "outlook" | "custom";
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: string;
  scope?: string;
}

export interface EmailInboundConnectionConfig {
  syncProtocol?: "imap" | "pop3";
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  pop3Host?: string;
  pop3Port?: number;
  pop3Secure?: boolean;
  username?: string;
  password?: string;
  mailbox?: string;
  oauthProvider?: "gmail" | "outlook" | "custom";
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: string;
  scope?: string;
}

export interface EmailOutboundServiceConfig {
  id: string;
  name: string;
  type: "smtp" | "resend";
  enabled?: boolean;
  fromEmail?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpStartTls?: boolean;
  username?: string;
  password?: string;
  resendApiKey?: string;
}

export interface EmailThread {
  id: string;
  workspaceId: string;
  accountId: string;
  subject: string;
  participantEmails: string[];
  recordId?: string;
  summary?: string;
  summaryUpdatedAt?: string;
  aiAnalysis?: string;
  aiAnalysisSources?: Array<{ label: string; recordId?: string; activityId?: string; messageId?: string; knowledgeArticleId?: string }>;
  aiAnalysisUpdatedAt?: string;
  lastMessageAt?: string;
  archived?: boolean;
  category?: "primary" | "promotions" | "social" | "updates";
  deleted?: boolean;
  important?: boolean;
  labels?: string[];
  read?: boolean;
  snoozedUntil?: string;
  starred?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmailThreadState {
  id: string;
  workspaceId: string;
  threadId: string;
  userId: string;
  archived: boolean;
  category?: "primary" | "promotions" | "social" | "updates";
  deleted: boolean;
  important: boolean;
  labels: string[];
  read: boolean;
  snoozedUntil?: string;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmailAttachment {
  id?: string;
  fileName: string;
  contentType?: string;
  size: number;
  contentBase64?: string;
  contentId?: string;
  disposition?: "attachment" | "inline";
  providerMessageId?: string;
  providerAttachmentId?: string;
  externalUrl?: string;
}

export interface EmailTrackingEvent {
  type: "open" | "click";
  occurredAt: string;
  ip?: string;
  country?: string;
  timezone?: string;
  userAgent?: string;
  url?: string;
}

export interface EmailInboundMetadata {
  sourceIp?: string;
  country?: string;
  timezone?: string;
  userAgent?: string;
  receivedHeader?: string;
}

export interface EmailMessage {
  id: string;
  workspaceId: string;
  threadId: string;
  accountId: string;
  direction: EmailDirection;
  status: EmailMessageStatus;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  attachments?: EmailAttachment[];
  translatedBodyText?: string;
  translatedLocale?: string;
  translatedSources?: Array<{ label: string; recordId?: string; activityId?: string; messageId?: string; knowledgeArticleId?: string }>;
  translatedAt?: string;
  aiAssisted?: boolean;
  aiPurpose?: EmailAssistantPurpose;
  aiSourceMessageId?: string;
  aiSources?: Array<{ label: string; recordId?: string; activityId?: string; messageId?: string; knowledgeArticleId?: string }>;
  aiGeneratedAt?: string;
  externalMessageId?: string;
  clientRequestId?: string;
  failureReason?: string;
  sendAttemptedAt?: string;
  scheduledSendAt?: string;
  sentAt?: string;
  receivedAt?: string;
  trackingEnabled?: boolean;
  trackingId?: string;
  trackingEvents?: EmailTrackingEvent[];
  inboundMetadata?: EmailInboundMetadata;
  groupSendMode?: boolean;
  createdById?: string;
  createdAt: string;
}

export interface KnowledgeArticle {
  id: string;
  workspaceId: string;
  title: string;
  body: string;
  tags: string[];
  active: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export type TalkTargetRef =
  | { type: "record"; objectKey: string; recordId: string }
  | { type: "email_thread"; threadId: string };

export interface TalkMessage {
  id: string;
  workspaceId: string;
  targetType: TalkTargetRef["type"];
  objectKey?: string;
  recordId?: string;
  threadId?: string;
  role: "user" | "assistant";
  content: string;
  sources?: Array<{ label: string; objectKey?: string; recordId?: string; messageId?: string; knowledgeArticleId?: string }>;
  knowledgeArticleId?: string;
  createdById: string;
  createdAt: string;
}

export interface MediaAsset {
  id: string;
  workspaceId: string;
  name: string;
  contentType: string;
  size: number;
  contentBase64: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailAiSettings {
  workspaceId: string;
  features: Record<EmailAiFeature, boolean>;
  agents: AiAgentSetting[];
  providerConfig: AiProviderConfig;
  defaultLocale: string;
  requireSourceLinks: boolean;
  maxHistoryMessages: number;
  maxKnowledgeArticles: number;
  maxContextChars: number;
  updatedAt: string;
}

export type EmailSyncScheduleMode = "interval" | "daily";

export interface EmailSyncSettings {
  workspaceId: string;
  enabled: boolean;
  mode: EmailSyncScheduleMode;
  intervalMinutes: number;
  dailyAt: string;
  limit: number;
  updatedAt: string;
}

export interface AiProviderConfig {
  provider: AiProviderType;
  baseUrl: string;
  apiKey?: string;
  hasApiKey?: boolean;
  model: string;
  timeoutMs: number;
}

export interface AiAgentSetting {
  key: string;
  name: string;
  scenario: "email" | "sales" | "system";
  enabled: boolean;
  model: string;
  agentMarkdown: string;
  maxOutputChars: number;
}

export interface EmailAiGenerationAuditInput {
  purpose: "draft" | "translate" | "context_analysis" | "summarize";
  enabled: boolean;
  recordId?: string;
  threadId?: string;
  sourceMessageId?: string;
  sourceCount: number;
  sourceLabels?: string[];
  targetLocale?: string;
  userPromptLength?: number;
  sourceTextLength?: number;
  resultTextLength?: number;
  contextCharCount?: number;
  maxContextChars?: number;
  modelPromptChars?: number;
  contextTruncated?: boolean;
  outputTruncated?: boolean;
  generationMode?: EmailAiGenerationMode;
  providerError?: string;
  suggestedSubjectProvided?: boolean;
  persisted?: boolean;
  automationFailed?: boolean;
  errorMessage?: string;
}

export interface ObjectDefinition {
  id: string;
  workspaceId: string;
  key: string;
  label: string;
  pluralLabel: string;
  description?: string;
  icon?: string;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FieldDefinition {
  id: string;
  workspaceId: string;
  objectKey: string;
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  unique: boolean;
  options?: Array<{ label: string; value: string }>;
  defaultValue?: unknown;
  isSystem: boolean;
  position: number;
}

export interface RelationDefinition {
  id: string;
  workspaceId: string;
  fromObjectKey: string;
  toObjectKey: string;
  key: string;
  label: string;
  cardinality: "one-to-one" | "one-to-many" | "many-to-many";
}

export interface CrmRecord {
  id: string;
  workspaceId: string;
  objectKey: string;
  title: string;
  stageKey?: string;
  ownerId?: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RecordFilter {
  field: string;
  operator: "contains" | "equals";
  value: string;
}

export interface RecordSort {
  field: string;
  direction: "asc" | "desc";
}

export interface RecordListQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  filters?: RecordFilter[];
  sort?: RecordSort;
}

export interface RecordListResult {
  records: CrmRecord[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  query: RecordListQuery;
}

export interface DashboardSummary {
  recordCounts: Record<string, number>;
  totalPipeline: number;
  openTaskCount: number;
  deals: CrmRecord[];
  openTasks: Activity[];
  recentActivities: Activity[];
}

export interface PipelineStage {
  key: string;
  label: string;
  probability: number;
  position: number;
  color: string;
}

export interface Pipeline {
  id: string;
  workspaceId: string;
  objectKey: string;
  name: string;
  isDefault: boolean;
  stages: PipelineStage[];
}

export type ActivityType = "note" | "call" | "meeting" | "task" | "email" | "stage_change";

export type AuditAction = "create" | "update" | "delete" | "import" | "api_error";

export interface Activity {
  id: string;
  workspaceId: string;
  recordId?: string;
  type: ActivityType;
  title: string;
  body?: string;
  actorId?: string;
  dueAt?: string;
  completedAt?: string;
  archivedAt?: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  workspaceId: string;
  actorId?: string;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  objectKey?: string;
  summary: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLogQuery {
  action?: AuditAction;
  entityType?: string;
  objectKey?: string;
  actorId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface SavedView {
  id: string;
  workspaceId: string;
  objectKey: string;
  name: string;
  columns: string[];
  filters?: RecordFilter[];
  sort?: RecordSort;
  isDefault: boolean;
}

export interface CsvImportPreview {
  headers: string[];
  totalRows: number;
  creatableRows: number;
  errorRows: number;
  conflictRows: number;
  errors: string[];
  conflicts: CsvImportConflict[];
  mappedFields: Array<{ key: string; label: string; type: FieldType }>;
  unmappedHeaders: string[];
  rows: CsvImportRowPreview[];
}

export type CsvImportStrategy = "skip-invalid" | "all-or-nothing" | "update-existing";
export type ImportJobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";
export type CsvImportMapping = Record<string, string>;

export interface CsvImportJobSourcePayload {
  objectKey: string;
  csv: string;
  strategy: CsvImportStrategy;
  mapping?: CsvImportMapping;
  presetId?: string;
  presetName?: string;
}

export interface ImportPreset {
  id: string;
  workspaceId: string;
  objectKey: string;
  name: string;
  strategy: CsvImportStrategy;
  mapping?: CsvImportMapping;
  createdById?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CsvImportResult {
  created: CrmRecord[];
  updated: CrmRecord[];
  errors: string[];
  strategy: CsvImportStrategy;
  aborted: boolean;
  preview: CsvImportPreview;
}

export interface CsvImportRowPreview {
  rowNumber: number;
  title: string;
  status: "ready" | "error" | "conflict";
  errors: string[];
  conflicts: CsvImportConflict[];
  values: Record<string, string>;
}

export interface CsvImportConflict {
  rowNumber: number;
  fieldKey: string;
  fieldLabel: string;
  value: string;
  existingRecordId: string;
  existingRecordTitle: string;
}

export interface CsvImportJob {
  id: string;
  workspaceId: string;
  objectKey: string;
  status: ImportJobStatus;
  strategy: CsvImportStrategy;
  totalRows: number;
  createdCount: number;
  errorCount: number;
  aborted: boolean;
  errorMessage?: string;
  preview?: CsvImportPreview;
  result?: CsvImportResult;
  sourcePayload?: CsvImportJobSourcePayload;
  requestedById?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ImportJobQueueSummary {
  total: number;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
  deadLettered: number;
  lastUpdatedAt?: string;
  recentJobs: CsvImportJob[];
  recentFailures: CsvImportJob[];
}

export interface CrmSnapshot {
  workspaces: Workspace[];
  roles: Role[];
  teams: Team[];
  users: User[];
  objectDefinitions: ObjectDefinition[];
  fieldDefinitions: FieldDefinition[];
  relationDefinitions: RelationDefinition[];
  records: CrmRecord[];
  pipelines: Pipeline[];
  activities: Activity[];
  auditLogs: AuditLog[];
  savedViews: SavedView[];
  importJobs: CsvImportJob[];
  importPresets: ImportPreset[];
  apiKeys: ApiKey[];
  webhooks: WebhookEndpoint[];
  webhookDeliveries: WebhookDelivery[];
  emailAccounts: EmailAccount[];
  emailSignatures?: EmailSignature[];
  emailThreads: EmailThread[];
  emailThreadStates: EmailThreadState[];
  emailMessages: EmailMessage[];
  knowledgeArticles: KnowledgeArticle[];
  talkMessages?: TalkMessage[];
  emailAiSettings: EmailAiSettings[];
  emailSyncSettings?: EmailSyncSettings[];
  mediaAssets?: MediaAsset[];
}

export interface RequestContext {
  workspaceId: string;
  user: User;
  role: Role;
}
