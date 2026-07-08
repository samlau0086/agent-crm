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
  | "crm.pool.manage"
  | "crm.admin"
  | "workflow.read"
  | "workflow.write"
  | "workflow.admin"
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
  emailListDisplayMode: "thread" | "message";
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
  | `record.${string}.created`
  | `record.${string}.updated`
  | `record.${string}.deleted`
  | "activity.created"
  | "email.message.created"
  | "email.message.received"
  | "email.message.queued"
  | "email.message.sent"
  | "email.message.failed"
  | "email.thread.updated"
  | "email.thread.deleted"
  | "import.completed"
  | "import.failed"
  | "workflow.run_started"
  | "workflow.run_completed"
  | "workflow.run_failed"
  | "workflow.action_approval_requested"
  | "workflow.action_approved"
  | "workflow.action_rejected"
  | "ai.reminder.created"
  | "ai.reminder.daily_digest"
  | "ai.reminder.failed"
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

export type NotificationChannelType = "bark" | "webhook" | "email";
export type NotificationEvent = WebhookEvent;

export interface NotificationChannel {
  id: string;
  workspaceId: string;
  name: string;
  type: NotificationChannelType;
  events: NotificationEvent[];
  config: Record<string, unknown>;
  active: boolean;
  createdById: string;
  lastNotifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type EmailProviderType = "smtp_imap" | "gmail" | "outlook" | "custom";
export type EmailAccountStatus = "draft" | "active" | "disabled" | "error";
export type EmailAccountSyncStatus = "idle" | "queued" | "running" | "synced" | "failed";
export type EmailDirection = "inbound" | "outbound";
export type EmailMessageStatus = "received" | "draft" | "queued" | "sending" | "sent" | "failed";
export type EmailAssistantPurpose = "draft" | "translate" | "context_analysis" | "summarize";
export type EmailAiFeature = "draft" | "translate" | "auto_translate" | "context_analysis" | "auto_context_analysis" | "auto_summarize";
export type AiProviderType = "openai" | "gemini" | "openrouter" | "custom" | "openai-compatible";
export type AiAgentScenario = "email" | "sales" | "system";
export type AiAgentKey =
  | "email_draft"
  | "email_translation"
  | "email_context_analysis"
  | "email_thread_summary"
  | "email_classification"
  | "inbound_email_preprocess"
  | "record_summary"
  | "next_action_suggestion"
  | "ai_query_planner"
  | "talk_about_this"
  | "workflow_designer"
  | "workflow_ai_agent_node"
  | "smart_reminder_planner";

export interface EmailAccount {
  id: string;
  workspaceId: string;
  name: string;
  emailAddress: string;
  provider: EmailProviderType;
  status: EmailAccountStatus;
  syncEnabled: boolean;
  sendEnabled: boolean;
  defaultSignatureId?: string;
  connectionConfigured: boolean;
  lastConnectionError?: string;
  createdById: string;
  lastSyncedAt?: string;
  lastSyncStatus?: EmailAccountSyncStatus;
  lastSyncStartedAt?: string;
  lastSyncFinishedAt?: string;
  lastSyncScannedCount?: number;
  lastSyncImportedCount?: number;
  lastSyncSkippedDuplicateCount?: number;
  lastSyncError?: string;
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
  aiAnalysisSources?: Array<{ label: string; objectKey?: string; recordId?: string; activityId?: string; messageId?: string; knowledgeArticleId?: string }>;
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

export interface EmailDeletedMessage {
  id: string;
  workspaceId: string;
  accountId: string;
  externalMessageId: string;
  threadId?: string;
  deletedById?: string;
  createdAt: string;
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
  translatedSources?: Array<{ label: string; objectKey?: string; recordId?: string; activityId?: string; messageId?: string; knowledgeArticleId?: string }>;
  translatedAt?: string;
  aiAssisted?: boolean;
  aiPurpose?: EmailAssistantPurpose;
  aiSourceMessageId?: string;
  aiSources?: Array<{ label: string; objectKey?: string; recordId?: string; activityId?: string; messageId?: string; knowledgeArticleId?: string }>;
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
  vectorStatus?: KnowledgeVectorStatus;
}

export type KnowledgeVectorStatusState = "not_indexed" | "indexed" | "stale" | "failed";

export interface KnowledgeVectorStatus {
  state: KnowledgeVectorStatusState;
  chunkCount: number;
  indexedAt?: string;
  embeddingModel?: string;
  dimensions?: number;
  errorMessage?: string;
}

export interface KnowledgeVectorSettings {
  workspaceId: string;
  enabled: boolean;
  providerProfileKey: string;
  embeddingModel: string;
  dimensions: number;
  chunkSizeChars: number;
  chunkOverlapChars: number;
  topK: number;
  similarityThreshold: number;
  updatedAt: string;
}

export interface KnowledgeEmbeddingChunk {
  id: string;
  workspaceId: string;
  articleId: string;
  chunkIndex: number;
  chunkText: string;
  embeddingModel: string;
  dimensions: number;
  status: KnowledgeVectorStatusState;
  errorMessage?: string;
  indexedAt?: string;
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
  providerProfiles: AiProviderProfile[];
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

export type RecordPool = "public" | "private" | "all";

export type CrmPoolLevelKey = "A" | "B" | "C" | "D" | "unrated";

export interface CrmPoolLevelRule {
  level: CrmPoolLevelKey;
  enabled: boolean;
  privateLimit?: number;
  autoReclaimDays?: number;
}

export interface CrmPoolSettings {
  workspaceId: string;
  enabled: boolean;
  objectKeys: string[];
  privateLimit: number;
  autoReclaimEnabled: boolean;
  autoReclaimDays: number;
  levelRules: CrmPoolLevelRule[];
  lastAutoReclaimAt?: string;
  lastAutoReclaimCount: number;
  updatedAt: string;
}

export type RecordChangeRequestAction = "update" | "delete";
export type RecordChangeRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface RecordChangeRequest {
  id: string;
  workspaceId: string;
  objectKey: string;
  recordId: string;
  action: RecordChangeRequestAction;
  status: RecordChangeRequestStatus;
  reason: string;
  requestedById: string;
  reviewedById?: string;
  reviewNote?: string;
  patch?: Partial<Pick<CrmRecord, "title" | "data" | "stageKey" | "ownerId">> & {
    previous?: Partial<Pick<CrmRecord, "title" | "data" | "stageKey" | "ownerId">>;
    activity?: Partial<Pick<Activity, "recordId" | "type" | "title" | "body" | "dueAt" | "completedAt" | "archivedAt" | "createdAt">>;
    smartReminder?: Partial<
      Pick<SmartReminder, "kind" | "priority" | "title" | "body" | "actionLabel" | "dueAt" | "status" | "snoozedUntil" | "sources" | "createdAt">
    >;
  };
  recordTitle: string;
  createdAt: string;
  reviewedAt?: string;
}

export interface AiProviderConfig {
  provider: AiProviderType;
  baseUrl: string;
  apiKey?: string;
  hasApiKey?: boolean;
  model: string;
  timeoutMs: number;
}

export interface AiProviderProfile extends AiProviderConfig {
  key: string;
  name: string;
  enabled: boolean;
}

export interface AiAgentContextPolicy {
  includeRecord?: boolean;
  includeActivities?: boolean;
  includeEmailThread?: boolean;
  includeKnowledge?: boolean;
  includeProducts?: boolean;
  maxContextChars?: number;
  maxHistoryMessages?: number;
}

export interface AiAgentToolPolicy {
  allowRead?: boolean;
  allowWrite?: boolean;
  allowedTools?: string[];
  highRiskRequiresApproval?: boolean;
}

export interface AiAgentDefinition {
  key: AiAgentKey;
  name: string;
  scenario: AiAgentScenario;
  description: string;
  defaultModel: string;
  defaultAgentMarkdown: string;
  outputSchema: "text" | "email" | "query" | "workflow" | "classification";
  contextPolicy: AiAgentContextPolicy;
  toolPolicy: AiAgentToolPolicy;
  maxOutputChars: number;
}

export interface AiAgentSetting {
  key: string;
  name: string;
  scenario: AiAgentScenario;
  enabled: boolean;
  model: string;
  agentMarkdown: string;
  maxOutputChars: number;
  providerProfileKey?: string;
  provider?: AiProviderType;
  baseUrl?: string;
  contextPolicy?: AiAgentContextPolicy;
  toolPolicy?: AiAgentToolPolicy;
  outputSchema?: AiAgentDefinition["outputSchema"];
}

export interface AiAgentRunRequest {
  agentKey: string;
  task: string;
  userPrompt?: string;
  context?: Record<string, unknown>;
  expectedOutput?: AiAgentDefinition["outputSchema"];
  dryRun?: boolean;
}

export interface AiAgentRunResult {
  agentKey: string;
  agentName: string;
  enabled: boolean;
  generationMode: EmailAiGenerationMode;
  provider?: AiProviderType;
  model: string;
  text: string;
  structured?: Record<string, unknown>;
  sources: Array<{ label: string; objectKey?: string; recordId?: string; activityId?: string; messageId?: string; knowledgeArticleId?: string }>;
  budget: {
    promptChars: number;
    outputChars: number;
    maxOutputChars: number;
    truncated: boolean;
  };
  error?: string;
}

export interface AiAgentRunLog {
  id: string;
  agentKey: string;
  agentName?: string;
  generationMode?: EmailAiGenerationMode;
  provider?: AiProviderType;
  model?: string;
  promptChars?: number;
  outputChars?: number;
  error?: string;
  createdAt: string;
  createdById?: string;
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

export type CustomerLevel = "A" | "B" | "C" | "D";

export interface CustomerLevelDefinition {
  value: CustomerLevel;
  label: string;
  color: string;
  position: number;
  enabled: boolean;
  minScore: number;
  maxScore: number;
}

export interface CustomerLevelRuleWeights {
  dealAmount: number;
  dealStage: number;
  recentActivity: number;
  emailEngagement: number;
  inactivity: number;
  overdueTasks: number;
}

export interface CustomerLevelSettings {
  workspaceId: string;
  enabled: boolean;
  levels: CustomerLevelDefinition[];
  rules: CustomerLevelRuleWeights;
  updatedAt: string;
}

export interface CustomerLevelSuggestion {
  objectKey: string;
  recordId: string;
  level: CustomerLevel;
  score: number;
  reasons: string[];
  suggestedAt: string;
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
  cursor?: string;
  keyset?: boolean;
  fields?: string[];
  pool?: RecordPool;
}

export interface RecordListResult {
  records: CrmRecord[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  nextCursor?: string;
  paginationMode?: "offset" | "keyset";
  query: RecordListQuery;
}

export interface DashboardSummary {
  recordCounts: Record<string, number>;
  totalPipeline: number;
  openTaskCount: number;
  deals: CrmRecord[];
  openTasks: Activity[];
  recentActivities: Activity[];
  smartReminders: SmartReminder[];
}

export type SmartReminderKind =
  | "today_best_action"
  | "follow_up"
  | "overdue"
  | "email_reply"
  | "deal_close"
  | "risk"
  | "portfolio_health"
  | "data_quality"
  | "customer_level"
  | "pipeline_optimization";
export type SmartReminderPriority = "low" | "medium" | "high" | "urgent";
export type SmartReminderStatus = "open" | "done" | "dismissed";

export interface SmartReminderSource {
  label: string;
  objectKey?: string;
  recordId?: string;
  activityId?: string;
  threadId?: string;
  messageId?: string;
}

export interface SmartReminder {
  id: string;
  workspaceId: string;
  userId: string;
  objectKey?: string;
  recordId?: string;
  kind: SmartReminderKind;
  priority: SmartReminderPriority;
  title: string;
  body?: string;
  actionLabel?: string;
  dueAt?: string;
  status: SmartReminderStatus;
  snoozedUntil?: string;
  sources: SmartReminderSource[];
  score: number;
  idempotencyKey: string;
  generatedByAgentKey?: AiAgentKey;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  dismissedAt?: string;
}

export interface SmartReminderRun {
  id: string;
  workspaceId: string;
  userId?: string;
  status: "running" | "completed" | "failed";
  scope: Record<string, unknown>;
  generatedCount: number;
  fallback: boolean;
  agentKey?: AiAgentKey;
  provider?: string;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

export interface SmartReminderSettings {
  workspaceId: string;
  enabled: boolean;
  dailyAt: string;
  maxPerUser: number;
  objectKeys: string[];
  notifyCreated: boolean;
  notifyDailyDigest: boolean;
  updatedAt: string;
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

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "import"
  | "api_error"
  | "record.claimed"
  | "record.released"
  | "record.transferred"
  | "record.auto_reclaimed"
  | "record.change_requested"
  | "record.change_approved"
  | "record.change_rejected"
  | "record.change_cancelled"
  | "customer_level.suggested"
  | "customer_level.change_requested"
  | "customer_level.changed"
  | "workflow.created"
  | "workflow.updated"
  | "workflow.deleted"
  | "workflow.enabled"
  | "workflow.disabled"
  | "workflow.run_started"
  | "workflow.run_completed"
  | "workflow.run_failed"
  | "workflow.action_approval_requested"
  | "workflow.action_approved"
  | "workflow.action_rejected";

export type WorkflowStatus = "draft" | "active" | "disabled" | "archived";
export type WorkflowRunStatus = "running" | "waiting" | "completed" | "failed" | "skipped" | "approval_required";
export type WorkflowResumeStatus = "pending" | "completed" | "cancelled" | "failed";
export type WorkflowTriggerType = "crm_event" | "email_event" | "task_event" | "schedule" | "manual";
export type WorkflowConditionType = "field" | "activity" | "email_behavior" | "ai" | "if" | "switch" | "loop";
export type WorkflowActionType = "create_activity" | "send_email" | "update_stage" | "update_record" | "notify" | "create_knowledge_article" | "run_ai_agent";
export type WorkflowApprovalStatus = "pending" | "approved" | "rejected";
export type WorkflowScopeMode = "record" | "object" | "global";
export type WorkflowNodeType = "start" | "if" | "switch" | "loop" | "wait_delay" | "wait_reply" | "ai_agent" | "send_email" | "create_email_draft" | "create_task" | "update_deal" | "notify" | "end";

export interface WorkflowScope {
  mode: WorkflowScopeMode;
  objectKey?: string;
  recordId?: string;
  recordTitle?: string;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  sourceNodeId: string;
  sourceHandle: string;
  targetNodeId: string;
}

export interface WorkflowGraph {
  scope: WorkflowScope;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowTrigger {
  type: WorkflowTriggerType;
  event?: string;
  objectKey?: string;
  config?: Record<string, unknown>;
  schedule?: {
    mode: "daily" | "weekly" | "interval";
    dailyAt?: string;
    weekday?: number;
    intervalMinutes?: number;
  };
}

export interface WorkflowCondition {
  key: string;
  type: WorkflowConditionType;
  field?: string;
  operator?: "equals" | "not_equals" | "contains" | "not_contains" | "gt" | "gte" | "lt" | "lte" | "exists" | "not_exists";
  value?: unknown;
  prompt?: string;
  config?: Record<string, unknown>;
}

export interface WorkflowAction {
  key: string;
  type: WorkflowActionType;
  name: string;
  requiresApproval?: boolean;
  config: Record<string, unknown>;
}

export interface WorkflowDefinition {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  goal: string;
  status: WorkflowStatus;
  trigger: WorkflowTrigger;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  graph?: WorkflowGraph;
  createdById: string;
  version: number;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRun {
  id: string;
  workspaceId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  triggerEvent: string;
  triggerData: Record<string, unknown>;
  idempotencyKey?: string;
  conditionResults: Array<{ key: string; passed: boolean; actualValue?: unknown }>;
  actionResults: Array<{ actionKey: string; status: "completed" | "skipped" | "approval_required" | "failed"; message?: string; approvalId?: string }>;
  nodeResults?: Array<{ nodeId: string; status: "completed" | "waiting" | "skipped" | "approval_required" | "failed"; outputHandle?: string; message?: string; startedAt: string; completedAt?: string; resumeAt?: string }>;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

export interface WorkflowActionApproval {
  id: string;
  workspaceId: string;
  workflowId: string;
  runId?: string;
  actionKey: string;
  actionType: WorkflowActionType;
  status: WorkflowApprovalStatus;
  summary: string;
  payload: Record<string, unknown>;
  requestedById: string;
  reviewedById?: string;
  reviewNote?: string;
  createdAt: string;
  reviewedAt?: string;
}

export interface WorkflowResume {
  id: string;
  workspaceId: string;
  workflowId: string;
  runId: string;
  nodeId: string;
  resumeAt: string;
  triggerData: Record<string, unknown>;
  status: WorkflowResumeStatus;
  idempotencyKey: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowAiGenerationRequest {
  goal: string;
  objectKey?: string;
  recordId?: string;
  recordTitle?: string;
  audience?: string;
  constraints?: string;
}

export interface WorkflowAiGenerationResult {
  workflow: Omit<WorkflowDefinition, "id" | "workspaceId" | "createdById" | "createdAt" | "updatedAt">;
  explanation: {
    goal: string;
    triggerReason: string;
    expectedOutcome: string;
    risks: string[];
  };
}

export interface RecordPoolActionResult {
  record: CrmRecord;
  previousOwnerId?: string;
  ownerId?: string;
}

export interface RecordPoolAutoReclaimResult {
  scanned: number;
  reclaimed: number;
  reclaimedRecordIds: string[];
  ranAt: string;
}

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
  notificationChannels: NotificationChannel[];
  emailAccounts: EmailAccount[];
  emailSignatures?: EmailSignature[];
  emailThreads: EmailThread[];
  emailThreadStates: EmailThreadState[];
  emailMessages: EmailMessage[];
  emailDeletedMessages?: EmailDeletedMessage[];
  knowledgeArticles: KnowledgeArticle[];
  knowledgeVectorSettings?: KnowledgeVectorSettings[];
  knowledgeEmbeddingChunks?: KnowledgeEmbeddingChunk[];
  talkMessages?: TalkMessage[];
  emailAiSettings: EmailAiSettings[];
  emailSyncSettings?: EmailSyncSettings[];
  poolSettings?: CrmPoolSettings[];
  customerLevelSettings?: CustomerLevelSettings[];
  recordChangeRequests?: RecordChangeRequest[];
  mediaAssets?: MediaAsset[];
  workflowDefinitions?: WorkflowDefinition[];
  workflowRuns?: WorkflowRun[];
  workflowResumes?: WorkflowResume[];
  workflowActionApprovals?: WorkflowActionApproval[];
  smartReminderSettings?: SmartReminderSettings[];
  smartReminders?: SmartReminder[];
  smartReminderRuns?: SmartReminderRun[];
}

export interface RequestContext {
  workspaceId: string;
  user: User;
  role: Role;
}
