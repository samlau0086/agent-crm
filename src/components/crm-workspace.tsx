"use client";

import {
  Activity as ActivityIcon,
  Archive,
  BadgeDollarSign,
  Bell,
  Bold,
  Bot,
  Building2,
  CalendarClock,
  ChevronDown,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  Filter,
  Inbox,
  Image as ImageIcon,
  Italic,
  LayoutDashboard,
  LayoutList,
  Link,
  List,
  Mail,
  MailOpen,
  Maximize2,
  MessageCircle,
  Menu,
  Minus,
  Moon,
  MoreHorizontal,
  MoreVertical,
  Package,
  Palette,
  Paperclip,
  Pencil,
  FileText,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  Star,
  Sun,
  Tag,
  Trash2,
  Trophy,
  Underline,
  Upload,
  UserPlus,
  UserRound,
  Workflow as WorkflowIcon,
  XCircle,
  type LucideIcon
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type UIEvent,
  type ReactNode
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AutomationWorkspace } from "@/components/automation-workspace";
import { getCountryLabel, getCountrySelectOptions } from "@/lib/crm/countries";
import { SettingsAdmin } from "@/components/settings-admin";
import { convertCurrencyAmount, formatMoneyWithCurrency, getBaseCurrencyCode, getCurrencyDefinitions, normalizeCurrencyCode } from "@/lib/crm/currencies";
import { buildImportJobObservability } from "@/lib/crm/import-observability";
import { crmPathForNav, resolveCrmRoute } from "@/lib/crm/navigation";
import { calculateQuoteTotals, normalizeQuoteFees, normalizeQuoteLineItems, quoteLineItemFromProductForCurrency, type QuoteFee, type QuoteLineItem } from "@/lib/crm/quotes";
import { hasRecordPatchChanges, previousRecordApprovalPatch, splitRecordApprovalPatch, type RecordApprovalPatch } from "@/lib/crm/record-approval";
import type {
  Activity,
  ApiKey,
  AuditLog,
  CrmPoolSettings,
  CrmRecord,
  CsvImportMapping,
  CsvImportPreview,
  CsvImportJob,
  CsvImportStrategy,
  DashboardSummary,
  EmailAccount,
  EmailAttachment,
  EmailAiSettings,
  EmailSyncSettings,
  EmailConnectionConfig,
  EmailInboundConnectionConfig,
  EmailMessage,
  EmailOutboundServiceConfig,
  EmailSignature,
  EmailThread,
  FieldDefinition,
  ImportJobQueueSummary,
  ImportPreset,
  KnowledgeArticle,
  MediaAsset,
  NotificationChannel,
  NotificationEvent,
  ObjectDefinition,
  Pipeline,
  PipelineStage,
  RecordChangeRequest,
  RecordPool,
  RecordPoolActionResult,
  RecordListResult,
  RelationDefinition,
  Role,
  SavedView,
  SmartReminder,
  SmartReminderRun,
  SmartReminderSettings,
  Team,
  User,
  WebhookEndpoint,
  WorkflowActionApproval,
  WorkflowDefinition,
  WorkflowRun
} from "@/lib/crm/types";
import { findRelatedRecords } from "@/lib/crm/views";
import { buildEmailAttachmentHref, MAX_EMAIL_ATTACHMENT_BYTES } from "@/lib/email/attachments";
import { canOpenEmailAiSource, emailAiSourceKey, type EmailAiSourceRef } from "@/lib/email/ai-sources";
import { isEmailAiPurposeEnabled } from "@/lib/email/assistant";
import { repairEmailMojibake } from "@/lib/email/mojibake";
import { readEmailOAuthCallbackNotice } from "@/lib/email/oauth-callback";
import { getEmailProviderCapability, getEmailProviderSetupVisibility, isOAuthEmailProvider, listEmailProviderCapabilities } from "@/lib/email/providers";
import { buildEmailReplyDraft, type EmailComposeReplyDraft } from "@/lib/email/reply-draft";
import { formatEmailSendResultMessage } from "@/lib/email/status-messages";
import type { EmailDiagnosticStatus, EmailSubsystemDiagnostics } from "@/lib/email/diagnostics";
import { formatCurrency, formatDate, formatDateTimeSeconds, labelForOption } from "@/lib/utils/format";
import type { BackupFile } from "@/lib/ops/backups";

interface CrmWorkspaceProps {
  contextUser: User;
  role: Role;
  objects: ObjectDefinition[];
  fields: FieldDefinition[];
  records: CrmRecord[];
  initialNavKey: NavKey;
  initialObjectKey: string;
  initialRecordList: RecordListResult;
  dashboardSummary: DashboardSummary;
  pipelines: Pipeline[];
  relations: RelationDefinition[];
  activities: Activity[];
  savedViews: SavedView[];
  users: User[];
  teams: Team[];
  roles: Role[];
  apiKeys: ApiKey[];
  webhooks: WebhookEndpoint[];
  notificationChannels: NotificationChannel[];
  emailAccounts: EmailAccount[];
  emailSignatures: EmailSignature[];
  emailThreads: EmailThread[];
  emailAiSettings: EmailAiSettings;
  emailSyncSettings?: EmailSyncSettings;
  poolSettings: CrmPoolSettings;
  smartReminderSettings: SmartReminderSettings;
  recordChangeRequests: RecordChangeRequest[];
  knowledgeArticles: KnowledgeArticle[];
  mediaAssets: MediaAsset[];
  auditLogs: AuditLog[];
  backupFiles: BackupFile[];
  importJobs: CsvImportJob[];
  importPresets: ImportPreset[];
  importJobQueueSummary?: ImportJobQueueSummary;
  workflows: WorkflowDefinition[];
  workflowRuns: WorkflowRun[];
  workflowApprovals: WorkflowActionApproval[];
}

const recordListRequestTimeoutMs = 15_000;
const routeRefreshTimeoutMs = 10_000;
const editApprovalObjectKeys = new Set(["contacts", "companies", "deals"]);
const deleteApprovalObjectKeys = new Set(["contacts", "companies", "deals", "products", "quotes"]);

type NavKey = "dashboard" | "contacts" | "companies" | "deals" | "products" | "quotes" | "objects" | "records" | "tasks" | "activities" | "automation" | "email" | "settings";
type RecordPanelMode = "closed" | "create" | "detail" | "import";
type DealWorkspaceView = "pipeline" | "list";
type EmailWorkspaceView = "mail" | "settings" | "ai";
type EmailSettingsStep = "identity" | "inbound" | "outbound" | "review";
type EmailMailboxKey = "inbox" | "starred" | "snoozed" | "important" | "sent" | "scheduled" | "drafts" | "archived" | "trash" | "all";
type EmailCategoryKey = "primary" | "promotions" | "social" | "updates";
type EmailMailMode = "list" | "detail";
type EmailRoutePatch = {
  accountId?: string;
  category?: EmailCategoryKey;
  label?: string;
  mailbox?: EmailMailboxKey;
  mailMode?: EmailMailMode;
  search?: string;
  threadId?: string;
};
type RecordChangeRequestResponse = { pendingApproval: true; request: RecordChangeRequest; record?: CrmRecord };
type RecordApprovalReasonRequiredResponse = { approvalReasonRequired: true };
type EmailThreadUiState = {
  archived?: boolean;
  category?: EmailCategoryKey;
  deleted?: boolean;
  important?: boolean;
  labels?: string[];
  read?: boolean;
  snoozedUntil?: string | null;
  starred?: boolean;
};
type EmailTrashDisplayMessageIds = Record<string, string>;
type AiSource = { label: string; objectKey?: string; recordId?: string; activityId?: string };
type AiResponse = { text: string; sources: AiSource[] };
type TalkTarget =
  | { type: "record"; objectKey: string; recordId: string; label: string }
  | { type: "email_thread"; threadId: string; label: string };
type TalkApiTarget =
  | { type: "record"; objectKey: string; recordId: string }
  | { type: "email_thread"; threadId: string };
type TalkMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: TalkResponse["sources"];
  knowledgeArticleId?: string;
  createdAt?: string;
};
type TalkResponse = {
  text: string;
  generationMode?: "local" | "provider" | "provider_fallback";
  sources: Array<{ label: string; objectKey?: string; recordId?: string; messageId?: string; knowledgeArticleId?: string }>;
};
type TalkSuggestionResponse = {
  completion: string;
  generationMode?: "local" | "provider" | "provider_fallback";
};
type EmailAiSource = EmailAiSourceRef;
const defaultEmailSyncSettings: EmailSyncSettings = {
  workspaceId: "",
  enabled: true,
  mode: "interval",
  intervalMinutes: 5,
  dailyAt: "03:00",
  limit: 25,
  updatedAt: ""
};
type EmailAiGenerateResult = {
  enabled: boolean;
  purpose: "draft" | "translate" | "context_analysis" | "summarize";
  recordId?: string;
  threadId?: string;
  sourceMessageId?: string;
  generationMode?: "disabled" | "local" | "provider" | "provider_fallback" | "queued";
  providerError?: string;
  text: string;
  suggestedSubject?: string;
  sources: EmailAiSource[];
  budget?: { maxContextChars: number; contextCharCount: number; modelPromptChars: number; truncated: boolean; outputTruncated?: boolean };
};
type EmailConnectionTestRun = {
  testedAt: string;
  total: number;
  tested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: Array<{
    account: EmailAccount;
    ok: boolean;
    skipped: boolean;
    result?: { smtp?: "ok" | "skipped"; imap?: "ok" | "skipped"; pop3?: "ok" | "skipped"; resend?: "ok" | "skipped"; oauth?: "ok" | "skipped"; oauthAccountEmail?: string };
    reason?: string;
    error?: string;
  }>;
};
type EmailConnectionTestScope = "all" | "inbound" | "outbound";
type EmailSyncAllRun = {
  scheduledCount: number;
  skippedCount: number;
  limit?: number;
  accounts: Array<{
    accountId: string;
    emailAddress: string;
    status: string;
    importedCount: number;
    error?: string;
  }>;
};
type EmailAccountDraft = {
  editingAccountId?: string;
  name: string;
  emailAddress: string;
  provider: EmailAccount["provider"];
  syncEnabled: boolean;
  sendEnabled: boolean;
  defaultOutboundServiceId: string;
  outboundServices: EmailAccountDraftOutboundService[];
  syncProtocol: "imap" | "pop3";
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  pop3Host: string;
  pop3Port: string;
  pop3Secure: boolean;
  username: string;
  password: string;
  mailbox: string;
  oauthAccessToken: string;
  oauthRefreshToken: string;
  oauthExpiresAt: string;
  oauthScope: string;
};
type EmailAccountDraftOutboundService = {
  id: string;
  name: string;
  type: "smtp" | "resend";
  enabled: boolean;
  fromEmail: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpStartTls: boolean;
  username: string;
  password: string;
  resendApiKey: string;
};
type SanitizedEmailConnectionConfig = {
  inbound?: Omit<EmailInboundConnectionConfig, "password" | "accessToken" | "refreshToken"> & {
    hasPassword?: boolean;
    hasAccessToken?: boolean;
    hasRefreshToken?: boolean;
  };
  outboundServices?: Array<Omit<EmailOutboundServiceConfig, "password" | "resendApiKey"> & {
    hasPassword?: boolean;
    hasResendApiKey?: boolean;
  }>;
  defaultOutboundServiceId?: string;
};
type EmailAccountUpdatePatch = Partial<Pick<EmailAccount, "name" | "emailAddress" | "provider" | "status" | "syncEnabled" | "sendEnabled">> & {
  connectionConfig?: EmailConnectionConfig;
  clearConnectionConfig?: boolean;
};
type EmailComposeDraft = EmailComposeReplyDraft & {
  clientRequestId: string;
  scheduledSendAt?: string;
  trackingEnabled?: boolean;
  groupSendMode?: boolean;
};
type EmailSignatureOption = {
  id: string;
  label: string;
  bodyText: string;
  bodyHtml: string;
};
type EmailSignatureDraft = {
  editingSignatureId?: string;
  accountId: string;
  name: string;
  bodyText: string;
  bodyHtml: string;
  isDefault: boolean;
  active: boolean;
};
type EmailAttachmentUploadItem = {
  id: string;
  fileName: string;
  size: number;
  progress: number;
  status: "queued" | "reading" | "complete" | "error";
  error?: string;
};
type ToastState = {
  intent: "success" | "error" | "info";
  message: string;
};
type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
};
type PromptDialogState = {
  title: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
};
type TaskCalendarView = "list" | "month" | "week" | "day";
type TaskCreateInput = {
  title: string;
  dueAt?: string;
};
type TaskAttachment = {
  id: string;
  mediaAssetId: string;
  name: string;
  contentType: string;
  size: number;
};
type ActivityAttachment = TaskAttachment;
type ActivityDetailsPayload = {
  format: "activity.v1" | "task.v1";
  text: string;
  attachments: ActivityAttachment[];
};
type TaskDetailsPayload = ActivityDetailsPayload;
type RecordActivityComposerInput = {
  type: Activity["type"];
  title: string;
  body?: string;
  dueAt?: string;
  attachments?: ActivityAttachment[];
};
type TaskEditDraft = {
  title: string;
  dueAt: string;
  text: string;
  attachments: ActivityAttachment[];
};
type KnowledgeArticleDraft = {
  editingArticleId?: string;
  title: string;
  body: string;
  tags: string;
  active: boolean;
};
type ViewDraft = {
  name: string;
  columns: string[];
  filterField: string;
  filterOperator: "contains" | "equals";
  filterValue: string;
  sortField: string;
  sortDirection: "asc" | "desc";
  isDefault: boolean;
};
type TableColumn =
  | { key: "ownerId"; label: string; type: "owner" }
  | { key: string; label: string; type: "field"; field: FieldDefinition };

const navItems: Array<{ key: Exclude<NavKey, "records">; label: string; icon: LucideIcon }> = [
  { key: "dashboard", label: "仪表盘", icon: LayoutDashboard },
  { key: "contacts", label: "联系人", icon: UserRound },
  { key: "companies", label: "公司", icon: Building2 },
  { key: "deals", label: "交易", icon: BadgeDollarSign },
  { key: "products", label: "产品", icon: Package },
  { key: "quotes", label: "报价", icon: FileText },
  { key: "objects", label: "对象", icon: LayoutList },
  { key: "tasks", label: "任务", icon: CheckCircle2 },
  { key: "activities", label: "活动", icon: ActivityIcon },
  { key: "automation", label: "自动化", icon: WorkflowIcon },
  { key: "settings", label: "设置", icon: Settings }
];

const coreObjects = new Set(["contacts", "companies", "deals", "products", "quotes"]);
const emailAiFeatureMeta: Record<keyof EmailAiSettings["features"], { label: string; description: string; dependsOn?: keyof EmailAiSettings["features"] }> = {
  draft: { label: "AI 写邮件", description: "基于客户背景、沟通历史和知识库生成邮件草稿" },
  translate: { label: "AI 翻译", description: "手动翻译邮件内容" },
  auto_translate: { label: "自动翻译", description: "新入站邮件自动生成翻译", dependsOn: "translate" },
  context_analysis: { label: "上下文分析", description: "分析邮件线程并给出下一步建议" },
  auto_context_analysis: { label: "自动上下文分析", description: "新邮件自动刷新线程分析", dependsOn: "context_analysis" },
  auto_summarize: { label: "自动总结", description: "把长线程压缩成 compact memory 以减少后续 token 消耗" }
};
const emailMailboxMeta: Array<{ key: EmailMailboxKey; label: string; icon: LucideIcon }> = [
  { key: "inbox", label: "收件箱", icon: Inbox },
  { key: "starred", label: "星标", icon: Star },
  { key: "snoozed", label: "稍后提醒", icon: Clock3 },
  { key: "important", label: "重要", icon: Tag },
  { key: "sent", label: "已发送", icon: Send },
  { key: "scheduled", label: "待发送", icon: CalendarClock },
  { key: "drafts", label: "草稿", icon: Mail },
  { key: "archived", label: "归档", icon: Archive },
  { key: "trash", label: "已删除", icon: Trash2 },
  { key: "all", label: "全部邮件", icon: MailOpen }
];
const emailCategoryMeta: Array<{ key: EmailCategoryKey; label: string; icon: LucideIcon; keywords: string[] }> = [
  { key: "primary", label: "主要", icon: Inbox, keywords: [] },
  { key: "promotions", label: "推广", icon: Tag, keywords: ["unsubscribe", "sale", "shop", "promo", "discount", "deal", "tiktok", "aliexpress", "steam", "促销", "折扣", "优惠"] },
  { key: "social", label: "社交", icon: UserRound, keywords: ["social", "forum", "following", "community", "linkedin", "twitter", "通知", "关注", "社区"] },
  { key: "updates", label: "更新", icon: CalendarClock, keywords: ["update", "notification", "report", "receipt", "invoice", "ticket", "github", "alert", "提醒", "账单", "报告"] }
];
const allEmailAccountsKey = "all";

function normalizeEmailMailboxKey(value: string | null): EmailMailboxKey {
  return emailMailboxMeta.some((item) => item.key === value) ? (value as EmailMailboxKey) : "inbox";
}

function normalizeEmailCategoryKey(value: string | null): EmailCategoryKey {
  return emailCategoryMeta.some((item) => item.key === value) ? (value as EmailCategoryKey) : "primary";
}

function normalizeEmailMailMode(value: string | null): EmailMailMode {
  return value === "detail" ? "detail" : "list";
}

function routeEmailThreadIdToMode(threadId: string, mode: EmailMailMode): EmailMailMode {
  return threadId ? "detail" : mode;
}

function buildEmailRoutePath(patch: EmailRoutePatch): string {
  const params = new URLSearchParams();
  params.set("mailbox", patch.mailbox ?? "inbox");
  if (patch.category && (patch.mailbox === "inbox" || patch.mailbox === "all")) {
    params.set("category", patch.category);
  }
  if (patch.accountId && patch.accountId !== allEmailAccountsKey) {
    params.set("accountId", patch.accountId);
  }
  if (patch.label) {
    params.set("label", patch.label);
  }
  if (patch.search) {
    params.set("mailSearch", patch.search);
  }
  if (patch.mailMode === "detail" && patch.threadId) {
    params.set("mailMode", "detail");
    params.set("emailThreadId", patch.threadId);
  }
  const query = params.toString();
  return query ? `${crmPathForNav("email")}?${query}` : crmPathForNav("email");
}
const noEmailSignatureId = "none";
const inlineImageContentIdPrefix = "inline-image-";

function isEmailAiFeatureBlockedByDependency(feature: keyof EmailAiSettings["features"], features: EmailAiSettings["features"]): boolean {
  const dependency = emailAiFeatureMeta[feature].dependsOn;
  return Boolean(dependency && !features[dependency]);
}

function emailAiFeatureDependencyMessage(feature: keyof EmailAiSettings["features"]): string | undefined {
  const dependency = emailAiFeatureMeta[feature].dependsOn;
  return dependency ? `需要先开启 ${emailAiFeatureMeta[dependency].label}` : undefined;
}
function createEmailClientRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `email-send:${crypto.randomUUID()}`;
  }
  return `email-send:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 12)}`;
}

function clearEmailDraftAiProvenance(draft: EmailComposeDraft): EmailComposeDraft {
  if (!draft.aiAssisted && !draft.aiPurpose && !draft.aiSourceMessageId && !draft.aiSources?.length && !draft.aiGeneratedAt) {
    return draft;
  }
  return {
    ...draft,
    aiAssisted: false,
    aiPurpose: undefined,
    aiSourceMessageId: undefined,
    aiSources: undefined,
    aiGeneratedAt: undefined
  };
}

function upsertEmailMessage(messages: EmailMessage[], message: EmailMessage): EmailMessage[] {
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index === -1) {
    return [...messages, message];
  }
  return messages.map((candidate) => (candidate.id === message.id ? message : candidate));
}

function buildEmailHtmlPreview(bodyHtml: string, allowExternalImages = false): string {
  const repairedHtml = repairEmailMojibake(bodyHtml);
  const imgSrcPolicy = allowExternalImages ? "data: cid: https: http:" : "data: cid:";
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    '<base target="_blank">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrcPolicy}; style-src 'unsafe-inline'; font-src data:;">`,
    "<style>html,body{margin:0;padding:12px;background:#fff;color:#111827;font:14px/1.5 Arial,sans-serif;overflow-wrap:anywhere;}table{max-width:100%;}img{max-width:100%;height:auto;}</style>",
    "</head><body>",
    repairedHtml,
    "</body></html>"
  ].join("");
}

function hasEmailHtmlPreview(message: EmailMessage): boolean {
  return Boolean(message.bodyHtml?.trim());
}

function emailHtmlHasExternalImages(bodyHtml: string): boolean {
  return /\s(?:src|srcset)\s*=\s*["']\s*https?:\/\//i.test(bodyHtml);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emailTextToHtml(value: string): string {
  const paragraphs = value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`);
  return paragraphs.length ? paragraphs.join("") : "";
}

function stripHtmlToText(value: string): string {
  if (!value.trim()) {
    return "";
  }
  if (typeof document !== "undefined") {
    const template = document.createElement("template");
    template.innerHTML = sanitizeComposeHtml(value);
    return (template.content.textContent ?? "").replace(/\u00a0/g, " ").trim();
  }
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

function sanitizeComposeHtml(value: string): string {
  if (!value.trim() || typeof document === "undefined") {
    return value
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/\son[a-z]+\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\s(href|src)\s*=\s*["']javascript:[^"']*["']/gi, "");
  }
  const template = document.createElement("template");
  template.innerHTML = value;
  template.content.querySelectorAll("script,style,iframe,object,embed").forEach((node) => node.remove());
  template.content.querySelectorAll<HTMLElement>("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const attributeValue = attribute.value.trim().toLowerCase();
      if (name.startsWith("on") || ((name === "href" || name === "src") && attributeValue.startsWith("javascript:"))) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  return template.innerHTML.trim();
}

function getEmailSignatureOptions(signatures: EmailSignature[], accounts: EmailAccount[], selectedAccountId: string): EmailSignatureOption[] {
  const account = accounts.find((candidate) => candidate.id === selectedAccountId) ?? accounts[0];
  const sender = account?.emailAddress || "Sales team";
  const availableSignatures = signatures
    .filter((signature) => signature.active && (!signature.accountId || signature.accountId === selectedAccountId))
    .sort((left, right) =>
      Number(Boolean(right.accountId === selectedAccountId && right.isDefault)) - Number(Boolean(left.accountId === selectedAccountId && left.isDefault)) ||
      Number(right.isDefault) - Number(left.isDefault) ||
      left.name.localeCompare(right.name)
    );
  return [
    { id: noEmailSignatureId, label: "不使用签名", bodyText: "", bodyHtml: "" },
    ...availableSignatures.map((signature) => ({
      id: signature.id,
      label: `${signature.name}${signature.isDefault ? "（默认）" : ""}${signature.accountId ? "（账户）" : ""}`,
      bodyText: renderEmailSignatureTemplate(signature.bodyText, sender),
      bodyHtml: renderEmailSignatureTemplate(signature.bodyHtml || emailTextToHtml(signature.bodyText), sender)
    }))
  ];
}

function renderEmailSignatureTemplate(value: string, senderEmail: string): string {
  return value.replace(/\{\{\s*senderEmail\s*\}\}/g, senderEmail).replace(/\{\{\s*sender_email\s*\}\}/g, senderEmail);
}

function getSelectedEmailSignature(draft: EmailComposeDraft, signatures: EmailSignature[], accounts: EmailAccount[]): EmailSignatureOption {
  const options = getEmailSignatureOptions(signatures, accounts, draft.accountId);
  if (draft.signatureId === noEmailSignatureId) {
    return options[0];
  }
  return options.find((signature) => signature.id === draft.signatureId) ?? options[1] ?? options[0];
}

function getDraftBodyHtml(draft: EmailComposeDraft): string {
  return sanitizeComposeHtml(draft.bodyHtml?.trim() ? draft.bodyHtml : emailTextToHtml(draft.bodyText));
}

function getDraftBodyText(draft: EmailComposeDraft): string {
  return draft.bodyText.trim() || stripHtmlToText(draft.bodyHtml ?? "");
}

function hasEmailDraftBody(draft: EmailComposeDraft): boolean {
  return Boolean(getDraftBodyText(draft) || getDraftBodyHtml(draft).replace(/<[^>]+>/g, "").trim() || /<img\b/i.test(getDraftBodyHtml(draft)));
}

function toDatetimeLocalInputValue(value?: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

function fromDatetimeLocalInputValue(value: string): string {
  return value ? new Date(value).toISOString() : "";
}

function buildReplyOriginalHtml(draft: EmailComposeDraft): string {
  const originalHtml = draft.replyOriginalBodyHtml?.trim() ? sanitizeComposeHtml(draft.replyOriginalBodyHtml) : emailTextToHtml(draft.replyOriginalBodyText ?? "");
  if (!originalHtml) {
    return "";
  }
  const sentAt = draft.replyOriginalSentAt ? formatDate(draft.replyOriginalSentAt) : "";
  const from = draft.replyOriginalFrom || "原发件人";
  return `<p class="crm-email-reply-meta">On ${escapeHtml(sentAt)}, ${escapeHtml(from)} wrote:</p><blockquote class="crm-email-quote">${originalHtml}</blockquote>`;
}

function buildReplyOriginalText(draft: EmailComposeDraft): string {
  const originalText = (draft.replyOriginalBodyText?.trim() || stripHtmlToText(draft.replyOriginalBodyHtml ?? "")).trim();
  if (!originalText) {
    return "";
  }
  const sentAt = draft.replyOriginalSentAt ? formatDate(draft.replyOriginalSentAt) : "";
  const from = draft.replyOriginalFrom || "原发件人";
  return [`On ${sentAt}, ${from} wrote:`, ...originalText.split("\n").map((line) => `> ${line}`)].join("\n");
}

function prepareEmailDraftForSend(draft: EmailComposeDraft, signatures: EmailSignature[], accounts: EmailAccount[]): EmailComposeDraft {
  const signature = getSelectedEmailSignature(draft, signatures, accounts);
  const bodyHtml = getDraftBodyHtml(draft);
  const bodyText = getDraftBodyText(draft);
  const inlineImageResult = extractInlineImageAttachments(bodyHtml);
  const signatureHtml = signature.bodyHtml.trim();
  const signatureText = signature.bodyText.trim();
  const originalHtml = buildReplyOriginalHtml(draft);
  const originalText = buildReplyOriginalText(draft);
  const htmlParts = [inlineImageResult.bodyHtml, signatureHtml, originalHtml].filter(Boolean);
  const textParts = [bodyText, signatureText, originalText].filter(Boolean);
  const attachments = [...(draft.attachments ?? []), ...inlineImageResult.attachments];
  return {
    ...draft,
    bodyHtml: htmlParts.length ? htmlParts.join("<br>") : undefined,
    bodyText: textParts.length ? textParts.join("\n\n") : inlineImageResult.attachments.length ? "(HTML email)" : bodyText,
    attachments
  };
}

function extractInlineImageAttachments(bodyHtml: string): { bodyHtml: string; attachments: EmailAttachment[] } {
  if (!bodyHtml.trim() || typeof document === "undefined") {
    return { bodyHtml, attachments: [] };
  }
  const template = document.createElement("template");
  template.innerHTML = bodyHtml;
  const attachments: EmailAttachment[] = [];
  template.content.querySelectorAll<HTMLImageElement>("img[data-content-base64]").forEach((image, index) => {
    const contentBase64 = image.dataset.contentBase64;
    if (!contentBase64) {
      return;
    }
    const contentId = image.dataset.contentId || `${inlineImageContentIdPrefix}${Date.now()}-${index}`;
    const fileName = image.dataset.fileName || `inline-image-${index + 1}.png`;
    const contentType = image.dataset.contentType || "image/png";
    const size = Number(image.dataset.size || "0");
    attachments.push({ fileName, contentType, size, contentBase64, contentId, disposition: "inline" });
    image.setAttribute("src", `cid:${contentId}`);
    image.removeAttribute("data-content-base64");
    image.removeAttribute("data-content-id");
    image.removeAttribute("data-file-name");
    image.removeAttribute("data-content-type");
    image.removeAttribute("data-size");
  });
  return { bodyHtml: template.innerHTML.trim(), attachments };
}

function buildDraftAiSourceText(draft: EmailComposeDraft, thread?: EmailThread, messages: EmailMessage[] = []): string {
  const latestMessages = messages.slice(-5);
  return [
    getDraftBodyText(draft) ? `Current draft:\n${getDraftBodyText(draft)}` : "",
    thread?.summary ? `Thread summary:\n${repairEmailMojibake(thread.summary)}` : "",
    thread?.aiAnalysis ? `Context analysis:\n${formatEmailAnalysisForDisplay(thread.aiAnalysis)}` : "",
    latestMessages.length
      ? `Recent email history:\n${latestMessages
          .map((message) => `${message.direction} ${message.status} ${message.subject} from ${message.from} to ${message.to.join(", ")}:\n${repairEmailMojibake(message.bodyText).slice(0, 1600)}`)
          .join("\n\n")}`
      : "",
    draft.replyOriginalBodyText || draft.replyOriginalBodyHtml
      ? `Original email to quote on reply:\n${repairEmailMojibake(draft.replyOriginalBodyText || stripHtmlToText(draft.replyOriginalBodyHtml ?? "")).slice(0, 1600)}`
      : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildComposePromptFromAiResult(result: EmailAiGenerateResult, currentPrompt: string, draft: EmailComposeDraft, thread?: EmailThread): string {
  const text = result.text.trim();
  const looksLikeEmailBody = /^hello,?/i.test(text) || /best regards/i.test(text) || text.split(/\r?\n/).length > 6;
  if (text && !looksLikeEmailBody) {
    return text;
  }
  return [
    "请根据当前 CRM 客户背景、邮件线程摘要、AI 上下文分析和系统知识库撰写一封销售邮件。",
    draft.to.trim() ? `收件人：${draft.to.trim()}` : "",
    draft.subject.trim() ? `当前主题：${draft.subject.trim()}` : thread?.subject ? `邮件线程：${thread.subject}` : "",
    currentPrompt.trim() ? `我的补充要求：${currentPrompt.trim()}` : "",
    "语气：专业、简洁、礼貌，避免夸大承诺。",
    "内容要求：回应最近一封邮件的关键点，结合客户背景给出明确下一步，并保留人工确认空间。",
    "不要在正文里加入签名、姓名/职位/公司/联系方式占位符、来源提示、引用列表或来源脚注；签名会在发送时由系统单独追加，来源只保存在 CRM 元数据里。",
    draft.replyOriginalBodyText || draft.replyOriginalBodyHtml ? "这是回复邮件，生成内容时不要重复引用原邮件全文。" : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function formatEmailAnalysisForDisplay(analysis: string): string {
  const repaired = repairEmailMojibake(analysis).replace(/&#0*64;/gi, "@").trim();
  if (!looksLikeLeakedEmailAnalysisPrompt(repaired)) {
    return repaired;
  }

  const recommendation = repaired.match(/Recommendation:\s*([\s\S]*)/i)?.[1]?.trim();
  const noLinkedRecord = /No linked CRM record/i.test(repaired);
  const isNotification = /instagram|facebook|notification|unsubscribe|通知|推广|社交/i.test(repaired);
  const conclusion = isNotification
    ? "该线程更像自动通知、推广或社交类邮件，当前没有清晰采购意图。"
    : noLinkedRecord
      ? "该线程当前未关联 CRM 记录，需要先确认发件人身份和客户关系。"
      : "该线程已有客户上下文，可以围绕最近沟通确认下一步。";
  const nextStep = recommendation && !looksLikeLeakedEmailAnalysisPrompt(recommendation)
    ? recommendation
    : noLinkedRecord
      ? "先关联到现有联系人或新建联系人，再重新运行分析；在确认客户意图前不要修改交易阶段、金额或联系人关键字段。"
      : "确认客户当前目标，处理最近未解决事项，并创建人工跟进任务。";

  return [
    "AI 线程分析",
    "",
    `结论：${conclusion}`,
    `客户与关联：${noLinkedRecord ? "未关联 CRM 记录。" : "已有关联上下文。"}`,
    "",
    "建议下一步：",
    nextStep
  ].join("\n");
}

function getEmailAnalysisPreview(analysis: string): string {
  const displayText = formatEmailAnalysisForDisplay(analysis);
  const conclusion = displayText.match(/结论：(.+)/)?.[1]?.trim();
  return conclusion ? truncateInline(conclusion, 120) : truncateInline(displayText.split("\n").find((line) => line.trim()) ?? "查看分析详情", 120);
}

function looksLikeLeakedEmailAnalysisPrompt(value: string): boolean {
  return /^Context analysis:/i.test(value) && /Recent email history:|Knowledge base:|User request:/i.test(value);
}

function truncateInline(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1))}...` : normalized;
}

function inferEmailThreadCategory(thread: EmailThread, messages: EmailMessage[] = []): EmailCategoryKey {
  const haystack = [
    thread.subject,
    thread.summary,
    thread.aiAnalysis,
    thread.participantEmails.join(" "),
    ...messages.flatMap((message) => [message.from, message.subject, message.bodyText])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  for (const category of emailCategoryMeta.filter((item) => item.key !== "primary")) {
    if (category.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
      return category.key;
    }
  }
  return "primary";
}

function buildEmailThreadLabels(thread: EmailThread, messages: EmailMessage[] = []): string[] {
  const labels = new Set<string>();
  if (thread.recordId) {
    labels.add("CRM");
  }
  if (thread.summary || thread.aiAnalysis || messages.some((message) => message.aiAssisted || message.translatedBodyText)) {
    labels.add("AI");
  }
  if (messages.some((message) => message.attachments?.length)) {
    labels.add("附件");
  }
  if (messages.some((message) => message.status === "failed")) {
    labels.add("发送失败");
  }
  if (emailThreadHasScheduledSend(messages)) {
    labels.add("待发送");
  }
  return Array.from(labels);
}

function getEmailThreadDisplayLabels(thread: EmailThread, state: EmailThreadUiState = {}, messages: EmailMessage[] = []): string[] {
  return Array.from(new Set([...(state.labels ?? thread.labels ?? []), ...buildEmailThreadLabels(thread, messages)]));
}

function getEmailThreadUserLabels(thread: EmailThread, state: EmailThreadUiState = {}): string[] {
  return Array.from(new Set((state.labels ?? thread.labels ?? []).map((label) => label.trim()).filter(Boolean)));
}

function canSelectEmailAccountForSending(account: EmailAccount): boolean {
  return account.status !== "disabled" && account.sendEnabled && account.connectionConfigured && getEmailProviderCapability(account.provider).supportsSend;
}

function getEmailCategoryLabel(categoryKey: EmailCategoryKey): string {
  return emailCategoryMeta.find((item) => item.key === categoryKey)?.label ?? categoryKey;
}

function emailThreadTimeValue(thread: EmailThread): string {
  return thread.lastMessageAt ?? thread.updatedAt ?? thread.createdAt;
}

function emailThreadSender(thread: EmailThread, activeAccounts: EmailAccount[]): string {
  const accountAddresses = new Set(activeAccounts.map((account) => account.emailAddress.toLowerCase()));
  return thread.participantEmails.find((email) => !accountAddresses.has(email.toLowerCase())) ?? thread.participantEmails[0] ?? "未知发件人";
}

function emailThreadHasOutbound(messages: EmailMessage[]): boolean {
  return messages.some((message) => isEmailMessageInMailbox(message, "sent"));
}

function emailThreadHasScheduledSend(messages: EmailMessage[]): boolean {
  return messages.some((message) => isEmailMessageInMailbox(message, "scheduled"));
}

function emailThreadNextScheduledSendAt(messages: EmailMessage[]): string | undefined {
  return messages
    .filter((message) => isEmailMessageInMailbox(message, "scheduled") && message.scheduledSendAt)
    .map((message) => message.scheduledSendAt!)
    .sort()[0];
}

function emailMessageTimeValue(message: EmailMessage): string {
  return message.sentAt ?? message.receivedAt ?? message.scheduledSendAt ?? message.sendAttemptedAt ?? message.createdAt;
}

function isEmailMessageInMailbox(message: EmailMessage, mailbox: EmailMailboxKey): boolean {
  if (mailbox === "inbox") {
    return message.direction === "inbound" && message.status === "received";
  }
  if (mailbox === "sent") {
    return (
      message.direction === "outbound" &&
      !message.scheduledSendAt &&
      (message.status === "sent" || message.status === "sending" || message.status === "queued" || message.status === "failed")
    );
  }
  if (mailbox === "scheduled") {
    return message.direction === "outbound" && Boolean(message.scheduledSendAt) && (message.status === "queued" || message.status === "sending");
  }
  if (mailbox === "drafts") {
    return message.status === "draft";
  }
  return false;
}

function getEmailThreadMailboxMessages(messages: EmailMessage[], mailbox: EmailMailboxKey): EmailMessage[] {
  if (mailbox === "all") {
    return messages;
  }
  if (mailbox === "inbox" || mailbox === "sent" || mailbox === "scheduled" || mailbox === "drafts") {
    return messages.filter((message) => isEmailMessageInMailbox(message, mailbox));
  }
  return messages;
}

function getEmailThreadDisplayMessage(messages: EmailMessage[], mailbox: EmailMailboxKey, preferredMessageId?: string): EmailMessage | undefined {
  if (mailbox === "trash") {
    const preferredMessage = preferredMessageId ? messages.find((message) => message.id === preferredMessageId) : undefined;
    if (preferredMessage) {
      return preferredMessage;
    }
    const inboxMessage = getEmailThreadMailboxMessages(messages, "inbox")
      .sort((left, right) => emailMessageTimeValue(right).localeCompare(emailMessageTimeValue(left)))[0];
    if (inboxMessage) {
      return inboxMessage;
    }
  }
  const mailboxMessages = getEmailThreadMailboxMessages(messages, mailbox);
  return [...mailboxMessages].sort((left, right) => emailMessageTimeValue(right).localeCompare(emailMessageTimeValue(left)))[0] ?? messages.at(-1);
}

function emailMessageParticipantLabel(message: EmailMessage | undefined, thread: EmailThread, activeAccounts: EmailAccount[]): string {
  if (!message) {
    return emailThreadSender(thread, activeAccounts);
  }
  if (message.direction === "outbound") {
    const recipients = message.to.filter(Boolean);
    return recipients.length ? `发给 ${recipients.join(", ")}` : "发给 未知收件人";
  }
  return message.from || emailThreadSender(thread, activeAccounts);
}

function emailThreadMatchesSearch(thread: EmailThread, messages: EmailMessage[], query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  return [thread.subject, thread.summary, thread.aiAnalysis, thread.participantEmails.join(" "), ...messages.flatMap((message) => [message.from, message.to.join(" "), message.subject, message.bodyText])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function emailThreadUiStateFromThread(thread: EmailThread): EmailThreadUiState {
  return {
    archived: thread.archived,
    category: thread.category,
    deleted: thread.deleted,
    important: thread.important,
    labels: thread.labels,
    read: thread.read,
    snoozedUntil: thread.snoozedUntil,
    starred: thread.starred
  };
}

function buildEmailThreadUiStateMap(threads: EmailThread[]): Record<string, EmailThreadUiState> {
  return Object.fromEntries(threads.map((thread) => [thread.id, emailThreadUiStateFromThread(thread)]));
}

const navigationItems: typeof navItems = navItems.some((item) => item.key === "email")
  ? navItems
  : [...navItems.slice(0, -1), { key: "email", label: "邮件", icon: Mail }, navItems[navItems.length - 1]];
const sidebarCollapsedStorageKey = "ai-agent-crm:sidebar-collapsed";
const appThemeStorageKey = "ai-agent-crm:theme";
let emailOutboundServiceDraftCounter = 0;

function createEmailOutboundServiceDraft(
  type: EmailAccountDraftOutboundService["type"],
  overrides: Partial<EmailAccountDraftOutboundService> = {}
): EmailAccountDraftOutboundService {
  const id = overrides.id ?? `${type}-${Date.now()}-${emailOutboundServiceDraftCounter++}`;

  return {
    name: type === "smtp" ? "SMTP" : "Resend",
    type,
    enabled: true,
    fromEmail: "",
    smtpHost: "",
    smtpPort: type === "smtp" ? "465" : "",
    smtpSecure: type === "smtp",
    smtpStartTls: false,
    username: "",
    password: "",
    resendApiKey: "",
    ...overrides,
    id
  };
}

function createEmptyEmailAccountDraft(overrides: Partial<EmailAccountDraft> = {}): EmailAccountDraft {
  return {
    name: "",
    emailAddress: "",
    provider: "smtp_imap",
    syncEnabled: true,
    sendEnabled: true,
    defaultOutboundServiceId: "smtp",
    outboundServices: [
      createEmailOutboundServiceDraft("smtp", { id: "smtp" }),
      createEmailOutboundServiceDraft("resend", { id: "resend", enabled: false })
    ],
    syncProtocol: "imap",
    imapHost: "",
    imapPort: "993",
    imapSecure: true,
    pop3Host: "",
    pop3Port: "995",
    pop3Secure: true,
    username: "",
    password: "",
    mailbox: "INBOX",
    oauthAccessToken: "",
    oauthRefreshToken: "",
    oauthExpiresAt: "",
    oauthScope: "",
    ...overrides
  };
}

function createEmailAccountEditDraft(account: EmailAccount, config?: SanitizedEmailConnectionConfig): EmailAccountDraft {
  const inbound = config?.inbound;
  const outboundServices = config?.outboundServices?.length
    ? config.outboundServices.map((service) =>
        createEmailOutboundServiceDraft(service.type, {
          id: service.id,
          name: service.name,
          enabled: service.enabled !== false,
          fromEmail: service.fromEmail ?? "",
          smtpHost: service.smtpHost ?? "",
          smtpPort: service.smtpPort ? String(service.smtpPort) : service.type === "smtp" ? "465" : "",
          smtpSecure: service.smtpSecure ?? service.type === "smtp",
          smtpStartTls: service.smtpStartTls === true,
          username: service.username ?? "",
          password: "",
          resendApiKey: ""
        })
      )
    : undefined;
  return createEmptyEmailAccountDraft({
    editingAccountId: account.id,
    name: account.name,
    emailAddress: account.emailAddress,
    provider: account.provider,
    syncEnabled: account.syncEnabled,
    sendEnabled: account.sendEnabled,
    defaultOutboundServiceId: config?.defaultOutboundServiceId ?? "smtp",
    ...(outboundServices ? { outboundServices } : {}),
    syncProtocol: inbound?.syncProtocol ?? "imap",
    imapHost: inbound?.imapHost ?? "",
    imapPort: inbound?.imapPort ? String(inbound.imapPort) : "993",
    imapSecure: inbound?.imapSecure ?? true,
    pop3Host: inbound?.pop3Host ?? "",
    pop3Port: inbound?.pop3Port ? String(inbound.pop3Port) : "995",
    pop3Secure: inbound?.pop3Secure ?? true,
    username: inbound?.username ?? "",
    password: "",
    mailbox: inbound?.mailbox ?? "INBOX",
    oauthExpiresAt: inbound?.expiresAt ? inbound.expiresAt.slice(0, 16) : "",
    oauthScope: inbound?.scope ?? ""
  });
}

function createEmptyEmailSignatureDraft(overrides: Partial<EmailSignatureDraft> = {}): EmailSignatureDraft {
  return {
    accountId: "",
    name: "默认签名",
    bodyText: "Best regards,\n{{senderEmail}}",
    bodyHtml: "<p>Best regards,<br>{{senderEmail}}</p>",
    isDefault: false,
    active: true,
    ...overrides
  };
}

function createEmailSignatureEditDraft(signature: EmailSignature): EmailSignatureDraft {
  return createEmptyEmailSignatureDraft({
    editingSignatureId: signature.id,
    accountId: signature.accountId ?? "",
    name: signature.name,
    bodyText: signature.bodyText,
    bodyHtml: signature.bodyHtml ?? "",
    isDefault: signature.isDefault,
    active: signature.active
  });
}

const emptyViewDraft: ViewDraft = {
  name: "新视图",
  columns: ["title"],
  filterField: "",
  filterOperator: "contains",
  filterValue: "",
  sortField: "",
  sortDirection: "asc",
  isDefault: false
};

function withClosedStages(stages: Pipeline["stages"]): Pipeline["stages"] {
  if (stages.some((stage) => stage.key === "lost")) {
    return stages;
  }

  return [
    ...stages,
    {
      key: "lost",
      label: "输单",
      probability: 0,
      position: stages.length + 1,
      color: "#dc2626"
    }
  ];
}

function AppSidebarToggleButton({
  collapsed,
  onToggle,
  testId = "app-sidebar-toggle"
}: {
  collapsed: boolean;
  onToggle: () => void;
  testId?: string;
}) {
  return (
    <button
      className="icon-button"
      data-testid={testId}
      aria-label={collapsed ? "显示主侧边栏" : "隐藏主侧边栏"}
      title={collapsed ? "显示主侧边栏" : "隐藏主侧边栏"}
      type="button"
      onClick={onToggle}
    >
      <Menu size={18} />
    </button>
  );
}

function ModuleWorkspaceHeader({
  activeObject,
  appSidebarCollapsed,
  appTheme,
  dealWorkspaceView,
  exportRecordsUrl,
  isRouteRefreshing,
  moduleActionsOpen,
  notificationMenuOpen,
  notifications,
  query,
  quickAddMenuOpen,
  quickAddObjects,
  onChangeDealView,
  onOpenExport,
  onOpenImport,
  onQuickCreate,
  onQueryChange,
  onRefresh,
  onToggleAppSidebar,
  onToggleModuleActions,
  onToggleNotifications,
  onToggleQuickAdd,
  onToggleTheme
}: {
  activeObject: ObjectDefinition;
  appSidebarCollapsed: boolean;
  appTheme: "light" | "dark";
  dealWorkspaceView: DealWorkspaceView;
  exportRecordsUrl: string;
  isRouteRefreshing: boolean;
  moduleActionsOpen: boolean;
  notificationMenuOpen: boolean;
  notifications: HeaderNotification[];
  query: string;
  quickAddMenuOpen: boolean;
  quickAddObjects: ObjectDefinition[];
  onChangeDealView: (view: DealWorkspaceView) => void;
  onOpenExport: () => void;
  onOpenImport: () => void;
  onQuickCreate: (objectKey: string) => void;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onToggleAppSidebar: () => void;
  onToggleModuleActions: () => void;
  onToggleNotifications: () => void;
  onToggleQuickAdd: () => void;
  onToggleTheme: () => void;
}) {
  const moduleIcon = navItems.find((item) => item.key === activeObject.key)?.icon ?? LayoutList;
  const ModuleIcon = moduleIcon;

  return (
    <div className="module-topbar" data-testid={`module-header-${activeObject.key}`}>
      <div className="module-topbar-title">
        <AppSidebarToggleButton collapsed={appSidebarCollapsed} onToggle={onToggleAppSidebar} />
        <div className="module-title-block">
          <ModuleIcon size={18} />
          <h1 className="module-title">{activeObject.pluralLabel}</h1>
        </div>
      </div>

      <label className="module-search" aria-label={`搜索${activeObject.pluralLabel}`}>
        <Search size={17} />
        <input
          data-testid={`record-search-${activeObject.key}`}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={`搜索${activeObject.pluralLabel}`}
        />
        <kbd>Ctrl K</kbd>
      </label>

      <div className="module-topbar-actions">
        <button className="icon-button" type="button" onClick={onToggleTheme} aria-label={appTheme === "dark" ? "切换浅色模式" : "切换深色模式"} title={appTheme === "dark" ? "浅色模式" : "深色模式"}>
          {appTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <HeaderNotificationsMenu notifications={notifications} open={notificationMenuOpen} onToggle={onToggleNotifications} />
        <button className="icon-button" type="button" onClick={onRefresh} aria-label="刷新" title="刷新">
          <RefreshCw className={isRouteRefreshing ? "spin-icon" : undefined} size={16} />
        </button>
        <div className="toolbar-menu">
          <button className="icon-button module-quick-add-button" type="button" onClick={onToggleQuickAdd} aria-label="Quick add" title="Quick add">
            <Plus size={18} />
          </button>
          {quickAddMenuOpen ? (
            <div className="toolbar-menu-panel module-menu-panel module-quick-add-panel">
              <div className="module-menu-heading">
                <span>Quick Create</span>
                <Plus size={14} />
              </div>
              {quickAddObjects.map((object) => {
                const Icon = navItems.find((item) => item.key === object.key)?.icon ?? LayoutList;
                return (
                  <button key={object.key} type="button" onClick={() => onQuickCreate(object.key)}>
                    <Icon size={16} />
                    <span>{object.label}</span>
                    <kbd>{object.label.slice(0, 1).toUpperCase()}</kbd>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <div className="toolbar-menu">
          <button className="icon-button" type="button" onClick={onToggleModuleActions} aria-label="更多操作" title="更多操作">
            <MoreHorizontal size={18} />
          </button>
          {moduleActionsOpen ? (
            <div className="toolbar-menu-panel module-menu-panel">
              <button type="button" onClick={onOpenImport}>
                <Upload size={16} />
                Import {activeObject.pluralLabel}
              </button>
              <button type="button" onClick={onOpenExport}>
                <Download size={16} />
                Export {activeObject.pluralLabel}
              </button>
              <a className="module-menu-link" href={exportRecordsUrl} download={`${activeObject.key}-export.csv`}>
                <Download size={16} />
                Download CSV
              </a>
            </div>
          ) : null}
        </div>
        <a className="module-hidden-export-link" data-testid="topbar-export-records" href={exportRecordsUrl} download={`${activeObject.key}-export.csv`} tabIndex={-1} aria-hidden="true">
          Export
        </a>
        {activeObject.key === "deals" ? (
          <div className="module-view-switch" data-testid="deal-view-switch">
            <button className={dealWorkspaceView === "pipeline" ? "active" : ""} data-testid="deal-view-pipeline" type="button" onClick={() => onChangeDealView("pipeline")} aria-label="Pipeline view" title="Pipeline">
              <BadgeDollarSign size={16} />
            </button>
            <button className={dealWorkspaceView === "list" ? "active" : ""} data-testid="deal-view-list" type="button" onClick={() => onChangeDealView("list")} aria-label="List view" title="列表">
              <LayoutList size={16} />
            </button>
          </div>
        ) : (
          <div className="module-view-switch">
            <button className="active" type="button" aria-label="List view" title="列表">
              <LayoutList size={16} />
            </button>
          </div>
        )}
        <button className="primary-button module-create-button" data-testid={`open-create-record-${activeObject.key}`} type="button" onClick={() => onQuickCreate(activeObject.key)}>
          <Plus size={16} />
          新建{activeObject.label}
        </button>
      </div>
    </div>
  );
}

type StandaloneModuleKey = "tasks" | "activities";
type HeaderNotificationIntent = "info" | "warning" | "danger";
type HeaderNotification = {
  id: string;
  title: string;
  description: string;
  time?: string;
  icon: LucideIcon;
  intent: HeaderNotificationIntent;
  event: NotificationEvent;
  syncedChannels: Array<Pick<NotificationChannel, "id" | "name" | "type">>;
};

function StandaloneModuleHeader({
  appSidebarCollapsed,
  appTheme,
  createLabel,
  isRouteRefreshing,
  moduleActionsOpen,
  moduleKey,
  moduleTitle,
  notificationMenuOpen,
  notifications,
  query,
  taskView,
  onChangeTaskView,
  onCreate,
  onImport,
  onExport,
  onQueryChange,
  onRefresh,
  onToggleAppSidebar,
  onToggleModuleActions,
  onToggleNotifications,
  onToggleTheme
}: {
  appSidebarCollapsed: boolean;
  appTheme: "light" | "dark";
  createLabel: string;
  isRouteRefreshing: boolean;
  moduleActionsOpen: boolean;
  moduleKey: StandaloneModuleKey;
  moduleTitle: string;
  notificationMenuOpen: boolean;
  notifications: HeaderNotification[];
  query: string;
  taskView?: TaskCalendarView;
  onChangeTaskView?: (view: TaskCalendarView) => void;
  onCreate: () => void;
  onImport: () => void;
  onExport: () => void;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onToggleAppSidebar: () => void;
  onToggleModuleActions: () => void;
  onToggleNotifications: () => void;
  onToggleTheme: () => void;
}) {
  const ModuleIcon = moduleKey === "tasks" ? CheckCircle2 : ActivityIcon;

  return (
    <div className="module-topbar" data-testid={`module-header-${moduleKey}`}>
      <div className="module-topbar-title">
        <AppSidebarToggleButton collapsed={appSidebarCollapsed} onToggle={onToggleAppSidebar} />
        <div className="module-title-block">
          <ModuleIcon size={18} />
          <h1 className="module-title">{moduleTitle}</h1>
        </div>
      </div>

      <label className="module-search" aria-label={`搜索${moduleTitle}`}>
        <Search size={17} />
        <input
          data-testid={`${moduleKey}-search`}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={`搜索${moduleTitle}`}
        />
        <kbd>Ctrl K</kbd>
      </label>

      <div className="module-topbar-actions">
        <button className="icon-button" type="button" onClick={onToggleTheme} aria-label={appTheme === "dark" ? "切换浅色模式" : "切换深色模式"} title={appTheme === "dark" ? "浅色模式" : "深色模式"}>
          {appTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <HeaderNotificationsMenu notifications={notifications} open={notificationMenuOpen} onToggle={onToggleNotifications} />
        <button className="icon-button" type="button" onClick={onRefresh} aria-label="刷新" title="刷新">
          <RefreshCw className={isRouteRefreshing ? "spin-icon" : undefined} size={16} />
        </button>
        <button className="icon-button module-quick-add-button" type="button" onClick={onCreate} aria-label={`新建${createLabel}`} title={`新建${createLabel}`}>
          <Plus size={18} />
        </button>
        <div className="toolbar-menu">
          <button className="icon-button" type="button" onClick={onToggleModuleActions} aria-label="更多操作" title="更多操作">
            <MoreHorizontal size={18} />
          </button>
          {moduleActionsOpen ? (
            <div className="toolbar-menu-panel module-menu-panel">
              <button type="button" onClick={onImport}>
                <Upload size={16} />
                Import {moduleTitle}
              </button>
              <button type="button" onClick={onExport}>
                <Download size={16} />
                Export {moduleTitle}
              </button>
            </div>
          ) : null}
        </div>
        {moduleKey === "tasks" && taskView && onChangeTaskView ? (
          <div className="module-view-switch" data-testid="task-header-view-switch">
            {(["list", "month", "week", "day"] as TaskCalendarView[]).map((mode) => (
              <button
                aria-label={taskViewLabel(mode)}
                className={taskView === mode ? "active" : ""}
                data-testid={`task-view-${mode}`}
                key={mode}
                type="button"
                title={taskViewLabel(mode)}
                onClick={() => onChangeTaskView(mode)}
              >
                {mode === "list" ? <LayoutList size={16} /> : <CalendarClock size={16} />}
              </button>
            ))}
          </div>
        ) : (
          <div className="module-view-switch">
            <button className="active" type="button" aria-label="List view" title="列表">
              <LayoutList size={16} />
            </button>
          </div>
        )}
        <button className="primary-button module-create-button" data-testid={`open-create-${moduleKey}`} type="button" onClick={onCreate}>
          <Plus size={16} />
          新建{createLabel}
        </button>
      </div>
    </div>
  );
}

function HeaderNotificationsMenu({
  notifications,
  onToggle,
  open
}: {
  notifications: HeaderNotification[];
  onToggle: () => void;
  open: boolean;
}) {
  return (
    <div className="toolbar-menu">
      <button className="icon-button notification-button" type="button" onClick={onToggle} aria-label="通知" title="通知">
        <Bell size={17} />
        {notifications.length ? <span className="notification-badge">{notifications.length > 99 ? "99+" : notifications.length}</span> : null}
      </button>
      {open ? (
        <div className="toolbar-menu-panel notification-menu-panel">
          <div className="module-menu-heading notification-menu-heading">
            <span>通知</span>
            <Settings size={14} />
          </div>
          {notifications.length ? (
            <div className="notification-list">
              {notifications.map((notification) => {
                const Icon = notification.icon;
                return (
                  <div className={`notification-item notification-${notification.intent}`} key={notification.id}>
                    <span className="notification-item-icon"><Icon size={15} /></span>
                    <span className="notification-item-body">
                      <strong>{notification.title}</strong>
                      <span>{notification.description}</span>
                      {notification.time ? <small>{formatDateTimeSeconds(notification.time)}</small> : null}
                      <small className="notification-sync">同步到 {formatNotificationChannelSummary(notification.syncedChannels)}</small>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="notification-empty">
              <Bell size={18} />
              <span>当前没有匹配通知渠道的提醒</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

type ContactDetailActivityTab = "all" | "activities" | "emails" | "calls" | "notes" | "tasks";

export function CrmWorkspace(props: CrmWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeRecordId = searchParams.get("recordId") ?? "";
  const routeReturnEmailThreadId = searchParams.get("returnEmailThreadId") ?? "";
  const routeEmailThreadId = searchParams.get("emailThreadId") ?? "";
  const routeEmailMailbox = normalizeEmailMailboxKey(searchParams.get("mailbox"));
  const routeEmailCategory = normalizeEmailCategoryKey(searchParams.get("category"));
  const routeEmailMode = normalizeEmailMailMode(searchParams.get("mailMode"));
  const routeEmailAccountId = searchParams.get("accountId") ?? allEmailAccountsKey;
  const routeEmailLabel = searchParams.get("label") ?? "";
  const routeEmailSearch = searchParams.get("mailSearch") ?? "";
  const routeEmailCompose = searchParams.get("compose") === "1";
  const routeEmailComposeTo = searchParams.get("to") ?? "";
  const routeEmailComposeRecordId = searchParams.get("composeRecordId") ?? "";
  const routeEmailComposeKey = searchParams.get("composeKey") ?? "";
  const routeMode = searchParams.get("mode") ?? "";
  const routeCompanyId = searchParams.get("companyId") ?? "";
  const routeRecordPool = normalizeRecordPool(searchParams.get("pool"));
  const routeDealView = normalizeDealWorkspaceView(searchParams.get("view"));
  const [activeNav, setActiveNav] = useState<NavKey>(props.initialNavKey);
  const [appSidebarCollapsed, setAppSidebarCollapsed] = useState(false);
  const [activeObjectKey, setActiveObjectKey] = useState(props.initialObjectKey);
  const [records, setRecords] = useState<CrmRecord[]>(() => mergeRecords(props.records, props.initialRecordList.records, props.dashboardSummary.deals));
  const [activities, setActivities] = useState<Activity[]>(() =>
    mergeActivities(props.activities, props.dashboardSummary.openTasks, props.dashboardSummary.recentActivities)
  );
  const [selectedRecordId, setSelectedRecordId] = useState(routeRecordId || props.initialRecordList.records[0]?.id || props.records[0]?.id || "");
  const [selectedViewId, setSelectedViewId] = useState("");
  const [recordPage, setRecordPage] = useState(1);
  const [recordCursorStack, setRecordCursorStack] = useState<string[]>([""]);
  const [recordListObjectKey, setRecordListObjectKey] = useState(props.initialObjectKey);
  const [recordList, setRecordList] = useState<RecordListResult>(() => props.initialRecordList);
  const [recordPool, setRecordPool] = useState<RecordPool>(routeRecordPool);
  const [dealWorkspaceView, setDealWorkspaceView] = useState<DealWorkspaceView>(routeDealView);
  const [appTheme, setAppTheme] = useState<"light" | "dark">("light");
  const [quickAddMenuOpen, setQuickAddMenuOpen] = useState(false);
  const [moduleActionsOpen, setModuleActionsOpen] = useState(false);
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [isRecordListLoading, setIsRecordListLoading] = useState(false);
  const [viewDraft, setViewDraft] = useState<ViewDraft>(emptyViewDraft);
  const [query, setQuery] = useState("");
  const [taskQuery, setTaskQuery] = useState("");
  const [activityQuery, setActivityQuery] = useState("");
  const [taskWorkspaceView, setTaskWorkspaceView] = useState<TaskCalendarView>("list");
  const [recordPanelMode, setRecordPanelMode] = useState<RecordPanelMode>(routeRecordId ? "detail" : "closed");
  const [recordReturnEmailThreadId, setRecordReturnEmailThreadId] = useState(routeReturnEmailThreadId);
  const [recordEmailActivityFilter, setRecordEmailActivityFilter] = useState("");
  const [contactDetailActivityTab, setContactDetailActivityTab] = useState<ContactDetailActivityTab>("all");
  const [contactMethodEditingId, setContactMethodEditingId] = useState("");
  const [contactMethodEditingRecordId, setContactMethodEditingRecordId] = useState("");
  const [contactMethodEditingValue, setContactMethodEditingValue] = useState("");
  const [contactFollowUpDraft, setContactFollowUpDraft] = useState<ContactFollowUpDraft | null>(null);
  const [isContactFollowUpGenerating, setIsContactFollowUpGenerating] = useState(false);
  const [companyAddressEditing, setCompanyAddressEditing] = useState<{ valueKey: string; addressId: string } | null>(null);
  const [recordActivityComposerType, setRecordActivityComposerType] = useState<Activity["type"] | "">("");
  const [pipelineActivityDeal, setPipelineActivityDeal] = useState<CrmRecord | null>(null);
  const [pipelineActivityType, setPipelineActivityType] = useState<Activity["type"]>("note");
  const [showListSettings, setShowListSettings] = useState(false);
  const [createFormObjectKey, setCreateFormObjectKey] = useState(props.initialObjectKey);
  const [createTitle, setCreateTitle] = useState("");
  const [createOwnerId, setCreateOwnerId] = useState(props.contextUser.id);
  const [createValues, setCreateValues] = useState<Record<string, string>>({});
  const [editTitle, setEditTitle] = useState("");
  const [editOwnerId, setEditOwnerId] = useState("");
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [dealCloseReason, setDealCloseReason] = useState("");
  const [importCsv, setImportCsv] = useState("title,email,phone\n王敏,wang@example.com,+86 139 0000 0000");
  const [importStrategy, setImportStrategy] = useState<CsvImportStrategy>("skip-invalid");
  const [importMapping, setImportMapping] = useState<CsvImportMapping>({});
  const [importPreview, setImportPreview] = useState<CsvImportPreview | null>(null);
  const [importJobs, setImportJobs] = useState<CsvImportJob[]>(props.importJobs);
  const [selectedImportJobId, setSelectedImportJobId] = useState("");
  const [selectedImportJob, setSelectedImportJob] = useState<CsvImportJob | null>(null);
  const [importPresets, setImportPresets] = useState<ImportPreset[]>(props.importPresets);
  const [selectedImportPresetId, setSelectedImportPresetId] = useState("");
  const [importPresetName, setImportPresetName] = useState("");
  const [aiQuestion, setAiQuestion] = useState("本周有哪些高价值交易需要继续推进？");
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>(props.emailAccounts);
  const [emailSignatures, setEmailSignatures] = useState<EmailSignature[]>(props.emailSignatures);
  const [emailThreads, setEmailThreads] = useState<EmailThread[]>(props.emailThreads);
  const [emailMessagesByThread, setEmailMessagesByThread] = useState<Record<string, EmailMessage[]>>({});
  const [selectedEmailThreadId, setSelectedEmailThreadId] = useState(routeEmailThreadId || props.emailThreads[0]?.id || "");
  const [emailDetailThreadId, setEmailDetailThreadId] = useState(routeEmailThreadId);
  const [emailWorkspaceView, setEmailWorkspaceView] = useState<EmailWorkspaceView>("mail");
  const [emailAiSettings, setEmailAiSettings] = useState<EmailAiSettings>(props.emailAiSettings);
  const [emailSyncSettings, setEmailSyncSettings] = useState<EmailSyncSettings>(props.emailSyncSettings ?? defaultEmailSyncSettings);
  const [emailComposeOpenRequestKey, setEmailComposeOpenRequestKey] = useState("");
  const [emailAccountDraft, setEmailAccountDraft] = useState<EmailAccountDraft>(() => createEmptyEmailAccountDraft());
  const [emailSignatureDraft, setEmailSignatureDraft] = useState<EmailSignatureDraft>(() => createEmptyEmailSignatureDraft());
  const [emailDraft, setEmailDraft] = useState<EmailComposeDraft>({
    clientRequestId: createEmailClientRequestId(),
    accountId: props.emailAccounts[0]?.id ?? "",
    recordId: "",
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    bodyText: "",
    bodyHtml: "",
    signatureId: "",
    attachments: [],
    scheduledSendAt: "",
    trackingEnabled: false,
    groupSendMode: false,
    aiAssisted: false
  });
  const [emailAiPurpose, setEmailAiPurpose] = useState<"draft" | "translate" | "context_analysis" | "summarize">("draft");
  const [emailAiPrompt, setEmailAiPrompt] = useState("");
  const [emailAiResult, setEmailAiResult] = useState<EmailAiGenerateResult | null>(null);
  const [emailDiagnostics, setEmailDiagnostics] = useState<EmailSubsystemDiagnostics | null>(null);
  const [emailConnectionTestRun, setEmailConnectionTestRun] = useState<EmailConnectionTestRun | null>(null);
  const [knowledgeArticles, setKnowledgeArticles] = useState<KnowledgeArticle[]>(props.knowledgeArticles);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>(props.mediaAssets);
  const [smartReminders, setSmartReminders] = useState<SmartReminder[]>(props.dashboardSummary.smartReminders);
  const [isGeneratingSmartReminders, setIsGeneratingSmartReminders] = useState(false);
  const [recordChangeRequests, setRecordChangeRequests] = useState<RecordChangeRequest[]>(props.recordChangeRequests);
  const [knowledgeDraft, setKnowledgeDraft] = useState<KnowledgeArticleDraft>({ title: "", body: "", tags: "", active: true });
  const [deletedActivityIds, setDeletedActivityIds] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [promptDialog, setPromptDialog] = useState<PromptDialogState | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isRecordSavePending, setIsRecordSavePending] = useState(false);
  const [isRouteRefreshPending, startRouteRefreshTransition] = useTransition();
  const [isRouteRefreshing, setIsRouteRefreshing] = useState(false);
  const previousCreateFormResetKey = useRef("");
  const previousViewDraftResetKey = useRef("");
  const previousEditFormResetKey = useRef("");
  const recordListRequestSeq = useRef(0);
  const routeRefreshTimeoutRef = useRef<number | null>(null);
  const pendingRecordOpenRef = useRef<{ objectKey: string; recordId: string; returnEmailThreadId: string } | null>(null);
  const pendingRecordCreateRef = useRef<{ objectKey: string; values: Record<string, string> } | null>(null);
  const handledRouteEmailComposeRef = useRef("");
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const promptResolverRef = useRef<((value: string | null) => void) | null>(null);

  useEffect(() => {
    if (isRouteRefreshPending || !isRouteRefreshing) {
      return;
    }

    if (routeRefreshTimeoutRef.current !== null) {
      window.clearTimeout(routeRefreshTimeoutRef.current);
      routeRefreshTimeoutRef.current = null;
    }
    setIsRouteRefreshing(false);
  }, [isRouteRefreshPending, isRouteRefreshing]);

  useEffect(() => {
    return () => {
      if (routeRefreshTimeoutRef.current !== null) {
        window.clearTimeout(routeRefreshTimeoutRef.current);
      }
    };
  }, []);

  function showToast(nextToast: ToastState) {
    setToast(nextToast);
    window.setTimeout(() => {
      setToast((current) => (current?.message === nextToast.message && current.intent === nextToast.intent ? null : current));
    }, 3600);
  }

  function showSuccess(messageText: string) {
    setMessage(messageText);
    showToast({ intent: "success", message: messageText });
  }

  function showError(messageText: string) {
    setError(messageText);
    showToast({ intent: "error", message: messageText });
  }

  function requestConfirm(options: ConfirmDialogState): Promise<boolean> {
    setConfirmDialog(options);
    return new Promise((resolve) => {
      confirmResolverRef.current = resolve;
    });
  }

  function resolveConfirm(confirmed: boolean) {
    confirmResolverRef.current?.(confirmed);
    confirmResolverRef.current = null;
    setConfirmDialog(null);
  }

  function requestPrompt(options: PromptDialogState): Promise<string | null> {
    setPromptDialog(options);
    setPromptValue(options.defaultValue ?? "");
    return new Promise((resolve) => {
      promptResolverRef.current = resolve;
    });
  }

  function resolvePrompt(value: string | null) {
    promptResolverRef.current?.(value);
    promptResolverRef.current = null;
    setPromptDialog(null);
    setPromptValue("");
  }

  const routeObjectKeys = useMemo(() => props.objects.map((object) => object.key), [props.objects]);
  const activeObject = useMemo(
    () => props.objects.find((object) => object.key === activeObjectKey) ?? props.objects[0],
    [activeObjectKey, props.objects]
  );
  const activeObjectUsesPool = Boolean(activeObject && isPoolEnabledForObject(activeObject.key, props.poolSettings));
  const objectFields = useMemo(
    () =>
      props.fields
        .filter((field) => field.objectKey === activeObject?.key)
        .sort((a, b) => a.position - b.position),
    [activeObject?.key, props.fields]
  );
  const objectFormFields = useMemo(
    () => visibleFormFieldsForObject(activeObject?.key, objectFields),
    [activeObject?.key, objectFields]
  );
  const objectFieldSignature = useMemo(
    () => objectFields.map((field) => `${field.id}:${field.key}:${field.type}:${field.position}`).join("|"),
    [objectFields]
  );
  const createFormResetKey = `${activeObject?.key ?? ""}:${objectFieldSignature}`;
  const objectRecords = useMemo(
    () => (recordListObjectKey === activeObject?.key && Array.isArray(recordList.records) ? recordList.records : []),
    [activeObject?.key, recordList.records, recordListObjectKey]
  );
  const activeViews = useMemo(
    () => props.savedViews.filter((view) => view.objectKey === activeObject?.key),
    [activeObject?.key, props.savedViews]
  );
  const activeView = useMemo(
    () => activeViews.find((view) => view.id === selectedViewId) ?? activeViews.find((view) => view.isDefault),
    [activeViews, selectedViewId]
  );
  const activeViewSignature = useMemo(() => {
    if (!activeView) {
      return "";
    }

    return JSON.stringify({
      id: activeView.id,
      name: activeView.name,
      columns: activeView.columns,
      filters: activeView.filters ?? [],
      sort: activeView.sort ?? null,
      isDefault: activeView.isDefault
    });
  }, [activeView]);
  const viewDraftResetKey = `${activeObject?.key ?? ""}:${objectFieldSignature}:${activeViewSignature}`;
  const effectiveView = useMemo(
    () => buildEffectiveView(activeView, activeObject?.key ?? activeObjectKey, viewDraft),
    [activeObject?.key, activeObjectKey, activeView, viewDraft]
  );
  const visibleTableColumns = useMemo<TableColumn[]>(() => {
    const hasConfiguredColumns = Boolean(effectiveView.columns);
    const configuredKeys = effectiveView.columns?.filter((column) => column !== "title") ?? [];
    const fallbackKeys = objectFields.slice(0, 3).map((field) => field.key);
    const fieldKeys = hasConfiguredColumns ? configuredKeys : fallbackKeys;

    return fieldKeys
      .map((key) => {
        if (key === "ownerId") {
          return { key, label: "负责人", type: "owner" } satisfies TableColumn;
        }
        const field = objectFields.find((item) => item.key === key);
        return field ? ({ key, label: field.label, type: "field", field } satisfies TableColumn) : undefined;
      })
      .filter((column): column is TableColumn => Boolean(column));
  }, [effectiveView.columns, objectFields]);
  const recordListFields = useMemo(() => {
    const mediaField = activeObject?.key === "contacts" ? "avatarUrl" : activeObject?.key === "companies" ? "logoUrl" : undefined;
    const systemFields = activeObject?.key === "deals" ? ["pipelineOrder"] : [];
    return Array.from(new Set(["title", ...(mediaField ? [mediaField] : []), ...systemFields, ...visibleTableColumns.map((column) => column.key)]));
  }, [activeObject?.key, visibleTableColumns]);
  const recordCursor = recordCursorStack[recordPage - 1] ?? "";
  const filteredRecords = objectRecords;
  const exportRecordsUrl = activeObject
    ? buildRecordListUrl(activeObject.key, effectiveView, query, 1, `/api/records/${activeObject.key}/export`, 200, { pool: activeObjectUsesPool ? recordPool : undefined })
    : "#";
  const importTemplateUrl = activeObject ? `/api/imports/templates/${activeObject.key}` : "#";
  const importFieldGuideUrl = activeObject ? `/api/imports/templates/${activeObject.key}/fields` : "#";
  const selectedRecord = useMemo(
    () =>
      records.find((record) => record.id === selectedRecordId && record.objectKey === activeObject?.key) ??
      filteredRecords[0] ??
      objectRecords[0],
    [activeObject?.key, filteredRecords, objectRecords, records, selectedRecordId]
  );
  const selectedRecordWorkflows = useMemo(
    () => (selectedRecord ? props.workflows.filter((workflow) => isWorkflowScopedToRecord(workflow, selectedRecord)) : []),
    [props.workflows, selectedRecord]
  );
  const selectedRecordSmartReminders = useMemo(
    () =>
      selectedRecord
        ? smartReminders
            .filter((reminder) => reminder.status === "open")
            .filter((reminder) => reminder.objectKey === selectedRecord.objectKey && reminder.recordId === selectedRecord.id)
            .filter((reminder) => !reminder.snoozedUntil || new Date(reminder.snoozedUntil).getTime() <= Date.now())
            .sort(compareSmartReminderForUi)
        : [],
    [selectedRecord, smartReminders]
  );
  const selectedRecordPendingDeleteRequest = useMemo(
    () =>
      selectedRecord
        ? recordChangeRequests.find(
            (request) =>
              request.status === "pending" &&
              request.action === "delete" &&
              request.objectKey === selectedRecord.objectKey &&
              request.recordId === selectedRecord.id
          )
        : undefined,
    [recordChangeRequests, selectedRecord]
  );
  const selectedRecordPendingUpdateRequest = useMemo(
    () =>
      selectedRecord
        ? recordChangeRequests.find(
            (request) =>
              request.status === "pending" &&
              request.action === "update" &&
              request.objectKey === selectedRecord.objectKey &&
              request.recordId === selectedRecord.id
          )
        : undefined,
    [recordChangeRequests, selectedRecord]
  );
  const pendingActivityDeleteRequestsById = useMemo(
    () =>
      new Map(
        recordChangeRequests
          .filter((request) => request.objectKey === "activities" && request.action === "delete" && request.status === "pending")
          .map((request) => [request.recordId, request])
      ),
    [recordChangeRequests]
  );
  const selectedFields = useMemo(
    () =>
      props.fields
        .filter((field) => field.objectKey === selectedRecord?.objectKey)
        .sort((a, b) => a.position - b.position),
    [props.fields, selectedRecord?.objectKey]
  );
  const selectedFormFields = useMemo(
    () => visibleFormFieldsForObject(selectedRecord?.objectKey, selectedFields),
    [selectedFields, selectedRecord?.objectKey]
  );
  const selectedRecordFormResetKey = `${selectedRecord?.objectKey ?? ""}:${selectedRecord?.id ?? ""}`;
  const selectedActivities = useMemo(
    () =>
      activities
        .filter((activity) => !deletedActivityIds.has(activity.id))
        .filter((activity) => activity.recordId === selectedRecord?.id)
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    [activities, deletedActivityIds, selectedRecord?.id]
  );
  const selectedTasks = useMemo(
    () =>
      selectedActivities
        .filter((activity) => activity.type === "task")
        .sort((left, right) => new Date(left.dueAt ?? left.createdAt).getTime() - new Date(right.dueAt ?? right.createdAt).getTime()),
    [selectedActivities]
  );
  const selectedNotes = useMemo(
    () => selectedActivities.filter((activity) => activity.type === "note"),
    [selectedActivities]
  );
  const selectedCalls = useMemo(
    () => selectedActivities.filter((activity) => activity.type === "call"),
    [selectedActivities]
  );
  const selectedMeetings = useMemo(
    () => selectedActivities.filter((activity) => activity.type === "meeting"),
    [selectedActivities]
  );
  const selectedRecordEmailAddresses = useMemo(
    () => (selectedRecord ? getRecordEmailAddressesForComposer(selectedFields, selectedRecord, records) : []),
    [records, selectedFields, selectedRecord]
  );
  const selectedRecordEmailThreads = useMemo(
    () => (selectedRecord ? getEmailThreadsForRecord(selectedRecord, records, emailThreads) : []),
    [emailThreads, records, selectedRecord]
  );
  const selectedRecordVisibleEmailThreads = useMemo(
    () =>
      recordEmailActivityFilter
        ? selectedRecordEmailThreads.filter((thread) => thread.participantEmails.some((emailAddress) => emailAddress.toLowerCase() === recordEmailActivityFilter.toLowerCase()))
        : selectedRecordEmailThreads,
    [recordEmailActivityFilter, selectedRecordEmailThreads]
  );
  const selectedCompanyContacts = useMemo(
    () => (selectedRecord?.objectKey === "companies" ? getCompanyContactRecords(selectedRecord, records) : []),
    [records, selectedRecord]
  );
  const selectedCompanyPrimaryContact = useMemo(
    () => (selectedRecord?.objectKey === "companies" ? getCompanyPrimaryContact(selectedRecord, records) : undefined),
    [records, selectedRecord]
  );
  const selectedRecordQuickContactMethods = useMemo(
    () => (selectedRecord ? getQuickContactMethodsForRecord(selectedRecord, records) : []),
    [records, selectedRecord]
  );
  const selectedRecordUsesActivityTabs = selectedRecord ? ["contacts", "companies", "deals"].includes(selectedRecord.objectKey) : false;
  const contactDetailTab = selectedRecordUsesActivityTabs ? contactDetailActivityTab : "all";
  const showContactAllSections = contactDetailTab === "all";
  const showContactEmailSections = showContactAllSections || contactDetailTab === "emails";
  const showContactActivityTimeline = showContactAllSections || contactDetailTab === "activities";
  const showContactTaskSections = showContactAllSections || contactDetailTab === "tasks";
  const showContactNoteSections = showContactAllSections || contactDetailTab === "notes";
  const showContactCallSections = showContactAllSections || contactDetailTab === "calls";
  const openTasks = useMemo(
    () =>
      activities
        .filter((activity) => !deletedActivityIds.has(activity.id))
        .filter((activity) => activity.type === "task" && !activity.completedAt && !activity.archivedAt)
        .sort((left, right) => new Date(left.dueAt ?? left.createdAt).getTime() - new Date(right.dueAt ?? right.createdAt).getTime()),
    [activities, deletedActivityIds]
  );
  const taskActivities = useMemo(
    () =>
      activities
        .filter((activity) => !deletedActivityIds.has(activity.id))
        .filter((activity) => activity.type === "task")
        .sort((left, right) => new Date(left.dueAt ?? left.createdAt).getTime() - new Date(right.dueAt ?? right.createdAt).getTime()),
    [activities, deletedActivityIds]
  );
  const filteredTaskActivities = useMemo(() => {
    const normalizedQuery = taskQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return taskActivities;
    }
    return taskActivities.filter((activity) => {
      const details = parseTaskDetails(activity.body);
      const owner = props.users.find((user) => user.id === activity.actorId);
      return [activity.title, details.text, activity.dueAt, owner?.name, owner?.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    });
  }, [props.users, taskActivities, taskQuery]);
  const filteredActivities = useMemo(() => {
    const normalizedQuery = activityQuery.trim().toLowerCase();
    const visibleActivities = activities
      .filter((activity) => !deletedActivityIds.has(activity.id))
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    if (!normalizedQuery) {
      return visibleActivities;
    }
    return visibleActivities.filter((activity) => {
      const details = parseActivityDetails(activity.body);
      const linkedRecord = records.find((record) => record.id === activity.recordId);
      const owner = props.users.find((user) => user.id === activity.actorId);
      return [formatActivityType(activity.type), activityTimelineTitle(activity), activity.title, details.text, linkedRecord?.title, owner?.name, owner?.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    });
  }, [activities, activityQuery, deletedActivityIds, props.users, records]);
  const headerNotifications = useMemo(
    () =>
      buildHeaderNotifications({
        activities,
        deletedActivityIds,
        importJobs,
        notificationChannels: props.notificationChannels,
        objectDefinitions: props.objects,
        recordChangeRequests,
        records,
        smartReminders,
        workflowApprovals: props.workflowApprovals
      }),
    [activities, deletedActivityIds, importJobs, props.notificationChannels, props.objects, props.workflowApprovals, recordChangeRequests, records, smartReminders]
  );
  const deals = useMemo(() => records.filter((record) => record.objectKey === "deals"), [records]);
  const currencyRecords = useMemo(() => records.filter((record) => record.objectKey === "currencies"), [records]);
  const currencies = useMemo(() => getCurrencyDefinitions(currencyRecords), [currencyRecords]);
  const totalPipeline = useMemo(
    () => props.dashboardSummary.totalPipeline,
    [props.dashboardSummary.totalPipeline]
  );
  const activePipeline = useMemo(
    () => props.pipelines.find((pipeline) => pipeline.objectKey === activeObject?.key && pipeline.isDefault),
    [activeObject?.key, props.pipelines]
  );
  const activePipelineStages = useMemo(
    () => withClosedStages(activePipeline?.stages ?? []),
    [activePipeline?.stages]
  );
  const isDealPipelineView = activeObject?.key === "deals" && dealWorkspaceView === "pipeline";
  const selectedDealNextStage = useMemo(() => {
    if (!selectedRecord || selectedRecord.objectKey !== "deals" || activePipelineStages.length === 0) {
      return undefined;
    }

    const currentIndex = activePipelineStages.findIndex((stage) => stage.key === selectedRecord.stageKey);
    return activePipelineStages[currentIndex + 1];
  }, [activePipelineStages, selectedRecord]);
  const relatedRecords = useMemo(
    () => findRelatedRecords(selectedRecord, records, props.fields, props.relations),
    [props.fields, records, props.relations, selectedRecord]
  );
  const canImport = props.role.permissions.includes("crm.import");
  const canManageViews = props.role.permissions.includes("crm.admin");
  const canManageEmailSettings = props.role.permissions.includes("crm.admin");
  const canManageAiSettings = props.role.permissions.includes("ai.admin") || props.role.permissions.includes("crm.admin");
  const activeImportJobs = useMemo(
    () => importJobs.filter((job) => job.objectKey === activeObject?.key),
    [activeObject?.key, importJobs]
  );
  const activeImportPresets = useMemo(
    () => importPresets.filter((preset) => preset.objectKey === activeObject?.key),
    [activeObject?.key, importPresets]
  );
  const quickAddObjects = useMemo(() => {
    const quickObjectKeys = ["deals", "activities", "contacts", "companies", "products", "quotes"];
    const candidates = quickObjectKeys
      .map((objectKey) => props.objects.find((object) => object.key === objectKey))
      .filter((object): object is ObjectDefinition => Boolean(object));
    if (!activeObject) {
      return candidates;
    }
    return [activeObject, ...candidates.filter((object) => object.key !== activeObject.key)];
  }, [activeObject, props.objects]);
  const selectedActiveImportJob = useMemo(
    () => (selectedImportJob?.objectKey === activeObject?.key ? selectedImportJob : activeImportJobs.find((job) => job.id === selectedImportJobId) ?? null),
    [activeImportJobs, activeObject?.key, selectedImportJob, selectedImportJobId]
  );
  const hasActiveImportJobs = activeImportJobs.some((job) => job.status === "queued" || job.status === "processing");
  const mergeLoadedRecords = useCallback((loadedRecords: CrmRecord[]) => {
    setRecords((current) => mergeRecords(current, loadedRecords));
  }, []);
  const refreshImportJobs = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!activeObject?.key) {
        return;
      }

      const jobs = await fetchJson<CsvImportJob[]>(`/api/imports/jobs?objectKey=${encodeURIComponent(activeObject.key)}`, {
        method: "GET"
      });
      setImportJobs((current) => mergeImportJobs(current, jobs, activeObject.key));
      if (!options.silent) {
        setMessage("导入任务已刷新");
      }
    },
    [activeObject?.key]
  );

  useEffect(() => {
    const storedSidebarCollapsed = window.localStorage.getItem(sidebarCollapsedStorageKey);
    if (storedSidebarCollapsed === "true" || storedSidebarCollapsed === "false") {
      setAppSidebarCollapsed(storedSidebarCollapsed === "true");
    }
    const storedTheme = window.localStorage.getItem(appThemeStorageKey);
    if (storedTheme === "dark" || storedTheme === "light") {
      setAppTheme(storedTheme);
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    const notice = readEmailOAuthCallbackNotice(window.location.search);
    if (!notice) {
      return;
    }
    setActiveNav("email");
    if (notice.status === "error") {
      setError(notice.message);
    } else {
      setMessage(notice.message);
    }
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("emailOAuth");
    nextUrl.searchParams.delete("emailAccountId");
    nextUrl.searchParams.delete("emailAccountCreated");
    nextUrl.searchParams.delete("emailOAuthError");
    nextUrl.pathname = crmPathForNav("email");
    window.history.replaceState(window.history.state, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  }, []);

  useEffect(() => {
    const route = resolveCrmRoute(pathname.split("/").filter(Boolean), routeObjectKeys);
    if (!route) {
      return;
    }

    const nextNav = route.navKey as NavKey;
    setActiveNav(nextNav);
    if (nextNav === "records" || coreObjects.has(nextNav)) {
      const pendingRecordOpen = pendingRecordOpenRef.current;
      setActiveObjectKey(route.objectKey);
      if (routeRecordId) {
        setSelectedRecordId(routeRecordId);
        setRecordReturnEmailThreadId(routeReturnEmailThreadId);
        setRecordPanelMode("detail");
        pendingRecordOpenRef.current = null;
      } else if (routeMode === "create") {
        setSelectedRecordId("");
        setRecordReturnEmailThreadId("");
        setRecordPanelMode("create");
      } else if (pendingRecordOpen?.objectKey === route.objectKey) {
        setSelectedRecordId(pendingRecordOpen.recordId);
        setRecordReturnEmailThreadId(pendingRecordOpen.returnEmailThreadId);
        setRecordPanelMode("detail");
        pendingRecordOpenRef.current = null;
      } else {
        pendingRecordOpenRef.current = null;
        setRecordPanelMode("closed");
      }
      setShowListSettings(false);
    } else if (nextNav === "email") {
      setEmailWorkspaceView("mail");
      if (routeEmailThreadId) {
        setSelectedEmailThreadId(routeEmailThreadId);
        setEmailDetailThreadId(routeEmailThreadId);
      } else {
        setEmailDetailThreadId("");
      }
    }
  }, [pathname, routeEmailThreadId, routeObjectKeys, routeRecordId, routeReturnEmailThreadId, routeMode]);

  useEffect(() => {
    setRecordPool(routeRecordPool);
  }, [routeRecordPool]);

  useEffect(() => {
    setDealWorkspaceView(routeDealView);
  }, [routeDealView]);

  useEffect(() => {
    setRecords(mergeRecords(props.records, props.initialRecordList.records, props.dashboardSummary.deals));
    setActivities(mergeActivities(props.activities, props.dashboardSummary.openTasks, props.dashboardSummary.recentActivities));
    setSmartReminders((current) => mergeSmartReminders(current, props.dashboardSummary.smartReminders));
    setRecordList(props.initialRecordList);
    setRecordListObjectKey(props.initialObjectKey);
  }, [props.activities, props.dashboardSummary.deals, props.dashboardSummary.openTasks, props.dashboardSummary.recentActivities, props.dashboardSummary.smartReminders, props.initialObjectKey, props.initialRecordList, props.records]);

  useEffect(() => {
    setSelectedRecordId((current) => {
      if (records.some((record) => record.id === current && record.objectKey === activeObject?.key)) {
        return current;
      }

      if (filteredRecords.some((record) => record.id === current)) {
        return current;
      }

      return filteredRecords[0]?.id ?? "";
    });
  }, [activeObject?.key, filteredRecords, records]);

  useEffect(() => {
    setSelectedViewId((current) => {
      if (activeViews.some((view) => view.id === current)) {
        return current;
      }

      return activeViews.find((view) => view.isDefault)?.id ?? "";
    });
  }, [activeViews]);

  useEffect(() => {
    setRecordPage(1);
    setRecordCursorStack([""]);
  }, [activeObjectKey, query, recordPool, selectedViewId, viewDraft.filterField, viewDraft.filterOperator, viewDraft.filterValue, viewDraft.sortField, viewDraft.sortDirection]);

  useEffect(() => {
    setImportJobs(props.importJobs);
  }, [props.importJobs]);

  useEffect(() => {
    setImportPresets(props.importPresets);
  }, [props.importPresets]);

  useEffect(() => {
    setRecordChangeRequests(props.recordChangeRequests);
  }, [props.recordChangeRequests]);

  useEffect(() => {
    setRecordEmailActivityFilter("");
    setContactMethodEditingId("");
    setContactMethodEditingRecordId("");
    setContactMethodEditingValue("");
    setCompanyAddressEditing(null);
    setRecordActivityComposerType("");
  }, [selectedRecord?.id]);

  useEffect(() => {
    setEmailAccounts(props.emailAccounts);
    setEmailSignatures(props.emailSignatures);
    setEmailThreads(props.emailThreads);
    setEmailAiSettings(props.emailAiSettings);
    setEmailSyncSettings(props.emailSyncSettings ?? defaultEmailSyncSettings);
    setKnowledgeArticles(props.knowledgeArticles);
    setMediaAssets(props.mediaAssets);
    setEmailDraft((current) => {
      const accountId = current.accountId || props.emailAccounts[0]?.id || "";
      return accountId === current.accountId ? current : clearEmailDraftAiProvenance({ ...current, accountId });
    });
    const preserveComposeDraft = Boolean(emailComposeOpenRequestKey && !routeEmailThreadId);
    const preferredThreadId = routeEmailThreadId || selectedEmailThreadId;
    const nextSelectedThreadId = props.emailThreads.some((thread) => thread.id === preferredThreadId) ? preferredThreadId : props.emailThreads[0]?.id ?? "";
    if (!preserveComposeDraft && nextSelectedThreadId !== selectedEmailThreadId) {
      setEmailDraft((current) => clearEmailDraftAiProvenance(current));
      setSelectedEmailThreadId(nextSelectedThreadId);
    }
  }, [emailComposeOpenRequestKey, props.emailAccounts, props.emailAiSettings, props.emailSignatures, props.emailSyncSettings, props.emailThreads, props.knowledgeArticles, props.mediaAssets, routeEmailThreadId, selectedEmailThreadId]);

  useEffect(() => {
    if (!routeEmailThreadId) {
      return;
    }

    if (routeEmailThreadId !== selectedEmailThreadId) {
      setEmailDraft((current) => clearEmailDraftAiProvenance(current));
      setSelectedEmailThreadId(routeEmailThreadId);
    }
    setEmailDetailThreadId(routeEmailThreadId);
    setEmailWorkspaceView("mail");
    if (!emailMessagesByThread[routeEmailThreadId]) {
      let didCancel = false;
      fetchJson<EmailMessage[]>(`/api/email/threads/${routeEmailThreadId}/messages`, { method: "GET" })
        .then((messages) => {
          if (!didCancel) {
            setEmailMessagesByThread((current) => ({ ...current, [routeEmailThreadId]: messages }));
          }
        })
        .catch((loadError) => {
          if (!didCancel) {
            setError(loadError instanceof Error ? loadError.message : "邮件详情加载失败");
          }
        });
      return () => {
        didCancel = true;
      };
    }
  }, [emailMessagesByThread, routeEmailThreadId, selectedEmailThreadId]);

  useEffect(() => {
    if (activeNav !== "email" || !routeEmailCompose) {
      return;
    }
    const composeRouteKey = `${routeEmailComposeKey || "route"}:${routeEmailComposeRecordId}:${routeEmailComposeTo}`;
    if (handledRouteEmailComposeRef.current === composeRouteKey) {
      return;
    }
    handledRouteEmailComposeRef.current = composeRouteKey;
    setSelectedEmailThreadId("");
    setEmailDetailThreadId("");
    setEmailWorkspaceView("mail");
    setEmailAiResult(null);
    setEmailDraft((current) =>
      clearEmailDraftAiProvenance({
        ...current,
        accountId: current.accountId || props.emailAccounts.find(canSelectEmailAccountForSending)?.id || "",
        recordId: routeEmailComposeRecordId || current.recordId,
        to: routeEmailComposeTo || current.to,
        cc: "",
        bcc: "",
        subject: "",
        threadId: undefined,
        bodyText: "",
        bodyHtml: "",
        attachments: []
      })
    );
    setEmailComposeOpenRequestKey(composeRouteKey);
  }, [activeNav, props.emailAccounts, routeEmailCompose, routeEmailComposeKey, routeEmailComposeRecordId, routeEmailComposeTo]);

  useEffect(() => {
    setSelectedImportPresetId((current) => (activeImportPresets.some((preset) => preset.id === current) ? current : ""));
  }, [activeImportPresets]);

  useEffect(() => {
    if (selectedImportJob && selectedImportJob.objectKey !== activeObject?.key) {
      setSelectedImportJob(null);
      setSelectedImportJobId("");
    }
  }, [activeObject?.key, selectedImportJob]);

  useEffect(() => {
    if (!canImport || !activeObject?.key || !hasActiveImportJobs) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      refreshImportJobs({ silent: true }).catch((pollError) => {
        setError(pollError instanceof Error ? pollError.message : "导入任务刷新失败");
      });
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, [activeObject?.key, canImport, hasActiveImportJobs, refreshImportJobs]);

  useEffect(() => {
    if (!activeObject) {
      recordListRequestSeq.current += 1;
      setIsRecordListLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const requestSeq = recordListRequestSeq.current + 1;
    recordListRequestSeq.current = requestSeq;
    let didTimeout = false;
    const timeoutId = window.setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, recordListRequestTimeoutMs);
    setIsRecordListLoading(true);

    fetchJson<RecordListResult>(
      buildRecordListUrl(activeObject.key, effectiveView, query, recordPage, `/api/records/${activeObject.key}`, 50, {
        cursor: recordCursor,
        fields: recordListFields,
        keyset: true,
        pool: activeObjectUsesPool ? recordPool : undefined
      }),
      {
      method: "GET",
      signal: controller.signal
      }
    )
      .then(async (result) => {
        if (!Array.isArray(result.records)) {
          throw new Error("Record list response is invalid");
        }
        const nextCursor = result.nextCursor;
        if (result.paginationMode === "keyset" && nextCursor) {
          setRecordCursorStack((current) => {
            if (current[recordPage] === nextCursor) {
              return current;
            }
            const next = current.slice(0, recordPage);
            next[recordPage] = nextCursor;
            return next;
          });
        }
        const referenceObjectKeys = getReferenceObjectKeysForObject(props.fields, activeObject.key, props.relations);
        const referenceLists = await Promise.all(
          [...referenceObjectKeys].map((objectKey) =>
            fetchJson<RecordListResult>(buildRecordListUrl(objectKey, emptySavedView(objectKey), "", 1, `/api/records/${objectKey}`, 20, { fields: ["title"], keyset: true }), {
              method: "GET",
              signal: controller.signal
            })
          )
        );
        if (recordListRequestSeq.current !== requestSeq) {
          return;
        }
        setRecordList(result);
        setRecordListObjectKey(activeObject.key);
        setRecords((current) => mergeRecords(current, result.records, ...referenceLists.map((list) => list.records)));
      })
      .catch((listError) => {
        if (listError instanceof DOMException && listError.name === "AbortError") {
          if (didTimeout && recordListRequestSeq.current === requestSeq) {
            setError("列表刷新超时，请稍后重试。");
          }
          return;
        }
        if (recordListRequestSeq.current === requestSeq) {
          setError(listError instanceof Error ? listError.message : "列表加载失败");
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (recordListRequestSeq.current === requestSeq) {
          setIsRecordListLoading(false);
        }
      });

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [activeObject, activeObjectUsesPool, effectiveView, props.fields, props.relations, query, recordCursor, recordListFields, recordPage, recordPool]);

  useEffect(() => {
    if (previousViewDraftResetKey.current === viewDraftResetKey) {
      return;
    }

    previousViewDraftResetKey.current = viewDraftResetKey;
    setViewDraft(createViewDraft(activeView, objectFields));
  }, [activeView, objectFields, viewDraftResetKey]);

  useEffect(() => {
    if (!selectedRecord?.id) {
      return undefined;
    }

    const controller = new AbortController();
    fetchJson<Activity[]>(`/api/activities?recordId=${encodeURIComponent(selectedRecord.id)}`, {
      method: "GET",
      signal: controller.signal
    })
      .then((result) => setActivities((current) => mergeActivities(current, result)))
      .catch((activityError) => {
        if (activityError instanceof DOMException && activityError.name === "AbortError") {
          return;
        }
        setError(activityError instanceof Error ? activityError.message : "活动加载失败");
      });

    return () => controller.abort();
  }, [selectedRecord?.id]);

  useEffect(() => {
    if (selectedRecord?.objectKey !== "companies" || !props.objects.some((object) => object.key === "contacts")) {
      return undefined;
    }

    const controller = new AbortController();
    const companyContactsView: SavedView = {
      ...emptySavedView("contacts"),
      filters: [{ field: "companyId", operator: "equals", value: selectedRecord.id }]
    };
    fetchJson<RecordListResult>(buildRecordListUrl("contacts", companyContactsView, "", 1, "/api/records/contacts", 200), {
      method: "GET",
      signal: controller.signal
    })
      .then((result) => {
        if (Array.isArray(result.records)) {
          setRecords((current) => mergeRecords(current, result.records));
        }
      })
      .catch((contactError) => {
        if (contactError instanceof DOMException && contactError.name === "AbortError") {
          return;
        }
        setError(contactError instanceof Error ? contactError.message : "公司联系人加载失败");
      });

    return () => controller.abort();
  }, [props.objects, selectedRecord?.id, selectedRecord?.objectKey]);

  useEffect(() => {
    if (activeNav !== "activities" && activeNav !== "tasks") {
      return undefined;
    }

    const controller = new AbortController();
    fetchJson<Activity[]>("/api/activities", {
      method: "GET",
      signal: controller.signal
    })
      .then((result) => setActivities((current) => mergeActivities(current, result)))
      .catch((activityError) => {
        if (activityError instanceof DOMException && activityError.name === "AbortError") {
          return;
        }
        setError(activityError instanceof Error ? activityError.message : "活动加载失败");
      });

    return () => controller.abort();
  }, [activeNav]);

  useEffect(() => {
    if (previousCreateFormResetKey.current === createFormResetKey) {
      return;
    }
    previousCreateFormResetKey.current = createFormResetKey;
    const pendingRecordCreate = pendingRecordCreateRef.current;
    if (pendingRecordCreate?.objectKey === activeObject?.key) {
      setCreateTitle("");
      setCreateOwnerId(props.contextUser.id);
      setCreateValues({ ...buildInitialValues(objectFields, activeObject?.key), ...pendingRecordCreate.values });
      setCreateFormObjectKey(activeObject?.key ?? "");
      setImportCsv(sampleCsvFor(activeObject?.key ?? "contacts", objectFields));
      setImportPreview(null);
      pendingRecordCreateRef.current = null;
      return;
    }
    setCreateTitle("");
    setCreateOwnerId(props.contextUser.id);
    setCreateValues({
      ...buildInitialValues(objectFields, activeObject?.key),
      ...(routeMode === "create" && activeObject?.key === "contacts" && routeCompanyId ? { companyId: routeCompanyId } : {})
    });
    setCreateFormObjectKey(activeObject?.key ?? "");
    setImportCsv(sampleCsvFor(activeObject?.key ?? "contacts", objectFields));
    setImportPreview(null);
  }, [activeObject?.key, createFormResetKey, objectFields, props.contextUser.id, routeCompanyId, routeMode]);

  useEffect(() => {
    if (!selectedRecord) {
      if (previousEditFormResetKey.current === "") {
        return;
      }
      previousEditFormResetKey.current = "";
      setEditTitle("");
      setEditOwnerId("");
      setEditValues({});
      setDealCloseReason("");
      setContactDetailActivityTab("all");
      setRecordActivityComposerType("");
      return;
    }

    if (previousEditFormResetKey.current === selectedRecordFormResetKey) {
      return;
    }
    previousEditFormResetKey.current = selectedRecordFormResetKey;
    setEditTitle(selectedRecord.title);
    setEditOwnerId(selectedRecord.ownerId ?? props.contextUser.id);
    setEditValues(buildRecordValues(selectedFields, selectedRecord));
    setDealCloseReason(String(selectedRecord.data.lostReason ?? selectedRecord.data.wonReason ?? ""));
    setContactDetailActivityTab("all");
    setRecordActivityComposerType("");
  }, [props.contextUser.id, selectedFields, selectedRecord, selectedRecordFormResetKey]);

  function navigateToWorkspace(navKey: NavKey, objectKey?: string) {
    const nextPath = crmPathForNav(navKey, objectKey);
    setActiveNav(navKey);
    if (pathname !== nextPath) {
      router.push(nextPath);
    }
  }

  function openObject(objectKey: string) {
    const nextNav = coreObjects.has(objectKey) ? (objectKey as NavKey) : "records";
    setActiveObjectKey(objectKey);
    navigateToWorkspace(nextNav, objectKey);
    setQuery("");
    setRecordPanelMode("closed");
    setRecordReturnEmailThreadId("");
    setShowListSettings(false);
    setMessage(null);
    setError(null);
  }

  function changeRecordPool(nextPool: RecordPool) {
    setRecordPool(nextPool);
    setRecordPage(1);
    setRecordCursorStack([""]);
    const nextParams = new URLSearchParams(searchParams.toString());
    if (nextPool === "all") {
      nextParams.delete("pool");
    } else {
      nextParams.set("pool", nextPool);
    }
    nextParams.delete("recordId");
    nextParams.delete("mode");
    const nextUrl = `${pathname}${nextParams.toString() ? `?${nextParams.toString()}` : ""}`;
    router.replace(nextUrl);
  }

  function changeDealWorkspaceView(nextView: DealWorkspaceView) {
    setDealWorkspaceView(nextView);
    const nextParams = new URLSearchParams(searchParams.toString());
    if (nextView === "pipeline") {
      nextParams.delete("view");
    } else {
      nextParams.set("view", nextView);
    }
    nextParams.delete("recordId");
    nextParams.delete("mode");
    const nextUrl = `${pathname}${nextParams.toString() ? `?${nextParams.toString()}` : ""}`;
    router.replace(nextUrl);
  }

  function openRecord(record: CrmRecord, options: { returnEmailThreadId?: string } = {}) {
    const nextNav = coreObjects.has(record.objectKey) ? (record.objectKey as NavKey) : "records";
    const nextPath = crmPathForNav(nextNav, record.objectKey);
    const detailParams = new URLSearchParams({ recordId: record.id });
    if (isPoolEnabledForObject(record.objectKey, props.poolSettings) && recordPool !== "all") {
      detailParams.set("pool", recordPool);
    }
    if (record.objectKey === "deals" && dealWorkspaceView !== "pipeline") {
      detailParams.set("view", dealWorkspaceView);
    }
    if (options.returnEmailThreadId) {
      detailParams.set("returnEmailThreadId", options.returnEmailThreadId);
    }
    const nextDetailPath = `${nextPath}?${detailParams.toString()}`;
    setRecords((current) => mergeRecords(current, [record]));
    setActiveObjectKey(record.objectKey);
    setActiveNav(nextNav);
    if (`${pathname}?${searchParams.toString()}` !== nextDetailPath) {
      pendingRecordOpenRef.current = {
        objectKey: record.objectKey,
        recordId: record.id,
        returnEmailThreadId: options.returnEmailThreadId ?? ""
      };
      router.push(nextDetailPath);
    } else {
      pendingRecordOpenRef.current = null;
    }
    setQuery("");
    setShowListSettings(false);
    setMessage(null);
    setError(null);
    setSelectedRecordId(record.id);
    setRecordReturnEmailThreadId(options.returnEmailThreadId ?? "");
    setRecordPanelMode("detail");
  }

  function openAutomationForRecord(record: CrmRecord, workflowId?: string) {
    const nextParams = new URLSearchParams({ objectKey: record.objectKey, recordId: record.id });
    if (workflowId) {
      nextParams.set("workflowId", workflowId);
    }
    setActiveNav("automation");
    router.push(`${crmPathForNav("automation")}?${nextParams.toString()}`);
  }

  async function openTalkSourceRecord(source: { objectKey: string; recordId: string }) {
    const existingRecord = records.find((record) => record.id === source.recordId && record.objectKey === source.objectKey);
    if (existingRecord) {
      openRecord(existingRecord);
      return;
    }
    const fetchedRecord = await fetchJson<CrmRecord>(`/api/records/${source.objectKey}/${source.recordId}`, { method: "GET" });
    openRecord(fetchedRecord);
  }

  async function openSmartReminderRecord(reminder: SmartReminder) {
    if (!reminder.objectKey || !reminder.recordId) {
      showToast({ intent: "info", message: "这条提醒没有绑定具体记录" });
      return;
    }
    await openTalkSourceRecord({ objectKey: reminder.objectKey, recordId: reminder.recordId });
  }

  function startCreateContactForCompany(company: CrmRecord) {
    const contactFields = props.fields.filter((field) => field.objectKey === "contacts").sort((left, right) => left.position - right.position);
    const nextPath = `${crmPathForNav("contacts")}?mode=create&companyId=${encodeURIComponent(company.id)}`;
    pendingRecordCreateRef.current = { objectKey: "contacts", values: { companyId: company.id } };
    setActiveObjectKey("contacts");
    setActiveNav("contacts");
    if (`${pathname}?${searchParams.toString()}` !== nextPath) {
      router.push(nextPath);
    }
    setSelectedRecordId("");
    setCreateTitle("");
    setCreateOwnerId(props.contextUser.id);
    setCreateValues({ ...buildInitialValues(contactFields, "contacts"), companyId: company.id });
    setRecordReturnEmailThreadId("");
    setRecordPanelMode("create");
  }

  async function closeRecordPanel() {
    if (recordReturnEmailThreadId) {
      const threadId = recordReturnEmailThreadId;
      setRecordReturnEmailThreadId("");
      await openEmailThread(threadId);
      return;
    }
    setRecordPanelMode("closed");
    if ((routeRecordId || routeMode === "create") && activeObject) {
      const listParams = new URLSearchParams();
      if (activeObjectUsesPool && recordPool !== "all") {
        listParams.set("pool", recordPool);
      }
      if (activeObject.key === "deals" && dealWorkspaceView !== "pipeline") {
        listParams.set("view", dealWorkspaceView);
      }
      const listPath = crmPathForNav(coreObjects.has(activeObject.key) ? activeObject.key : "records", activeObject.key);
      router.push(`${listPath}${listParams.toString() ? `?${listParams.toString()}` : ""}`);
    }
  }

  async function submitCreateRecord() {
    if (!activeObject) {
      return;
    }

    await postJson(`/api/records/${activeObject.key}`, {
      title: createTitle.trim(),
      stageKey: activeObject.key === "deals" ? activePipeline?.stages[0]?.key : undefined,
      ownerId: createOwnerId || undefined,
      data: parseFormValues(objectFields, createValues, activeObject.key, currencyRecords)
    });

    setMessage(`已创建${activeObject.label}`);
    setCreateTitle("");
    setCreateOwnerId(props.contextUser.id);
    setCreateValues(buildInitialValues(objectFields, activeObject.key));
    setRecordPanelMode("closed");
    router.refresh();
  }

  async function loadRecordForApprovalDecision(record: CrmRecord): Promise<CrmRecord> {
    if (!editApprovalObjectKeys.has(record.objectKey)) {
      return record;
    }
    return fetchJson<CrmRecord>(`/api/records/${record.objectKey}/${record.id}`, { method: "GET" });
  }

  async function submitRecordUpdatePatch(updatePatch: RecordApprovalPatch, successMessage = "记录已更新") {
    if (!selectedRecord) {
      return;
    }

    const approvalBaselineRecord = await loadRecordForApprovalDecision(selectedRecord);
    const needsApproval =
      editApprovalObjectKeys.has(selectedRecord.objectKey) &&
      hasRecordPatchChanges(splitRecordApprovalPatch(approvalBaselineRecord, updatePatch).approvalPatch);
    const changeReason = needsApproval
      ? await requestPrompt({
          title: "提交修改审批",
          message: `请填写修改“${selectedRecord.title}”的原因。管理员审核通过后才会正式应用。`,
          placeholder: "例如：客户更新了公司资料和主要联系方式"
        })
      : "";
    if (needsApproval && !changeReason?.trim()) {
      setMessage("已取消修改审批");
      return;
    }

    let result = await fetchJson<CrmRecord | RecordChangeRequestResponse | RecordApprovalReasonRequiredResponse>(`/api/records/${selectedRecord.objectKey}/${selectedRecord.id}`, {
      method: "PATCH",
      body: {
        ...updatePatch,
        changeReason: changeReason?.trim() || undefined
      }
    });
    if ("approvalReasonRequired" in result) {
      const fallbackReason = await requestPrompt({
        title: "提交修改审批",
        message: `请填写修改“${selectedRecord.title}”的原因。管理员审核通过后才会正式应用。`,
        placeholder: "例如：客户更新了公司资料和主要联系方式"
      });
      if (!fallbackReason?.trim()) {
        setMessage("已取消修改审批");
        return;
      }
      result = await fetchJson<CrmRecord | RecordChangeRequestResponse>(`/api/records/${selectedRecord.objectKey}/${selectedRecord.id}`, {
        method: "PATCH",
        body: {
          ...updatePatch,
          changeReason: fallbackReason.trim()
        }
      });
    }
    if ("pendingApproval" in result) {
      setRecordChangeRequests((current) => mergeRecordChangeRequests(current, [result.request]));
      if (result.record) {
        setRecords((current) => mergeRecords(current, [result.record]));
        if (selectedRecord.id === result.record.id) {
          setEditValues(buildRecordValues(selectedFields, result.record));
        }
      }
      showSuccess("修改申请已提交，等待管理员审核");
      router.refresh();
      return;
    }

    setRecords((current) => mergeRecords(current, [result]));
    setEditValues(buildRecordValues(selectedFields, result));
    setEditTitle(result.title);
    setEditOwnerId(result.ownerId ?? "");
    setMessage(successMessage);
    router.refresh();
  }

  async function submitUpdateRecord() {
    if (!selectedRecord) {
      return;
    }

    const updatePatch: RecordApprovalPatch = {
      title: editTitle.trim(),
      data: parseFormValues(selectedFields, editValues, selectedRecord.objectKey, currencyRecords),
      stageKey: selectedRecord.objectKey === "deals" ? String(editValues.__stageKey ?? selectedRecord.stageKey ?? "") : undefined,
      ownerId: editOwnerId || undefined
    };
    await submitRecordUpdatePatch(updatePatch);
    if (selectedRecord.objectKey === "contacts") {
      setContactMethodEditingId("");
      setContactMethodEditingRecordId("");
      setContactMethodEditingValue("");
    }
    if (selectedRecord.objectKey === "companies") {
      setCompanyAddressEditing(null);
    }
  }

  async function submitSingleRecordField(field: FieldDefinition, nextValue: string) {
    if (!selectedRecord) {
      return;
    }
    setMessage(null);
    setError(null);
    setIsRecordSavePending(true);
    try {
      await submitRecordUpdatePatch(
        {
          data: {
            [field.key]: parseSingleFieldValue(field, nextValue)
          }
        },
        `${field.label}已更新`
      );
    } catch (actionError) {
      showError(actionError instanceof Error ? actionError.message : "保存失败");
      throw actionError;
    } finally {
      setIsRecordSavePending(false);
    }
  }

  async function submitSingleRecordOwner(nextOwnerId: string) {
    if (!selectedRecord) {
      return;
    }
    setMessage(null);
    setError(null);
    setIsRecordSavePending(true);
    try {
      await submitRecordUpdatePatch({ ownerId: nextOwnerId || undefined }, "负责人已更新");
    } catch (actionError) {
      showError(actionError instanceof Error ? actionError.message : "保存失败");
      throw actionError;
    } finally {
      setIsRecordSavePending(false);
    }
  }

  async function applyRecordPoolAction(action: "claim" | "release", record: CrmRecord) {
    const result = await fetchJson<RecordPoolActionResult>(`/api/records/${record.objectKey}/${record.id}/${action}`, {
      method: "POST"
    });
    mergeLoadedRecords([result.record]);
    setRecordList((current) => ({
      ...current,
      records: current.records.map((candidate) => (candidate.id === result.record.id ? result.record : candidate))
    }));
    setEditOwnerId(result.record.ownerId ?? "");
    showSuccess(action === "claim" ? "已领取到我的私海" : "已释放到公海");
  }

  async function transferRecordOwner(record: CrmRecord, ownerId: string) {
    const result = await fetchJson<RecordPoolActionResult>(`/api/records/${record.objectKey}/${record.id}/transfer`, {
      method: "POST",
      body: { ownerId: ownerId || null }
    });
    mergeLoadedRecords([result.record]);
    setRecordList((current) => ({
      ...current,
      records: current.records.map((candidate) => (candidate.id === result.record.id ? result.record : candidate))
    }));
    setEditOwnerId(result.record.ownerId ?? "");
    showSuccess(result.record.ownerId ? "负责人已转移" : "已释放到公海");
  }

  function startContactMethodEditor(record: CrmRecord, methodId: string, methods?: ContactMethodDraft[]) {
    setContactMethodEditingId(methodId);
    setContactMethodEditingRecordId(record.id);
    setContactMethodEditingValue(JSON.stringify(methods ?? contactMethodsFromRecordData(record)));
  }

  function toggleQuickContactMethodEditor(method: ContactMethodDraft) {
    if (!selectedRecord) {
      return;
    }

    const targetRecordId = method.sourceRecordId || selectedRecord.id;
    if (contactMethodEditingId === method.id && contactMethodEditingRecordId === targetRecordId) {
      closeContactMethodEditor();
      return;
    }

    const targetRecord = records.find((record) => record.id === targetRecordId) ?? selectedRecord;
    startContactMethodEditor(targetRecord, method.id);
  }

  function startNewContactMethodEditor(record: CrmRecord, type: ContactMethodType = "email") {
    const method = emptyContactMethod(type, contactMethodsFromRecordData(record).length === 0);
    startContactMethodEditor(record, method.id, [...contactMethodsFromRecordData(record), method]);
  }

  function closeContactMethodEditor() {
    setContactMethodEditingId("");
    setContactMethodEditingRecordId("");
    setContactMethodEditingValue("");
  }

  async function saveContactMethodEditor() {
    const targetRecord = records.find((record) => record.id === contactMethodEditingRecordId);
    if (!targetRecord) {
      closeContactMethodEditor();
      return;
    }

    const methods = contactMethodsFromValues({ [contactMethodsValueKey]: contactMethodEditingValue });
    const previousMethods = contactMethodsFromRecordData(targetRecord);
    const primaryEmail = methods.find((method) => method.type === "email" && method.primary)?.value || methods.find((method) => method.type === "email")?.value || "";
    const primaryPhone =
      methods.find((method) => (method.type === "tel" || method.type === "mob") && method.primary)?.value ||
      methods.find((method) => method.type === "tel" || method.type === "mob")?.value ||
      "";
    const hadEmailMethod = previousMethods.some((method) => method.type === "email");
    const hasEmailMethod = methods.some((method) => method.type === "email");
    const hadPhoneMethod = previousMethods.some((method) => method.type === "tel" || method.type === "mob");
    const hasPhoneMethod = methods.some((method) => method.type === "tel" || method.type === "mob");
    const contactMethodData: Record<string, unknown> = {
      contactMethods: methods
    };
    if (hasEmailMethod || hadEmailMethod) {
      contactMethodData.email = primaryEmail;
    }
    if (hasPhoneMethod || hadPhoneMethod) {
      contactMethodData.phone = primaryPhone;
    }
    const contactMethodPatch: RecordApprovalPatch = {
      data: contactMethodData
    };
    const approvalBaselineRecord = await loadRecordForApprovalDecision(targetRecord);
    const needsApproval =
      targetRecord.objectKey === "contacts" &&
      hasRecordPatchChanges(splitRecordApprovalPatch(approvalBaselineRecord, contactMethodPatch).approvalPatch);
    const changeReason = needsApproval
      ? await requestPrompt({
          title: "提交联系方式修改审批",
          message: `请填写修改“${targetRecord.title}”联系方式的原因。管理员审核通过后才会正式应用。`,
          placeholder: "例如：客户确认了新的主邮箱"
        })
      : "";
    if (needsApproval && !changeReason?.trim()) {
      setMessage("已取消联系方式修改");
      return;
    }

    let result = await fetchJson<CrmRecord | RecordChangeRequestResponse | RecordApprovalReasonRequiredResponse>(`/api/records/${targetRecord.objectKey}/${targetRecord.id}`, {
      method: "PATCH",
      body: {
        ...contactMethodPatch,
        changeReason: changeReason?.trim() || undefined
      }
    });
    if ("approvalReasonRequired" in result) {
      const fallbackReason = await requestPrompt({
        title: "提交联系方式修改审批",
        message: `请填写修改“${targetRecord.title}”联系方式的原因。管理员审核通过后才会正式应用。`,
        placeholder: "例如：客户确认了新的主邮箱"
      });
      if (!fallbackReason?.trim()) {
        setMessage("已取消联系方式修改");
        return;
      }
      result = await fetchJson<CrmRecord | RecordChangeRequestResponse>(`/api/records/${targetRecord.objectKey}/${targetRecord.id}`, {
        method: "PATCH",
        body: {
          ...contactMethodPatch,
          changeReason: fallbackReason.trim()
        }
      });
    }
    if ("pendingApproval" in result) {
      if (result.record) {
        setRecords((current) => mergeRecords(current, [result.record]));
        if (selectedRecord?.id === result.record.id) {
          setEditValues(buildRecordValues(selectedFields, result.record));
        }
      }
      closeContactMethodEditor();
      setMessage("联系方式修改申请已提交，等待管理员审核");
      router.refresh();
      return;
    }

    setRecords((current) => mergeRecords(current, [result]));
    if (selectedRecord?.id === result.id) {
      setEditValues(buildRecordValues(selectedFields, result));
    }
    closeContactMethodEditor();
    setMessage("联系方式已更新");
    router.refresh();
  }

  async function submitDeleteRecord() {
    if (!selectedRecord) {
      return;
    }
    const changeReason = deleteApprovalObjectKeys.has(selectedRecord.objectKey)
      ? await requestPrompt({
          title: "提交删除审批",
          message: `请填写删除“${selectedRecord.title}”的原因。管理员审核通过后才会正式删除。`,
          placeholder: "例如：重复记录，已合并到正确客户"
        })
      : "";
    if (deleteApprovalObjectKeys.has(selectedRecord.objectKey) && !changeReason?.trim()) {
      setMessage("已取消删除审批");
      return;
    }

    const result = await fetchJson<{ ok: true } | RecordChangeRequestResponse>(`/api/records/${selectedRecord.objectKey}/${selectedRecord.id}`, {
      method: "DELETE",
      body: { changeReason: changeReason?.trim() || undefined }
    });
    if ("pendingApproval" in result) {
      setRecordChangeRequests((current) => mergeRecordChangeRequests(current, [result.request]));
      setMessage("删除申请已提交，等待管理员审核");
      return;
    }
    setMessage("记录已删除");
    setRecordPanelMode("closed");
    router.refresh();
  }

  async function cancelRecordChangeRequest(request: RecordChangeRequest) {
    const confirmed = await requestConfirm({
      title: "取消删除申请",
      message: `确定取消删除“${request.recordTitle}”的申请？取消后可继续编辑该记录。`,
      confirmLabel: "取消申请"
    });
    if (!confirmed) {
      return;
    }

    const updated = await fetchJson<RecordChangeRequest>(`/api/record-change-requests/${request.id}`, {
      method: "DELETE"
    });
    setRecordChangeRequests((current) => mergeRecordChangeRequests(current, [updated]).filter((candidate) => candidate.status === "pending"));
    setMessage("删除申请已取消");
    router.refresh();
  }

  async function createRecordActivity(input: {
    recordId: string;
    type: Activity["type"];
    title: string;
    body?: string;
    dueAt?: string;
  }) {
    const created = await fetchJson<Activity>("/api/activities", {
      method: "POST",
      body: input
    });
    setActivities((current) => mergeActivities(current, [created]));
    return created;
  }

  async function submitImportPreview() {
    if (!activeObject) {
      return;
    }

    const preview = await fetchJson<CsvImportPreview>("/api/imports/csv/preview", {
      method: "POST",
      body: {
        objectKey: activeObject.key,
        csv: importCsv,
        mapping: cleanImportMapping(importMapping)
      }
    });

    setImportPreview(preview);
    setMessage(`CSV 预检完成，可导入 ${preview.creatableRows}/${preview.totalRows} 行`);
  }

  async function submitImport() {
    if (!activeObject) {
      return;
    }
    if (
      importStrategy === "update-existing" &&
      importPreview?.conflictRows &&
      !(await requestConfirm({
        title: "确认更新已有记录",
        message: `本次导入会更新 ${importPreview.conflictRows} 条已有记录。请确认这些冲突行已经检查无误。`,
        confirmLabel: "继续导入",
        danger: true
      }))
    ) {
      setMessage("已取消导入");
      return;
    }

    const job = await fetchJson<CsvImportJob>("/api/imports/jobs", {
      method: "POST",
      body: {
        objectKey: activeObject.key,
        csv: importCsv,
        strategy: importStrategy,
        mapping: cleanImportMapping(importMapping),
        ...(selectedImportPresetId ? { presetId: selectedImportPresetId, presetName: activeImportPresets.find((preset) => preset.id === selectedImportPresetId)?.name } : {})
      }
    });

    setImportJobs((current) => [job, ...current.filter((candidate) => candidate.id !== job.id)].slice(0, 50));
    setMessage(
      job.status === "failed"
        ? `导入任务失败：${job.errorMessage ?? "未知错误"}`
        : `导入任务${formatImportJobStatus(job.status)}：已创建 ${job.createdCount} 条，已更新 ${job.result?.updated?.length ?? 0} 条，失败 ${job.errorCount} 条`
    );
    setError(job.result?.errors[0] ?? job.errorMessage ?? null);
    setImportPreview(null);
    router.refresh();
  }

  async function saveOrUpdateImportPreset() {
    if (!activeObject) {
      return;
    }
    const selectedPreset = activeImportPresets.find((candidate) => candidate.id === selectedImportPresetId);
    const name = importPresetName.trim();
    if (!name && !selectedPreset) {
      setError("请输入导入预设名称");
      return;
    }
    const body = {
      name: name || selectedPreset?.name,
      strategy: importStrategy,
      mapping: cleanImportMapping(importMapping)
    };

    const preset = selectedPreset
      ? await fetchJson<ImportPreset>(`/api/imports/presets/${selectedPreset.id}`, {
          method: "PATCH",
          body
        })
      : await fetchJson<ImportPreset>("/api/imports/presets", {
          method: "POST",
          body: {
            objectKey: activeObject.key,
            ...body
          }
        });

    setImportPresets((current) => [preset, ...current.filter((candidate) => candidate.id !== preset.id)]);
    setSelectedImportPresetId(preset.id);
    setImportPresetName("");
    setMessage(`${selectedPreset ? "已覆盖" : "已保存"}导入预设：${preset.name}`);
    router.refresh();
  }

  function applyImportPreset() {
    const preset = activeImportPresets.find((candidate) => candidate.id === selectedImportPresetId);
    if (!preset) {
      setError("请选择一个导入预设");
      return;
    }

    setImportStrategy(preset.strategy);
    setImportMapping(preset.mapping ?? {});
    setImportPreview(null);
    setMessage(`已应用导入预设：${preset.name}`);
  }

  async function deleteImportPreset() {
    const preset = activeImportPresets.find((candidate) => candidate.id === selectedImportPresetId);
    if (!preset) {
      setError("请选择一个导入预设");
      return;
    }
    if (
      !(await requestConfirm({
        title: "删除导入预设",
        message: `删除导入预设“${preset.name}”？`,
        confirmLabel: "删除",
        danger: true
      }))
    ) {
      return;
    }

    await fetchJson(`/api/imports/presets/${preset.id}`, { method: "DELETE" });
    setImportPresets((current) => current.filter((candidate) => candidate.id !== preset.id));
    setSelectedImportPresetId("");
    setMessage(`已删除导入预设：${preset.name}`);
    router.refresh();
  }

  async function loadImportJobDetails(job: CsvImportJob) {
    const details = await fetchJson<CsvImportJob>(`/api/imports/jobs/${job.id}`, { method: "GET" });
    setSelectedImportJob(details);
    setSelectedImportJobId(details.id);
    setImportJobs((current) => [details, ...current.filter((candidate) => candidate.id !== details.id)].slice(0, 50));
  }

  async function submitImportJobAction(job: CsvImportJob, action: "cancel" | "retry" | "rerun") {
    const updated = await fetchJson<CsvImportJob>(`/api/imports/jobs/${job.id}`, {
      method: "PATCH",
      body: { action }
    });

    setImportJobs((current) => [updated, ...current.filter((candidate) => candidate.id !== updated.id)].slice(0, 50));
    if (selectedImportJobId === job.id || selectedImportJobId === updated.id) {
      setSelectedImportJob(updated);
      setSelectedImportJobId(updated.id);
    }
    setMessage(
      action === "cancel"
        ? "导入任务已取消"
        : updated.status === "failed"
          ? `导入任务失败：${updated.errorMessage ?? "未知错误"}`
          : `导入任务${formatImportJobStatus(updated.status)}：已创建 ${updated.createdCount} 条，已更新 ${updated.result?.updated?.length ?? 0} 条，失败 ${updated.errorCount} 条`
    );
    setError(updated.result?.errors[0] ?? updated.errorMessage ?? null);
    router.refresh();
  }

  async function submitCreateSavedView() {
    if (!activeObject) {
      return;
    }

    const created = await fetchJson<SavedView>("/api/saved-views", {
      method: "POST",
      body: buildSavedViewPayload(activeObject.key, viewDraft)
    });

    setSelectedViewId(created.id);
    setMessage(`已保存视图 ${created.name}`);
    router.refresh();
  }

  async function submitUpdateSavedView() {
    if (!activeView || !activeObject) {
      return;
    }

    const updated = await fetchJson<SavedView>(`/api/saved-views/${activeView.id}`, {
      method: "PATCH",
      body: buildSavedViewPayload(activeObject.key, viewDraft)
    });

    setSelectedViewId(updated.id);
    setMessage(`已覆盖视图 ${updated.name}`);
    router.refresh();
  }

  async function submitDeleteSavedView() {
    if (!activeView) {
      return;
    }
    if (
      !(await requestConfirm({
        title: "删除视图",
        message: `确定删除视图“${activeView.name}”？`,
        confirmLabel: "删除",
        danger: true
      }))
    ) {
      return;
    }

    await fetchJson(`/api/saved-views/${activeView.id}`, { method: "DELETE" });
    setSelectedViewId("");
    setMessage("视图已删除");
    router.refresh();
  }

  async function moveDealStage(record: CrmRecord, stageKey: string, pipelineOrder?: number, options: { refresh?: boolean } = {}) {
    const shouldRefresh = options.refresh ?? true;
    const optimisticRecord: CrmRecord = {
      ...record,
      stageKey,
      data: {
        ...record.data,
        ...(typeof pipelineOrder === "number" ? { pipelineOrder } : {})
      }
    };
    const mergeRecordIntoCurrentList = (nextRecord: CrmRecord) => {
      setRecordList((current) =>
        current.records.some((candidate) => candidate.id === nextRecord.id)
          ? { ...current, records: mergeRecords(current.records, [nextRecord]) }
          : current
      );
    };
    setRecords((current) => mergeRecords(current, [optimisticRecord]));
    mergeRecordIntoCurrentList(optimisticRecord);
    try {
      const updated = await fetchJson<CrmRecord>(`/api/records/${record.objectKey}/${record.id}/stage`, {
        method: "PATCH",
        body: { stageKey, ...(typeof pipelineOrder === "number" ? { pipelineOrder } : {}) }
      });
      setRecords((current) => mergeRecords(current, [updated]));
      mergeRecordIntoCurrentList(updated);
      setMessage(record.stageKey === stageKey ? "交易顺序已更新" : "交易阶段已更新");
      if (shouldRefresh) {
        router.refresh();
      }
    } catch (moveError) {
      setRecords((current) => mergeRecords(current, [record]));
      mergeRecordIntoCurrentList(record);
      throw moveError;
    }
  }

  function openPipelineDealActivityDialog(deal: CrmRecord) {
    setPipelineActivityDeal(deal);
    setPipelineActivityType("note");
  }

  async function submitPipelineDealActivity(input: RecordActivityComposerInput) {
    if (!pipelineActivityDeal) {
      return;
    }
    await createRecordActivity({
      recordId: pipelineActivityDeal.id,
      ...input
    });
    setPipelineActivityDeal(null);
    showSuccess("交易活动已创建");
    router.refresh();
  }

  async function toggleTaskCompletion(activity: Activity, completed: boolean) {
    const updated = await fetchJson<Activity>(`/api/activities/${activity.id}`, {
      method: "PATCH",
      body: { completedAt: completed ? new Date().toISOString() : null }
    });
    setActivities((current) => mergeActivities(current, [updated]));
    setMessage(completed ? "任务已完成" : "任务已重开");
    router.refresh();
  }

  async function toggleTaskArchive(activity: Activity, archived: boolean) {
    const updated = await fetchJson<Activity>(`/api/activities/${activity.id}`, {
      method: "PATCH",
      body: { archivedAt: archived ? new Date().toISOString() : null }
    });
    setActivities((current) => mergeActivities(current, [updated]));
    setMessage(archived ? "任务已归档" : "任务已移回列表");
    router.refresh();
  }

  async function deleteTask(activity: Activity) {
    const existingRequest = pendingActivityDeleteRequestsById.get(activity.id);
    if (existingRequest) {
      await cancelRecordChangeRequest(existingRequest);
      return;
    }
    const activityTypeLabel = formatActivityType(activity.type);
    const changeReason = await requestPrompt({
      title: `提交${activityTypeLabel}删除审批`,
      message: `请填写删除“${activity.title}”的原因。管理员审核通过后才会正式删除。`,
      placeholder: "例如：重复记录，内容录入错误"
    });
    if (!changeReason?.trim()) {
      setMessage("已取消删除审批");
      return;
    }
    if (
      !(await requestConfirm({
        title: "提交删除审批",
        message: `确定提交删除“${activity.title}”的审批申请？`,
        confirmLabel: "提交申请",
        danger: true
      }))
    ) {
      return;
    }
    const result = await fetchJson<RecordChangeRequestResponse>(`/api/activities/${activity.id}`, {
      method: "DELETE",
      body: { changeReason: changeReason.trim() }
    });
    setRecordChangeRequests((current) => mergeRecordChangeRequests(current, [result.request]));
    showSuccess("删除申请已提交，等待管理员审核");
    router.refresh();
  }

  async function updateTask(activity: Activity, draft: TaskEditDraft) {
    const updated = await fetchJson<Activity>(`/api/activities/${activity.id}`, {
      method: "PATCH",
      body: {
        title: draft.title,
        body: serializeTaskDetails({ text: draft.text, attachments: draft.attachments }),
        dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null
      }
    });
    setActivities((current) => mergeActivities(current, [updated]));
    showSuccess(`任务已更新：${updated.title}`);
    router.refresh();
  }

  async function createTaskFromCalendar(input: TaskCreateInput) {
    const created = await fetchJson<Activity>("/api/activities", {
      method: "POST",
      body: {
        type: "task",
        title: input.title,
        dueAt: input.dueAt || undefined
      }
    });
    setActivities((current) => mergeActivities(current, [created]));
    showSuccess(`已创建任务：${created.title}`);
    router.refresh();
  }

  async function requestStandaloneTaskCreate() {
    const title = await requestPrompt({
      title: "新建任务",
      message: "创建一个未排期任务，之后可在任务详情或日历中补充截止时间。",
      placeholder: "输入任务标题",
      confirmLabel: "创建任务"
    });
    const trimmedTitle = title?.trim();
    if (!trimmedTitle) {
      return;
    }
    await createTaskFromCalendar({ title: trimmedTitle });
  }

  async function requestStandaloneActivityCreate() {
    const title = await requestPrompt({
      title: "新建活动",
      message: "创建一条通用活动记录，可在后续关联到联系人、公司或交易。",
      placeholder: "输入活动标题",
      confirmLabel: "创建活动"
    });
    const trimmedTitle = title?.trim();
    if (!trimmedTitle) {
      return;
    }
    const created = await fetchJson<Activity>("/api/activities", {
      method: "POST",
      body: {
        type: "note",
        title: trimmedTitle
      }
    });
    setActivities((current) => mergeActivities(current, [created]));
    showSuccess(`已创建活动：${created.title}`);
    router.refresh();
  }

  function exportStandaloneActivitiesCsv(kind: StandaloneModuleKey) {
    const sourceActivities = kind === "tasks" ? filteredTaskActivities : filteredActivities;
    const csv = buildActivitiesCsv(sourceActivities, records, props.users);
    downloadTextFile(`${kind}-export.csv`, csv, "text/csv;charset=utf-8");
    setModuleActionsOpen(false);
    showSuccess(`已导出${kind === "tasks" ? "任务" : "活动"} CSV`);
  }

  function showStandaloneImportNotice(kind: StandaloneModuleKey) {
    setModuleActionsOpen(false);
    showToast({
      intent: "info",
      message: `${kind === "tasks" ? "任务" : "活动"}导入将使用专用字段映射流程，当前版本请先通过对应记录详情添加。`
    });
  }

  async function closeDeal(record: CrmRecord, outcome: "won" | "lost") {
    if (
      outcome === "lost" &&
      !(await requestConfirm({
        title: "标记输单",
        message: `确定将交易“${record.title}”标记为输单？`,
        confirmLabel: "确认输单",
        danger: true
      }))
    ) {
      return;
    }

    const reasonKey = outcome === "won" ? "wonReason" : "lostReason";
    await fetchJson(`/api/records/${record.objectKey}/${record.id}`, {
      method: "PATCH",
      body: {
        stageKey: outcome,
        data: {
          dealStatus: outcome,
          closedAt: new Date().toISOString(),
          [reasonKey]: dealCloseReason.trim() || undefined
        }
      }
    });
    setMessage(outcome === "won" ? "交易已标记为赢单" : "交易已标记为输单");
    router.refresh();
  }

  async function createEmailAccount() {
    const account = await fetchJson<EmailAccount>("/api/email/accounts", {
      method: "POST",
      body: {
        name: emailAccountDraft.name,
        emailAddress: emailAccountDraft.emailAddress,
        provider: emailAccountDraft.provider,
        syncEnabled: emailAccountDraft.syncEnabled,
        sendEnabled: emailAccountDraft.sendEnabled,
        status: "active"
        ,
        connectionConfig: buildEmailConnectionConfig(emailAccountDraft)
      }
    });
    setEmailAccounts((current) => [account, ...current.filter((candidate) => candidate.id !== account.id)]);
    setEmailDraft((current) => clearEmailDraftAiProvenance({ ...current, accountId: account.id }));
    setEmailAccountDraft(createEmptyEmailAccountDraft());
    setMessage(`已创建邮箱账户：${account.emailAddress}`);
  }

  async function syncEmailAccount(accountId: string) {
    const result = await fetchJson<{ account: EmailAccount; importedCount: number; scannedCount?: number; skippedDuplicateCount?: number; hasMore?: boolean; status: string; error?: string }>("/api/email/sync", {
      method: "POST",
      body: { accountId }
    });
    setEmailAccounts((current) => [result.account, ...current.filter((candidate) => candidate.id !== result.account.id)]);
    if (result.status === "failed") {
      setError(result.error ?? result.account.lastConnectionError ?? "邮箱同步失败");
      setMessage(`邮箱同步失败：${result.account.emailAddress}`);
      return;
    }
    await refreshEmailThreads({ reloadSelectedMessages: true });
    setMessage(`邮箱同步完成：扫描 ${result.scannedCount ?? result.importedCount} 封，新增 ${result.importedCount} 封，跳过重复 ${result.skippedDuplicateCount ?? 0} 封${result.hasMore ? "，仍有更多历史邮件" : ""}`);
    router.refresh();
  }

  async function syncAllEmailAccounts() {
    const result = await fetchJson<EmailSyncAllRun>("/api/email/sync-all", { method: "POST" });
    const failed = result.accounts.filter((account) => account.status === "failed");
    if (failed.length) {
      setError(`邮箱批量同步完成，但 ${failed.length} 个账号失败：${failed.map((account) => account.emailAddress).join(", ")}`);
    }
    await refreshEmailThreads({ reloadSelectedMessages: true });
    setMessage(`邮箱批量同步完成：已调度 ${result.scheduledCount} 个，跳过 ${result.skippedCount} 个，失败 ${failed.length} 个`);
    router.refresh();
  }

  async function testEmailConnection(accountId: string, options: { scope?: EmailConnectionTestScope; outboundServiceId?: string } = {}) {
    const result = await fetchJson<{ account: EmailAccount; result: { smtp?: "ok" | "skipped"; imap?: "ok" | "skipped"; pop3?: "ok" | "skipped"; resend?: "ok" | "skipped"; oauth?: "ok" | "skipped"; oauthAccountEmail?: string } }>("/api/email/test-connection", {
      method: "POST",
      body: { accountId, ...options }
    });
    setEmailAccounts((current) => [result.account, ...current.filter((candidate) => candidate.id !== result.account.id)]);
    const scopeLabel = options.scope === "inbound" ? "收件连接" : options.scope === "outbound" ? "发件服务" : "邮箱连接";
    setMessage(`${scopeLabel}测试完成：SMTP ${result.result.smtp ?? "skipped"}，Resend ${result.result.resend ?? "skipped"}，IMAP ${result.result.imap ?? "skipped"}，POP3 ${result.result.pop3 ?? "skipped"}，OAuth ${result.result.oauth ?? "skipped"}${result.result.oauthAccountEmail ? `（${result.result.oauthAccountEmail}）` : ""}`);
  }

  async function testAllEmailConnections() {
    const result = await fetchJson<EmailConnectionTestRun>("/api/email/test-connections", { method: "POST" });
    setEmailConnectionTestRun(result);
    setEmailAccounts((current) => mergeEmailAccounts(current, result.results.map((entry) => entry.account)));
    setMessage(`邮箱连接批量测试完成：成功 ${result.succeeded}，失败 ${result.failed}，跳过 ${result.skipped}`);
  }

  async function updateEmailAccount(accountId: string, patch: EmailAccountUpdatePatch) {
    const account = await fetchJson<EmailAccount>(`/api/email/accounts/${accountId}`, {
      method: "PATCH",
      body: patch
    });
    setEmailAccounts((current) => [account, ...current.filter((candidate) => candidate.id !== account.id)]);
    setMessage(`邮箱账户已更新：${account.emailAddress}`);
    router.refresh();
  }

  async function updateEmailAccountFromDraft() {
    if (!emailAccountDraft.editingAccountId) {
      return;
    }
    const connectionConfig = buildEmailConnectionConfig(emailAccountDraft);
    await updateEmailAccount(emailAccountDraft.editingAccountId, {
      name: emailAccountDraft.name,
      emailAddress: emailAccountDraft.emailAddress,
      provider: emailAccountDraft.provider,
      syncEnabled: emailAccountDraft.syncEnabled,
      sendEnabled: emailAccountDraft.sendEnabled,
      ...(connectionConfig ? { connectionConfig } : {})
    });
    setEmailAccountDraft(createEmptyEmailAccountDraft());
  }

  async function editEmailAccount(account: EmailAccount) {
    setEmailAccountDraft(createEmailAccountEditDraft(account));
    if (!account.connectionConfigured) {
      return;
    }
    try {
      const config = await fetchJson<SanitizedEmailConnectionConfig>(`/api/email/accounts/${account.id}/connection-config`, { method: "GET" });
      setEmailAccountDraft(createEmailAccountEditDraft(account, config));
    } catch (configError) {
      showError(configError instanceof Error ? configError.message : "邮箱连接配置加载失败");
    }
  }

  async function startEmailOAuth() {
    const result = await fetchJson<{ authorizationUrl: string }>("/api/email/oauth/start", {
      method: "POST",
      body: {
        provider: emailAccountDraft.provider,
        emailAddress: emailAccountDraft.emailAddress,
        name: emailAccountDraft.name || `${emailAccountDraft.provider} mailbox`,
        syncEnabled: emailAccountDraft.syncEnabled,
        sendEnabled: emailAccountDraft.sendEnabled
      }
    });
    window.location.assign(result.authorizationUrl);
  }

  async function loadEmailMessages(threadId: string) {
    const messages = await fetchJson<EmailMessage[]>(`/api/email/threads/${threadId}/messages`, { method: "GET" });
    setEmailMessagesByThread((current) => ({ ...current, [threadId]: messages }));
  }

  async function refreshEmailThreadsByIds(threadIds: string[]): Promise<EmailThread[]> {
    const uniqueThreadIds = Array.from(new Set(threadIds.filter(Boolean)));
    if (!uniqueThreadIds.length) {
      return [];
    }
    const fetchedThreads = await Promise.all(
      uniqueThreadIds.map((threadId) => fetchJson<EmailThread>(`/api/email/threads/${threadId}`, { method: "GET" }))
    );
    setEmailThreads((current) => mergeEmailThreads(current, fetchedThreads));
    return fetchedThreads;
  }

  async function openEmailThread(threadId: string) {
    const nextEmailThreadPath = buildEmailRoutePath({ mailbox: routeEmailMailbox, category: routeEmailCategory, accountId: routeEmailAccountId, label: routeEmailLabel, search: routeEmailSearch, mailMode: "detail", threadId });
    selectEmailThread(threadId);
    setEmailDetailThreadId(threadId);
    setEmailWorkspaceView("mail");
    setActiveNav("email");
    if (`${pathname}?${searchParams.toString()}` !== nextEmailThreadPath) {
      router.push(nextEmailThreadPath);
    }
    if (!emailMessagesByThread[threadId]) {
      await loadEmailMessages(threadId);
    }
  }

  function composeEmailForRecord(record: CrmRecord, emailAddress: string) {
    const requestKey = `record:${record.id}:${Date.now()}`;
    const composeParams = new URLSearchParams({
      compose: "1",
      composeRecordId: record.id,
      to: emailAddress,
      composeKey: requestKey
    });
    setRecords((current) => mergeRecords(current, [record]));
    setSelectedRecordId(record.id);
    setSelectedEmailThreadId("");
    setEmailDetailThreadId("");
    setEmailAiResult(null);
    setEmailComposeOpenRequestKey("");
    setEmailDraft((current) =>
      clearEmailDraftAiProvenance({
        ...current,
        accountId: current.accountId || emailAccounts.find(canSelectEmailAccountForSending)?.id || "",
        recordId: record.id,
        to: emailAddress,
        cc: "",
        bcc: "",
        subject: "",
        threadId: undefined,
        bodyText: "",
        bodyHtml: "",
        attachments: []
      })
    );
    setEmailWorkspaceView("mail");
    setActiveNav("email");
    router.push(`${crmPathForNav("email")}?${composeParams.toString()}`);
    window.setTimeout(() => setEmailComposeOpenRequestKey(requestKey), 0);
  }

  function closeEmailComposeRequest() {
    setEmailComposeOpenRequestKey("");
    if (!routeEmailCompose) {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete("compose");
    params.delete("composeRecordId");
    params.delete("to");
    params.delete("composeKey");
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${crmPathForNav("email")}?${nextQuery}` : crmPathForNav("email"));
  }

  function openContactFollowUp(record: CrmRecord, method: ContactMethodDraft, channel: ContactFollowUpDraft["channel"]) {
    setContactFollowUpDraft({
      channel,
      method,
      recordId: record.id,
      recordTitle: record.title,
      message: "",
      attachments: []
    });
  }

  async function generateContactFollowUpMessage() {
    if (!contactFollowUpDraft) {
      return;
    }
    const record = records.find((candidate) => candidate.id === contactFollowUpDraft.recordId) ?? selectedRecord;
    if (!record) {
      showError("未找到关联记录，无法生成跟进内容");
      return;
    }
    setIsContactFollowUpGenerating(true);
    try {
      const result = await fetchJson<EmailAiGenerateResult>("/api/email/ai-generate", {
        method: "POST",
        body: {
          purpose: "draft",
          recordId: record.id,
          userPrompt: [
            contactFollowUpDraft.channel === "whatsapp"
              ? "Generate one concise WhatsApp opening or follow-up message for sales outreach."
              : "Generate one concise phone follow-up plan for a sales call.",
            "Use CRM overview, next-step suggestion, recent activities, and customer background when available.",
            "Do not include email subject, signature, source notes, or placeholders.",
            contactFollowUpDraft.message.trim() ? `User instruction: ${contactFollowUpDraft.message.trim()}` : "User instruction: create a practical next follow-up."
          ].join("\n"),
          sourceText: buildContactFollowUpAiSourceText(record, selectedActivities, contactFollowUpDraft)
        }
      });
      setContactFollowUpDraft((current) => (current ? { ...current, message: (result.enabled ? result.text : current.message).trim() } : current));
    } finally {
      setIsContactFollowUpGenerating(false);
    }
  }

  async function submitContactFollowUp() {
    if (!contactFollowUpDraft) {
      return;
    }
    const messageText = contactFollowUpDraft.message.trim();
    if (!messageText) {
      showError("请输入跟进内容");
      return;
    }
    await createRecordActivity({
      recordId: contactFollowUpDraft.recordId,
      type: contactFollowUpDraft.channel === "call" ? "call" : "note",
      title: `${contactFollowUpDraft.channel === "call" ? "电话跟进" : "WhatsApp 跟进"}：${contactFollowUpDraft.recordTitle}`,
      body: serializeActivityDetails({
        text: [
          `联系方式：${contactMethodTypeLabels[contactFollowUpDraft.method.type]} ${contactFollowUpDraft.method.value}`,
          messageText
        ].join("\n\n"),
        attachments: contactFollowUpDraft.attachments
      })
    });
    if (contactFollowUpDraft.channel === "whatsapp") {
      const whatsappUrl = buildContactMethodUrl("whatsapp", contactFollowUpDraft.method.value);
      if (whatsappUrl) {
        const separator = whatsappUrl.includes("?") ? "&" : "?";
        window.open(`${whatsappUrl}${separator}text=${encodeURIComponent(messageText)}`, "_blank", "noreferrer");
      }
    }
    setContactFollowUpDraft(null);
    showSuccess("跟进记录已保存到活动时间线");
  }

  function selectEmailThread(threadId: string) {
    if (threadId !== selectedEmailThreadId) {
      setEmailDraft((current) => clearEmailDraftAiProvenance(current));
    }
    setSelectedEmailThreadId(threadId);
  }

  async function refreshEmailThreads(options: { reloadSelectedMessages?: boolean } = {}) {
    const threads = await fetchJson<EmailThread[]>("/api/email/threads", { method: "GET" });
    const threadId = selectedEmailThreadId && threads.some((thread) => thread.id === selectedEmailThreadId) ? selectedEmailThreadId : threads[0]?.id ?? "";
    setEmailThreads(threads);
    selectEmailThread(threadId);
    if (options.reloadSelectedMessages && threadId) {
      await loadEmailMessages(threadId);
    }
  }

  async function updateEmailThread(threadId: string, recordId: string) {
    const thread = await fetchJson<EmailThread>(`/api/email/threads/${threadId}`, {
      method: "PATCH",
      body: { recordId: recordId || null }
    });
    setEmailThreads((current) => [thread, ...current.filter((candidate) => candidate.id !== thread.id)]);
    setEmailDraft((current) => (current.recordId || selectedEmailThreadId !== thread.id ? current : clearEmailDraftAiProvenance({ ...current, recordId: thread.recordId || "" })));
    setMessage(thread.recordId ? "邮件线程已关联到客户记录" : "邮件线程已取消关联记录");
  }

  async function createContactFromEmail(threadId: string, emailAddress: string) {
    const normalizedEmail = emailAddress.trim().toLowerCase();
    if (!looksLikeEmail(normalizedEmail)) {
      throw new Error("发件人邮箱无效，不能创建联系人");
    }
    const existingContact = findContactByEmail(records, normalizedEmail);
    if (existingContact) {
      await updateEmailThread(threadId, existingContact.id);
      setMessage(`邮件已关联到联系人 ${existingContact.title}`);
      return;
    }
    const created = await fetchJson<CrmRecord>("/api/records/contacts", {
      method: "POST",
      body: {
        title: contactNameFromEmail(normalizedEmail),
        data: {
          contactMethods: [{ id: `method-${Date.now()}`, type: "email", value: normalizedEmail, label: "Email", primary: true }],
          email: normalizedEmail
        }
      }
    });
    setRecords((current) => mergeRecords(current, [created]));
    await updateEmailThread(threadId, created.id);
    setMessage(`已创建联系人 ${created.title}`);
  }

  async function linkExistingContactFromEmail(threadId: string, contactId: string, emailAddress: string) {
    const normalizedEmail = emailAddress.trim().toLowerCase();
    if (!looksLikeEmail(normalizedEmail)) {
      throw new Error("发件人邮箱无效，不能添加到联系人");
    }
    const contact = records.find((record) => record.id === contactId && record.objectKey === "contacts");
    if (!contact) {
      throw new Error("请选择一个联系人");
    }
    const existingEmails = getRecordEmailAddressesFromData(contact);
    let updatedContact = contact;
    if (!existingEmails.includes(normalizedEmail)) {
      const methods = normalizePrimaryContactMethods([
        ...contactMethodsFromRecordData(contact),
        {
          id: `method-${Date.now()}`,
          type: "email",
          value: normalizedEmail,
          label: "Email",
          primary: existingEmails.length === 0
        }
      ]);
      updatedContact = await fetchJson<CrmRecord>(`/api/records/contacts/${contact.id}`, {
        method: "PATCH",
        body: {
          title: contact.title,
          ownerId: contact.ownerId,
          data: {
            contactMethods: methods,
            email: methods.find((method) => method.type === "email" && looksLikeEmail(method.value))?.value.toLowerCase() ?? "",
            phone: getContactMethodPhone(methods)
          }
        }
      });
      setRecords((current) => mergeRecords(current, [updatedContact]));
    }
    await updateEmailThread(threadId, updatedContact.id);
    setMessage(`邮件已关联到联系人 ${updatedContact.title}，并已保存邮箱 ${normalizedEmail}`);
  }

  async function unlinkContactEmailFromThread(threadId: string, contactId: string, emailAddress: string) {
    const normalizedEmail = emailAddress.trim().toLowerCase();
    const contact = records.find((record) => record.id === contactId && record.objectKey === "contacts");
    if (!contact || !looksLikeEmail(normalizedEmail)) {
      await updateEmailThread(threadId, "");
      return;
    }

    const methods = normalizePrimaryContactMethods(
      contactMethodsFromRecordData(contact).filter((method) => !(method.type === "email" && method.value.trim().toLowerCase() === normalizedEmail))
    );
    const nextEmail = methods.find((method) => method.type === "email" && looksLikeEmail(method.value))?.value.toLowerCase() ?? "";
    const updatedContact = await fetchJson<CrmRecord>(`/api/records/contacts/${contact.id}`, {
      method: "PATCH",
      body: {
        title: contact.title,
        ownerId: contact.ownerId,
        data: {
          contactMethods: methods,
          email: nextEmail,
          phone: getContactMethodPhone(methods)
        }
      }
    });
    setRecords((current) => mergeRecords(current, [updatedContact]));
    await updateEmailThread(threadId, "");
    setMessage(`邮件已解除关联，并已从联系人 ${updatedContact.title} 删除邮箱 ${normalizedEmail}`);
  }

  function openEmailContact(threadId: string, contact: CrmRecord) {
    openRecord(contact, { returnEmailThreadId: threadId });
  }

  async function updateEmailThreadState(threadId: string, patch: Partial<EmailThreadUiState>): Promise<EmailThread> {
    const thread = await fetchJson<EmailThread>(`/api/email/threads/${threadId}/state`, {
      method: "PATCH",
      body: patch
    });
    setEmailThreads((current) => [thread, ...current.filter((candidate) => candidate.id !== thread.id)]);
    return thread;
  }

  async function deleteEmailThreads(threadIds: string[]): Promise<boolean> {
    const ids = Array.from(new Set(threadIds)).filter(Boolean);
    if (!ids.length) {
      return false;
    }
    const targetThreads = emailThreads.filter((candidate) => ids.includes(candidate.id));
    const thread = targetThreads[0];
    if (
      !(await requestConfirm({
        title: "彻底删除邮件",
        message: targetThreads.length > 1 ? `确定彻底删除 ${targetThreads.length} 个邮件线程？此操作不能撤销。` : `确定彻底删除邮件线程“${thread?.subject ?? ids[0]}”？此操作不能撤销。`,
        confirmLabel: "彻底删除",
        danger: true
      }))
    ) {
      return false;
    }
    await Promise.all(ids.map((threadId) => fetchJson(`/api/email/threads/${threadId}`, { method: "DELETE" })));
    setEmailThreads((current) => current.filter((candidate) => !ids.includes(candidate.id)));
    setEmailMessagesByThread((current) => {
      const next = { ...current };
      ids.forEach((threadId) => {
        delete next[threadId];
      });
      return next;
    });
    if (ids.includes(selectedEmailThreadId)) {
      selectEmailThread(emailThreads.find((candidate) => !ids.includes(candidate.id))?.id ?? "");
    }
    showSuccess(ids.length > 1 ? `已彻底删除 ${ids.length} 个邮件线程` : "邮件线程已彻底删除");
    router.refresh();
    return true;
  }

  async function sendEmail() {
    const preparedDraft = prepareEmailDraftForSend(emailDraft, emailSignatures, emailAccounts);
    const result = await fetchJson<EmailMessage | { messages: EmailMessage[] }>("/api/email/send", {
      method: "POST",
      body: {
        accountId: emailDraft.accountId,
        threadId: emailDraft.threadId || undefined,
        recordId: emailDraft.recordId || undefined,
        to: splitEmailList(emailDraft.to),
        cc: splitEmailList(emailDraft.cc),
        bcc: splitEmailList(emailDraft.bcc),
        subject: emailDraft.subject,
        bodyText: preparedDraft.bodyText,
        bodyHtml: preparedDraft.bodyHtml,
        clientRequestId: emailDraft.clientRequestId,
        scheduledSendAt: emailDraft.scheduledSendAt || undefined,
        trackingEnabled: emailDraft.trackingEnabled || undefined,
        groupSendMode: emailDraft.groupSendMode || undefined,
        skipAutoLink: !emailDraft.threadId,
        attachments: preparedDraft.attachments?.length ? preparedDraft.attachments : undefined,
        aiAssisted: emailDraft.aiAssisted || undefined,
        aiPurpose: emailDraft.aiAssisted ? emailDraft.aiPurpose : undefined,
        aiSourceMessageId: emailDraft.aiAssisted ? emailDraft.aiSourceMessageId : undefined,
        aiSources: emailDraft.aiAssisted ? emailDraft.aiSources : undefined,
        aiGeneratedAt: emailDraft.aiAssisted ? emailDraft.aiGeneratedAt : undefined
      }
    });
    const messages = "messages" in result ? result.messages : [result];
    const message = messages[0];
    const sentThreadIds = Array.from(new Set(messages.map((item) => item.threadId).filter(Boolean)));
    setEmailMessagesByThread((current) => {
      const next = { ...current };
      for (const item of messages) {
        next[item.threadId] = upsertEmailMessage(next[item.threadId] ?? [], item);
      }
      return next;
    });
    await refreshEmailThreadsByIds(messages.map((item) => item.threadId));
    await Promise.all(sentThreadIds.map((threadId) => updateEmailThreadState(threadId, { read: true })));
    selectEmailThread(message.threadId);
    setEmailDraft((current) => ({
      ...current,
      clientRequestId: createEmailClientRequestId(),
      to: "",
      cc: "",
      bcc: "",
      subject: "",
      threadId: undefined,
      bodyText: "",
      bodyHtml: "",
      signatureId: "",
      replyOriginalBodyText: undefined,
      replyOriginalBodyHtml: undefined,
      replyOriginalFrom: undefined,
      replyOriginalSentAt: undefined,
      attachments: [],
      scheduledSendAt: "",
      trackingEnabled: false,
      groupSendMode: false,
      aiAssisted: false,
      aiPurpose: undefined,
      aiSourceMessageId: undefined,
      aiSources: undefined,
      aiGeneratedAt: undefined
    }));
    setMessage(messages.length > 1 ? `已创建 ${messages.length} 封单显邮件${message.scheduledSendAt ? `，将在 ${formatDate(message.scheduledSendAt)} 发送` : ""}` : formatEmailSendResultMessage(message));
    router.refresh();
  }

  async function retryEmailMessage(messageId: string) {
    const message = await fetchJson<EmailMessage>(`/api/email/messages/${messageId}/retry`, {
      method: "POST"
    });
    setEmailMessagesByThread((current) => ({
      ...current,
      [message.threadId]: (current[message.threadId] ?? []).map((candidate) => (candidate.id === message.id ? message : candidate))
    }));
    setMessage(`已重试邮件：${message.subject}`);
    router.refresh();
  }

  function replyToEmailMessage(message: EmailMessage) {
    const thread = emailThreads.find((candidate) => candidate.id === message.threadId);
    const account = emailAccounts.find((candidate) => candidate.id === message.accountId);
    selectEmailThread(message.threadId);
    setEmailDraft((current) => ({
      ...current,
      ...buildEmailReplyDraft({
        message,
        accountEmail: account?.emailAddress,
        recordId: thread?.recordId || current.recordId || selectedRecord?.id || ""
      }),
      aiAssisted: false,
      aiPurpose: undefined,
      aiSourceMessageId: undefined,
      aiSources: undefined,
      aiGeneratedAt: undefined
    }));
  }

  async function generateEmailAi() {
    const selectedSourceMessageId = selectedEmailThreadId
      ? emailMessagesByThread[selectedEmailThreadId]?.at(-1)?.id
      : undefined;
    const result = await fetchJson<EmailAiGenerateResult>("/api/email/ai-generate", {
      method: "POST",
      body: {
        purpose: emailAiPurpose,
        threadId: selectedEmailThreadId || undefined,
        recordId: emailDraft.recordId || selectedRecord?.id,
        sourceMessageId: selectedSourceMessageId,
        userPrompt: emailAiPrompt || undefined,
        sourceText: emailDraft.bodyText || undefined
      }
    });
    setEmailAiResult(result);
    const canApplyResultToDraft = result.enabled && (emailAiPurpose === "draft" || (emailAiPurpose === "translate" && result.generationMode === "provider"));
    if (canApplyResultToDraft) {
      setEmailDraft((current) => ({
        ...current,
        subject: emailAiPurpose === "draft" && !current.subject.trim() ? result.suggestedSubject ?? current.subject : current.subject,
        bodyText: result.text,
        aiAssisted: true,
        aiPurpose: emailAiPurpose,
        aiSourceMessageId: result.sourceMessageId,
        aiSources: result.sources,
        aiGeneratedAt: new Date().toISOString()
      }));
    } else if (result.enabled && emailAiPurpose === "translate") {
      setMessage("翻译未应用到正文：需要配置可用 AI provider。");
    }
  }

  async function generateEmailAiForDraft(prompt: string) {
    const selectedSourceMessageId = selectedEmailThreadId
      ? emailMessagesByThread[selectedEmailThreadId]?.at(-1)?.id
      : undefined;
    const selectedThread = selectedEmailThreadId ? emailThreads.find((thread) => thread.id === selectedEmailThreadId) : undefined;
    const result = await fetchJson<EmailAiGenerateResult>("/api/email/ai-generate", {
      method: "POST",
      body: {
        purpose: "draft",
        threadId: selectedEmailThreadId || undefined,
        recordId: emailDraft.recordId || selectedRecord?.id,
        sourceMessageId: selectedSourceMessageId,
        userPrompt: prompt || undefined,
        sourceText: buildDraftAiSourceText(emailDraft, selectedThread, selectedEmailThreadId ? emailMessagesByThread[selectedEmailThreadId] ?? [] : [])
      }
    });
    setEmailAiPurpose("draft");
    setEmailAiPrompt(prompt);
    setEmailAiResult(result);
    if (result.enabled) {
      setEmailDraft((current) => ({
        ...current,
        subject: !current.subject.trim() ? result.suggestedSubject ?? current.subject : current.subject,
        bodyText: result.text,
        bodyHtml: emailTextToHtml(result.text),
        aiAssisted: true,
        aiPurpose: "draft",
        aiSourceMessageId: result.sourceMessageId,
        aiSources: result.sources,
        aiGeneratedAt: new Date().toISOString()
      }));
    }
  }

  async function generateEmailAiPromptForDraft(currentPrompt: string): Promise<string> {
    const selectedSourceMessageId = selectedEmailThreadId
      ? emailMessagesByThread[selectedEmailThreadId]?.at(-1)?.id
      : undefined;
    const selectedThread = selectedEmailThreadId ? emailThreads.find((thread) => thread.id === selectedEmailThreadId) : undefined;
    const result = await fetchJson<EmailAiGenerateResult>("/api/email/ai-generate", {
      method: "POST",
      body: {
        purpose: "draft",
        threadId: selectedEmailThreadId || undefined,
        recordId: emailDraft.recordId || selectedRecord?.id,
        sourceMessageId: selectedSourceMessageId,
        userPrompt: "Generate a concise, actionable prompt for the email drafting agent. Include recipient/customer context, desired tone, key points, current draft intent, and the next sales action. Return only the prompt text, not the email body.",
        sourceText: [
          buildDraftAiSourceText(emailDraft, selectedThread, selectedEmailThreadId ? emailMessagesByThread[selectedEmailThreadId] ?? [] : []),
          currentPrompt.trim() ? `Current prompt idea:\n${currentPrompt.trim()}` : ""
        ]
          .filter(Boolean)
          .join("\n\n")
      }
    });
    setEmailAiPurpose("draft");
    setEmailAiPrompt(currentPrompt);
    setEmailAiResult(result);
    setMessage("AI 提示词已生成，请确认后再一键生成正文。");
    return buildComposePromptFromAiResult(result, currentPrompt, emailDraft, selectedThread);
  }

  async function generateEmailAiForMessage(message: EmailMessage, purpose: "translate" | "context_analysis") {
    if (purpose === "translate") {
      const translated = await fetchJson<EmailMessage>(`/api/email/messages/${message.id}/translate`, {
        method: "POST"
      });
      setEmailMessagesByThread((current) => ({
        ...current,
        [translated.threadId]: (current[translated.threadId] ?? []).map((candidate) => (candidate.id === translated.id ? translated : candidate))
      }));
      setEmailAiPurpose("translate");
      setEmailAiResult({
        enabled: Boolean(translated.translatedBodyText),
        purpose: "translate",
        text: translated.translatedBodyText ?? "翻译未保存：需要配置可用 AI provider；本地回退或 provider 失败不会写入邮件翻译缓存。",
        sources: translated.translatedSources?.length ? translated.translatedSources : [{ label: translated.subject, messageId: translated.id }]
      });
      setMessage(translated.translatedBodyText ? "邮件翻译已保存。" : "翻译未保存：需要配置可用 AI provider。");
      return;
    }
    const thread = emailThreads.find((candidate) => candidate.id === message.threadId);
    const result = await fetchJson<EmailAiGenerateResult>("/api/email/ai-generate", {
      method: "POST",
      body: {
        purpose,
        threadId: message.threadId,
        sourceMessageId: message.id,
        recordId: thread?.recordId || selectedRecord?.id || emailDraft.recordId || undefined,
        userPrompt: purpose === "context_analysis" ? "Analyze this email and suggest the next sales action." : undefined,
        sourceText: message.bodyText
      }
    });
    setEmailAiPurpose(purpose);
    setEmailAiResult(result);
  }

  async function summarizeEmailThread() {
    if (!selectedEmailThreadId) {
      return;
    }
    const response = await fetchJson<{ updated: boolean; queued?: boolean; thread?: EmailThread; result: EmailAiGenerateResult }>(`/api/email/threads/${selectedEmailThreadId}/summarize`, {
      method: "POST"
    });
    setEmailAiResult(response.result);
    if (response.thread) {
      setEmailThreads((current) => [response.thread as EmailThread, ...current.filter((thread) => thread.id !== response.thread?.id)]);
    }
    setMessage(response.queued ? "邮件线程总结已加入后台队列" : response.updated ? "邮件线程摘要已刷新" : "邮件自动总结功能已关闭");
  }

  async function analyzeEmailThread() {
    if (!selectedEmailThreadId) {
      return;
    }
    const response = await fetchJson<{ updated: boolean; queued?: boolean; thread?: EmailThread; result: EmailAiGenerateResult }>(`/api/email/threads/${selectedEmailThreadId}/analyze`, {
      method: "POST"
    });
    setEmailAiResult(response.result);
    if (response.thread) {
      setEmailThreads((current) => [response.thread as EmailThread, ...current.filter((thread) => thread.id !== response.thread?.id)]);
    }
    setMessage(response.queued ? "邮件线程分析已加入队列。" : response.updated ? "邮件线程分析已刷新。" : "邮件上下文分析已关闭。");
  }

  async function updateEmailAiFeature(feature: keyof EmailAiSettings["features"], enabled: boolean) {
    return updateEmailAiSettingsPatch({ features: { [feature]: enabled } });
  }

  async function updateEmailAiSettingsPatch(
    patch: Partial<Pick<EmailAiSettings, "defaultLocale" | "requireSourceLinks" | "maxHistoryMessages" | "maxKnowledgeArticles" | "maxContextChars" | "agents">> & {
      providerConfig?: Partial<EmailAiSettings["providerConfig"]>;
      features?: Partial<EmailAiSettings["features"]>;
    }
  ) {
    const settings = await fetchJson<EmailAiSettings>("/api/email/ai-settings", {
      method: "PATCH",
      body: patch
    });
    setEmailAiSettings(settings);
    setMessage("邮件 AI 设置已更新");
  }

  async function updateEmailSyncSettingsPatch(patch: Partial<Omit<EmailSyncSettings, "workspaceId" | "updatedAt">>) {
    const settings = await fetchJson<EmailSyncSettings>("/api/email/sync-settings", {
      method: "PATCH",
      body: patch
    });
    setEmailSyncSettings(settings);
    setMessage("邮件后台同步设置已更新");
  }

  async function saveEmailSignatureFromDraft() {
    const body = {
      accountId: emailSignatureDraft.accountId || null,
      name: emailSignatureDraft.name,
      bodyText: emailSignatureDraft.bodyText,
      bodyHtml: emailSignatureDraft.bodyHtml || undefined,
      isDefault: emailSignatureDraft.isDefault,
      active: emailSignatureDraft.active
    };
    const signature = emailSignatureDraft.editingSignatureId
      ? await fetchJson<EmailSignature>(`/api/email/signatures/${emailSignatureDraft.editingSignatureId}`, { method: "PATCH", body })
      : await fetchJson<EmailSignature>("/api/email/signatures", { method: "POST", body });
    setEmailSignatures((current) => [signature, ...current.filter((candidate) => candidate.id !== signature.id)].map((candidate) =>
      signature.isDefault && (candidate.accountId ?? "") === (signature.accountId ?? "") && candidate.id !== signature.id
        ? { ...candidate, isDefault: false }
        : candidate
    ));
    setEmailSignatureDraft(createEmptyEmailSignatureDraft());
    showSuccess(`邮件签名已${emailSignatureDraft.editingSignatureId ? "更新" : "创建"}：${signature.name}`);
  }

  async function deleteEmailSignature(signature: EmailSignature) {
    if (
      !(await requestConfirm({
        title: "删除邮件签名",
        message: `确定删除签名“${signature.name}”？已经发送的邮件不会受到影响。`,
        confirmLabel: "删除",
        danger: true
      }))
    ) {
      return;
    }
    await fetchJson(`/api/email/signatures/${signature.id}`, { method: "DELETE" });
    setEmailSignatures((current) => current.filter((candidate) => candidate.id !== signature.id));
    setEmailSignatureDraft((current) => (current.editingSignatureId === signature.id ? createEmptyEmailSignatureDraft() : current));
    setEmailDraft((current) => (current.signatureId === signature.id ? clearEmailDraftAiProvenance({ ...current, signatureId: noEmailSignatureId }) : current));
    showSuccess(`邮件签名已删除：${signature.name}`);
  }

  async function refreshEmailDiagnostics() {
    const diagnostics = await fetchJson<EmailSubsystemDiagnostics>("/api/email/diagnostics", { method: "GET" });
    setEmailDiagnostics(diagnostics);
    setMessage(`邮件诊断完成：${formatEmailDiagnosticStatus(diagnostics.status)}`);
  }

  async function openEmailAiSource(source: EmailAiSource) {
    if (source.recordId) {
      const record = records.find((candidate) => candidate.id === source.recordId);
      if (record) {
        openRecord(record);
        return;
      }
    }

    if (source.messageId) {
      const threadEntry = Object.entries(emailMessagesByThread).find(([, messages]) => messages.some((message) => message.id === source.messageId));
      if (threadEntry) {
        selectEmailThread(threadEntry[0]);
        navigateToWorkspace("email");
        return;
      }
      const message = await fetchJson<EmailMessage>(`/api/email/messages/${source.messageId}`, { method: "GET" });
      await loadEmailMessages(message.threadId);
      selectEmailThread(message.threadId);
      navigateToWorkspace("email");
      return;
    }

    if (source.activityId) {
      let activity = activities.find((candidate) => candidate.id === source.activityId);
      if (!activity) {
        const fetchedActivity = await fetchJson<Activity>(`/api/activities/${source.activityId}`, { method: "GET" });
        activity = fetchedActivity;
        setActivities((current) => mergeActivities(current, [fetchedActivity]));
      }
      if (activity?.recordId) {
        const record = records.find((candidate) => candidate.id === activity.recordId);
        if (record) {
          openRecord(record);
          return;
        }
      }
      navigateToWorkspace("activities");
      setMessage(`已定位活动来源：${source.label}`);
      return;
    }

    if (source.knowledgeArticleId) {
      let article = knowledgeArticles.find((candidate) => candidate.id === source.knowledgeArticleId);
      if (!article) {
        const fetchedArticle = await fetchJson<KnowledgeArticle>(`/api/knowledge/articles/${source.knowledgeArticleId}`, { method: "GET" });
        article = fetchedArticle;
        setKnowledgeArticles((current) => [fetchedArticle, ...current.filter((candidate) => candidate.id !== fetchedArticle.id)]);
      }
      navigateToWorkspace("email");
      setMessage(article ? `知识库来源：${article.title}` : `知识库来源：${source.label}`);
      return;
    }

    setMessage("该 AI 来源暂时无法直接打开");
  }

  async function createKnowledgeArticle() {
    if (knowledgeDraft.editingArticleId) {
      const article = await fetchJson<KnowledgeArticle>(`/api/knowledge/articles/${knowledgeDraft.editingArticleId}`, {
        method: "PATCH",
        body: {
          title: knowledgeDraft.title,
          body: knowledgeDraft.body,
          tags: splitEmailList(knowledgeDraft.tags),
          active: knowledgeDraft.active
        }
      });
      setKnowledgeArticles((current) => [article, ...current.filter((candidate) => candidate.id !== article.id)]);
      setKnowledgeDraft({ title: "", body: "", tags: "", active: true });
      setMessage(`知识库文章已保存：${article.title}`);
      router.refresh();
      return;
    }

    const article = await fetchJson<KnowledgeArticle>("/api/knowledge/articles", {
      method: "POST",
      body: {
        title: knowledgeDraft.title,
        body: knowledgeDraft.body,
        tags: splitEmailList(knowledgeDraft.tags),
        active: knowledgeDraft.active
      }
    });
    setKnowledgeArticles((current) => [article, ...current.filter((candidate) => candidate.id !== article.id)]);
    setKnowledgeDraft({ title: "", body: "", tags: "", active: true });
    setMessage(`知识库文章已创建：${article.title}`);
    router.refresh();
  }

  async function updateKnowledgeArticle(articleId: string, patch: Partial<Pick<KnowledgeArticle, "title" | "body" | "tags" | "active">>) {
    const article = await fetchJson<KnowledgeArticle>(`/api/knowledge/articles/${articleId}`, {
      method: "PATCH",
      body: patch
    });
    setKnowledgeArticles((current) => [article, ...current.filter((candidate) => candidate.id !== article.id)]);
    setMessage(`知识库文章已更新：${article.title}`);
    router.refresh();
  }

  async function uploadMediaAssets(files: FileList | File[] | null): Promise<MediaAsset[]> {
    const uploadFiles = Array.from(files ?? []);
    if (!uploadFiles.length) {
      showToast({ intent: "info", message: "请选择文件。" });
      return [];
    }
    const createdAssets: MediaAsset[] = [];
    for (const file of uploadFiles.slice(0, 10)) {
      if (file.size > MAX_EMAIL_ATTACHMENT_BYTES) {
        showToast({ intent: "error", message: `${file.name} 超过 ${formatBytes(MAX_EMAIL_ATTACHMENT_BYTES)}，已跳过。` });
        continue;
      }
      const asset = await fetchJson<MediaAsset>("/api/media-assets", {
        method: "POST",
        body: {
          name: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
          contentBase64: await readFileAsBase64(file)
        }
      });
      createdAssets.push(asset);
    }
    if (createdAssets.length) {
      setMediaAssets((current) => mergeMediaAssets(createdAssets, current));
      showSuccess(`已上传 ${createdAssets.length} 个文件到媒体库`);
    }
    return createdAssets;
  }

  async function updateMediaAsset(assetId: string, patch: Partial<Pick<MediaAsset, "name" | "contentType" | "size" | "contentBase64">>) {
    const updated = await fetchJson<MediaAsset>(`/api/media-assets/${assetId}`, {
      method: "PATCH",
      body: patch
    });
    setMediaAssets((current) => mergeMediaAssets([updated], current.filter((asset) => asset.id !== updated.id)));
    showSuccess(`媒体文件已更新：${updated.name}`);
  }

  async function deleteMediaAsset(asset: MediaAsset) {
    if (
      !(await requestConfirm({
        title: "删除媒体文件",
        message: `确定从媒体库删除“${asset.name}”？已经使用该文件的记录不会自动清空。`,
        confirmLabel: "删除",
        danger: true
      }))
    ) {
      return;
    }
    await fetchJson(`/api/media-assets/${asset.id}`, { method: "DELETE" });
    setMediaAssets((current) => current.filter((candidate) => candidate.id !== asset.id));
    showSuccess(`媒体文件已删除：${asset.name}`);
  }

  async function generateSmartReminders(input: { objectKey?: string; recordId?: string } = {}) {
    setIsGeneratingSmartReminders(true);
    try {
      const result = await fetchJson<{ reminders: SmartReminder[]; run: SmartReminderRun }>("/api/smart-reminders/generate", {
        method: "POST",
        body: input
      });
      setSmartReminders((current) => mergeSmartReminders(current, result.reminders));
      showSuccess(result.reminders.length > 0 ? `已生成 ${result.reminders.length} 条智能提醒` : "暂无新的智能提醒");
    } finally {
      setIsGeneratingSmartReminders(false);
    }
  }

  async function updateSmartReminder(reminder: SmartReminder, patch: { status?: SmartReminder["status"]; snoozedUntil?: string | null }) {
    const updated = await fetchJson<SmartReminder>(`/api/smart-reminders/${reminder.id}`, {
      method: "PATCH",
      body: patch
    });
    setSmartReminders((current) => mergeSmartReminders(current, [updated]));
  }

  async function snoozeSmartReminder(reminder: SmartReminder) {
    const snoozedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await updateSmartReminder(reminder, { status: "open", snoozedUntil });
    showSuccess("已稍后提醒：明天再显示");
  }

  async function convertSmartReminderToTask(reminder: SmartReminder) {
    const result = await fetchJson<{ reminder: SmartReminder; task: Activity }>(`/api/smart-reminders/${reminder.id}/convert-task`, {
      method: "POST"
    });
    setSmartReminders((current) => mergeSmartReminders(current, [result.reminder]));
    setActivities((current) => mergeActivities(current, [result.task]));
    showSuccess("已转为任务");
  }

  function runAction(action: () => Promise<void>) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (actionError) {
        showError(actionError instanceof Error ? actionError.message : "操作失败");
      }
    });
  }

  function runRecordSaveAction(action: () => Promise<void>) {
    setMessage(null);
    setError(null);
    setIsRecordSavePending(true);
    void (async () => {
      try {
        await action();
      } catch (actionError) {
        showError(actionError instanceof Error ? actionError.message : "保存失败");
      } finally {
        setIsRecordSavePending(false);
      }
    })();
  }

  function refreshRoute() {
    setMessage(null);
    setError(null);
    setIsRouteRefreshing(true);
    if (routeRefreshTimeoutRef.current !== null) {
      window.clearTimeout(routeRefreshTimeoutRef.current);
    }
    routeRefreshTimeoutRef.current = window.setTimeout(() => {
      setIsRouteRefreshing(false);
      routeRefreshTimeoutRef.current = null;
    }, routeRefreshTimeoutMs);
    startRouteRefreshTransition(() => {
      router.refresh();
    });
  }

  async function runImmediateAction<T>(action: () => Promise<T>): Promise<T | undefined> {
    setMessage(null);
    setError(null);
    try {
      return await action();
    } catch (actionError) {
      showError(actionError instanceof Error ? actionError.message : "操作失败");
      return undefined;
    }
  }

  function toggleAppSidebar() {
    setAppSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(sidebarCollapsedStorageKey, String(next));
      return next;
    });
  }

  function toggleAppTheme() {
    setAppTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      window.localStorage.setItem(appThemeStorageKey, next);
      return next;
    });
  }

  function openQuickCreateRecord(objectKey: string) {
    const objectDefinition = props.objects.find((object) => object.key === objectKey);
    if (!objectDefinition) {
      return;
    }
    const nextNav = coreObjects.has(objectKey) ? (objectKey as NavKey) : "records";
    const nextPath = `${crmPathForNav(nextNav, objectKey)}?mode=create`;
    const nextFields = props.fields.filter((field) => field.objectKey === objectKey).sort((left, right) => left.position - right.position);
    setQuickAddMenuOpen(false);
    setModuleActionsOpen(false);
    setActiveObjectKey(objectKey);
    setActiveNav(nextNav);
    setSelectedRecordId("");
    setCreateFormObjectKey(objectKey);
    setCreateTitle("");
    setCreateOwnerId(props.contextUser.id);
    setCreateValues(buildInitialValues(nextFields, objectKey));
    setRecordReturnEmailThreadId("");
    setRecordPanelMode("create");
    if (`${pathname}?${searchParams.toString()}` !== nextPath) {
      router.push(nextPath);
    }
  }

  function openImportDialog() {
    setModuleActionsOpen(false);
    setQuickAddMenuOpen(false);
    setNotificationMenuOpen(false);
    setRecordPanelMode("import");
  }

  function openExportDialog() {
    setModuleActionsOpen(false);
    setQuickAddMenuOpen(false);
    setNotificationMenuOpen(false);
    setExportDialogOpen(true);
  }

  const showRecordWorkspace = coreObjects.has(activeNav) || activeNav === "records";

  return (
    <div
      className={`app-shell ${appSidebarCollapsed ? "sidebar-collapsed" : ""} theme-${appTheme}`}
      data-testid="crm-workspace"
      data-active-object={activeObject?.key ?? ""}
      data-create-form-object={createFormObjectKey}
      data-list-loading={isRecordListLoading ? "true" : "false"}
      data-ready={isHydrated ? "true" : "false"}
    >
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Bot size={18} />
          </span>
          <span>AI Agent CRM</span>
        </div>

        <nav className="nav-list" aria-label="主导航">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={`nav-button ${activeNav === item.key ? "active" : ""}`}
                data-testid={`nav-${item.key}`}
                type="button"
                onClick={() => {
                  if (coreObjects.has(item.key)) {
                    openObject(item.key);
                    return;
                  }
                  navigateToWorkspace(item.key);
                }}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="user-strip">
          <strong>{props.contextUser.name}</strong>
          <div>
            {props.role.name} · {props.contextUser.email}
          </div>
          <form action="/api/auth/logout" method="post" style={{ marginTop: 12 }}>
            <button className="secondary-button" type="submit" style={{ width: "100%" }}>
              退出登录
            </button>
          </form>
        </div>
      </aside>

      <main className={`main ${activeNav === "email" ? "email-main" : ""}`}>
        {activeNav !== "email" ? (
          showRecordWorkspace && activeObject ? (
            <ModuleWorkspaceHeader
              activeObject={activeObject}
              appSidebarCollapsed={appSidebarCollapsed}
              appTheme={appTheme}
              dealWorkspaceView={dealWorkspaceView}
              exportRecordsUrl={exportRecordsUrl}
              isRouteRefreshing={isRouteRefreshing || isRouteRefreshPending}
              moduleActionsOpen={moduleActionsOpen}
              notificationMenuOpen={notificationMenuOpen}
              notifications={headerNotifications}
              query={query}
              quickAddMenuOpen={quickAddMenuOpen}
              quickAddObjects={quickAddObjects}
              onChangeDealView={changeDealWorkspaceView}
              onOpenExport={openExportDialog}
              onOpenImport={openImportDialog}
              onQuickCreate={openQuickCreateRecord}
              onQueryChange={setQuery}
              onRefresh={refreshRoute}
              onToggleAppSidebar={toggleAppSidebar}
              onToggleModuleActions={() => {
                setNotificationMenuOpen(false);
                setQuickAddMenuOpen(false);
                setModuleActionsOpen((current) => !current);
              }}
              onToggleNotifications={() => {
                setModuleActionsOpen(false);
                setQuickAddMenuOpen(false);
                setNotificationMenuOpen((current) => !current);
              }}
              onToggleQuickAdd={() => {
                setModuleActionsOpen(false);
                setNotificationMenuOpen(false);
                setQuickAddMenuOpen((current) => !current);
              }}
              onToggleTheme={toggleAppTheme}
            />
          ) : activeNav === "tasks" ? (
            <StandaloneModuleHeader
              appSidebarCollapsed={appSidebarCollapsed}
              appTheme={appTheme}
              createLabel="任务"
              isRouteRefreshing={isRouteRefreshing || isRouteRefreshPending}
              moduleActionsOpen={moduleActionsOpen}
              moduleKey="tasks"
              moduleTitle="任务"
              notificationMenuOpen={notificationMenuOpen}
              notifications={headerNotifications}
              query={taskQuery}
              taskView={taskWorkspaceView}
              onChangeTaskView={setTaskWorkspaceView}
              onCreate={() => { void runAction(requestStandaloneTaskCreate); }}
              onExport={() => exportStandaloneActivitiesCsv("tasks")}
              onImport={() => showStandaloneImportNotice("tasks")}
              onQueryChange={setTaskQuery}
              onRefresh={refreshRoute}
              onToggleAppSidebar={toggleAppSidebar}
              onToggleModuleActions={() => {
                setNotificationMenuOpen(false);
                setModuleActionsOpen((current) => !current);
              }}
              onToggleNotifications={() => {
                setModuleActionsOpen(false);
                setNotificationMenuOpen((current) => !current);
              }}
              onToggleTheme={toggleAppTheme}
            />
          ) : activeNav === "activities" ? (
            <StandaloneModuleHeader
              appSidebarCollapsed={appSidebarCollapsed}
              appTheme={appTheme}
              createLabel="活动"
              isRouteRefreshing={isRouteRefreshing || isRouteRefreshPending}
              moduleActionsOpen={moduleActionsOpen}
              moduleKey="activities"
              moduleTitle="活动"
              notificationMenuOpen={notificationMenuOpen}
              notifications={headerNotifications}
              query={activityQuery}
              onCreate={() => { void runAction(requestStandaloneActivityCreate); }}
              onExport={() => exportStandaloneActivitiesCsv("activities")}
              onImport={() => showStandaloneImportNotice("activities")}
              onQueryChange={setActivityQuery}
              onRefresh={refreshRoute}
              onToggleAppSidebar={toggleAppSidebar}
              onToggleModuleActions={() => {
                setNotificationMenuOpen(false);
                setModuleActionsOpen((current) => !current);
              }}
              onToggleNotifications={() => {
                setModuleActionsOpen(false);
                setNotificationMenuOpen((current) => !current);
              }}
              onToggleTheme={toggleAppTheme}
            />
          ) : (
            <div className="topbar">
              <div className="topbar-title">
                <AppSidebarToggleButton collapsed={appSidebarCollapsed} onToggle={toggleAppSidebar} />
                <div>
                  <h1 className="page-title">{titleFor(activeNav, activeObject?.pluralLabel)}</h1>
                  <div className="subtle">模块化单体、真实 API、真实表单和可配置 CRM 元数据已经接通。</div>
                </div>
              </div>
              <div className="toolbar">
                <HeaderNotificationsMenu
                  notifications={headerNotifications}
                  open={notificationMenuOpen}
                  onToggle={() => {
                    setModuleActionsOpen(false);
                    setQuickAddMenuOpen(false);
                    setNotificationMenuOpen((current) => !current);
                  }}
                />
                <button className="secondary-button" type="button" onClick={refreshRoute}>
                  <RefreshCw className={isRouteRefreshing || isRouteRefreshPending ? "spin-icon" : undefined} size={16} />
                  刷新
                </button>
              </div>
            </div>
          )
        ) : null}

        {activeNav === "dashboard" && (
          <Dashboard
            objects={props.objects}
            recordCounts={props.dashboardSummary.recordCounts}
            openTasks={openTasks}
            openTaskCount={props.dashboardSummary.openTaskCount}
            totalPipeline={totalPipeline}
            pipelines={props.pipelines}
            deals={deals}
            smartReminders={smartReminders}
            smartReminderGenerating={isGeneratingSmartReminders}
            onOpenObject={openObject}
            onOpenDeal={openRecord}
            onOpenSmartReminder={(reminder) => runAction(() => openSmartReminderRecord(reminder))}
            onGenerateSmartReminders={() => runAction(generateSmartReminders)}
            onCompleteSmartReminder={(reminder) => runAction(() => updateSmartReminder(reminder, { status: "done" }))}
            onDismissSmartReminder={(reminder) => runAction(() => updateSmartReminder(reminder, { status: "dismissed" }))}
            onSnoozeSmartReminder={(reminder) => runAction(() => snoozeSmartReminder(reminder))}
            onConvertSmartReminderToTask={(reminder) => runAction(() => convertSmartReminderToTask(reminder))}
            onMoveDealStage={(deal, stageKey) => runAction(() => moveDealStage(deal, stageKey))}
          />
        )}

        {activeNav === "objects" && (
          <ObjectDirectory objects={props.objects} recordCounts={props.dashboardSummary.recordCounts} onOpenObject={openObject} />
        )}

        {showRecordWorkspace && activeObject && (
          <div className={`workspace-grid ${recordPanelMode !== "closed" ? "has-drawer" : ""}`}>
            {recordPanelMode === "closed" && (
            <section className="table-shell">
              {isDealPipelineView ? (
                <DealPipelineWorkspace
                  activities={activities}
                  allRecords={records}
                  deals={filteredRecords}
                  disabled={false}
                  pipeline={activePipeline}
                  stages={activePipelineStages}
                  users={props.users}
                  onCreateActivity={openPipelineDealActivityDialog}
                  onCreateDeal={() => setRecordPanelMode("create")}
                  onMoveDealStage={(deal, stageKey, pipelineOrder) =>
                    moveDealStage(deal, stageKey, pipelineOrder, { refresh: false }).catch((moveError) => {
                      showError(moveError instanceof Error ? moveError.message : "交易阶段更新失败");
                      throw moveError;
                    })
                  }
                  onOpenDeal={openRecord}
                />
              ) : (
              <>
              {activeViews.length > 0 && (
                <div className="tabs" style={{ padding: "12px 12px 0" }}>
                  {activeViews.map((view) => (
                    <button
                      key={view.id}
                      className={`tab ${activeView?.id === view.id ? "active" : ""}`}
                      type="button"
                      onClick={() => setSelectedViewId(view.id)}
                    >
                      {view.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="list-tools">
                {activeObjectUsesPool ? (
                  <div className="toolbar" data-testid={`record-pool-switch-${activeObject.key}`}>
                    {[
                      { key: "all" as RecordPool, label: "全部" },
                      { key: "public" as RecordPool, label: "公海" },
                      { key: "private" as RecordPool, label: props.role.permissions.includes("crm.admin") ? "私海" : "我的私海" }
                    ].map((item) => (
                      <button
                        className={recordPool === item.key ? "primary-button" : "secondary-button"}
                        key={item.key}
                        type="button"
                        onClick={() => changeRecordPool(item.key)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <button className="secondary-button" type="button" onClick={() => setShowListSettings((current) => !current)}>
                  <LayoutList size={16} />
                  列表设置
                </button>
              </div>
              <div className="list-tools" style={{ paddingTop: 0 }}>
                <span className="subtle">
                  {isRecordListLoading
                    ? "列表加载中..."
                    : recordList.paginationMode === "keyset"
                      ? `显示 ${filteredRecords.length} 条 · 第 ${recordList.page} 页`
                      : `显示 ${filteredRecords.length} / ${recordList.total} 条`}
                </span>
                <div className="toolbar">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setRecordPage((current) => Math.max(1, current - 1))}
                    disabled={isRecordListLoading || recordList.page <= 1}
                  >
                    <ChevronLeft size={16} />
                    上一页
                  </button>
                  <span className="subtle">
                    {recordList.paginationMode === "keyset" ? `第 ${recordList.page} 页` : `${recordList.page} / ${recordList.pageCount}`}
                  </span>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setRecordPage((current) => current + 1)}
                    disabled={isRecordListLoading || (recordList.paginationMode === "keyset" ? !recordList.nextCursor : recordList.page >= recordList.pageCount)}
                  >
                    下一页
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
              {showListSettings ? (
                <ViewConfigurator
                  activeView={activeView}
                  canManageViews={canManageViews}
                  draft={viewDraft}
                  fields={objectFields}
                  isPending={isPending}
                  allRecords={records}
                  objectKey={activeObject.key}
                  onChange={setViewDraft}
                  onCreate={() => runAction(submitCreateSavedView)}
                  onDelete={() => runAction(submitDeleteSavedView)}
                  onRecordsLoaded={mergeLoadedRecords}
                  onReset={() => setViewDraft(createViewDraft(activeView, objectFields))}
                  onUpdate={() => runAction(submitUpdateSavedView)}
                  users={props.users}
                />
              ) : null}
              <div style={{ overflowX: "auto" }}>
                <table className="record-table">
                  <thead>
                    <tr>
                      <th>名称</th>
                      {visibleTableColumns.map((column) => (
                        <th key={column.key}>{column.label}</th>
                      ))}
                      <th>更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.map((record) => (
                      <tr key={record.id}>
                        <td>
                          <div className="record-name-cell">
                            <RecordTitleButton record={record} onOpen={() => openRecord(record)} />
                            {activeObjectUsesPool ? (
                              <span className={`record-owner-meta ${record.ownerId ? "" : "public"}`}>
                                {recordPoolLabel(record, props.users)}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        {visibleTableColumns.map((column) => (
                          <td key={column.key}>{displayTableColumnValue(column, record, records, props.users, currencies)}</td>
                        ))}
                        <td>{formatDate(record.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredRecords.length === 0 && <div className="empty-state">当前对象下还没有记录</div>}
              </>
              )}
            </section>
            )}

            {recordPanelMode !== "closed" && (
            <aside className={`detail-panel record-drawer ${recordPanelMode === "import" ? "import-drawer-modal" : ""}`}>
              <div className="drawer-header record-panel-header">
                <button className="secondary-button" data-testid="record-panel-back" type="button" onClick={() => runAction(closeRecordPanel)}>
                  <ChevronLeft size={16} />
                  {recordReturnEmailThreadId ? "返回邮件" : "返回列表"}
                </button>
                <div className="record-panel-context">
                  <div className="subtle">当前对象</div>
                  <h2 className="page-title" style={{ fontSize: 18 }}>{activeObject.label}</h2>
                </div>
              </div>

              {recordPanelMode === "create" && (
              <section>
                <h3 className="panel-title">
                  新建{activeObject.label}
                </h3>
                <div className="form-grid" style={{ marginTop: 12 }}>
                  <label className="wide">
                    <span className="subtle">名称</span>
                    <input
                      className="input"
                      data-testid={`create-title-${activeObject.key}`}
                      value={createTitle}
                      onChange={(event) => setCreateTitle(event.target.value)}
                      placeholder={`输入${activeObject.label}名称`}
                    />
                  </label>
                  <OwnerSelect
                    disabled={!canManageViews}
                    testId={`create-owner-${activeObject.key}`}
                    users={props.users}
                    value={createOwnerId}
                    onChange={setCreateOwnerId}
                  />
                  {objectFormFields.map((field) => (
                    <FieldInput
                      key={`create-${field.id}`}
                      field={field}
                      value={createValues[field.key] ?? ""}
                      allRecords={records}
                      mediaAssets={mediaAssets}
                      users={props.users}
                      testId={`create-field-${activeObject.key}-${field.key}`}
                      onRecordsLoaded={mergeLoadedRecords}
                      onUploadMediaAssets={uploadMediaAssets}
                      onUpdateMediaAsset={(assetId, patch) => runAction(() => updateMediaAsset(assetId, patch))}
                      onDeleteMediaAsset={(asset) => { void runImmediateAction(() => deleteMediaAsset(asset)); }}
                      onChange={(nextValue) => setCreateValues((current) => ({ ...current, [field.key]: nextValue }))}
                    />
                  ))}
                  {activeObject.key === "quotes" ? (
                    <QuotePricingEditor
                      allRecords={records}
                      onRecordsLoaded={mergeLoadedRecords}
                      testIdPrefix="create-quote"
                      values={createValues}
                      onCurrencyChange={(nextCurrency) => setCreateValues((current) => convertQuoteFormCurrency(current, nextCurrency, currencyRecords))}
                      onChange={setCreateValues}
                    />
                  ) : null}
                  {activeObject.key === "contacts" ? (
                    <ContactMethodsEditor
                      testIdPrefix="create-contact-method"
                      value={createValues[contactMethodsValueKey] ?? ""}
                      onChange={(methods) => setCreateValues((current) => withContactMethodValues(current, methods))}
                    />
                  ) : null}
                  {activeObject.key === "companies" ? (
                    <>
                      <CompanyAddressesEditor
                        title="Billing address"
                        testIdPrefix="create-company-billing-address"
                        value={createValues[companyBillingAddressesValueKey] ?? ""}
                        onChange={(addresses) => setCreateValues((current) => withCompanyAddressValues(current, companyBillingAddressesValueKey, addresses))}
                      />
                      <CompanyAddressesEditor
                        title="Shipping address"
                        testIdPrefix="create-company-shipping-address"
                        value={createValues[companyShippingAddressesValueKey] ?? ""}
                        onChange={(addresses) => setCreateValues((current) => withCompanyAddressValues(current, companyShippingAddressesValueKey, addresses))}
                      />
                    </>
                  ) : null}
                </div>
                <div className="toolbar" style={{ marginTop: 12 }}>
                  <button
                    className="primary-button"
                    data-testid={`create-record-${activeObject.key}`}
                    type="button"
                    onClick={() => runAction(submitCreateRecord)}
                    disabled={isPending || !createTitle.trim()}
                  >
                    <Save size={16} />
                    保存新记录
                  </button>
                </div>
              </section>
              )}

              {recordPanelMode === "detail" && (
              <section>
                <h3 className="panel-title">
                  {selectedRecord ? `编辑${activeObject.label}` : `选择一个${activeObject.label}`}
                </h3>
                {selectedRecord ? (
                  <>
                    {isPoolEnabledForObject(selectedRecord.objectKey, props.poolSettings) ? (
                      <RecordPoolPanel
                        currentUserId={props.contextUser.id}
                        disabled={isPending}
                        record={selectedRecord}
                        users={props.users}
                        canManagePool={props.role.permissions.includes("crm.pool.manage")}
                        onClaim={() => runAction(() => applyRecordPoolAction("claim", selectedRecord))}
                        onRelease={() => runAction(() => applyRecordPoolAction("release", selectedRecord))}
                        onTransfer={(ownerId) => runAction(() => transferRecordOwner(selectedRecord, ownerId))}
                      />
                    ) : null}
                    {selectedRecordPendingDeleteRequest ? (
                      <RecordDeletePendingBanner
                        disabled={isPending}
                        request={selectedRecordPendingDeleteRequest}
                        onCancel={(request) => { void runImmediateAction(() => cancelRecordChangeRequest(request)); }}
                      />
                    ) : null}
                    {selectedRecordPendingUpdateRequest ? (
                      <RecordUpdatePendingBanner
                        fields={selectedFields}
                        record={selectedRecord}
                        request={selectedRecordPendingUpdateRequest}
                        users={props.users}
                        onCancel={(request) => { void runImmediateAction(() => cancelRecordChangeRequest(request)); }}
                        disabled={isPending || isRecordSavePending}
                      />
                    ) : null}
                    {selectedRecord.objectKey === "contacts" || selectedRecord.objectKey === "companies" || selectedRecord.objectKey === "deals" ? (
                      <div className="section" style={{ marginBottom: 12 }}>
                        <div className="stage-header">
                          <div>
                            <strong>自动化跟进</strong>
                            <div className="subtle">基于当前记录生成或运行客户跟进、营销培育、交易推进流程。</div>
                          </div>
                          <button className="secondary-button" data-testid={`record-automation-${selectedRecord.id}`} type="button" onClick={() => openAutomationForRecord(selectedRecord)}>
                            <WorkflowIcon size={16} />
                            为此记录创建自动化
                          </button>
                        </div>
                        {selectedRecordWorkflows.length ? (
                          <div className="record-workflow-list">
                            {selectedRecordWorkflows.map((workflow) => (
                              <button className="record-workflow-card" key={workflow.id} type="button" onClick={() => openAutomationForRecord(selectedRecord, workflow.id)}>
                                <span>
                                  <strong>{workflow.name}</strong>
                                  <small>{workflow.goal}</small>
                                </span>
                                <span className={workflow.status === "active" ? "badge" : "subtle-badge"}>{workflow.status}</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="empty-state compact">暂无绑定到此记录的自动化流程。</div>
                        )}
                      </div>
                    ) : null}
                    {selectedRecord.objectKey === "contacts" || selectedRecord.objectKey === "companies" || selectedRecord.objectKey === "deals" ? (
                      <SmartReminderPanel
                        compact
                        generating={isGeneratingSmartReminders}
                        reminders={selectedRecordSmartReminders}
                        title="AI 跟进提醒"
                        emptyMessage="暂无当前记录提醒。可手动刷新生成此记录的跟进建议。"
                        onComplete={(reminder) => runAction(() => updateSmartReminder(reminder, { status: "done" }))}
                        onConvertTask={(reminder) => runAction(() => convertSmartReminderToTask(reminder))}
                        onDismiss={(reminder) => runAction(() => updateSmartReminder(reminder, { status: "dismissed" }))}
                        onGenerate={() => runAction(() => generateSmartReminders({ objectKey: selectedRecord.objectKey, recordId: selectedRecord.id }))}
                        onOpenRecord={(reminder) => runAction(() => openSmartReminderRecord(reminder))}
                        onSnooze={(reminder) => runAction(() => snoozeSmartReminder(reminder))}
                      />
                    ) : null}
                    {selectedRecord.objectKey === "contacts" ? (
                      <>
                        <ContactProfileEditor
                          allRecords={records}
                          canManageOwners={canManageViews}
                          contactMethodValue={editValues[contactMethodsValueKey] ?? ""}
                          fields={selectedFormFields}
                          isPending={isPending || isRecordSavePending}
                          mediaAssets={mediaAssets}
                          ownerId={editOwnerId}
                          pendingDeleteRequest={selectedRecordPendingDeleteRequest}
                          pendingUpdateRequest={selectedRecordPendingUpdateRequest}
                          record={selectedRecord}
                          saveLabel={editApprovalObjectKeys.has(selectedRecord.objectKey) ? "提交修改审批" : "保存"}
                          title={editTitle}
                          users={props.users}
                          values={editValues}
                          onCancelDeleteRequest={(request) => { void runImmediateAction(() => cancelRecordChangeRequest(request)); }}
                          onContactMethodsChange={(methods) => setEditValues((current) => withContactMethodValues(current, methods))}
                          onDelete={() => { void runImmediateAction(submitDeleteRecord); }}
                          onOwnerChange={setEditOwnerId}
                          onRecordsLoaded={mergeLoadedRecords}
                          onSave={() => runRecordSaveAction(submitUpdateRecord)}
                          onSaveField={submitSingleRecordField}
                          onSaveOwner={submitSingleRecordOwner}
                          onTitleChange={setEditTitle}
                          onUpdateMediaAsset={(assetId, patch) => runAction(() => updateMediaAsset(assetId, patch))}
                          onDeleteMediaAsset={(asset) => { void runImmediateAction(() => deleteMediaAsset(asset)); }}
                          onUploadMediaAssets={uploadMediaAssets}
                          onValueChange={(fieldKey, nextValue) => setEditValues((current) => ({ ...current, [fieldKey]: nextValue }))}
                          showContactMethodEditor={selectedRecordQuickContactMethods.length === 0}
                        />
                        <ContactDetailActivityTabs
                          activeTab={contactDetailActivityTab}
                          activityCount={selectedActivities.length}
                          callCount={selectedCalls.length}
                          emailCount={selectedRecordVisibleEmailThreads.length}
                          noteCount={selectedNotes.length}
                          onChange={setContactDetailActivityTab}
                          taskCount={selectedTasks.length}
                        />
                      </>
                    ) : selectedRecord.objectKey === "companies" ? (
                      <>
                        <CompanyProfileEditor
                          allRecords={records}
                          billingAddressEditingId={companyAddressEditing?.valueKey === companyBillingAddressesValueKey ? companyAddressEditing.addressId : ""}
                          billingAddressValue={editValues[companyBillingAddressesValueKey] ?? ""}
                          canManageOwners={canManageViews}
                          contacts={selectedCompanyContacts}
                          fields={selectedFormFields}
                          isPending={isPending || isRecordSavePending}
                          mediaAssets={mediaAssets}
                          ownerId={editOwnerId}
                          pendingDeleteRequest={selectedRecordPendingDeleteRequest}
                          pendingUpdateRequest={selectedRecordPendingUpdateRequest}
                          primaryContactId={editValues[companyPrimaryContactValueKey] ?? ""}
                          record={selectedRecord}
                          saveLabel={editApprovalObjectKeys.has(selectedRecord.objectKey) ? "提交修改审批" : "保存"}
                          shippingAddressEditingId={companyAddressEditing?.valueKey === companyShippingAddressesValueKey ? companyAddressEditing.addressId : ""}
                          shippingAddressValue={editValues[companyShippingAddressesValueKey] ?? ""}
                          title={editTitle}
                          users={props.users}
                          values={editValues}
                          onAddBillingAddress={() => setCompanyAddressEditing({ valueKey: companyBillingAddressesValueKey, addressId: createCompanyAddressId() })}
                          onAddShippingAddress={() => setCompanyAddressEditing({ valueKey: companyShippingAddressesValueKey, addressId: createCompanyAddressId() })}
                          onBillingAddressesChange={(addresses) => setEditValues((current) => withCompanyAddressValues(current, companyBillingAddressesValueKey, addresses))}
                          onCancelAddressEdit={() => setCompanyAddressEditing(null)}
                          onCancelDeleteRequest={(request) => { void runImmediateAction(() => cancelRecordChangeRequest(request)); }}
                          onDelete={() => { void runImmediateAction(submitDeleteRecord); }}
                          onDeleteMediaAsset={(asset) => { void runImmediateAction(() => deleteMediaAsset(asset)); }}
                          onEditBillingAddress={(addressId) =>
                            setCompanyAddressEditing((current) =>
                              current?.valueKey === companyBillingAddressesValueKey && current.addressId === addressId
                                ? null
                                : { valueKey: companyBillingAddressesValueKey, addressId }
                            )
                          }
                          onEditShippingAddress={(addressId) =>
                            setCompanyAddressEditing((current) =>
                              current?.valueKey === companyShippingAddressesValueKey && current.addressId === addressId
                                ? null
                                : { valueKey: companyShippingAddressesValueKey, addressId }
                            )
                          }
                          onOwnerChange={setEditOwnerId}
                          onPrimaryContactChange={(contactId) => setEditValues((current) => ({ ...current, [companyPrimaryContactValueKey]: contactId }))}
                          onRecordsLoaded={mergeLoadedRecords}
                          onSave={() => runRecordSaveAction(submitUpdateRecord)}
                          onSaveField={submitSingleRecordField}
                          onSaveOwner={submitSingleRecordOwner}
                          onShippingAddressesChange={(addresses) => setEditValues((current) => withCompanyAddressValues(current, companyShippingAddressesValueKey, addresses))}
                          onTitleChange={setEditTitle}
                          onUpdateMediaAsset={(assetId, patch) => runAction(() => updateMediaAsset(assetId, patch))}
                          onUploadMediaAssets={uploadMediaAssets}
                          onValueChange={(fieldKey, nextValue) => setEditValues((current) => ({ ...current, [fieldKey]: nextValue }))}
                        />
                        <ContactDetailActivityTabs
                          activeTab={contactDetailActivityTab}
                          activityCount={selectedActivities.length}
                          callCount={selectedCalls.length}
                          emailCount={selectedRecordVisibleEmailThreads.length}
                          noteCount={selectedNotes.length}
                          onChange={setContactDetailActivityTab}
                          taskCount={selectedTasks.length}
                        />
                      </>
                    ) : selectedRecord.objectKey === "deals" ? (
                      <>
                        <DealProfileEditor
                          allRecords={records}
                          canManageOwners={canManageViews}
                          fields={selectedFormFields}
                          isPending={isPending || isRecordSavePending}
                          mediaAssets={mediaAssets}
                          ownerId={editOwnerId}
                          pendingDeleteRequest={selectedRecordPendingDeleteRequest}
                          pendingUpdateRequest={selectedRecordPendingUpdateRequest}
                          pipelineName={activePipeline?.name}
                          record={selectedRecord}
                          saveLabel={editApprovalObjectKeys.has(selectedRecord.objectKey) ? "提交修改审批" : "保存"}
                          stages={activePipelineStages}
                          title={editTitle}
                          users={props.users}
                          values={editValues}
                          onCancelDeleteRequest={(request) => { void runImmediateAction(() => cancelRecordChangeRequest(request)); }}
                          onDelete={() => { void runImmediateAction(submitDeleteRecord); }}
                          onDeleteMediaAsset={(asset) => { void runImmediateAction(() => deleteMediaAsset(asset)); }}
                          onMoveStage={(stageKey) => runAction(() => moveDealStage(selectedRecord, stageKey))}
                          onOwnerChange={setEditOwnerId}
                          onRecordsLoaded={mergeLoadedRecords}
                          onSave={() => runRecordSaveAction(submitUpdateRecord)}
                          onSaveField={submitSingleRecordField}
                          onSaveOwner={submitSingleRecordOwner}
                          onTitleChange={setEditTitle}
                          onUpdateMediaAsset={(assetId, patch) => runAction(() => updateMediaAsset(assetId, patch))}
                          onUploadMediaAssets={uploadMediaAssets}
                        />
                        <ContactDetailActivityTabs
                          activeTab={contactDetailActivityTab}
                          activityCount={selectedActivities.length}
                          callCount={selectedCalls.length}
                          emailCount={selectedRecordVisibleEmailThreads.length}
                          noteCount={selectedNotes.length}
                          onChange={setContactDetailActivityTab}
                          taskCount={selectedTasks.length}
                        />
                      </>
                    ) : (
                    <>
                    <div className="form-grid" style={{ marginTop: 12 }}>
                      <label className="wide">
                        <span className="subtle">名称</span>
                        <input className="input" data-testid="edit-record-title" value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
                      </label>
                      <EditableOwnerRow
                        canEdit={canManageViews}
                        disabled={!canManageViews}
                        isPending={isPending || isRecordSavePending}
                        ownerName={ownerLabel(editOwnerId || undefined, props.users)}
                        testId="edit-record-owner"
                        users={props.users}
                        value={editOwnerId}
                        onChange={setEditOwnerId}
                        onSave={submitSingleRecordOwner}
                      />
                      {selectedRecord.objectKey === "deals" && activePipelineStages.length > 0 && (
                        <label>
                          <span className="subtle">阶段</span>
                          <select
                            className="select"
                            data-testid="edit-stage"
                            value={String(editValues.__stageKey ?? selectedRecord.stageKey ?? "")}
                            onChange={(event) => setEditValues((current) => ({ ...current, __stageKey: event.target.value }))}
                          >
                            {activePipelineStages.map((stage) => (
                              <option key={stage.key} value={stage.key}>
                                {stage.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {selectedFormFields.map((field) => (
                        <EditableFieldRow
                          key={`edit-${field.id}`}
                          field={field}
                          value={editValues[field.key] ?? ""}
                          allRecords={records}
                          mediaAssets={mediaAssets}
                          users={props.users}
                          testId={`edit-field-${selectedRecord.objectKey}-${field.key}`}
                          onRecordsLoaded={mergeLoadedRecords}
                          onUploadMediaAssets={uploadMediaAssets}
                          onUpdateMediaAsset={(assetId, patch) => runAction(() => updateMediaAsset(assetId, patch))}
                          onDeleteMediaAsset={(asset) => { void runImmediateAction(() => deleteMediaAsset(asset)); }}
                          onSave={(nextValue) => submitSingleRecordField(field, nextValue)}
                        />
                      ))}
                      {selectedRecord.objectKey === "quotes" ? (
                        <QuotePricingEditor
                          allRecords={records}
                          onRecordsLoaded={mergeLoadedRecords}
                          testIdPrefix="edit-quote"
                          values={editValues}
                          onCurrencyChange={(nextCurrency) => setEditValues((current) => convertQuoteFormCurrency(current, nextCurrency, currencyRecords))}
                          onChange={setEditValues}
                        />
                      ) : null}
                      {selectedRecord.objectKey === "contacts" && selectedRecordQuickContactMethods.length === 0 ? (
                        <ContactMethodsEditor
                          testIdPrefix="edit-contact-method"
                          value={editValues[contactMethodsValueKey] ?? ""}
                          onChange={(methods) => setEditValues((current) => withContactMethodValues(current, methods))}
                        />
                      ) : null}
                      {selectedRecord.objectKey === "companies" ? (
                        <>
                          <CompanyPrimaryContactSelect
                            contacts={selectedCompanyContacts}
                            value={editValues[companyPrimaryContactValueKey] ?? ""}
                            onChange={(contactId) => setEditValues((current) => ({ ...current, [companyPrimaryContactValueKey]: contactId }))}
                          />
                          <CompanyAddressCards
                            title="Billing address"
                            testIdPrefix="edit-company-billing-address"
                            value={editValues[companyBillingAddressesValueKey] ?? ""}
                            editingAddressId={companyAddressEditing?.valueKey === companyBillingAddressesValueKey ? companyAddressEditing.addressId : ""}
                            onAdd={() => setCompanyAddressEditing({ valueKey: companyBillingAddressesValueKey, addressId: createCompanyAddressId() })}
                            onEdit={(addressId) =>
                              setCompanyAddressEditing((current) =>
                                current?.valueKey === companyBillingAddressesValueKey && current.addressId === addressId
                                  ? null
                                  : { valueKey: companyBillingAddressesValueKey, addressId }
                              )
                            }
                            onCancel={() => setCompanyAddressEditing(null)}
                            onChange={(addresses) => setEditValues((current) => withCompanyAddressValues(current, companyBillingAddressesValueKey, addresses))}
                          />
                          <CompanyAddressCards
                            title="Shipping address"
                            testIdPrefix="edit-company-shipping-address"
                            value={editValues[companyShippingAddressesValueKey] ?? ""}
                            editingAddressId={companyAddressEditing?.valueKey === companyShippingAddressesValueKey ? companyAddressEditing.addressId : ""}
                            onAdd={() => setCompanyAddressEditing({ valueKey: companyShippingAddressesValueKey, addressId: createCompanyAddressId() })}
                            onEdit={(addressId) =>
                              setCompanyAddressEditing((current) =>
                                current?.valueKey === companyShippingAddressesValueKey && current.addressId === addressId
                                  ? null
                                  : { valueKey: companyShippingAddressesValueKey, addressId }
                              )
                            }
                            onCancel={() => setCompanyAddressEditing(null)}
                            onChange={(addresses) => setEditValues((current) => withCompanyAddressValues(current, companyShippingAddressesValueKey, addresses))}
                          />
                        </>
                      ) : null}
                    </div>
                    <div className="toolbar" style={{ marginTop: 12 }}>
                      <button className="primary-button" data-testid="edit-record-save" type="button" onClick={() => runAction(submitUpdateRecord)} disabled={isPending || !editTitle.trim()}>
                        <Save size={16} />
                        保存
                      </button>
                      {selectedRecordPendingDeleteRequest ? (
                        <button className="danger-button" data-testid="edit-record-cancel-delete-request" type="button" onClick={() => { void runImmediateAction(() => cancelRecordChangeRequest(selectedRecordPendingDeleteRequest)); }} disabled={isPending}>
                          <RotateCcw size={16} />
                          取消申请
                        </button>
                      ) : (
                        <button className="danger-button" data-testid="edit-record-delete" type="button" onClick={() => { void runImmediateAction(submitDeleteRecord); }} disabled={isPending}>
                          <Trash2 size={16} />
                          删除
                        </button>
                      )}
                      {selectedDealNextStage && selectedRecord && (
                        <button
                          className="secondary-button"
                          data-testid="move-deal-next-stage"
                          type="button"
                          onClick={() => runAction(() => moveDealStage(selectedRecord, selectedDealNextStage.key))}
                          disabled={isPending}
                        >
                          <ChevronRight size={16} />
                          推进到{selectedDealNextStage.label}
                        </button>
                      )}
                    </div>
                    </>
                    )}

                    {selectedRecordQuickContactMethods.length > 0 && (!selectedRecordUsesActivityTabs || showContactAllSections) ? (
                      <>
                        <ContactMethodsQuickActions
                          methods={selectedRecordQuickContactMethods}
                          record={selectedRecord}
                          onComposeEmail={(emailAddress) => composeEmailForRecord(selectedRecord, emailAddress)}
                          onFilterEmail={(emailAddress) => setRecordEmailActivityFilter(emailAddress)}
                          onStartWhatsApp={(method) => openContactFollowUp(selectedRecord, method, "whatsapp")}
                          onStartCall={(method) => openContactFollowUp(selectedRecord, method, "call")}
                          onEditMethod={toggleQuickContactMethodEditor}
                          editingMethodId={contactMethodEditingId}
                          editingRecordId={contactMethodEditingRecordId}
                        />
                        {contactMethodEditingId ? (
                          <section className="quick-contact-editor-panel" data-testid="quick-contact-method-editor">
                            <ContactMethodSingleEditor
                              testIdPrefix="quick-contact-method-single"
                              value={contactMethodEditingValue}
                              methodId={contactMethodEditingId}
                              onCancel={closeContactMethodEditor}
                              onChange={(methods) => setContactMethodEditingValue(JSON.stringify(normalizePrimaryContactMethods(methods)))}
                            />
                            <div className="toolbar" style={{ marginTop: 10 }}>
                              <button className="primary-button" type="button" onClick={() => runAction(saveContactMethodEditor)} disabled={isPending}>
                                <Save size={16} />
                                保存联系方式
                              </button>
                              <button className="secondary-button" type="button" onClick={closeContactMethodEditor}>
                                取消
                              </button>
                            </div>
                          </section>
                        ) : null}
                      {selectedRecord.objectKey === "contacts" ? (
                        <div className="toolbar" style={{ marginTop: 8 }}>
                          <button className="secondary-button" type="button" onClick={() => startNewContactMethodEditor(selectedRecord)}>
                            <UserPlus size={16} />
                            新增联系方式
                          </button>
                        </div>
                      ) : null}
                      </>
                    ) : null}

                    {selectedRecord.objectKey === "companies" && showContactAllSections && (
                      <section style={{ marginTop: 16 }}>
                        <div className="stage-header" style={{ marginBottom: 8 }}>
                          <div className="property-name">公司联系人</div>
                          <button className="secondary-button" type="button" onClick={() => startCreateContactForCompany(selectedRecord)}>
                            <UserPlus size={16} />
                            新增联系人
                          </button>
                        </div>
                        {selectedCompanyPrimaryContact ? (
                          <button
                            className="settings-item record-title"
                            data-testid="company-primary-contact-link"
                            type="button"
                            onClick={() => openRecord(selectedCompanyPrimaryContact)}
                          >
                            <strong>主联系人：{formatEmailContactLabel(selectedCompanyPrimaryContact, getPrimaryRecordEmail(selectedCompanyPrimaryContact))}</strong>
                            <div className="subtle">给公司发邮件时默认发送给此联系人</div>
                          </button>
                        ) : (
                          <div className="empty-state">暂无主联系人。可先在联系人中关联此公司，再回到公司编辑主联系人。</div>
                        )}
                        {selectedCompanyContacts.length > 0 ? (
                          <div className="settings-list" style={{ marginTop: 8 }}>
                            {selectedCompanyContacts.map((contact) => (
                              <button
                                className="settings-item record-title"
                                data-testid={`company-contact-${contact.id}`}
                                key={contact.id}
                                type="button"
                                onClick={() => openRecord(contact)}
                              >
                                <strong>{formatEmailContactLabel(contact, getPrimaryRecordEmail(contact))}</strong>
                                <div className="subtle">{contact.id === selectedCompanyPrimaryContact?.id ? "主联系人" : "关联联系人"}</div>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </section>
                    )}

                    {(selectedRecordEmailAddresses.length > 0 || selectedRecordEmailThreads.length > 0) && (!selectedRecordUsesActivityTabs || showContactEmailSections) && (
                      <section className={selectedRecordUsesActivityTabs ? "contact-detail-tab-panel" : ""} style={{ marginTop: 16 }}>
                        <div className="property-name" style={{ marginBottom: 8 }}>
                          邮件活动
                        </div>
                        {selectedRecordEmailAddresses.length > 0 ? (
                          <div className="toolbar" style={{ marginBottom: 10 }}>
                            <button
                              className={`secondary-button ${recordEmailActivityFilter ? "" : "active"}`}
                              data-testid={`record-email-filter-all-${selectedRecord.id}`}
                              type="button"
                              onClick={() => setRecordEmailActivityFilter("")}
                            >
                              <MailOpen size={16} />
                              全部邮箱
                            </button>
                            {selectedRecordEmailAddresses.map((emailAddress) => (
                              <button
                                className={`secondary-button ${recordEmailActivityFilter.toLowerCase() === emailAddress.toLowerCase() ? "active" : ""}`}
                                data-testid={`record-email-filter-${selectedRecord.id}-${sanitizeTestId(emailAddress)}`}
                                key={emailAddress}
                                type="button"
                                onClick={() => setRecordEmailActivityFilter(emailAddress)}
                              >
                                <Mail size={16} />
                                {emailAddress}
                              </button>
                            ))}
                            <button
                              className="secondary-button"
                              data-testid={`record-email-compose-${selectedRecord.id}`}
                              type="button"
                              onClick={() => composeEmailForRecord(selectedRecord, recordEmailActivityFilter || (selectedRecordEmailAddresses[0] ?? ""))}
                              disabled={!recordEmailActivityFilter && selectedRecordEmailAddresses.length === 0}
                            >
                              <Send size={16} />
                              写邮件
                            </button>
                          </div>
                        ) : null}
                        {selectedRecordVisibleEmailThreads.length > 0 ? (
                          <div className="settings-list">
                            {selectedRecordVisibleEmailThreads.map((thread) => {
                              const threadState = emailThreadUiStateFromThread(thread);
                              const threadMessages = emailMessagesByThread[thread.id] ?? [];
                              const threadCategory = threadState.category ?? inferEmailThreadCategory(thread, threadMessages);
                              const threadLabels = getEmailThreadDisplayLabels(thread, threadState, threadMessages);
                              return (
                                <button
                                  className="settings-item record-title record-email-thread-card"
                                  data-testid={`record-email-thread-${thread.id}`}
                                  key={thread.id}
                                  type="button"
                                  onClick={() => runAction(() => openEmailThread(thread.id))}
                                >
                                  <strong>{thread.subject}</strong>
                                  <div className="subtle">
                                    {thread.participantEmails.join(", ")}
                                    {thread.lastMessageAt ? ` · ${formatDate(thread.lastMessageAt)}` : ""}
                                  </div>
                                  <div className="toolbar record-email-thread-markers">
                                    <span className="badge">类别：{getEmailCategoryLabel(threadCategory)}</span>
                                    {threadState.starred ? <span className="badge">星标</span> : null}
                                    {threadState.important ? <span className="badge">重要</span> : null}
                                    {threadLabels.map((label) => (
                                      <span className="badge" key={label}>{label}</span>
                                    ))}
                                  </div>
                                  {thread.summary ? <div>{thread.summary}</div> : null}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="empty-state">{recordEmailActivityFilter ? "当前邮箱没有关联邮件线程" : "暂无关联邮件线程"}</div>
                        )}
                      </section>
                    )}

                    {selectedRecord.objectKey === "deals" && showContactAllSections && (
                      <section style={{ marginTop: 16 }}>
                        <div className="property-name" style={{ marginBottom: 8 }}>
                          赢输关闭
                        </div>
                        <div className="activity-item">
                          <div className="activity-meta">
                            当前状态: {dealStatusLabel(selectedRecord)}
                            {selectedRecord.data.closedAt ? ` · ${formatDate(String(selectedRecord.data.closedAt))}` : ""}
                          </div>
                          <label style={{ display: "block", marginTop: 10 }}>
                            <span className="subtle">赢输原因</span>
                            <input className="input" value={dealCloseReason} onChange={(event) => setDealCloseReason(event.target.value)} />
                          </label>
                          <div className="toolbar" style={{ marginTop: 12 }}>
                            <button className="primary-button" type="button" onClick={() => runAction(() => closeDeal(selectedRecord, "won"))} disabled={isPending}>
                              <Trophy size={16} />
                              标记赢单
                            </button>
                            <button className="danger-button" type="button" onClick={() => runAction(() => closeDeal(selectedRecord, "lost"))} disabled={isPending || !dealCloseReason.trim()}>
                              <XCircle size={16} />
                              标记输单
                            </button>
                          </div>
                        </div>
                      </section>
                    )}

                    {(!selectedRecordUsesActivityTabs || showContactAllSections) ? (
                    <section style={{ marginTop: 16 }}>
                      <div className="property-name" style={{ marginBottom: 8 }}>
                        关联记录
                      </div>
                      {relatedRecords.length > 0 ? (
                        <div className="settings-list">
                          {relatedRecords.map((item) => (
                            <button
                              key={`${item.label}-${item.record.id}`}
                              className="settings-item record-title"
                              type="button"
                              onClick={() => openRecord(item.record)}
                            >
                              <strong>{item.record.title}</strong>
                              <div className="subtle">
                                {item.label} · {props.objects.find((object) => object.key === item.record.objectKey)?.label ?? item.record.objectKey}
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-state">暂无关联记录</div>
                      )}
                    </section>
                    ) : null}

                    {(!selectedRecordUsesActivityTabs || showContactAllSections || showContactTaskSections || showContactNoteSections || showContactCallSections) ? (
                    <div className={`record-activity-grid ${selectedRecordUsesActivityTabs ? "contact-detail-tab-panel" : ""}`}>
                      {(!selectedRecordUsesActivityTabs || showContactTaskSections) ? (
                      <section className="record-activity-card">
                        <RecordSectionHeader
                          title="任务"
                          addLabel="添加任务"
                          isOpen={recordActivityComposerType === "task"}
                          onToggle={() => setRecordActivityComposerType((current) => (current === "task" ? "" : "task"))}
                        />
                        {recordActivityComposerType === "task" ? (
                          <RecordActivityComposer
                            type="task"
                            submitLabel="添加任务"
                            titlePlaceholder="例如：跟进报价确认"
                            bodyPlaceholder="任务说明、需要准备的资料或下一步动作"
                            dateLabel="截止日期"
                            isPending={isPending}
                            mediaAssets={mediaAssets}
                            testIdPrefix="record-task"
                            onUploadMediaAssets={uploadMediaAssets}
                            onSubmit={(input) =>
                              runAction(async () => {
                                await createRecordActivity({ recordId: selectedRecord.id, ...input });
                                setRecordActivityComposerType("");
                                setMessage("已添加任务");
                                router.refresh();
                              })
                            }
                          />
                        ) : null}
                        <TaskList
                          activities={selectedTasks}
                          emptyMessage="暂无任务"
                          mediaAssets={mediaAssets}
                          pendingDeleteRequestsById={pendingActivityDeleteRequestsById}
                          testIdPrefix="record-task"
                          users={props.users}
                          onArchive={(activity, archived) => runAction(() => toggleTaskArchive(activity, archived))}
                          onDelete={(activity) => { void runImmediateAction(() => deleteTask(activity)); }}
                          onEdit={(activity) => {
                            navigateToWorkspace("tasks");
                            showToast({ intent: "info", message: `请在任务工作台中编辑“${activity.title}”。` });
                          }}
                          onToggle={(activity, completed) => runAction(() => toggleTaskCompletion(activity, completed))}
                        />
                      </section>
                      ) : null}

                      {(!selectedRecordUsesActivityTabs || showContactNoteSections) ? (
                      <section className="record-activity-card">
                        <RecordSectionHeader
                          title="备注"
                          addLabel="添加备注"
                          isOpen={recordActivityComposerType === "note"}
                          onToggle={() => setRecordActivityComposerType((current) => (current === "note" ? "" : "note"))}
                        />
                        {recordActivityComposerType === "note" ? (
                          <RecordActivityComposer
                            type="note"
                            submitLabel="添加备注"
                            titlePlaceholder="例如：客户偏好 / 背景补充"
                            bodyPlaceholder="记录沟通背景、需求、风险或内部观察"
                            isPending={isPending}
                            mediaAssets={mediaAssets}
                            testIdPrefix="record-note"
                            onUploadMediaAssets={uploadMediaAssets}
                            onSubmit={(input) =>
                              runAction(async () => {
                                await createRecordActivity({ recordId: selectedRecord.id, ...input });
                                setRecordActivityComposerType("");
                                setMessage("已添加备注");
                                router.refresh();
                              })
                            }
                          />
                        ) : null}
                        <ActivityList
                          activities={selectedNotes}
                          emptyMessage="暂无备注"
                          mediaAssets={mediaAssets}
                          pendingDeleteRequestsById={pendingActivityDeleteRequestsById}
                          testIdPrefix="record-note"
                          onDelete={(activity) => { void runImmediateAction(() => deleteTask(activity)); }}
                          renderMeta={(activity) => (
                            <>
                              <ActivityIcon size={15} />
                              {formatDateTimeSeconds(activity.createdAt)}
                            </>
                          )}
                        />
                      </section>
                      ) : null}

                      {(!selectedRecordUsesActivityTabs || showContactCallSections) ? (
                      <section className="record-activity-card">
                        <RecordSectionHeader
                          title="电话"
                          addLabel="添加电话记录"
                          isOpen={recordActivityComposerType === "call"}
                          onToggle={() => setRecordActivityComposerType((current) => (current === "call" ? "" : "call"))}
                        />
                        {recordActivityComposerType === "call" ? (
                          <RecordActivityComposer
                            type="call"
                            submitLabel="添加电话记录"
                            titlePlaceholder="例如：电话确认预算"
                            bodyPlaceholder="记录电话结论、异议、承诺事项"
                            isPending={isPending}
                            mediaAssets={mediaAssets}
                            testIdPrefix="record-call"
                            onUploadMediaAssets={uploadMediaAssets}
                            onSubmit={(input) =>
                              runAction(async () => {
                                await createRecordActivity({ recordId: selectedRecord.id, ...input });
                                setRecordActivityComposerType("");
                                setMessage("已添加电话记录");
                                router.refresh();
                              })
                            }
                          />
                        ) : null}
                        <ActivityList
                          activities={selectedCalls}
                          emptyMessage="暂无电话记录"
                          mediaAssets={mediaAssets}
                          pendingDeleteRequestsById={pendingActivityDeleteRequestsById}
                          testIdPrefix="record-call"
                          onDelete={(activity) => { void runImmediateAction(() => deleteTask(activity)); }}
                          renderMeta={(activity) => (
                            <>
                              <Phone size={15} />
                              {formatDateTimeSeconds(activity.createdAt)}
                            </>
                          )}
                        />
                      </section>
                      ) : null}

                      {(!selectedRecordUsesActivityTabs || showContactAllSections) ? (
                      <section className="record-activity-card">
                        <RecordSectionHeader
                          title="会议"
                          addLabel="添加会议记录"
                          isOpen={recordActivityComposerType === "meeting"}
                          onToggle={() => setRecordActivityComposerType((current) => (current === "meeting" ? "" : "meeting"))}
                        />
                        {recordActivityComposerType === "meeting" ? (
                          <RecordActivityComposer
                            type="meeting"
                            submitLabel="添加会议记录"
                            titlePlaceholder="例如：产品演示会议"
                            bodyPlaceholder="记录会议结论、参会人、待办事项"
                            dateLabel="会议日期"
                            isPending={isPending}
                            mediaAssets={mediaAssets}
                            testIdPrefix="record-meeting"
                            onUploadMediaAssets={uploadMediaAssets}
                            onSubmit={(input) =>
                              runAction(async () => {
                                await createRecordActivity({ recordId: selectedRecord.id, ...input });
                                setRecordActivityComposerType("");
                                setMessage("已添加会议记录");
                                router.refresh();
                              })
                            }
                          />
                        ) : null}
                        <ActivityList
                          activities={selectedMeetings}
                          emptyMessage="暂无会议记录"
                          mediaAssets={mediaAssets}
                          pendingDeleteRequestsById={pendingActivityDeleteRequestsById}
                          testIdPrefix="record-meeting"
                          onDelete={(activity) => { void runImmediateAction(() => deleteTask(activity)); }}
                          renderMeta={(activity) => (
                            <>
                              <CalendarClock size={15} />
                              {activity.dueAt ? formatDateTimeSeconds(activity.dueAt) : formatDateTimeSeconds(activity.createdAt)}
                            </>
                          )}
                        />
                      </section>
                      ) : null}
                    </div>
                    ) : null}

                    {(!selectedRecordUsesActivityTabs || showContactActivityTimeline) ? (
                      <ActivityTimeline
                        activities={selectedActivities}
                        emptyMessage="暂无活动"
                        mediaAssets={mediaAssets}
                        pendingDeleteRequestsById={pendingActivityDeleteRequestsById}
                        records={records}
                        testIdPrefix="record-activity"
                        onDelete={(activity) => { void runImmediateAction(() => deleteTask(activity)); }}
                      />
                    ) : null}

                    {coreObjects.has(selectedRecord.objectKey) && (!selectedRecordUsesActivityTabs || showContactAllSections) && (
                      <AiAssistant
                        record={selectedRecord}
                        fields={selectedFields}
                        activities={selectedActivities}
                        question={aiQuestion}
                        setQuestion={setAiQuestion}
                        allRecords={records}
                        users={props.users}
                        onOpenRecord={openRecord}
                      />
                    )}

                    {(!selectedRecordUsesActivityTabs || showContactAllSections) ? (
                    <TalkAboutThisPanel
                      target={{ type: "record", objectKey: selectedRecord.objectKey, recordId: selectedRecord.id, label: selectedRecord.title }}
                      disabled={isPending}
                      onOpenRecord={(source) => runAction(() => openTalkSourceRecord(source))}
                      onKnowledgeCreated={(article) => setKnowledgeArticles((current) => [article, ...current.filter((candidate) => candidate.id !== article.id)])}
                      onRequestConfirm={requestConfirm}
                      onShowToast={showToast}
                    />
                    ) : null}
                  </>
                ) : (
                  <div className="empty-state">请先从左侧列表选择一条记录</div>
                )}
              </section>
              )}

              {recordPanelMode === "import" && (
              <section>
                <h3 className="panel-title">
                  CSV 导入
                </h3>
                {canImport ? (
                  <>
                    <textarea
                      className="textarea"
                      data-testid="import-csv-input"
                      value={importCsv}
                      onChange={(event) => {
                        setImportCsv(event.target.value);
                        setImportPreview(null);
                      }}
                      style={{ marginTop: 12 }}
                    />
                    <label style={{ display: "block", marginTop: 12 }}>
                      <span className="subtle">导入策略</span>
                      <select
                        className="select"
                        data-testid="import-strategy-select"
                        value={importStrategy}
                        onChange={(event) => setImportStrategy(event.target.value as CsvImportStrategy)}
                      >
                        <option value="skip-invalid">跳过错误行</option>
                        <option value="update-existing">更新已有记录</option>
                        <option value="all-or-nothing">全部成功才导入</option>
                      </select>
                    </label>
                    <div className="form-grid" style={{ marginTop: 12 }}>
                      <label>
                        <span className="subtle">导入预设</span>
                        <select
                          className="select"
                          data-testid="import-preset-select"
                          value={selectedImportPresetId}
                          onChange={(event) => setSelectedImportPresetId(event.target.value)}
                        >
                          <option value="">选择预设</option>
                          {activeImportPresets.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.name} · {formatImportStrategy(preset.strategy)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="subtle">预设名称</span>
                        <input
                          className="input"
                          data-testid="import-preset-name"
                          value={importPresetName}
                          onChange={(event) => setImportPresetName(event.target.value)}
                          placeholder="例如：联系人标准导入"
                        />
                      </label>
                    </div>
                    <div className="toolbar compact-toolbar" style={{ marginTop: 10 }}>
                      <button className="secondary-button" data-testid="import-preset-apply" type="button" onClick={applyImportPreset} disabled={isPending || !selectedImportPresetId}>
                        <RotateCcw size={16} />
                        应用预设
                      </button>
                      <button className="secondary-button" data-testid="import-preset-save" type="button" onClick={() => runAction(saveOrUpdateImportPreset)} disabled={isPending || (!selectedImportPresetId && !importPresetName.trim())}>
                        <Save size={16} />
                        {selectedImportPresetId ? "覆盖预设" : "保存预设"}
                      </button>
                      <button className="secondary-button" data-testid="import-preset-delete" type="button" onClick={() => runAction(deleteImportPreset)} disabled={isPending || !selectedImportPresetId}>
                        <Trash2 size={16} />
                        删除预设
                      </button>
                    </div>
                    {importPreview ? (
                      <CsvMappingEditor
                        headers={importPreview.headers}
                        fields={objectFields}
                        mapping={importMapping}
                        onChange={setImportMapping}
                      />
                    ) : null}
                    {importStrategy === "all-or-nothing" && importPreview && importPreview.errorRows + importPreview.conflictRows > 0 ? (
                      <div className="subtle" style={{ marginTop: 8 }}>
                        “全部成功才导入”要求预览中的每一行都可导入。
                      </div>
                    ) : null}
                    <div className="toolbar" style={{ marginTop: 12 }}>
                      <a className="secondary-button" href={importTemplateUrl} download={`${activeObject.key}-import-template.csv`}>
                        <Download size={16} />
                        下载模板
                      </a>
                      <a className="secondary-button" href={importFieldGuideUrl} download={`${activeObject.key}-import-field-guide.csv`}>
                        <Download size={16} />
                        字段说明
                      </a>
                      <button className="secondary-button" data-testid="import-preview-submit" type="button" onClick={() => runAction(submitImportPreview)} disabled={isPending}>
                        <RefreshCw className={isPending ? "spin-icon" : undefined} size={16} />
                        预检 CSV
                      </button>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => runAction(submitImport)}
                        disabled={isPending || !importPreview || (importStrategy === "all-or-nothing" && importPreview.errorRows + importPreview.conflictRows > 0)}
                      >
                        <Upload size={16} />
                        导入当前对象
                      </button>
                      <button className="secondary-button" type="button" onClick={() => runAction(refreshImportJobs)} disabled={isPending}>
                        <RefreshCw className={isPending ? "spin-icon" : undefined} size={16} />
                        刷新任务
                      </button>
                    </div>
                    {importPreview && <CsvPreviewDetailed preview={importPreview} strategy={importStrategy} />}
                    <ImportJobList
                      jobs={activeImportJobs.slice(0, 5)}
                      users={props.users}
                      disabled={isPending}
                      selectedJobId={selectedActiveImportJob?.id}
                      onViewDetails={(job) => runAction(() => loadImportJobDetails(job))}
                      onCancel={(job) => runAction(() => submitImportJobAction(job, "cancel"))}
                      onRetry={(job) => runAction(() => submitImportJobAction(job, "retry"))}
                      onRerun={(job) => runAction(() => submitImportJobAction(job, "rerun"))}
                    />
                    {selectedActiveImportJob ? (
                      <section className="activity-item" data-testid="import-job-detail-panel" style={{ marginTop: 12 }}>
                        <div className="stage-header">
                          <strong>导入任务详情</strong>
                          <span className={selectedActiveImportJob.status === "failed" ? "danger-badge" : "badge"}>{formatImportJobStatus(selectedActiveImportJob.status)}</span>
                        </div>
                        <div className="subtle">
                          {selectedActiveImportJob.id} · {formatDate(selectedActiveImportJob.createdAt)}
                        </div>
                        <ImportJobDetails job={selectedActiveImportJob} defaultOpen />
                      </section>
                    ) : null}
                  </>
                ) : (
                  <div className="empty-state">当前账号没有 crm.import 权限，不能导入 CSV。</div>
                )}
              </section>
              )}
            </aside>
            )}
          </div>
        )}

        {activeNav === "email" && (
          <EmailWorkspace
            accounts={emailAccounts}
            signatures={emailSignatures}
            threads={emailThreads}
            messagesByThread={emailMessagesByThread}
            selectedThreadId={selectedEmailThreadId}
            detailThreadId={emailDetailThreadId}
            routeMailbox={routeEmailMailbox}
            routeCategory={routeEmailCategory}
            routeMailMode={routeEmailMode}
            routeAccountId={routeEmailAccountId}
            routeLabel={routeEmailLabel}
            routeSearch={routeEmailSearch}
            view={emailWorkspaceView}
            selectedRecord={selectedRecord}
            records={records}
            aiSettings={emailAiSettings}
            syncSettings={emailSyncSettings}
            accountDraft={emailAccountDraft}
            signatureDraft={emailSignatureDraft}
            emailDraft={emailDraft}
            composeOpenRequestKey={emailComposeOpenRequestKey}
            aiPurpose={emailAiPurpose}
            aiPrompt={emailAiPrompt}
            aiResult={emailAiResult}
            diagnostics={emailDiagnostics}
            connectionTestRun={emailConnectionTestRun}
            knowledgeArticles={knowledgeArticles}
            knowledgeDraft={knowledgeDraft}
            mediaAssets={mediaAssets}
            disabled={isPending}
            canManageEmailSettings={canManageEmailSettings}
            canManageAiSettings={canManageAiSettings}
            onAccountDraftChange={setEmailAccountDraft}
            onSignatureDraftChange={setEmailSignatureDraft}
            onEmailDraftChange={setEmailDraft}
            onComposeClosed={closeEmailComposeRequest}
            onKnowledgeDraftChange={setKnowledgeDraft}
            onUploadMediaAssets={uploadMediaAssets}
            onAiPurposeChange={setEmailAiPurpose}
            onAiPromptChange={setEmailAiPrompt}
            onViewChange={setEmailWorkspaceView}
            onRouteChange={(patch) => {
              const nextPath = buildEmailRoutePath(patch);
              if (`${pathname}?${searchParams.toString()}` !== nextPath) {
                router.push(nextPath);
              }
            }}
            onLoadThreadMessages={(threadId) => loadEmailMessages(threadId)}
            onSelectThread={(threadId) => {
              selectEmailThread(threadId);
              if (!emailMessagesByThread[threadId]) {
                runAction(() => loadEmailMessages(threadId));
              }
            }}
            onUpdateThread={(threadId, recordId) => runAction(() => updateEmailThread(threadId, recordId))}
            onUpdateThreadState={(threadId, patch) => updateEmailThreadState(threadId, patch)}
            onDeleteThreads={(threadIds) => runImmediateAction(() => deleteEmailThreads(threadIds))}
            onCreateContactFromEmail={(threadId, emailAddress) => runAction(() => createContactFromEmail(threadId, emailAddress))}
            onLinkExistingContactFromEmail={(threadId, contactId, emailAddress) => runAction(() => linkExistingContactFromEmail(threadId, contactId, emailAddress))}
            onUnlinkContactEmailFromThread={(threadId, contactId, emailAddress) => runAction(() => unlinkContactEmailFromThread(threadId, contactId, emailAddress))}
            onOpenEmailContact={(threadId, contact) => openEmailContact(threadId, contact)}
            onOpenTalkSourceRecord={(source) => runAction(() => openTalkSourceRecord(source))}
            onCreateAccount={() => runAction(createEmailAccount)}
            onStartOAuth={() => runAction(startEmailOAuth)}
            onSyncAccount={(accountId) => runAction(() => syncEmailAccount(accountId))}
            onSyncAllAccounts={() => runAction(syncAllEmailAccounts)}
            onTestConnection={testEmailConnection}
            onEditAccount={(account) => {
              void editEmailAccount(account);
            }}
            onUpdateAccount={(accountId, patch) => runAction(() => updateEmailAccount(accountId, patch))}
            onUpdateAccountFromDraft={() => runAction(updateEmailAccountFromDraft)}
            onResetAccountDraft={() => setEmailAccountDraft(createEmptyEmailAccountDraft())}
            onSaveSignature={() => runAction(saveEmailSignatureFromDraft)}
            onEditSignature={(signature) => setEmailSignatureDraft(createEmailSignatureEditDraft(signature))}
            onDeleteSignature={(signature) => runAction(() => deleteEmailSignature(signature))}
            onResetSignatureDraft={() => setEmailSignatureDraft(createEmptyEmailSignatureDraft())}
            onSend={() => runAction(sendEmail)}
            onReplyToMessage={replyToEmailMessage}
            onRetryMessage={(messageId) => runAction(() => retryEmailMessage(messageId))}
            onGenerateAiForMessage={(message, purpose) => runAction(() => generateEmailAiForMessage(message, purpose))}
            onGenerateAi={() => runAction(generateEmailAi)}
            onGenerateAiForDraft={(prompt) => runAction(() => generateEmailAiForDraft(prompt))}
            onGenerateAiPromptForDraft={(prompt) => generateEmailAiPromptForDraft(prompt)}
            onOpenAiSource={(source) => runAction(() => openEmailAiSource(source))}
            onSummarizeThread={() => runAction(summarizeEmailThread)}
            onAnalyzeThread={() => runAction(analyzeEmailThread)}
            onRefreshDiagnostics={() => runAction(refreshEmailDiagnostics)}
            onTestAllConnections={() => runAction(testAllEmailConnections)}
            onCreateKnowledgeArticle={() => runAction(createKnowledgeArticle)}
            onUpdateKnowledgeArticle={(articleId, patch) => runAction(() => updateKnowledgeArticle(articleId, patch))}
            onKnowledgeArticleCreated={(article) => setKnowledgeArticles((current) => [article, ...current.filter((candidate) => candidate.id !== article.id)])}
            onUpdateMediaAsset={(assetId, patch) => runAction(() => updateMediaAsset(assetId, patch))}
            onDeleteMediaAsset={(asset) => { void runImmediateAction(() => deleteMediaAsset(asset)); }}
            onToggleAiFeature={(feature, enabled) => runAction(() => updateEmailAiFeature(feature, enabled))}
            onUpdateAiSettings={(patch) => runAction(() => updateEmailAiSettingsPatch(patch))}
            onUpdateSyncSettings={(patch) => runAction(() => updateEmailSyncSettingsPatch(patch))}
            onShowToast={showToast}
            onShowSuccess={showSuccess}
            onRequestConfirm={requestConfirm}
            onRequestPrompt={requestPrompt}
            sidebarCollapsed={appSidebarCollapsed}
            onToggleAppSidebar={toggleAppSidebar}
          />
        )}
        {activeNav === "tasks" && (
          <TaskView
            activities={filteredTaskActivities}
            mediaAssets={mediaAssets}
            pendingDeleteRequestsById={pendingActivityDeleteRequestsById}
            users={props.users}
            view={taskWorkspaceView}
            onToggle={(activity, completed) => runAction(() => toggleTaskCompletion(activity, completed))}
            onArchive={(activity, archived) => runAction(() => toggleTaskArchive(activity, archived))}
            onDelete={(activity) => { void runImmediateAction(() => deleteTask(activity)); }}
            onCreateTask={(input) => runAction(() => createTaskFromCalendar(input))}
            onUpdateTask={(activity, draft) => runAction(() => updateTask(activity, draft))}
            onUploadMediaAssets={uploadMediaAssets}
            onRequestPrompt={requestPrompt}
            onShowToast={showToast}
          />
        )}
        {activeNav === "activities" && (
          <ActivityTimeline
            activities={filteredActivities}
            mediaAssets={mediaAssets}
            pendingDeleteRequestsById={pendingActivityDeleteRequestsById}
            records={records}
            onDelete={(activity) => { void runImmediateAction(() => deleteTask(activity)); }}
          />
        )}
        {activeNav === "automation" && (
          <AutomationWorkspace
            workflows={props.workflows}
            workflowRuns={props.workflowRuns}
            workflowApprovals={props.workflowApprovals}
            records={records}
            emailAccounts={props.emailAccounts}
            users={props.users}
          />
        )}
        {activeNav === "settings" && (
          <SettingsAdmin
            role={props.role}
            objects={props.objects}
            fields={props.fields}
            relations={props.relations}
            pipelines={props.pipelines}
            savedViews={props.savedViews}
            records={records}
            activities={activities}
            roles={props.roles}
            users={props.users}
            teams={props.teams}
            apiKeys={props.apiKeys}
            webhooks={props.webhooks}
            notificationChannels={props.notificationChannels}
            emailAccounts={props.emailAccounts}
            emailAiSettings={emailAiSettings}
            auditLogs={props.auditLogs}
            backupFiles={props.backupFiles}
            importJobQueueSummary={props.importJobQueueSummary}
            poolSettings={props.poolSettings}
            smartReminderSettings={props.smartReminderSettings}
            recordChangeRequests={recordChangeRequests}
            workflows={props.workflows}
            workflowRuns={props.workflowRuns}
            workflowApprovals={props.workflowApprovals}
            onRecordsUpdated={mergeLoadedRecords}
          />
        )}

      </main>
      {exportDialogOpen && activeObject ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setExportDialogOpen(false)}>
          <div className="modal-card module-export-modal" role="dialog" aria-modal="true" aria-label={`导出${activeObject.pluralLabel}`} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header-row">
              <div>
                <h3 className="panel-title">导出{activeObject.pluralLabel}</h3>
                <p className="subtle">按照当前搜索、筛选、公海/私海和保存视图导出 CSV。</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setExportDialogOpen(false)} aria-label="关闭导出弹窗">
                <XCircle size={16} />
              </button>
            </div>
            <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button className="secondary-button" type="button" onClick={() => setExportDialogOpen(false)}>
                取消
              </button>
              <a className="primary-button" data-testid={`export-records-${activeObject.key}`} href={exportRecordsUrl} download={`${activeObject.key}-export.csv`} onClick={() => setExportDialogOpen(false)}>
                <Download size={16} />
                下载 CSV
              </a>
            </div>
          </div>
        </div>
      ) : null}
      <ContactFollowUpDialog
        draft={contactFollowUpDraft}
        generating={isContactFollowUpGenerating}
        mediaAssets={mediaAssets}
        onCancel={() => setContactFollowUpDraft(null)}
        onAttachmentsChange={(attachments) => setContactFollowUpDraft((current) => (current ? { ...current, attachments } : current))}
        onChange={(messageText) => setContactFollowUpDraft((current) => (current ? { ...current, message: messageText } : current))}
        onGenerate={() => runAction(generateContactFollowUpMessage)}
        onSubmit={() => runAction(submitContactFollowUp)}
        onUploadMediaAssets={uploadMediaAssets}
      />
      <DealPipelineActivityDialog
        deal={pipelineActivityDeal}
        isPending={isPending}
        mediaAssets={mediaAssets}
        type={pipelineActivityType}
        onCancel={() => setPipelineActivityDeal(null)}
        onSubmit={(input) => runAction(() => submitPipelineDealActivity(input))}
        onTypeChange={setPipelineActivityType}
        onUploadMediaAssets={uploadMediaAssets}
      />
      <ToastViewport toast={toast ?? (error ? { intent: "error", message: error } : message ? { intent: "success", message } : null)} onDismiss={() => { setToast(null); setMessage(null); setError(null); }} />
      <ConfirmDialog
        state={confirmDialog}
        onCancel={() => resolveConfirm(false)}
        onConfirm={() => resolveConfirm(true)}
      />
      <PromptDialog
        state={promptDialog}
        value={promptValue}
        onChange={setPromptValue}
        onCancel={() => resolvePrompt(null)}
        onConfirm={() => resolvePrompt(promptValue)}
      />
    </div>
  );
}

function ToastViewport({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  if (!toast) {
    return null;
  }
  return (
    <div className={`toast toast-${toast.intent}`} role="status" aria-live="polite">
      <span>{toast.message}</span>
      <button className="icon-button" aria-label="关闭提示" type="button" onClick={onDismiss}>
        <XCircle size={16} />
      </button>
    </div>
  );
}

function ConfirmDialog({
  state,
  onCancel,
  onConfirm
}: {
  state: ConfirmDialogState | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!state) {
    return null;
  }
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={state.title}>
      <div className="modal-panel app-dialog">
        <h2 className="page-title" style={{ fontSize: 18 }}>{state.title}</h2>
        <p>{state.message}</p>
        <div className="toolbar" style={{ justifyContent: "flex-end" }}>
          <button className="secondary-button" type="button" onClick={onCancel}>取消</button>
          <button className={state.danger ? "danger-button" : "primary-button"} type="button" onClick={onConfirm}>
            {state.confirmLabel ?? "确认"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptDialog({
  state,
  value,
  onChange,
  onCancel,
  onConfirm
}: {
  state: PromptDialogState | null;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!state) {
    return null;
  }
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={state.title}>
      <form
        className="modal-panel app-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <h2 className="page-title" style={{ fontSize: 18 }}>{state.title}</h2>
        <p>{state.message}</p>
        <input className="input" autoFocus value={value} onChange={(event) => onChange(event.target.value)} placeholder={state.placeholder} />
        <div className="toolbar" style={{ justifyContent: "flex-end" }}>
          <button className="secondary-button" type="button" onClick={onCancel}>取消</button>
          <button className="primary-button" type="submit" disabled={!value.trim()}>
            {state.confirmLabel ?? "确认"}
          </button>
        </div>
      </form>
    </div>
  );
}

function DealPipelineActivityDialog({
  deal,
  isPending,
  mediaAssets,
  type,
  onCancel,
  onSubmit,
  onTypeChange,
  onUploadMediaAssets
}: {
  deal: CrmRecord | null;
  isPending: boolean;
  mediaAssets: MediaAsset[];
  type: Activity["type"];
  onCancel: () => void;
  onSubmit: (input: RecordActivityComposerInput) => void;
  onTypeChange: (type: Activity["type"]) => void;
  onUploadMediaAssets: (files: FileList | File[] | null) => Promise<MediaAsset[]>;
}) {
  if (!deal) {
    return null;
  }

  const composerCopy: Record<Activity["type"], { submitLabel: string; titlePlaceholder: string; bodyPlaceholder: string; dateLabel?: string }> = {
    call: {
      submitLabel: "记录电话",
      titlePlaceholder: "例如：电话跟进报价反馈",
      bodyPlaceholder: "记录电话沟通内容、客户疑问和下一步计划"
    },
    email: {
      submitLabel: "记录邮件",
      titlePlaceholder: "例如：发送报价跟进邮件",
      bodyPlaceholder: "记录邮件沟通要点"
    },
    meeting: {
      submitLabel: "安排会议",
      titlePlaceholder: "例如：安排产品演示",
      bodyPlaceholder: "记录会议议程、参会人和准备事项",
      dateLabel: "会议日期"
    },
    note: {
      submitLabel: "保存备注",
      titlePlaceholder: "例如：客户需要补充价格明细",
      bodyPlaceholder: "记录补充说明、客户背景或跟进线索"
    },
    stage_change: {
      submitLabel: "记录阶段变更",
      titlePlaceholder: "例如：阶段变更说明",
      bodyPlaceholder: "记录阶段变化原因"
    },
    task: {
      submitLabel: "创建任务",
      titlePlaceholder: "例如：明天跟进报价反馈",
      bodyPlaceholder: "记录任务说明、目标和注意事项",
      dateLabel: "到期日期"
    }
  };
  const copy = composerCopy[type];

  return (
    <div className="modal-backdrop" data-testid="deal-pipeline-activity-dialog" role="dialog" aria-modal="true" aria-label="创建交易 Activity">
      <div className="modal-panel app-dialog">
        <div className="email-pane-header compact">
          <div>
            <h2 className="page-title" style={{ fontSize: 18 }}>创建 Activity</h2>
            <p className="subtle">{deal.title}</p>
          </div>
          <button className="icon-button" aria-label="关闭创建 Activity" type="button" onClick={onCancel}>
            <XCircle size={16} />
          </button>
        </div>
        <label>
          <span className="subtle">类型</span>
          <select className="input" value={type} onChange={(event) => onTypeChange(event.target.value as Activity["type"])}>
            <option value="note">备注</option>
            <option value="task">任务</option>
            <option value="call">电话</option>
            <option value="meeting">会议</option>
            <option value="email">邮件记录</option>
          </select>
        </label>
        <RecordActivityComposer
          bodyPlaceholder={copy.bodyPlaceholder}
          dateLabel={copy.dateLabel}
          isPending={isPending}
          key={type}
          mediaAssets={mediaAssets}
          submitLabel={copy.submitLabel}
          testIdPrefix="deal-pipeline-activity"
          titlePlaceholder={copy.titlePlaceholder}
          type={type}
          onSubmit={onSubmit}
          onUploadMediaAssets={onUploadMediaAssets}
        />
      </div>
    </div>
  );
}

function ContactFollowUpDialog({
  draft,
  generating,
  mediaAssets,
  onCancel,
  onAttachmentsChange,
  onChange,
  onGenerate,
  onSubmit,
  onUploadMediaAssets
}: {
  draft: ContactFollowUpDraft | null;
  generating: boolean;
  mediaAssets: MediaAsset[];
  onCancel: () => void;
  onAttachmentsChange: (attachments: ActivityAttachment[]) => void;
  onChange: (message: string) => void;
  onGenerate: () => void;
  onSubmit: () => void;
  onUploadMediaAssets: (files: FileList | File[] | null) => Promise<MediaAsset[]>;
}) {
  if (!draft) {
    return null;
  }

  const channelLabel = draft.channel === "whatsapp" ? "WhatsApp" : "电话";
  return (
    <div className="modal-backdrop" data-testid="contact-follow-up-modal" role="dialog" aria-modal="true" aria-label={`${channelLabel}跟进`}>
      <div className="modal-panel app-dialog">
        <div className="email-pane-header compact">
          <div>
            <h2 className="page-title" style={{ fontSize: 18 }}>{channelLabel}跟进</h2>
            <p className="subtle">{draft.recordTitle} · {contactMethodTypeLabels[draft.method.type]} {draft.method.value}</p>
          </div>
          <button className="icon-button" aria-label="关闭跟进窗口" type="button" onClick={onCancel}>
            <XCircle size={16} />
          </button>
        </div>
        <label>
          <span className="subtle">{draft.channel === "whatsapp" ? "初始化联系消息" : "电话跟进计划/结论"}</span>
          <textarea
            className="textarea"
            data-testid="contact-follow-up-message"
            value={draft.message}
            onChange={(event) => onChange(event.target.value)}
            placeholder={draft.channel === "whatsapp" ? "输入要发送给客户的 WhatsApp 初始消息" : "输入电话跟进计划、沟通重点或完成后的跟进记录"}
          />
        </label>
        <AttachmentPicker
          attachments={draft.attachments}
          disabled={generating}
          label="跟进附件"
          mediaAssets={mediaAssets}
          onChange={onAttachmentsChange}
          onUploadMediaAssets={onUploadMediaAssets}
          testIdPrefix="contact-follow-up-attachment"
        />
        <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button className="secondary-button" data-testid="contact-follow-up-ai-generate" type="button" onClick={onGenerate} disabled={generating}>
            <Bot className={generating ? "spin-icon" : undefined} size={16} />
            AI 生成
          </button>
          <button className="secondary-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="primary-button" data-testid="contact-follow-up-submit" type="button" onClick={onSubmit} disabled={!draft.message.trim()}>
            <Save size={16} />
            保存到活动时间线
          </button>
        </div>
      </div>
    </div>
  );
}

const dealPipelineCardColorStorageKey = "ai-agent-crm:deal-pipeline-card-colors";
const dealPipelineInitialStageLimit = 20;
const dealPipelineStagePageSize = 20;

const dealCardColorOptions = [
  { key: "slate", label: "深灰", accent: "#334155", background: "#ffffff" },
  { key: "red", label: "红色", accent: "#ef4444", background: "#fff1f2" },
  { key: "amber", label: "琥珀", accent: "#f59e0b", background: "#fffbeb" },
  { key: "emerald", label: "绿色", accent: "#10b981", background: "#ecfdf5" },
  { key: "blue", label: "蓝色", accent: "#2563eb", background: "#eff6ff" },
  { key: "violet", label: "紫色", accent: "#7c3aed", background: "#f5f3ff" },
  { key: "pink", label: "粉色", accent: "#ec4899", background: "#fdf2f8" },
  { key: "cyan", label: "青色", accent: "#06b6d4", background: "#ecfeff" },
  { key: "lime", label: "亮绿", accent: "#65a30d", background: "#f7fee7" },
  { key: "black", label: "黑色", accent: "#020617", background: "#f8fafc" }
];

type DealCardFloatingLayer = { dealId: string; top: number; left: number };
type DealPipelineDropPreview = { stageKey: string; index: number };
type DealPipelineDragState = {
  dealId: string;
  currentX: number;
  currentY: number;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  width: number;
  height: number;
  hasMoved: boolean;
};

function DealPipelineWorkspace({
  activities,
  allRecords,
  deals,
  disabled,
  pipeline,
  stages,
  users,
  onCreateActivity,
  onCreateDeal,
  onMoveDealStage,
  onOpenDeal
}: {
  activities: Activity[];
  allRecords: CrmRecord[];
  deals: CrmRecord[];
  disabled: boolean;
  pipeline: Pipeline | undefined;
  stages: Pipeline["stages"];
  users: User[];
  onCreateActivity: (deal: CrmRecord) => void;
  onCreateDeal: () => void;
  onMoveDealStage: (deal: CrmRecord, stageKey: string, pipelineOrder?: number) => Promise<void> | void;
  onOpenDeal: (deal: CrmRecord) => void;
}) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const stageRefs = useRef<Record<string, HTMLElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const suppressedClickDealId = useRef("");
  const pendingDealMovesRef = useRef<Record<string, { pipelineOrder?: number; stageKey: string }>>({});
  const [pipelineDeals, setPipelineDeals] = useState(deals);
  const [dragState, setDragState] = useState<DealPipelineDragState | null>(null);
  const [dropPreview, setDropPreview] = useState<DealPipelineDropPreview | null>(null);
  const dragStateRef = useRef<DealPipelineDragState | null>(null);
  const dropPreviewRef = useRef<DealPipelineDropPreview | null>(null);
  const [cardColors, setCardColors] = useState<Record<string, string>>({});
  const [floatingColorPicker, setFloatingColorPicker] = useState<DealCardFloatingLayer | null>(null);
  const [floatingDealMenu, setFloatingDealMenu] = useState<DealCardFloatingLayer | null>(null);
  const [stageVisibleCounts, setStageVisibleCounts] = useState<Record<string, number>>({});
  const [stageLoadingKeys, setStageLoadingKeys] = useState<Record<string, boolean>>({});
  const stageLoadTimersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const nextPendingMoves = { ...pendingDealMovesRef.current };
    const mergedDeals = deals.map((deal) => {
      const pendingMove = nextPendingMoves[deal.id];
      if (!pendingMove) {
        return deal;
      }
      const serverOrder = Number(deal.data.pipelineOrder);
      const serverHasMatchingOrder = typeof pendingMove.pipelineOrder !== "number" || (Number.isFinite(serverOrder) && serverOrder === pendingMove.pipelineOrder);
      if (deal.stageKey === pendingMove.stageKey && serverHasMatchingOrder) {
        delete nextPendingMoves[deal.id];
        return deal;
      }
      return {
        ...deal,
        stageKey: pendingMove.stageKey,
        data: {
          ...deal.data,
          ...(typeof pendingMove.pipelineOrder === "number" ? { pipelineOrder: pendingMove.pipelineOrder } : {})
        }
      };
    });
    pendingDealMovesRef.current = nextPendingMoves;
    setPipelineDeals(mergedDeals);
  }, [deals]);

  const dealSourceIndex = useMemo(() => new Map(pipelineDeals.map((deal, index) => [deal.id, index])), [pipelineDeals]);
  const sortedDealsByStage = useMemo(() => {
    const grouped: Record<string, CrmRecord[]> = {};
    for (const stage of stages) {
      grouped[stage.key] = pipelineDeals
        .filter((deal) => deal.stageKey === stage.key)
        .sort((left, right) => getDealPipelineSortValue(left, dealSourceIndex) - getDealPipelineSortValue(right, dealSourceIndex));
    }
    return grouped;
  }, [dealSourceIndex, pipelineDeals, stages]);

  useEffect(() => {
    setStageVisibleCounts((current) => {
      const next: Record<string, number> = {};
      for (const stage of stages) {
        next[stage.key] = current[stage.key] ?? dealPipelineInitialStageLimit;
      }
      return next;
    });
  }, [stages]);

  useEffect(() => {
    const timers = stageLoadTimersRef.current;
    return () => {
      for (const timerId of Object.values(timers)) {
        window.clearTimeout(timerId);
      }
    };
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(dealPipelineCardColorStorageKey);
      if (stored) {
        setCardColors(JSON.parse(stored) as Record<string, string>);
      }
    } catch {
      setCardColors({});
    }
  }, []);

  useEffect(() => {
    if (!dragState) {
      document.body.classList.remove("deal-pipeline-dragging");
      return;
    }
    document.body.classList.add("deal-pipeline-dragging");
    return () => document.body.classList.remove("deal-pipeline-dragging");
  }, [dragState]);

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    dropPreviewRef.current = dropPreview;
  }, [dropPreview]);

  useEffect(() => {
    if (!dragState?.dealId) {
      return;
    }
    function handleWindowPointerMove(event: PointerEvent) {
      const activeDrag = dragStateRef.current;
      if (!activeDrag) {
        return;
      }
      event.preventDefault();
      setDragState((current) => {
        if (!current) {
          return current;
        }
        const hasMoved = current.hasMoved || Math.abs(event.clientX - current.startX) > 4 || Math.abs(event.clientY - current.startY) > 4;
        return { ...current, currentX: event.clientX, currentY: event.clientY, hasMoved };
      });
      setDropPreview(computeDealDropPreview(event.clientX, event.clientY, activeDrag.dealId));
    }
    function handleWindowPointerUp(event: PointerEvent) {
      event.preventDefault();
      finishDealDrag(event.clientX, event.clientY);
    }
    window.addEventListener("pointermove", handleWindowPointerMove, { passive: false });
    window.addEventListener("pointerup", handleWindowPointerUp, { passive: false });
    window.addEventListener("pointercancel", handleWindowPointerUp, { passive: false });
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerUp);
    };
    // Drag handlers read the latest mutable state from refs; adding helper functions here reattaches listeners on every pointer move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState?.dealId, sortedDealsByStage]);

  function setDealCardColor(dealId: string, colorKey: string) {
    setCardColors((current) => {
      const next = { ...current, [dealId]: colorKey };
      try {
        window.localStorage.setItem(dealPipelineCardColorStorageKey, JSON.stringify(next));
      } catch {
        // Local visual preference only; ignore storage failures.
      }
      return next;
    });
  }

  function loadMoreStageDeals(stageKey: string) {
    const total = sortedDealsByStage[stageKey]?.length ?? 0;
    const currentCount = stageVisibleCounts[stageKey] ?? dealPipelineInitialStageLimit;
    if (currentCount >= total || stageLoadingKeys[stageKey]) {
      return;
    }
    setStageLoadingKeys((current) => ({ ...current, [stageKey]: true }));
    window.clearTimeout(stageLoadTimersRef.current[stageKey]);
    stageLoadTimersRef.current[stageKey] = window.setTimeout(() => {
      setStageVisibleCounts((current) => ({
        ...current,
        [stageKey]: Math.min((current[stageKey] ?? dealPipelineInitialStageLimit) + dealPipelineStagePageSize, total)
      }));
      setStageLoadingKeys((current) => ({ ...current, [stageKey]: false }));
      delete stageLoadTimersRef.current[stageKey];
    }, 120);
  }

  function handleStageDealListScroll(stageKey: string, event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distanceToBottom <= 180) {
      loadMoreStageDeals(stageKey);
    }
  }

  function getDealCardColor(deal: CrmRecord) {
    const storedColor = cardColors[deal.id] || (typeof deal.data.pipelineCardColor === "string" ? deal.data.pipelineCardColor : "");
    return dealCardColorOptions.find((option) => option.key === storedColor) ?? dealCardColorOptions[0];
  }

  function getFloatingLayerPosition(target: HTMLElement, width: number, height = 180) {
    const rect = target.getBoundingClientRect();
    const margin = 10;
    const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin);
    const preferredTop = rect.bottom + 6;
    const top = preferredTop + height > window.innerHeight - margin ? Math.max(margin, rect.top - height - 6) : preferredTop;
    return { left, top };
  }

  function toggleColorPicker(dealId: string, event: ReactMouseEvent<HTMLButtonElement>) {
    const position = getFloatingLayerPosition(event.currentTarget, 178, 104);
    setFloatingDealMenu(null);
    setFloatingColorPicker((current) => (current?.dealId === dealId ? null : { dealId, ...position }));
  }

  function toggleDealMenu(dealId: string, event: ReactMouseEvent<HTMLButtonElement>) {
    const position = getFloatingLayerPosition(event.currentTarget, 178, 140);
    setFloatingColorPicker(null);
    setFloatingDealMenu((current) => (current?.dealId === dealId ? null : { dealId, ...position }));
  }

  function handleDealPointerDown(event: ReactPointerEvent<HTMLElement>, deal: CrmRecord) {
    if (disabled || event.button !== 0 || isDealPipelineInteractiveTarget(event.target)) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const nextDragState = {
      dealId: deal.id,
      currentX: event.clientX,
      currentY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height,
      hasMoved: false
    };
    const nextDropPreview = computeDealDropPreview(event.clientX, event.clientY, deal.id);
    setFloatingColorPicker(null);
    setFloatingDealMenu(null);
    dragStateRef.current = nextDragState;
    dropPreviewRef.current = nextDropPreview;
    setDragState(nextDragState);
    setDropPreview(nextDropPreview);
    event.preventDefault();
  }

  function finishDealDrag(clientX: number, clientY: number) {
    const activeDrag = dragStateRef.current;
    if (!activeDrag) {
      return;
    }
    const deal = pipelineDeals.find((candidate) => candidate.id === activeDrag.dealId);
    if (!deal) {
      dragStateRef.current = null;
      dropPreviewRef.current = null;
      setDragState(null);
      setDropPreview(null);
      return;
    }
    const preview = dropPreviewRef.current ?? computeDealDropPreview(clientX, clientY, deal.id);
    const nextOrder = computeDealPipelineOrderForDrop(preview.stageKey, preview.index, deal.id);
    const previousOrder = getDealPipelineOrder(deal);
    if (activeDrag.hasMoved) {
      suppressedClickDealId.current = deal.id;
    }
    const shouldMove = !disabled && Boolean(preview.stageKey) && (deal.stageKey !== preview.stageKey || previousOrder !== nextOrder);
    if (shouldMove) {
      const optimisticDeal: CrmRecord = {
        ...deal,
        stageKey: preview.stageKey,
        data: {
          ...deal.data,
          pipelineOrder: nextOrder
        }
      };
      pendingDealMovesRef.current[deal.id] = { pipelineOrder: nextOrder, stageKey: preview.stageKey };
      setPipelineDeals((current) => mergeRecords(current, [optimisticDeal]));
      const moveResult = onMoveDealStage(deal, preview.stageKey, nextOrder);
      void Promise.resolve(moveResult).catch(() => {
        delete pendingDealMovesRef.current[deal.id];
        setPipelineDeals((current) => mergeRecords(current, [deal]));
      });
    }
    dragStateRef.current = null;
    dropPreviewRef.current = null;
    setDragState(null);
    setDropPreview(null);
  }

  function computeDealDropPreview(clientX: number, clientY: number, draggedDealId: string): DealPipelineDropPreview {
    const boardRect = boardRef.current?.getBoundingClientRect();
    const stageEntries = stages
      .map((stage) => ({ stage, element: stageRefs.current[stage.key] }))
      .filter((entry): entry is { stage: Pipeline["stages"][number]; element: HTMLElement } => Boolean(entry.element));
    const containingStage = stageEntries.find(({ element }) => {
      const rect = element.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    });
    const nearestStage =
      containingStage ??
      stageEntries
        .map((entry) => {
          const rect = entry.element.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const yPenalty = boardRect && (clientY < boardRect.top || clientY > boardRect.bottom) ? Math.abs(clientY - (boardRect.top + boardRect.height / 2)) : 0;
          return { ...entry, distance: Math.abs(clientX - centerX) + yPenalty };
        })
        .sort((left, right) => left.distance - right.distance)[0];

    const stageKey = nearestStage?.stage.key ?? stages[0]?.key ?? "";
    const visibleCount = stageVisibleCounts[stageKey] ?? dealPipelineInitialStageLimit;
    const stageDeals = (sortedDealsByStage[stageKey] ?? []).slice(0, visibleCount).filter((candidate) => candidate.id !== draggedDealId);
    let index = stageDeals.length;
    for (let dealIndex = 0; dealIndex < stageDeals.length; dealIndex += 1) {
      const rect = cardRefs.current[stageDeals[dealIndex].id]?.getBoundingClientRect();
      if (rect && clientY < rect.top + rect.height / 2) {
        index = dealIndex;
        break;
      }
    }
    return { stageKey, index };
  }

  function computeDealPipelineOrderForDrop(stageKey: string, index: number, draggedDealId: string) {
    const stageDeals = (sortedDealsByStage[stageKey] ?? []).filter((candidate) => candidate.id !== draggedDealId);
    const previous = stageDeals[index - 1];
    const next = stageDeals[index];
    const previousOrder = previous ? getDealPipelineOrder(previous, dealSourceIndex) : undefined;
    const nextOrder = next ? getDealPipelineOrder(next, dealSourceIndex) : undefined;
    if (typeof previousOrder === "number" && typeof nextOrder === "number") {
      return (previousOrder + nextOrder) / 2;
    }
    if (typeof previousOrder === "number") {
      return previousOrder + 1000;
    }
    if (typeof nextOrder === "number") {
      return nextOrder - 1000;
    }
    return 1000;
  }

  const floatingColorDeal = floatingColorPicker ? pipelineDeals.find((deal) => deal.id === floatingColorPicker.dealId) : undefined;
  const floatingMenuDeal = floatingDealMenu ? pipelineDeals.find((deal) => deal.id === floatingDealMenu.dealId) : undefined;
  const draggedDeal = dragState ? pipelineDeals.find((deal) => deal.id === dragState.dealId) : undefined;

  if (!pipeline || stages.length === 0) {
    return (
      <div className="deal-pipeline-empty" data-testid="deal-pipeline-empty">
        <h2 className="page-title" style={{ fontSize: 18 }}>还没有默认销售管道</h2>
        <p className="subtle">请到设置中的 CRM 配置里创建并启用交易销售管道。</p>
      </div>
    );
  }

  return (
    <section className="deal-pipeline-workspace" data-testid="deal-pipeline-workspace">
      <div className="deal-pipeline-toolbar">
        <div>
          <h2 className="page-title" style={{ fontSize: 18 }}>{pipeline.name}</h2>
          <div className="subtle">拖动交易卡片可直接更新阶段，阶段变更会记录到活动和审计日志。</div>
        </div>
        <button className="primary-button" type="button" onClick={onCreateDeal}>
          <UserRound size={16} />
          新建交易
        </button>
      </div>
      <div className="pipeline-board deal-pipeline-board" ref={boardRef}>
        {stages.map((stage) => {
          const stageDeals = sortedDealsByStage[stage.key] ?? [];
          const visibleCount = stageVisibleCounts[stage.key] ?? dealPipelineInitialStageLimit;
          const renderedStageDeals = stageDeals.slice(0, visibleCount);
          const hasMoreStageDeals = visibleCount < stageDeals.length;
          const stageIsLoadingMore = Boolean(stageLoadingKeys[stage.key]);
          const stageTotal = stageDeals.reduce((sum, deal) => sum + Number(deal.data.amount ?? 0), 0);
          const visibleDeals = dragState ? renderedStageDeals.filter((deal) => deal.id !== dragState.dealId) : renderedStageDeals;
          return (
            <section
              className={`pipeline-stage deal-pipeline-stage ${dragState ? "drag-active" : ""} ${dropPreview?.stageKey === stage.key ? "drop-target" : ""}`}
              data-testid={`deal-pipeline-stage-${stage.key}`}
              key={stage.key}
              ref={(node) => {
                stageRefs.current[stage.key] = node;
              }}
            >
              <div className="stage-header deal-stage-header">
                <div>
                  <strong>{stage.label}</strong>
                  <div className="subtle">{stageDeals.length} 笔 · {formatCurrency(stageTotal)}</div>
                </div>
                <span className="badge">{Math.round(stage.probability * 100)}%</span>
              </div>
              <div className="deal-pipeline-stage-scroll" data-testid={`deal-pipeline-stage-scroll-${stage.key}`} onScroll={(event) => handleStageDealListScroll(stage.key, event)}>
                {visibleDeals.map((deal, dealIndex) => {
                  const company = typeof deal.data.companyId === "string" ? allRecords.find((record) => record.id === deal.data.companyId) : undefined;
                  const color = getDealCardColor(deal);
                  const dealActivities = activities.filter((activity) => activity.recordId === deal.id);
                  return (
                    <Fragment key={deal.id}>
                      {dropPreview?.stageKey === stage.key && dropPreview.index === dealIndex ? (
                        <div className="deal-pipeline-drop-placeholder" data-testid="deal-pipeline-drop-placeholder" style={{ height: dragState?.height ?? 106 }} />
                      ) : null}
                      <article
                        className="deal-pill deal-pipeline-card"
                        data-testid={`deal-pipeline-deal-${deal.id}`}
                        ref={(node) => {
                          cardRefs.current[deal.id] = node;
                        }}
                        role="button"
                        style={{ "--deal-card-accent": color.accent, "--deal-card-bg": color.background } as CSSProperties}
                        tabIndex={0}
                        onClick={() => {
                          if (suppressedClickDealId.current === deal.id) {
                            suppressedClickDealId.current = "";
                            return;
                          }
                          onOpenDeal(deal);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onOpenDeal(deal);
                          }
                        }}
                        onPointerDown={(event) => handleDealPointerDown(event, deal)}
                      >
                        <DealPipelineCardContents
                          color={color}
                          deal={deal}
                          dealActivities={dealActivities}
                          company={company}
                          users={users}
                          onToggleColorPicker={toggleColorPicker}
                          onToggleDealMenu={toggleDealMenu}
                        />
                      </article>
                    </Fragment>
                  );
                })}
                {dropPreview?.stageKey === stage.key && dropPreview.index === visibleDeals.length ? (
                  <div className="deal-pipeline-drop-placeholder" data-testid="deal-pipeline-drop-placeholder" style={{ height: dragState?.height ?? 106 }} />
                ) : null}
                {stageDeals.length === 0 && !(dropPreview?.stageKey === stage.key) ? <div className="empty-state compact-empty">暂无交易</div> : null}
                {hasMoreStageDeals ? (
                  <button className="deal-pipeline-load-more" type="button" disabled={stageIsLoadingMore} onClick={() => loadMoreStageDeals(stage.key)}>
                    {stageIsLoadingMore ? "加载中..." : `加载更多 (${Math.min(dealPipelineStagePageSize, stageDeals.length - visibleCount)} / ${stageDeals.length - visibleCount})`}
                  </button>
                ) : stageDeals.length > dealPipelineInitialStageLimit ? (
                  <div className="deal-pipeline-stage-end">已显示全部 {stageDeals.length} 笔</div>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
      {dragState && draggedDeal ? (
        <article
          aria-hidden="true"
          className="deal-pill deal-pipeline-card deal-pipeline-drag-overlay"
          data-testid="deal-pipeline-drag-overlay"
          style={
            {
              "--deal-card-accent": getDealCardColor(draggedDeal).accent,
              "--deal-card-bg": getDealCardColor(draggedDeal).background,
              height: dragState.height,
              left: dragState.currentX - dragState.offsetX,
              top: dragState.currentY - dragState.offsetY,
              width: dragState.width
            } as CSSProperties
          }
        >
          <DealPipelineCardContents
            color={getDealCardColor(draggedDeal)}
            deal={draggedDeal}
            dealActivities={activities.filter((activity) => activity.recordId === draggedDeal.id)}
            company={typeof draggedDeal.data.companyId === "string" ? allRecords.find((record) => record.id === draggedDeal.data.companyId) : undefined}
            users={users}
            readonly
            onToggleColorPicker={toggleColorPicker}
            onToggleDealMenu={toggleDealMenu}
          />
        </article>
      ) : null}
      {floatingColorPicker && floatingColorDeal ? (
        <div
          className="deal-card-color-popover floating"
          data-testid={`deal-card-color-popover-${floatingColorDeal.id}`}
          style={{ left: floatingColorPicker.left, top: floatingColorPicker.top }}
          onClick={(event) => event.stopPropagation()}
        >
          {dealCardColorOptions.map((option) => {
            const activeColor = getDealCardColor(floatingColorDeal);
            return (
              <button
                aria-label={`设置为${option.label}`}
                className={`deal-card-color-swatch ${option.key === activeColor.key ? "selected" : ""}`}
                key={option.key}
                style={{ background: option.accent }}
                title={option.label}
                type="button"
                onClick={() => {
                  setDealCardColor(floatingColorDeal.id, option.key);
                  setFloatingColorPicker(null);
                }}
              />
            );
          })}
        </div>
      ) : null}
      {floatingDealMenu && floatingMenuDeal ? (
        <div
          className="deal-card-menu floating"
          data-testid={`deal-card-menu-${floatingMenuDeal.id}`}
          style={{ left: floatingDealMenu.left, top: floatingDealMenu.top }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setFloatingDealMenu(null);
              onCreateActivity(floatingMenuDeal);
            }}
            onClick={(event) => event.preventDefault()}
          >
            <ActivityIcon size={16} />
            创建 Activity
          </button>
          <button
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setFloatingDealMenu(null);
              onOpenDeal(floatingMenuDeal);
            }}
            onClick={(event) => event.preventDefault()}
          >
            <Eye size={16} />
            查看详情
          </button>
        </div>
      ) : null}
    </section>
  );
}

function DealPipelineCardContents({
  color,
  deal,
  dealActivities,
  company,
  users,
  readonly = false,
  onToggleColorPicker,
  onToggleDealMenu
}: {
  color: (typeof dealCardColorOptions)[number];
  deal: CrmRecord;
  dealActivities: Activity[];
  company: CrmRecord | undefined;
  users: User[];
  readonly?: boolean;
  onToggleColorPicker: (dealId: string, event: ReactMouseEvent<HTMLButtonElement>) => void;
  onToggleDealMenu: (dealId: string, event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <>
      <div aria-hidden="true" className="deal-card-color-strip" style={{ background: color.accent }} />
      <div className="deal-card-content">
        <div className="deal-card-title-row">
          <strong>{deal.title}</strong>
          {!readonly ? (
            <div className="deal-card-controls" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
              <button
                aria-label="切换卡片颜色"
                className="icon-button deal-card-color-button"
                data-no-deal-drag="true"
                title="切换卡片颜色"
                type="button"
                onClick={(event) => onToggleColorPicker(deal.id, event)}
              >
                <Palette size={15} />
              </button>
              <button
                aria-label="交易操作"
                className="icon-button deal-card-menu-button"
                data-no-deal-drag="true"
                title="交易操作"
                type="button"
                onClick={(event) => onToggleDealMenu(deal.id, event)}
              >
                <MoreVertical size={16} />
              </button>
            </div>
          ) : null}
        </div>
        <div className="deal-card-line">
          <span className="deal-card-activity-count">{dealActivities.length} Activity</span>
          <span className="deal-card-amount">{formatCurrency(deal.data.amount)}</span>
        </div>
        <div className="deal-card-meta">
          {company?.title ?? "未关联公司"}
          {deal.data.closeDate ? ` · ${formatDate(String(deal.data.closeDate))}` : ""}
        </div>
        <div className="record-owner-meta">{recordPoolLabel(deal, users)}</div>
      </div>
    </>
  );
}

function isDealPipelineInteractiveTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("button, input, select, textarea, a, [data-no-deal-drag]"));
}

function getDealPipelineOrder(deal: CrmRecord, sourceIndex?: Map<string, number>) {
  const value = Number(deal.data.pipelineOrder);
  if (Number.isFinite(value)) {
    return value;
  }
  return (sourceIndex?.get(deal.id) ?? 0) * 1000;
}

function getDealPipelineSortValue(deal: CrmRecord, sourceIndex: Map<string, number>) {
  return getDealPipelineOrder(deal, sourceIndex);
}

function Dashboard({
  objects,
  recordCounts,
  openTasks,
  openTaskCount,
  totalPipeline,
  pipelines,
  deals,
  smartReminders,
  smartReminderGenerating,
  onOpenObject,
  onOpenDeal,
  onOpenSmartReminder,
  onGenerateSmartReminders,
  onCompleteSmartReminder,
  onDismissSmartReminder,
  onSnoozeSmartReminder,
  onConvertSmartReminderToTask,
  onMoveDealStage
}: {
  objects: ObjectDefinition[];
  recordCounts: Record<string, number>;
  openTasks: Activity[];
  openTaskCount: number;
  totalPipeline: number;
  pipelines: Pipeline[];
  deals: CrmRecord[];
  smartReminders: SmartReminder[];
  smartReminderGenerating: boolean;
  onOpenObject: (objectKey: string) => void;
  onOpenDeal: (deal: CrmRecord) => void;
  onOpenSmartReminder: (reminder: SmartReminder) => void;
  onGenerateSmartReminders: () => void;
  onCompleteSmartReminder: (reminder: SmartReminder) => void;
  onDismissSmartReminder: (reminder: SmartReminder) => void;
  onSnoozeSmartReminder: (reminder: SmartReminder) => void;
  onConvertSmartReminderToTask: (reminder: SmartReminder) => void;
  onMoveDealStage: (deal: CrmRecord, stageKey: string) => void;
}) {
  const defaultPipeline = pipelines.find((pipeline) => pipeline.objectKey === "deals" && pipeline.isDefault);
  const [draggedDealId, setDraggedDealId] = useState("");
  const visibleSmartReminders = useMemo(
    () =>
      smartReminders
        .filter((reminder) => reminder.status === "open")
        .filter((reminder) => !reminder.snoozedUntil || new Date(reminder.snoozedUntil).getTime() <= Date.now())
        .sort(compareSmartReminderForUi)
        .slice(0, 10),
    [smartReminders]
  );

  function handleDealDragStart(event: DragEvent<HTMLButtonElement>, deal: CrmRecord) {
    setDraggedDealId(deal.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", deal.id);
    event.dataTransfer.setData("application/x-crm-deal-id", deal.id);
  }

  function handleStageDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleStageDrop(event: DragEvent<HTMLElement>, stageKey: string) {
    event.preventDefault();
    const dealId = event.dataTransfer.getData("application/x-crm-deal-id") || event.dataTransfer.getData("text/plain");
    const deal = deals.find((candidate) => candidate.id === dealId);
    setDraggedDealId("");
    if (!deal || deal.stageKey === stageKey) {
      return;
    }
    onMoveDealStage(deal, stageKey);
  }

  return (
    <>
      <section className="stats-grid" aria-label="CRM 指标">
        <Metric label="联系人" value={recordCounts.contacts ?? 0} icon={UserRound} />
        <Metric label="公司" value={recordCounts.companies ?? 0} icon={Building2} />
        <Metric label="交易金额" value={formatCurrency(totalPipeline)} icon={BadgeDollarSign} />
        <Metric label="待办任务" value={openTaskCount || openTasks.length} icon={CalendarClock} />
      </section>

      <SmartReminderPanel
        compact={false}
        generating={smartReminderGenerating}
        reminders={visibleSmartReminders}
        title="今日最佳行动"
        emptyMessage="暂无 AI 智能提醒。可手动刷新生成今日跟进建议。"
        onComplete={onCompleteSmartReminder}
        onConvertTask={onConvertSmartReminderToTask}
        onDismiss={onDismissSmartReminder}
        onGenerate={onGenerateSmartReminders}
        onOpenRecord={onOpenSmartReminder}
        onSnooze={onSnoozeSmartReminder}
      />

      <div className="workspace-grid">
        <section className="section">
          <div className="topbar">
            <div>
              <h2 className="page-title">销售管道</h2>
              <div className="subtle">交易阶段和金额来自真实记录，不是前端 mock。</div>
            </div>
          </div>
          <div className="pipeline-board">
            {withClosedStages(defaultPipeline?.stages ?? []).map((stage) => {
              const stageDeals = deals.filter((deal) => deal.stageKey === stage.key);
              return (
                <section
                  className={`pipeline-stage ${draggedDealId ? "drag-active" : ""}`}
                  data-testid={`pipeline-stage-${stage.key}`}
                  key={stage.key}
                  onDragOver={handleStageDragOver}
                  onDrop={(event) => handleStageDrop(event, stage.key)}
                >
                  <div className="stage-header">
                    <span>{stage.label}</span>
                    <span className="badge">{Math.round(stage.probability * 100)}%</span>
                  </div>
                  {stageDeals.map((deal) => (
                    <button
                      className={`deal-pill ${draggedDealId === deal.id ? "dragging" : ""}`}
                      data-testid={`pipeline-deal-${deal.id}`}
                      draggable
                      key={deal.id}
                      type="button"
                      onClick={() => onOpenDeal(deal)}
                      onDragEnd={() => setDraggedDealId("")}
                      onDragStart={(event) => handleDealDragStart(event, deal)}
                    >
                      <strong>{deal.title}</strong>
                      <div className="subtle">{formatCurrency(deal.data.amount)}</div>
                    </button>
                  ))}
                </section>
              );
            })}
          </div>
        </section>

        <ObjectDirectory objects={objects} recordCounts={recordCounts} onOpenObject={onOpenObject} />
      </div>
    </>
  );
}

function EmailWorkspace({
  accounts,
  signatures,
  threads,
  messagesByThread,
  selectedThreadId,
  detailThreadId,
  routeMailbox,
  routeCategory,
  routeMailMode,
  routeAccountId,
  routeLabel,
  routeSearch,
  view,
  selectedRecord,
  records,
  aiSettings,
  syncSettings,
  accountDraft,
  signatureDraft,
  emailDraft,
  composeOpenRequestKey,
  aiPurpose,
  aiPrompt,
  aiResult,
  diagnostics,
  connectionTestRun,
  knowledgeArticles,
  knowledgeDraft,
  mediaAssets,
  disabled,
  canManageEmailSettings,
  canManageAiSettings,
  onAccountDraftChange,
  onSignatureDraftChange,
  onEmailDraftChange,
  onComposeClosed,
  onKnowledgeDraftChange,
  onUploadMediaAssets,
  onAiPurposeChange,
  onAiPromptChange,
  onViewChange,
  onRouteChange,
  onLoadThreadMessages,
  onSelectThread,
  onUpdateThread,
  onUpdateThreadState,
  onDeleteThreads,
  onCreateContactFromEmail,
  onLinkExistingContactFromEmail,
  onUnlinkContactEmailFromThread,
  onOpenEmailContact,
  onOpenTalkSourceRecord,
  onCreateAccount,
  onStartOAuth,
  onSyncAccount,
  onSyncAllAccounts,
  onTestConnection,
  onEditAccount,
  onUpdateAccount,
  onUpdateAccountFromDraft,
  onResetAccountDraft,
  onSaveSignature,
  onEditSignature,
  onDeleteSignature,
  onResetSignatureDraft,
  onSend,
  onReplyToMessage,
  onRetryMessage,
  onGenerateAiForMessage,
  onGenerateAi,
  onGenerateAiForDraft,
  onGenerateAiPromptForDraft,
  onOpenAiSource,
  onSummarizeThread,
  onAnalyzeThread,
  onRefreshDiagnostics,
  onTestAllConnections,
  onCreateKnowledgeArticle,
  onUpdateKnowledgeArticle,
  onKnowledgeArticleCreated,
  onUpdateMediaAsset,
  onDeleteMediaAsset,
  onToggleAiFeature,
  onUpdateAiSettings,
  onUpdateSyncSettings,
  onShowToast,
  onShowSuccess,
  onRequestConfirm,
  onRequestPrompt,
  sidebarCollapsed,
  onToggleAppSidebar
}: {
  accounts: EmailAccount[];
  signatures: EmailSignature[];
  threads: EmailThread[];
  messagesByThread: Record<string, EmailMessage[]>;
  selectedThreadId: string;
  detailThreadId: string;
  routeMailbox: EmailMailboxKey;
  routeCategory: EmailCategoryKey;
  routeMailMode: EmailMailMode;
  routeAccountId: string;
  routeLabel: string;
  routeSearch: string;
  view: EmailWorkspaceView;
  selectedRecord?: CrmRecord;
  records: CrmRecord[];
  aiSettings: EmailAiSettings;
  syncSettings: EmailSyncSettings;
  accountDraft: EmailAccountDraft;
  signatureDraft: EmailSignatureDraft;
  emailDraft: EmailComposeDraft;
  composeOpenRequestKey: string;
  aiPurpose: EmailAiGenerateResult["purpose"];
  aiPrompt: string;
  aiResult: EmailAiGenerateResult | null;
  diagnostics: EmailSubsystemDiagnostics | null;
  connectionTestRun: EmailConnectionTestRun | null;
  knowledgeArticles: KnowledgeArticle[];
  knowledgeDraft: KnowledgeArticleDraft;
  mediaAssets: MediaAsset[];
  disabled: boolean;
  canManageEmailSettings: boolean;
  canManageAiSettings: boolean;
  onAccountDraftChange: (draft: EmailAccountDraft) => void;
  onSignatureDraftChange: (draft: EmailSignatureDraft) => void;
  onEmailDraftChange: (draft: EmailComposeDraft) => void;
  onComposeClosed: () => void;
  onKnowledgeDraftChange: (draft: KnowledgeArticleDraft) => void;
  onUploadMediaAssets: (files: FileList | File[] | null) => Promise<MediaAsset[]>;
  onAiPurposeChange: (purpose: EmailAiGenerateResult["purpose"]) => void;
  onAiPromptChange: (prompt: string) => void;
  onViewChange: (view: EmailWorkspaceView) => void;
  onRouteChange: (patch: EmailRoutePatch) => void;
  onLoadThreadMessages: (threadId: string) => Promise<void>;
  onSelectThread: (threadId: string) => void;
  onUpdateThread: (threadId: string, recordId: string) => void;
  onUpdateThreadState: (threadId: string, patch: Partial<EmailThreadUiState>) => Promise<EmailThread>;
  onDeleteThreads: (threadIds: string[]) => Promise<boolean | undefined>;
  onCreateContactFromEmail: (threadId: string, emailAddress: string) => void;
  onLinkExistingContactFromEmail: (threadId: string, contactId: string, emailAddress: string) => void;
  onUnlinkContactEmailFromThread: (threadId: string, contactId: string, emailAddress: string) => void;
  onOpenEmailContact: (threadId: string, contact: CrmRecord) => void;
  onOpenTalkSourceRecord: (source: { objectKey: string; recordId: string }) => void;
  onCreateAccount: () => void;
  onStartOAuth: () => void;
  onSyncAccount: (accountId: string) => void;
  onSyncAllAccounts: () => void;
  onTestConnection: (accountId: string, options?: { scope?: EmailConnectionTestScope; outboundServiceId?: string }) => Promise<void>;
  onEditAccount: (account: EmailAccount) => void;
  onUpdateAccount: (accountId: string, patch: EmailAccountUpdatePatch) => void;
  onUpdateAccountFromDraft: () => void;
  onResetAccountDraft: () => void;
  onSaveSignature: () => void;
  onEditSignature: (signature: EmailSignature) => void;
  onDeleteSignature: (signature: EmailSignature) => void;
  onResetSignatureDraft: () => void;
  onSend: () => void;
  onReplyToMessage: (message: EmailMessage) => void;
  onRetryMessage: (messageId: string) => void;
  onGenerateAiForMessage: (message: EmailMessage, purpose: "translate" | "context_analysis") => void;
  onGenerateAi: () => void;
  onGenerateAiForDraft: (prompt: string) => void;
  onGenerateAiPromptForDraft: (prompt: string) => Promise<string>;
  onOpenAiSource: (source: EmailAiSource) => void;
  onSummarizeThread: () => void;
  onAnalyzeThread: () => void;
  onRefreshDiagnostics: () => void;
  onTestAllConnections: () => void;
  onCreateKnowledgeArticle: () => void;
  onUpdateKnowledgeArticle: (articleId: string, patch: Partial<Pick<KnowledgeArticle, "title" | "body" | "tags" | "active">>) => void;
  onKnowledgeArticleCreated: (article: KnowledgeArticle) => void;
  onUpdateMediaAsset: (assetId: string, patch: Partial<Pick<MediaAsset, "name" | "contentType" | "size" | "contentBase64">>) => void;
  onDeleteMediaAsset: (asset: MediaAsset) => void;
  onToggleAiFeature: (feature: keyof EmailAiSettings["features"], enabled: boolean) => void;
  onUpdateAiSettings: (
    patch: Partial<Pick<EmailAiSettings, "defaultLocale" | "requireSourceLinks" | "maxHistoryMessages" | "maxKnowledgeArticles" | "maxContextChars" | "agents">> & {
      providerConfig?: Partial<EmailAiSettings["providerConfig"]>;
    }
  ) => void;
  onUpdateSyncSettings: (patch: Partial<Omit<EmailSyncSettings, "workspaceId" | "updatedAt">>) => void;
  onShowToast: (toast: ToastState) => void;
  onShowSuccess: (message: string) => void;
  onRequestConfirm: (options: ConfirmDialogState) => Promise<boolean>;
  onRequestPrompt: (options: PromptDialogState) => Promise<string | null>;
  sidebarCollapsed: boolean;
  onToggleAppSidebar: () => void;
}) {
  const selectedThread = threads.find((thread) => thread.id === selectedThreadId);
  const selectedMessages = selectedThread ? messagesByThread[selectedThread.id] ?? [] : [];
  const activeAccounts = accounts.filter(canSelectEmailAccountForSending);
  const linkedRecordId = emailDraft.recordId ?? "";
  const selectedThreadRecordId = selectedThread?.recordId || "";
  const contactRecords = useMemo(() => records.filter((record) => record.objectKey === "contacts"), [records]);
  const contactByEmail = useMemo(() => {
    const map = new Map<string, CrmRecord>();
    for (const contact of contactRecords) {
      for (const emailAddress of getRecordEmailAddressesFromData(contact)) {
        map.set(emailAddress.toLowerCase(), contact);
      }
    }
    return map;
  }, [contactRecords]);
  const selectedThreadSenderEmail = selectedThread ? getThreadPrimarySenderEmail(selectedThread, selectedMessages, accounts) : "";
  const selectedThreadContact = selectedThreadSenderEmail ? findContactByEmail(records, selectedThreadSenderEmail) : undefined;
  const [manuallyUnlinkedThreadIds, setManuallyUnlinkedThreadIds] = useState<Set<string>>(() => new Set());
  const selectedThreadManuallyUnlinked = selectedThread ? manuallyUnlinkedThreadIds.has(selectedThread.id) && !selectedThread.recordId : false;
  const selectedThreadDisplayRecord = selectedThreadRecordId
    ? records.find((record) => record.id === selectedThreadRecordId)
    : selectedThreadManuallyUnlinked
      ? undefined
      : selectedThreadContact;
  const selectedProviderCapability = getEmailProviderCapability(accountDraft.provider);
  const selectedProviderSetupVisibility = getEmailProviderSetupVisibility(accountDraft.provider);
  const editingEmailAccount = accountDraft.editingAccountId ? accounts.find((account) => account.id === accountDraft.editingAccountId) : undefined;
  const selectedEmailAiPurposeEnabled = isEmailAiPurposeEnabled(aiSettings.features, aiPurpose);
  const enabledEmailAiAutomationCount = [aiSettings.features.auto_translate, aiSettings.features.auto_context_analysis, aiSettings.features.auto_summarize].filter(Boolean).length;
  const activeKnowledgeArticleCount = knowledgeArticles.filter((article) => article.active).length;
  const [mailbox, setMailbox] = useState<EmailMailboxKey>(routeMailbox);
  const [category, setCategory] = useState<EmailCategoryKey>(routeCategory);
  const [mailMode, setMailMode] = useState<EmailMailMode>(routeEmailThreadIdToMode(detailThreadId, routeMailMode));
  const [selectedMailboxAccountId, setSelectedMailboxAccountId] = useState<string>(routeAccountId);
  const [mailboxAccountsCollapsed, setMailboxAccountsCollapsed] = useState(true);
  const [searchQuery, setSearchQuery] = useState(routeSearch);
  const [labelFilter, setLabelFilter] = useState(routeLabel);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(() => new Set());
  const [threadUiState, setThreadUiState] = useState<Record<string, EmailThreadUiState>>(() => buildEmailThreadUiStateMap(threads));
  const [trashDisplayMessageIds, setTrashDisplayMessageIds] = useState<EmailTrashDisplayMessageIds>({});
  const [externalImageThreadIds, setExternalImageThreadIds] = useState<Set<string>>(() => new Set());
  const selectedMailboxMessages = selectedThread ? getEmailThreadMailboxMessages(selectedMessages, mailbox) : [];
  const selectedDisplayedMessages = selectedMailboxMessages.length > 0 ? selectedMailboxMessages : selectedMessages;
  const selectedDisplayMessage = getEmailThreadDisplayMessage(selectedMessages, mailbox, selectedThread ? trashDisplayMessageIds[selectedThread.id] : undefined);
  const selectedThreadState = selectedThread ? threadUiState[selectedThread.id] ?? {} : {};
  const selectedThreadIsRead = Boolean(selectedThreadState.read);
  const selectedThreadIsSnoozed = Boolean(selectedThreadState.snoozedUntil && new Date(selectedThreadState.snoozedUntil).getTime() > Date.now());
  const selectedThreadAllowsExternalImages = selectedThread ? externalImageThreadIds.has(selectedThread.id) : false;
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMinimized, setComposeMinimized] = useState(false);
  const [composeFullSize, setComposeFullSize] = useState(false);
  const [detailMoreOpen, setDetailMoreOpen] = useState(false);
  const [emailSettingsStep, setEmailSettingsStep] = useState<EmailSettingsStep>("identity");
  const [accountConnectionTests, setAccountConnectionTests] = useState<Record<string, { status: "testing" | "success" | "failed"; message: string; testedAt?: string }>>({});
  const [existingContactId, setExistingContactId] = useState("");
  const [existingContactPickerOpen, setExistingContactPickerOpen] = useState(false);
  const [composeAiPrompt, setComposeAiPrompt] = useState("");
  const [composeCcVisible, setComposeCcVisible] = useState(false);
  const [composeBccVisible, setComposeBccVisible] = useState(false);
  const [aiProviderApiKeyDraft, setAiProviderApiKeyDraft] = useState("");
  const [composePromptGenerating, setComposePromptGenerating] = useState(false);
  const [attachmentModalOpen, setAttachmentModalOpen] = useState(false);
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false);
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const [attachmentUploads, setAttachmentUploads] = useState<EmailAttachmentUploadItem[]>([]);
  const composeEditorRef = useRef<HTMLDivElement>(null);
  const handledComposeOpenRequestRef = useRef("");
  const composeInlineImageInputRef = useRef<HTMLInputElement>(null);
  const composeAttachmentInputRef = useRef<HTMLInputElement>(null);
  const hasEmailDraftContent = Boolean(emailDraft.to.trim() || emailDraft.cc.trim() || emailDraft.bcc.trim() || emailDraft.subject.trim() || hasEmailDraftBody(emailDraft) || emailDraft.attachments?.length || emailDraft.aiAssisted);
  const signatureOptions = useMemo(() => getEmailSignatureOptions(signatures, accounts, emailDraft.accountId), [accounts, emailDraft.accountId, signatures]);
  const selectedSignature = getSelectedEmailSignature(emailDraft, signatures, accounts);
  const draftEditorHtml = getDraftBodyHtml(emailDraft);
  const updateAiAgent = (agentKey: string, patch: Partial<EmailAiSettings["agents"][number]>) => {
    onUpdateAiSettings({
      agents: aiSettings.agents.map((agent) => (agent.key === agentKey ? { ...agent, ...patch } : agent))
    });
  };
  const updateAiProviderConfig = (patch: Partial<EmailAiSettings["providerConfig"]>) => {
    const nextProviderConfig = sanitizeAiProviderConfigForPatch({
      ...aiSettings.providerConfig,
      ...patch
    });
    onUpdateAiSettings({
      providerConfig: nextProviderConfig
    });
  };
  const linkEmailThreadRecord = (threadId: string, recordId: string) => {
    setManuallyUnlinkedThreadIds((current) => {
      const next = new Set(current);
      if (recordId) {
        next.delete(threadId);
      } else {
        next.add(threadId);
      }
      return next;
    });
    onUpdateThread(threadId, recordId);
  };
  const unlinkEmailThreadContact = (threadId: string, contact: CrmRecord, emailAddress: string) => {
    setManuallyUnlinkedThreadIds((current) => {
      const next = new Set(current);
      next.add(threadId);
      return next;
    });
    if (contact.objectKey === "contacts") {
      onUnlinkContactEmailFromThread(threadId, contact.id, emailAddress);
    } else {
      onUpdateThread(threadId, "");
    }
  };
  const linkExistingEmailContact = (threadId: string, contactId: string, emailAddress: string) => {
    setManuallyUnlinkedThreadIds((current) => {
      const next = new Set(current);
      next.delete(threadId);
      return next;
    });
    setExistingContactPickerOpen(false);
    onLinkExistingContactFromEmail(threadId, contactId, emailAddress);
  };
  const updateOutboundServiceDraft = (serviceId: string, patch: Partial<EmailAccountDraftOutboundService>) => {
    onAccountDraftChange({
      ...accountDraft,
      outboundServices: accountDraft.outboundServices.map((service) => (service.id === serviceId ? { ...service, ...patch } : service))
    });
  };
  const addOutboundServiceDraft = (type: EmailAccountDraftOutboundService["type"]) => {
    const service = createEmailOutboundServiceDraft(type, { name: `${type === "smtp" ? "SMTP" : "Resend"} ${accountDraft.outboundServices.length + 1}` });
    onAccountDraftChange({
      ...accountDraft,
      defaultOutboundServiceId: accountDraft.defaultOutboundServiceId || service.id,
      outboundServices: [...accountDraft.outboundServices, service]
    });
  };
  const removeOutboundServiceDraft = (serviceId: string) => {
    const outboundServices = accountDraft.outboundServices.filter((service) => service.id !== serviceId);
    onAccountDraftChange({
      ...accountDraft,
      defaultOutboundServiceId:
        accountDraft.defaultOutboundServiceId === serviceId ? outboundServices[0]?.id ?? "" : accountDraft.defaultOutboundServiceId,
      outboundServices
    });
  };
  const selectedThreadIdsArray = Array.from(selectedThreadIds);
  const accountFilteredThreads = useMemo(
    () => (selectedMailboxAccountId === allEmailAccountsKey ? threads : threads.filter((thread) => thread.accountId === selectedMailboxAccountId)),
    [selectedMailboxAccountId, threads]
  );
  useEffect(() => {
    if (!["inbox", "all", "sent", "scheduled", "drafts", "trash"].includes(mailbox)) {
      return;
    }
    accountFilteredThreads
      .filter((thread) => !messagesByThread[thread.id])
      .slice(0, 50)
      .forEach((thread) => {
        void onLoadThreadMessages(thread.id);
      });
  }, [accountFilteredThreads, mailbox, messagesByThread, onLoadThreadMessages]);
  const selectedMailboxAccount = selectedMailboxAccountId === allEmailAccountsKey ? undefined : accounts.find((account) => account.id === selectedMailboxAccountId);
  const selectedMailboxAccountCanSync =
    selectedMailboxAccountId === allEmailAccountsKey ||
    Boolean(
      selectedMailboxAccount &&
        selectedMailboxAccount.status === "active" &&
        selectedMailboxAccount.syncEnabled &&
        selectedMailboxAccount.connectionConfigured &&
        getEmailProviderCapability(selectedMailboxAccount.provider).supportsSync
    );
  const visibleThreads = useMemo(() => {
    return accountFilteredThreads.filter((thread) => {
      const messages = messagesByThread[thread.id] ?? [];
      const state = threadUiState[thread.id] ?? {};
      const threadCategory = state.category ?? inferEmailThreadCategory(thread, messages);
      const displayLabels = getEmailThreadDisplayLabels(thread, state, messages).map((label) => label.toLowerCase());
      const isSnoozed = Boolean(state.snoozedUntil && new Date(state.snoozedUntil).getTime() > Date.now());
      const isDeleted = Boolean(state.deleted);
      const isArchived = Boolean(state.archived);
      const hasDraft = messages.some((message) => message.status === "draft");
      const hasScheduled = emailThreadHasScheduledSend(messages);
      const hasInboxMessage = getEmailThreadMailboxMessages(messages, "inbox").length > 0;
      const matchesMailbox =
        mailbox === "trash"
          ? isDeleted
          : mailbox === "archived"
            ? isArchived && !isDeleted
            : mailbox === "starred"
              ? Boolean(state.starred) && !isDeleted
              : mailbox === "important"
                ? Boolean(state.important) && !isDeleted
                : mailbox === "snoozed"
                  ? isSnoozed && !isDeleted
                  : mailbox === "sent"
                    ? emailThreadHasOutbound(messages) && !isDeleted
                    : mailbox === "scheduled"
                      ? hasScheduled && !isDeleted
                    : mailbox === "drafts"
                      ? hasDraft && !isDeleted
                      : mailbox === "all"
                        ? !isDeleted
                        : !isDeleted && !isArchived && !isSnoozed && hasInboxMessage;
      const matchesCategory = mailbox === "inbox" || mailbox === "all" ? threadCategory === category : true;
      const matchesLabel = labelFilter ? displayLabels.includes(labelFilter.toLowerCase()) : true;
      return matchesMailbox && matchesCategory && matchesLabel && emailThreadMatchesSearch(thread, messages, searchQuery);
    });
  }, [accountFilteredThreads, category, labelFilter, mailbox, messagesByThread, searchQuery, threadUiState]);
  const visibleThreadIds = visibleThreads.map((thread) => thread.id);
  const allVisibleThreadsSelected = visibleThreadIds.length > 0 && visibleThreadIds.every((threadId) => selectedThreadIds.has(threadId));
  const mailboxCounts = useMemo(() => {
    const counts = Object.fromEntries(emailMailboxMeta.map((item) => [item.key, 0])) as Record<EmailMailboxKey, number>;
    for (const thread of accountFilteredThreads) {
      const messages = messagesByThread[thread.id] ?? [];
      const state = threadUiState[thread.id] ?? {};
      const isSnoozed = Boolean(state.snoozedUntil && new Date(state.snoozedUntil).getTime() > Date.now());
      const isDeleted = Boolean(state.deleted);
      const isArchived = Boolean(state.archived);
      const hasDraft = messages.some((message) => message.status === "draft");
      const hasScheduled = emailThreadHasScheduledSend(messages);
      const hasInboxMessage = getEmailThreadMailboxMessages(messages, "inbox").length > 0;
      if (!isDeleted && !isArchived && !isSnoozed && hasInboxMessage) counts.inbox += 1;
      if (state.starred && !isDeleted) counts.starred += 1;
      if (isSnoozed && !isDeleted) counts.snoozed += 1;
      if (state.important && !isDeleted) counts.important += 1;
      if (emailThreadHasOutbound(messages) && !isDeleted) counts.sent += 1;
      if (hasScheduled && !isDeleted) counts.scheduled += 1;
      if (hasDraft && !isDeleted) counts.drafts += 1;
      if (isArchived && !isDeleted) counts.archived += 1;
      if (isDeleted) counts.trash += 1;
      if (!isDeleted) counts.all += 1;
    }
    return counts;
  }, [accountFilteredThreads, messagesByThread, threadUiState]);
  const categoryCounts = useMemo(() => {
    const counts = Object.fromEntries(emailCategoryMeta.map((item) => [item.key, 0])) as Record<EmailCategoryKey, number>;
    for (const thread of accountFilteredThreads) {
      const messages = messagesByThread[thread.id] ?? [];
      const state = threadUiState[thread.id] ?? {};
      if (state.deleted || state.archived || (state.snoozedUntil && new Date(state.snoozedUntil).getTime() > Date.now())) {
        continue;
      }
      counts[state.category ?? inferEmailThreadCategory(thread, messages)] += 1;
    }
    return counts;
  }, [accountFilteredThreads, messagesByThread, threadUiState]);
  const accountThreadCounts = useMemo(() => {
    const counts = new Map(accounts.map((account) => [account.id, 0]));
    for (const thread of threads) {
      const state = threadUiState[thread.id] ?? {};
      if (!state.deleted) {
        counts.set(thread.accountId, (counts.get(thread.accountId) ?? 0) + 1);
      }
    }
    return counts;
  }, [accounts, threadUiState, threads]);
  const allEmailLabels = useMemo(() => {
    const labels = new Set<string>();
    for (const thread of accountFilteredThreads) {
      getEmailThreadDisplayLabels(thread, threadUiState[thread.id] ?? {}, messagesByThread[thread.id] ?? []).forEach((label) => labels.add(label));
    }
    return Array.from(labels).sort((left, right) => left.localeCompare(right));
  }, [accountFilteredThreads, messagesByThread, threadUiState]);

  const patchThreadUiState = useCallback((threadIds: string[], patch: Partial<EmailThreadUiState> | ((state: EmailThreadUiState) => EmailThreadUiState)) => {
    setThreadUiState((current) => {
      const next = { ...current };
      for (const threadId of threadIds) {
        const existing = next[threadId] ?? {};
        next[threadId] = typeof patch === "function" ? patch(existing) : { ...existing, ...patch };
      }
      return next;
    });
  }, []);

  const persistThreadState = useCallback((threadId: string, patch: Partial<EmailThreadUiState>) => {
    void onUpdateThreadState(threadId, patch).then((thread) => {
      setThreadUiState((current) => ({ ...current, [thread.id]: emailThreadUiStateFromThread(thread) }));
    });
  }, [onUpdateThreadState]);

  const applyEmailRoute = useCallback((patch: EmailRoutePatch) => {
    const nextMailbox = patch.mailbox ?? mailbox;
    const nextCategory = patch.category ?? category;
    const nextMode = patch.mailMode ?? mailMode;
    const nextAccountId = patch.accountId ?? selectedMailboxAccountId;
    const nextLabel = patch.label ?? labelFilter;
    const nextSearch = patch.search ?? searchQuery;
    const nextThreadId = patch.threadId ?? (nextMode === "detail" ? selectedThreadId : "");

    setMailbox(nextMailbox);
    setCategory(nextCategory);
    setMailMode(nextMode);
    setSelectedMailboxAccountId(nextAccountId);
    setLabelFilter(nextLabel);
    setSearchQuery(nextSearch);
    onRouteChange({
      accountId: nextAccountId,
      category: nextCategory,
      label: nextLabel,
      mailbox: nextMailbox,
      mailMode: nextMode,
      search: nextSearch,
      threadId: nextThreadId
    });
  }, [category, labelFilter, mailMode, mailbox, onRouteChange, searchQuery, selectedMailboxAccountId, selectedThreadId]);

  function updateThreadLabels(threadId: string, labels: string[]) {
    const normalizedLabels = Array.from(new Set(labels.map((label) => label.trim()).filter(Boolean))).slice(0, 20);
    patchThreadUiState([threadId], { labels: normalizedLabels });
    persistThreadState(threadId, { labels: normalizedLabels });
  }

  async function promptAddEmailLabel(threadIds: string[]) {
    const uniqueThreadIds = Array.from(new Set(threadIds.filter(Boolean)));
    if (!uniqueThreadIds.length) {
      onShowToast({ intent: "info", message: "请先选择邮件线程。" });
      return;
    }
    const label = await onRequestPrompt({
      title: "添加邮件标签",
      message: "输入一个标签名称，用于后续筛选和客户活动标记。",
      placeholder: "例如：重要客户 / 报价 / 售后",
      confirmLabel: "添加"
    });
    const normalizedLabel = label?.trim();
    if (!normalizedLabel) {
      return;
    }
    for (const threadId of uniqueThreadIds) {
      const thread = threads.find((candidate) => candidate.id === threadId);
      if (!thread) {
        continue;
      }
      const state = threadUiState[threadId] ?? {};
      const storedLabels = state.labels ?? thread.labels ?? [];
      updateThreadLabels(threadId, [...storedLabels, normalizedLabel]);
    }
    applyEmailRoute({ label: normalizedLabel, mailMode: "list", threadId: "" });
    onShowSuccess(`已添加标签：${normalizedLabel}`);
  }

  function removeEmailLabel(threadId: string, label: string) {
    const thread = threads.find((candidate) => candidate.id === threadId);
    if (!thread) {
      return;
    }
    const state = threadUiState[threadId] ?? {};
    updateThreadLabels(threadId, getEmailThreadUserLabels(thread, state).filter((candidate) => candidate.toLowerCase() !== label.toLowerCase()));
    if (labelFilter === label) {
      applyEmailRoute({ label: "", threadId: mailMode === "detail" ? selectedThreadId : "" });
    }
    onShowSuccess(`已移除标签：${label}`);
  }

  useEffect(() => {
    setThreadUiState((current) => ({ ...current, ...buildEmailThreadUiStateMap(threads) }));
  }, [threads]);

  useEffect(() => {
    setExistingContactId(selectedThreadContact?.id ?? contactRecords[0]?.id ?? "");
    setExistingContactPickerOpen(false);
  }, [contactRecords, selectedThreadContact?.id, selectedThreadId]);

  useEffect(() => {
    if (selectedMailboxAccountId !== allEmailAccountsKey && !accounts.some((account) => account.id === selectedMailboxAccountId)) {
      applyEmailRoute({ accountId: allEmailAccountsKey });
      setSelectedThreadIds(new Set());
    }
  }, [accounts, applyEmailRoute, selectedMailboxAccountId]);

  useEffect(() => {
    setMailbox((current) => (current === routeMailbox ? current : routeMailbox));
    setCategory((current) => (current === routeCategory ? current : routeCategory));
    setMailMode((current) => {
      const nextMode = routeEmailThreadIdToMode(detailThreadId, routeMailMode);
      return current === nextMode ? current : nextMode;
    });
    setSelectedMailboxAccountId((current) => (current === routeAccountId ? current : routeAccountId));
    setLabelFilter((current) => (current === routeLabel ? current : routeLabel));
    setSearchQuery((current) => (current === routeSearch ? current : routeSearch));
    if (detailThreadId && detailThreadId !== selectedThreadId) {
      onSelectThread(detailThreadId);
    }
  }, [detailThreadId, onSelectThread, routeAccountId, routeCategory, routeLabel, routeMailMode, routeMailbox, routeSearch, selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId || !messagesByThread[selectedThreadId]?.length) {
      return;
    }
    setThreadUiState((current) => ({ ...current, [selectedThreadId]: { ...current[selectedThreadId], read: true } }));
  }, [messagesByThread, selectedThreadId]);

  useEffect(() => {
    if (!detailThreadId) {
      return;
    }
    const thread = threads.find((candidate) => candidate.id === detailThreadId);
    if (!thread) {
      return;
    }
    const state = threadUiState[detailThreadId] ?? {};
    setSelectedThreadIds((current) => (current.size ? new Set() : current));
    setMailMode((current) => (current === "detail" ? current : "detail"));
    if (detailThreadId !== selectedThreadId) {
      onSelectThread(detailThreadId);
    }
    if (!state.read) {
      patchThreadUiState([detailThreadId], { read: true });
      persistThreadState(detailThreadId, { read: true });
    }
  }, [detailThreadId, onSelectThread, patchThreadUiState, persistThreadState, selectedThreadId, threadUiState, threads]);

  useEffect(() => {
    if (view === "mail" && hasEmailDraftContent) {
      setComposeOpen(true);
      setComposeMinimized(false);
    }
  }, [hasEmailDraftContent, view]);

  useEffect(() => {
    if (!composeOpenRequestKey || handledComposeOpenRequestRef.current === composeOpenRequestKey) {
      return;
    }
    handledComposeOpenRequestRef.current = composeOpenRequestKey;
    setComposeOpen(true);
    setComposeMinimized(false);
    setComposeFullSize(false);
  }, [composeOpenRequestKey]);

  useEffect(() => {
    if (emailDraft.cc.trim()) {
      setComposeCcVisible(true);
    }
    if (emailDraft.bcc.trim()) {
      setComposeBccVisible(true);
    }
  }, [emailDraft.bcc, emailDraft.cc]);

  useEffect(() => {
    const editor = composeEditorRef.current;
    if (!editor || !composeOpen || composeMinimized || document.activeElement === editor) {
      return;
    }
    if (editor.innerHTML !== draftEditorHtml) {
      editor.innerHTML = draftEditorHtml;
    }
  }, [composeMinimized, composeOpen, draftEditorHtml]);

  function selectMailboxAccount(accountId: string) {
    applyEmailRoute({ accountId, label: "", mailMode: "list", threadId: "" });
    setSelectedThreadIds(new Set());
  }

  function syncCurrentMailboxAccount() {
    if (selectedMailboxAccountId === allEmailAccountsKey) {
      onSyncAllAccounts();
    } else {
      onSyncAccount(selectedMailboxAccountId);
    }
  }

  function openComposePopup() {
    const selectedAccountCanSend = selectedMailboxAccountId !== allEmailAccountsKey && activeAccounts.some((account) => account.id === selectedMailboxAccountId);
    const accountId = selectedAccountCanSend ? selectedMailboxAccountId : emailDraft.accountId || activeAccounts[0]?.id || "";
    if (accountId && accountId !== emailDraft.accountId) {
      onEmailDraftChange(clearEmailDraftAiProvenance({ ...emailDraft, accountId }));
    }
    setComposeCcVisible(Boolean(emailDraft.cc.trim()));
    setComposeBccVisible(Boolean(emailDraft.bcc.trim()));
    setComposeOpen(true);
    setComposeMinimized(false);
    setComposeFullSize(false);
    window.setTimeout(() => {
      document.querySelector<HTMLInputElement>("[data-testid='email-compose-to']")?.focus();
    }, 0);
  }

  function closeComposePopup() {
    setComposeOpen(false);
    setComposeMinimized(false);
    setComposeFullSize(false);
    if (!emailDraft.cc.trim()) {
      setComposeCcVisible(false);
    }
    if (!emailDraft.bcc.trim()) {
      setComposeBccVisible(false);
    }
    onComposeClosed();
  }

  function sendEmailFromPopup() {
    onSend();
    closeComposePopup();
  }

  function updateComposeBodyFromEditor() {
    const editor = composeEditorRef.current;
    const bodyHtml = sanitizeComposeHtml(editor?.innerHTML ?? "");
    onEmailDraftChange(
      clearEmailDraftAiProvenance({
        ...emailDraft,
        bodyHtml,
        bodyText: stripHtmlToText(bodyHtml)
      })
    );
  }

  async function runComposeEditorCommand(command: "bold" | "italic" | "underline" | "insertUnorderedList" | "createLink") {
    composeEditorRef.current?.focus();
    if (command === "createLink") {
      const url = await onRequestPrompt({
        title: "插入链接",
        message: "输入要插入到邮件正文中的链接 URL。",
        placeholder: "https://example.com",
        confirmLabel: "插入"
      });
      if (!url) {
        return;
      }
      document.execCommand(command, false, url);
    } else {
      document.execCommand(command, false);
    }
    updateComposeBodyFromEditor();
  }

  async function insertComposeInlineImage(file: File | undefined) {
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      onShowToast({ intent: "error", message: "只能插入图片文件。" });
      return;
    }
    if (file.size > MAX_EMAIL_ATTACHMENT_BYTES) {
      onShowToast({ intent: "error", message: `图片不能超过 ${formatBytes(MAX_EMAIL_ATTACHMENT_BYTES)}。` });
      return;
    }
    const contentBase64 = await readFileAsBase64(file);
    const contentId = `${inlineImageContentIdPrefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const src = `data:${file.type || "image/png"};base64,${contentBase64}`;
    composeEditorRef.current?.focus();
    document.execCommand(
      "insertHTML",
      false,
      `<img src="${src}" data-content-id="${escapeHtml(contentId)}" data-file-name="${escapeHtml(file.name)}" data-content-type="${escapeHtml(file.type || "image/png")}" data-size="${file.size}" data-content-base64="${contentBase64}" alt="${escapeHtml(file.name)}">`
    );
    updateComposeBodyFromEditor();
  }

  function insertMediaAssetInline(asset: MediaAsset) {
    const contentId = `${inlineImageContentIdPrefix}${asset.id}`;
    composeEditorRef.current?.focus();
    document.execCommand(
      "insertHTML",
      false,
      `<img src="${mediaAssetDataUrl(asset)}" data-content-id="${escapeHtml(contentId)}" data-file-name="${escapeHtml(asset.name)}" data-content-type="${escapeHtml(asset.contentType)}" data-size="${asset.size}" data-content-base64="${asset.contentBase64}" alt="${escapeHtml(asset.name)}">`
    );
    updateComposeBodyFromEditor();
    setMediaLibraryOpen(false);
  }

  function performMailboxAction(action: "archive" | "unarchive" | "delete" | "restore" | "read" | "unread" | "snooze" | "unsnooze" | "important", threadIds = selectedThreadIdsArray) {
    if (!threadIds.length) {
      return;
    }
    if (action === "delete" && threadIds.some((threadId) => Boolean(threadUiState[threadId]?.deleted))) {
      void permanentlyDeleteThreads(threadIds);
      return;
    }
    let patchByThreadId = new Map<string, Partial<EmailThreadUiState>>();
    const trashDisplayAnchors =
      action === "delete"
        ? new Map(
            threadIds
              .map((threadId) => {
                const displayMessage = getEmailThreadDisplayMessage(messagesByThread[threadId] ?? [], mailbox);
                return displayMessage?.id ? [threadId, displayMessage.id] as const : undefined;
              })
              .filter(Boolean) as Array<readonly [string, string]>
          )
        : new Map<string, string>();
    if (action === "archive") {
      patchByThreadId = new Map(threadIds.map((threadId) => [threadId, { archived: true, deleted: false }]));
    } else if (action === "unarchive") {
      patchByThreadId = new Map(threadIds.map((threadId) => [threadId, { archived: false }]));
    } else if (action === "delete") {
      patchByThreadId = new Map(threadIds.map((threadId) => [threadId, { deleted: true, archived: false }]));
    } else if (action === "restore") {
      patchByThreadId = new Map(threadIds.map((threadId) => [threadId, { deleted: false }]));
    } else if (action === "read") {
      patchByThreadId = new Map(threadIds.map((threadId) => [threadId, { read: true }]));
    } else if (action === "unread") {
      patchByThreadId = new Map(threadIds.map((threadId) => [threadId, { read: false }]));
    } else if (action === "snooze") {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      patchByThreadId = new Map(threadIds.map((threadId) => [threadId, { snoozedUntil: tomorrow, archived: false, deleted: false }]));
    } else if (action === "unsnooze") {
      patchByThreadId = new Map(threadIds.map((threadId) => [threadId, { snoozedUntil: null }]));
    } else {
      patchByThreadId = new Map(threadIds.map((threadId) => [threadId, { important: !(threadUiState[threadId]?.important ?? false) }]));
    }
    for (const [threadId, patch] of patchByThreadId) {
      patchThreadUiState([threadId], patch);
      persistThreadState(threadId, patch);
    }
    if (action === "delete" && trashDisplayAnchors.size) {
      setTrashDisplayMessageIds((current) => {
        const next = { ...current };
        trashDisplayAnchors.forEach((messageId, threadId) => {
          next[threadId] = messageId;
        });
        return next;
      });
    } else if (action === "restore") {
      setTrashDisplayMessageIds((current) => {
        const next = { ...current };
        threadIds.forEach((threadId) => {
          delete next[threadId];
        });
        return next;
      });
    }
    setSelectedThreadIds(new Set());
    if (threadIds.includes(selectedThreadId) && (action === "archive" || action === "delete" || action === "restore" || action === "unarchive" || action === "snooze" || action === "unsnooze")) {
      applyEmailRoute({ mailMode: "list", threadId: "" });
    }
  }

  async function permanentlyDeleteThreads(threadIds: string[]) {
    const ids = Array.from(new Set(threadIds)).filter(Boolean);
    if (!ids.length) {
      return;
    }
    const deleted = await onDeleteThreads(ids);
    if (!deleted) {
      return;
    }
    setSelectedThreadIds((current) => {
      const next = new Set(current);
      ids.forEach((threadId) => next.delete(threadId));
      return next;
    });
    if (ids.includes(selectedThreadId)) {
      applyEmailRoute({ mailMode: "list", threadId: "" });
    }
  }

  function toggleThreadSelection(threadId: string, checked: boolean) {
    setSelectedThreadIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(threadId);
      } else {
        next.delete(threadId);
      }
      return next;
    });
  }

  function openThreadDetail(threadId: string) {
    applyEmailRoute({ mailMode: "detail", threadId });
    patchThreadUiState([threadId], { read: true });
    persistThreadState(threadId, { read: true });
    onSelectThread(threadId);
  }

  function updateEmailAccountProvider(provider: EmailAccount["provider"]) {
    const capability = getEmailProviderCapability(provider);
    onAccountDraftChange({
      ...accountDraft,
      provider,
      sendEnabled: accountDraft.sendEnabled && capability.supportsSend,
      syncEnabled: accountDraft.syncEnabled && capability.supportsSync,
      ...(capability.connectionKind === "smtp_imap"
        ? {}
        : {
            outboundServices: [
              createEmailOutboundServiceDraft("smtp", { id: "smtp" }),
              createEmailOutboundServiceDraft("resend", { id: "resend", enabled: false })
            ],
            defaultOutboundServiceId: "smtp",
            syncProtocol: "imap",
            imapHost: "",
            imapPort: "993",
            imapSecure: true,
            pop3Host: "",
            pop3Port: "995",
            pop3Secure: true,
            username: "",
            password: "",
            mailbox: "INBOX"
          }),
      ...(capability.supportsOAuth
        ? {}
        : {
            oauthAccessToken: "",
            oauthRefreshToken: "",
            oauthExpiresAt: "",
            oauthScope: ""
          })
    });
  }

  async function addEmailAttachmentFiles(files: FileList | File[] | null) {
    const selectedFiles = Array.from(files ?? []);
    if (!selectedFiles.length) {
      return;
    }
    const existing = emailDraft.attachments ?? [];
    if (existing.length + selectedFiles.length > 10) {
      onShowToast({ intent: "error", message: "邮件附件最多 10 个文件。" });
      return;
    }
    const uploadItems = selectedFiles.map((file) => ({
      id: `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fileName: file.name,
      size: file.size,
      progress: 0,
      status: "queued" as const
    }));
    setAttachmentUploads((current) => [...current, ...uploadItems]);
    const attachments: EmailAttachment[] = [];
    for (const [index, file] of selectedFiles.entries()) {
      const uploadItem = uploadItems[index];
      try {
        setAttachmentUploads((current) => current.map((item) => (item.id === uploadItem.id ? { ...item, status: "reading", progress: 8 } : item)));
        const attachment = await readEmailAttachmentFile(file, (progress) => {
          setAttachmentUploads((current) => current.map((item) => (item.id === uploadItem.id ? { ...item, status: "reading", progress } : item)));
        });
        attachments.push(attachment);
        setAttachmentUploads((current) => current.map((item) => (item.id === uploadItem.id ? { ...item, status: "complete", progress: 100 } : item)));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "无法读取邮件附件。";
        setAttachmentUploads((current) => current.map((item) => (item.id === uploadItem.id ? { ...item, status: "error", error: errorMessage } : item)));
      }
    }
    if (attachments.length) {
      onEmailDraftChange({ ...emailDraft, attachments: [...existing, ...attachments] });
    }
  }

  function removeEmailAttachment(index: number) {
    onEmailDraftChange({
      ...emailDraft,
      attachments: (emailDraft.attachments ?? []).filter((_, candidateIndex) => candidateIndex !== index)
    });
  }

  function handleAttachmentDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setAttachmentDragActive(false);
    void addEmailAttachmentFiles(Array.from(event.dataTransfer.files));
  }

  function generateComposeDraftWithAi() {
    onGenerateAiForDraft(composeAiPrompt.trim());
  }

  async function generateComposePromptWithAi() {
    setComposePromptGenerating(true);
    try {
      const nextPrompt = await onGenerateAiPromptForDraft(composeAiPrompt.trim());
      setComposeAiPrompt(nextPrompt);
    } finally {
      setComposePromptGenerating(false);
    }
  }

  function renderEmailAiSources(sources?: EmailAiSource[]) {
    if (!sources?.length) {
      return null;
    }
    return (
      <div className="toolbar" style={{ marginTop: 8 }}>
        {sources.map((source) =>
          canOpenEmailAiSource(source) ? (
            <button className="secondary-button" data-testid={emailAiSourceTestId(source)} key={emailAiSourceKey(source)} type="button" onClick={() => onOpenAiSource(source)}>
              {source.label}
            </button>
          ) : (
            <span className="badge" key={emailAiSourceKey(source)}>{source.label}</span>
          )
        )}
      </div>
    );
  }

  function emailAiSourceTestId(source: EmailAiSource): string {
    if (source.recordId) {
      return `email-ai-source-record-${source.recordId}`;
    }
    if (source.messageId) {
      return `email-ai-source-message-${source.messageId}`;
    }
    if (source.activityId) {
      return `email-ai-source-activity-${source.activityId}`;
    }
    if (source.knowledgeArticleId) {
      return `email-ai-source-knowledge-${source.knowledgeArticleId}`;
    }
    return "email-ai-source";
  }

  const emailSettingsSteps: Array<{ key: EmailSettingsStep; label: string; description: string }> = [
    { key: "identity", label: "基础信息", description: "账户身份与 Provider" },
    { key: "inbound", label: "收件配置", description: "IMAP、POP3 或 OAuth" },
    { key: "outbound", label: "发件服务", description: "SMTP、Resend 与默认服务" },
    { key: "review", label: "检查启用", description: "保存、测试与同步" }
  ];
  const currentEmailSettingsStepIndex = Math.max(0, emailSettingsSteps.findIndex((step) => step.key === emailSettingsStep));

  async function runAccountConnectionTest(account: EmailAccount, options: { scope?: EmailConnectionTestScope; outboundServiceId?: string } = {}) {
    const stateKey = emailConnectionTestStateKey(account.id, options);
    if (!account.connectionConfigured) {
      setAccountConnectionTests((current) => ({
        ...current,
        [stateKey]: { status: "failed", message: "需要先保存连接配置" }
      }));
      return;
    }
    setAccountConnectionTests((current) => ({
      ...current,
      [stateKey]: { status: "testing", message: "正在测试连接" }
    }));
    try {
      await onTestConnection(account.id, options);
      setAccountConnectionTests((current) => ({
        ...current,
        [stateKey]: { status: "success", message: "连接测试通过", testedAt: new Date().toISOString() }
      }));
    } catch (error) {
      setAccountConnectionTests((current) => ({
        ...current,
        [stateKey]: { status: "failed", message: error instanceof Error ? error.message : "连接测试失败", testedAt: new Date().toISOString() }
      }));
    }
  }

  function emailConnectionTestStateKey(accountId: string, options: { scope?: EmailConnectionTestScope; outboundServiceId?: string } = {}) {
    return [accountId, options.scope ?? "all", options.outboundServiceId ?? ""].join(":");
  }

  function renderEmailAccountFormActions() {
    return (
      <div className="toolbar email-setup-actions">
        {accountDraft.editingAccountId ? (
          <>
            <button className="primary-button" data-testid="email-account-update" type="button" onClick={onUpdateAccountFromDraft} disabled={disabled || !accountDraft.name.trim() || !accountDraft.emailAddress.trim()}>
              <Save size={16} />
              保存账户
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                onResetAccountDraft();
                setEmailSettingsStep("identity");
              }}
              disabled={disabled}
            >
              取消编辑
            </button>
          </>
        ) : (
          <button className="primary-button" data-testid="email-account-create" type="button" onClick={onCreateAccount} disabled={disabled || !accountDraft.name.trim() || !accountDraft.emailAddress.trim()}>
            <Save size={16} />
            创建账户
          </button>
        )}
        <button className="secondary-button" data-testid="email-oauth-start" type="button" onClick={onStartOAuth} disabled={disabled || Boolean(accountDraft.editingAccountId) || !accountDraft.emailAddress.trim() || !selectedProviderSetupVisibility.canStartOAuth}>
          <Mail size={16} />
          OAuth 授权
        </button>
      </div>
    );
  }

  function renderEmailIdentityStep() {
    return (
      <div className="form-grid">
        <label>
          <span className="subtle">名称</span>
          <input className="input" data-testid="email-account-name" value={accountDraft.name} onChange={(event) => onAccountDraftChange({ ...accountDraft, name: event.target.value })} />
        </label>
        <label>
          <span className="subtle">邮箱</span>
          <input className="input" data-testid="email-account-address" value={accountDraft.emailAddress} onChange={(event) => onAccountDraftChange({ ...accountDraft, emailAddress: event.target.value })} />
        </label>
        <label>
          <span className="subtle">Provider</span>
          <select className="select" value={accountDraft.provider} onChange={(event) => updateEmailAccountProvider(event.target.value as EmailAccount["provider"])}>
            {listEmailProviderCapabilities().map((provider) => (
              <option key={provider.key} value={provider.key}>
                {provider.label}
              </option>
            ))}
          </select>
        </label>
        <div className="settings-item wide">
          <strong>{selectedProviderCapability.label}</strong>
          <div className="subtle">{selectedProviderCapability.description}</div>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <span className={selectedProviderCapability.supportsSend ? "badge" : "danger-badge"}>发送 {selectedProviderCapability.supportsSend ? "已支持" : "需要 adapter"}</span>
            <span className={selectedProviderCapability.supportsSync ? "badge" : "danger-badge"}>同步 {selectedProviderCapability.supportsSync ? "已支持" : "需要 adapter"}</span>
            <span className="badge">{selectedProviderCapability.connectionKind}</span>
          </div>
        </div>
        <label className="settings-toggle">
          <input type="checkbox" checked={accountDraft.sendEnabled && selectedProviderCapability.supportsSend} onChange={(event) => onAccountDraftChange({ ...accountDraft, sendEnabled: event.target.checked && selectedProviderCapability.supportsSend })} disabled={!selectedProviderCapability.supportsSend} />
          允许发送
        </label>
        <label className="settings-toggle">
          <input type="checkbox" checked={accountDraft.syncEnabled && selectedProviderCapability.supportsSync} onChange={(event) => onAccountDraftChange({ ...accountDraft, syncEnabled: event.target.checked && selectedProviderCapability.supportsSync })} disabled={!selectedProviderCapability.supportsSync} />
          允许同步
        </label>
      </div>
    );
  }

  function renderEmailInboundStep() {
    return (
      <div className="form-grid">
        {selectedProviderSetupVisibility.showSmtpImapFields ? (
          <>
            <div className="settings-item wide">
              <div className="toolbar between">
                <div>
                  <strong>收件配置</strong>
                  <div className="subtle">IMAP/POP3 的用户名和密码只用于收件同步，可以与发件服务凭据不同。</div>
                </div>
                {editingEmailAccount ? (
                  <button
                    className="secondary-button"
                    data-testid="email-test-inbound"
                    type="button"
                    onClick={() => runAccountConnectionTest(editingEmailAccount, { scope: "inbound" })}
                    disabled={disabled || accountConnectionTests[emailConnectionTestStateKey(editingEmailAccount.id, { scope: "inbound" })]?.status === "testing"}
                  >
                    <RefreshCw className={accountConnectionTests[emailConnectionTestStateKey(editingEmailAccount.id, { scope: "inbound" })]?.status === "testing" ? "spin-icon" : undefined} size={16} />
                    测试收件
                  </button>
                ) : null}
              </div>
            </div>
            <label>
              <span className="subtle">收信协议</span>
              <select
                className="select"
                data-testid="email-account-sync-protocol"
                value={accountDraft.syncProtocol}
                onChange={(event) => onAccountDraftChange({ ...accountDraft, syncProtocol: event.target.value as "imap" | "pop3" })}
              >
                <option value="imap">IMAP</option>
                <option value="pop3">POP3</option>
              </select>
            </label>
            {accountDraft.syncProtocol === "imap" ? (
              <>
                <label>
                  <span className="subtle">IMAP Host</span>
                  <input className="input" data-testid="email-account-imap-host" value={accountDraft.imapHost} onChange={(event) => onAccountDraftChange({ ...accountDraft, imapHost: event.target.value })} />
                </label>
                <label>
                  <span className="subtle">IMAP Port</span>
                  <input className="input" type="number" value={accountDraft.imapPort} onChange={(event) => onAccountDraftChange({ ...accountDraft, imapPort: event.target.value })} />
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={accountDraft.imapSecure} onChange={(event) => onAccountDraftChange({ ...accountDraft, imapSecure: event.target.checked })} />
                  IMAP TLS
                </label>
              </>
            ) : (
              <>
                <label>
                  <span className="subtle">POP3 Host</span>
                  <input className="input" data-testid="email-account-pop3-host" value={accountDraft.pop3Host} onChange={(event) => onAccountDraftChange({ ...accountDraft, pop3Host: event.target.value })} />
                </label>
                <label>
                  <span className="subtle">POP3 Port</span>
                  <input className="input" type="number" value={accountDraft.pop3Port} onChange={(event) => onAccountDraftChange({ ...accountDraft, pop3Port: event.target.value })} />
                </label>
                <label className="settings-toggle">
                  <input type="checkbox" checked={accountDraft.pop3Secure} onChange={(event) => onAccountDraftChange({ ...accountDraft, pop3Secure: event.target.checked })} />
                  POP3 TLS
                </label>
              </>
            )}
            <label>
              <span className="subtle">收件用户名</span>
              <input className="input" data-testid="email-account-inbound-username" value={accountDraft.username} onChange={(event) => onAccountDraftChange({ ...accountDraft, username: event.target.value })} />
            </label>
            <label>
              <span className="subtle">收件密码/应用密码</span>
              <input className="input" data-testid="email-account-inbound-password" type="password" value={accountDraft.password} onChange={(event) => onAccountDraftChange({ ...accountDraft, password: event.target.value })} placeholder={accountDraft.editingAccountId ? "留空保留已保存密码" : undefined} />
            </label>
            {accountDraft.syncProtocol === "imap" ? (
              <label>
                <span className="subtle">邮箱文件夹</span>
                <input className="input" value={accountDraft.mailbox} onChange={(event) => onAccountDraftChange({ ...accountDraft, mailbox: event.target.value })} />
              </label>
            ) : null}
          </>
        ) : null}
        {selectedProviderSetupVisibility.showOAuthFields ? (
          <>
            <div className="settings-item wide">
              <strong>OAuth 连接</strong>
              <div className="subtle">OAuth token 仅保存在连接配置中，API 响应不会回传密钥。</div>
            </div>
            <label>
              <span className="subtle">OAuth Access Token</span>
              <input className="input" type="password" value={accountDraft.oauthAccessToken} onChange={(event) => onAccountDraftChange({ ...accountDraft, oauthAccessToken: event.target.value })} placeholder={accountDraft.editingAccountId ? "留空保留 access token" : undefined} />
            </label>
            <label>
              <span className="subtle">OAuth Refresh Token</span>
              <input className="input" type="password" value={accountDraft.oauthRefreshToken} onChange={(event) => onAccountDraftChange({ ...accountDraft, oauthRefreshToken: event.target.value })} placeholder={accountDraft.editingAccountId ? "留空保留 refresh token" : undefined} />
            </label>
            <label>
              <span className="subtle">OAuth Expires At</span>
              <input className="input" type="datetime-local" value={accountDraft.oauthExpiresAt} onChange={(event) => onAccountDraftChange({ ...accountDraft, oauthExpiresAt: event.target.value })} />
            </label>
            <label>
              <span className="subtle">OAuth Scope</span>
              <input className="input" value={accountDraft.oauthScope} onChange={(event) => onAccountDraftChange({ ...accountDraft, oauthScope: event.target.value })} />
            </label>
          </>
        ) : null}
        {!selectedProviderSetupVisibility.showSmtpImapFields && !selectedProviderSetupVisibility.showOAuthFields ? (
          <div className="empty-state wide">当前 Provider 不需要在这里配置收件连接。</div>
        ) : null}
      </div>
    );
  }

  function renderEmailOutboundStep() {
    return (
      <div className="form-grid">
        {selectedProviderSetupVisibility.showSmtpImapFields ? (
          <>
            <div className="settings-item wide">
              <strong>发件服务</strong>
              <div className="subtle">发件服务与收件箱独立配置。一个收件箱可以映射多条 SMTP、Resend 等不同发件服务。</div>
            </div>
            <label>
              <span className="subtle">默认发件服务</span>
              <select
                className="select"
                data-testid="email-account-outbound-type"
                value={accountDraft.defaultOutboundServiceId}
                onChange={(event) => onAccountDraftChange({ ...accountDraft, defaultOutboundServiceId: event.target.value })}
              >
                {accountDraft.outboundServices.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name || service.type.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <div className="toolbar">
              <button type="button" className="secondary-button" onClick={() => addOutboundServiceDraft("smtp")}>添加 SMTP</button>
              <button type="button" className="secondary-button" onClick={() => addOutboundServiceDraft("resend")}>添加 Resend</button>
            </div>
            {accountDraft.outboundServices.map((service, index) => (
              <div className="settings-item wide" key={service.id}>
                <div className="toolbar between">
                  <strong>{service.type === "smtp" ? "SMTP 发件服务" : "Resend 发件服务"}</strong>
                  <div className="toolbar">
                    {editingEmailAccount ? (
                      <button
                        className="secondary-button"
                        data-testid={`email-test-outbound-${service.id}`}
                        type="button"
                        onClick={() => runAccountConnectionTest(editingEmailAccount, { scope: "outbound", outboundServiceId: service.id })}
                        disabled={disabled || accountConnectionTests[emailConnectionTestStateKey(editingEmailAccount.id, { scope: "outbound", outboundServiceId: service.id })]?.status === "testing"}
                      >
                        <RefreshCw className={accountConnectionTests[emailConnectionTestStateKey(editingEmailAccount.id, { scope: "outbound", outboundServiceId: service.id })]?.status === "testing" ? "spin-icon" : undefined} size={16} />
                        测试发件
                      </button>
                    ) : null}
                    <button type="button" className="icon-button" title="删除发件服务" onClick={() => removeOutboundServiceDraft(service.id)} disabled={accountDraft.outboundServices.length <= 1}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="form-grid" style={{ marginTop: 10 }}>
                  <label>
                    <span className="subtle">服务名称</span>
                    <input className="input" value={service.name} onChange={(event) => updateOutboundServiceDraft(service.id, { name: event.target.value })} />
                  </label>
                  <label>
                    <span className="subtle">类型</span>
                    <select className="select" value={service.type} onChange={(event) => updateOutboundServiceDraft(service.id, { type: event.target.value as "smtp" | "resend" })}>
                      <option value="smtp">SMTP</option>
                      <option value="resend">Resend</option>
                    </select>
                  </label>
                  <label>
                    <span className="subtle">发件 From</span>
                    <input className="input" data-testid={index === 0 ? "email-account-outbound-from" : `email-account-outbound-from-${service.id}`} value={service.fromEmail} onChange={(event) => updateOutboundServiceDraft(service.id, { fromEmail: event.target.value })} placeholder={accountDraft.emailAddress || "sales@example.com"} />
                  </label>
                  <label className="settings-toggle">
                    <input type="checkbox" checked={service.enabled} onChange={(event) => updateOutboundServiceDraft(service.id, { enabled: event.target.checked })} />
                    启用
                  </label>
                  {service.type === "smtp" ? (
                    <>
                      <label>
                        <span className="subtle">SMTP Host</span>
                        <input className="input" data-testid={index === 0 ? "email-account-smtp-host" : `email-account-smtp-host-${service.id}`} value={service.smtpHost} onChange={(event) => updateOutboundServiceDraft(service.id, { smtpHost: event.target.value })} />
                      </label>
                      <label>
                        <span className="subtle">SMTP Port</span>
                        <input className="input" type="number" value={service.smtpPort} onChange={(event) => updateOutboundServiceDraft(service.id, { smtpPort: event.target.value })} />
                      </label>
                      <label className="settings-toggle">
                        <input type="checkbox" checked={service.smtpSecure} onChange={(event) => updateOutboundServiceDraft(service.id, { smtpSecure: event.target.checked, smtpStartTls: event.target.checked ? false : service.smtpStartTls })} />
                        SMTP TLS
                      </label>
                      <label className="settings-toggle">
                        <input type="checkbox" checked={service.smtpStartTls} onChange={(event) => updateOutboundServiceDraft(service.id, { smtpStartTls: event.target.checked, smtpSecure: event.target.checked ? false : service.smtpSecure })} />
                        SMTP STARTTLS
                      </label>
                      <label>
                        <span className="subtle">SMTP 用户名</span>
                        <input className="input" data-testid={index === 0 ? "email-account-smtp-username" : `email-account-smtp-username-${service.id}`} value={service.username} onChange={(event) => updateOutboundServiceDraft(service.id, { username: event.target.value })} />
                      </label>
                      <label>
                        <span className="subtle">SMTP 密码/API Key</span>
                        <input className="input" data-testid={index === 0 ? "email-account-smtp-password" : `email-account-smtp-password-${service.id}`} type="password" value={service.password} onChange={(event) => updateOutboundServiceDraft(service.id, { password: event.target.value })} placeholder={accountDraft.editingAccountId ? "留空保留已保存密码" : undefined} />
                      </label>
                    </>
                  ) : (
                    <label className="wide">
                      <span className="subtle">Resend API Key</span>
                      <input className="input" data-testid={index === 0 ? "email-account-resend-api-key" : `email-account-resend-api-key-${service.id}`} type="password" value={service.resendApiKey} onChange={(event) => updateOutboundServiceDraft(service.id, { resendApiKey: event.target.value })} placeholder={accountDraft.editingAccountId ? "留空保留 Resend API Key" : undefined} />
                    </label>
                  )}
                </div>
              </div>
            ))}
          </>
        ) : (
          <div className="empty-state wide">当前 Provider 使用自身 adapter 发送，不需要配置独立发件服务。</div>
        )}
      </div>
    );
  }

  function renderEmailReviewStep() {
    return (
      <div className="settings-list">
        <div className="settings-item">
          <strong>{accountDraft.name || "未命名邮箱账户"}</strong>
          <div className="subtle">{accountDraft.emailAddress || "未填写邮箱"} · {selectedProviderCapability.label}</div>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <span className={accountDraft.sendEnabled ? "badge" : "danger-badge"}>发送 {accountDraft.sendEnabled ? "on" : "off"}</span>
            <span className={accountDraft.syncEnabled ? "badge" : "danger-badge"}>同步 {accountDraft.syncEnabled ? "on" : "off"}</span>
            <span className="badge">发件服务 {accountDraft.outboundServices.filter((service) => service.enabled).length}</span>
            <span className="badge">收件 {accountDraft.syncProtocol.toUpperCase()}</span>
          </div>
        </div>
        {renderEmailAccountFormActions()}
        {canManageEmailSettings ? (
          <button
            className="secondary-button"
            data-testid="email-sync-all"
            type="button"
            onClick={onSyncAllAccounts}
            disabled={
              disabled ||
              !accounts.some((account) => {
                const capability = getEmailProviderCapability(account.provider);
                return account.status === "active" && account.syncEnabled && account.connectionConfigured && capability.supportsSync;
              })
            }
          >
            <RefreshCw className={disabled ? "spin-icon" : undefined} size={16} />
            同步全部
          </button>
        ) : null}
      </div>
    );
  }

  function renderEmailSettingsStepContent() {
    if (emailSettingsStep === "identity") {
      return renderEmailIdentityStep();
    }
    if (emailSettingsStep === "inbound") {
      return renderEmailInboundStep();
    }
    if (emailSettingsStep === "outbound") {
      return renderEmailOutboundStep();
    }
    return renderEmailReviewStep();
  }

  function renderEmailAccountList() {
    return (
      <section className="section email-account-list-panel">
        <div className="settings-panel-header">
          <div>
            <h2 className="page-title" style={{ fontSize: 18 }}>已配置邮箱</h2>
            <div className="subtle">{accounts.length} 个邮箱账户</div>
          </div>
        </div>
        <div className="settings-list">
          {accounts.map((account) => {
            const capability = getEmailProviderCapability(account.provider);
            const testState = accountConnectionTests[emailConnectionTestStateKey(account.id)];
            const isTesting = testState?.status === "testing";
            return (
              <div className="settings-item" key={account.id}>
                <strong>{account.name}</strong>
                <div className="subtle">{account.emailAddress} · {account.provider} · {account.status}</div>
                <div className="toolbar" style={{ marginTop: 8 }}>
                  <span className={account.sendEnabled && capability.supportsSend ? "badge" : "danger-badge"}>发送 {account.sendEnabled && capability.supportsSend ? "on" : "off"}</span>
                  <span className={account.syncEnabled && capability.supportsSync ? "badge" : "danger-badge"}>同步 {account.syncEnabled && capability.supportsSync ? "on" : "off"}</span>
                  <span className={account.connectionConfigured ? "badge" : "danger-badge"}>连接 {account.connectionConfigured ? "已配置" : "未配置"}</span>
                </div>
                {canManageEmailSettings ? (
                  <div className="toolbar email-account-actions">
                    <button className="secondary-button" type="button" onClick={() => runAccountConnectionTest(account)} disabled={disabled || isTesting}>
                      <RefreshCw className={disabled ? "spin-icon" : undefined} size={16} />
                      {isTesting ? "测试中" : "测试连接"}
                    </button>
                    <button
                      className="secondary-button"
                      data-testid={`email-account-edit-${account.id}`}
                      type="button"
                      onClick={() => {
                        onEditAccount(account);
                        setEmailSettingsStep("identity");
                      }}
                      disabled={disabled}
                    >
                      编辑连接
                    </button>
                    <button className="secondary-button" type="button" onClick={() => onUpdateAccount(account.id, { sendEnabled: !account.sendEnabled })} disabled={disabled || !capability.supportsSend}>
                      {account.sendEnabled ? "关闭发送" : "开启发送"}
                    </button>
                    <button className="secondary-button" type="button" onClick={() => onUpdateAccount(account.id, { syncEnabled: !account.syncEnabled })} disabled={disabled || !capability.supportsSync}>
                      {account.syncEnabled ? "关闭同步" : "开启同步"}
                    </button>
                    <button
                      className={account.status === "disabled" ? "secondary-button" : "danger-button"}
                      type="button"
                      onClick={() =>
                        onUpdateAccount(
                          account.id,
                          account.status === "disabled" ? { status: "active" } : { status: "disabled", syncEnabled: false, sendEnabled: false }
                        )
                      }
                      disabled={disabled}
                    >
                      {account.status === "disabled" ? "启用" : "停用"}
                    </button>
                    <button className="secondary-button" type="button" onClick={() => onSyncAccount(account.id)} disabled={disabled || !account.syncEnabled || !account.connectionConfigured || !capability.supportsSync || account.status !== "active"}>
                      <RefreshCw className={disabled ? "spin-icon" : undefined} size={16} />
                      同步
                    </button>
                  </div>
                ) : null}
                {testState ? <div className={`email-test-status ${testState.status}`}>{testState.message}</div> : null}
                {canManageEmailSettings && account.lastConnectionError ? <div className="subtle">连接错误：{account.lastConnectionError}</div> : null}
              </div>
            );
          })}
          {accounts.length === 0 ? <div className="empty-state">还没有邮箱账户</div> : null}
        </div>
      </section>
    );
  }

  function renderEmailSyncSettingsPanel() {
    const enabledAccountCount = accounts.filter((account) => {
      const capability = getEmailProviderCapability(account.provider);
      return account.status === "active" && account.syncEnabled && account.connectionConfigured && capability.supportsSync;
    }).length;
    return (
      <section className="section email-account-list-panel" data-testid="email-sync-settings-panel">
        <div className="settings-panel-header">
          <div>
            <h2 className="page-title" style={{ fontSize: 18 }}>后台自动同步</h2>
            <div className="subtle">不打开浏览器也会由 email-sync 容器按此策略同步收件箱。</div>
          </div>
          <span className={syncSettings.enabled ? "badge" : "danger-badge"}>{syncSettings.enabled ? "已启用" : "已关闭"}</span>
        </div>
        <div className="settings-list">
          <label className="settings-toggle">
            <input data-testid="email-sync-enabled" type="checkbox" checked={syncSettings.enabled} onChange={(event) => onUpdateSyncSettings({ enabled: event.target.checked })} disabled={disabled} />
            启用后台自动同步
          </label>
          <div className="form-grid">
            <label>
              <span className="subtle">同步模式</span>
              <select className="select" data-testid="email-sync-mode" value={syncSettings.mode} onChange={(event) => onUpdateSyncSettings({ mode: event.target.value as EmailSyncSettings["mode"] })} disabled={disabled || !syncSettings.enabled}>
                <option value="interval">按间隔同步</option>
                <option value="daily">每日固定时间</option>
              </select>
            </label>
            {syncSettings.mode === "interval" ? (
              <label>
                <span className="subtle">间隔分钟</span>
                <input className="input" data-testid="email-sync-interval-minutes" min={1} max={1440} type="number" value={syncSettings.intervalMinutes} onChange={(event) => onUpdateSyncSettings({ intervalMinutes: numberInputValue(event.target.value, syncSettings.intervalMinutes) })} disabled={disabled || !syncSettings.enabled} />
              </label>
            ) : (
              <label>
                <span className="subtle">每日时间</span>
                <input className="input" data-testid="email-sync-daily-at" type="time" value={syncSettings.dailyAt} onChange={(event) => onUpdateSyncSettings({ dailyAt: event.target.value })} disabled={disabled || !syncSettings.enabled} />
              </label>
            )}
            <label>
              <span className="subtle">每轮上限</span>
              <input className="input" data-testid="email-sync-limit" min={1} max={100} type="number" value={syncSettings.limit} onChange={(event) => onUpdateSyncSettings({ limit: numberInputValue(event.target.value, syncSettings.limit) })} disabled={disabled || !syncSettings.enabled} />
            </label>
          </div>
          <div className="toolbar">
            <span className="badge">可同步账户 {enabledAccountCount}</span>
            <span className="badge">{syncSettings.mode === "daily" ? `每日 ${syncSettings.dailyAt}` : `每 ${syncSettings.intervalMinutes} 分钟`}</span>
            <span className="badge">上限 {syncSettings.limit}</span>
          </div>
        </div>
      </section>
    );
  }

  function renderEmailSignatureSettingsPanel() {
    const signaturePreviewSender =
      accounts.find((account) => account.id === signatureDraft.accountId)?.emailAddress ||
      accounts.find(canSelectEmailAccountForSending)?.emailAddress ||
      "sales@example.com";
    const previewHtml = renderEmailSignatureTemplate(signatureDraft.bodyHtml.trim() || emailTextToHtml(signatureDraft.bodyText), signaturePreviewSender);
    return (
      <section className="section email-signature-settings-panel" data-testid="email-signature-settings-panel">
        <div className="settings-panel-header">
          <div>
            <h2 className="page-title" style={{ fontSize: 18 }}>邮件签名</h2>
            <div className="subtle">可创建多个签名，支持全局签名或绑定到指定发件账户。发送时才会追加到正文。</div>
          </div>
          <span className="badge">{signatures.length} 个签名</span>
        </div>
        <div className="email-signature-settings-grid">
          <div className="settings-list">
            {signatures.map((signature) => {
              const account = signature.accountId ? accounts.find((candidate) => candidate.id === signature.accountId) : undefined;
              return (
                <div className="settings-item" key={signature.id}>
                  <div className="toolbar between">
                    <strong>{signature.name}</strong>
                    <div className="toolbar compact-toolbar">
                      {signature.isDefault ? <span className="badge">默认</span> : null}
                      <span className={signature.active ? "badge" : "danger-badge"}>{signature.active ? "启用" : "停用"}</span>
                    </div>
                  </div>
                  <div className="subtle">{account ? `账户：${account.emailAddress}` : "全局签名"}</div>
                  <div className="subtle signature-snippet">{signature.bodyText}</div>
                  <div className="toolbar compact-toolbar" style={{ marginTop: 8 }}>
                    <button className="secondary-button" type="button" onClick={() => onEditSignature(signature)} disabled={disabled}>
                      <Pencil size={14} />
                      编辑
                    </button>
                    <button className="danger-button" type="button" onClick={() => onDeleteSignature(signature)} disabled={disabled}>
                      <Trash2 size={14} />
                      删除
                    </button>
                  </div>
                </div>
              );
            })}
            {signatures.length === 0 ? <div className="empty-state">还没有邮件签名</div> : null}
          </div>
          <div className="email-signature-editor">
            <div className="form-grid">
              <label>
                <span className="subtle">签名名称</span>
                <input className="input" data-testid="email-signature-name" value={signatureDraft.name} onChange={(event) => onSignatureDraftChange({ ...signatureDraft, name: event.target.value })} />
              </label>
              <label>
                <span className="subtle">适用账户</span>
                <select className="select" data-testid="email-signature-account" value={signatureDraft.accountId} onChange={(event) => onSignatureDraftChange({ ...signatureDraft, accountId: event.target.value })}>
                  <option value="">全局签名</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.emailAddress}</option>
                  ))}
                </select>
              </label>
              <label className="settings-toggle">
                <input type="checkbox" checked={signatureDraft.active} onChange={(event) => onSignatureDraftChange({ ...signatureDraft, active: event.target.checked })} />
                启用签名
              </label>
              <label className="settings-toggle">
                <input type="checkbox" checked={signatureDraft.isDefault} onChange={(event) => onSignatureDraftChange({ ...signatureDraft, isDefault: event.target.checked })} />
                设为默认签名
              </label>
              <label className="wide">
                <span className="subtle">文本签名</span>
                <textarea className="textarea" data-testid="email-signature-body-text" value={signatureDraft.bodyText} onChange={(event) => onSignatureDraftChange({ ...signatureDraft, bodyText: event.target.value })} />
              </label>
              <label className="wide">
                <span className="subtle">HTML 签名</span>
                <textarea className="textarea" data-testid="email-signature-body-html" value={signatureDraft.bodyHtml} onChange={(event) => onSignatureDraftChange({ ...signatureDraft, bodyHtml: event.target.value })} />
              </label>
            </div>
            <div className="email-signature-preview" data-testid="email-signature-settings-preview">
              <span className="subtle">预览。可使用 <code>{"{{senderEmail}}"}</code> 作为发件邮箱占位符。</span>
              <iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={buildEmailHtmlPreview(previewHtml)} title="签名设置预览" />
            </div>
            <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 10 }}>
              <button className="secondary-button" type="button" onClick={onResetSignatureDraft} disabled={disabled}>
                取消
              </button>
              <button className="primary-button" data-testid="email-signature-save" type="button" onClick={onSaveSignature} disabled={disabled || !signatureDraft.name.trim() || !signatureDraft.bodyText.trim()}>
                <Save size={16} />
                {signatureDraft.editingSignatureId ? "保存签名" : "创建签名"}
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className={`email-workspace ${view === "mail" ? "mail-view" : ""}`}>
      {view !== "mail" ? (
      <div className="tabs email-tabs" data-testid="email-workspace-tabs">
        <AppSidebarToggleButton collapsed={sidebarCollapsed} onToggle={onToggleAppSidebar} testId="email-app-sidebar-toggle" />
        <button className="tab" data-testid="email-tab-mail" type="button" onClick={() => onViewChange("mail")}>
          收发信
        </button>
        {canManageEmailSettings ? (
          <button className={`tab ${view === "settings" ? "active" : ""}`} data-testid="email-tab-settings" type="button" onClick={() => onViewChange("settings")}>
            邮箱设置
          </button>
        ) : null}
        <button className={`tab ${view === "ai" ? "active" : ""}`} data-testid="email-tab-ai" type="button" onClick={() => onViewChange("ai")}>
          AI 与知识库
        </button>
      </div>
      ) : null}

      {view === "settings" ? (
        <div className="email-settings-layout">
          <div className="email-settings-side">
            {renderEmailAccountList()}
            {canManageEmailSettings ? renderEmailSyncSettingsPanel() : null}
            {canManageEmailSettings ? <EmailDiagnosticsPanel diagnostics={diagnostics} connectionTestRun={connectionTestRun} disabled={disabled} onRefresh={onRefreshDiagnostics} onTestAll={onTestAllConnections} onRetryMessage={onRetryMessage} /> : null}
          </div>
          <section className="section email-settings-main">
            <div className="settings-panel-header">
              <div>
                <h2 className="page-title" style={{ fontSize: 18 }}>{accountDraft.editingAccountId ? "编辑邮箱账户" : "新增邮箱账户"}</h2>
                <div className="subtle">Provider 通过 adapter 扩展，收件、发件和 AI 连接保持独立配置。</div>
              </div>
            </div>
            {canManageEmailSettings ? (
              <>
                <div className="email-setup-stepper" data-testid="email-setup-stepper">
                  {emailSettingsSteps.map((step, index) => (
                    <button
                      className={`email-setup-step ${emailSettingsStep === step.key ? "active" : ""}`}
                      key={step.key}
                      type="button"
                      onClick={() => setEmailSettingsStep(step.key)}
                    >
                      <span className="email-step-index">{index + 1}</span>
                      <span>
                        <strong>{step.label}</strong>
                        <small>{step.description}</small>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="email-setup-card">
                  {renderEmailSettingsStepContent()}
                </div>
                <div className="toolbar between email-setup-nav">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setEmailSettingsStep(emailSettingsSteps[Math.max(0, currentEmailSettingsStepIndex - 1)].key)}
                    disabled={currentEmailSettingsStepIndex === 0}
                  >
                    上一步
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setEmailSettingsStep(emailSettingsSteps[Math.min(emailSettingsSteps.length - 1, currentEmailSettingsStepIndex + 1)].key)}
                    disabled={currentEmailSettingsStepIndex >= emailSettingsSteps.length - 1}
                  >
                    下一步
                  </button>
                </div>
                {renderEmailSignatureSettingsPanel()}
              </>
            ) : (
              <div className="empty-state">当前账号没有邮箱设置权限</div>
            )}
          </section>
        </div>
      ) : null}

      {view === "mail" ? (
    <div className="gmail-client">
      <div className="gmail-topbar">
        <div className="topbar-title gmail-topbar-title">
          <AppSidebarToggleButton collapsed={sidebarCollapsed} onToggle={onToggleAppSidebar} testId="email-app-sidebar-toggle" />
          <div className="gmail-brand">
            <Mail size={24} />
            <span>Mail</span>
          </div>
        </div>
        <label className="gmail-search">
          <Search size={18} />
          <input data-testid="email-search" value={searchQuery} onChange={(event) => applyEmailRoute({ search: event.target.value, mailMode: "list", threadId: "" })} placeholder="搜索邮件" />
          <Filter size={16} />
        </label>
        <button className="icon-button" aria-label="邮箱设置" type="button" onClick={() => onViewChange("settings")}>
          <Settings size={18} />
        </button>
        <button className="icon-button" aria-label="AI 与知识库" type="button" onClick={() => onViewChange("ai")}>
          <Bot size={18} />
        </button>
      </div>

      <div className={`gmail-layout ${mailMode === "detail" ? "detail-mode" : ""}`}>
        <aside className="gmail-sidebar">
          <button className="primary-button gmail-compose-button" type="button" onClick={openComposePopup}>
            <Send size={16} />
            写邮件
          </button>
          <div className="gmail-label-block" data-testid="email-mailbox-account-switcher">
            <div className={`gmail-folder gmail-account-summary ${selectedMailboxAccountId === allEmailAccountsKey ? "active" : ""}`}>
              <button
                className="gmail-account-summary-main"
                data-testid="email-mailbox-account-all"
                type="button"
                onClick={() => selectMailboxAccount(allEmailAccountsKey)}
              >
                <Inbox size={16} />
                <span>全部邮箱</span>
                <small>{threads.filter((thread) => !(threadUiState[thread.id]?.deleted)).length || ""}</small>
              </button>
              <button
                className="gmail-account-summary-toggle"
                type="button"
                aria-label={mailboxAccountsCollapsed ? "展开邮箱账户" : "折叠邮箱账户"}
                aria-expanded={!mailboxAccountsCollapsed}
                onClick={() => setMailboxAccountsCollapsed((current) => !current)}
              >
                {mailboxAccountsCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>
            {!mailboxAccountsCollapsed ? (
              <div className="gmail-account-list">
                {accounts.map((account) => (
                  <button
                    className={`gmail-folder gmail-account-folder ${selectedMailboxAccountId === account.id ? "active" : ""}`}
                    data-testid={`email-mailbox-account-${account.id}`}
                    key={account.id}
                    type="button"
                    onClick={() => selectMailboxAccount(account.id)}
                  >
                    <Mail size={16} />
                    <span>
                      <strong>{account.name}</strong>
                      <em>{account.emailAddress}</em>
                    </span>
                    <small>{accountThreadCounts.get(account.id) || ""}</small>
                  </button>
                ))}
                {accounts.length === 0 ? <div className="subtle">还没有邮箱账户</div> : null}
              </div>
            ) : null}
          </div>
          <nav className="gmail-folder-list" aria-label="邮箱">
            {emailMailboxMeta.map((item) => {
              const Icon = item.icon;
              return (
                <button className={`gmail-folder ${mailbox === item.key ? "active" : ""}`} key={item.key} type="button" onClick={() => { applyEmailRoute({ mailbox: item.key, mailMode: "list", threadId: "" }); setSelectedThreadIds(new Set()); }}>
                  <Icon size={16} />
                  <span>{item.label}</span>
                  <small>{mailboxCounts[item.key] || ""}</small>
                </button>
              );
            })}
          </nav>
          <div className="gmail-label-block">
            <div className="gmail-label-title">
              <span>标签</span>
              <button
                className="icon-button"
                aria-label="新增标签"
                data-testid="email-add-label"
                type="button"
                onClick={() => void promptAddEmailLabel(selectedThreadIdsArray.length ? selectedThreadIdsArray : selectedThread ? [selectedThread.id] : [])}
              >
                <Tag size={14} />
              </button>
            </div>
            {allEmailLabels.map((label) => (
              <button className={`gmail-folder ${labelFilter === label ? "active" : ""}`} data-testid={`email-label-filter-${sanitizeTestId(label)}`} key={label} type="button" onClick={() => { applyEmailRoute({ label: labelFilter === label ? "" : label, mailMode: "list", threadId: "" }); }}>
                <Tag size={15} />
                <span>{label}</span>
              </button>
            ))}
            {allEmailLabels.length === 0 ? <div className="subtle">还没有标签</div> : null}
          </div>
          <div className="gmail-account-list">
            <div className="gmail-label-title">发件账户</div>
            {activeAccounts.map((account) => (
              <div className="email-account-chip" key={account.id}>
                <strong>{account.name}</strong>
                <span>{account.emailAddress}</span>
              </div>
            ))}
            {activeAccounts.length === 0 ? <div className="subtle">没有可发送账户</div> : null}
          </div>
        </aside>

        <main className="gmail-main">
          {mailMode === "list" ? (
            <section className="gmail-list-pane">
              <div className="gmail-list-toolbar">
                <label className="gmail-select-all">
                  <input
                    aria-label="选择当前页"
                    checked={allVisibleThreadsSelected}
                    type="checkbox"
                    onChange={(event) => setSelectedThreadIds(event.target.checked ? new Set(visibleThreadIds) : new Set())}
                  />
                  <span>{selectedThreadIds.size ? `已选择 ${selectedThreadIds.size}` : `${visibleThreads.length} 封`}</span>
                </label>
                <button
                  className="icon-button"
                  aria-label="刷新邮件"
                  title={selectedMailboxAccount ? `刷新 ${selectedMailboxAccount.emailAddress}` : "刷新全部邮箱"}
                  type="button"
                  onClick={syncCurrentMailboxAccount}
                  disabled={disabled || !canManageEmailSettings || !selectedMailboxAccountCanSync}
                >
                  <RefreshCw className={disabled ? "spin-icon" : undefined} size={16} />
                </button>
                {mailbox === "archived" ? (
                  <button className="icon-button" aria-label="取消归档" title="取消归档" type="button" onClick={() => performMailboxAction("unarchive")} disabled={!selectedThreadIds.size}>
                    <RotateCcw size={16} />
                  </button>
                ) : (
                  <button className="icon-button" aria-label="归档" title="归档" type="button" onClick={() => performMailboxAction("archive")} disabled={!selectedThreadIds.size}>
                    <Archive size={16} />
                  </button>
                )}
                {mailbox === "trash" ? (
                  <>
                    <button className="icon-button" aria-label="恢复" title="恢复" type="button" onClick={() => performMailboxAction("restore")} disabled={!selectedThreadIds.size}>
                      <RotateCcw size={16} />
                    </button>
                    <button className="icon-button" data-testid="email-thread-bulk-permanent-delete" aria-label="彻底删除" title="彻底删除" type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void permanentlyDeleteThreads(selectedThreadIdsArray); }} disabled={!selectedThreadIds.size}>
                      <Trash2 size={16} />
                    </button>
                  </>
                ) : (
                  <button className="icon-button" aria-label="删除" title="删除" type="button" onClick={() => performMailboxAction("delete")} disabled={!selectedThreadIds.size}>
                    <Trash2 size={16} />
                  </button>
                )}
                {mailbox === "snoozed" ? (
                  <button className="icon-button" aria-label="取消稍后提醒" title="取消稍后提醒" type="button" onClick={() => performMailboxAction("unsnooze")} disabled={!selectedThreadIds.size}>
                    <RotateCcw size={16} />
                  </button>
                ) : (
                  <button className="icon-button" aria-label="稍后提醒" title="稍后提醒" type="button" onClick={() => performMailboxAction("snooze")} disabled={!selectedThreadIds.size}>
                    <Clock3 size={16} />
                  </button>
                )}
                <button className="icon-button" aria-label="标记已读" title="标记已读" type="button" onClick={() => performMailboxAction("read")} disabled={!selectedThreadIds.size}>
                  <MailOpen size={16} />
                </button>
                <button className="icon-button" aria-label="标记未读" title="标记未读" type="button" onClick={() => performMailboxAction("unread")} disabled={!selectedThreadIds.size}>
                  <Mail size={16} />
                </button>
                <button className="icon-button" aria-label="添加标签" title="添加标签" type="button" onClick={() => void promptAddEmailLabel(selectedThreadIdsArray)} disabled={!selectedThreadIds.size}>
                  <Tag size={16} />
                </button>
                <button className="icon-button" aria-label="更多" type="button">
                  <MoreVertical size={16} />
                </button>
              </div>

              <div className="gmail-category-tabs">
                {emailCategoryMeta.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button className={`gmail-category-tab ${category === item.key ? "active" : ""}`} key={item.key} type="button" onClick={() => applyEmailRoute({ category: item.key, mailMode: "list", threadId: "" })}>
                      <Icon size={16} />
                      <span>{item.label}</span>
                      <small>{categoryCounts[item.key]}</small>
                    </button>
                  );
                })}
              </div>

              <div className="gmail-thread-list">
                {visibleThreads.map((thread) => {
                  const messages = messagesByThread[thread.id] ?? [];
                  const state = threadUiState[thread.id] ?? {};
                  const labels = getEmailThreadDisplayLabels(thread, state, messages);
                  const displayMessage = getEmailThreadDisplayMessage(messages, mailbox, trashDisplayMessageIds[thread.id]);
                  const snippet = repairEmailMojibake(displayMessage?.bodyText || thread.summary || thread.aiAnalysis || "");
                  const isRead = state.read ?? false;
                  const isSnoozed = Boolean(state.snoozedUntil && new Date(state.snoozedUntil).getTime() > Date.now());
                  const scheduledSendAt = emailThreadNextScheduledSendAt(messages);
                  const rowSubject = displayMessage?.subject || thread.subject;
                  const rowTime = displayMessage ? emailMessageTimeValue(displayMessage) : emailThreadTimeValue(thread);
                  return (
                    <article className={`gmail-thread-row ${selectedThreadId === thread.id ? "selected" : ""} ${isRead ? "" : "unread"} ${mailbox === "trash" ? "trash-row" : ""}`} key={thread.id}>
                      <input
                        aria-label={`选择 ${thread.subject}`}
                        checked={selectedThreadIds.has(thread.id)}
                        type="checkbox"
                        onChange={(event) => toggleThreadSelection(thread.id, event.target.checked)}
                      />
                      <button
                        className={`gmail-icon-toggle ${state.starred ? "active" : ""}`}
                        aria-label="星标"
                        type="button"
                        onClick={() => {
                          const starred = !state.starred;
                          patchThreadUiState([thread.id], { starred });
                          persistThreadState(thread.id, { starred });
                        }}
                      >
                        <Star size={15} />
                      </button>
                      <button
                        className={`gmail-icon-toggle ${state.important ? "active" : ""}`}
                        aria-label="重要"
                        type="button"
                        onClick={() => {
                          const important = !state.important;
                          patchThreadUiState([thread.id], { important });
                          persistThreadState(thread.id, { important });
                        }}
                      >
                        <Tag size={15} />
                      </button>
                      <button className="gmail-thread-open" data-testid={`email-thread-row-${thread.id}`} type="button" onClick={() => openThreadDetail(thread.id)}>
                        <span className="gmail-thread-sender">{emailMessageParticipantLabel(displayMessage, thread, activeAccounts)}</span>
                        <span className="gmail-thread-subject">{rowSubject}</span>
                        <span className="gmail-thread-snippet">{snippet}</span>
                        <span className="gmail-thread-labels">
                          {labels.map((label) => <span className="badge" key={label}>{label}</span>)}
                          {isSnoozed && state.snoozedUntil ? <span className="badge">稍后 {formatDate(state.snoozedUntil)}</span> : null}
                          {scheduledSendAt ? <span className="badge"><CalendarClock size={12} /> {formatDate(scheduledSendAt)}</span> : null}
                        </span>
                      </button>
                      <span className="gmail-thread-date">{formatDate(rowTime)}</span>
                      <div className="gmail-row-actions">
                        {state.archived ? (
                          <button className="icon-button" aria-label="取消归档" type="button" onClick={() => performMailboxAction("unarchive", [thread.id])}><RotateCcw size={15} /></button>
                        ) : (
                          <button className="icon-button" aria-label="归档" type="button" onClick={() => performMailboxAction("archive", [thread.id])}><Archive size={15} /></button>
                        )}
                        {state.deleted || mailbox === "trash" ? (
                          <>
                            <button className="icon-button" aria-label="恢复" type="button" onClick={() => performMailboxAction("restore", [thread.id])}><RotateCcw size={15} /></button>
                            <button className="icon-button" data-testid={`email-thread-row-permanent-delete-${thread.id}`} aria-label="彻底删除" type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void permanentlyDeleteThreads([thread.id]); }}><Trash2 size={15} /></button>
                          </>
                        ) : (
                          <button className="icon-button" aria-label="删除" type="button" onClick={() => performMailboxAction("delete", [thread.id])}><Trash2 size={15} /></button>
                        )}
                        {labelFilter && getEmailThreadUserLabels(thread, state).some((label) => label.toLowerCase() === labelFilter.toLowerCase()) ? (
                          <button className="icon-button" aria-label={`移除标签 ${labelFilter}`} title={`移除标签 ${labelFilter}`} type="button" onClick={() => removeEmailLabel(thread.id, labelFilter)}>
                            <XCircle size={15} />
                          </button>
                        ) : null}
                        {isSnoozed ? (
                          <button className="icon-button" aria-label="取消稍后提醒" title="取消稍后提醒" type="button" onClick={() => performMailboxAction("unsnooze", [thread.id])}><RotateCcw size={15} /></button>
                        ) : (
                          <button className="icon-button" aria-label="稍后提醒" title="稍后提醒" type="button" onClick={() => performMailboxAction("snooze", [thread.id])}><Clock3 size={15} /></button>
                        )}
                        <button className="icon-button" aria-label={isRead ? "标记未读" : "标记已读"} type="button" onClick={() => performMailboxAction(isRead ? "unread" : "read", [thread.id])}>{isRead ? <Mail size={15} /> : <MailOpen size={15} />}</button>
                      </div>
                    </article>
                  );
                })}
                {visibleThreads.length === 0 ? <div className="empty-state">{searchQuery ? "没有匹配的邮件" : "当前邮箱为空"}</div> : null}
              </div>
            </section>
          ) : (
            <section className="gmail-detail-pane">
              <div className="gmail-detail-toolbar">
                <button className="icon-button" aria-label="返回列表" type="button" onClick={() => applyEmailRoute({ mailMode: "list", threadId: "" })}>
                  <ChevronLeft size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label="回复"
                  title="回复"
                  type="button"
                  onClick={() => {
                    const message = selectedDisplayedMessages.at(-1);
                    if (message) {
                      onReplyToMessage(message);
                      openComposePopup();
                    }
                  }}
                  disabled={!selectedDisplayedMessages.length}
                >
                  <Send size={16} />
                </button>
                {selectedThreadState.archived ? (
                  <button className="icon-button" aria-label="取消归档" title="取消归档" type="button" onClick={() => selectedThread && performMailboxAction("unarchive", [selectedThread.id])} disabled={!selectedThread}>
                    <RotateCcw size={16} />
                  </button>
                ) : (
                  <button className="icon-button" aria-label="归档" title="归档" type="button" onClick={() => selectedThread && performMailboxAction("archive", [selectedThread.id])} disabled={!selectedThread}>
                    <Archive size={16} />
                  </button>
                )}
                {selectedThreadState.deleted || mailbox === "trash" ? (
                  <>
                    <button className="icon-button" data-testid="email-thread-restore" aria-label="恢复" title="恢复" type="button" onClick={() => selectedThread && performMailboxAction("restore", [selectedThread.id])} disabled={!selectedThread}>
                      <RotateCcw size={16} />
                    </button>
                    <button className="icon-button" data-testid="email-thread-permanent-delete" aria-label="彻底删除" title="彻底删除" type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (selectedThread) void permanentlyDeleteThreads([selectedThread.id]); }} disabled={!selectedThread}>
                      <Trash2 size={16} />
                    </button>
                  </>
                ) : (
                  <button className="icon-button" aria-label="删除" title="删除" type="button" onClick={() => selectedThread && performMailboxAction("delete", [selectedThread.id])} disabled={!selectedThread}>
                    <Trash2 size={16} />
                  </button>
                )}
                {selectedThreadIsSnoozed ? (
                  <button className="icon-button" aria-label="取消稍后提醒" title="取消稍后提醒" type="button" onClick={() => selectedThread && performMailboxAction("unsnooze", [selectedThread.id])} disabled={!selectedThread}>
                    <RotateCcw size={16} />
                  </button>
                ) : (
                  <button className="icon-button" aria-label="稍后提醒" title="稍后提醒" type="button" onClick={() => selectedThread && performMailboxAction("snooze", [selectedThread.id])} disabled={!selectedThread}>
                    <Clock3 size={16} />
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label={selectedThreadIsRead ? "标记未读" : "标记已读"}
                  title={selectedThreadIsRead ? "标记未读" : "标记已读"}
                  type="button"
                  onClick={() => selectedThread && performMailboxAction(selectedThreadIsRead ? "unread" : "read", [selectedThread.id])}
                  disabled={!selectedThread}
                >
                  {selectedThreadIsRead ? <Mail size={16} /> : <MailOpen size={16} />}
                </button>
                <button className="icon-button" aria-label="重要" title="重要" type="button" onClick={() => selectedThread && performMailboxAction("important", [selectedThread.id])} disabled={!selectedThread}>
                  <Star className={selectedThreadState.important ? "active-icon" : undefined} size={16} />
                </button>
                <button className="icon-button" aria-label="添加标签" title="添加标签" type="button" onClick={() => { if (selectedThread) void promptAddEmailLabel([selectedThread.id]); }} disabled={!selectedThread}>
                  <Tag size={16} />
                </button>
                <div className="toolbar-menu">
                  <button className="icon-button" aria-label="更多" title="更多" type="button" onClick={() => setDetailMoreOpen((current) => !current)} disabled={!selectedThread}>
                    <MoreVertical size={16} />
                  </button>
                  {detailMoreOpen && selectedThread ? (
                    <div className="toolbar-menu-panel">
                      <button type="button" onClick={() => { setDetailMoreOpen(false); performMailboxAction(selectedThreadIsSnoozed ? "unsnooze" : "snooze", [selectedThread.id]); }}>
                        {selectedThreadIsSnoozed ? <RotateCcw size={14} /> : <Clock3 size={14} />}
                        {selectedThreadIsSnoozed ? "取消稍后提醒" : "稍后提醒"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
              {selectedThread ? (
                <>
                  <div className="gmail-detail-header">
                    <h2>{selectedDisplayMessage?.subject || selectedThread.subject}</h2>
                    <div className="toolbar">
                      <span className="badge">类别：{getEmailCategoryLabel((threadUiState[selectedThread.id]?.category ?? inferEmailThreadCategory(selectedThread, selectedMessages)) as EmailCategoryKey)}</span>
                      {threadUiState[selectedThread.id]?.starred ? <span className="badge">星标</span> : null}
                      {threadUiState[selectedThread.id]?.important ? <span className="badge">重要</span> : null}
                      {buildEmailThreadLabels(selectedThread, selectedMessages).map((label) => (
                        <span className="badge" key={label}>{label}</span>
                      ))}
                      {getEmailThreadUserLabels(selectedThread, threadUiState[selectedThread.id] ?? {}).map((label) => (
                        <span className="email-label-pill" key={label}>
                          {label}
                          <button aria-label={`移除标签 ${label}`} title={`移除标签 ${label}`} type="button" onClick={() => removeEmailLabel(selectedThread.id, label)}>
                            <XCircle size={12} />
                          </button>
                        </span>
                      ))}
                      {selectedThread?.summaryUpdatedAt ? <span className="subtle">Summary {formatDate(selectedThread.summaryUpdatedAt)}</span> : null}
                      {selectedThread?.aiAnalysisUpdatedAt ? <span className="subtle">Analysis {formatDate(selectedThread.aiAnalysisUpdatedAt)}</span> : null}
                    </div>
                  </div>
                  <div className="email-thread-actions gmail-detail-actions">
                    <div className="email-contact-link" data-testid="email-thread-contact-link">
                      <span className="subtle">发件人</span>
                      {selectedThreadDisplayRecord ? (
                        <div className="email-contact-link-actions">
                          <button
                            className="record-title email-contact-open"
                            data-testid="email-thread-open-contact"
                            type="button"
                            onClick={() => onOpenEmailContact(selectedThread.id, selectedThreadDisplayRecord)}
                          >
                            {formatEmailContactLabel(selectedThreadDisplayRecord, selectedThreadSenderEmail)}
                          </button>
                          {selectedThread.recordId || (selectedThreadDisplayRecord.objectKey === "contacts" && selectedThreadSenderEmail) ? (
                            <button
                              className="secondary-button"
                              data-testid="email-thread-unlink-record"
                              type="button"
                              onClick={() => unlinkEmailThreadContact(selectedThread.id, selectedThreadDisplayRecord, selectedThreadSenderEmail)}
                              disabled={disabled}
                            >
                              <XCircle size={16} />
                              解除关联
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <div className="email-contact-link-actions">
                          <strong>{selectedThreadSenderEmail || "未知发件人"}</strong>
                          <button
                            className="secondary-button"
                            data-testid="email-thread-create-contact"
                            type="button"
                            onClick={() => selectedThreadSenderEmail && onCreateContactFromEmail(selectedThread.id, selectedThreadSenderEmail)}
                            disabled={disabled || !selectedThreadSenderEmail}
                          >
                            <UserPlus size={16} />
                            Add new contact
                          </button>
                          <button
                            className="secondary-button"
                            data-testid="email-thread-link-existing-contact"
                            type="button"
                            onClick={() => setExistingContactPickerOpen((current) => !current)}
                            disabled={disabled || !selectedThreadSenderEmail || contactRecords.length === 0}
                          >
                            Add to existing contact
                          </button>
                          {existingContactPickerOpen ? (
                            <EmailContactSearchDropdown
                              contacts={contactRecords}
                              disabled={disabled}
                              value={existingContactId}
                              onChange={(contactId) => {
                                setExistingContactId(contactId);
                                if (contactId && selectedThreadSenderEmail) {
                                  linkExistingEmailContact(selectedThread.id, contactId, selectedThreadSenderEmail);
                                }
                              }}
                            />
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="gmail-ai-summary-grid">
                    <div className="ai-box" data-testid="email-thread-summary">
                      <div className="section-title-row">
                        <div className="activity-meta">Compact 摘要 {selectedThread.summaryUpdatedAt ? `(${formatDate(selectedThread.summaryUpdatedAt)})` : ""}</div>
                        <button className="secondary-button" data-testid="email-thread-summarize" type="button" onClick={onSummarizeThread} disabled={disabled || !aiSettings.features.auto_summarize}>
                          <Bot size={16} />
                          刷新摘要
                        </button>
                      </div>
                      {selectedThread.summary ? <div style={{ whiteSpace: "pre-wrap" }}>{selectedThread.summary}</div> : <div className="subtle">暂无摘要，点击刷新摘要生成 compact 上下文。</div>}
                      <div className="toolbar" style={{ marginTop: 8 }}>
                        <span className="badge">用于后续 AI 上下文</span>
                        <span className="badge">减少长线程 token 消耗</span>
                      </div>
                    </div>
                    <details className="ai-box email-thread-analysis" data-testid="email-thread-analysis" open={Boolean(selectedThread.aiAnalysis)}>
                      <summary>
                        <span>
                          AI 线程分析 {selectedThread.aiAnalysisUpdatedAt ? `(${formatDate(selectedThread.aiAnalysisUpdatedAt)})` : ""}
                        </span>
                        <strong>{selectedThread.aiAnalysis ? getEmailAnalysisPreview(selectedThread.aiAnalysis) : "暂无分析"}</strong>
                        <button className="secondary-button" data-testid="email-thread-analyze" type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onAnalyzeThread(); }} disabled={disabled || !aiSettings.features.context_analysis}>
                          <Bot size={16} />
                          刷新分析
                        </button>
                      </summary>
                      {selectedThread.aiAnalysis ? (
                        <>
                          <div className="email-thread-analysis-body">{formatEmailAnalysisForDisplay(selectedThread.aiAnalysis)}</div>
                          {renderEmailAiSources(selectedThread.aiAnalysisSources)}
                        </>
                      ) : (
                        <div className="subtle">暂无分析，点击刷新分析生成上下文建议。</div>
                      )}
                    </details>
                  </div>
                  <TalkAboutThisPanel
                    target={{ type: "email_thread", threadId: selectedThread.id, label: selectedDisplayMessage?.subject || selectedThread.subject }}
                    disabled={disabled}
                    onOpenRecord={onOpenTalkSourceRecord}
                    onKnowledgeCreated={onKnowledgeArticleCreated}
                    onRequestConfirm={onRequestConfirm}
                    onShowToast={onShowToast}
                  />
                  <div className="email-message-list">
                    {selectedDisplayedMessages.map((message) => {
                      const messageHasExternalImages = emailHtmlHasExternalImages(message.bodyHtml ?? "");
                      return (
                      <article className="email-message-card gmail-message-card" key={message.id}>
                        <div className="email-message-header">
                          <div>
                            <strong>{message.from}</strong>
                            <div className="subtle">收件人 {message.to.join(", ")} · {message.direction} · {message.status}</div>
                          </div>
                          <div className="activity-meta">{formatDate(message.createdAt)}</div>
                        </div>
                        <div className="toolbar" style={{ marginTop: 8 }}>
                          {message.scheduledSendAt && (message.status === "queued" || message.status === "sending") ? (
                            <span className="badge"><CalendarClock size={12} /> 计划发送 {formatDate(message.scheduledSendAt)}</span>
                          ) : null}
                          {message.groupSendMode ? <span className="badge">群发单显</span> : null}
                          {message.trackingEnabled ? <span className="badge">追踪已开启</span> : null}
                          {message.inboundMetadata?.sourceIp ? (
                            <span className="badge">
                              来源 IP {message.inboundMetadata.sourceIp}
                              {message.inboundMetadata.country ? ` · ${message.inboundMetadata.country}` : ""}
                              {message.inboundMetadata.timezone ? ` · ${message.inboundMetadata.timezone}` : ""}
                            </span>
                          ) : null}
                        </div>
                        {message.trackingEvents?.length ? (
                          <details className="email-tracking-events" data-testid={`email-tracking-events-${message.id}`}>
                            <summary>追踪记录 {message.trackingEvents.length}</summary>
                            <div className="email-tracking-event-list">
                              {message.trackingEvents.slice().reverse().slice(0, 20).map((event, index) => (
                                <div className="email-tracking-event" key={`${event.type}-${event.occurredAt}-${index}`}>
                                  <strong>{event.type === "open" ? "打开" : "点击"}</strong>
                                  <span>{formatDate(event.occurredAt)}</span>
                                  {event.ip ? <span>{event.ip}</span> : null}
                                  {event.country ? <span>{event.country}</span> : null}
                                  {event.timezone ? <span>{event.timezone}</span> : null}
                                  {event.url ? <span title={event.url}>{event.url}</span> : null}
                                  {event.userAgent ? <span title={event.userAgent}>{event.userAgent}</span> : null}
                                </div>
                              ))}
                            </div>
                          </details>
                        ) : null}
                        {message.aiAssisted ? <span className="badge">AI 辅助{message.aiPurpose ? ` · ${message.aiPurpose}` : ""}</span> : null}
                        {message.aiAssisted ? renderEmailAiSources(message.aiSources) : null}
                        {message.direction === "outbound" && message.status === "failed" ? (
                          <div className="toolbar" style={{ marginTop: 8 }}>
                            {message.failureReason ? <span className="danger-badge">{message.failureReason}</span> : null}
                            <button className="secondary-button" type="button" onClick={() => onRetryMessage(message.id)} disabled={disabled}>
                              <RefreshCw className={disabled ? "spin-icon" : undefined} size={14} />
                              重试
                            </button>
                          </div>
                        ) : null}
                        {hasEmailHtmlPreview(message) ? (
                          <div className="email-html-preview">
                            {messageHasExternalImages && !selectedThreadAllowsExternalImages ? (
                              <div className="email-external-image-notice" data-testid={`email-message-external-images-blocked-${message.id}`}>
                                <span>已阻止外部图片，避免泄露打开行为。</span>
                                <button
                                  className="secondary-button"
                                  data-testid={`email-message-load-external-images-${message.id}`}
                                  type="button"
                                  onClick={() =>
                                    selectedThread &&
                                    setExternalImageThreadIds((current) => {
                                      const next = new Set(current);
                                      next.add(selectedThread.id);
                                      return next;
                                    })
                                  }
                                >
                                  <ImageIcon size={14} />
                                  加载外部图片
                                </button>
                              </div>
                            ) : null}
                            <iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={buildEmailHtmlPreview(message.bodyHtml ?? "", selectedThreadAllowsExternalImages)} data-testid={`email-message-html-${message.id}`} className="email-html-preview-frame" title={`HTML preview ${message.id}`} />
                            <details className="email-text-fallback">
                              <summary>显示文本邮件</summary>
                              <div className="email-message-body">{repairEmailMojibake(message.bodyText)}</div>
                            </details>
                          </div>
                        ) : (
                          <div className="email-message-body">{repairEmailMojibake(message.bodyText)}</div>
                        )}
                        {message.attachments?.length ? (
                          <div className="toolbar" style={{ marginTop: 8 }}>
                            {message.attachments.map((attachment, index) => {
                              const href = buildEmailAttachmentHref(message.id, index, attachment);
                              const label = `${attachment.fileName} · ${attachment.contentType ?? "application/octet-stream"} · ${formatBytes(attachment.size)}`;
                              return href ? (
                                <a className="secondary-button" href={href} key={`${message.id}-attachment-${attachment.id ?? attachment.providerAttachmentId ?? index}`} rel={attachment.externalUrl ? "noreferrer" : undefined} target={attachment.externalUrl ? "_blank" : undefined}>
                                  <Download size={14} />
                                  {label}
                                </a>
                              ) : (
                                <span className="badge" key={`${message.id}-attachment-${attachment.id ?? attachment.providerAttachmentId ?? index}`}>{label}</span>
                              );
                            })}
                          </div>
                        ) : null}
                        {message.translatedBodyText ? (
                          <div className="ai-box" data-testid="email-message-translation" style={{ marginTop: 8 }}>
                            <div className="activity-meta">翻译 {message.translatedLocale ? `(${message.translatedLocale})` : ""}</div>
                            <div>{message.translatedBodyText}</div>
                            {renderEmailAiSources(message.translatedSources)}
                          </div>
                        ) : null}
                        <div className="toolbar" style={{ marginTop: 8 }}>
                          <button
                            className="secondary-button"
                            data-testid={`email-message-reply-${message.id}`}
                            type="button"
                            onClick={() => {
                              onReplyToMessage(message);
                              openComposePopup();
                            }}
                            disabled={disabled}
                          >
                            <Send size={14} />
                            回复
                          </button>
                          <button className="secondary-button" data-testid={`email-message-translate-${message.id}`} type="button" onClick={() => onGenerateAiForMessage(message, "translate")} disabled={disabled || !aiSettings.features.translate}>
                            <Bot size={14} />
                            翻译
                          </button>
                          <button className="secondary-button" data-testid={`email-message-analyze-${message.id}`} type="button" onClick={() => onGenerateAiForMessage(message, "context_analysis")} disabled={disabled || !aiSettings.features.context_analysis}>
                            <Bot size={14} />
                            分析
                          </button>
                        </div>
                      </article>
                      );
                    })}
                    {selectedDisplayedMessages.length === 0 ? <div className="empty-state">选择线程后会加载消息</div> : null}
                  </div>
                </>
              ) : (
                <div className="empty-state">从邮件列表选择一个线程</div>
              )}
            </section>
          )}
        </main>

        {composeOpen ? (
          <section
            className={`gmail-compose-popup ${composeMinimized ? "minimized" : ""} ${composeFullSize && !composeMinimized ? "full-size" : ""}`}
            data-testid="email-compose-popup"
            aria-label="写邮件"
          >
            <div
              className="gmail-compose-popup-header"
              role={composeMinimized ? "button" : undefined}
              tabIndex={composeMinimized ? 0 : undefined}
              onClick={composeMinimized ? () => setComposeMinimized(false) : undefined}
              onKeyDown={
                composeMinimized
                  ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setComposeMinimized(false);
                }
              }
                  : undefined
              }
            >
              <strong>{emailDraft.subject.trim() || "新邮件"}</strong>
              <div className="toolbar">
                <button className="icon-button" aria-label={composeMinimized ? "展开写信窗口" : "最小化写信窗口"} type="button" onClick={(event) => { event.stopPropagation(); setComposeMinimized((current) => !current); }}>
                  {composeMinimized ? <Maximize2 size={15} /> : <Minus size={15} />}
                </button>
                <button
                  className="icon-button"
                  data-testid="email-compose-full-size"
                  aria-label={composeFullSize && !composeMinimized ? "恢复普通宽度" : "全宽撰写"}
                  title={composeFullSize && !composeMinimized ? "恢复普通宽度" : "全宽撰写"}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setComposeMinimized(false);
                    setComposeFullSize((current) => !current);
                  }}
                >
                  <Maximize2 size={15} />
                </button>
                <button className="icon-button" aria-label="关闭写信窗口" type="button" onClick={(event) => { event.stopPropagation(); closeComposePopup(); }}>
                  <XCircle size={15} />
                </button>
              </div>
            </div>
            {composeMinimized ? null : (
              <div className="gmail-compose-popup-body">
                <div className="email-pane-header compact">
                  <h2 className="page-title" style={{ fontSize: 16 }}>撰写邮件</h2>
                </div>
                <div className="email-compose-grid">
                  <label>
                    <span className="subtle">发件账户</span>
                    <select className="select" data-testid="email-compose-account" value={emailDraft.accountId} onChange={(event) => onEmailDraftChange(clearEmailDraftAiProvenance({ ...emailDraft, accountId: event.target.value }))}>
                      <option value="">选择账户</option>
                      {activeAccounts.map((account) => (
                        <option key={account.id} value={account.id}>{account.emailAddress}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="subtle">关联记录</span>
                    <select className="select" value={linkedRecordId} onChange={(event) => onEmailDraftChange(clearEmailDraftAiProvenance({ ...emailDraft, recordId: event.target.value }))}>
                      <option value="">不关联</option>
                      {records.slice(0, 100).map((record) => (
                        <option key={record.id} value={record.id}>{record.title}</option>
                      ))}
                    </select>
                  </label>
                  <div className="email-compose-recipient-row">
                    <EmailRecipientInput
                      label="收件人"
                      testId="email-compose-to"
                      value={emailDraft.to}
                      contactByEmail={contactByEmail}
                      placeholder="buyer@example.com"
                      onChange={(nextValue) => onEmailDraftChange(clearEmailDraftAiProvenance({ ...emailDraft, to: nextValue }))}
                    />
                    <div className="email-compose-recipient-toggles">
                      {!composeCcVisible ? (
                        <button className="text-button" data-testid="email-compose-show-cc" type="button" onClick={() => setComposeCcVisible(true)}>
                          CC
                        </button>
                      ) : null}
                      {!composeBccVisible ? (
                        <button className="text-button" data-testid="email-compose-show-bcc" type="button" onClick={() => setComposeBccVisible(true)}>
                          BCC
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {composeCcVisible ? (
                    <EmailRecipientInput
                      label="CC"
                      testId="email-compose-cc"
                      value={emailDraft.cc}
                      contactByEmail={contactByEmail}
                      placeholder="manager@example.com"
                      onChange={(nextValue) => onEmailDraftChange(clearEmailDraftAiProvenance({ ...emailDraft, cc: nextValue }))}
                    />
                  ) : null}
                  {composeBccVisible ? (
                    <EmailRecipientInput
                      label="BCC"
                      testId="email-compose-bcc"
                      value={emailDraft.bcc}
                      contactByEmail={contactByEmail}
                      placeholder="archive@example.com"
                      onChange={(nextValue) => onEmailDraftChange(clearEmailDraftAiProvenance({ ...emailDraft, bcc: nextValue }))}
                    />
                  ) : null}
                  <label>
                    <span className="subtle">主题</span>
                    <input className="input" data-testid="email-compose-subject" value={emailDraft.subject} onChange={(event) => onEmailDraftChange(clearEmailDraftAiProvenance({ ...emailDraft, subject: event.target.value }))} />
                  </label>
                  <label>
                    <span className="subtle">签名</span>
                    <select className="select" data-testid="email-compose-signature" value={selectedSignature.id} onChange={(event) => onEmailDraftChange({ ...emailDraft, signatureId: event.target.value })}>
                      {signatureOptions.map((signature) => (
                        <option key={signature.id} value={signature.id}>{signature.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="subtle">定时发送</span>
                    <input
                      className="input"
                      data-testid="email-compose-scheduled-send-at"
                      type="datetime-local"
                      value={toDatetimeLocalInputValue(emailDraft.scheduledSendAt)}
                      onChange={(event) => onEmailDraftChange({ ...emailDraft, scheduledSendAt: fromDatetimeLocalInputValue(event.target.value) })}
                    />
                  </label>
                </div>
                <div className="toolbar email-compose-options">
                  <label className="checkbox-label">
                    <input
                      data-testid="email-compose-group-send"
                      type="checkbox"
                      checked={Boolean(emailDraft.groupSendMode)}
                      onChange={(event) => onEmailDraftChange({ ...emailDraft, groupSendMode: event.target.checked })}
                    />
                    群发单显
                  </label>
                  <label className="checkbox-label">
                    <input
                      data-testid="email-compose-tracking"
                      type="checkbox"
                      checked={Boolean(emailDraft.trackingEnabled)}
                      onChange={(event) => onEmailDraftChange({ ...emailDraft, trackingEnabled: event.target.checked })}
                    />
                    跟踪打开/点击
                  </label>
                  {emailDraft.scheduledSendAt ? <span className="badge"><CalendarClock size={12} /> 将在 {formatDate(emailDraft.scheduledSendAt)} 发送</span> : null}
                </div>
                <div className="email-compose-ai-bar">
                  <Bot size={16} />
                  <input className="input" data-testid="email-compose-ai-prompt" value={composeAiPrompt} onChange={(event) => setComposeAiPrompt(event.target.value)} placeholder="告诉 AI 这封邮件要表达什么，例如：礼貌跟进报价并约下周会议" />
                  <button className="secondary-button" data-testid="email-compose-ai-prompt-generate" type="button" onClick={() => void generateComposePromptWithAi()} disabled={disabled || composePromptGenerating || !aiSettings.features.draft}>
                    {composePromptGenerating ? <RefreshCw className="spin-icon" size={15} /> : <Bot size={15} />}
                    生成提示词
                  </button>
                  <button className="secondary-button" data-testid="email-compose-ai-generate" type="button" onClick={generateComposeDraftWithAi} disabled={disabled || !aiSettings.features.draft}>
                    生成正文
                  </button>
                </div>
                <div className="email-compose-editor-shell">
                  <div className="email-compose-toolbar" aria-label="正文格式工具栏">
                    <button className="icon-button" aria-label="加粗" type="button" onClick={() => void runComposeEditorCommand("bold")}><Bold size={15} /></button>
                    <button className="icon-button" aria-label="斜体" type="button" onClick={() => void runComposeEditorCommand("italic")}><Italic size={15} /></button>
                    <button className="icon-button" aria-label="下划线" type="button" onClick={() => void runComposeEditorCommand("underline")}><Underline size={15} /></button>
                    <button className="icon-button" aria-label="列表" type="button" onClick={() => void runComposeEditorCommand("insertUnorderedList")}><List size={15} /></button>
                    <button className="icon-button" aria-label="链接" type="button" onClick={() => void runComposeEditorCommand("createLink")}><Link size={15} /></button>
                    <button className="icon-button" aria-label="打开媒体库插入图片" type="button" onClick={() => setMediaLibraryOpen(true)}><ImageIcon size={15} /></button>
                    <button className="icon-button" aria-label="添加附件" type="button" onClick={() => setAttachmentModalOpen(true)}><Paperclip size={15} /></button>
                    <input
                      ref={composeInlineImageInputRef}
                      data-testid="email-compose-inline-image"
                      hidden
                      accept="image/*"
                      type="file"
                      onChange={(event) => {
                        void onUploadMediaAssets(event.target.files).then((assets) => {
                          if (assets[0]) {
                            insertMediaAssetInline(assets[0]);
                          }
                        });
                        event.target.value = "";
                      }}
                    />
                  </div>
                  <div
                    ref={composeEditorRef}
                    className="email-rich-editor"
                    contentEditable
                    data-testid="email-compose-body"
                    onInput={updateComposeBodyFromEditor}
                    role="textbox"
                    aria-multiline="true"
                    suppressContentEditableWarning
                  />
                </div>
                {selectedSignature.id !== noEmailSignatureId ? (
                  <div className="email-signature-preview" data-testid="email-signature-preview">
                    <span className="subtle">签名预览，发送时追加</span>
                    <iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={buildEmailHtmlPreview(selectedSignature.bodyHtml)} title="签名预览" />
                  </div>
                ) : null}
                {emailDraft.replyOriginalBodyText || emailDraft.replyOriginalBodyHtml ? (
                  <details className="email-original-preview" data-testid="email-compose-original-preview">
                    <summary>发送回复时将追加原邮件内容</summary>
                    <div>{repairEmailMojibake(emailDraft.replyOriginalBodyText || stripHtmlToText(emailDraft.replyOriginalBodyHtml ?? "")).slice(0, 1200)}</div>
                  </details>
                ) : null}
                {emailDraft.attachments?.length ? (
                  <div className="email-attachment-list" data-testid="email-compose-attachment-list">
                    {emailDraft.attachments.map((attachment, index) => (
                      <button className="secondary-button" key={`${attachment.fileName}-${index}`} type="button" onClick={() => removeEmailAttachment(index)}>
                        <Paperclip size={14} />
                        {attachment.fileName} · {formatBytes(attachment.size)}
                        <XCircle size={14} />
                      </button>
                    ))}
                  </div>
                ) : null}
            {emailDraft.aiAssisted ? (
              <div className="toolbar" style={{ marginTop: 12 }}>
                <span className="badge">
                  AI 辅助草稿{emailDraft.aiPurpose ? ` · ${emailDraft.aiPurpose}` : ""}{emailDraft.aiGeneratedAt ? ` · ${formatDate(emailDraft.aiGeneratedAt)}` : ""}
                </span>
                <span className={emailDraft.aiSources?.length ? "badge" : "danger-badge"}>来源 {emailDraft.aiSources?.length ?? 0}</span>
                <span className="badge">发送时保留 AI provenance</span>
                {renderEmailAiSources(emailDraft.aiSources)}
                <button
                  className="secondary-button"
                  data-testid="email-ai-clear-provenance"
                  type="button"
                  onClick={() =>
                    onEmailDraftChange({
                      ...emailDraft,
                      aiAssisted: false,
                      aiPurpose: undefined,
                      aiSourceMessageId: undefined,
                      aiSources: undefined,
                      aiGeneratedAt: undefined
                    })
                  }
                  disabled={disabled}
                >
                  <XCircle size={14} />
                  清除 AI 标记
                </button>
              </div>
            ) : null}
            <div className="toolbar" style={{ marginTop: 12 }}>
              <button className="primary-button" data-testid="email-send" type="button" onClick={sendEmailFromPopup} disabled={disabled || !emailDraft.accountId || !emailDraft.to.trim() || !emailDraft.subject.trim() || !hasEmailDraftBody(emailDraft)}>
                {emailDraft.scheduledSendAt ? <CalendarClock size={16} /> : <Send size={16} />}
                {emailDraft.scheduledSendAt ? "定时发送" : "发送"}
              </button>
            </div>
              </div>
            )}
          </section>
        ) : null}

        {mediaLibraryOpen ? (
          <MediaLibraryModal
            accept="image/*"
            canSelectAsset={isImageMediaAsset}
            description="选择图片插入邮件正文，或上传新图片供产品主图和邮件复用。"
            disabled={disabled}
            mediaAssets={mediaAssets}
            onClose={() => setMediaLibraryOpen(false)}
            onDeleteMediaAsset={onDeleteMediaAsset}
            onSelect={insertMediaAssetInline}
            onUpdateMediaAsset={onUpdateMediaAsset}
            onUploadMediaAssets={onUploadMediaAssets}
            selectLabel="插入"
            testId="email-media-library-modal"
            title="媒体库"
          />
        ) : null}

        {attachmentModalOpen ? (
          <div className="modal-backdrop" data-testid="email-attachment-modal" role="dialog" aria-modal="true" aria-label="添加邮件附件">
            <div className="modal-panel email-attachment-modal">
              <div className="email-pane-header compact">
                <div>
                  <h2 className="page-title" style={{ fontSize: 18 }}>添加附件</h2>
                  <p className="subtle">支持拖拽、多文件上传和读取进度，单封邮件最多 10 个附件。</p>
                </div>
                <button className="icon-button" aria-label="关闭附件窗口" type="button" onClick={() => setAttachmentModalOpen(false)}>
                  <XCircle size={16} />
                </button>
              </div>
              <div
                className={`email-attachment-dropzone ${attachmentDragActive ? "active" : ""}`}
                data-testid="email-attachment-dropzone"
                onDragEnter={(event) => {
                  event.preventDefault();
                  setAttachmentDragActive(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setAttachmentDragActive(false)}
                onDrop={handleAttachmentDrop}
              >
                <Upload size={24} />
                <strong>拖拽文件到这里</strong>
                <span className="subtle">或选择本地文件</span>
                <button className="secondary-button" type="button" onClick={() => composeAttachmentInputRef.current?.click()}>
                  <Paperclip size={14} />
                  选择文件
                </button>
                <input
                  ref={composeAttachmentInputRef}
                  data-testid="email-compose-attachments"
                  hidden
                  multiple
                  type="file"
                  onChange={(event) => {
                    void addEmailAttachmentFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </div>
              {attachmentUploads.length ? (
                <div className="email-upload-list">
                  {attachmentUploads.map((item) => (
                    <div className="email-upload-row" key={item.id}>
                      <div>
                        <strong>{item.fileName}</strong>
                        <span className="subtle">{formatBytes(item.size)} · {item.status === "error" ? item.error : item.status === "complete" ? "已添加" : "读取中"}</span>
                      </div>
                      <div className="email-upload-progress" aria-label={`${item.fileName} 上传进度`}>
                        <span style={{ width: `${item.progress}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {emailDraft.attachments?.length ? (
                <div className="email-attachment-list">
                  {emailDraft.attachments.map((attachment, index) => (
                    <button className="secondary-button" key={`modal-${attachment.fileName}-${index}`} type="button" onClick={() => removeEmailAttachment(index)}>
                      <Paperclip size={14} />
                      {attachment.fileName} · {formatBytes(attachment.size)}
                      <XCircle size={14} />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
      ) : null}

      {view === "ai" ? (
      <section className="section">
        <h2 className="page-title" style={{ fontSize: 18 }}>AI 与知识库</h2>
        <div className="ai-box">
          <div className="activity-meta"><Bot size={16} />邮件 AI</div>
          <div className="toolbar" data-testid="email-ai-policy-summary" style={{ marginTop: 8 }}>
            <span className={enabledEmailAiAutomationCount ? "badge" : "danger-badge"}>自动任务 {enabledEmailAiAutomationCount}/3</span>
            <span className={aiSettings.requireSourceLinks ? "badge" : "danger-badge"}>来源引用 {aiSettings.requireSourceLinks ? "必需" : "可选"}</span>
            <span className="badge">历史 {aiSettings.maxHistoryMessages} 封</span>
            <span className={activeKnowledgeArticleCount ? "badge" : "danger-badge"}>知识 {activeKnowledgeArticleCount}/{aiSettings.maxKnowledgeArticles}</span>
            <span className="badge">预算 {aiSettings.maxContextChars}</span>
          </div>
          {enabledEmailAiAutomationCount > 0 ? (
            <div className="subtle" data-testid="email-ai-token-policy" style={{ marginTop: 6 }}>
              自动任务只处理已提交的入站 received 和出站 sent 邮件；草稿、队列、发送中和失败邮件不会进入自动 AI 上下文。
            </div>
          ) : null}
          {canManageAiSettings ? (
            <>
          <div className="settings-item" data-testid="email-ai-provider-panel" style={{ marginTop: 12 }}>
            <div className="stage-header">
              <strong>AI Provider</strong>
              <span className={aiSettings.providerConfig.hasApiKey ? "badge" : "danger-badge"}>{aiSettings.providerConfig.hasApiKey ? "API Key 已保存" : "未配置 API Key"}</span>
            </div>
            <div className="subtle">支持 OpenAI、Gemini、OpenRouter 和 OpenAI-compatible 自定义服务；API Key 不会回传到前端，留空保存时会保留已保存密钥。</div>
            <div className="form-grid" style={{ marginTop: 10 }}>
              <label>
                <span className="subtle">Provider</span>
                <select
                  className="select"
                  data-testid="email-ai-provider"
                  value={aiSettings.providerConfig.provider}
                  onChange={(event) => updateAiProviderConfig(defaultAiProviderConfigForUi(event.target.value as EmailAiSettings["providerConfig"]["provider"], aiSettings.providerConfig))}
                >
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Gemini</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="custom">Custom Provider</option>
                </select>
              </label>
              <label>
                <span className="subtle">Base URL</span>
                <input className="input" data-testid="email-ai-provider-base-url" value={aiSettings.providerConfig.baseUrl} onChange={(event) => updateAiProviderConfig({ baseUrl: event.target.value })} />
              </label>
              <label>
                <span className="subtle">模型</span>
                <input className="input" data-testid="email-ai-provider-model" value={aiSettings.providerConfig.model} onChange={(event) => updateAiProviderConfig({ model: event.target.value })} />
              </label>
              <label>
                <span className="subtle">API Key</span>
                <input className="input" data-testid="email-ai-provider-api-key" type="password" value={aiProviderApiKeyDraft} onChange={(event) => setAiProviderApiKeyDraft(event.target.value)} placeholder={aiSettings.providerConfig.hasApiKey ? "留空保留已保存 API Key" : "输入 API Key"} />
              </label>
              <div className="toolbar" style={{ alignSelf: "end" }}>
                <button
                  className="secondary-button"
                  data-testid="email-ai-provider-api-key-save"
                  type="button"
                  onClick={() => {
                    updateAiProviderConfig({ apiKey: aiProviderApiKeyDraft });
                    setAiProviderApiKeyDraft("");
                  }}
                  disabled={!aiProviderApiKeyDraft.trim()}
                >
                  <Pencil size={16} />
                  保存 API Key
                </button>
              </div>
              <label>
                <span className="subtle">超时 ms</span>
                <input className="input" data-testid="email-ai-provider-timeout" max={60000} min={1000} step={1000} type="number" value={aiSettings.providerConfig.timeoutMs} onChange={(event) => updateAiProviderConfig({ timeoutMs: numberInputValue(event.target.value, aiSettings.providerConfig.timeoutMs) })} />
              </label>
            </div>
          </div>
          <div className="view-column-grid">
            {Object.entries(aiSettings.features).map(([feature, enabled]) => {
              const featureKey = feature as keyof EmailAiSettings["features"];
              const meta = emailAiFeatureMeta[featureKey];
              const dependencyBlocked = isEmailAiFeatureBlockedByDependency(featureKey, aiSettings.features);
              const dependencyMessage = emailAiFeatureDependencyMessage(featureKey);
              return (
                <label className="settings-toggle" key={feature}>
                  <input data-testid={`email-ai-feature-${feature}`} type="checkbox" checked={enabled} onChange={(event) => onToggleAiFeature(featureKey, event.target.checked)} disabled={dependencyBlocked && !enabled} />
                  <span>
                    {meta.label}
                    <small className="subtle" style={{ display: "block" }}>
                      {dependencyBlocked && dependencyMessage ? dependencyMessage : meta.description}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label>
              <span className="subtle">默认语言</span>
              <input className="input" value={aiSettings.defaultLocale} onChange={(event) => onUpdateAiSettings({ defaultLocale: event.target.value })} />
            </label>
            <label className="settings-toggle">
              <input type="checkbox" checked={aiSettings.requireSourceLinks} onChange={(event) => onUpdateAiSettings({ requireSourceLinks: event.target.checked })} />
              要求来源引用
            </label>
            <label>
              <span className="subtle">历史消息数</span>
              <input className="input" max={20} min={1} type="number" value={aiSettings.maxHistoryMessages} onChange={(event) => onUpdateAiSettings({ maxHistoryMessages: numberInputValue(event.target.value, aiSettings.maxHistoryMessages) })} />
            </label>
            <label>
              <span className="subtle">知识文章数</span>
              <input className="input" max={20} min={0} type="number" value={aiSettings.maxKnowledgeArticles} onChange={(event) => onUpdateAiSettings({ maxKnowledgeArticles: numberInputValue(event.target.value, aiSettings.maxKnowledgeArticles) })} />
            </label>
            <label>
              <span className="subtle">上下文字符预算</span>
              <input className="input" max={20000} min={1000} step={500} type="number" value={aiSettings.maxContextChars} onChange={(event) => onUpdateAiSettings({ maxContextChars: numberInputValue(event.target.value, aiSettings.maxContextChars) })} />
            </label>
          </div>
          <div className="settings-item" data-testid="email-ai-agents-panel" style={{ marginTop: 12 }}>
            <div className="stage-header">
              <strong>后台 AI Agents</strong>
              <span className="badge">{aiSettings.agents.filter((agent) => agent.enabled).length}/{aiSettings.agents.length}</span>
            </div>
            <div className="subtle">每个场景使用独立 Agent、独立模型和独立 agent.md。邮件分类 Agent 负责收件后归类到主要、推广、社交或更新。</div>
            <div className="settings-list" style={{ marginTop: 10 }}>
              {aiSettings.agents.map((agent) => (
                <div className="settings-item" data-testid={`email-ai-agent-${agent.key}`} key={agent.key}>
                  <div className="stage-header">
                    <strong>{agent.name}</strong>
                    <span className={agent.enabled ? "badge" : "danger-badge"}>{agent.enabled ? "enabled" : "disabled"}</span>
                  </div>
                  <div className="form-grid" style={{ marginTop: 8 }}>
                    <label className="settings-toggle">
                      <input
                        data-testid={`email-ai-agent-enabled-${agent.key}`}
                        type="checkbox"
                        checked={agent.enabled}
                        onChange={(event) => updateAiAgent(agent.key, { enabled: event.target.checked })}
                      />
                      启用
                    </label>
                    <label>
                      <span className="subtle">模型</span>
                      <input
                        className="input"
                        data-testid={`email-ai-agent-model-${agent.key}`}
                        value={agent.model}
                        onChange={(event) => updateAiAgent(agent.key, { model: event.target.value })}
                        placeholder="gpt-4.1-mini"
                      />
                    </label>
                    <label>
                      <span className="subtle">最大输出字符</span>
                      <input
                        className="input"
                        max={12000}
                        min={500}
                        step={500}
                        type="number"
                        value={agent.maxOutputChars}
                        onChange={(event) => updateAiAgent(agent.key, { maxOutputChars: numberInputValue(event.target.value, agent.maxOutputChars) })}
                      />
                    </label>
                    <label className="wide">
                      <span className="subtle">agent.md</span>
                      <textarea
                        className="textarea agent-md-textarea"
                        data-testid={`email-ai-agent-md-${agent.key}`}
                        value={agent.agentMarkdown}
                        onChange={(event) => updateAiAgent(agent.key, { agentMarkdown: event.target.value })}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
            </>
          ) : (
            <div className="empty-state">当前账号没有 ai.admin 权限，不能配置 AI Agents。</div>
          )}
          <label>
            <span className="subtle">AI 动作</span>
            <select className="select" data-testid="email-ai-purpose" value={aiPurpose} onChange={(event) => onAiPurposeChange(event.target.value as EmailAiGenerateResult["purpose"])}>
              <option value="draft">写邮件</option>
              <option value="translate">翻译</option>
              <option value="context_analysis">上下文分析</option>
              <option value="summarize">自动总结</option>
            </select>
          </label>
          <label>
            <span className="subtle">补充要求</span>
            <input className="input" data-testid="email-ai-prompt" value={aiPrompt} onChange={(event) => onAiPromptChange(event.target.value)} />
          </label>
          <button className="secondary-button" data-testid="email-ai-generate" type="button" onClick={onGenerateAi} disabled={disabled || !selectedEmailAiPurposeEnabled}>
            <Bot size={16} />
            生成
          </button>
          {!selectedEmailAiPurposeEnabled ? <div className="subtle">当前 AI 动作已被开关关闭。</div> : null}
          {aiResult ? (
            <div className="activity-item">
              <strong>{aiResult.enabled ? "AI 输出" : "该 AI 功能已关闭"}</strong>
              {aiResult.suggestedSubject ? <div className="subtle">主题：{aiResult.suggestedSubject}</div> : null}
              {aiResult.budget ? (
                <div className="toolbar" style={{ marginTop: 8 }}>
                  <span className="badge">上下文 {aiResult.budget.contextCharCount}/{aiResult.budget.maxContextChars}</span>
                  <span className="badge">提示词 {aiResult.budget.modelPromptChars}</span>
                  {aiResult.generationMode ? <span className={aiResult.generationMode === "provider_fallback" ? "danger-badge" : "badge"}>模式 {formatEmailAiGenerationMode(aiResult.generationMode)}</span> : null}
                  {aiResult.budget.truncated ? <span className="danger-badge">已裁剪</span> : <span className="badge">未裁剪</span>}
                  {aiResult.budget.outputTruncated ? <span className="danger-badge">输出已裁剪</span> : null}
                </div>
              ) : null}
              <div className="toolbar" data-testid="email-ai-result-provenance" style={{ marginTop: 8 }}>
                <span className={aiResult.sources.length ? "badge" : "danger-badge"}>来源 {aiResult.sources.length}</span>
                <span className="badge">发送前人工确认</span>
              </div>
              {aiResult.providerError ? <div className="subtle">AI provider 回退：{aiResult.providerError}</div> : null}
              <div style={{ whiteSpace: "pre-wrap" }}>{aiResult.text}</div>
              {renderEmailAiSources(aiResult.sources)}
            </div>
          ) : null}
          {canManageEmailSettings ? (
          <div className="settings-item">
            <strong>系统知识库</strong>
            {knowledgeDraft.editingArticleId ? <div className="subtle">正在编辑已有知识条目，保存后会更新 AI 邮件可用的知识库内容。</div> : null}
            <div className="form-grid" style={{ marginTop: 8 }}>
              <label>
                <span className="subtle">标题</span>
                <input className="input" data-testid="knowledge-title" value={knowledgeDraft.title} onChange={(event) => onKnowledgeDraftChange({ ...knowledgeDraft, title: event.target.value })} />
              </label>
              <label>
                <span className="subtle">标签</span>
                <input className="input" data-testid="knowledge-tags" value={knowledgeDraft.tags} onChange={(event) => onKnowledgeDraftChange({ ...knowledgeDraft, tags: event.target.value })} placeholder="pricing, onboarding" />
              </label>
              <label className="settings-toggle">
                <input type="checkbox" checked={knowledgeDraft.active} onChange={(event) => onKnowledgeDraftChange({ ...knowledgeDraft, active: event.target.checked })} />
                启用
              </label>
              <label className="wide">
                <span className="subtle">内容</span>
                <textarea className="textarea" data-testid="knowledge-body" value={knowledgeDraft.body} onChange={(event) => onKnowledgeDraftChange({ ...knowledgeDraft, body: event.target.value })} />
              </label>
            </div>
            <button className="secondary-button" data-testid="knowledge-create" type="button" style={{ marginTop: 8 }} onClick={onCreateKnowledgeArticle} disabled={disabled || !knowledgeDraft.title.trim() || !knowledgeDraft.body.trim()}>
              <Save size={16} />
              {knowledgeDraft.editingArticleId ? "保存知识" : "添加知识"}
            </button>
            {knowledgeDraft.editingArticleId ? (
              <button className="ghost-button" data-testid="knowledge-edit-cancel" type="button" style={{ marginTop: 8, marginLeft: 8 }} onClick={() => onKnowledgeDraftChange({ title: "", body: "", tags: "", active: true })} disabled={disabled}>
                <XCircle size={16} />
                取消编辑
              </button>
            ) : null}
            <div className="toolbar" style={{ marginTop: 8 }}>
              {knowledgeArticles.map((article) => (
                <button
                  className={article.active ? "secondary-button" : "danger-button"}
                  data-testid="knowledge-edit"
                  key={article.id}
                  type="button"
                  onClick={() => onKnowledgeDraftChange({ editingArticleId: article.id, title: article.title, body: article.body, tags: article.tags.join(", "), active: article.active })}
                  disabled={disabled}
                >
                  {article.title} · {article.active ? "on" : "off"}
                </button>
              ))}
              {knowledgeArticles.filter((article) => article.active).length === 0 ? <span className="subtle">暂无启用文章</span> : null}
            </div>
          </div>
          ) : null}
        </div>
      </section>
      ) : null}
    </div>
  );
}

function ObjectDirectory({
  objects,
  recordCounts,
  onOpenObject
}: {
  objects: ObjectDefinition[];
  recordCounts: Record<string, number>;
  onOpenObject: (objectKey: string) => void;
}) {
  return (
    <section className="section">
      <h2 className="page-title">对象入口</h2>
      <div className="settings-list" style={{ marginTop: 12 }}>
        {objects.map((object) => (
          <button
            className="settings-item record-title"
            data-testid={`object-entry-${object.key}`}
            key={object.id}
            onClick={() => onOpenObject(object.key)}
            type="button"
          >
            <div className="stage-header">
              <strong>{object.pluralLabel}</strong>
              <span className="badge">{recordCounts[object.key] ?? 0}</span>
            </div>
            <div className="subtle">{object.description || `${object.label} 记录`}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

function SmartReminderPanel({
  compact,
  emptyMessage,
  generating,
  reminders,
  title,
  onComplete,
  onConvertTask,
  onDismiss,
  onGenerate,
  onOpenRecord,
  onSnooze
}: {
  compact: boolean;
  emptyMessage: string;
  generating: boolean;
  reminders: SmartReminder[];
  title: string;
  onComplete: (reminder: SmartReminder) => void;
  onConvertTask: (reminder: SmartReminder) => void;
  onDismiss: (reminder: SmartReminder) => void;
  onGenerate: () => void;
  onOpenRecord: (reminder: SmartReminder) => void;
  onSnooze: (reminder: SmartReminder) => void;
}) {
  return (
    <section className={`section smart-reminder-panel ${compact ? "compact" : ""}`}>
      <div className="stage-header">
        <div>
          <h2 className="page-title">{title}</h2>
          <div className="subtle">AI 只生成跟进建议，不会自动修改 CRM 数据。</div>
        </div>
        <button className="secondary-button" type="button" disabled={generating} onClick={onGenerate}>
          <RefreshCw className={generating ? "spin-icon" : undefined} size={16} />
          {generating ? "生成中" : "刷新提醒"}
        </button>
      </div>
      {reminders.length ? (
        <div className="smart-reminder-list">
          {reminders.map((reminder) => (
            <article className={`smart-reminder-card smart-reminder-${reminder.priority}`} key={reminder.id}>
              <div className="smart-reminder-main">
                <span className="smart-reminder-icon">
                  <Bot size={16} />
                </span>
                <div>
                  <div className="smart-reminder-title-row">
                    <strong>{reminder.title}</strong>
                    <span className="badge">AI</span>
                    <span className="subtle-badge">{smartReminderPriorityLabel(reminder.priority)}</span>
                    <span className="subtle-badge">{smartReminderKindLabel(reminder.kind)}</span>
                  </div>
                  <p>{reminder.body}</p>
                  <div className="smart-reminder-meta">
                    {reminder.actionLabel ? <span>{reminder.actionLabel}</span> : null}
                    {reminder.dueAt ? <span>建议截止 {formatDateTimeSeconds(reminder.dueAt)}</span> : null}
                    {reminder.sources.length ? <span>{reminder.sources.slice(0, 2).map((source) => source.label).join("、")}</span> : null}
                  </div>
                </div>
              </div>
              <div className="smart-reminder-actions">
                <button type="button" className="secondary-button" onClick={() => onOpenRecord(reminder)}>
                  <Eye size={14} />
                  打开记录
                </button>
                <button type="button" className="secondary-button" onClick={() => onComplete(reminder)}>
                  <CheckCircle2 size={14} />
                  完成
                </button>
                <button type="button" className="secondary-button" onClick={() => onSnooze(reminder)}>
                  <Clock3 size={14} />
                  稍后
                </button>
                <button type="button" className="secondary-button" onClick={() => onConvertTask(reminder)}>
                  <CalendarClock size={14} />
                  转任务
                </button>
                <button type="button" className="ghost-button" onClick={() => onDismiss(reminder)}>
                  忽略
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state compact">{emptyMessage}</div>
      )}
    </section>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: string | number; icon: LucideIcon }) {
  return (
    <div className="metric">
      <div className="activity-meta">
        <Icon size={16} />
        {label}
      </div>
      <span className="metric-value">{value}</span>
    </div>
  );
}

function EmailContactSearchDropdown({
  contacts,
  disabled,
  value,
  onChange
}: {
  contacts: CrmRecord[];
  disabled: boolean;
  value: string;
  onChange: (contactId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const options = contacts
    .map((contact) => {
      const emails = getRecordEmailAddressesFromData(contact);
      return {
        label: contact.title,
        value: contact.id,
        meta: emails.length ? emails.join(", ") : "未保存邮箱"
      };
    })
    .filter((option) => {
      if (!normalizedSearch) {
        return true;
      }
      return `${option.label} ${option.meta}`.toLowerCase().includes(normalizedSearch);
    });
  const selectedContact = contacts.find((contact) => contact.id === value);

  return (
    <SearchDropdown
      disabled={disabled}
      label="选择联系人"
      options={options}
      placeholder="搜索联系人"
      search={search}
      selectedLabel={selectedContact ? formatEmailContactLabel(selectedContact, getPrimaryRecordEmail(selectedContact)) : ""}
      testId="email-thread-existing-contact"
      value={value}
      onChange={onChange}
      onSearchChange={setSearch}
    />
  );
}

function getRecordEmailAddresses(fields: FieldDefinition[], record: CrmRecord): string[] {
  const contactMethodEmails = record.objectKey === "contacts" ? getContactMethodEmails(record) : [];
  const candidates = fields.flatMap((field) => {
    const value = record.data[field.key];
    if (typeof value !== "string") {
      return [];
    }
    const keyLooksEmail = field.key.toLowerCase().includes("email");
    const labelLooksEmail = field.label.toLowerCase().includes("邮箱") || field.label.toLowerCase().includes("email");
    if (!keyLooksEmail && !labelLooksEmail && !looksLikeEmail(value)) {
      return [];
    }
    return splitEmailList(value).filter(looksLikeEmail);
  });

  return [...new Set([...contactMethodEmails, ...candidates.map((email) => email.toLowerCase())])];
}

function getPrimaryRecordEmail(record: CrmRecord): string {
  return getRecordEmailAddressesFromData(record)[0] ?? "";
}

function getRecordEmailAddressesFromData(record: CrmRecord): string[] {
  const contactMethodEmails = record.objectKey === "contacts" ? getContactMethodEmails(record) : [];
  const candidates = Object.entries(record.data).flatMap(([key, value]) => {
    if (typeof value !== "string") {
      return [];
    }
    if (!key.toLowerCase().includes("email") && !looksLikeEmail(value)) {
      return [];
    }
    return splitEmailList(value).filter(looksLikeEmail);
  });
  return [...new Set([...contactMethodEmails, ...candidates.map((email) => email.toLowerCase())])];
}

function getCompanyContactRecords(company: CrmRecord, records: CrmRecord[]): CrmRecord[] {
  return records.filter((record) => record.objectKey === "contacts" && recordReferencesId(record.data.companyId, company.id));
}

function getCompanyPrimaryContact(company: CrmRecord, records: CrmRecord[]): CrmRecord | undefined {
  const contacts = getCompanyContactRecords(company, records);
  const primaryContactId = typeof company.data.primaryContactId === "string" ? company.data.primaryContactId : "";
  return contacts.find((contact) => contact.id === primaryContactId) ?? contacts[0];
}

function getRecordEmailAddressesForComposer(fields: FieldDefinition[], record: CrmRecord, records: CrmRecord[]): string[] {
  const directEmails = getRecordEmailAddresses(fields, record);
  if (record.objectKey !== "companies") {
    return directEmails;
  }

  const primaryContact = getCompanyPrimaryContact(record, records);
  const primaryEmails = primaryContact ? getRecordEmailAddressesFromData(primaryContact) : [];
  const relatedEmails = getCompanyContactRecords(record, records).flatMap((contact) => getRecordEmailAddressesFromData(contact));
  return [...new Set([...primaryEmails, ...directEmails, ...relatedEmails].map((email) => email.toLowerCase()))];
}

function findContactByEmail(records: CrmRecord[], emailAddress: string): CrmRecord | undefined {
  const normalizedEmail = emailAddress.trim().toLowerCase();
  return records.find((record) => record.objectKey === "contacts" && getRecordEmailAddressesFromData(record).includes(normalizedEmail));
}

function contactNameFromEmail(emailAddress: string): string {
  const localPart = emailAddress.split("@")[0]?.trim() || emailAddress;
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || emailAddress;
}

function formatEmailContactLabel(record: CrmRecord, fallbackEmail = ""): string {
  const emailAddress = fallbackEmail || getPrimaryRecordEmail(record);
  return emailAddress ? `${record.title}<${emailAddress}>` : record.title;
}

function getThreadPrimarySenderEmail(thread: EmailThread, messages: EmailMessage[], accounts: EmailAccount[]): string {
  const accountEmails = new Set(accounts.map((account) => account.emailAddress.toLowerCase()));
  const inboundSender = messages.find((message) => message.direction === "inbound" && !accountEmails.has(message.from.toLowerCase()))?.from;
  if (inboundSender) {
    return inboundSender.toLowerCase();
  }
  return (
    thread.participantEmails.find((email) => !accountEmails.has(email.toLowerCase())) ??
    messages.find((message) => looksLikeEmail(message.from))?.from ??
    thread.participantEmails[0] ??
    ""
  ).toLowerCase();
}

function getEmailThreadsForRecord(record: CrmRecord, records: CrmRecord[], threads: EmailThread[]): EmailThread[] {
  const recordIds = new Set([record.id]);
  const emailAddresses = new Set(getRecordEmailAddressesFromData(record));
  if (record.objectKey === "companies") {
    for (const candidate of records) {
      if (candidate.objectKey === "contacts" && recordReferencesId(candidate.data.companyId, record.id)) {
        recordIds.add(candidate.id);
        getRecordEmailAddressesFromData(candidate).forEach((emailAddress) => emailAddresses.add(emailAddress));
      }
    }
  }

  return threads
    .filter((thread) => {
      if (thread.recordId && recordIds.has(thread.recordId)) {
        return true;
      }
      return thread.participantEmails.some((emailAddress) => emailAddresses.has(emailAddress.toLowerCase()));
    })
    .sort((left, right) => new Date(right.lastMessageAt ?? right.updatedAt).getTime() - new Date(left.lastMessageAt ?? left.updatedAt).getTime());
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

function talkApiTarget(target: TalkTarget): TalkApiTarget {
  return target.type === "record"
    ? { type: "record", objectKey: target.objectKey, recordId: target.recordId }
    : { type: "email_thread", threadId: target.threadId };
}

function talkHistoryPayload(messages: TalkMessage[]): Array<Pick<TalkMessage, "role" | "content">> {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

function talkMessagesUrl(target: TalkTarget): string {
  const params = new URLSearchParams(
    target.type === "record"
      ? { type: "record", objectKey: target.objectKey, recordId: target.recordId }
      : { type: "email_thread", threadId: target.threadId }
  );
  return `/api/ai/talk/messages?${params.toString()}`;
}

function buildTalkKnowledgeTags(target: TalkTarget): string[] {
  return target.type === "record"
    ? ["talk", "rag", target.objectKey, target.recordId]
    : ["talk", "rag", "email_thread", target.threadId];
}

function buildTalkKnowledgeBody(target: TalkTarget, messages: TalkMessage[], sources: TalkResponse["sources"]): string {
  const targetLines =
    target.type === "record"
      ? [`Target type: record`, `Object: ${target.objectKey}`, `Record ID: ${target.recordId}`, `Record: ${target.label}`]
      : [`Target type: email_thread`, `Thread ID: ${target.threadId}`, `Thread: ${target.label}`];
  const transcript = messages.map((message) => `${message.role === "assistant" ? "AI" : "User"}: ${message.content}`).join("\n\n");
  const sourceLines = sources.length
    ? sources.map((source) => `- ${source.label}${source.objectKey && source.recordId ? ` (${source.objectKey}/${source.recordId})` : ""}`).join("\n")
    : "No sources returned.";
  return `${targetLines.join("\n")}\n\nTranscript:\n${transcript}\n\nSources:\n${sourceLines}`;
}

function buildTalkMessageKnowledgeBody(target: TalkTarget, message: TalkMessage, sources: TalkResponse["sources"]): string {
  const targetLines =
    target.type === "record"
      ? [`Target: ${target.objectKey}/${target.recordId}`, `Label: ${target.label}`]
      : [`Target: email_thread/${target.threadId}`, `Label: ${target.label}`];
  const sourceLines = sources.length ? sources.map((source) => `- ${source.label}`).join("\n") : "- current CRM context";
  return `${targetLines.join("\n")}\n\nMessage (${message.role}):\n${message.content}\n\nSources:\n${sourceLines}`;
}

function buildTalkInputSuggestion(target: TalkTarget, input: string, messages: TalkMessage[]): string {
  const trimmedInput = input.trim();
  const normalizedInput = trimmedInput.toLowerCase();
  const templates = talkSuggestionTemplates(target, messages);
  const candidate =
    templates.find((template) => template.toLowerCase().startsWith(normalizedInput) && template !== trimmedInput) ??
    templates.find((template) => talkSuggestionMatchesInput(template, normalizedInput) && template !== trimmedInput) ??
    (trimmedInput
      ? `${trimmedInput}，并结合“${target.label}”的当前上下文给出可执行建议。`
      : templates[0]);
  return candidate && candidate !== trimmedInput ? candidate : "";
}

function talkSuggestionTemplates(target: TalkTarget, messages: TalkMessage[]): string[] {
  const label = target.label;
  const continuation = messages.length ? [`基于刚才的讨论，继续分析“${label}”还有哪些风险和下一步行动。`] : [];
  if (target.type === "email_thread") {
    return [
      ...continuation,
      `分析这封邮件“${label}”的客户意图、风险等级和建议下一步行动。`,
      `判断这封邮件“${label}”是否值得回复，并说明原因。`,
      `基于这封邮件和客户背景，帮我草拟一个简洁回复思路。`,
      `提取这封邮件中适合沉淀到 RAG 知识库的要点。`
    ];
  }
  const common = [
    ...continuation,
    `总结“${label}”当前背景、关键风险和下一步建议。`,
    `围绕“${label}”列出需要销售跟进确认的问题。`
  ];
  if (target.objectKey === "contacts") {
    return [...common, `分析联系人“${label}”最近沟通中的购买意图和跟进优先级。`, `为联系人“${label}”准备一封简洁的跟进邮件思路。`];
  }
  if (target.objectKey === "companies") {
    return [...common, `分析公司“${label}”的决策链、主联系人和潜在机会。`, `为公司“${label}”制定下一轮销售跟进计划。`];
  }
  if (target.objectKey === "deals") {
    return [...common, `分析交易“${label}”推进到下一阶段的阻碍和行动清单。`, `判断交易“${label}”的赢单概率，并说明需要补齐的信息。`];
  }
  if (target.objectKey === "products") {
    return [...common, `分析产品“${label}”适合匹配哪些客户场景和销售话术。`, `为产品“${label}”整理报价或邮件中可使用的卖点。`];
  }
  if (target.objectKey === "quotes") {
    return [...common, `检查报价“${label}”的产品、费用、付款条款和客户沟通风险。`, `为报价“${label}”准备一段发送给客户的说明思路。`];
  }
  return common;
}

function talkSuggestionMatchesInput(template: string, normalizedInput: string): boolean {
  if (!normalizedInput) {
    return true;
  }
  const inputTerms = normalizedInput.split(/[\s，。,.!?;；、]+/).filter((term) => term.length > 0);
  const normalizedTemplate = template.toLowerCase();
  return inputTerms.some((term) => normalizedTemplate.includes(term));
}

function normalizeTalkInputSuggestion(input: string, candidate: string): string {
  const completed = applyTalkInputSuggestion(input, candidate);
  return completed.trim() && completed !== input ? completed : "";
}

function applyTalkInputSuggestion(input: string, candidate: string): string {
  const trimmedCandidate = candidate.trim();
  if (!trimmedCandidate) {
    return input;
  }
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    return trimmedCandidate;
  }
  if (trimmedCandidate.toLowerCase().startsWith(trimmedInput.toLowerCase())) {
    return `${input}${trimmedCandidate.slice(trimmedInput.length)}`;
  }
  const separator = /[，。,.!?！？；;\s]$/.test(input) ? "" : "，";
  return `${input}${separator}${trimmedCandidate}`;
}

function trimForLabel(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(1, maxLength - 1))}…` : value;
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function sanitizeTestId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function TaskView({
  activities,
  mediaAssets,
  pendingDeleteRequestsById,
  users,
  view,
  onToggle,
  onArchive,
  onDelete,
  onCreateTask,
  onUpdateTask,
  onUploadMediaAssets,
  onRequestPrompt,
  onShowToast
}: {
  activities: Activity[];
  mediaAssets: MediaAsset[];
  pendingDeleteRequestsById: Map<string, RecordChangeRequest>;
  users: User[];
  view: TaskCalendarView;
  onToggle: (activity: Activity, completed: boolean) => void;
  onArchive: (activity: Activity, archived: boolean) => void;
  onDelete: (activity: Activity) => void;
  onCreateTask: (input: TaskCreateInput) => void;
  onUpdateTask: (activity: Activity, draft: TaskEditDraft) => void;
  onUploadMediaAssets: (files: FileList | File[] | null) => Promise<MediaAsset[]>;
  onRequestPrompt: (options: PromptDialogState) => Promise<string | null>;
  onShowToast: (toast: ToastState) => void;
}) {
  const [status, setStatus] = useState<"todo" | "completed" | "archived">("todo");
  const [calendarCursor, setCalendarCursor] = useState(() => startOfCalendarDay(new Date()));
  const [editingTask, setEditingTask] = useState<Activity | null>(null);
  const [editDraft, setEditDraft] = useState<TaskEditDraft>(() => createTaskEditDraft(null));
  const [isUploadingTaskImage, setIsUploadingTaskImage] = useState(false);
  const todoTasks = activities.filter((activity) => !activity.completedAt && !activity.archivedAt);
  const completedTasks = activities.filter((activity) => activity.completedAt && !activity.archivedAt);
  const archivedTasks = activities.filter((activity) => activity.archivedAt);
  const visibleTasks = status === "todo" ? todoTasks : status === "completed" ? completedTasks : archivedTasks;
  const emptyMessage = status === "todo" ? "暂无待办任务" : status === "completed" ? "暂无已完成任务" : "暂无归档任务";
  const calendarTitle =
    view === "month"
      ? formatCalendarMonth(calendarCursor)
      : view === "week"
        ? formatCalendarRange(startOfCalendarWeek(calendarCursor), addCalendarDays(startOfCalendarWeek(calendarCursor), 6))
        : formatCalendarDayLabel(calendarCursor);

  async function requestTaskAt(dueAt: Date) {
    const title = await onRequestPrompt({
      title: "添加任务",
      message: `为 ${formatCalendarDateTime(dueAt)} 创建一个任务。`,
      placeholder: "输入任务标题",
      confirmLabel: "创建任务"
    });
    const trimmedTitle = title?.trim();
    if (!trimmedTitle) {
      return;
    }
    onCreateTask({ title: trimmedTitle, dueAt: dueAt.toISOString() });
  }

  async function requestTaskWithoutDate() {
    const title = await onRequestPrompt({
      title: "新建任务",
      message: "创建一个未排期任务，之后可在任务详情或日历中补充截止时间。",
      placeholder: "输入任务标题",
      confirmLabel: "创建任务"
    });
    const trimmedTitle = title?.trim();
    if (!trimmedTitle) {
      return;
    }
    onCreateTask({ title: trimmedTitle });
  }

  function moveCalendar(offset: number) {
    const next =
      view === "month"
        ? addCalendarMonths(calendarCursor, offset)
        : view === "week"
          ? addCalendarDays(calendarCursor, offset * 7)
          : addCalendarDays(calendarCursor, offset);
    setCalendarCursor(next);
  }

  function openTaskEditor(activity: Activity) {
    setEditingTask(activity);
    setEditDraft(createTaskEditDraft(activity));
  }

  function closeTaskEditor() {
    setEditingTask(null);
    setEditDraft(createTaskEditDraft(null));
    setIsUploadingTaskImage(false);
  }

  function saveTaskEdit() {
    if (!editingTask || !editDraft.title.trim()) {
      return;
    }
    onUpdateTask(editingTask, { ...editDraft, title: editDraft.title.trim(), text: editDraft.text.trim() });
    closeTaskEditor();
  }

  async function uploadTaskAttachments(files: FileList | File[] | null) {
    setIsUploadingTaskImage(true);
    try {
      const uploaded = await onUploadMediaAssets(files);
      if (uploaded.length) {
        setEditDraft((current) => ({
          ...current,
          attachments: uploaded.reduce((attachments, asset) => appendUniqueTaskAttachment(attachments, taskAttachmentFromMediaAsset(asset)), current.attachments)
        }));
      }
    } catch (error) {
      onShowToast({ intent: "error", message: error instanceof Error ? error.message : "附件上传失败" });
    } finally {
      setIsUploadingTaskImage(false);
    }
  }

  return (
    <section className="section">
      <div className="section-header task-view-header compact">
        <div>
          <p className="subtle">按待办、已完成、归档管理销售跟进事项，也可以在日历中按日期和时间直接创建任务。</p>
        </div>
        <div className="toolbar" role="group" aria-label="任务快捷操作">
          <button className="primary-button" data-testid="task-create-from-list" type="button" onClick={requestTaskWithoutDate}>
            <CheckCircle2 size={16} />
            新建任务
          </button>
        </div>
      </div>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button
          className={status === "todo" ? "primary-button" : "secondary-button"}
          data-testid="task-tab-todo"
          type="button"
          onClick={() => setStatus("todo")}
        >
          <Clock3 size={16} />
          待办
          <span className="badge">{todoTasks.length}</span>
        </button>
        <button
          className={status === "completed" ? "primary-button" : "secondary-button"}
          data-testid="task-tab-completed"
          type="button"
          onClick={() => setStatus("completed")}
        >
          <CheckCircle2 size={16} />
          已完成
          <span className="badge">{completedTasks.length}</span>
        </button>
        <button
          className={status === "archived" ? "primary-button" : "secondary-button"}
          data-testid="task-tab-archived"
          type="button"
          onClick={() => setStatus("archived")}
        >
          <Archive size={16} />
          归档
          <span className="badge">{archivedTasks.length}</span>
        </button>
      </div>
      {view === "list" ? (
        <TaskList
          activities={visibleTasks}
          emptyMessage={emptyMessage}
          mediaAssets={mediaAssets}
          pendingDeleteRequestsById={pendingDeleteRequestsById}
          testIdPrefix="task-view-task"
          users={users}
          onArchive={onArchive}
          onDelete={onDelete}
          onEdit={openTaskEditor}
          onToggle={onToggle}
        />
      ) : (
        <div className="task-calendar" data-testid={`task-calendar-${view}`}>
          <div className="task-calendar-nav">
            <div>
              <strong>{calendarTitle}</strong>
              <div className="subtle">当前显示：{emptyMessage.replace("暂无", "")}</div>
            </div>
            <div className="toolbar">
              <button className="icon-button" type="button" aria-label="上一段时间" onClick={() => moveCalendar(-1)}>
                <ChevronLeft size={16} />
              </button>
              <button className="secondary-button" type="button" onClick={() => setCalendarCursor(startOfCalendarDay(new Date()))}>
                今天
              </button>
              <button className="icon-button" type="button" aria-label="下一段时间" onClick={() => moveCalendar(1)}>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
          {view === "month" && (
            <TaskMonthCalendar
              cursor={calendarCursor}
              tasks={visibleTasks}
              users={users}
              onCreateTask={requestTaskAt}
            />
          )}
          {view === "week" && (
            <TaskWeekCalendar
              cursor={calendarCursor}
              tasks={visibleTasks}
              users={users}
              onCreateTask={requestTaskAt}
            />
          )}
          {view === "day" && (
            <TaskDayCalendar
              cursor={calendarCursor}
              tasks={visibleTasks}
              users={users}
              onCreateTask={requestTaskAt}
            />
          )}
        </div>
      )}
      {editingTask && (
        <TaskEditDialog
          draft={editDraft}
          isUploading={isUploadingTaskImage}
          mediaAssets={mediaAssets}
          task={editingTask}
          onAddMediaAsset={(asset) =>
            setEditDraft((current) => ({
              ...current,
              attachments: appendUniqueTaskAttachment(current.attachments, taskAttachmentFromMediaAsset(asset))
            }))
          }
          onCancel={closeTaskEditor}
          onChange={setEditDraft}
          onRemoveAttachment={(attachmentId) =>
            setEditDraft((current) => ({
              ...current,
              attachments: current.attachments.filter((attachment) => attachment.id !== attachmentId)
            }))
          }
          onSave={saveTaskEdit}
          onUploadImages={uploadTaskAttachments}
        />
      )}
    </section>
  );
}

function TaskList({
  activities,
  emptyMessage,
  mediaAssets = [],
  pendingDeleteRequestsById,
  testIdPrefix,
  users,
  onArchive,
  onDelete,
  onEdit,
  onToggle
}: {
  activities: Activity[];
  emptyMessage: string;
  mediaAssets?: MediaAsset[];
  pendingDeleteRequestsById?: Map<string, RecordChangeRequest>;
  testIdPrefix?: string;
  users: User[];
  onArchive?: (activity: Activity, archived: boolean) => void;
  onDelete?: (activity: Activity) => void;
  onEdit?: (activity: Activity) => void;
  onToggle: (activity: Activity, completed: boolean) => void;
}) {
  if (activities.length === 0) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  return (
    <div className="activity-list" style={{ marginTop: 12 }}>
      {activities.map((activity) => {
        const completed = Boolean(activity.completedAt);
        const archived = Boolean(activity.archivedAt);
        const overdue = isTaskOverdue(activity);
        const taskDetails = parseTaskDetails(activity.body);
        const pendingDeleteRequest = pendingDeleteRequestsById?.get(activity.id);
        return (
          <div
            className="activity-item"
            data-completed={completed ? "true" : "false"}
            data-archived={archived ? "true" : "false"}
            data-testid={testIdPrefix ? `${testIdPrefix}-${activity.id}` : undefined}
            key={activity.id}
          >
            <div className="activity-meta">
              <CalendarClock size={15} />
              截止 {formatDate(activity.dueAt)} · {users.find((user) => user.id === activity.actorId)?.name ?? "未分配"}
              {completed && <span className="badge">已完成</span>}
              {archived && <span className="badge">已归档</span>}
              {pendingDeleteRequest && <span className="danger-badge">删除待审核</span>}
              {!completed && overdue && <span className="badge danger-badge">已逾期</span>}
            </div>
            <strong>{activity.title}</strong>
            {taskDetails.text && <div className="subtle">{taskDetails.text}</div>}
            <TaskAttachmentPreview attachments={taskDetails.attachments} mediaAssets={mediaAssets} />
            <div className="toolbar" style={{ marginTop: 10 }}>
              {onEdit && (
                <button
                  className="secondary-button"
                  data-testid={testIdPrefix ? `${testIdPrefix}-edit-${activity.id}` : undefined}
                  type="button"
                  onClick={() => onEdit(activity)}
                >
                  <Save size={16} />
                  编辑
                </button>
              )}
              <button
                className="secondary-button"
                data-completed={completed ? "true" : "false"}
                data-testid={testIdPrefix ? `${testIdPrefix}-toggle-${activity.id}` : undefined}
                type="button"
                onClick={() => onToggle(activity, !completed)}
              >
                {completed ? <RotateCcw size={16} /> : <CheckCircle2 size={16} />}
                {completed ? "重开任务" : "完成任务"}
              </button>
              {onArchive && (
                <button
                  className="secondary-button"
                  data-archived={archived ? "true" : "false"}
                  data-testid={testIdPrefix ? `${testIdPrefix}-archive-${activity.id}` : undefined}
                  type="button"
                  onClick={() => onArchive(activity, !archived)}
                >
                  {archived ? <RotateCcw size={16} /> : <Archive size={16} />}
                  {archived ? "移回列表" : "归档"}
                </button>
              )}
              {onDelete && (
                <button
                  className="secondary-button danger-button"
                  data-testid={testIdPrefix ? `${testIdPrefix}-delete-${activity.id}` : undefined}
                  type="button"
                  onClick={() => onDelete(activity)}
                >
                  {pendingDeleteRequest ? <RotateCcw size={16} /> : <Trash2 size={16} />}
                  {pendingDeleteRequest ? "取消删除申请" : "删除"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskEditDialog({
  draft,
  isUploading,
  mediaAssets,
  task,
  onAddMediaAsset,
  onCancel,
  onChange,
  onRemoveAttachment,
  onSave,
  onUploadImages
}: {
  draft: TaskEditDraft;
  isUploading: boolean;
  mediaAssets: MediaAsset[];
  task: Activity;
  onAddMediaAsset: (asset: MediaAsset) => void;
  onCancel: () => void;
  onChange: (draft: TaskEditDraft) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onSave: () => void;
  onUploadImages: (files: FileList | File[] | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`编辑任务 ${task.title}`}>
      <form
        className="modal-panel task-edit-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <div className="drawer-header">
          <div>
            <h2 className="page-title" style={{ fontSize: 18 }}>编辑任务</h2>
            <p className="subtle">修改标题、截止时间、备注，并添加附件。</p>
          </div>
          <button className="icon-button" aria-label="关闭编辑任务" type="button" onClick={onCancel}>
            <XCircle size={18} />
          </button>
        </div>
        <div className="form-grid">
          <label className="wide">
            <span className="subtle">标题</span>
            <input className="input" data-testid="task-edit-title" value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value })} />
          </label>
          <label>
            <span className="subtle">截止时间</span>
            <input
              className="input"
              data-testid="task-edit-due-at"
              type="datetime-local"
              value={draft.dueAt}
              onChange={(event) => onChange({ ...draft, dueAt: event.target.value })}
            />
          </label>
          <label className="wide">
            <span className="subtle">备注</span>
            <textarea className="textarea" data-testid="task-edit-body" value={draft.text} onChange={(event) => onChange({ ...draft, text: event.target.value })} />
          </label>
        </div>
        <div className="task-attachment-panel">
          <div className="toolbar between">
            <strong>附件</strong>
            <div className="toolbar">
              <button className="secondary-button" type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                <Upload size={16} />
                {isUploading ? "上传中" : "上传附件"}
              </button>
              <input
                ref={fileInputRef}
                hidden
                multiple
                type="file"
                onChange={(event) => {
                  onUploadImages(event.target.files);
                  event.target.value = "";
                }}
              />
            </div>
          </div>
          <TaskAttachmentPreview attachments={draft.attachments} mediaAssets={mediaAssets} onRemove={onRemoveAttachment} />
          {mediaAssets.length ? (
            <div className="media-picker-strip task-media-picker" data-testid="task-edit-media-library">
              {mediaAssets.slice(0, 16).map((asset) => (
                <button key={asset.id} type="button" onClick={() => onAddMediaAsset(asset)} title={asset.name}>
                  <MediaAssetPreview asset={asset} />
                </button>
              ))}
            </div>
          ) : (
            <div className="subtle">媒体库暂无文件，可先上传。</div>
          )}
        </div>
        <div className="toolbar" style={{ justifyContent: "flex-end" }}>
          <button className="secondary-button" type="button" onClick={onCancel}>取消</button>
          <button className="primary-button" data-testid="task-edit-save" type="submit" disabled={!draft.title.trim()}>
            <Save size={16} />
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

function TaskAttachmentPreview({
  attachments,
  mediaAssets,
  onRemove
}: {
  attachments: TaskAttachment[];
  mediaAssets: MediaAsset[];
  onRemove?: (attachmentId: string) => void;
}) {
  if (!attachments.length) {
    return null;
  }
  return (
    <div className="task-attachment-grid" data-testid="task-attachment-grid">
      {attachments.map((attachment) => {
        const asset = mediaAssets.find((candidate) => candidate.id === attachment.mediaAssetId);
        return (
          <div className="task-attachment-item" key={attachment.id}>
            {asset && isImageMediaAsset(asset) ? <img alt={attachment.name} src={mediaAssetDataUrl(asset)} /> : <Paperclip size={18} />}
            <div>
              <strong>{attachment.name}</strong>
              <span className="subtle">{attachment.contentType} · {formatBytes(attachment.size)}</span>
            </div>
            {onRemove && (
              <button className="icon-button" aria-label={`移除 ${attachment.name}`} type="button" onClick={() => onRemove(attachment.id)}>
                <XCircle size={16} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TaskMonthCalendar({
  cursor,
  tasks,
  users,
  onCreateTask
}: {
  cursor: Date;
  tasks: Activity[];
  users: User[];
  onCreateTask: (dueAt: Date) => void;
}) {
  const days = buildMonthCalendarDays(cursor);
  const currentMonth = cursor.getMonth();

  return (
    <div className="task-month-calendar" role="grid" aria-label="任务月视图">
      {calendarWeekdayLabels.map((label) => (
        <div className="task-calendar-weekday" key={label}>{label}</div>
      ))}
      {days.map((day) => {
        const dayTasks = tasksForCalendarDay(tasks, day);
        return (
          <div className={day.getMonth() === currentMonth ? "task-calendar-day" : "task-calendar-day outside"} key={day.toISOString()} role="gridcell">
            <div className="task-calendar-day-header">
              <strong>{day.getDate()}</strong>
              <button className="secondary-button compact-button" type="button" onClick={() => onCreateTask(calendarDateAtHour(day, 9))}>
                添加
              </button>
            </div>
            <div className="task-calendar-day-list">
              {dayTasks.map((task) => (
                <TaskCalendarChip activity={task} key={task.id} users={users} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskWeekCalendar({
  cursor,
  tasks,
  users,
  onCreateTask
}: {
  cursor: Date;
  tasks: Activity[];
  users: User[];
  onCreateTask: (dueAt: Date) => void;
}) {
  const weekStart = startOfCalendarWeek(cursor);
  const days = Array.from({ length: 7 }, (_, index) => addCalendarDays(weekStart, index));

  return (
    <div className="task-week-calendar" data-testid="task-calendar-week-grid">
      <div className="task-week-header-spacer" />
      {days.map((day) => (
        <div className="task-week-day-header" key={day.toISOString()}>
          <strong>{formatShortWeekday(day)}</strong>
          <span>{formatShortDate(day)}</span>
        </div>
      ))}
      {taskCalendarHours.map((hour) => (
        <Fragment key={hour}>
          <div className="task-time-label">{formatHourLabel(hour)}</div>
          {days.map((day) => {
            const slotTime = calendarDateAtHour(day, hour);
            const slotTasks = tasksForCalendarHour(tasks, slotTime);
            return (
              <button
                className="task-calendar-slot"
                key={`${day.toISOString()}-${hour}`}
                type="button"
                onClick={() => onCreateTask(slotTime)}
              >
                {slotTasks.map((task) => (
                  <TaskCalendarChip activity={task} key={task.id} users={users} />
                ))}
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}

function TaskDayCalendar({
  cursor,
  tasks,
  users,
  onCreateTask
}: {
  cursor: Date;
  tasks: Activity[];
  users: User[];
  onCreateTask: (dueAt: Date) => void;
}) {
  return (
    <div className="task-day-calendar" data-testid="task-calendar-day-grid">
      {taskCalendarHours.map((hour) => {
        const slotTime = calendarDateAtHour(cursor, hour);
        const slotTasks = tasksForCalendarHour(tasks, slotTime);
        return (
          <div className="task-day-slot" key={hour}>
            <div className="task-time-label">{formatHourLabel(hour)}</div>
            <button className="task-calendar-slot" type="button" onClick={() => onCreateTask(slotTime)}>
              {slotTasks.length ? (
                slotTasks.map((task) => <TaskCalendarChip activity={task} key={task.id} users={users} />)
              ) : (
                <span className="subtle">点击添加任务</span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function TaskCalendarChip({ activity, users }: { activity: Activity; users: User[] }) {
  return (
    <div className="task-calendar-chip" title={activity.title}>
      <strong>{activity.title}</strong>
      <span>
        {formatTaskCalendarTime(activity.dueAt)} · {users.find((user) => user.id === activity.actorId)?.name ?? "未分配"}
      </span>
    </div>
  );
}

const calendarWeekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];
const taskCalendarHours = Array.from({ length: 14 }, (_, index) => index + 7);

function taskViewLabel(view: TaskCalendarView): string {
  if (view === "month") {
    return "月视图";
  }
  if (view === "week") {
    return "周视图";
  }
  if (view === "day") {
    return "日视图";
  }
  return "列表";
}

function buildMonthCalendarDays(cursor: Date): Date[] {
  const firstOfMonth = startOfCalendarDay(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  const gridStart = startOfCalendarWeek(firstOfMonth);
  return Array.from({ length: 42 }, (_, index) => addCalendarDays(gridStart, index));
}

function tasksForCalendarDay(tasks: Activity[], day: Date): Activity[] {
  return tasks
    .filter((task) => {
      const dueAt = taskDueDate(task);
      return dueAt ? sameCalendarDay(dueAt, day) : false;
    })
    .sort(sortTasksByDueAt);
}

function tasksForCalendarHour(tasks: Activity[], hourDate: Date): Activity[] {
  return tasks
    .filter((task) => {
      const dueAt = taskDueDate(task);
      return dueAt ? sameCalendarDay(dueAt, hourDate) && dueAt.getHours() === hourDate.getHours() : false;
    })
    .sort(sortTasksByDueAt);
}

function sortTasksByDueAt(left: Activity, right: Activity): number {
  return (taskDueDate(left)?.getTime() ?? 0) - (taskDueDate(right)?.getTime() ?? 0);
}

function taskDueDate(task: Activity): Date | null {
  if (!task.dueAt) {
    return null;
  }
  const dueAt = new Date(task.dueAt);
  return Number.isNaN(dueAt.getTime()) ? null : dueAt;
}

function startOfCalendarDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfCalendarWeek(date: Date): Date {
  const day = startOfCalendarDay(date);
  const mondayOffset = (day.getDay() + 6) % 7;
  return addCalendarDays(day, -mondayOffset);
}

function addCalendarDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addCalendarMonths(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount, 1);
  return startOfCalendarDay(next);
}

function calendarDateAtHour(date: Date, hour: number): Date {
  const next = startOfCalendarDay(date);
  next.setHours(hour, 0, 0, 0);
  return next;
}

function sameCalendarDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function formatCalendarMonth(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(date);
}

function formatCalendarDayLabel(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "full" }).format(date);
}

function formatCalendarRange(start: Date, end: Date): string {
  return `${formatShortDate(start)} - ${formatShortDate(end)}`;
}

function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

function formatShortWeekday(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date);
}

function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function formatTaskCalendarTime(value?: string): string {
  if (!value) {
    return "未排期";
  }
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatCalendarDateTime(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function buildHeaderNotifications({
  activities,
  deletedActivityIds,
  importJobs,
  notificationChannels,
  objectDefinitions,
  recordChangeRequests,
  records,
  smartReminders,
  workflowApprovals
}: {
  activities: Activity[];
  deletedActivityIds: Set<string>;
  importJobs: CsvImportJob[];
  notificationChannels: NotificationChannel[];
  objectDefinitions: ObjectDefinition[];
  recordChangeRequests: RecordChangeRequest[];
  records: CrmRecord[];
  smartReminders: SmartReminder[];
  workflowApprovals: WorkflowActionApproval[];
}): HeaderNotification[] {
  const now = new Date();
  const today = startOfCalendarDay(now);
  const tomorrow = addCalendarDays(today, 1);
  const items: HeaderNotification[] = [];

  activities
    .filter((activity) => !deletedActivityIds.has(activity.id))
    .filter((activity) => activity.type === "task" && !activity.completedAt && !activity.archivedAt && activity.dueAt)
    .sort((left, right) => new Date(left.dueAt ?? left.createdAt).getTime() - new Date(right.dueAt ?? right.createdAt).getTime())
    .slice(0, 6)
    .forEach((activity) => {
      const dueAt = new Date(activity.dueAt ?? activity.createdAt);
      const overdue = dueAt.getTime() < now.getTime();
      const dueToday = dueAt.getTime() >= today.getTime() && dueAt.getTime() < tomorrow.getTime();
      if (!overdue && !dueToday) {
        return;
      }
      const event: NotificationEvent = "activity.created";
      const syncedChannels = notificationChannelsForEvents(notificationChannels, [event]);
      if (!syncedChannels.length) {
        return;
      }
      const linkedRecord = records.find((record) => record.id === activity.recordId);
      items.push({
        id: `task:${activity.id}`,
        title: overdue ? "任务已逾期" : "今日任务提醒",
        description: linkedRecord ? `${activity.title} · ${linkedRecord.title}` : activity.title,
        time: activity.dueAt,
        icon: CalendarClock,
        intent: overdue ? "danger" : "warning",
        event,
        syncedChannels
      });
    });

  recordChangeRequests
    .filter((request) => request.status === "pending")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 5)
    .forEach((request) => {
      const objectLabel = objectDefinitions.find((object) => object.key === request.objectKey)?.label ?? request.objectKey;
      const event: NotificationEvent = request.action === "delete" ? "record.deleted" : "record.updated";
      const scopedEvent = `record.${request.objectKey}.${request.action === "delete" ? "deleted" : "updated"}` as NotificationEvent;
      const syncedChannels = notificationChannelsForEvents(notificationChannels, [scopedEvent, event]);
      if (!syncedChannels.length) {
        return;
      }
      items.push({
        id: `record-change:${request.id}`,
        title: request.action === "delete" ? "删除申请待审核" : "修改申请待审核",
        description: `${objectLabel} · ${request.recordTitle}`,
        time: request.createdAt,
        icon: CheckCircle2,
        intent: request.action === "delete" ? "danger" : "warning",
        event: scopedEvent,
        syncedChannels
      });
    });

  smartReminders
    .filter((reminder) => reminder.status === "open")
    .filter((reminder) => !reminder.snoozedUntil || new Date(reminder.snoozedUntil).getTime() <= now.getTime())
    .sort(compareSmartReminderForUi)
    .slice(0, 6)
    .forEach((reminder) => {
      const event: NotificationEvent = "ai.reminder.created";
      const digestEvent: NotificationEvent = "ai.reminder.daily_digest";
      const syncedChannels = notificationChannelsForEvents(notificationChannels, [event, digestEvent]);
      if (!syncedChannels.length) {
        return;
      }
      const linkedRecord = records.find((record) => record.id === reminder.recordId && record.objectKey === reminder.objectKey);
      items.push({
        id: `smart-reminder:${reminder.id}`,
        title: `AI 提醒：${reminder.title}`,
        description: [smartReminderPriorityLabel(reminder.priority), linkedRecord?.title, reminder.actionLabel].filter(Boolean).join(" · "),
        time: reminder.dueAt ?? reminder.createdAt,
        icon: Bot,
        intent: reminder.priority === "urgent" ? "danger" : reminder.priority === "high" ? "warning" : "info",
        event,
        syncedChannels
      });
    });

  workflowApprovals
    .filter((approval) => approval.status === "pending")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 4)
    .forEach((approval) => {
      const event: NotificationEvent = "workflow.action_approval_requested";
      const syncedChannels = notificationChannelsForEvents(notificationChannels, [event]);
      if (!syncedChannels.length) {
        return;
      }
      items.push({
        id: `workflow-approval:${approval.id}`,
        title: "工作流动作待审批",
        description: approval.summary,
        time: approval.createdAt,
        icon: WorkflowIcon,
        intent: "warning",
        event,
        syncedChannels
      });
    });

  importJobs
    .filter((job) => job.status === "failed")
    .sort((left, right) => new Date(right.completedAt ?? right.createdAt).getTime() - new Date(left.completedAt ?? left.createdAt).getTime())
    .slice(0, 3)
    .forEach((job) => {
      const objectLabel = objectDefinitions.find((object) => object.key === job.objectKey)?.label ?? job.objectKey;
      const event: NotificationEvent = "import.failed";
      const syncedChannels = notificationChannelsForEvents(notificationChannels, [event]);
      if (!syncedChannels.length) {
        return;
      }
      items.push({
        id: `import-job:${job.id}`,
        title: "导入任务失败",
        description: `${objectLabel} · ${job.errorMessage ?? `${job.errorCount} 行错误`}`,
        time: job.completedAt ?? job.createdAt,
        icon: Upload,
        intent: "danger",
        event,
        syncedChannels
      });
    });

  return items
    .sort((left, right) => new Date(right.time ?? "").getTime() - new Date(left.time ?? "").getTime())
    .slice(0, 12);
}

function notificationChannelsForEvents(
  notificationChannels: NotificationChannel[],
  events: NotificationEvent[]
): Array<Pick<NotificationChannel, "id" | "name" | "type">> {
  const eventSet = new Set(events);
  return notificationChannels
    .filter((channel) => channel.active && channel.events.some((event) => eventSet.has(event)))
    .map((channel) => ({ id: channel.id, name: channel.name, type: channel.type }));
}

function formatNotificationChannelSummary(channels: Array<Pick<NotificationChannel, "name" | "type">>): string {
  if (!channels.length) {
    return "未配置通知渠道";
  }
  return channels
    .slice(0, 3)
    .map((channel) => `${channel.name} (${notificationChannelTypeLabel(channel.type)})`)
    .join("、") + (channels.length > 3 ? ` 等 ${channels.length} 个渠道` : "");
}

function notificationChannelTypeLabel(type: NotificationChannel["type"]): string {
  if (type === "bark") return "Bark";
  if (type === "email") return "Email";
  return "Webhook";
}

function buildActivitiesCsv(activities: Activity[], records: CrmRecord[], users: User[]): string {
  const headers = ["id", "type", "title", "body", "record", "owner", "dueAt", "completedAt", "archivedAt", "createdAt"];
  const rows = activities.map((activity) => {
    const details = activity.type === "task" ? parseTaskDetails(activity.body) : parseActivityDetails(activity.body);
    const record = records.find((candidate) => candidate.id === activity.recordId);
    const owner = users.find((candidate) => candidate.id === activity.actorId);
    return [
      activity.id,
      formatActivityType(activity.type),
      activity.title,
      details.text,
      record?.title ?? "",
      owner ? `${owner.name} <${owner.email}>` : "",
      activity.dueAt ?? "",
      activity.completedAt ?? "",
      activity.archivedAt ?? "",
      activity.createdAt
    ];
  });
  return [headers, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

function escapeCsvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadTextFile(filename: string, text: string, contentType = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: contentType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function ActivityTimeline({
  activities,
  emptyMessage = "暂无活动",
  mediaAssets,
  pendingDeleteRequestsById,
  records,
  testIdPrefix = "activity-view-activity",
  onDelete
}: {
  activities: Activity[];
  emptyMessage?: string;
  mediaAssets: MediaAsset[];
  pendingDeleteRequestsById: Map<string, RecordChangeRequest>;
  records: CrmRecord[];
  testIdPrefix?: string;
  onDelete: (activity: Activity) => void;
}) {
  const sortedActivities = [...activities].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  if (sortedActivities.length === 0) {
    return (
      <section className="activity-timeline-shell">
        <div className="activity-timeline-header">
          <div className="property-name">活动时间线</div>
        </div>
        <div className="empty-state">{emptyMessage}</div>
      </section>
    );
  }

  return (
    <section className="activity-timeline-shell">
      <div className="activity-timeline-header">
        <div>
          <div className="property-name">活动时间线</div>
          <div className="subtle">按时间倒序展示邮件、电话、备注、任务和阶段变更。</div>
        </div>
        <label className="activity-timeline-filter">
          <span>Filter by</span>
          <select className="select" value="all" disabled>
            <option value="all">All</option>
          </select>
        </label>
      </div>
      <div className="activity-timeline-list">
        {sortedActivities.map((activity) => {
          const details = parseActivityDetails(activity.body);
          const body = details.text;
          const linkedRecord = records.find((record) => record.id === activity.recordId);
          const pendingDeleteRequest = pendingDeleteRequestsById.get(activity.id);
          const TimelineIcon = activityTimelineIcon(activity.type);
          return (
            <article className="activity-timeline-item" data-testid={`${testIdPrefix}-${activity.id}`} key={activity.id}>
              <div className={`activity-timeline-marker ${activity.type}`}>
                <TimelineIcon size={16} />
              </div>
              <div className="activity-timeline-content">
                <div className="activity-timeline-summary">
                  <div>
                    <strong>{activityTimelineTitle(activity)}</strong>
                    <span className="subtle"> - {formatDateTimeSeconds(activity.createdAt)}</span>
                    {linkedRecord ? (
                      <div className="activity-timeline-linked">
                        Associated with <span>{linkedRecord.title}</span>
                      </div>
                    ) : null}
                  </div>
                  <button className="text-button" type="button">
                    Pin on top
                  </button>
                </div>
                <div className="activity-timeline-card">
                  <div className="activity-timeline-card-header">
                    <div className="activity-timeline-card-title">
                      <span className="activity-timeline-card-icon">
                        <TimelineIcon size={16} />
                      </span>
                      <div>
                        <strong>{activity.title}</strong>
                        {pendingDeleteRequest ? <span className="danger-badge">删除待审核</span> : null}
                      </div>
                    </div>
                    <span className="activity-timeline-type">{formatActivityType(activity.type)}</span>
                  </div>
                  {body ? <div className="activity-timeline-body">{body}</div> : null}
                  <TaskAttachmentPreview attachments={details.attachments} mediaAssets={mediaAssets} />
                  {onDelete ? (
                    <div className="activity-timeline-footer">
                      <button
                        className="secondary-button danger-button"
                        data-testid={`${testIdPrefix}-delete-${activity.id}`}
                        type="button"
                        onClick={() => onDelete(activity)}
                      >
                        {pendingDeleteRequest ? <RotateCcw size={16} /> : <Trash2 size={16} />}
                        {pendingDeleteRequest ? "取消删除申请" : "删除"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function activityTimelineIcon(type: Activity["type"]): LucideIcon {
  switch (type) {
    case "call":
      return Phone;
    case "email":
      return Mail;
    case "meeting":
      return CalendarClock;
    case "note":
      return FileText;
    case "stage_change":
      return Trophy;
    case "task":
      return CheckCircle2;
    default:
      return ActivityIcon;
  }
}

function activityTimelineTitle(activity: Activity): string {
  switch (activity.type) {
    case "call":
      return "New call has been logged";
    case "email":
      return "Email message has been created";
    case "meeting":
      return "Meeting has been scheduled";
    case "note":
      return "New note has been created";
    case "stage_change":
      return "Deal stage has changed";
    case "task":
      return activity.completedAt ? "Task has been completed" : "Task has been created";
    default:
      return "An activity has been created";
  }
}

function RecordSectionHeader({
  title,
  addLabel,
  isOpen,
  onToggle
}: {
  title: string;
  addLabel: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="record-section-header">
      <div className="property-name">{title}</div>
      <button className={`icon-button ${isOpen ? "active" : ""}`} aria-expanded={isOpen} aria-label={isOpen ? `收起${addLabel}` : addLabel} title={isOpen ? `收起${addLabel}` : addLabel} type="button" onClick={onToggle}>
        {isOpen ? <ChevronDown size={16} /> : <Plus size={16} />}
      </button>
    </div>
  );
}

function RecordActivityComposer({
  type,
  submitLabel,
  titlePlaceholder,
  bodyPlaceholder,
  dateLabel,
  isPending,
  mediaAssets,
  testIdPrefix,
  onUploadMediaAssets,
  onSubmit
}: {
  type: Activity["type"];
  submitLabel: string;
  titlePlaceholder: string;
  bodyPlaceholder: string;
  dateLabel?: string;
  isPending: boolean;
  mediaAssets: MediaAsset[];
  testIdPrefix: string;
  onUploadMediaAssets: (files: FileList | File[] | null) => Promise<MediaAsset[]>;
  onSubmit: (input: RecordActivityComposerInput) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [attachments, setAttachments] = useState<ActivityAttachment[]>([]);
  const requiresDueAt = type === "task";
  const showsDueAt = Boolean(dateLabel);
  const canSubmit = Boolean(title.trim()) && (!requiresDueAt || Boolean(dueAt));

  function submit() {
    if (!canSubmit) {
      return;
    }

    onSubmit({
      type,
      title: title.trim(),
      body: type === "task" ? serializeTaskDetails({ text: body, attachments }) : serializeActivityDetails({ text: body, attachments }),
      dueAt: showsDueAt && dueAt ? dueAt : undefined
    });
    setTitle("");
    setBody("");
    setDueAt("");
    setAttachments([]);
  }

  return (
    <div className="record-activity-composer" data-testid={`${testIdPrefix}-composer`}>
      <div className="form-grid">
        {showsDueAt ? (
          <label>
            <span className="subtle">{dateLabel}</span>
            <input className="input" data-testid={`${testIdPrefix}-due-at`} type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
          </label>
        ) : null}
        <label className={showsDueAt ? "" : "wide"}>
          <span className="subtle">标题</span>
          <input className="input" data-testid={`${testIdPrefix}-title`} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={titlePlaceholder} />
        </label>
        <label className="wide">
          <span className="subtle">内容</span>
          <textarea className="textarea" data-testid={`${testIdPrefix}-body`} value={body} onChange={(event) => setBody(event.target.value)} placeholder={bodyPlaceholder} />
        </label>
      </div>
      <AttachmentPicker
        attachments={attachments}
        disabled={isPending}
        label="附件"
        mediaAssets={mediaAssets}
        onChange={setAttachments}
        onUploadMediaAssets={onUploadMediaAssets}
        testIdPrefix={`${testIdPrefix}-attachment`}
      />
      <div className="toolbar" style={{ marginTop: 10 }}>
        <button className="secondary-button" data-testid={`${testIdPrefix}-submit`} type="button" onClick={submit} disabled={isPending || !canSubmit}>
          <Save size={16} />
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function AttachmentPicker({
  attachments,
  disabled,
  label,
  mediaAssets,
  onChange,
  onUploadMediaAssets,
  testIdPrefix
}: {
  attachments: ActivityAttachment[];
  disabled?: boolean;
  label: string;
  mediaAssets: MediaAsset[];
  onChange: (attachments: ActivityAttachment[]) => void;
  onUploadMediaAssets: (files: FileList | File[] | null) => Promise<MediaAsset[]>;
  testIdPrefix: string;
}) {
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false);

  function addAsset(asset: MediaAsset) {
    onChange(appendUniqueTaskAttachment(attachments, taskAttachmentFromMediaAsset(asset)));
  }

  return (
    <div className="task-attachment-panel" data-testid={`${testIdPrefix}-panel`}>
      <div className="toolbar between">
        <strong>{label}</strong>
        <button className="secondary-button" data-testid={`${testIdPrefix}-open`} type="button" onClick={() => setMediaLibraryOpen(true)} disabled={disabled}>
          <Paperclip size={16} />
          添加附件
        </button>
      </div>
      <TaskAttachmentPreview
        attachments={attachments}
        mediaAssets={mediaAssets}
        onRemove={(attachmentId) => onChange(attachments.filter((attachment) => attachment.id !== attachmentId))}
      />
      {!attachments.length ? <div className="subtle">可添加压缩包、文档、图片、视频等附件。</div> : null}
      {mediaLibraryOpen ? (
        <MediaLibraryModal
          description="选择已有媒体文件，或拖拽上传压缩包、文档、图片、视频等附件。"
          disabled={disabled}
          mediaAssets={mediaAssets}
          onClose={() => setMediaLibraryOpen(false)}
          onSelect={(asset) => {
            addAsset(asset);
            setMediaLibraryOpen(false);
          }}
          onUploadMediaAssets={onUploadMediaAssets}
          selectFirstUploaded
          selectLabel="添加"
          testId={`${testIdPrefix}-media-library-modal`}
          title="添加附件"
        />
      ) : null}
    </div>
  );
}

function ActivityList({
  activities,
  emptyMessage,
  mediaAssets = [],
  pendingDeleteRequestsById,
  testIdPrefix,
  onDelete,
  renderMeta
}: {
  activities: Activity[];
  emptyMessage: string;
  mediaAssets?: MediaAsset[];
  pendingDeleteRequestsById?: Map<string, RecordChangeRequest>;
  testIdPrefix?: string;
  onDelete?: (activity: Activity) => void;
  renderMeta: (activity: Activity) => ReactNode;
}) {
  if (activities.length === 0) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  return (
    <div className="activity-list" style={{ marginTop: 12 }}>
      {activities.map((activity) => {
        const details = parseActivityDetails(activity.body);
        const body = details.text;
        const pendingDeleteRequest = pendingDeleteRequestsById?.get(activity.id);
        return (
          <div className="activity-item" data-testid={testIdPrefix ? `${testIdPrefix}-${activity.id}` : undefined} key={activity.id}>
            <div className="activity-meta">
              {renderMeta(activity)}
              {pendingDeleteRequest && <span className="danger-badge">删除待审核</span>}
            </div>
            <strong>{activity.title}</strong>
            {body && <div className="subtle">{body}</div>}
            <TaskAttachmentPreview attachments={details.attachments} mediaAssets={mediaAssets} />
            {onDelete ? (
              <div className="toolbar" style={{ marginTop: 10 }}>
                <button
                  className="secondary-button danger-button"
                  data-testid={testIdPrefix ? `${testIdPrefix}-delete-${activity.id}` : undefined}
                  type="button"
                  onClick={() => onDelete(activity)}
                >
                  {pendingDeleteRequest ? <RotateCcw size={16} /> : <Trash2 size={16} />}
                  {pendingDeleteRequest ? "取消删除申请" : "删除"}
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ViewConfigurator({
  activeView,
  allRecords,
  canManageViews,
  draft,
  fields,
  isPending,
  objectKey,
  onChange,
  onCreate,
  onDelete,
  onRecordsLoaded,
  onReset,
  onUpdate,
  users
}: {
  activeView?: SavedView;
  allRecords: CrmRecord[];
  canManageViews: boolean;
  draft: ViewDraft;
  fields: FieldDefinition[];
  isPending: boolean;
  objectKey: string;
  onChange: (draft: ViewDraft) => void;
  onCreate: () => void;
  onDelete: () => void;
  onRecordsLoaded: (records: CrmRecord[]) => void;
  onReset: () => void;
  onUpdate: () => void;
  users: User[];
}) {
  const fieldChoices = [{ key: "title", label: "名称" }, ...fields.map((field) => ({ key: field.key, label: field.label }))];
  fieldChoices.splice(1, 0, { key: "ownerId", label: "负责人" });
  const filterFieldDefinition = fields.find((field) => field.key === draft.filterField);
  if (objectKey === "deals") {
    fieldChoices.push({ key: "stageKey", label: "阶段" });
  }
  fieldChoices.push({ key: "updatedAt", label: "更新时间" });

  function patch(next: Partial<ViewDraft>) {
    onChange({ ...draft, ...next });
  }

  function toggleColumn(key: string) {
    const nextColumns = draft.columns.includes(key)
      ? draft.columns.filter((column) => column !== key)
      : [...draft.columns, key];
    patch({ columns: nextColumns.length > 0 ? nextColumns : ["title"] });
  }

  return (
    <section className="view-config">
      <div className="view-config-header">
        <div>
          <strong>视图配置</strong>
          <div className="subtle">筛选、排序和列配置会先应用到当前列表。</div>
        </div>
        <button className="secondary-button" type="button" onClick={onReset} disabled={isPending}>
          <RefreshCw className={isPending ? "spin-icon" : undefined} size={16} />
          重置
        </button>
      </div>

      <div className="form-grid">
        <label>
          <span className="subtle">视图名称</span>
          <input className="input" value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
        </label>
        <label>
          <span className="subtle">排序字段</span>
          <select className="select" value={draft.sortField} onChange={(event) => patch({ sortField: event.target.value })}>
            <option value="">不排序</option>
            {fieldChoices.map((field) => (
              <option key={`sort-${field.key}`} value={field.key}>
                {field.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="subtle">筛选字段</span>
          <select className="select" data-testid={`view-filter-field-${objectKey}`} value={draft.filterField} onChange={(event) => patch({ filterField: event.target.value, filterValue: "" })}>
            <option value="">不筛选</option>
            {fieldChoices.map((field) => (
              <option key={`filter-${field.key}`} value={field.key}>
                {field.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="subtle">筛选方式</span>
          <select className="select" value={draft.filterOperator} onChange={(event) => patch({ filterOperator: event.target.value as ViewDraft["filterOperator"] })}>
            <option value="contains">包含</option>
            <option value="equals">等于</option>
          </select>
        </label>
        {draft.filterField === "ownerId" ? (
          <div className="wide">
            <OwnerSelect
              allowEmpty
              disabled={false}
              testId={`view-filter-value-${objectKey}`}
              users={users}
              value={draft.filterValue}
              onChange={(nextValue) => patch({ filterValue: nextValue, filterOperator: "equals" })}
            />
          </div>
        ) : filterFieldDefinition?.type === "reference" ? (
          <div className="wide">
            <ReferenceFieldInput
              allRecords={allRecords}
              field={filterFieldDefinition}
              onChange={(nextValue) => patch({ filterValue: nextValue, filterOperator: "equals" })}
              onRecordsLoaded={onRecordsLoaded}
              testId={`view-filter-value-${objectKey}`}
              value={draft.filterValue}
            />
          </div>
        ) : (
          <label className="wide">
            <span className="subtle">筛选值</span>
            <input className="input" data-testid={`view-filter-value-${objectKey}`} value={draft.filterValue} onChange={(event) => patch({ filterValue: event.target.value })} />
          </label>
        )}
      </div>

      <div className="view-column-grid" aria-label="列配置">
        {fieldChoices
          .filter((field) => field.key !== "updatedAt")
          .map((field) => (
            <label className="settings-toggle" key={field.key}>
              <input type="checkbox" checked={draft.columns.includes(field.key)} onChange={() => toggleColumn(field.key)} />
              {field.label}
            </label>
          ))}
      </div>

      <div className="toolbar" style={{ marginTop: 12 }}>
        <label className="settings-toggle">
          <input type="checkbox" checked={draft.sortDirection === "desc"} onChange={(event) => patch({ sortDirection: event.target.checked ? "desc" : "asc" })} />
          降序
        </label>
        {canManageViews && (
          <label className="settings-toggle">
            <input type="checkbox" checked={draft.isDefault} onChange={(event) => patch({ isDefault: event.target.checked })} />
            设为默认
          </label>
        )}
      </div>

      {canManageViews ? (
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="primary-button" type="button" onClick={onCreate} disabled={isPending || !draft.name.trim()}>
            <Save size={16} />
            保存为新视图
          </button>
          <button className="secondary-button" type="button" onClick={onUpdate} disabled={isPending || !activeView || !draft.name.trim()}>
            <Save size={16} />
            覆盖当前视图
          </button>
          <button className="danger-button" type="button" onClick={onDelete} disabled={isPending || !activeView}>
            <Trash2 size={16} />
            删除视图
          </button>
        </div>
      ) : (
        <div className="subtle" style={{ marginTop: 12 }}>
          当前账号可以临时调整列表，但没有 crm.admin 权限，不能保存全局视图。
        </div>
      )}
    </section>
  );
}

function ImportJobList({
  jobs,
  users,
  disabled,
  selectedJobId,
  onViewDetails,
  onCancel,
  onRetry,
  onRerun
}: {
  jobs: CsvImportJob[];
  users: User[];
  disabled: boolean;
  selectedJobId?: string;
  onViewDetails: (job: CsvImportJob) => void;
  onCancel: (job: CsvImportJob) => void;
  onRetry: (job: CsvImportJob) => void;
  onRerun: (job: CsvImportJob) => void;
}) {
  if (jobs.length === 0) {
    return null;
  }

  return (
    <div className="activity-list" style={{ marginTop: 12 }}>
      <div className="activity-meta">最近导入任务</div>
      {jobs.map((job) => (
        <div className="activity-item" key={job.id}>
          <div className="stage-header">
            <strong>导入{formatImportJobStatus(job.status)}</strong>
            <span className={job.status === "failed" ? "danger-badge" : "badge"}>{formatImportJobStatus(job.status)}</span>
          </div>
          <div className="subtle">
            已创建 {job.createdCount} 条 · 已更新 {job.result?.updated?.length ?? 0} 条 · 失败 {job.errorCount} 条 · 共 {job.totalRows} 行 · {formatImportStrategy(job.strategy)}
          </div>
          <div className="subtle">
            {formatDate(job.createdAt)} · {users.find((user) => user.id === job.requestedById)?.name ?? "系统"}
          </div>
          {job.errorMessage ? <div className="subtle">{job.errorMessage}</div> : null}
          {job.result?.errors[0] ? <div className="subtle">{job.result.errors[0]}</div> : null}
          <ImportJobDetails job={job} />
          <div className="toolbar compact-toolbar" style={{ marginTop: 10 }}>
            <button className="secondary-button" data-testid={`import-job-details-${job.id}`} type="button" onClick={() => onViewDetails(job)} disabled={disabled || selectedJobId === job.id}>
              <LayoutList size={15} />
              {selectedJobId === job.id ? "已打开" : "查看详情"}
            </button>
            {job.status === "queued" ? (
              <button className="secondary-button" type="button" onClick={() => onCancel(job)} disabled={disabled}>
                <XCircle size={15} />
                取消
              </button>
            ) : null}
            {job.status === "failed" || job.status === "cancelled" ? (
              <button className="secondary-button" type="button" onClick={() => onRetry(job)} disabled={disabled}>
                <RotateCcw size={15} />
                重试
              </button>
            ) : null}
            {job.status === "completed" ? (
              <button className="secondary-button" type="button" onClick={() => onRerun(job)} disabled={disabled}>
                <RefreshCw className={disabled ? "spin-icon" : undefined} size={15} />
                再次运行
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function ImportJobDetails({ job, defaultOpen = false }: { job: CsvImportJob; defaultOpen?: boolean }) {
  const details = buildImportJobObservability(job);

  if (!job.preview && !job.result && details.mappingEntries.length === 0 && !details.presetName) {
    return null;
  }

  return (
    <details className="activity-item" open={defaultOpen} style={{ marginTop: 10 }}>
      <summary>导入详情</summary>
      {details.presetName ? <div className="subtle" style={{ marginTop: 8 }}>导入预设：{details.presetName}</div> : null}
      {details.headers.length > 0 ? <div className="subtle" style={{ marginTop: 8 }}>源表头：{details.headers.join("、")}</div> : null}
      {details.mappingEntries.length > 0 ? (
        <div className="subtle">字段映射：{details.mappingEntries.map((entry) => `${entry.header} -> ${entry.target}`).join("、")}</div>
      ) : null}
      {details.unmappedHeaders.length > 0 ? <div className="subtle">未映射列：{details.unmappedHeaders.join("、")}</div> : null}
      {details.issueBuckets.length > 0 ? (
        <div className="subtle">失败分布：{details.issueBuckets.map((bucket) => `${formatImportIssueBucket(bucket.label)} ${bucket.count}`).join("、")}</div>
      ) : null}
      <div className="metric-grid" style={{ marginTop: 10 }}>
        <div className="metric-card">
          <div className="subtle">创建样例</div>
          <strong>{details.createdSamples.length}</strong>
        </div>
        <div className="metric-card">
          <div className="subtle">更新样例</div>
          <strong>{details.updatedSamples.length}</strong>
        </div>
        <div className="metric-card">
          <div className="subtle">冲突</div>
          <strong>{details.conflictSamples.length}</strong>
        </div>
        <div className="metric-card">
          <div className="subtle">错误</div>
          <strong>{details.errorSamples.length}</strong>
        </div>
      </div>
      {details.createdSamples.slice(0, 3).map((record) => (
        <div className="subtle" key={`created-${record.id}`}>创建：{record.title}</div>
      ))}
      {details.updatedSamples.slice(0, 3).map((record) => (
        <div className="subtle" key={`updated-${record.id}`}>更新：{record.title}</div>
      ))}
      {details.conflictSamples.slice(0, 3).map((conflict) => (
        <div className="subtle" key={`conflict-${conflict.rowNumber}-${conflict.fieldKey}`}>
          冲突：第 {conflict.rowNumber} 行 {conflict.fieldLabel} 匹配 {conflict.existingRecordTitle}
        </div>
      ))}
      {details.errorSamples.slice(0, 3).map((item) => (
        <div className="subtle" key={item}>错误：{item}</div>
      ))}
      {details.errorSamples.length + details.conflictSamples.length > 0 ? (
        <a className="secondary-button" href={`/api/imports/jobs/${job.id}/issues`} download={`import-${job.id}-issues.csv`} style={{ marginTop: 10 }}>
          <Download size={15} />
          下载问题行 CSV
        </a>
      ) : null}
    </details>
  );
}

function CsvPreviewSummary({ preview, strategy }: { preview: CsvImportPreview; strategy: CsvImportStrategy }) {
  const stats = getCsvImportPreviewStats(preview, strategy);
  return (
    <div className="activity-list" style={{ marginTop: 12 }}>
      <CsvPreviewStats stats={stats} />
      <div className="activity-item">
        <div className="activity-meta">共 {preview.totalRows} 行</div>
        <strong>可导入 {preview.creatableRows} 行</strong>
        <div className="subtle">已识别字段: {preview.mappedFields.map((field) => field.label).join("、") || "无"}</div>
        {preview.unmappedHeaders.length > 0 && <div className="subtle">未映射列: {preview.unmappedHeaders.join("、")}</div>}
      </div>
      {preview.conflictRows > 0 && (
        <div className="activity-item">
          <div className="activity-meta">Conflicts</div>
          <div className="subtle">{preview.conflictRows} rows match existing records and will be skipped.</div>
        </div>
      )}
      {preview.errors.length > 0 && (
        <div className="activity-item">
          <div className="activity-meta">行级错误</div>
          {preview.errors.slice(0, 4).map((item) => (
            <div className="subtle" key={item}>
              {item}
            </div>
          ))}
          {preview.errors.length > 4 && <div className="subtle">还有 {preview.errors.length - 4} 条错误未显示</div>}
        </div>
      )}
    </div>
  );
}

function CsvMappingEditor({
  headers,
  fields,
  mapping,
  onChange
}: {
  headers: string[];
  fields: FieldDefinition[];
  mapping: CsvImportMapping;
  onChange: (mapping: CsvImportMapping) => void;
}) {
  const knownHeaders = new Set(["title", "name", "rowNumber", "status", "issues", ...fields.map((field) => field.key)]);
  const candidates = headers.filter((header) => !knownHeaders.has(header));
  if (candidates.length === 0) {
    return null;
  }

  const updateMapping = (header: string, target: string) => {
    const next = { ...mapping };
    if (target) {
      next[header] = target;
    } else {
      delete next[header];
    }
    onChange(next);
  };

  return (
    <div className="activity-item" style={{ marginTop: 12 }}>
      <div className="activity-meta">CSV 字段映射</div>
      <div className="settings-grid">
        {candidates.map((header) => (
          <label key={header}>
            <span className="subtle">{header}</span>
            <select className="select" data-testid={`csv-mapping-${header}`} value={mapping[header] ?? ""} onChange={(event) => updateMapping(header, event.target.value)}>
              <option value="">不导入</option>
              <option value="title">记录标题</option>
              {fields.map((field) => (
                <option key={field.key} value={field.key}>
                  {field.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}

function CsvPreviewDetailed({ preview, strategy }: { preview: CsvImportPreview; strategy: CsvImportStrategy }) {
  const stats = getCsvImportPreviewStats(preview, strategy);
  return (
    <div className="activity-list" style={{ marginTop: 12 }}>
      <CsvPreviewStats stats={stats} />
      <div className="activity-item">
        <div className="activity-meta">CSV 预览 · 共 {preview.totalRows} 行</div>
        <strong>
          可导入 {preview.creatableRows} 行 · 错误 {preview.errorRows} 行
        </strong>
        <div className="subtle">已映射字段：{preview.mappedFields.map((field) => field.label).join("、") || "无"}</div>
        {preview.unmappedHeaders.length > 0 && <div className="subtle">未映射列：{preview.unmappedHeaders.join("、")}</div>}
      </div>

      <div className="csv-preview-grid">
        <div className="csv-preview-header">
          <span>行号</span>
          <span>状态</span>
          <span>名称</span>
          <span>结果</span>
        </div>
        {preview.rows.slice(0, 8).map((row) => (
          <div className={`csv-preview-row ${row.status !== "ready" ? "csv-preview-row-error" : ""}`} key={row.rowNumber}>
            <span>{row.rowNumber}</span>
            <span className={row.status === "ready" ? "badge" : "danger-badge"}>{formatCsvRowStatus(row.status)}</span>
            <strong>{row.title || "未命名"}</strong>
            <span className="subtle">{formatCsvRowResult(row)}</span>
          </div>
        ))}
        {preview.rows.length > 8 && <div className="subtle csv-preview-more">仅显示前 8 行，还有 {preview.rows.length - 8} 行未显示。</div>}
      </div>

      {preview.errors.length > 0 && (
        <div className="activity-item">
          <div className="activity-meta">行级错误</div>
          {preview.errors.slice(0, 4).map((item) => (
            <div className="subtle" key={item}>
              {item}
            </div>
          ))}
          {preview.errors.length > 4 && <div className="subtle">还有 {preview.errors.length - 4} 条错误未显示</div>}
        </div>
      )}
    </div>
  );
}

function formatCsvRowStatus(status: CsvImportPreview["rows"][number]["status"]): string {
  if (status === "ready") return "可导入";
  if (status === "conflict") return "冲突";
  return "错误";
}

type CsvImportPreviewStats = {
  createRows: number;
  updateRows: number;
  skipRows: number;
  errorRows: number;
  aborted: boolean;
};

function getCsvImportPreviewStats(preview: CsvImportPreview, strategy: CsvImportStrategy): CsvImportPreviewStats {
  const aborted = strategy === "all-or-nothing" && preview.errorRows + preview.conflictRows > 0;
  return {
    createRows: aborted ? 0 : preview.creatableRows,
    updateRows: aborted ? 0 : strategy === "update-existing" ? preview.conflictRows : 0,
    skipRows: aborted ? preview.totalRows : strategy === "update-existing" ? preview.errorRows : preview.errorRows + preview.conflictRows,
    errorRows: preview.errorRows,
    aborted
  };
}

function CsvPreviewStats({ stats }: { stats: CsvImportPreviewStats }) {
  return (
    <div className="metric-grid" style={{ marginTop: 10 }}>
      <div className="metric-card">
        <div className="subtle">将创建</div>
        <strong>{stats.createRows}</strong>
      </div>
      <div className="metric-card">
        <div className="subtle">将更新</div>
        <strong>{stats.updateRows}</strong>
      </div>
      <div className="metric-card">
        <div className="subtle">将跳过</div>
        <strong>{stats.skipRows}</strong>
      </div>
      <div className="metric-card">
        <div className="subtle">错误</div>
        <strong>{stats.errorRows}</strong>
      </div>
      {stats.aborted ? <div className="subtle">当前策略会中止整批导入，请先处理错误或冲突。</div> : null}
    </div>
  );
}

function cleanImportMapping(mapping: CsvImportMapping): CsvImportMapping | undefined {
  const cleaned = Object.fromEntries(
    Object.entries(mapping)
      .map(([header, target]) => [header.trim(), target.trim()])
      .filter(([header, target]) => header && target)
  );
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function formatCsvRowResult(row: CsvImportPreview["rows"][number]): string {
  if (row.errors.length > 0) {
    return row.errors.join("; ");
  }
  if (row.conflicts.length > 0) {
    return row.conflicts
      .map((conflict) => `${conflict.fieldLabel} 匹配已有记录 ${conflict.existingRecordTitle}`)
      .join("; ");
  }
  return formatCsvRowValues(row.values);
}

function formatCsvRowValues(values: Record<string, string>): string {
  return Object.entries(values)
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${value || "-"}`)
    .join(" · ");
}

function formatImportJobStatus(status: CsvImportJob["status"]): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "processing":
      return "处理中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
  }
}

function formatImportStrategy(strategy: CsvImportStrategy): string {
  if (strategy === "all-or-nothing") return "全部成功才导入";
  if (strategy === "update-existing") return "更新已有记录";
  return "跳过错误行";
}

function formatImportIssueBucket(label: string): string {
  if (label === "validation") return "校验错误";
  if (label === "conflict") return "重复冲突";
  if (label === "job_error") return "任务错误";
  if (label === "aborted") return "已中止";
  return label;
}

function formatActivityType(type: Activity["type"]): string {
  switch (type) {
    case "note":
      return "备注";
    case "call":
      return "电话";
    case "meeting":
      return "会议";
    case "task":
      return "任务";
    case "email":
      return "邮件";
    case "stage_change":
      return "阶段变更";
  }
  return type;
}

function AiAssistant({
  record,
  fields,
  activities,
  question,
  setQuestion,
  allRecords,
  users,
  onOpenRecord
}: {
  record: CrmRecord;
  fields: FieldDefinition[];
  activities: Activity[];
  question: string;
  setQuestion: (value: string) => void;
  allRecords: CrmRecord[];
  users: User[];
  onOpenRecord: (record: CrmRecord) => void;
}) {
  const summary = fields.map((field) => `${field.label}: ${displayValue(field, record.data[field.key], allRecords, users)}`).join("；");
  const [summaryResult, setSummaryResult] = useState<AiResponse | null>(null);
  const [nextActionsResult, setNextActionsResult] = useState<AiResponse | null>(null);
  const [recordAiError, setRecordAiError] = useState<string | null>(null);
  const [isRecordAiPending, setIsRecordAiPending] = useState(false);
  const [queryResult, setQueryResult] = useState<AiResponse | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [isQueryPending, startQueryTransition] = useTransition();

  useEffect(() => {
    setSummaryResult(null);
    setNextActionsResult(null);
    setRecordAiError(null);
    setQueryResult(null);
    setQueryError(null);
  }, [record.id]);

  async function runRecordAi(kind: "summary" | "next-actions") {
    setRecordAiError(null);
    setIsRecordAiPending(true);
    try {
      const result = await fetchJson<AiResponse>(kind === "summary" ? "/api/ai/summarize-record" : "/api/ai/suggest-next-actions", {
        method: "POST",
        body: { objectKey: record.objectKey, recordId: record.id }
      });
      if (kind === "summary") {
        setSummaryResult(result);
      } else {
        setNextActionsResult(result);
      }
    } catch (error) {
      setRecordAiError(error instanceof Error ? error.message : "AI 助手请求失败");
    } finally {
      setIsRecordAiPending(false);
    }
  }

  async function openAiSource(source: AiSource) {
    if (!source.recordId) {
      return;
    }

    const sourceRecord = allRecords.find((candidate) => candidate.id === source.recordId);
    if (sourceRecord) {
      onOpenRecord(sourceRecord);
      return;
    }

    if (!source.objectKey) {
      setRecordAiError("AI 来源缺少对象信息，无法打开记录");
      return;
    }

    try {
      const record = await fetchJson<CrmRecord>(`/api/records/${source.objectKey}/${source.recordId}`, { method: "GET" });
      onOpenRecord(record);
    } catch (error) {
      setRecordAiError(error instanceof Error ? error.message : "无法打开 AI 来源记录");
    }
  }

  function renderSources(sources: AiSource[]) {
    if (sources.length === 0) {
      return null;
    }

    return (
      <div className="toolbar" style={{ marginTop: 8 }}>
        {sources.map((source) => {
          return source.recordId ? (
            <button
              className="secondary-button"
              data-testid={`ai-source-record-${source.recordId}`}
              type="button"
              key={`${source.objectKey ?? "record"}-${source.recordId}`}
              onClick={() => void openAiSource(source)}
            >
              {source.label}
            </button>
          ) : (
            <span className="badge" key={`${source.activityId ?? source.label}`}>{source.label}</span>
          );
        })}
      </div>
    );
  }

  function runQuery() {
    setQueryResult(null);
    setQueryError(null);
    startQueryTransition(async () => {
      try {
        const result = await fetchJson<AiResponse>("/api/ai/query", {
          method: "POST",
          body: { question, objectKey: record.objectKey }
        });
        setQueryResult(result);
      } catch (error) {
        setQueryError(error instanceof Error ? error.message : "AI 查询失败");
      }
    });
  }

  return (
    <section className="ai-box">
      <div className="activity-meta">
        <Bot size={16} />
        AI 助手层
      </div>
      <div className="activity-item">
        <strong>记录摘要</strong>
        <div data-testid="ai-summary-result">{summaryResult?.text ?? `${summary || "暂无可摘要字段"}。最近活动：${activities[0]?.title ?? "暂无活动"}。`}</div>
        {summaryResult ? renderSources(summaryResult.sources) : null}
        <button
          className="secondary-button"
          data-testid="ai-generate-summary"
          type="button"
          onClick={() => runRecordAi("summary")}
          disabled={isRecordAiPending}
          style={{ marginTop: 10 }}
        >
          <Bot size={16} />
          生成 AI 摘要
        </button>
      </div>
      <div className="activity-item">
        <strong>下一步建议</strong>
        <div data-testid="ai-next-actions-result">
          {nextActionsResult?.text ??
            (activities.some((activity) => activity.type === "task" && !activity.completedAt)
              ? "优先完成已有待办，并记录客户反馈。"
              : "补一个带截止日期的跟进任务，并明确下一次沟通目标。")}
        </div>
        {nextActionsResult ? renderSources(nextActionsResult.sources) : null}
        <button
          className="secondary-button"
          data-testid="ai-generate-next-actions"
          type="button"
          onClick={() => runRecordAi("next-actions")}
          disabled={isRecordAiPending}
          style={{ marginTop: 10 }}
        >
          <Bot size={16} />
          生成下一步建议
        </button>
      </div>
      {recordAiError && <div className="subtle">{recordAiError}</div>}
      <label>
        <span className="subtle">自然语言查询</span>
        <input className="input" data-testid="ai-query-input" value={question} onChange={(event) => setQuestion(event.target.value)} />
      </label>
      <button className="secondary-button" data-testid="ai-query-submit" type="button" onClick={runQuery} disabled={isQueryPending || !question.trim()}>
        <Bot size={16} />
        查询当前对象
      </button>
      {queryError && <div className="subtle">{queryError}</div>}
      {queryResult && (
        <div className="activity-item">
          <strong>{queryResult.text}</strong>
          {renderSources(queryResult.sources)}
        </div>
      )}
      <div className="subtle">AI 不会直接修改记录，只提供基于 CRM 数据的只读建议和查询入口。</div>
    </section>
  );
}

function TalkAboutThisPanel({
  target,
  disabled,
  onKnowledgeCreated,
  onOpenRecord,
  onRequestConfirm,
  onShowToast
}: {
  target: TalkTarget;
  disabled: boolean;
  onKnowledgeCreated: (article: KnowledgeArticle) => void;
  onOpenRecord?: (source: { objectKey: string; recordId: string }) => void;
  onRequestConfirm: (options: ConfirmDialogState) => Promise<boolean>;
  onShowToast: (toast: ToastState) => void;
}) {
  const [messages, setMessages] = useState<TalkMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [sources, setSources] = useState<TalkResponse["sources"]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [savingMessageIndex, setSavingMessageIndex] = useState<number | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState("");
  const [isSuggesting, setIsSuggesting] = useState(false);
  const targetKey = target.type === "record" ? `${target.objectKey}:${target.recordId}` : `email_thread:${target.threadId}`;
  const targetType = target.type;
  const targetObjectKey = target.type === "record" ? target.objectKey : "";
  const targetRecordId = target.type === "record" ? target.recordId : "";
  const targetThreadId = target.type === "email_thread" ? target.threadId : "";
  const talkMessagesRequestUrl = useMemo(
    () => (targetType === "record" ? talkMessagesUrl({ type: "record", objectKey: targetObjectKey, recordId: targetRecordId, label: target.label }) : talkMessagesUrl({ type: "email_thread", threadId: targetThreadId, label: target.label })),
    [targetType, targetObjectKey, targetRecordId, targetThreadId, target.label]
  );
  const onShowToastRef = useRef(onShowToast);
  const shouldSuggest = isInputFocused || question.trim().length > 0;
  const localSuggestion = shouldSuggest ? buildTalkInputSuggestion(target, question, messages) : "";
  const suggestion = normalizeTalkInputSuggestion(question, aiSuggestion || localSuggestion);

  useEffect(() => {
    onShowToastRef.current = onShowToast;
  }, [onShowToast]);

  useEffect(() => {
    setMessages([]);
    setQuestion("");
    setSources([]);
    setAiSuggestion("");
    setIsInputFocused(false);
    setIsExpanded(false);
  }, [targetKey]);

  useEffect(() => {
    if (!isExpanded) {
      return;
    }

    const controller = new AbortController();
    setIsLoadingMessages(true);
    fetchJson<TalkMessage[]>(talkMessagesRequestUrl, { method: "GET", signal: controller.signal })
      .then((loadedMessages) => {
        if (!controller.signal.aborted) {
          setMessages(loadedMessages);
          setSources(loadedMessages.slice().reverse().find((message) => message.sources?.length)?.sources ?? []);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          onShowToastRef.current({ intent: "error", message: error instanceof Error ? error.message : "加载讨论记录失败" });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingMessages(false);
        }
      });

    return () => controller.abort();
  }, [isExpanded, talkMessagesRequestUrl]);

  useEffect(() => {
    setAiSuggestion("");
    if (disabled || !shouldSuggest) {
      setIsSuggesting(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSuggesting(true);
      try {
        const result = await fetchJson<TalkSuggestionResponse>("/api/ai/talk", {
          method: "POST",
          signal: controller.signal,
          body: {
            target:
              targetType === "record"
                ? { type: "record", objectKey: targetObjectKey, recordId: targetRecordId }
                : { type: "email_thread", threadId: targetThreadId },
            question,
            history: talkHistoryPayload(messages.slice(-8)),
            mode: "suggestion"
          }
        });
        if (!controller.signal.aborted) {
          setAiSuggestion(result.completion ?? "");
        }
      } catch {
        if (!controller.signal.aborted) {
          setAiSuggestion("");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSuggesting(false);
        }
      }
    }, question.trim() ? 400 : 650);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [disabled, shouldSuggest, targetType, targetObjectKey, targetRecordId, targetThreadId, target.label, question, messages]);

  async function persistTalkMessage(input: Pick<TalkMessage, "role" | "content"> & Partial<Pick<TalkMessage, "sources" | "knowledgeArticleId">>): Promise<TalkMessage> {
    return fetchJson<TalkMessage>("/api/ai/talk/messages", {
      method: "POST",
      body: {
        target: talkApiTarget(target),
        role: input.role,
        content: input.content,
        sources: input.sources,
        knowledgeArticleId: input.knowledgeArticleId
      }
    });
  }

  async function sendMessage() {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      return;
    }

    const previousMessages = messages;
    const pendingUserMessage: TalkMessage = { id: `pending-user-${Date.now()}`, role: "user", content: trimmedQuestion };
    const nextMessages: TalkMessage[] = [...messages, pendingUserMessage];
    setMessages(nextMessages);
    setQuestion("");
    setIsSending(true);
    try {
      const userMessage = await persistTalkMessage({ role: "user", content: trimmedQuestion });
      setMessages((current) => current.map((message) => (message.id === pendingUserMessage.id ? userMessage : message)));
      const result = await fetchJson<TalkResponse>("/api/ai/talk", {
        method: "POST",
        body: {
          target: talkApiTarget(target),
          question: trimmedQuestion,
          history: talkHistoryPayload(previousMessages.slice(-12))
        }
      });
      const assistantMessage = await persistTalkMessage({ role: "assistant", content: result.text, sources: result.sources ?? [] });
      setMessages((current) => [...current.filter((message) => message.id !== pendingUserMessage.id && message.id !== userMessage.id), userMessage, assistantMessage]);
      setSources(result.sources ?? []);
    } catch (error) {
      setMessages(previousMessages);
      setQuestion(trimmedQuestion);
      onShowToast({ intent: "error", message: error instanceof Error ? error.message : "讨论请求失败" });
    } finally {
      setIsSending(false);
    }
  }

  async function saveMessageToKnowledge(message: TalkMessage, index: number) {
    if (!message.content.trim()) {
      return;
    }

    setSavingMessageIndex(index);
    try {
      const article = await fetchJson<KnowledgeArticle>("/api/knowledge/articles", {
        method: "POST",
        body: {
          title: trimForLabel(`Talk: ${target.label} · ${message.role === "assistant" ? "AI" : "User"}`, 80),
          body: buildTalkMessageKnowledgeBody(target, message, message.sources ?? sources),
          tags: buildTalkKnowledgeTags(target),
          active: true
        }
      });
      const updatedMessage = message.id
        ? await fetchJson<TalkMessage>(`/api/ai/talk/messages/${message.id}`, {
            method: "PATCH",
            body: { knowledgeArticleId: article.id }
          })
        : { ...message, knowledgeArticleId: article.id };
      setMessages((current) => current.map((candidate, candidateIndex) => (candidate.id === message.id || candidateIndex === index ? updatedMessage : candidate)));
      onKnowledgeCreated(article);
      onShowToast({ intent: "success", message: "这条消息已关联到 RAG 知识库" });
    } catch (error) {
      onShowToast({ intent: "error", message: error instanceof Error ? error.message : "保存到知识库失败" });
    } finally {
      setSavingMessageIndex(null);
    }
  }

  async function deleteTalkMessage(message: TalkMessage, index: number) {
    const confirmed = await onRequestConfirm({
      title: "删除讨论消息",
      message: "确认删除这条 Talk about this 消息？此操作不会删除已保存的 RAG 知识。",
      confirmLabel: "删除",
      danger: true
    });
    if (!confirmed) {
      return;
    }

    setDeletingMessageId(message.id ?? `${index}`);
    try {
      if (message.id) {
        await fetchJson<{ ok: true }>(`/api/ai/talk/messages/${message.id}`, { method: "DELETE" });
      }
      setMessages((current) => current.filter((candidate, candidateIndex) => !(candidate.id === message.id || (!message.id && candidateIndex === index))));
      onShowToast({ intent: "success", message: "讨论消息已删除" });
    } catch (error) {
      onShowToast({ intent: "error", message: error instanceof Error ? error.message : "删除讨论消息失败" });
    } finally {
      setDeletingMessageId(null);
    }
  }

  return (
    <section className="ai-box talk-panel" data-testid="talk-about-this">
      <button className="talk-panel-header" data-testid="talk-about-this-toggle" type="button" onClick={() => setIsExpanded((current) => !current)}>
        {isExpanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        <span>
          <Bot size={16} />
          Talk about this
        </span>
        {messages.length ? <span className="badge">{messages.length} 条记录</span> : null}
      </button>
      <div className="talk-target">
        <strong>{target.label}</strong>
        <span className="badge">{target.type === "record" ? target.objectKey : "email thread"}</span>
      </div>
      {!isExpanded ? <div className="subtle">已折叠。展开后可查看历史讨论、继续提问或将单条消息保存为 RAG 知识。</div> : null}
      {isExpanded ? (
        <>
      <div className="talk-messages" data-testid="talk-about-this-messages">
        {isLoadingMessages ? (
          <div className="empty-state">
            <RefreshCw className="spin-icon" size={16} />
            正在加载讨论记录
          </div>
        ) : messages.length ? (
          messages.map((message, index) => (
            <div className={`talk-message ${message.role === "assistant" ? "assistant" : "user"}`} key={message.id ?? `${message.role}-${index}`}>
              <span>{message.role === "assistant" ? "AI" : "你"}</span>
              <div>{message.content}</div>
              <div className="talk-message-meta">
                {message.knowledgeArticleId ? <span className="badge">已加入 RAG 知识</span> : null}
                {message.createdAt ? <span className="subtle">{formatDate(message.createdAt)}</span> : null}
              </div>
              <button
                className="secondary-button talk-message-rag-action"
                data-testid={`talk-message-save-knowledge-${index}`}
                type="button"
                onClick={() => void saveMessageToKnowledge(message, index)}
                disabled={disabled || savingMessageIndex === index || Boolean(message.knowledgeArticleId)}
              >
                <Save className={savingMessageIndex === index ? "spin-icon" : undefined} size={14} />
                {message.knowledgeArticleId ? "已关联 RAG" : "关联到 RAG 知识"}
              </button>
              <button
                className="secondary-button danger-button talk-message-delete-action"
                data-testid={`talk-message-delete-${index}`}
                type="button"
                onClick={() => void deleteTalkMessage(message, index)}
                disabled={disabled || deletingMessageId === (message.id ?? `${index}`)}
              >
                <Trash2 className={deletingMessageId === (message.id ?? `${index}`) ? "spin-icon" : undefined} size={14} />
                删除
              </button>
            </div>
          ))
        ) : (
          <div className="empty-state">可以围绕这条记录讨论背景、风险、下一步、邮件回复或报价策略。</div>
        )}
      </div>
      {sources.length ? (
        <div className="toolbar compact-toolbar">
          {sources.map((source) =>
            source.objectKey && source.recordId ? (
              <button className="secondary-button" key={`${source.objectKey}-${source.recordId}`} type="button" onClick={() => onOpenRecord?.({ objectKey: source.objectKey!, recordId: source.recordId! })}>
                <Link size={14} />
                {source.label}
              </button>
            ) : (
              <span className="badge" key={`${source.messageId ?? source.knowledgeArticleId ?? source.label}`}>{source.label}</span>
            )
          )}
        </div>
      ) : null}
      <label>
        <span className="subtle">输入要讨论的问题</span>
        <div className="talk-input-wrap">
          <textarea
            className="textarea talk-input"
            data-testid="talk-about-this-input"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            onKeyDown={(event) => {
              if (event.key === "Tab" && suggestion) {
                event.preventDefault();
                setQuestion(applyTalkInputSuggestion(question, suggestion));
                return;
              }
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="例如：这个客户下一步应该怎么跟进？这封邮件是否值得回复？"
          />
          {suggestion ? (
            <div className="talk-suggestion" data-testid="talk-about-this-suggestion">
              <span>{suggestion}</span>
              <kbd>{isSuggesting ? "AI..." : "Tab"}</kbd>
            </div>
          ) : null}
        </div>
      </label>
      <div className="toolbar">
        <button className="secondary-button" data-testid="talk-about-this-send" type="button" onClick={() => void sendMessage()} disabled={disabled || isSending || !question.trim()}>
          <Bot className={isSending ? "spin-icon" : undefined} size={16} />
          发送
        </button>
      </div>
      <div className="subtle">仅生成讨论建议，不会直接修改 CRM 数据。将鼠标悬停到指定消息上，可把单条消息保存为 RAG 知识。</div>
        </>
      ) : null}
    </section>
  );
}

function MediaAssetPreview({ asset }: { asset: MediaAsset }) {
  if (isImageMediaAsset(asset)) {
    return <img alt={asset.name} src={mediaAssetDataUrl(asset)} />;
  }

  return (
    <div className="media-file-preview">
      <Paperclip size={22} />
      <span>{mediaAssetExtension(asset.name) || asset.contentType}</span>
    </div>
  );
}

function MediaLibraryModal({
  accept,
  canSelectAsset,
  description,
  disabled,
  mediaAssets,
  onClose,
  onDeleteMediaAsset,
  onSelect,
  onUpdateMediaAsset,
  onUploadMediaAssets,
  selectFirstUploaded = false,
  selectLabel = "选择",
  testId,
  title
}: {
  accept?: string;
  canSelectAsset?: (asset: MediaAsset) => boolean;
  description: string;
  disabled?: boolean;
  mediaAssets: MediaAsset[];
  onClose: () => void;
  onDeleteMediaAsset?: (asset: MediaAsset) => void;
  onSelect: (asset: MediaAsset) => void;
  onUpdateMediaAsset?: (assetId: string, patch: Partial<Pick<MediaAsset, "name" | "contentType" | "size" | "contentBase64">>) => void;
  onUploadMediaAssets: (files: FileList | File[] | null) => Promise<MediaAsset[]>;
  selectFirstUploaded?: boolean;
  selectLabel?: string;
  testId: string;
  title: string;
}) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const editingAsset = mediaAssets.find((asset) => asset.id === editingAssetId);
  const visibleMediaAssets = canSelectAsset ? mediaAssets.filter(canSelectAsset) : mediaAssets;

  async function uploadFiles(files: FileList | File[] | null) {
    const uploaded = await onUploadMediaAssets(files);
    const selectableUploaded = canSelectAsset ? uploaded.find(canSelectAsset) : uploaded[0];
    if (selectFirstUploaded && selectableUploaded) {
      onSelect(selectableUploaded);
    }
  }

  async function replaceEditingAsset(files: FileList | null) {
    const file = files?.[0];
    if (!editingAsset || !file || !onUpdateMediaAsset) {
      return;
    }
    if (file.size > MAX_EMAIL_ATTACHMENT_BYTES) {
      return;
    }
    onUpdateMediaAsset(editingAsset.id, {
      name: nameDraft.trim() || file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
      contentBase64: await readFileAsBase64(file)
    });
    setEditingAssetId("");
    setNameDraft("");
  }

  function saveEditingAssetName(asset: MediaAsset) {
    const nextName = nameDraft.trim();
    if (!nextName || !onUpdateMediaAsset) {
      return;
    }
    onUpdateMediaAsset(asset.id, { name: nextName });
    setEditingAssetId("");
    setNameDraft("");
  }

  return (
    <div className="modal-backdrop" data-testid={testId} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-panel media-library-modal">
        <div className="email-pane-header compact">
          <div>
            <h2 className="page-title" style={{ fontSize: 18 }}>{title}</h2>
            <p className="subtle">{description}</p>
          </div>
          <button className="icon-button" aria-label="关闭媒体库" type="button" onClick={onClose}>
            <XCircle size={16} />
          </button>
        </div>
        <div
          className={`email-attachment-dropzone ${dragActive ? "active" : ""}`}
          data-testid={`${testId}-dropzone`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            void uploadFiles(event.dataTransfer.files);
          }}
        >
          <Upload size={24} />
          <strong>拖拽文件到这里</strong>
          <span className="subtle">或从本地选择文件，上传后可复用于产品、联系人、公司、邮件和活动附件。</span>
          <button className="secondary-button" type="button" onClick={() => uploadInputRef.current?.click()} disabled={disabled}>
            <Upload size={16} />
            上传文件
          </button>
          <input
            ref={uploadInputRef}
            hidden
            accept={accept}
            multiple
            type="file"
            onChange={(event) => {
              void uploadFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <input
            ref={replaceInputRef}
            hidden
            accept={accept}
            type="file"
            onChange={(event) => {
              void replaceEditingAsset(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
        {visibleMediaAssets.length ? (
          <div className="media-library-grid">
            {visibleMediaAssets.map((asset) => (
              <div className="media-library-card" key={asset.id}>
                <button className="media-library-select" type="button" onClick={() => onSelect(asset)}>
                  <MediaAssetPreview asset={asset} />
                </button>
                {editingAssetId === asset.id ? (
                  <div className="media-library-edit">
                    <input className="input" data-testid={`media-asset-name-${asset.id}`} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} />
                    <div className="toolbar compact-toolbar">
                      <button className="secondary-button" type="button" onClick={() => saveEditingAssetName(asset)} disabled={disabled || !nameDraft.trim() || !onUpdateMediaAsset}>
                        <Save size={14} />
                        保存
                      </button>
                      <button className="secondary-button" type="button" onClick={() => replaceInputRef.current?.click()} disabled={disabled || !onUpdateMediaAsset}>
                        <Upload size={14} />
                        替换
                      </button>
                      <button className="secondary-button" type="button" onClick={() => setEditingAssetId("")}>
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="media-library-card-footer">
                    <span title={asset.name}>{asset.name}</span>
                    <div className="toolbar compact-toolbar">
                      <button className="secondary-button" type="button" onClick={() => onSelect(asset)}>
                        {selectLabel}
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`编辑 ${asset.name}`}
                        data-testid={`media-asset-edit-${asset.id}`}
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setEditingAssetId(asset.id);
                          setNameDraft(asset.name);
                        }}
                        disabled={disabled || !onUpdateMediaAsset}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="icon-button danger-button"
                        aria-label={`删除 ${asset.name}`}
                        data-testid={`media-asset-delete-${asset.id}`}
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onDeleteMediaAsset?.(asset);
                        }}
                        disabled={disabled || !onDeleteMediaAsset}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">媒体库暂无可选文件</div>
        )}
      </div>
    </div>
  );
}

function MediaImageFieldInput({
  label,
  mediaAssets,
  testId,
  value,
  onChange,
  onUploadMediaAssets,
  onUpdateMediaAsset,
  onDeleteMediaAsset
}: {
  label: string;
  mediaAssets: MediaAsset[];
  testId?: string;
  value: string;
  onChange: (value: string) => void;
  onUploadMediaAssets?: (files: FileList | File[] | null) => Promise<MediaAsset[]>;
  onUpdateMediaAsset?: (assetId: string, patch: Partial<Pick<MediaAsset, "name" | "contentType" | "size" | "contentBase64">>) => void;
  onDeleteMediaAsset?: (asset: MediaAsset) => void;
}) {
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false);
  return (
    <div className="wide media-field">
      <div className="stage-header">
        <span className="subtle">{label}</span>
        <button className="secondary-button" type="button" onClick={() => setMediaLibraryOpen(true)}>
          <ImageIcon size={15} />
          打开媒体库
        </button>
      </div>
      <div className="media-field-grid">
        <div className="media-field-preview">
          {value ? <img alt={label} src={value} /> : <span className="subtle">未选择图片</span>}
        </div>
        <div className="media-field-controls">
          <input className="input" data-testid={testId} value={value} onChange={(event) => onChange(event.target.value)} placeholder="图片 URL 或从媒体库选择" />
          <div className="toolbar compact-toolbar">
            <button className="secondary-button" type="button" onClick={() => setMediaLibraryOpen(true)}>
              <ImageIcon size={15} />
              选择/上传图片
            </button>
            {value ? (
              <button className="secondary-button" type="button" onClick={() => onChange("")}>
                <XCircle size={15} />
                清除
              </button>
            ) : null}
          </div>
          <span className="subtle">可粘贴外部图片 URL，也可通过媒体库拖拽上传、编辑或删除图片。</span>
        </div>
      </div>
      {mediaLibraryOpen ? (
        <MediaLibraryModal
          accept="image/*"
          canSelectAsset={isImageMediaAsset}
          description="选择图片作为当前字段，也可拖拽上传新图片并统一管理。"
          disabled={!onUploadMediaAssets}
          mediaAssets={mediaAssets}
          onClose={() => setMediaLibraryOpen(false)}
          onDeleteMediaAsset={onDeleteMediaAsset}
          onSelect={(asset) => {
            onChange(mediaAssetDataUrl(asset));
            setMediaLibraryOpen(false);
          }}
          onUpdateMediaAsset={onUpdateMediaAsset}
          onUploadMediaAssets={onUploadMediaAssets ?? (async () => [])}
          selectFirstUploaded
          selectLabel="使用"
          testId={testId ? `${testId}-media-library-modal` : "record-media-library-modal"}
          title={`${label}媒体库`}
        />
      ) : null}
    </div>
  );
}

function ProductAttachmentsFieldInput({
  label,
  mediaAssets,
  testId,
  value,
  onChange,
  onUploadMediaAssets
}: {
  label: string;
  mediaAssets: MediaAsset[];
  testId?: string;
  value: string;
  onChange: (value: string) => void;
  onUploadMediaAssets: (files: FileList | File[] | null) => Promise<MediaAsset[]>;
}) {
  const attachments = parseAttachmentListValue(value);
  return (
    <div className="wide" data-testid={testId}>
      <AttachmentPicker
        attachments={attachments}
        label={label}
        mediaAssets={mediaAssets}
        onChange={(nextAttachments) => onChange(JSON.stringify(nextAttachments))}
        onUploadMediaAssets={onUploadMediaAssets}
        testIdPrefix={testId ? `${testId}-product-attachment` : "product-attachment"}
      />
    </div>
  );
}

function FieldInput({
  field,
  value,
  allRecords,
  mediaAssets = [],
  users,
  testId,
  onRecordsLoaded,
  onUploadMediaAssets,
  onUpdateMediaAsset,
  onDeleteMediaAsset,
  onChange
}: {
  field: FieldDefinition;
  value: string;
  allRecords: CrmRecord[];
  mediaAssets?: MediaAsset[];
  users: User[];
  testId?: string;
  onRecordsLoaded?: (records: CrmRecord[]) => void;
  onUploadMediaAssets?: (files: FileList | File[] | null) => Promise<MediaAsset[]>;
  onUpdateMediaAsset?: (assetId: string, patch: Partial<Pick<MediaAsset, "name" | "contentType" | "size" | "contentBase64">>) => void;
  onDeleteMediaAsset?: (asset: MediaAsset) => void;
  onChange: (value: string) => void;
}) {
  if (
    (field.objectKey === "products" && field.key === "mainImageUrl") ||
    (field.objectKey === "contacts" && field.key === "avatarUrl") ||
    (field.objectKey === "companies" && field.key === "logoUrl")
  ) {
    return (
      <MediaImageFieldInput
        label={field.label}
        mediaAssets={mediaAssets}
        testId={testId}
        value={value}
        onChange={onChange}
        onUploadMediaAssets={onUploadMediaAssets}
        onUpdateMediaAsset={onUpdateMediaAsset}
        onDeleteMediaAsset={onDeleteMediaAsset}
      />
    );
  }

  if (field.objectKey === "products" && field.key === "attachments") {
    return (
      <ProductAttachmentsFieldInput
        label={field.label}
        mediaAssets={mediaAssets}
        onChange={onChange}
        onUploadMediaAssets={onUploadMediaAssets ?? (async () => [])}
        testId={testId}
        value={value}
      />
    );
  }

  if (isCurrencyCodeField(field)) {
    const currencies = getCurrencyDefinitions(allRecords);
    return (
      <SelectSearchInput
        label={field.label}
        options={currencies.map((currency) => ({ label: `${currency.label} (${currency.code})`, value: currency.code }))}
        testId={testId}
        value={value || getBaseCurrencyCode(currencies)}
        onChange={onChange}
      />
    );
  }

  if (isCountryField(field)) {
    return <CountrySearchInput label={field.label} testId={testId} value={value} onChange={onChange} />;
  }

  if (field.type === "textarea") {
    return (
      <label className="wide">
        <span className="subtle">{field.label}</span>
        <textarea className="textarea" data-testid={testId} value={value} onChange={(event) => onChange(event.target.value)} />
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <SelectSearchInput
        label={field.label}
        options={field.options ?? []}
        testId={testId}
        value={value}
        onChange={onChange}
      />
    );
  }

  if (field.type === "reference") {
    return (
      <ReferenceFieldInput
        allRecords={allRecords}
        field={field}
        onChange={onChange}
        onRecordsLoaded={onRecordsLoaded}
        testId={testId}
        value={value}
      />
    );
  }

  if (field.type === "user") {
    return (
      <label>
        <span className="subtle">{field.label}</span>
        <select className="select" data-testid={testId} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">请选择</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === "boolean") {
    return (
      <label>
        <span className="subtle">{field.label}</span>
        <select className="select" data-testid={testId} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">请选择</option>
          <option value="true">是</option>
          <option value="false">否</option>
        </select>
      </label>
    );
  }

  const inputType = field.type === "number" || field.type === "currency" ? "number" : field.type === "date" ? "date" : "text";

  return (
    <label>
      <span className="subtle">{field.label}</span>
      <input className="input" data-testid={testId} type={inputType} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function formatEditableFieldValue(field: FieldDefinition, value: string, allRecords: CrmRecord[], users: User[]): string {
  if (!value) {
    return "未设置";
  }
  if (field.type === "reference") {
    return allRecords.find((record) => record.id === value)?.title ?? value;
  }
  if (field.type === "user") {
    return ownerLabel(value, users);
  }
  if (isCountryField(field)) {
    return getCountryLabel(value);
  }
  if (field.type === "boolean") {
    return value === "true" ? "是" : "否";
  }
  if (field.type === "select") {
    return field.options?.find((option) => option.value === value)?.label ?? value;
  }
  if (field.type === "date") {
    return formatDate(value);
  }
  return value;
}

function EditableFieldRow({
  allRecords,
  field,
  mediaAssets,
  testId,
  users,
  value,
  onDeleteMediaAsset,
  onRecordsLoaded,
  onSave,
  onUpdateMediaAsset,
  onUploadMediaAssets
}: {
  allRecords: CrmRecord[];
  field: FieldDefinition;
  mediaAssets: MediaAsset[];
  testId?: string;
  users: User[];
  value: string;
  onDeleteMediaAsset?: (asset: MediaAsset) => void;
  onRecordsLoaded?: (records: CrmRecord[]) => void;
  onSave: (value: string) => Promise<void>;
  onUpdateMediaAsset?: (assetId: string, patch: Partial<Pick<MediaAsset, "name" | "contentType" | "size" | "contentBase64">>) => void;
  onUploadMediaAssets?: (files: FileList | File[] | null) => Promise<MediaAsset[]>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const displayValue = formatEditableFieldValue(field, value, allRecords, users);

  useEffect(() => {
    if (!isOpen) {
      setDraftValue(value);
    }
  }, [isOpen, value]);

  async function saveField() {
    setIsSaving(true);
    try {
      await onSave(draftValue);
      setIsOpen(false);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <div className={`editable-field-row ${field.type === "textarea" ? "wide" : ""}`} data-testid={testId ? `${testId}-display` : undefined}>
        <div>
          <span className="editable-field-label">{field.label}</span>
          <strong title={displayValue}>{displayValue}</strong>
        </div>
        <button className="icon-button" aria-label={`编辑${field.label}`} type="button" onClick={() => setIsOpen(true)}>
          <Pencil size={15} />
        </button>
      </div>
      {isOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`编辑${field.label}`}>
          <div className="modal-panel app-dialog editable-field-dialog">
            <div className="stage-header">
              <div>
                <strong>更新字段</strong>
                <div className="subtle">{field.label}</div>
              </div>
              <button className="icon-button" aria-label="关闭" type="button" onClick={() => setIsOpen(false)} disabled={isSaving}>
                <XCircle size={16} />
              </button>
            </div>
            <FieldInput
              allRecords={allRecords}
              field={field}
              mediaAssets={mediaAssets}
              onChange={setDraftValue}
              onDeleteMediaAsset={onDeleteMediaAsset}
              onRecordsLoaded={onRecordsLoaded}
              onUpdateMediaAsset={onUpdateMediaAsset}
              onUploadMediaAssets={onUploadMediaAssets}
              testId={testId}
              users={users}
              value={draftValue}
            />
            <div className="toolbar end">
              <button className="secondary-button" type="button" onClick={() => setIsOpen(false)} disabled={isSaving}>
                取消
              </button>
              <button className="primary-button" type="button" onClick={() => void saveField()} disabled={isSaving}>
                <Save size={16} />
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function EditableOwnerRow({
  canEdit,
  disabled,
  isPending,
  ownerName,
  testId,
  users,
  value,
  onChange,
  onSave
}: {
  canEdit: boolean;
  disabled: boolean;
  isPending: boolean;
  ownerName: string;
  testId: string;
  users: User[];
  value: string;
  onChange: (value: string) => void;
  onSave: (value: string) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setDraftValue(value);
    }
  }, [isOpen, value]);

  async function saveOwner() {
    setIsSaving(true);
    try {
      await onSave(draftValue);
      onChange(draftValue);
      setIsOpen(false);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <div className="editable-field-row" data-testid={`${testId}-display`}>
        <div>
          <span className="editable-field-label">负责人</span>
          <strong title={ownerName}>{ownerName}</strong>
        </div>
        <button className="icon-button" aria-label="编辑负责人" type="button" onClick={() => setIsOpen(true)} disabled={!canEdit || disabled || isPending}>
          <Pencil size={15} />
        </button>
      </div>
      {isOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="编辑负责人">
          <div className="modal-panel app-dialog editable-field-dialog">
            <div className="stage-header">
              <div>
                <strong>更新字段</strong>
                <div className="subtle">负责人</div>
              </div>
              <button className="icon-button" aria-label="关闭" type="button" onClick={() => setIsOpen(false)} disabled={isSaving}>
                <XCircle size={16} />
              </button>
            </div>
            <OwnerSelect
              disabled={disabled}
              testId={testId}
              users={users}
              value={draftValue}
              onChange={setDraftValue}
            />
            <div className="toolbar end">
              <button className="secondary-button" type="button" onClick={() => setIsOpen(false)} disabled={isSaving}>
                取消
              </button>
              <button className="primary-button" type="button" onClick={() => void saveOwner()} disabled={isSaving}>
                <Save size={16} />
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function OwnerSelect({
  allowEmpty = false,
  disabled,
  testId,
  users,
  value,
  onChange
}: {
  allowEmpty?: boolean;
  disabled: boolean;
  testId: string;
  users: User[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="subtle">负责人</span>
      <select className="select" data-testid={testId} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
        {allowEmpty ? <option value="">请选择</option> : null}
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name} · {user.email}
          </option>
        ))}
      </select>
    </label>
  );
}

function SelectSearchInput({
  label,
  options,
  testId,
  value,
  onChange
}: {
  label: string;
  options: Array<{ label: string; value: string; meta?: string }>;
  testId?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const filteredOptions = normalizedSearch
    ? options.filter((option) => `${option.label} ${option.value} ${option.meta ?? ""}`.toLowerCase().includes(normalizedSearch))
    : options;

  return (
    <SearchDropdown
      label={label}
      options={filteredOptions}
      search={search}
      selectedLabel={options.find((option) => option.value === value)?.label ?? ""}
      testId={testId}
      value={value}
      onChange={onChange}
      onSearchChange={setSearch}
    />
  );
}

function CountrySearchInput({
  label,
  testId,
  value,
  onChange
}: {
  label: string;
  testId?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <SelectSearchInput
      label={label}
      options={getCountrySelectOptions()}
      testId={testId}
      value={value}
      onChange={onChange}
    />
  );
}

function SearchDropdown({
  disabled,
  error,
  label,
  loading,
  options,
  placeholder = "搜索并选择",
  search,
  selectedLabel,
  testId,
  value,
  onChange,
  onSearchChange
}: {
  disabled?: boolean;
  error?: string | null;
  label: string;
  loading?: boolean;
  options: Array<{ label: string; value: string; meta?: string }>;
  placeholder?: string;
  search: string;
  selectedLabel: string;
  testId?: string;
  value: string;
  onChange: (value: string) => void;
  onSearchChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const visibleValue = open ? search : selectedLabel;
  const selectedOption = options.find((option) => option.value === value);

  const updateMenuPosition = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    setMenuStyle({
      left: rect.left,
      maxHeight: Math.max(160, Math.min(260, window.innerHeight - rect.bottom - 12)),
      top: rect.bottom + 4,
      width: rect.width
    });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  function openMenu() {
    updateMenuPosition();
    setOpen(true);
  }

  function selectValue(nextValue: string) {
    onChange(nextValue);
    onSearchChange("");
    setOpen(false);
  }

  return (
    <label className="search-dropdown-field">
      <span className="subtle">{label}</span>
      <input
        className="input"
        data-testid={testId ? `${testId}-search` : undefined}
        disabled={disabled}
        placeholder={selectedOption?.label || placeholder}
        ref={inputRef}
        value={visibleValue}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          onSearchChange(event.target.value);
          openMenu();
        }}
        onFocus={() => {
          onSearchChange("");
          openMenu();
        }}
      />
      <select
        aria-hidden="true"
        className="compat-select"
        data-testid={testId}
        disabled={disabled}
        tabIndex={-1}
        value={value}
        onChange={(event) => selectValue(event.target.value)}
      >
        <option value="">{loading ? "搜索中..." : "请选择"}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {open && !disabled ? (
        <div className="search-dropdown-menu floating" style={menuStyle}>
          <button className="search-dropdown-option subtle" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => selectValue("")}>
            不选择
          </button>
          {loading ? <div className="search-dropdown-empty">搜索中...</div> : null}
          {!loading && options.length === 0 ? <div className="search-dropdown-empty">没有匹配结果</div> : null}
          {options.map((option) => (
            <button
              className={`search-dropdown-option ${option.value === value ? "selected" : ""}`}
              key={option.value}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectValue(option.value)}
            >
              <span>{option.label}</span>
              {option.meta ? <span className="subtle">{option.meta}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <span className="subtle">{error}</span> : null}
    </label>
  );
}

function ReferenceFieldInput({
  allRecords,
  field,
  onChange,
  onRecordsLoaded,
  testId,
  value
}: {
  allRecords: CrmRecord[];
  field: FieldDefinition;
  onChange: (value: string) => void;
  onRecordsLoaded?: (records: CrmRecord[]) => void;
  testId?: string;
  value: string;
}) {
  const referencedObjectKey = field.options?.[0]?.value;
  const [search, setSearch] = useState("");
  const [remoteCandidates, setRemoteCandidates] = useState<CrmRecord[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const candidates = useMemo(
    () =>
      mergeRecords(
        allRecords.filter((record) => record.objectKey === referencedObjectKey),
        remoteCandidates.filter((record) => record.objectKey === referencedObjectKey)
      ),
    [allRecords, referencedObjectKey, remoteCandidates]
  );

  useEffect(() => {
    if (!referencedObjectKey || search.trim().length < 2) {
      setIsSearching(false);
      setSearchError(null);
      return undefined;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setIsSearching(true);
      setSearchError(null);
      fetchJson<RecordListResult>(
        buildRecordListUrl(referencedObjectKey, emptySavedView(referencedObjectKey), search, 1, `/api/records/${referencedObjectKey}`, 20, {
          fields: ["title"],
          keyset: true
        }),
        {
        method: "GET",
        signal: controller.signal
        }
      )
        .then((result) => {
          setRemoteCandidates(result.records);
          onRecordsLoaded?.(result.records);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          setSearchError(error instanceof Error ? error.message : "引用记录搜索失败");
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsSearching(false);
          }
        });
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [onRecordsLoaded, referencedObjectKey, search]);

  useEffect(() => {
    if (!referencedObjectKey || !value || candidates.some((candidate) => candidate.id === value)) {
      return undefined;
    }

    const controller = new AbortController();
    fetchJson<CrmRecord>(`/api/records/${referencedObjectKey}/${value}`, {
      method: "GET",
      signal: controller.signal
    })
      .then((record) => {
        setRemoteCandidates((current) => mergeRecords(current, [record]));
        onRecordsLoaded?.([record]);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setSearchError(error instanceof Error ? error.message : "引用记录加载失败");
      });

    return () => controller.abort();
  }, [candidates, onRecordsLoaded, referencedObjectKey, value]);

  const normalizedSearch = search.trim().toLowerCase();
  const visibleCandidates = normalizedSearch ? remoteCandidates.filter((candidate) => candidate.objectKey === referencedObjectKey) : candidates;
  const selectedRecord = candidates.find((candidate) => candidate.id === value);

  return (
    <SearchDropdown
      disabled={!referencedObjectKey}
      error={searchError}
      label={field.label}
      loading={isSearching}
      options={visibleCandidates.map((candidate) => ({
        label: candidate.title,
        value: candidate.id,
        meta: candidate.id
      }))}
      placeholder="搜索引用记录"
      search={search}
      selectedLabel={selectedRecord?.title ?? ""}
      testId={testId}
      value={value}
      onChange={onChange}
      onSearchChange={setSearch}
    />
  );
}

function QuotePricingEditor({
  allRecords,
  onChange,
  onCurrencyChange,
  onRecordsLoaded,
  testIdPrefix,
  values
}: {
  allRecords: CrmRecord[];
  onChange: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  onCurrencyChange: (nextCurrency: string) => void;
  onRecordsLoaded?: (records: CrmRecord[]) => void;
  testIdPrefix: string;
  values: Record<string, string>;
}) {
  const currencyRecords = allRecords.filter((record) => record.objectKey === "currencies");
  const currencies = getCurrencyDefinitions(currencyRecords);
  const quoteCurrency = normalizeCurrencyCode(values.quoteCurrency) || getBaseCurrencyCode(currencies);
  const lineItems = quoteLineItemsFromValues(values, quoteCurrency);
  const fees = quoteFeesFromValues(values, quoteCurrency);
  const totals = calculateQuoteTotals(lineItems, fees, quoteCurrency, currencyRecords);

  function updateLineItems(nextLineItems: QuoteLineItem[]) {
    onChange((current) => withQuotePricingValues(current, nextLineItems, fees, quoteCurrency, currencyRecords));
  }

  function updateFees(nextFees: QuoteFee[]) {
    onChange((current) => withQuotePricingValues(current, lineItems, nextFees, quoteCurrency, currencyRecords));
  }

  function updateLineItem(index: number, patch: Partial<QuoteLineItem>) {
    updateLineItems(lineItems.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function selectProduct(index: number, product: CrmRecord) {
    const productLine = quoteLineItemFromProductForCurrency(product, quoteCurrency, currencyRecords);
    updateLineItems(
      lineItems.map((item, itemIndex) =>
        itemIndex === index
          ? { ...productLine, id: item.id, quantity: item.quantity > 0 ? item.quantity : productLine.quantity }
          : item
      )
    );
  }

  return (
    <section className="quote-editor wide" data-testid={`${testIdPrefix}-pricing`}>
      <div className="toolbar between">
        <div>
          <strong>报价产品与费用</strong>
          <div className="subtle">产品默认读取产品配置，可在本报价中覆盖数量、价格和描述。</div>
        </div>
        <SelectSearchInput
          label="报价币种"
          options={currencies.map((currency) => ({ label: `${currency.label} (${currency.code})`, value: currency.code }))}
          testId={`${testIdPrefix}-currency`}
          value={quoteCurrency}
          onChange={onCurrencyChange}
        />
        <button
          className="secondary-button"
          data-testid={`${testIdPrefix}-add-line`}
          type="button"
          onClick={() => updateLineItems([...lineItems, emptyQuoteLineItem(quoteCurrency)])}
        >
          添加产品
        </button>
      </div>
      <div className="quote-line-list">
        {lineItems.map((item, index) => (
          <div className="quote-line-row" key={item.id}>
            <ProductThumbnail imageUrl={item.imageUrl} title={item.productName} />
            <QuoteProductSearchDropdown
              allRecords={allRecords}
              currencies={currencies}
              label="产品"
              onClear={() => updateLineItem(index, { productId: "", productName: "", sku: undefined, imageUrl: undefined })}
              onRecordsLoaded={onRecordsLoaded}
              testId={`${testIdPrefix}-line-product-${index}`}
              value={item.productId}
              onSelect={(product) => selectProduct(index, product)}
            />
            <label>
              <span className="subtle">数量</span>
              <input
                className="input"
                data-testid={`${testIdPrefix}-line-quantity-${index}`}
                min="0"
                step="1"
                type="number"
                value={String(item.quantity)}
                onChange={(event) => updateLineItem(index, { quantity: Number(event.target.value) })}
              />
            </label>
            <label>
              <span className="subtle">单价 · {item.currency}</span>
              <input
                className="input"
                data-testid={`${testIdPrefix}-line-price-${index}`}
                min="0"
                step="0.01"
                type="number"
                value={String(item.unitPrice)}
                onChange={(event) => updateLineItem(index, { unitPrice: Number(event.target.value) })}
              />
            </label>
            <label className="wide">
              <span className="subtle">描述</span>
              <textarea
                className="textarea"
                data-testid={`${testIdPrefix}-line-description-${index}`}
                value={item.description ?? ""}
                onChange={(event) => updateLineItem(index, { description: event.target.value })}
              />
            </label>
            <div className="quote-line-total">
              <span className="subtle">小计</span>
              <strong>{formatMoneyWithCurrency(item.quantity * item.unitPrice, item.currency, currencies)}</strong>
            </div>
            <button
              className="icon-button"
              title="删除产品行"
              type="button"
              onClick={() => updateLineItems(lineItems.filter((_, itemIndex) => itemIndex !== index))}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {lineItems.length === 0 ? <div className="empty-state">还没有产品行</div> : null}
      </div>

      <div className="toolbar between" style={{ marginTop: 16 }}>
        <div>
          <strong>其他费用</strong>
          <div className="subtle">例如运费、保险费、实施费等。</div>
        </div>
        <button
          className="secondary-button"
          data-testid={`${testIdPrefix}-add-fee`}
          type="button"
          onClick={() => updateFees([...fees, emptyQuoteFee(quoteCurrency)])}
        >
          添加费用
        </button>
      </div>
      <div className="quote-fee-list">
        {fees.map((fee, index) => (
          <div className="quote-fee-row" key={fee.id}>
            <label>
              <span className="subtle">费用名称</span>
              <input className="input" data-testid={`${testIdPrefix}-fee-name-${index}`} value={fee.name} onChange={(event) => updateFees(fees.map((item, itemIndex) => (itemIndex === index ? { ...item, name: event.target.value } : item)))} />
            </label>
            <label>
              <span className="subtle">金额</span>
              <input className="input" data-testid={`${testIdPrefix}-fee-amount-${index}`} min="0" step="0.01" type="number" value={String(fee.amount)} onChange={(event) => updateFees(fees.map((item, itemIndex) => (itemIndex === index ? { ...item, amount: Number(event.target.value), currency: quoteCurrency } : item)))} />
            </label>
            <label className="wide">
              <span className="subtle">说明</span>
              <input className="input" data-testid={`${testIdPrefix}-fee-description-${index}`} value={fee.description ?? ""} onChange={(event) => updateFees(fees.map((item, itemIndex) => (itemIndex === index ? { ...item, description: event.target.value } : item)))} />
            </label>
            <button className="icon-button" title="删除费用" type="button" onClick={() => updateFees(fees.filter((_, itemIndex) => itemIndex !== index))}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <div className="quote-total-summary">
        <span>产品小计 {formatMoneyWithCurrency(totals.lineSubtotal, quoteCurrency, currencies)}</span>
        <span>其他费用 {formatMoneyWithCurrency(totals.feeSubtotal, quoteCurrency, currencies)}</span>
        <strong>总计 {formatMoneyWithCurrency(totals.totalAmount, quoteCurrency, currencies)}</strong>
      </div>
    </section>
  );
}

function QuoteProductSearchDropdown({
  allRecords,
  currencies,
  label,
  onClear,
  onRecordsLoaded,
  testId,
  value,
  onSelect
}: {
  allRecords: CrmRecord[];
  currencies: ReturnType<typeof getCurrencyDefinitions>;
  label: string;
  onClear: () => void;
  onRecordsLoaded?: (records: CrmRecord[]) => void;
  testId: string;
  value: string;
  onSelect: (product: CrmRecord) => void;
}) {
  const [search, setSearch] = useState("");
  const [remoteCandidates, setRemoteCandidates] = useState<CrmRecord[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const candidates = useMemo(
    () => mergeRecords(allRecords.filter((record) => record.objectKey === "products"), remoteCandidates.filter((record) => record.objectKey === "products")),
    [allRecords, remoteCandidates]
  );

  useEffect(() => {
    if (search.trim().length < 2) {
      setIsSearching(false);
      setSearchError(null);
      return undefined;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setIsSearching(true);
      fetchJson<RecordListResult>(
        buildRecordListUrl("products", emptySavedView("products"), search, 1, "/api/records/products", 20, {
          fields: ["title", "sku", "unitPrice", "unitPriceCurrency", "mainImageUrl"],
          keyset: true
        }),
        {
        method: "GET",
        signal: controller.signal
        }
      )
        .then((result) => {
          setRemoteCandidates(result.records);
          onRecordsLoaded?.(result.records);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          setSearchError(error instanceof Error ? error.message : "产品搜索失败");
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsSearching(false);
          }
        });
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [onRecordsLoaded, search]);

  const normalizedSearch = search.trim().toLowerCase();
  const visibleCandidates = normalizedSearch ? remoteCandidates.filter((candidate) => candidate.objectKey === "products") : candidates;
  const selectedRecord = candidates.find((candidate) => candidate.id === value);

  return (
    <SearchDropdown
      error={searchError}
      label={label}
      loading={isSearching}
      options={visibleCandidates.map((candidate) => ({
        label: candidate.title,
        value: candidate.id,
        meta: [
          candidate.data.sku,
          candidate.data.unitPrice ? formatMoneyWithCurrency(candidate.data.unitPrice, normalizeCurrencyCode(candidate.data.unitPriceCurrency) || getBaseCurrencyCode(currencies), currencies) : ""
        ].filter(Boolean).join(" · ")
      }))}
      placeholder="搜索产品"
      search={search}
      selectedLabel={selectedRecord?.title ?? ""}
      testId={testId}
      value={value}
      onChange={(productId) => {
        if (!productId) {
          onClear();
          return;
        }
        const product = candidates.find((candidate) => candidate.id === productId);
        if (product) {
          onSelect(product);
        }
      }}
      onSearchChange={setSearch}
    />
  );
}

function RecordTitleButton({ record, onOpen }: { record: CrmRecord; onOpen: () => void }) {
  const imageUrl = record.objectKey === "contacts" ? record.data.avatarUrl : record.objectKey === "companies" ? record.data.logoUrl : undefined;
  const hasImage = typeof imageUrl === "string" && imageUrl.trim().length > 0;
  return (
    <button className="record-title record-title-with-media" data-testid={`record-row-${record.id}`} type="button" onClick={onOpen}>
      {hasImage && <RecordListImage imageUrl={imageUrl} title={record.title} objectKey={record.objectKey} />}
      <span>{record.title}</span>
    </button>
  );
}

function RecordPoolPanel({
  canManagePool,
  currentUserId,
  disabled,
  record,
  users,
  onClaim,
  onRelease,
  onTransfer
}: {
  canManagePool: boolean;
  currentUserId: string;
  disabled: boolean;
  record: CrmRecord;
  users: User[];
  onClaim: () => void;
  onRelease: () => void;
  onTransfer: (ownerId: string) => void;
}) {
  const [transferOwnerId, setTransferOwnerId] = useState(record.ownerId ?? "");
  useEffect(() => {
    setTransferOwnerId(record.ownerId ?? "");
  }, [record.ownerId]);

  const isPublic = !record.ownerId;
  const isMine = record.ownerId === currentUserId;

  return (
    <section className="section compact-section" data-testid={`record-pool-panel-${record.id}`}>
      <div className="settings-panel-header">
        <div>
          <div className="subtle">公海 / 私海</div>
          <div className="toolbar">
            <span className={isPublic ? "status-pill success" : "status-pill"}>{isPublic ? "公海" : "私海"}</span>
            <span className="subtle">{isPublic ? "当前没有负责人" : `负责人：${ownerLabel(record.ownerId, users)}`}</span>
          </div>
        </div>
        <div className="toolbar">
          {isPublic ? (
            <button className="primary-button" type="button" onClick={onClaim} disabled={disabled}>
              <UserPlus size={16} />
              领取
            </button>
          ) : isMine || canManagePool ? (
            <button className="secondary-button" type="button" onClick={onRelease} disabled={disabled}>
              <RotateCcw size={16} />
              释放到公海
            </button>
          ) : null}
          {canManagePool ? (
            <>
              <select className="select" value={transferOwnerId} onChange={(event) => setTransferOwnerId(event.target.value)} disabled={disabled}>
                <option value="">释放到公海</option>
                {users.filter((user) => user.active).map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} · {user.email}
                  </option>
                ))}
              </select>
              <button className="secondary-button" type="button" onClick={() => onTransfer(transferOwnerId)} disabled={disabled}>
                转移负责人
              </button>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function RecordDeletePendingBanner({
  disabled,
  request,
  onCancel
}: {
  disabled: boolean;
  request: RecordChangeRequest;
  onCancel: (request: RecordChangeRequest) => void;
}) {
  return (
    <section className="record-delete-pending-banner" data-testid="record-delete-pending-banner">
      <Trash2 size={18} />
      <div>
        <strong>删除待审核</strong>
        <div>已提交删除申请，管理员审核通过前不会正式删除。原因：{request.reason}</div>
        <div className="subtle">提交时间：{formatDate(request.createdAt)}</div>
      </div>
      <button className="danger-button" data-testid="record-delete-pending-cancel" type="button" onClick={() => onCancel(request)} disabled={disabled}>
        <RotateCcw size={16} />
        取消申请
      </button>
    </section>
  );
}

function RecordUpdatePendingBanner({
  disabled,
  fields,
  record,
  request,
  users,
  onCancel
}: {
  disabled: boolean;
  fields: FieldDefinition[];
  record: CrmRecord;
  request: RecordChangeRequest;
  users: User[];
  onCancel: (request: RecordChangeRequest) => void;
}) {
  const changes = buildRecordUpdateDiffs(record, request, fields, users);
  return (
    <section className="record-update-pending-banner" data-testid="record-update-pending-banner">
      <Clock3 size={18} />
      <div className="record-update-pending-content">
        <strong>修改待审核</strong>
        <div>已提交修改申请，管理员审核通过前不会正式应用。原因：{request.reason}</div>
        <div className="subtle">提交时间：{formatDate(request.createdAt)}</div>
        {changes.length > 0 ? (
          <div className="record-change-diff-list">
            {changes.map((change) => (
              <div className="record-change-diff-row" key={change.key}>
                <span className="record-change-diff-label">{change.label}</span>
                <span className="record-change-old-value">{change.oldValue || "空"}</span>
                <span className="record-change-arrow">→</span>
                <mark className="record-change-new-value">{change.newValue || "空"}</mark>
              </div>
            ))}
          </div>
        ) : (
          <div className="subtle">此修改申请没有可展示的字段差异。</div>
        )}
      </div>
      <button className="secondary-button" data-testid="record-update-pending-cancel" type="button" onClick={() => onCancel(request)} disabled={disabled}>
        <RotateCcw size={16} />
        取消申请
      </button>
    </section>
  );
}

function RecordListImage({ imageUrl, title, objectKey }: { imageUrl: unknown; title: string; objectKey: string }) {
  const src = typeof imageUrl === "string" ? imageUrl.trim() : "";
  if (!src) {
    return <span className="subtle">-</span>;
  }
  return (
    <span
      className={objectKey === "contacts" ? "record-list-avatar" : "record-list-logo"}
      aria-label={objectKey === "contacts" ? `${title} 头像` : `${title} Logo`}
      style={{ backgroundImage: `url("${src.replace(/"/g, "%22")}")` }}
    />
  );
}

type RecordChangeDiff = {
  key: string;
  label: string;
  oldValue: string;
  newValue: string;
};

function buildRecordUpdateDiffs(record: CrmRecord, request: RecordChangeRequest, fields: FieldDefinition[], users: User[]): RecordChangeDiff[] {
  const patch = request.patch ?? {};
  const previousPatch = previousRecordApprovalPatch(patch);
  const diffs: RecordChangeDiff[] = [];
  const previousTitle = typeof previousPatch.title === "string" ? previousPatch.title : record.title;
  if (typeof patch.title === "string" && patch.title !== previousTitle) {
    diffs.push({ key: "title", label: "名称", oldValue: previousTitle, newValue: patch.title });
  }
  const previousOwnerId = typeof previousPatch.ownerId === "string" ? previousPatch.ownerId : record.ownerId;
  if ("ownerId" in patch && patch.ownerId !== previousOwnerId) {
    diffs.push({
      key: "ownerId",
      label: "负责人",
      oldValue: ownerLabel(previousOwnerId, users),
      newValue: ownerLabel(typeof patch.ownerId === "string" ? patch.ownerId : undefined, users)
    });
  }

  const patchData = isPlainRecord(patch.data) ? patch.data : {};
  const previousData = isPlainRecord(previousPatch.data) ? previousPatch.data : {};
  for (const field of fields) {
    if (!(field.key in patchData)) {
      continue;
    }
    const oldValue = field.key in previousData ? previousData[field.key] : record.data[field.key];
    const newValue = patchData[field.key];
    if (recordChangeValueKey(oldValue) === recordChangeValueKey(newValue)) {
      continue;
    }
    diffs.push({
      key: field.key,
      label: field.label,
      oldValue: formatRecordChangeValue(field, oldValue, users),
      newValue: formatRecordChangeValue(field, newValue, users)
    });
  }
  return diffs;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function recordChangeValueKey(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatRecordChangeValue(field: FieldDefinition, value: unknown, users: User[]): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  if (field.key === "contactMethods") {
    return normalizeContactMethods(value)
      .map((method) => `${contactMethodTypeLabels[method.type]}: ${method.value}${method.primary ? "（主）" : ""}`)
      .join("；");
  }
  if (field.type === "user") {
    return ownerLabel(typeof value === "string" ? value : undefined, users);
  }
  if (isCountryField(field)) {
    return getCountryLabel(value);
  }
  if (field.type === "boolean") {
    return value === true || value === "true" ? "是" : "否";
  }
  if (field.type === "select") {
    const optionValue = String(value);
    return field.options?.find((option) => option.value === optionValue)?.label ?? optionValue;
  }
  if (field.type === "date" && typeof value === "string") {
    return formatDate(value);
  }
  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function ProductThumbnail({ imageUrl, title }: { imageUrl: unknown; title: string }) {
  const src = typeof imageUrl === "string" ? imageUrl.trim() : "";
  return (
    <div className="product-thumb" aria-label={title ? `${title} 主图` : "产品主图"} style={src ? { backgroundImage: `url("${src.replace(/"/g, "%22")}")` } : undefined}>
      {src ? null : <Package size={18} />}
    </div>
  );
}

function ContactProfileEditor({
  allRecords,
  canManageOwners,
  contactMethodValue,
  fields,
  isPending,
  mediaAssets,
  ownerId,
  pendingDeleteRequest,
  pendingUpdateRequest,
  record,
  saveLabel,
  showContactMethodEditor,
  title,
  users,
  values,
  onCancelDeleteRequest,
  onContactMethodsChange,
  onDelete,
  onDeleteMediaAsset,
  onOwnerChange,
  onRecordsLoaded,
  onSave,
  onSaveField,
  onSaveOwner,
  onTitleChange,
  onUpdateMediaAsset,
  onUploadMediaAssets,
  onValueChange
}: {
  allRecords: CrmRecord[];
  canManageOwners: boolean;
  contactMethodValue: string;
  fields: FieldDefinition[];
  isPending: boolean;
  mediaAssets: MediaAsset[];
  ownerId: string;
  pendingDeleteRequest?: RecordChangeRequest;
  pendingUpdateRequest?: RecordChangeRequest;
  record: CrmRecord;
  saveLabel: string;
  showContactMethodEditor: boolean;
  title: string;
  users: User[];
  values: Record<string, string>;
  onCancelDeleteRequest: (request: RecordChangeRequest) => void;
  onContactMethodsChange: (methods: ContactMethodDraft[]) => void;
  onDelete: () => void;
  onDeleteMediaAsset: (asset: MediaAsset) => void;
  onOwnerChange: (ownerId: string) => void;
  onRecordsLoaded?: (records: CrmRecord[]) => void;
  onSave: () => void;
  onSaveField: (field: FieldDefinition, value: string) => Promise<void>;
  onSaveOwner: (ownerId: string) => Promise<void>;
  onTitleChange: (title: string) => void;
  onUpdateMediaAsset: (assetId: string, patch: Partial<Pick<MediaAsset, "name" | "contentType" | "size" | "contentBase64">>) => void;
  onUploadMediaAssets: (files: FileList | File[] | null) => Promise<MediaAsset[]>;
  onValueChange: (fieldKey: string, value: string) => void;
}) {
  const avatarField = fields.find((field) => field.key === "avatarUrl");
  const companyField = fields.find((field) => field.key === "companyId");
  const detailFields = fields.filter((field) => field.key !== "avatarUrl" && field.key !== "companyId");
  const primaryEmail = getPrimaryRecordEmail({ ...record, title, data: { ...record.data, ...values } });
  const company = typeof values.companyId === "string" ? allRecords.find((candidate) => candidate.id === values.companyId) : undefined;
  const contactMethods = normalizeContactMethods(contactMethodValue);
  const actualOwner = record.ownerId ? users.find((user) => user.id === record.ownerId) : undefined;
  const editedOwner = ownerId ? users.find((user) => user.id === ownerId) : undefined;
  const poolLabel = record.ownerId ? "私海" : "公海";
  const ownerName = actualOwner?.name ?? editedOwner?.name ?? "未分配负责人";
  const reviewStatus = pendingDeleteRequest ? "删除待审核" : pendingUpdateRequest ? "修改待审核" : "无待审核";

  return (
    <div className="contact-profile-layout" data-testid="contact-profile-layout">
      <section className={`contact-profile-hero ${pendingDeleteRequest ? "delete-pending" : ""} ${pendingUpdateRequest ? "update-pending" : ""}`}>
        <div className="contact-profile-cover" />
        <div className="contact-profile-main">
          <ContactAvatarEditor
            mediaAssets={mediaAssets}
            name={title || record.title}
            value={avatarField ? values[avatarField.key] ?? "" : ""}
            onChange={(nextValue) => avatarField ? onValueChange(avatarField.key, nextValue) : undefined}
            onDeleteMediaAsset={onDeleteMediaAsset}
            onUpdateMediaAsset={onUpdateMediaAsset}
            onUploadMediaAssets={onUploadMediaAssets}
          />
          <div className="contact-profile-identity">
            <label>
              <span className="subtle">名称</span>
              <input className="input contact-profile-name-input" data-testid="edit-record-title" value={title} onChange={(event) => onTitleChange(event.target.value)} />
            </label>
            <div className="contact-profile-summary">
              {company ? <span>{company.title}</span> : null}
              {primaryEmail ? <span>{primaryEmail}</span> : null}
              <span>{users.find((user) => user.id === ownerId)?.name ?? "未分配负责人"}</span>
            </div>
          </div>
          <div className="contact-profile-actions">
            <button className="primary-button" data-testid="edit-record-save" type="button" onClick={onSave} disabled={isPending || !title.trim()}>
              <Save size={16} />
              {saveLabel}
            </button>
            {pendingDeleteRequest ? (
              <button className="danger-button" data-testid="edit-record-cancel-delete-request" type="button" onClick={() => onCancelDeleteRequest(pendingDeleteRequest)} disabled={isPending}>
                <RotateCcw size={16} />
                取消申请
              </button>
            ) : (
              <button className="danger-button" data-testid="edit-record-delete" type="button" onClick={onDelete} disabled={isPending}>
                <Trash2 size={16} />
                删除
              </button>
            )}
          </div>
        </div>
        <ContactProfileInfoStrip
          companyName={company?.title}
          contactMethodCount={contactMethods.length}
          ownerName={ownerName}
          poolLabel={poolLabel}
          primaryEmail={primaryEmail}
          reviewStatus={reviewStatus}
        />
      </section>

      <div className="contact-profile-grid">
        <section className="contact-profile-card">
          <div className="stage-header">
            <div>
              <strong>Profile</strong>
              <div className="subtle">联系人身份、归属公司与负责人。</div>
            </div>
          </div>
          <div className="form-grid contact-profile-form">
            {companyField ? (
              <EditableFieldRow
                allRecords={allRecords}
                field={companyField}
                mediaAssets={mediaAssets}
                onRecordsLoaded={onRecordsLoaded}
                onSave={(nextValue) => onSaveField(companyField, nextValue)}
                testId={`edit-field-${record.objectKey}-${companyField.key}`}
                users={users}
                value={values[companyField.key] ?? ""}
              />
            ) : null}
            <EditableOwnerRow
              canEdit={canManageOwners}
              disabled={!canManageOwners}
              isPending={isPending}
              ownerName={ownerLabel(ownerId || undefined, users)}
              testId="edit-record-owner"
              users={users}
              value={ownerId}
              onChange={onOwnerChange}
              onSave={onSaveOwner}
            />
          </div>
        </section>

        <section className="contact-profile-card">
          <div className="stage-header">
            <div>
              <strong>About</strong>
              <div className="subtle">生日、性别、地址和其他联系人属性。</div>
            </div>
          </div>
          <div className="form-grid contact-profile-form">
            {detailFields.map((field) => (
              <EditableFieldRow
                allRecords={allRecords}
                field={field}
                key={`contact-profile-${field.id}`}
                mediaAssets={mediaAssets}
                onDeleteMediaAsset={onDeleteMediaAsset}
                onRecordsLoaded={onRecordsLoaded}
                onSave={(nextValue) => onSaveField(field, nextValue)}
                onUpdateMediaAsset={onUpdateMediaAsset}
                onUploadMediaAssets={onUploadMediaAssets}
                testId={`edit-field-${record.objectKey}-${field.key}`}
                users={users}
                value={values[field.key] ?? ""}
              />
            ))}
          </div>
        </section>
      </div>

      {showContactMethodEditor ? (
        <ContactMethodsEditor
          testIdPrefix="edit-contact-method"
          value={contactMethodValue}
          onChange={onContactMethodsChange}
        />
      ) : null}
    </div>
  );
}

function ContactProfileInfoStrip({
  companyName,
  contactMethodCount,
  ownerName,
  poolLabel,
  primaryEmail,
  reviewStatus
}: {
  companyName?: string;
  contactMethodCount: number;
  ownerName: string;
  poolLabel: string;
  primaryEmail?: string;
  reviewStatus: string;
}) {
  const items = [
    { label: "归属", value: poolLabel },
    { label: "负责人", value: ownerName },
    { label: "公司", value: companyName || "未关联" },
    { label: "主要邮箱", value: primaryEmail || "未设置" },
    { label: "联系方式", value: `${contactMethodCount} 条` },
    { label: "审核状态", value: reviewStatus }
  ];

  return <ProfileInfoStrip items={items} testId="contact-profile-info-strip" />;
}

function CompanyProfileInfoStrip({
  contactCount,
  domain,
  industry,
  ownerName,
  poolLabel,
  primaryContactName,
  reviewStatus
}: {
  contactCount: number;
  domain?: string;
  industry?: string;
  ownerName: string;
  poolLabel: string;
  primaryContactName?: string;
  reviewStatus: string;
}) {
  const items = [
    { label: "归属", value: poolLabel },
    { label: "负责人", value: ownerName },
    { label: "主联系人", value: primaryContactName || "未设置" },
    { label: "联系人", value: `${contactCount} 位` },
    { label: "域名/行业", value: [domain || "", industry || ""].filter(Boolean).join(" / ") || "未设置" },
    { label: "审核状态", value: reviewStatus }
  ];

  return <ProfileInfoStrip items={items} testId="company-profile-info-strip" />;
}

function DealProfileInfoStrip({
  amount,
  closeDate,
  companyName,
  ownerName,
  pipelineName,
  reviewStatus,
  stageName
}: {
  amount: string;
  closeDate?: string;
  companyName?: string;
  ownerName: string;
  pipelineName?: string;
  reviewStatus: string;
  stageName?: string;
}) {
  const items = [
    { label: "金额", value: amount || "未设置" },
    { label: "阶段", value: stageName || "未设置" },
    { label: "销售管道", value: pipelineName || "默认管道" },
    { label: "关联公司", value: companyName || "未关联" },
    { label: "预计成交", value: closeDate || "未设置" },
    { label: "负责人/审核", value: `${ownerName} / ${reviewStatus}` }
  ];

  return <ProfileInfoStrip items={items} testId="deal-profile-info-strip" />;
}

function ProfileInfoStrip({ items, testId }: { items: Array<{ label: string; value: string }>; testId: string }) {
  return (
    <div className="contact-profile-info-strip" data-testid={testId}>
      {items.map((item) => (
        <div className="contact-profile-info-item" key={item.label}>
          <span className="contact-profile-info-label">{item.label}</span>
          <strong title={item.value}>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function ContactDetailActivityTabs({
  activeTab,
  activityCount,
  callCount,
  emailCount,
  noteCount,
  onChange,
  taskCount
}: {
  activeTab: ContactDetailActivityTab;
  activityCount: number;
  callCount: number;
  emailCount: number;
  noteCount: number;
  onChange: (tab: ContactDetailActivityTab) => void;
  taskCount: number;
}) {
  const tabs = [
    { key: "all", label: "All", count: activityCount + emailCount, icon: LayoutList },
    { key: "activities", label: "Activities", count: activityCount, icon: ActivityIcon },
    { key: "emails", label: "Emails", count: emailCount, icon: Mail },
    { key: "calls", label: "Calls", count: callCount, icon: Phone },
    { key: "notes", label: "Notes", count: noteCount, icon: FileText },
    { key: "tasks", label: "Tasks", count: taskCount, icon: CheckCircle2 }
  ] satisfies Array<{ key: ContactDetailActivityTab; label: string; count: number; icon: LucideIcon }>;

  function handleTabChange(tab: ContactDetailActivityTab) {
    onChange(tab);
  }

  return (
    <div className="contact-detail-activity-tabs" data-testid="contact-detail-activity-tabs">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            aria-pressed={activeTab === tab.key}
            className={`contact-detail-activity-tab ${activeTab === tab.key ? "active" : ""}`}
            data-testid={`contact-detail-activity-tab-${tab.key}`}
            key={tab.key}
            type="button"
            onClick={() => handleTabChange(tab.key)}
          >
            <Icon size={15} />
            <span>{tab.label}</span>
            {tab.count > 0 ? <span className="contact-detail-tab-count">{tab.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function CompanyProfileEditor({
  allRecords,
  billingAddressEditingId,
  billingAddressValue,
  canManageOwners,
  contacts,
  fields,
  isPending,
  mediaAssets,
  ownerId,
  pendingDeleteRequest,
  pendingUpdateRequest,
  primaryContactId,
  record,
  saveLabel,
  shippingAddressEditingId,
  shippingAddressValue,
  title,
  users,
  values,
  onAddBillingAddress,
  onAddShippingAddress,
  onBillingAddressesChange,
  onCancelAddressEdit,
  onCancelDeleteRequest,
  onDelete,
  onDeleteMediaAsset,
  onEditBillingAddress,
  onEditShippingAddress,
  onOwnerChange,
  onPrimaryContactChange,
  onRecordsLoaded,
  onSave,
  onSaveField,
  onSaveOwner,
  onShippingAddressesChange,
  onTitleChange,
  onUpdateMediaAsset,
  onUploadMediaAssets,
  onValueChange
}: {
  allRecords: CrmRecord[];
  billingAddressEditingId: string;
  billingAddressValue: string;
  canManageOwners: boolean;
  contacts: CrmRecord[];
  fields: FieldDefinition[];
  isPending: boolean;
  mediaAssets: MediaAsset[];
  ownerId: string;
  pendingDeleteRequest?: RecordChangeRequest;
  pendingUpdateRequest?: RecordChangeRequest;
  primaryContactId: string;
  record: CrmRecord;
  saveLabel: string;
  shippingAddressEditingId: string;
  shippingAddressValue: string;
  title: string;
  users: User[];
  values: Record<string, string>;
  onAddBillingAddress: () => void;
  onAddShippingAddress: () => void;
  onBillingAddressesChange: (addresses: CompanyAddressDraft[]) => void;
  onCancelAddressEdit: () => void;
  onCancelDeleteRequest: (request: RecordChangeRequest) => void;
  onDelete: () => void;
  onDeleteMediaAsset: (asset: MediaAsset) => void;
  onEditBillingAddress: (addressId: string) => void;
  onEditShippingAddress: (addressId: string) => void;
  onOwnerChange: (ownerId: string) => void;
  onPrimaryContactChange: (contactId: string) => void;
  onRecordsLoaded?: (records: CrmRecord[]) => void;
  onSave: () => void;
  onSaveField: (field: FieldDefinition, value: string) => Promise<void>;
  onSaveOwner: (ownerId: string) => Promise<void>;
  onShippingAddressesChange: (addresses: CompanyAddressDraft[]) => void;
  onTitleChange: (title: string) => void;
  onUpdateMediaAsset: (assetId: string, patch: Partial<Pick<MediaAsset, "name" | "contentType" | "size" | "contentBase64">>) => void;
  onUploadMediaAssets: (files: FileList | File[] | null) => Promise<MediaAsset[]>;
  onValueChange: (fieldKey: string, value: string) => void;
}) {
  const logoField = fields.find((field) => field.key === "logoUrl");
  const detailFields = fields.filter(
    (field) =>
      ![
        "logoUrl",
        companyPrimaryContactValueKey,
        companyBillingAddressesValueKey,
        companyShippingAddressesValueKey
      ].includes(field.key)
  );
  const primaryContact = contacts.find((contact) => contact.id === primaryContactId) ?? contacts[0];
  const domain = typeof values.domain === "string" ? values.domain.trim() : "";
  const industry = typeof values.industry === "string" ? values.industry.trim() : "";
  const actualOwner = record.ownerId ? users.find((user) => user.id === record.ownerId) : undefined;
  const editedOwner = ownerId ? users.find((user) => user.id === ownerId) : undefined;
  const poolLabel = record.ownerId ? "私海" : "公海";
  const ownerName = actualOwner?.name ?? editedOwner?.name ?? "未分配负责人";
  const reviewStatus = pendingDeleteRequest ? "删除待审核" : pendingUpdateRequest ? "修改待审核" : "无待审核";

  return (
    <div className="contact-profile-layout company-profile-layout" data-testid="company-profile-layout">
      <section className={`contact-profile-hero company-profile-hero ${pendingDeleteRequest ? "delete-pending" : ""} ${pendingUpdateRequest ? "update-pending" : ""}`}>
        <div className="contact-profile-cover company-profile-cover" />
        <div className="contact-profile-main">
          <CompanyLogoEditor
            mediaAssets={mediaAssets}
            name={title || record.title}
            value={logoField ? values[logoField.key] ?? "" : ""}
            onChange={(nextValue) => logoField ? onValueChange(logoField.key, nextValue) : undefined}
            onDeleteMediaAsset={onDeleteMediaAsset}
            onUpdateMediaAsset={onUpdateMediaAsset}
            onUploadMediaAssets={onUploadMediaAssets}
          />
          <div className="contact-profile-identity">
            <label>
              <span className="subtle">公司名称</span>
              <input className="input contact-profile-name-input" data-testid="edit-record-title" value={title} onChange={(event) => onTitleChange(event.target.value)} />
            </label>
            <div className="contact-profile-summary">
              {domain ? <span>{domain}</span> : null}
              {industry ? <span>{industry}</span> : null}
              {primaryContact ? <span>主联系人 {formatEmailContactLabel(primaryContact, getPrimaryRecordEmail(primaryContact))}</span> : null}
              <span>{users.find((user) => user.id === ownerId)?.name ?? "未分配负责人"}</span>
            </div>
          </div>
          <div className="contact-profile-actions">
            <button className="primary-button" data-testid="edit-record-save" type="button" onClick={onSave} disabled={isPending || !title.trim()}>
              <Save size={16} />
              {saveLabel}
            </button>
            {pendingDeleteRequest ? (
              <button className="danger-button" data-testid="edit-record-cancel-delete-request" type="button" onClick={() => onCancelDeleteRequest(pendingDeleteRequest)} disabled={isPending}>
                <RotateCcw size={16} />
                取消申请
              </button>
            ) : (
              <button className="danger-button" data-testid="edit-record-delete" type="button" onClick={onDelete} disabled={isPending}>
                <Trash2 size={16} />
                删除
              </button>
            )}
          </div>
        </div>
        <CompanyProfileInfoStrip
          contactCount={contacts.length}
          domain={domain}
          industry={industry}
          ownerName={ownerName}
          poolLabel={poolLabel}
          primaryContactName={primaryContact ? formatEmailContactLabel(primaryContact, getPrimaryRecordEmail(primaryContact)) : undefined}
          reviewStatus={reviewStatus}
        />
      </section>

      <div className="contact-profile-grid company-profile-grid">
        <section className="contact-profile-card">
          <div className="stage-header">
            <div>
              <strong>Company Profile</strong>
              <div className="subtle">公司基础信息、行业、域名与负责人。</div>
            </div>
          </div>
          <div className="form-grid contact-profile-form">
            <EditableOwnerRow
              canEdit={canManageOwners}
              disabled={!canManageOwners}
              isPending={isPending}
              ownerName={ownerLabel(ownerId || undefined, users)}
              testId="edit-record-owner"
              users={users}
              value={ownerId}
              onChange={onOwnerChange}
              onSave={onSaveOwner}
            />
            {detailFields.map((field) => (
              <EditableFieldRow
                allRecords={allRecords}
                field={field}
                key={`company-profile-${field.id}`}
                mediaAssets={mediaAssets}
                onDeleteMediaAsset={onDeleteMediaAsset}
                onRecordsLoaded={onRecordsLoaded}
                onSave={(nextValue) => onSaveField(field, nextValue)}
                onUpdateMediaAsset={onUpdateMediaAsset}
                onUploadMediaAssets={onUploadMediaAssets}
                testId={`edit-field-${record.objectKey}-${field.key}`}
                users={users}
                value={values[field.key] ?? ""}
              />
            ))}
          </div>
        </section>

        <section className="contact-profile-card">
          <div className="stage-header">
            <div>
              <strong>Contacts & Addresses</strong>
              <div className="subtle">主联系人、账单地址和收货地址。</div>
            </div>
          </div>
          <div className="form-grid contact-profile-form">
            <EditablePrimaryContactRow
              contacts={contacts}
              disabled={isPending}
              value={primaryContactId}
              onChange={onPrimaryContactChange}
              onSave={(contactId) => {
                const field = fields.find((candidate) => candidate.key === companyPrimaryContactValueKey);
                return field ? onSaveField(field, contactId) : Promise.resolve();
              }}
            />
          </div>
          <div className="company-profile-addresses">
            <CompanyAddressCards
              title="Billing address"
              testIdPrefix="edit-company-billing-address"
              value={billingAddressValue}
              editingAddressId={billingAddressEditingId}
              onAdd={onAddBillingAddress}
              onEdit={onEditBillingAddress}
              onCancel={onCancelAddressEdit}
              onChange={onBillingAddressesChange}
            />
            <CompanyAddressCards
              title="Shipping address"
              testIdPrefix="edit-company-shipping-address"
              value={shippingAddressValue}
              editingAddressId={shippingAddressEditingId}
              onAdd={onAddShippingAddress}
              onEdit={onEditShippingAddress}
              onCancel={onCancelAddressEdit}
              onChange={onShippingAddressesChange}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function DealProfileEditor({
  allRecords,
  canManageOwners,
  fields,
  isPending,
  mediaAssets,
  ownerId,
  pendingDeleteRequest,
  pendingUpdateRequest,
  pipelineName,
  record,
  saveLabel,
  stages,
  title,
  users,
  values,
  onCancelDeleteRequest,
  onDelete,
  onDeleteMediaAsset,
  onMoveStage,
  onOwnerChange,
  onRecordsLoaded,
  onSave,
  onSaveField,
  onSaveOwner,
  onTitleChange,
  onUpdateMediaAsset,
  onUploadMediaAssets
}: {
  allRecords: CrmRecord[];
  canManageOwners: boolean;
  fields: FieldDefinition[];
  isPending: boolean;
  mediaAssets: MediaAsset[];
  ownerId: string;
  pendingDeleteRequest?: RecordChangeRequest;
  pendingUpdateRequest?: RecordChangeRequest;
  pipelineName?: string;
  record: CrmRecord;
  saveLabel: string;
  stages: PipelineStage[];
  title: string;
  users: User[];
  values: Record<string, string>;
  onCancelDeleteRequest: (request: RecordChangeRequest) => void;
  onDelete: () => void;
  onDeleteMediaAsset: (asset: MediaAsset) => void;
  onMoveStage: (stageKey: string) => void;
  onOwnerChange: (ownerId: string) => void;
  onRecordsLoaded?: (records: CrmRecord[]) => void;
  onSave: () => void;
  onSaveField: (field: FieldDefinition, value: string) => Promise<void>;
  onSaveOwner: (ownerId: string) => Promise<void>;
  onTitleChange: (title: string) => void;
  onUpdateMediaAsset: (assetId: string, patch: Partial<Pick<MediaAsset, "name" | "contentType" | "size" | "contentBase64">>) => void;
  onUploadMediaAssets: (files: FileList | File[] | null) => Promise<MediaAsset[]>;
}) {
  const amountField = fields.find((field) => field.key === "amount");
  const closeDateField = fields.find((field) => field.key === "closeDate");
  const companyField = fields.find((field) => field.key === "companyId");
  const relationshipFields = fields.filter((field) => field.key === "companyId" || field.type === "reference");
  const detailFields = fields.filter((field) => !relationshipFields.some((relationshipField) => relationshipField.id === field.id));
  const company = typeof values.companyId === "string" ? allRecords.find((candidate) => candidate.id === values.companyId) : undefined;
  const currentStage = stages.find((stage) => stage.key === record.stageKey);
  const amountLabel = amountField ? formatEditableFieldValue(amountField, values[amountField.key] ?? "", allRecords, users) : formatCurrency(record.data.amount);
  const closeDateLabel = closeDateField && values[closeDateField.key] ? formatDate(values[closeDateField.key]) : "";
  const actualOwner = record.ownerId ? users.find((user) => user.id === record.ownerId) : undefined;
  const editedOwner = ownerId ? users.find((user) => user.id === ownerId) : undefined;
  const ownerName = actualOwner?.name ?? editedOwner?.name ?? "未分配负责人";
  const reviewStatus = pendingDeleteRequest ? "删除待审核" : pendingUpdateRequest ? "修改待审核" : "无待审核";

  return (
    <div className="contact-profile-layout deal-profile-layout" data-testid="deal-profile-layout">
      <section className={`contact-profile-hero deal-profile-hero ${pendingDeleteRequest ? "delete-pending" : ""} ${pendingUpdateRequest ? "update-pending" : ""}`}>
        <div className="contact-profile-cover deal-profile-cover" />
        <div className="contact-profile-main">
          <div className="deal-profile-avatar" aria-hidden="true">
            <Trophy size={34} />
          </div>
          <div className="contact-profile-identity">
            <label>
              <span className="subtle">交易名称</span>
              <input className="input contact-profile-name-input" data-testid="edit-record-title" value={title} onChange={(event) => onTitleChange(event.target.value)} />
            </label>
            <div className="contact-profile-summary">
              {amountLabel ? <span>{amountLabel}</span> : null}
              {pipelineName ? <span>{pipelineName}</span> : null}
              {currentStage ? <span>{currentStage.label}</span> : null}
              {company ? <span>{company.title}</span> : null}
              <span>{ownerName}</span>
            </div>
          </div>
          <div className="contact-profile-actions">
            <button className="primary-button" data-testid="edit-record-save" type="button" onClick={onSave} disabled={isPending || !title.trim()}>
              <Save size={16} />
              {saveLabel}
            </button>
            {pendingDeleteRequest ? (
              <button className="danger-button" data-testid="edit-record-cancel-delete-request" type="button" onClick={() => onCancelDeleteRequest(pendingDeleteRequest)} disabled={isPending}>
                <RotateCcw size={16} />
                取消申请
              </button>
            ) : (
              <button className="danger-button" data-testid="edit-record-delete" type="button" onClick={onDelete} disabled={isPending}>
                <Trash2 size={16} />
                删除
              </button>
            )}
          </div>
        </div>
        <DealStageProgressBar currentStageKey={record.stageKey} disabled={isPending} stages={stages} onMoveStage={onMoveStage} />
        <DealProfileInfoStrip
          amount={amountLabel}
          closeDate={closeDateLabel}
          companyName={company?.title}
          ownerName={ownerName}
          pipelineName={pipelineName}
          reviewStatus={reviewStatus}
          stageName={currentStage?.label}
        />
      </section>

      <div className="contact-profile-grid deal-profile-grid">
        <section className="contact-profile-card">
          <div className="stage-header">
            <div>
              <strong>Deal Details</strong>
              <div className="subtle">金额、预计成交日、阶段归属与负责人。</div>
            </div>
          </div>
          <div className="form-grid contact-profile-form">
            <EditableOwnerRow
              canEdit={canManageOwners}
              disabled={!canManageOwners}
              isPending={isPending}
              ownerName={ownerLabel(ownerId || undefined, users)}
              testId="edit-record-owner"
              users={users}
              value={ownerId}
              onChange={onOwnerChange}
              onSave={onSaveOwner}
            />
            {detailFields.map((field) => (
              <EditableFieldRow
                allRecords={allRecords}
                field={field}
                key={`deal-profile-${field.id}`}
                mediaAssets={mediaAssets}
                onDeleteMediaAsset={onDeleteMediaAsset}
                onRecordsLoaded={onRecordsLoaded}
                onSave={(nextValue) => onSaveField(field, nextValue)}
                onUpdateMediaAsset={onUpdateMediaAsset}
                onUploadMediaAssets={onUploadMediaAssets}
                testId={`edit-field-${record.objectKey}-${field.key}`}
                users={users}
                value={values[field.key] ?? ""}
              />
            ))}
          </div>
        </section>

        <section className="contact-profile-card">
          <div className="stage-header">
            <div>
              <strong>Related Records</strong>
              <div className="subtle">关联公司、联系人和其他销售上下文。</div>
            </div>
          </div>
          <div className="form-grid contact-profile-form">
            {relationshipFields.length ? relationshipFields.map((field) => (
              <EditableFieldRow
                allRecords={allRecords}
                field={field}
                key={`deal-relation-${field.id}`}
                mediaAssets={mediaAssets}
                onRecordsLoaded={onRecordsLoaded}
                onSave={(nextValue) => onSaveField(field, nextValue)}
                testId={`edit-field-${record.objectKey}-${field.key}`}
                users={users}
                value={values[field.key] ?? ""}
              />
            )) : <div className="empty-state compact">暂无关联记录字段。</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function DealStageProgressBar({
  currentStageKey,
  disabled,
  stages,
  onMoveStage
}: {
  currentStageKey?: string;
  disabled: boolean;
  stages: PipelineStage[];
  onMoveStage: (stageKey: string) => void;
}) {
  if (stages.length === 0) {
    return (
      <div className="deal-profile-stage-empty" data-testid="deal-stage-progress-bar">
        暂无交易阶段，请先在设置中配置销售管道。
      </div>
    );
  }

  const currentIndex = stages.findIndex((stage) => stage.key === currentStageKey);

  return (
    <div className="deal-profile-stage-bar" data-testid="deal-stage-progress-bar">
      {stages.map((stage, index) => {
        const isActive = stage.key === currentStageKey;
        const isCompleted = currentIndex >= 0 && index < currentIndex;
        return (
          <button
            aria-current={isActive ? "step" : undefined}
            className={`deal-profile-stage-button ${isActive ? "active" : ""} ${isCompleted ? "completed" : ""}`}
            data-testid={`deal-stage-bar-${stage.key}`}
            disabled={disabled || isActive}
            key={stage.key}
            type="button"
            onClick={() => onMoveStage(stage.key)}
          >
            <span className="deal-stage-button-icon">
              {isCompleted || isActive ? <CheckCircle2 size={17} /> : <Plus size={17} />}
            </span>
            <span className="deal-stage-button-copy">
              <strong>{stage.label}</strong>
              <small>{stage.probability}%</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CompanyLogoEditor({
  mediaAssets,
  name,
  value,
  onChange,
  onDeleteMediaAsset,
  onUpdateMediaAsset,
  onUploadMediaAssets
}: {
  mediaAssets: MediaAsset[];
  name: string;
  value: string;
  onChange: (value: string) => void;
  onDeleteMediaAsset: (asset: MediaAsset) => void;
  onUpdateMediaAsset: (assetId: string, patch: Partial<Pick<MediaAsset, "name" | "contentType" | "size" | "contentBase64">>) => void;
  onUploadMediaAssets: (files: FileList | File[] | null) => Promise<MediaAsset[]>;
}) {
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false);
  const safeValue = value.trim();
  const initials = contactInitials(name);

  return (
    <div className="contact-avatar-editor">
      <button
        className="contact-profile-avatar company-profile-logo"
        style={safeValue ? { backgroundImage: `url("${safeValue.replace(/"/g, "%22")}")` } : undefined}
        type="button"
        onClick={() => setMediaLibraryOpen(true)}
        aria-label="选择公司 Logo"
      >
        {safeValue ? null : initials}
      </button>
      <div className="toolbar compact-toolbar">
        <button className="secondary-button" type="button" onClick={() => setMediaLibraryOpen(true)}>
          <ImageIcon size={15} />
          更换 Logo
        </button>
        {safeValue ? (
          <button className="secondary-button" type="button" onClick={() => onChange("")}>
            <XCircle size={15} />
            清除
          </button>
        ) : null}
      </div>
      {mediaLibraryOpen ? (
        <MediaLibraryModal
          accept="image/*"
          canSelectAsset={isImageMediaAsset}
          description="选择图片作为公司 Logo，也可拖拽上传新图片。"
          mediaAssets={mediaAssets}
          onClose={() => setMediaLibraryOpen(false)}
          onDeleteMediaAsset={onDeleteMediaAsset}
          onSelect={(asset) => {
            onChange(mediaAssetDataUrl(asset));
            setMediaLibraryOpen(false);
          }}
          onUpdateMediaAsset={onUpdateMediaAsset}
          onUploadMediaAssets={onUploadMediaAssets}
          selectFirstUploaded
          selectLabel="使用"
          testId="company-logo-media-library-modal"
          title="Logo 媒体库"
        />
      ) : null}
    </div>
  );
}

function ContactAvatarEditor({
  mediaAssets,
  name,
  value,
  onChange,
  onDeleteMediaAsset,
  onUpdateMediaAsset,
  onUploadMediaAssets
}: {
  mediaAssets: MediaAsset[];
  name: string;
  value: string;
  onChange: (value: string) => void;
  onDeleteMediaAsset: (asset: MediaAsset) => void;
  onUpdateMediaAsset: (assetId: string, patch: Partial<Pick<MediaAsset, "name" | "contentType" | "size" | "contentBase64">>) => void;
  onUploadMediaAssets: (files: FileList | File[] | null) => Promise<MediaAsset[]>;
}) {
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false);
  const safeValue = value.trim();
  const initials = contactInitials(name);

  return (
    <div className="contact-avatar-editor">
      <button
        className="contact-profile-avatar"
        style={safeValue ? { backgroundImage: `url("${safeValue.replace(/"/g, "%22")}")` } : undefined}
        type="button"
        onClick={() => setMediaLibraryOpen(true)}
        aria-label="选择联系人头像"
      >
        {safeValue ? null : initials}
      </button>
      <div className="toolbar compact-toolbar">
        <button className="secondary-button" type="button" onClick={() => setMediaLibraryOpen(true)}>
          <ImageIcon size={15} />
          更换头像
        </button>
        {safeValue ? (
          <button className="secondary-button" type="button" onClick={() => onChange("")}>
            <XCircle size={15} />
            清除
          </button>
        ) : null}
      </div>
      {mediaLibraryOpen ? (
        <MediaLibraryModal
          accept="image/*"
          canSelectAsset={isImageMediaAsset}
          description="选择图片作为联系人头像，也可拖拽上传新图片。"
          mediaAssets={mediaAssets}
          onClose={() => setMediaLibraryOpen(false)}
          onDeleteMediaAsset={onDeleteMediaAsset}
          onSelect={(asset) => {
            onChange(mediaAssetDataUrl(asset));
            setMediaLibraryOpen(false);
          }}
          onUpdateMediaAsset={onUpdateMediaAsset}
          onUploadMediaAssets={onUploadMediaAssets}
          selectFirstUploaded
          selectLabel="使用"
          testId="contact-avatar-media-library-modal"
          title="头像媒体库"
        />
      ) : null}
    </div>
  );
}

function contactInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "?";
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

type ContactMethodType = "email" | "whatsapp" | "mob" | "tel" | "wechat" | "linkedin" | "instagram" | "facebook" | "x" | "website" | "other";

type ContactMethodDraft = {
  id: string;
  type: ContactMethodType;
  value: string;
  label?: string;
  primary?: boolean;
  sourceRecordId?: string;
};

type ContactFollowUpDraft = {
  channel: "whatsapp" | "call";
  method: ContactMethodDraft;
  recordId: string;
  recordTitle: string;
  message: string;
  attachments: ActivityAttachment[];
};

const contactMethodsValueKey = "__contactMethods";
const companyPrimaryContactValueKey = "__primaryContactId";
const companyBillingAddressesValueKey = "__billingAddresses";
const companyShippingAddressesValueKey = "__shippingAddresses";
const hiddenContactFormFields = new Set(["email", "phone"]);
const hiddenCompanyFormFields = new Set(["billingAddresses", "shippingAddresses"]);
const contactMethodTypeLabels: Record<ContactMethodType, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  mob: "Mob",
  tel: "Tel",
  wechat: "WeChat",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  website: "Website",
  other: "其他"
};

type QuickActionItem = {
  id: string;
  label: string;
  value: string;
  description?: string;
  icon: LucideIcon;
  href?: string;
  external?: boolean;
  badge?: string;
  onClick?: () => void;
  secondaryActions?: Array<{
    label: string;
    onClick: () => void;
  }>;
};

function QuickActionList({
  title,
  description,
  items,
  emptyMessage,
  testId
}: {
  title: string;
  description?: string;
  items: QuickActionItem[];
  emptyMessage?: string;
  testId?: string;
}) {
  return (
    <section className="quick-action-panel wide" data-testid={testId}>
      <div className="stage-header">
        <div>
          <strong>{title}</strong>
          {description ? <div className="subtle">{description}</div> : null}
        </div>
      </div>
      {items.length ? (
        <div className="quick-action-grid">
          {items.map((item) => {
            const Icon = item.icon;
            const content = (
              <>
                <Icon size={16} />
                <span className="quick-action-content">
                  <strong>{item.label}</strong>
                  <span>{item.value}</span>
                  {item.description ? <em>{item.description}</em> : null}
                </span>
                {item.badge ? <span className="badge">{item.badge}</span> : null}
              </>
            );
            return (
              <div className="quick-action-chip" key={item.id}>
                {item.href ? (
                  <a className="quick-action-main" href={item.href} target={item.external ? "_blank" : undefined} rel={item.external ? "noreferrer" : undefined}>
                    {content}
                  </a>
                ) : (
                  <button className="quick-action-main" type="button" onClick={item.onClick} disabled={!item.onClick}>
                    {content}
                  </button>
                )}
                {item.secondaryActions?.length ? (
                  <div className="quick-action-actions">
                    {item.secondaryActions.map((action) => (
                      <button className="quick-action-secondary" key={action.label} type="button" onClick={action.onClick}>
                        {action.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">{emptyMessage ?? "暂无可用快捷操作"}</div>
      )}
    </section>
  );
}

function ContactMethodsQuickActions({
  methods,
  record,
  onComposeEmail,
  onFilterEmail,
  onStartWhatsApp,
  onStartCall,
  onEditMethod,
  editingMethodId,
  editingRecordId
}: {
  methods: ContactMethodDraft[];
  record: CrmRecord;
  onComposeEmail: (emailAddress: string) => void;
  onFilterEmail?: (emailAddress: string) => void;
  onStartWhatsApp?: (method: ContactMethodDraft) => void;
  onStartCall?: (method: ContactMethodDraft) => void;
  onEditMethod?: (method: ContactMethodDraft) => void;
  editingMethodId?: string;
  editingRecordId?: string;
}) {
  const items = normalizePrimaryContactMethods(methods)
    .filter((method) => method.value.trim())
    .map<QuickActionItem>((method) => {
      const label = method.label?.trim() || contactMethodTypeLabels[method.type];
      const value = method.value.trim();
      const badge = method.primary ? "主联系方式" : undefined;
      const methodRecordId = method.sourceRecordId || record.id;
      const editAction = onEditMethod
        ? {
            label: editingMethodId === method.id && editingRecordId === methodRecordId ? "收起" : "编辑",
            onClick: () => onEditMethod(method)
          }
        : undefined;
      if (method.type === "email") {
        return {
          id: method.id,
          label,
          value,
          icon: Mail,
          badge,
          onClick: () => onComposeEmail(value),
          secondaryActions: [
            onFilterEmail
              ? {
                  label: "筛选邮件",
                  onClick: () => onFilterEmail(value)
                }
              : undefined,
            editAction
          ].filter((action): action is NonNullable<typeof editAction> => Boolean(action))
        };
      }
      if (method.type === "mob" || method.type === "tel") {
        return {
          id: method.id,
          label,
          value,
          icon: Phone,
          onClick: onStartCall ? () => onStartCall(method) : undefined,
          href: onStartCall ? undefined : `tel:${normalizePhoneHref(value)}`,
          badge,
          secondaryActions: editAction ? [editAction] : undefined
        };
      }
      if (method.type === "whatsapp") {
        const whatsappUrl = buildContactMethodUrl(method.type, value);
        return {
          id: method.id,
          label,
          value,
          icon: MessageCircle,
          onClick: onStartWhatsApp ? () => onStartWhatsApp(method) : undefined,
          href: onStartWhatsApp ? undefined : whatsappUrl,
          external: Boolean(whatsappUrl),
          badge,
          secondaryActions: editAction ? [editAction] : undefined
        };
      }
      return {
        id: method.id,
        label,
        value,
        icon: Link,
        href: buildContactMethodUrl(method.type, value),
        external: Boolean(buildContactMethodUrl(method.type, value)),
        badge,
        secondaryActions: editAction ? [editAction] : undefined
      };
    });

  return (
    <QuickActionList
      title="快捷联系方式"
      description={`${record.title} 的可操作联系方式。点击邮箱可直接写邮件，电话和社媒会打开对应应用或页面。`}
      items={items}
      emptyMessage="还没有可用联系方式"
      testId={`record-contact-quick-actions-${record.id}`}
    />
  );
}

function ContactMethodsEditor({
  testIdPrefix,
  value,
  onChange
}: {
  testIdPrefix: string;
  value: string;
  onChange: (methods: ContactMethodDraft[]) => void;
}) {
  const methods = normalizeContactMethods(parseJsonValue(value));
  const visibleMethods = methods.length ? methods : [emptyContactMethod("email", true)];

  function updateMethod(methodId: string, patch: Partial<ContactMethodDraft>) {
    const next = visibleMethods.map((method) => {
      if (patch.primary === true) {
        return { ...method, ...(method.id === methodId ? patch : {}), primary: method.id === methodId };
      }
      return method.id === methodId ? { ...method, ...patch } : method;
    });
    onChange(normalizePrimaryContactMethods(next));
  }

  function addMethod(type: ContactMethodType) {
    onChange(normalizePrimaryContactMethods([...visibleMethods, emptyContactMethod(type)]));
  }

  function removeMethod(methodId: string) {
    onChange(normalizePrimaryContactMethods(visibleMethods.filter((method) => method.id !== methodId)));
  }

  return (
    <section className="wide settings-card" data-testid={`${testIdPrefix}-editor`}>
      <div className="stage-header">
        <div>
          <strong>联系方式</strong>
          <div className="subtle">支持同一种类型添加多条联系方式。</div>
        </div>
        <div className="toolbar">
          {(Object.entries(contactMethodTypeLabels) as Array<[ContactMethodType, string]>).map(([type, label]) => (
            <button className="secondary-button" data-testid={`${testIdPrefix}-add-${type}`} key={type} type="button" onClick={() => addMethod(type)}>
              添加 {label}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-list" style={{ marginTop: 10 }}>
        {visibleMethods.map((method, index) => (
          <div className="settings-item" key={method.id}>
            <div className="form-grid">
              <label>
                <span className="subtle">类型</span>
                <select
                  className="select"
                  data-testid={`${testIdPrefix}-type-${index}`}
                  value={method.type}
                  onChange={(event) => updateMethod(method.id, { type: event.target.value as ContactMethodType })}
                >
                  {Object.entries(contactMethodTypeLabels).map(([type, label]) => (
                    <option key={type} value={type}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="subtle">值</span>
                <input
                  className="input"
                  data-testid={`${testIdPrefix}-value-${index}`}
                  value={method.value}
                  onChange={(event) => updateMethod(method.id, { value: event.target.value })}
                  placeholder={method.type === "email" ? "name@example.com" : "联系方式"}
                />
              </label>
              <label>
                <span className="subtle">标签</span>
                <input
                  className="input"
                  value={method.label ?? ""}
                  onChange={(event) => updateMethod(method.id, { label: event.target.value })}
                  placeholder="工作 / 私人 / 采购"
                />
              </label>
              <label className="checkbox-row" style={{ alignSelf: "end" }}>
                <input
                  checked={Boolean(method.primary)}
                  type="checkbox"
                  onChange={(event) => updateMethod(method.id, { primary: event.target.checked })}
                />
                主联系方式
              </label>
              <button className="icon-button" aria-label="删除联系方式" type="button" onClick={() => removeMethod(method.id)}>
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ContactMethodSingleEditor({
  testIdPrefix,
  value,
  methodId,
  onChange,
  onCancel
}: {
  testIdPrefix: string;
  value: string;
  methodId: string;
  onChange: (methods: ContactMethodDraft[]) => void;
  onCancel: () => void;
}) {
  const methods = normalizeContactMethods(parseJsonValue(value));
  const existingMethod = methods.find((candidate) => candidate.id === methodId);
  const method = existingMethod ?? {
    id: methodId,
    type: "email" as ContactMethodType,
    value: "",
    label: contactMethodTypeLabels.email,
    primary: methods.length === 0
  };

  function updateMethod(patch: Partial<ContactMethodDraft>) {
    const hasExistingMethod = methods.some((candidate) => candidate.id === methodId);
    const sourceMethods = hasExistingMethod ? methods : [...methods, method];
    const next = sourceMethods.map((candidate) => {
      if (patch.primary === true) {
        return { ...candidate, ...(candidate.id === methodId ? patch : {}), primary: candidate.id === methodId };
      }
      return candidate.id === methodId ? { ...candidate, ...patch } : candidate;
    });
    onChange(normalizePrimaryContactMethods(next));
  }

  function removeMethod() {
    onChange(normalizePrimaryContactMethods(methods.filter((candidate) => candidate.id !== methodId)));
    onCancel();
  }

  return (
    <section className="wide settings-card" data-testid={`${testIdPrefix}-editor-${methodId}`}>
      <div className="stage-header">
        <div>
          <strong>编辑联系方式</strong>
          <div className="subtle">仅编辑当前这一条联系方式。</div>
        </div>
        <button className="secondary-button" type="button" onClick={onCancel}>
          收起
        </button>
      </div>
      <div className="form-grid" style={{ marginTop: 10 }}>
        <label>
          <span className="subtle">类型</span>
          <select
            className="select"
            data-testid={`${testIdPrefix}-type`}
            value={method.type}
            onChange={(event) => updateMethod({ type: event.target.value as ContactMethodType })}
          >
            {Object.entries(contactMethodTypeLabels).map(([type, label]) => (
              <option key={type} value={type}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="subtle">值</span>
          <input
            className="input"
            data-testid={`${testIdPrefix}-value`}
            value={method.value}
            onChange={(event) => updateMethod({ value: event.target.value })}
            placeholder={method.type === "email" ? "name@example.com" : "联系方式"}
          />
        </label>
        <label>
          <span className="subtle">标签</span>
          <input
            className="input"
            value={method.label ?? ""}
            onChange={(event) => updateMethod({ label: event.target.value })}
            placeholder="工作 / 私人 / 采购"
          />
        </label>
        <label className="checkbox-row" style={{ alignSelf: "end" }}>
          <input
            checked={Boolean(method.primary)}
            type="checkbox"
            onChange={(event) => updateMethod({ primary: event.target.checked })}
          />
          主联系方式
        </label>
      </div>
      <div className="toolbar" style={{ marginTop: 10 }}>
        <button className="danger-button" type="button" onClick={removeMethod}>
          <Trash2 size={16} />
          删除这一条
        </button>
      </div>
    </section>
  );
}

function CompanyPrimaryContactSelect({
  contacts,
  value,
  onChange
}: {
  contacts: CrmRecord[];
  value: string;
  onChange: (contactId: string) => void;
}) {
  return (
    <label className="wide" data-testid="company-primary-contact-select">
      <span className="subtle">主联系人</span>
      <select className="select" value={value} onChange={(event) => onChange(event.target.value)} disabled={contacts.length === 0}>
        <option value="">不指定</option>
        {contacts.map((contact) => (
          <option key={contact.id} value={contact.id}>
            {formatEmailContactLabel(contact, getPrimaryRecordEmail(contact))}
          </option>
        ))}
      </select>
      <span className="subtle">联系人通过“联系人”的关联公司字段归属到此公司。给公司发邮件时会优先使用主联系人邮箱。</span>
    </label>
  );
}

function EditablePrimaryContactRow({
  contacts,
  disabled,
  value,
  onChange,
  onSave
}: {
  contacts: CrmRecord[];
  disabled: boolean;
  value: string;
  onChange: (contactId: string) => void;
  onSave: (contactId: string) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const selectedContact = contacts.find((contact) => contact.id === value);
  const displayValue = selectedContact ? formatEmailContactLabel(selectedContact, getPrimaryRecordEmail(selectedContact)) : "未指定";

  useEffect(() => {
    if (!isOpen) {
      setDraftValue(value);
    }
  }, [isOpen, value]);

  async function savePrimaryContact() {
    setIsSaving(true);
    try {
      await onSave(draftValue);
      onChange(draftValue);
      setIsOpen(false);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <div className="editable-field-row wide" data-testid="company-primary-contact-select-display">
        <div>
          <span className="editable-field-label">主联系人</span>
          <strong title={displayValue}>{displayValue}</strong>
          <small>给公司发邮件时会优先使用主联系人邮箱。</small>
        </div>
        <button className="icon-button" aria-label="编辑主联系人" type="button" onClick={() => setIsOpen(true)} disabled={disabled || contacts.length === 0}>
          <Pencil size={15} />
        </button>
      </div>
      {isOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="编辑主联系人">
          <div className="modal-panel app-dialog editable-field-dialog">
            <div className="stage-header">
              <div>
                <strong>更新字段</strong>
                <div className="subtle">主联系人</div>
              </div>
              <button className="icon-button" aria-label="关闭" type="button" onClick={() => setIsOpen(false)} disabled={isSaving}>
                <XCircle size={16} />
              </button>
            </div>
            <CompanyPrimaryContactSelect contacts={contacts} value={draftValue} onChange={setDraftValue} />
            <div className="toolbar end">
              <button className="secondary-button" type="button" onClick={() => setIsOpen(false)} disabled={isSaving}>
                取消
              </button>
              <button className="primary-button" type="button" onClick={() => void savePrimaryContact()} disabled={isSaving}>
                <Save size={16} />
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

type CompanyAddressDraft = {
  id: string;
  label?: string;
  country?: string;
  region?: string;
  city?: string;
  line1?: string;
  line2?: string;
  postalCode?: string;
};

function CompanyAddressesEditor({
  title,
  testIdPrefix,
  value,
  onChange
}: {
  title: string;
  testIdPrefix: string;
  value: string;
  onChange: (addresses: CompanyAddressDraft[]) => void;
}) {
  const addresses = normalizeCompanyAddresses(parseJsonValue(value));
  const visibleAddresses = addresses.length ? addresses : [emptyCompanyAddress()];

  function updateAddress(addressId: string, patch: Partial<CompanyAddressDraft>) {
    onChange(normalizeCompanyAddresses(visibleAddresses.map((address) => (address.id === addressId ? { ...address, ...patch } : address))));
  }

  function addAddress() {
    onChange(normalizeCompanyAddresses([...visibleAddresses, emptyCompanyAddress()]));
  }

  function removeAddress(addressId: string) {
    onChange(normalizeCompanyAddresses(visibleAddresses.filter((address) => address.id !== addressId)));
  }

  return (
    <section className="wide settings-card" data-testid={`${testIdPrefix}-editor`}>
      <div className="stage-header">
        <div>
          <strong>{title}</strong>
          <div className="subtle">支持添加多条地址。</div>
        </div>
        <button className="secondary-button" data-testid={`${testIdPrefix}-add`} type="button" onClick={addAddress}>
          添加地址
        </button>
      </div>
      <div className="settings-list" style={{ marginTop: 10 }}>
        {visibleAddresses.map((address, index) => (
          <div className="settings-item" key={address.id}>
            <div className="form-grid">
              <label>
                <span className="subtle">标签</span>
                <input className="input" value={address.label ?? ""} onChange={(event) => updateAddress(address.id, { label: event.target.value })} placeholder="总部 / 仓库 / 办公室" />
              </label>
              <CountrySearchInput
                label="国家/地区"
                testId={`${testIdPrefix}-country-${index}`}
                value={address.country ?? ""}
                onChange={(country) => updateAddress(address.id, { country })}
              />
              <label>
                <span className="subtle">省/州</span>
                <input className="input" value={address.region ?? ""} onChange={(event) => updateAddress(address.id, { region: event.target.value })} />
              </label>
              <label>
                <span className="subtle">城市</span>
                <input className="input" value={address.city ?? ""} onChange={(event) => updateAddress(address.id, { city: event.target.value })} />
              </label>
              <label className="wide">
                <span className="subtle">地址 1</span>
                <input className="input" data-testid={`${testIdPrefix}-line1-${index}`} value={address.line1 ?? ""} onChange={(event) => updateAddress(address.id, { line1: event.target.value })} />
              </label>
              <label className="wide">
                <span className="subtle">地址 2</span>
                <input className="input" value={address.line2 ?? ""} onChange={(event) => updateAddress(address.id, { line2: event.target.value })} />
              </label>
              <label>
                <span className="subtle">邮编</span>
                <input className="input" value={address.postalCode ?? ""} onChange={(event) => updateAddress(address.id, { postalCode: event.target.value })} />
              </label>
              <button className="icon-button" aria-label="删除地址" type="button" onClick={() => removeAddress(address.id)}>
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CompanyAddressCards({
  title,
  testIdPrefix,
  value,
  editingAddressId,
  onAdd,
  onEdit,
  onCancel,
  onChange
}: {
  title: string;
  testIdPrefix: string;
  value: string;
  editingAddressId: string;
  onAdd: () => void;
  onEdit: (addressId: string) => void;
  onCancel: () => void;
  onChange: (addresses: CompanyAddressDraft[]) => void;
}) {
  const addresses = normalizeCompanyAddresses(parseJsonValue(value)).filter(companyAddressHasContent);
  const editingAddress = editingAddressId
    ? normalizeCompanyAddresses(parseJsonValue(value)).find((address) => address.id === editingAddressId) ?? { ...emptyCompanyAddress(), id: editingAddressId }
    : undefined;

  return (
    <section className="wide settings-card company-address-card-panel" data-testid={`${testIdPrefix}-cards`}>
      <div className="stage-header">
        <div>
          <strong>{title}</strong>
          <div className="subtle">地址保存后以卡片显示，可单独编辑每个地址。</div>
        </div>
        <button className="secondary-button" data-testid={`${testIdPrefix}-add-single`} type="button" onClick={onAdd}>
          <UserPlus size={16} />
          新增地址
        </button>
      </div>

      {addresses.length > 0 ? (
        <div className="address-card-grid">
          {addresses.map((address) => {
            const lines = formatCompanyAddressLines(address);
            return (
              <article className={`address-card ${editingAddressId === address.id ? "editing" : ""}`} data-testid={`${testIdPrefix}-card-${address.id}`} key={address.id}>
                <div className="stage-header">
                  <div>
                    <strong>{address.label || title}</strong>
                    <div className="subtle">{formatCompanyAddressRegion(address) || "未填写区域"}</div>
                  </div>
                  <button className="secondary-button compact-button" type="button" onClick={() => onEdit(address.id)}>
                    <Pencil size={14} />
                    {editingAddressId === address.id ? "收起" : "编辑"}
                  </button>
                </div>
                <div className="address-lines">
                  {lines.length > 0 ? (
                    lines.map((line) => <span key={line}>{line}</span>)
                  ) : (
                    <span className="subtle">暂无地址明细</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state compact-empty" data-testid={`${testIdPrefix}-empty`}>
          暂无地址，点击新增地址添加。
        </div>
      )}

      {editingAddress ? (
        <CompanyAddressSingleEditor
          testIdPrefix={`${testIdPrefix}-single`}
          value={value}
          addressId={editingAddress.id}
          onCancel={onCancel}
          onChange={onChange}
        />
      ) : null}
    </section>
  );
}

function CompanyAddressSingleEditor({
  testIdPrefix,
  value,
  addressId,
  onCancel,
  onChange
}: {
  testIdPrefix: string;
  value: string;
  addressId: string;
  onCancel: () => void;
  onChange: (addresses: CompanyAddressDraft[]) => void;
}) {
  const addresses = normalizeCompanyAddresses(parseJsonValue(value));
  const existingAddress = addresses.find((candidate) => candidate.id === addressId);
  const address = existingAddress ?? { ...emptyCompanyAddress(), id: addressId };

  function updateAddress(patch: Partial<CompanyAddressDraft>) {
    const hasExistingAddress = addresses.some((candidate) => candidate.id === addressId);
    const sourceAddresses = hasExistingAddress ? addresses : [...addresses, address];
    onChange(normalizeCompanyAddresses(sourceAddresses.map((candidate) => (candidate.id === addressId ? { ...candidate, ...patch } : candidate))));
  }

  function removeAddress() {
    onChange(normalizeCompanyAddresses(addresses.filter((candidate) => candidate.id !== addressId)));
    onCancel();
  }

  return (
    <section className="company-address-single-editor" data-testid={`${testIdPrefix}-editor`}>
      <div className="stage-header">
        <div>
          <strong>{existingAddress ? "编辑地址" : "新增地址"}</strong>
          <div className="subtle">仅修改当前地址卡片，保存记录后生效。</div>
        </div>
        <div className="toolbar">
          <button className="secondary-button" type="button" onClick={onCancel}>
            收起
          </button>
          {existingAddress ? (
            <button className="danger-button" type="button" onClick={removeAddress}>
              <Trash2 size={16} />
              删除地址
            </button>
          ) : null}
        </div>
      </div>
      <div className="form-grid" style={{ marginTop: 10 }}>
        <label>
          <span className="subtle">标签</span>
          <input className="input" value={address.label ?? ""} onChange={(event) => updateAddress({ label: event.target.value })} placeholder="总部 / 仓库 / 办公室" />
        </label>
        <CountrySearchInput
          label="国家/地区"
          testId={`${testIdPrefix}-country`}
          value={address.country ?? ""}
          onChange={(country) => updateAddress({ country })}
        />
        <label>
          <span className="subtle">省/州</span>
          <input className="input" value={address.region ?? ""} onChange={(event) => updateAddress({ region: event.target.value })} />
        </label>
        <label>
          <span className="subtle">城市</span>
          <input className="input" value={address.city ?? ""} onChange={(event) => updateAddress({ city: event.target.value })} />
        </label>
        <label className="wide">
          <span className="subtle">地址 1</span>
          <input className="input" data-testid={`${testIdPrefix}-line1`} value={address.line1 ?? ""} onChange={(event) => updateAddress({ line1: event.target.value })} />
        </label>
        <label className="wide">
          <span className="subtle">地址 2</span>
          <input className="input" value={address.line2 ?? ""} onChange={(event) => updateAddress({ line2: event.target.value })} />
        </label>
        <label>
          <span className="subtle">邮编</span>
          <input className="input" value={address.postalCode ?? ""} onChange={(event) => updateAddress({ postalCode: event.target.value })} />
        </label>
      </div>
    </section>
  );
}

function formatCompanyAddressRegion(address: CompanyAddressDraft): string {
  return [address.city, address.region, getCountryLabel(address.country)].filter(Boolean).join(", ");
}

function formatCompanyAddressLines(address: CompanyAddressDraft): string[] {
  return [address.line1, address.line2, [address.postalCode, formatCompanyAddressRegion(address)].filter(Boolean).join(" ")].filter((line): line is string => Boolean(line));
}

const quoteLineItemsValueKey = "__quoteLineItems";
const quoteFeesValueKey = "__quoteFees";
const hiddenQuoteFormFields = new Set(["productId", "quoteCurrency", "totalAmount"]);

function visibleFormFieldsForObject(objectKey: string | undefined, fields: FieldDefinition[]): FieldDefinition[] {
  if (objectKey === "contacts") {
    return fields.filter((field) => !hiddenContactFormFields.has(field.key));
  }

  if (objectKey === "companies") {
    return fields.filter((field) => !hiddenCompanyFormFields.has(field.key));
  }

  if (objectKey === "quotes") {
    return fields.filter((field) => !hiddenQuoteFormFields.has(field.key));
  }

  return fields;
}

function quoteLineItemsFromValues(values: Record<string, string>, fallbackCurrency?: string): QuoteLineItem[] {
  return normalizeQuoteLineItems(parseJsonValue(values[quoteLineItemsValueKey]), fallbackCurrency);
}

function quoteFeesFromValues(values: Record<string, string>, fallbackCurrency?: string): QuoteFee[] {
  return normalizeQuoteFees(parseJsonValue(values[quoteFeesValueKey]), fallbackCurrency);
}

function withQuotePricingValues(values: Record<string, string>, lineItems: QuoteLineItem[], fees: QuoteFee[], quoteCurrency?: string, currencyRecords: CrmRecord[] = []): Record<string, string> {
  const currencies = getCurrencyDefinitions(currencyRecords);
  const nextCurrency = normalizeCurrencyCode(quoteCurrency || values.quoteCurrency) || getBaseCurrencyCode(currencies);
  const normalizedLineItems = normalizeQuoteLineItems(lineItems, nextCurrency);
  const normalizedFees = normalizeQuoteFees(fees, nextCurrency);
  const totals = calculateQuoteTotals(normalizedLineItems, normalizedFees, nextCurrency, currencyRecords);
  return {
    ...values,
    quoteCurrency: nextCurrency,
    [quoteLineItemsValueKey]: JSON.stringify(normalizedLineItems),
    [quoteFeesValueKey]: JSON.stringify(normalizedFees),
    totalAmount: String(totals.totalAmount)
  };
}

function convertQuoteFormCurrency(values: Record<string, string>, nextCurrency: string, currencyRecords: CrmRecord[]): Record<string, string> {
  const currencies = getCurrencyDefinitions(currencyRecords);
  const previousCurrency = normalizeCurrencyCode(values.quoteCurrency) || getBaseCurrencyCode(currencies);
  const targetCurrency = normalizeCurrencyCode(nextCurrency) || previousCurrency;
  const lineItems = quoteLineItemsFromValues(values, previousCurrency).map((item) => ({
    ...item,
    unitPrice: convertCurrencyAmount(item.unitPrice, item.currency || previousCurrency, targetCurrency, currencies),
    currency: targetCurrency
  }));
  const fees = quoteFeesFromValues(values, previousCurrency).map((fee) => ({
    ...fee,
    amount: convertCurrencyAmount(fee.amount, fee.currency || previousCurrency, targetCurrency, currencies),
    currency: targetCurrency
  }));
  return withQuotePricingValues(values, lineItems, fees, targetCurrency, currencyRecords);
}

function emptyQuoteLineItem(currency = "CNY"): QuoteLineItem {
  return {
    id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    productId: "",
    productName: "",
    quantity: 1,
    unitPrice: 0,
    currency: normalizeCurrencyCode(currency) || "CNY"
  };
}

function emptyQuoteFee(currency = "CNY"): QuoteFee {
  return {
    id: `fee-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    amount: 0,
    currency: normalizeCurrencyCode(currency) || "CNY"
  };
}

function parseJsonValue(value: string | undefined): unknown {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function emptyContactMethod(type: ContactMethodType, primary = false): ContactMethodDraft {
  return {
    id: `method-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    value: "",
    label: contactMethodTypeLabels[type],
    primary
  };
}

function normalizeContactMethodType(value: unknown): ContactMethodType {
  return value === "email" ||
    value === "whatsapp" ||
    value === "mob" ||
    value === "tel" ||
    value === "wechat" ||
    value === "linkedin" ||
    value === "instagram" ||
    value === "facebook" ||
    value === "x" ||
    value === "website" ||
    value === "other"
    ? value
    : "other";
}

function normalizeContactMethods(value: unknown): ContactMethodDraft[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map<ContactMethodDraft | undefined>((item, index) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      const method: ContactMethodDraft = {
        id: typeof record.id === "string" && record.id ? record.id : `method-${index}`,
        type: normalizeContactMethodType(record.type),
        value: typeof record.value === "string" ? record.value.trim() : "",
        label: typeof record.label === "string" ? record.label.trim() : undefined,
        primary: record.primary === true
      };
      return method;
    })
    .filter((method): method is ContactMethodDraft => Boolean(method));
}

function normalizePrimaryContactMethods(methods: ContactMethodDraft[]): ContactMethodDraft[] {
  const normalized = methods.map((method) => ({ ...method, value: method.value.trim(), label: method.label?.trim() })).filter((method) => method.value || method.id);
  const firstPrimaryIndex = normalized.findIndex((method) => method.primary);
  return normalized.map((method, index) => ({ ...method, primary: firstPrimaryIndex >= 0 ? index === firstPrimaryIndex : index === 0 }));
}

function createCompanyAddressId(): string {
  return `address-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyCompanyAddress(): CompanyAddressDraft {
  return {
    id: createCompanyAddressId(),
    label: "",
    country: "",
    region: "",
    city: "",
    line1: "",
    line2: "",
    postalCode: ""
  };
}

function normalizeCompanyAddresses(value: unknown): CompanyAddressDraft[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map<CompanyAddressDraft | undefined>((item, index) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      return {
        id: typeof record.id === "string" && record.id ? record.id : `address-${index}`,
        label: typeof record.label === "string" ? record.label.trim() : "",
        country: typeof record.country === "string" ? record.country.trim() : "",
        region: typeof record.region === "string" ? record.region.trim() : "",
        city: typeof record.city === "string" ? record.city.trim() : "",
        line1: typeof record.line1 === "string" ? record.line1.trim() : "",
        line2: typeof record.line2 === "string" ? record.line2.trim() : "",
        postalCode: typeof record.postalCode === "string" ? record.postalCode.trim() : ""
      } satisfies CompanyAddressDraft;
    })
    .filter((address): address is CompanyAddressDraft => Boolean(address))
    .filter((address) => address.id || companyAddressHasContent(address));
}

function companyAddressHasContent(address: CompanyAddressDraft): boolean {
  return Boolean(address.label || address.country || address.region || address.city || address.line1 || address.line2 || address.postalCode);
}

function companyAddressesFromValues(values: Record<string, string>, valueKey: string): CompanyAddressDraft[] {
  return normalizeCompanyAddresses(parseJsonValue(values[valueKey])).filter(companyAddressHasContent);
}

function withCompanyAddressValues(values: Record<string, string>, valueKey: string, addresses: CompanyAddressDraft[]): Record<string, string> {
  return {
    ...values,
    [valueKey]: JSON.stringify(normalizeCompanyAddresses(addresses))
  };
}

function contactMethodsFromValues(values: Record<string, string>): ContactMethodDraft[] {
  return normalizeContactMethods(parseJsonValue(values[contactMethodsValueKey])).filter((method) => method.value.trim());
}

function withContactMethodValues(values: Record<string, string>, methods: ContactMethodDraft[]): Record<string, string> {
  return {
    ...values,
    [contactMethodsValueKey]: JSON.stringify(normalizePrimaryContactMethods(methods))
  };
}

function contactMethodsFromRecordData(record: CrmRecord): ContactMethodDraft[] {
  const methods = normalizeContactMethods(record.data.contactMethods);
  if (methods.length) {
    return methods;
  }

  const fallbackMethods: ContactMethodDraft[] = [];
  const email = typeof record.data.email === "string" ? record.data.email.trim() : "";
  const phone = typeof record.data.phone === "string" ? record.data.phone.trim() : "";
  if (email) {
    fallbackMethods.push({ id: "legacy-email", type: "email", value: email, label: "Email", primary: true });
  }
  if (phone) {
    fallbackMethods.push({ id: "legacy-phone", type: "tel", value: phone, label: "Tel", primary: fallbackMethods.length === 0 });
  }
  return normalizePrimaryContactMethods(fallbackMethods);
}

function getContactMethodEmails(record: CrmRecord): string[] {
  return contactMethodsFromRecordData(record)
    .filter((method) => method.type === "email" && looksLikeEmail(method.value))
    .map((method) => method.value.toLowerCase());
}

function getContactMethodPhone(methods: ContactMethodDraft[]): string {
  return methods.find((method) => method.type === "mob" || method.type === "tel")?.value ?? "";
}

function normalizePhoneHref(value: string): string {
  return value.trim().replace(/[^\d+]/g, "");
}

function ensureExternalUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed.replace(/^@/, "")}`;
}

function socialHandle(value: string): string {
  return value.trim().replace(/^@/, "").replace(/^https?:\/\/[^/]+\//i, "");
}

function buildContactMethodUrl(type: ContactMethodType, value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (type === "whatsapp") {
    const phone = normalizePhoneHref(trimmed).replace(/^\+/, "");
    return phone ? `https://wa.me/${phone}` : undefined;
  }
  if (type === "website") {
    return ensureExternalUrl(trimmed);
  }
  if (type === "linkedin") {
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://www.linkedin.com/in/${socialHandle(trimmed)}`;
  }
  if (type === "instagram") {
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://www.instagram.com/${socialHandle(trimmed)}`;
  }
  if (type === "facebook") {
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://www.facebook.com/${socialHandle(trimmed)}`;
  }
  if (type === "x") {
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://x.com/${socialHandle(trimmed)}`;
  }
  if (type === "other" && /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

function buildContactFollowUpAiSourceText(record: CrmRecord, activities: Activity[], draft: ContactFollowUpDraft): string {
  const data = record.data && typeof record.data === "object" ? record.data : {};
  const recentActivities = activities
    .filter((activity) => activity.recordId === record.id)
    .slice(0, 8)
    .map((activity) => `${activity.type}: ${activity.title}${activity.body ? ` - ${activity.body}` : ""}`);
  return [
    `CRM record: ${record.title}`,
    `Object: ${record.objectKey}`,
    `Channel: ${draft.channel}`,
    `Contact method: ${contactMethodTypeLabels[draft.method.type]} ${draft.method.value}`,
    `Current user input: ${draft.message}`,
    `Recent activities: ${recentActivities.join("\n").slice(0, 3000) || "none"}`,
    `Record data: ${JSON.stringify(data).slice(0, 3000)}`
  ].join("\n");
}

function dedupeContactMethods(methods: ContactMethodDraft[]): ContactMethodDraft[] {
  const seen = new Set<string>();
  return normalizePrimaryContactMethods(methods).filter((method) => {
    const key = `${method.type}:${method.value.trim().toLowerCase()}`;
    if (!method.value.trim() || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function getQuickContactMethodsForRecord(record: CrmRecord, records: CrmRecord[]): ContactMethodDraft[] {
  if (record.objectKey === "contacts") {
    return dedupeContactMethods(contactMethodsFromRecordData(record).map((method) => ({ ...method, sourceRecordId: record.id })));
  }
  if (record.objectKey === "companies") {
    const directMethods = contactMethodsFromRecordData(record).map((method) => ({ ...method, sourceRecordId: record.id }));
    const primaryContact = getCompanyPrimaryContact(record, records);
    const primaryMethods = primaryContact
      ? contactMethodsFromRecordData(primaryContact).map((method) => ({
          ...method,
          label: method.label || `主联系人 ${contactMethodTypeLabels[method.type]}`,
          sourceRecordId: primaryContact.id
        }))
      : [];
    const relatedEmailMethods = getCompanyContactRecords(record, records).flatMap((contact) => {
      const contactMethods = contactMethodsFromRecordData(contact);
      return getRecordEmailAddressesFromData(contact).map<ContactMethodDraft>((emailAddress) => {
        const existingMethod = contactMethods.find((method) => method.type === "email" && method.value.trim().toLowerCase() === emailAddress.toLowerCase());
        return {
          ...(existingMethod ?? {
            id: `company-contact-email-${contact.id}-${emailAddress}`,
            type: "email" as ContactMethodType,
            value: emailAddress,
            label: "Email",
            primary: false
          }),
          label: contact.id === primaryContact?.id ? "主联系人 Email" : `${contact.title} Email`,
          primary: contact.id === primaryContact?.id || existingMethod?.primary === true,
          sourceRecordId: contact.id
        };
      });
    });
    return dedupeContactMethods([...primaryMethods, ...directMethods, ...relatedEmailMethods]);
  }
  return dedupeContactMethods(contactMethodsFromRecordData(record).map((method) => ({ ...method, sourceRecordId: record.id })));
}

function buildInitialValues(fields: FieldDefinition[], objectKey?: string): Record<string, string> {
  const initialValues = fields.reduce<Record<string, string>>((accumulator, field) => {
    accumulator[field.key] = toInputValue(field.defaultValue);
    return accumulator;
  }, objectKey === "quotes" ? withQuotePricingValues({}, [], []) : {});
  if (objectKey === "contacts") {
    return withContactMethodValues(initialValues, []);
  }
  if (objectKey === "companies") {
    return {
      ...initialValues,
      [companyPrimaryContactValueKey]: "",
      [companyBillingAddressesValueKey]: JSON.stringify([]),
      [companyShippingAddressesValueKey]: JSON.stringify([])
    };
  }
  return initialValues;
}

function buildRecordValues(fields: FieldDefinition[], record: CrmRecord): Record<string, string> {
  const values = buildInitialValues(fields, record.objectKey);

  for (const field of fields) {
    values[field.key] = toInputValue(record.data[field.key]);
  }

  if (record.stageKey) {
    values.__stageKey = record.stageKey;
  }

  if (record.objectKey === "quotes") {
    const quoteCurrency = normalizeCurrencyCode(record.data.quoteCurrency) || "CNY";
    return withQuotePricingValues(values, normalizeQuoteLineItems(record.data.lineItems, quoteCurrency), normalizeQuoteFees(record.data.fees, quoteCurrency), quoteCurrency);
  }

  if (record.objectKey === "contacts") {
    return withContactMethodValues(values, contactMethodsFromRecordData(record));
  }

  if (record.objectKey === "companies") {
    values[companyPrimaryContactValueKey] = typeof record.data.primaryContactId === "string" ? record.data.primaryContactId : "";
    values[companyBillingAddressesValueKey] = JSON.stringify(normalizeCompanyAddresses(record.data.billingAddresses));
    values[companyShippingAddressesValueKey] = JSON.stringify(normalizeCompanyAddresses(record.data.shippingAddresses));
  }

  return values;
}

function toInputValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function parseSingleFieldValue(field: FieldDefinition, raw: string): unknown {
  if (raw === "") {
    return "";
  }
  if (field.type === "number" || field.type === "currency") {
    return Number(raw);
  }
  if (field.type === "boolean") {
    return raw === "true";
  }
  return raw;
}

function parseFormValues(fields: FieldDefinition[], values: Record<string, string>, objectKey?: string, currencyRecords: CrmRecord[] = []): Record<string, unknown> {
  const data = fields.reduce<Record<string, unknown>>((accumulator, field) => {
    const raw = values[field.key];
    if (raw === undefined || raw === "") {
      return accumulator;
    }

    if (field.type === "number" || field.type === "currency") {
      accumulator[field.key] = Number(raw);
    } else if (field.type === "boolean") {
      accumulator[field.key] = raw === "true";
    } else {
      accumulator[field.key] = raw;
    }

    return accumulator;
  }, {});

  if (objectKey === "quotes") {
    const currencies = getCurrencyDefinitions(currencyRecords);
    const quoteCurrency = normalizeCurrencyCode(values.quoteCurrency) || getBaseCurrencyCode(currencies);
    const lineItems = quoteLineItemsFromValues(values, quoteCurrency);
    const fees = quoteFeesFromValues(values, quoteCurrency);
    const totals = calculateQuoteTotals(lineItems, fees, quoteCurrency, currencyRecords);
    data.quoteCurrency = quoteCurrency;
    data.lineItems = lineItems;
    data.fees = fees;
    data.totalAmount = totals.totalAmount;
  }

  if (objectKey === "products") {
    data.attachments = parseAttachmentListValue(values.attachments);
  }

  if (objectKey === "contacts") {
    const methods = contactMethodsFromValues(values);
    const primaryEmail = methods.find((method) => method.type === "email" && looksLikeEmail(method.value))?.value ?? "";
    data.contactMethods = methods;
    data.email = primaryEmail ? primaryEmail.toLowerCase() : "";
    const phone = getContactMethodPhone(methods);
    data.phone = phone || "";
  }

  if (objectKey === "companies") {
    data.primaryContactId = values[companyPrimaryContactValueKey] || "";
    data.billingAddresses = companyAddressesFromValues(values, companyBillingAddressesValueKey);
    data.shippingAddresses = companyAddressesFromValues(values, companyShippingAddressesValueKey);
  }

  return data;
}

function displayTableColumnValue(column: TableColumn, record: CrmRecord, records: CrmRecord[], users: User[], currencies: ReturnType<typeof getCurrencyDefinitions>): ReactNode {
  if (column.type === "owner") {
    return ownerLabel(record.ownerId, users);
  }

  if (record.objectKey === "products" && column.field.key === "mainImageUrl") {
    return <ProductThumbnail imageUrl={record.data.mainImageUrl} title={record.title} />;
  }

  if (record.objectKey === "contacts" && column.field.key === "avatarUrl") {
    return <RecordListImage imageUrl={record.data.avatarUrl} title={record.title} objectKey={record.objectKey} />;
  }

  if (record.objectKey === "companies" && column.field.key === "logoUrl") {
    return <RecordListImage imageUrl={record.data.logoUrl} title={record.title} objectKey={record.objectKey} />;
  }

  if (record.objectKey === "products" && column.field.key === "unitPrice") {
    return formatMoneyWithCurrency(record.data.unitPrice, normalizeCurrencyCode(record.data.unitPriceCurrency) || getBaseCurrencyCode(currencies), currencies);
  }

  if (record.objectKey === "quotes" && column.field.key === "totalAmount") {
    return formatMoneyWithCurrency(record.data.totalAmount, normalizeCurrencyCode(record.data.quoteCurrency) || getBaseCurrencyCode(currencies), currencies);
  }

  return displayValue(column.field, record.data[column.field.key], records, users, currencies);
}

function displayValue(field: FieldDefinition | undefined, value: unknown, records: CrmRecord[], users: User[], currencies?: ReturnType<typeof getCurrencyDefinitions>): string {
  if (!field) {
    return String(value ?? "-");
  }
  if (isCountryField(field)) {
    return getCountryLabel(value) || "-";
  }
  if (field.type === "currency") {
    return currencies ? formatMoneyWithCurrency(value, getBaseCurrencyCode(currencies), currencies) : formatCurrency(value);
  }
  if (field.type === "date" && typeof value === "string") {
    return formatDate(value);
  }
  if (field.type === "select") {
    return labelForOption(field.options, value);
  }
  if (field.type === "reference" && typeof value === "string") {
    return records.find((record) => record.id === value)?.title ?? value;
  }
  if (field.type === "user" && typeof value === "string") {
    return users.find((user) => user.id === value)?.name ?? value;
  }
  if (field.type === "boolean") {
    return value ? "是" : "否";
  }
  if (field.objectKey === "companies" && (field.key === "billingAddresses" || field.key === "shippingAddresses")) {
    const addresses = normalizeCompanyAddresses(value);
    return addresses.length ? `${addresses.length} 条地址` : "-";
  }

  return String(value ?? "-");
}

function parseActivityDetails(body?: string): ActivityDetailsPayload {
  if (!body) {
    return { format: "activity.v1", text: "", attachments: [] };
  }
  try {
    const parsed = JSON.parse(body) as Partial<ActivityDetailsPayload>;
    if (parsed?.format === "task.v1" || parsed?.format === "activity.v1") {
      return {
        format: parsed.format,
        text: typeof parsed.text === "string" ? parsed.text : "",
        attachments: Array.isArray(parsed.attachments) ? parsed.attachments.filter(isActivityAttachment) : []
      };
    }
  } catch {
    // Existing activity bodies were plain text before attachments were introduced.
  }
  return { format: "activity.v1", text: body, attachments: [] };
}

function parseTaskDetails(body?: string): TaskDetailsPayload {
  return parseActivityDetails(body);
}

function serializeActivityDetails(input: Pick<ActivityDetailsPayload, "text" | "attachments">): string | undefined {
  const text = input.text.trim();
  const attachments = input.attachments.filter(isActivityAttachment);
  if (!text && !attachments.length) {
    return undefined;
  }
  return JSON.stringify({ format: "activity.v1", text, attachments } satisfies ActivityDetailsPayload);
}

function serializeTaskDetails(input: Pick<TaskDetailsPayload, "text" | "attachments">): string | undefined {
  const text = input.text.trim();
  const attachments = input.attachments.filter(isTaskAttachment);
  if (!text && !attachments.length) {
    return undefined;
  }
  return JSON.stringify({ format: "task.v1", text, attachments } satisfies TaskDetailsPayload);
}

function parseAttachmentListValue(value: unknown): ActivityAttachment[] {
  if (Array.isArray(value)) {
    return value.filter(isActivityAttachment);
  }
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isActivityAttachment) : [];
  } catch {
    return [];
  }
}

function createTaskEditDraft(activity: Activity | null): TaskEditDraft {
  const details = parseTaskDetails(activity?.body);
  return {
    title: activity?.title ?? "",
    dueAt: toDateTimeLocalValue(activity?.dueAt),
    text: details.text,
    attachments: details.attachments
  };
}

function taskAttachmentFromMediaAsset(asset: MediaAsset): ActivityAttachment {
  return {
    id: `${asset.id}-${Date.now()}`,
    mediaAssetId: asset.id,
    name: asset.name,
    contentType: asset.contentType,
    size: asset.size
  };
}

function appendUniqueTaskAttachment(attachments: ActivityAttachment[], attachment: ActivityAttachment): ActivityAttachment[] {
  if (attachments.some((candidate) => candidate.mediaAssetId === attachment.mediaAssetId)) {
    return attachments;
  }
  return [...attachments, attachment];
}

function isActivityAttachment(value: unknown): value is ActivityAttachment {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as ActivityAttachment;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.mediaAssetId === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.contentType === "string" &&
    typeof candidate.size === "number"
  );
}

function isTaskAttachment(value: unknown): value is TaskAttachment {
  return isActivityAttachment(value);
}

function isImageMediaAsset(asset: Pick<MediaAsset, "contentType">): boolean {
  return asset.contentType.toLowerCase().startsWith("image/");
}

function mediaAssetExtension(name: string): string {
  const extension = name.split(".").pop()?.trim();
  return extension && extension !== name ? extension.toUpperCase() : "";
}

function toDateTimeLocalValue(value?: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function isCurrencyCodeField(field: FieldDefinition): boolean {
  return (field.objectKey === "products" && field.key === "unitPriceCurrency") || (field.objectKey === "quotes" && field.key === "quoteCurrency");
}

function isCountryField(field: FieldDefinition): boolean {
  return (field.objectKey === "contacts" || field.objectKey === "companies") && field.key === "country";
}

function ownerLabel(ownerId: string | undefined, users: User[]): string {
  const owner = users.find((user) => user.id === ownerId);
  return owner ? `${owner.name} · ${owner.email}` : "-";
}

function isTaskOverdue(activity: Activity): boolean {
  if (activity.completedAt || activity.archivedAt || !activity.dueAt) {
    return false;
  }

  return new Date(activity.dueAt).getTime() < startOfToday().getTime();
}

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function dealStatusLabel(record: CrmRecord): string {
  if (record.data.dealStatus === "won" || record.stageKey === "won") {
    return "赢单";
  }
  if (record.data.dealStatus === "lost" || record.stageKey === "lost") {
    return "输单";
  }
  return "进行中";
}

function sampleCsvFor(objectKey: string, fields: FieldDefinition[]): string {
  if (objectKey === "companies") {
    return "title,domain,industry\n北极星科技,polaris.example,software";
  }
  if (objectKey === "deals") {
    return "title,amount,closeDate,companyId\n平台升级项目,120000,2026-08-15,company-acme";
  }
  if (objectKey === "products") {
    return "title,sku,unitPrice,billingCycle,active\nAI 销售助手标准版,SKU-AI-SALES-STD,2999,annual,true";
  }
  if (objectKey === "quotes") {
    return "title,quoteNumber,companyId,contactId,paymentTerm,totalAmount,status,validUntil\nAcme 年度订阅报价,Q-2026-001,company-acme,contact-lin,net_30,3499,draft,2026-07-31";
  }
  if (objectKey === "contacts") {
    return "title,email,phone\n王敏,wang@example.com,+86 139 0000 0000";
  }

  return ["title", ...fields.slice(0, 3).map((field) => field.key)].join(",");
}

function mergeRecords(...groups: Array<Array<CrmRecord | null | undefined> | null | undefined>): CrmRecord[] {
  const records = groups.flatMap((group) => group ?? []).filter((record): record is CrmRecord => Boolean(record?.id));
  const merged = new Map<string, CrmRecord>();
  for (const record of records) {
    const existing = merged.get(record.id);
    merged.set(record.id, existing ? mergeRecord(existing, record) : record);
  }
  return [...merged.values()];
}

function mergeRecord(existing: CrmRecord, incoming: CrmRecord): CrmRecord {
  return {
    ...existing,
    ...incoming,
    data: {
      ...existing.data,
      ...incoming.data
    }
  };
}

function mergeActivities(...groups: Array<Array<Activity | null | undefined> | null | undefined>): Activity[] {
  const activities = groups.flatMap((group) => group ?? []).filter((activity): activity is Activity => Boolean(activity?.id));
  return [...new Map(activities.map((activity) => [activity.id, activity])).values()].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

function mergeSmartReminders(...groups: Array<Array<SmartReminder | null | undefined> | null | undefined>): SmartReminder[] {
  const reminders = groups.flatMap((group) => group ?? []).filter((reminder): reminder is SmartReminder => Boolean(reminder?.id));
  return [...new Map(reminders.map((reminder) => [reminder.id, reminder])).values()].sort(compareSmartReminderForUi);
}

function compareSmartReminderForUi(left: SmartReminder, right: SmartReminder): number {
  const priorityDelta = smartReminderPriorityWeightForUi(right.priority) - smartReminderPriorityWeightForUi(left.priority);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }
  const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (leftDue !== rightDue) {
    return leftDue - rightDue;
  }
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
}

function smartReminderPriorityWeightForUi(priority: SmartReminder["priority"]): number {
  if (priority === "urgent") {
    return 4;
  }
  if (priority === "high") {
    return 3;
  }
  if (priority === "medium") {
    return 2;
  }
  return 1;
}

function smartReminderPriorityLabel(priority: SmartReminder["priority"]): string {
  if (priority === "urgent") {
    return "紧急";
  }
  if (priority === "high") {
    return "高优先级";
  }
  if (priority === "medium") {
    return "中优先级";
  }
  return "低优先级";
}

function smartReminderKindLabel(kind: SmartReminder["kind"]): string {
  if (kind === "today_best_action") {
    return "今日最佳行动";
  }
  if (kind === "overdue") {
    return "逾期";
  }
  if (kind === "email_reply") {
    return "邮件回复";
  }
  if (kind === "deal_close") {
    return "交易推进";
  }
  if (kind === "risk") {
    return "风险";
  }
  return "跟进";
}

function mergeRecordChangeRequests(...groups: Array<Array<RecordChangeRequest | null | undefined> | null | undefined>): RecordChangeRequest[] {
  const requests = groups.flatMap((group) => group ?? []).filter((request): request is RecordChangeRequest => Boolean(request?.id));
  return [...new Map(requests.map((request) => [request.id, request])).values()].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

function mergeEmailAccounts(current: EmailAccount[], updated: EmailAccount[]): EmailAccount[] {
  const updates = new Map(updated.map((account) => [account.id, account]));
  const merged = current.map((account) => updates.get(account.id) ?? account);
  const currentIds = new Set(current.map((account) => account.id));
  return [...merged, ...updated.filter((account) => !currentIds.has(account.id))];
}

function mergeEmailThreads(current: EmailThread[], updated: EmailThread[]): EmailThread[] {
  const threads = [...new Map([...current, ...updated].map((thread) => [thread.id, thread])).values()];
  return threads.sort((left, right) => new Date(emailThreadTimeValue(right)).getTime() - new Date(emailThreadTimeValue(left)).getTime());
}

function mergeMediaAssets(...groups: Array<Array<MediaAsset | null | undefined> | null | undefined>): MediaAsset[] {
  const assets = groups.flatMap((group) => group ?? []).filter((asset): asset is MediaAsset => Boolean(asset?.id));
  return [...new Map(assets.map((asset) => [asset.id, asset])).values()].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

function mergeImportJobs(current: CsvImportJob[], updatedForObject: CsvImportJob[], objectKey: string): CsvImportJob[] {
  return [
    ...updatedForObject,
    ...current.filter((job) => job.objectKey !== objectKey && !updatedForObject.some((updated) => updated.id === job.id))
  ]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 50);
}

function createViewDraft(view: SavedView | undefined, fields: FieldDefinition[]): ViewDraft {
  const firstFilter = view?.filters?.[0];
  const fallbackColumns = ["title", ...fields.slice(0, 3).map((field) => field.key)];

  return {
    name: view?.name ?? "新视图",
    columns: view?.columns?.length ? view.columns : fallbackColumns,
    filterField: firstFilter?.field ?? "",
    filterOperator: firstFilter?.operator ?? "contains",
    filterValue: firstFilter?.value ?? "",
    sortField: view?.sort?.field ?? "",
    sortDirection: view?.sort?.direction ?? "asc",
    isDefault: view?.isDefault ?? false
  };
}

function buildEffectiveView(view: SavedView | undefined, objectKey: string, draft: ViewDraft): SavedView {
  const payload = buildSavedViewPayload(objectKey, draft);
  return {
    id: view?.id ?? "draft-view",
    workspaceId: view?.workspaceId ?? "draft-workspace",
    ...payload
  };
}

function buildSavedViewPayload(objectKey: string, draft: ViewDraft): Omit<SavedView, "id" | "workspaceId"> {
  return {
    objectKey,
    name: draft.name.trim() || "新视图",
    columns: normalizeViewColumns(draft.columns),
    filters: draft.filterField && draft.filterValue.trim()
      ? [{ field: draft.filterField, operator: draft.filterOperator, value: draft.filterValue.trim() }]
      : undefined,
    sort: draft.sortField ? { field: draft.sortField, direction: draft.sortDirection } : undefined,
    isDefault: draft.isDefault
  };
}

function normalizeViewColumns(columns: string[]): string[] {
  return Array.from(new Set(["title", ...columns.filter(Boolean)]));
}

function getReferenceObjectKeysForObject(fields: FieldDefinition[], objectKey: string, relations: RelationDefinition[] = []): Set<string> {
  const keys = fields.reduce<Set<string>>((result, field) => {
    if (field.objectKey === objectKey && field.type === "reference") {
      const referencedObjectKey = field.options?.[0]?.value;
      if (referencedObjectKey) {
        result.add(referencedObjectKey);
      }
    }
    return result;
  }, new Set());

  for (const relation of relations) {
    if (relation.fromObjectKey === objectKey) {
      keys.add(relation.toObjectKey);
    }
    if (relation.toObjectKey === objectKey) {
      keys.add(relation.fromObjectKey);
    }
  }

  return keys;
}

function emptySavedView(objectKey: string): SavedView {
  return {
    id: "reference-prefetch-view",
    workspaceId: "reference-prefetch-workspace",
    objectKey,
    name: "引用候选",
    columns: ["title"],
    isDefault: false
  };
}

function normalizeRecordPool(value: string | null): RecordPool {
  return value === "public" || value === "private" || value === "all" ? value : "all";
}

function normalizeDealWorkspaceView(value: string | null): DealWorkspaceView {
  return value === "list" ? "list" : "pipeline";
}

function isPoolEnabledForObject(objectKey: string, settings: CrmPoolSettings): boolean {
  return settings.enabled && settings.objectKeys.includes(objectKey);
}

function recordPoolLabel(record: CrmRecord, users: User[]): string {
  if (!record.ownerId) {
    return "公海";
  }
  const owner = users.find((user) => user.id === record.ownerId);
  return owner ? `私海 · ${owner.name}` : "私海";
}

function buildRecordListUrl(
  objectKey: string,
  view: SavedView,
  query: string,
  page: number,
  path = `/api/records/${objectKey}`,
  pageSize = 50,
  options: { cursor?: string; fields?: string[]; keyset?: boolean; pool?: RecordPool } = {}
): string {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize)
  });

  if (options.keyset) {
    params.set("keyset", "1");
  }
  if (options.cursor) {
    params.set("cursor", options.cursor);
  }
  if (options.fields?.length) {
    params.set("fields", Array.from(new Set(options.fields)).join(","));
  }
  if (options.pool && options.pool !== "all") {
    params.set("pool", options.pool);
  }
  if (query.trim()) {
    params.set("q", query.trim());
  }
  if (view.filters?.length) {
    params.set("filters", JSON.stringify(view.filters));
  }
  if (view.sort?.field) {
    params.set("sortField", view.sort.field);
    params.set("sortDirection", view.sort.direction);
  }

  return `${path}?${params.toString()}`;
}

async function postJson(url: string, body: unknown): Promise<void> {
  await fetchJson(url, { method: "POST", body });
}

function EmailDiagnosticsPanel({
  diagnostics,
  connectionTestRun,
  disabled,
  onRefresh,
  onTestAll,
  onRetryMessage
}: {
  diagnostics: EmailSubsystemDiagnostics | null;
  connectionTestRun: EmailConnectionTestRun | null;
  disabled: boolean;
  onRefresh: () => void;
  onTestAll: () => void;
  onRetryMessage: (messageId: string) => void;
}) {
  const accounts = diagnostics?.accounts;
  return (
    <section className="section">
      <div className="settings-panel-header">
        <div>
          <h2 className="page-title" style={{ fontSize: 18 }}>邮件诊断</h2>
          <div className="subtle">检查部署所需的邮件密钥、OAuth、AI、队列和账号连接状态。</div>
        </div>
        <div className="toolbar">
        <button className="secondary-button" type="button" onClick={onRefresh} disabled={disabled}>
          <RefreshCw className={disabled ? "spin-icon" : undefined} size={16} />
          刷新诊断
        </button>
          <button className="secondary-button" type="button" onClick={onTestAll} disabled={disabled}>
            <CheckCircle2 size={16} />
            测试启用邮箱
          </button>
        </div>
      </div>

      {diagnostics ? (
        <>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <DiagnosticBadge status={diagnostics.status} label={`总体：${formatEmailDiagnosticStatus(diagnostics.status)}`} />
            {diagnostics.jobs ? <DiagnosticBadge status={diagnostics.jobs.ok ? "ok" : "error"} label={`队列：${diagnostics.jobs.executor}/${diagnostics.jobs.queue}`} /> : null}
          </div>

          <div className="settings-list" style={{ marginTop: 12 }}>
            <DiagnosticRow label="邮箱凭据加密" status={diagnostics.encryption.status} message={diagnostics.encryption.message} />
            <DiagnosticRow label="OAuth state 签名" status={diagnostics.oauthState.status} message={diagnostics.oauthState.message} />
            <DiagnosticRow label="OAuth callback" status={diagnostics.oauthCallback.status} message={`${diagnostics.oauthCallback.message}${diagnostics.oauthCallback.callbackUrl ? ` · ${diagnostics.oauthCallback.callbackUrl}` : ""}`} />
            <DiagnosticRow label="邮件投递模式" status={diagnostics.deliveryMode.status} message={diagnostics.deliveryMode.message} />
            <DiagnosticRow label="AI provider" status={diagnostics.aiProvider.status} message={diagnostics.aiProvider.message} />
            <DiagnosticRow label="AI 上下文策略" status={diagnostics.aiContextPolicy.status} message={diagnostics.aiContextPolicy.message} />
            <div className="toolbar">
              <span className={diagnostics.aiContextPolicy.requireSourceLinks ? "badge" : "danger-badge"}>sources {diagnostics.aiContextPolicy.requireSourceLinks ? "required" : "optional"}</span>
              <span className="badge">history {diagnostics.aiContextPolicy.maxHistoryMessages}</span>
              <span className={diagnostics.aiContextPolicy.maxKnowledgeArticles > 0 ? "badge" : "danger-badge"}>knowledge {diagnostics.aiContextPolicy.maxKnowledgeArticles}</span>
              <span className="badge">context {diagnostics.aiContextPolicy.maxContextChars}</span>
              <span className="badge">prompt cap {diagnostics.aiContextPolicy.budgetPolicy.maxModelPromptChars}</span>
              <span className="badge">output cap {diagnostics.aiContextPolicy.budgetPolicy.maxGeneratedOutputChars}</span>
              <span className="badge">automations {diagnostics.aiContextPolicy.enabledAutomationCount}</span>
              {diagnostics.aiContextPolicy.featureDependencies.map((dependency) => (
                <span className="badge" key={`${dependency.feature}-${dependency.dependsOn}`}>{dependency.feature} needs {dependency.dependsOn}</span>
              ))}
              <span className="badge">states inbound {diagnostics.aiContextPolicy.automationEligibleStatuses.inbound.join("/")}, outbound {diagnostics.aiContextPolicy.automationEligibleStatuses.outbound.join("/")}</span>
              <span className="badge">analysis {diagnostics.aiContextPolicy.autoContextAnalysisScope}</span>
            </div>
            <DiagnosticRow label="自动总结策略" status={diagnostics.autoSummaryPolicy.status} message={diagnostics.autoSummaryPolicy.message} />
            <DiagnosticRow label="收信调度" status={diagnostics.syncScheduler.status} message={diagnostics.syncScheduler.message} />
            <div className="toolbar">
              <span className="badge">user {diagnostics.syncScheduler.configuredUserId}</span>
              <span className="badge">source {diagnostics.syncScheduler.userIdSource}</span>
              <span className={diagnostics.syncScheduler.fallbackToAdmin ? "badge" : "danger-badge"}>admin fallback {diagnostics.syncScheduler.fallbackToAdmin ? "on" : "off"}</span>
            </div>
            <DiagnosticRow label="邮件发送认领" status={diagnostics.sendClaims.status} message={diagnostics.sendClaims.message} />
            {diagnostics.sendClaims.staleMessages.map((message) => (
              <div className="settings-item" key={message.id}>
                <div className="settings-panel-header">
                  <strong>{message.subject}</strong>
                  <div className="toolbar">
                    <DiagnosticBadge status="warning" label="发送认领超时" />
                    <button className="secondary-button" type="button" onClick={() => onRetryMessage(message.id)} disabled={disabled}>
                      <RefreshCw className={disabled ? "spin-icon" : undefined} size={14} />
                      恢复发送
                    </button>
                  </div>
                </div>
                <div className="subtle">
                  message {message.id} 路 account {message.accountId}{message.sendAttemptedAt ? ` 路 ${formatDate(message.sendAttemptedAt)}` : ""}
                </div>
              </div>
            ))}
            <DiagnosticRow label="邮件 AI 自动化" status={diagnostics.aiAutomationFailures.status} message={diagnostics.aiAutomationFailures.message} />
            {diagnostics.aiAutomationFailures.recentFailures.map((failure, index) => (
              <div className="settings-item" key={`${failure.createdAt}-${failure.threadId ?? failure.sourceMessageId ?? index}`}>
                <div className="settings-panel-header">
                  <strong>{failure.purpose ?? "email_ai"}</strong>
                  <DiagnosticBadge status="warning" label="自动化失败" />
                </div>
                <div className="subtle">{formatEmailAiAutomationFailure(failure)}</div>
              </div>
            ))}
            <DiagnosticRow label="AI provider 回退" status={diagnostics.aiProviderFallbacks.status} message={diagnostics.aiProviderFallbacks.message} />
            {diagnostics.aiProviderFallbacks.recentFallbacks.map((fallback, index) => (
              <div className="settings-item" key={`${fallback.createdAt}-${fallback.threadId ?? fallback.sourceMessageId ?? index}`}>
                <div className="settings-panel-header">
                  <strong>{fallback.purpose ?? "email_ai"}</strong>
                  <DiagnosticBadge status="warning" label="Provider 回退" />
                </div>
                <div className="subtle">{formatEmailAiProviderFallback(fallback)}</div>
              </div>
            ))}
            {Object.values(diagnostics.oauthProviders).map((provider) => (
              <DiagnosticRow
                key={provider.provider}
                label={`${getEmailProviderCapability(provider.provider).label} OAuth`}
                status={provider.status}
                message={`${provider.message}${provider.missingScopes.length ? ` · missing scopes: ${provider.missingScopes.join(", ")}` : ""}`}
              />
            ))}
          </div>

          {accounts ? (
            <div className="stats-grid" style={{ marginTop: 12 }}>
              <Metric label="邮箱账户" value={accounts.total} icon={Mail} />
              <Metric label="已启用同步" value={accounts.syncEnabled} icon={RefreshCw} />
              <Metric label="已配置连接" value={accounts.connectionConfigured} icon={CheckCircle2} />
              <Metric label="活跃已配置" value={accounts.activeConnectionConfigured} icon={CheckCircle2} />
              <Metric label="可发送连接" value={accounts.sendConnectionConfigured} icon={Send} />
              <Metric label="可同步连接" value={accounts.syncConnectionConfigured} icon={RefreshCw} />
              <Metric label="连接错误" value={accounts.withLastConnectionError} icon={XCircle} />
            </div>
          ) : null}

          {accounts ? (
            <div className="toolbar" style={{ marginTop: 12 }}>
              <span className="badge">active {accounts.active}</span>
              <span className="badge">draft {accounts.draft}</span>
              <span className="badge">disabled {accounts.disabled}</span>
              <span className={accounts.error > 0 ? "danger-badge" : "badge"}>error {accounts.error}</span>
              <span className={accounts.missingConnectionConfig > 0 ? "danger-badge" : "badge"}>未配置连接 {accounts.missingConnectionConfig}</span>
            </div>
          ) : null}

          {connectionTestRun ? (
            <div className="settings-list" style={{ marginTop: 12 }}>
              <div className="settings-item">
                <div className="settings-panel-header">
                  <strong>最近连接测试</strong>
                  <span className={connectionTestRun.failed > 0 ? "danger-badge" : "badge"}>
                    {connectionTestRun.succeeded}/{connectionTestRun.tested} ok
                  </span>
                </div>
                <div className="subtle">
                  {formatDate(connectionTestRun.testedAt)} · total {connectionTestRun.total} · skipped {connectionTestRun.skipped}
                </div>
              </div>
              {connectionTestRun.results.map((entry) => (
                <div className="settings-item" key={entry.account.id}>
                  <div className="settings-panel-header">
                    <strong>{entry.account.emailAddress}</strong>
                    <span className={entry.ok || entry.skipped ? "badge" : "danger-badge"}>
                      {entry.ok ? "ok" : entry.skipped ? "skipped" : "failed"}
                    </span>
                  </div>
                  <div className="subtle">{formatEmailConnectionTestResult(entry)}</div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="empty-state">点击刷新诊断，检查当前邮件部署状态。</div>
      )}
    </section>
  );
}

function DiagnosticRow({ label, status, message }: { label: string; status: EmailDiagnosticStatus; message: string }) {
  return (
    <div className="settings-item">
      <div className="settings-panel-header">
        <strong>{label}</strong>
        <DiagnosticBadge status={status} label={formatEmailDiagnosticStatus(status)} />
      </div>
      <div className="subtle">{message}</div>
    </div>
  );
}

function DiagnosticBadge({ status, label }: { status: EmailDiagnosticStatus; label: string }) {
  return <span className={status === "ok" ? "badge" : "danger-badge"}>{label}</span>;
}

function EmailRecipientInput({
  contactByEmail,
  label,
  placeholder,
  testId,
  value,
  onChange
}: {
  contactByEmail: Map<string, CrmRecord>;
  label: string;
  placeholder?: string;
  testId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const recipients = splitEmailList(value);
  const suggestions = useMemo(() => {
    const query = draft.trim().toLowerCase();
    if (!query) {
      return [];
    }
    const existing = new Set(recipients.map((recipient) => recipient.toLowerCase()));
    return Array.from(contactByEmail.entries())
      .map(([email, contact]) => ({ email, contact }))
      .filter(({ email, contact }) => !existing.has(email) && (`${contact.title} ${email}`.toLowerCase().includes(query)))
      .slice(0, 8);
  }, [contactByEmail, draft, recipients]);

  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [draft]);

  function commitRecipients(rawValue: string) {
    const nextRecipients = splitEmailList(rawValue);
    if (!nextRecipients.length) {
      return;
    }
    const seen = new Set(recipients.map((recipient) => recipient.toLowerCase()));
    const merged = [...recipients];
    for (const recipient of nextRecipients) {
      const normalized = recipient.toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        merged.push(recipient);
      }
    }
    onChange(merged.join(", "));
    setDraft("");
  }

  function removeRecipient(recipient: string) {
    onChange(recipients.filter((candidate) => candidate.toLowerCase() !== recipient.toLowerCase()).join(", "));
  }

  function commitSuggestion(index = activeSuggestionIndex) {
    const suggestion = suggestions[index];
    if (!suggestion) {
      return false;
    }
    commitRecipients(suggestion.email);
    return true;
  }

  return (
    <label className="email-recipient-field">
      <span className="subtle">{label}</span>
      <div className="email-recipient-input">
        {recipients.map((recipient) => {
          const contact = contactByEmail.get(recipient.toLowerCase());
          return (
            <span className={contact ? "email-recipient-token linked" : "email-recipient-token"} key={recipient}>
              {contact ? `${contact.title}<${recipient}>` : recipient}
              <button aria-label={`移除 ${recipient}`} type="button" onClick={() => removeRecipient(recipient)}>
                <XCircle size={13} />
              </button>
            </span>
          );
        })}
        <input
          data-testid={testId}
          value={draft}
          placeholder={recipients.length ? "" : placeholder}
          onBlur={() => commitRecipients(draft)}
          onChange={(event) => {
            const nextValue = event.target.value;
            if (/[,\n;]/.test(nextValue)) {
              commitRecipients(nextValue);
              return;
            }
            setDraft(nextValue);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && suggestions.length) {
              event.preventDefault();
              setActiveSuggestionIndex((current) => Math.min(suggestions.length - 1, current + 1));
              return;
            }
            if (event.key === "ArrowUp" && suggestions.length) {
              event.preventDefault();
              setActiveSuggestionIndex((current) => Math.max(0, current - 1));
              return;
            }
            if ((event.key === "Tab" || event.key === "Enter") && suggestions.length && commitSuggestion()) {
              event.preventDefault();
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              if (draft.trim()) {
                event.preventDefault();
                commitRecipients(draft);
              }
            }
            if (event.key === "Backspace" && !draft && recipients.length) {
              event.preventDefault();
              onChange(recipients.slice(0, -1).join(", "));
            }
          }}
        />
        {suggestions.length ? (
          <div className="email-recipient-suggestions" role="listbox">
            {suggestions.map((suggestion, index) => (
              <button
                className={index === activeSuggestionIndex ? "active" : ""}
                key={suggestion.email}
                role="option"
                type="button"
                aria-selected={index === activeSuggestionIndex}
                onMouseDown={(event) => {
                  event.preventDefault();
                  commitRecipients(suggestion.email);
                }}
              >
                <strong>{suggestion.contact.title}</strong>
                <span>{suggestion.email}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </label>
  );
}

function formatEmailAiAutomationFailure(failure: EmailSubsystemDiagnostics["aiAutomationFailures"]["recentFailures"][number]): string {
  const related = [
    failure.threadId ? `thread ${failure.threadId}` : undefined,
    failure.sourceMessageId ? `message ${failure.sourceMessageId}` : undefined
  ].filter(Boolean);
  return [formatDate(failure.createdAt), related.join(" · "), failure.errorMessage].filter(Boolean).join(" · ");
}

function formatEmailAiProviderFallback(fallback: EmailSubsystemDiagnostics["aiProviderFallbacks"]["recentFallbacks"][number]): string {
  const related = [
    fallback.generationMode,
    fallback.threadId ? `thread ${fallback.threadId}` : undefined,
    fallback.sourceMessageId ? `message ${fallback.sourceMessageId}` : undefined
  ].filter(Boolean);
  return [formatDate(fallback.createdAt), related.join(" 路 "), fallback.providerError].filter(Boolean).join(" 路 ");
}

function formatEmailAiGenerationMode(mode: NonNullable<EmailAiGenerateResult["generationMode"]>): string {
  if (mode === "provider") {
    return "Provider";
  }
  if (mode === "provider_fallback") {
    return "Provider 回退";
  }
  if (mode === "queued") {
    return "已排队";
  }
  if (mode === "disabled") {
    return "已关闭";
  }
  return "本地";
}

function defaultAiProviderConfigForUi(
  provider: EmailAiSettings["providerConfig"]["provider"],
  current: EmailAiSettings["providerConfig"]
): EmailAiSettings["providerConfig"] {
  const defaults: Record<EmailAiSettings["providerConfig"]["provider"], Pick<EmailAiSettings["providerConfig"], "baseUrl" | "model">> = {
    openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
    gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-1.5-flash" },
    openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4.1-mini" },
    custom: { baseUrl: current.baseUrl || "https://api.openai.com/v1", model: current.model || "gpt-4.1-mini" },
    "openai-compatible": { baseUrl: current.baseUrl || "https://api.openai.com/v1", model: current.model || "gpt-4.1-mini" }
  };
  return {
    ...current,
    provider,
    baseUrl: defaults[provider].baseUrl,
    model: defaults[provider].model,
    apiKey: ""
  };
}

function sanitizeAiProviderConfigForPatch(config: Partial<EmailAiSettings["providerConfig"]>): Partial<EmailAiSettings["providerConfig"]> {
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    ...(config.apiKey?.trim() ? { apiKey: config.apiKey.trim() } : {}),
    model: config.model,
    timeoutMs: config.timeoutMs
  };
}

function formatEmailConnectionTestResult(entry: EmailConnectionTestRun["results"][number]): string {
  if (entry.skipped) {
    return entry.reason ?? "已跳过";
  }
  if (!entry.ok) {
    return entry.error ?? "连接测试失败";
  }
  const channels = [
    entry.result?.smtp ? `SMTP ${entry.result.smtp}` : undefined,
    entry.result?.resend ? `Resend ${entry.result.resend}` : undefined,
    entry.result?.imap ? `IMAP ${entry.result.imap}` : undefined,
    entry.result?.pop3 ? `POP3 ${entry.result.pop3}` : undefined,
    entry.result?.oauth ? `OAuth ${entry.result.oauth}` : undefined,
    entry.result?.oauthAccountEmail ? `已授权 ${entry.result.oauthAccountEmail}` : undefined
  ].filter(Boolean);
  return channels.join(" · ") || "连接正常";
}

function formatEmailDiagnosticStatus(status: EmailDiagnosticStatus): string {
  if (status === "ok") {
    return "正常";
  }
  if (status === "warning") {
    return "警告";
  }
  return "错误";
}

function splitEmailList(value: string): string[] {
  return value
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberInputValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function mediaAssetDataUrl(asset: MediaAsset): string {
  return `data:${asset.contentType};base64,${asset.contentBase64}`;
}

async function readEmailAttachmentFile(file: File, onProgress?: (progress: number) => void): Promise<EmailAttachment> {
  if (file.size > MAX_EMAIL_ATTACHMENT_BYTES) {
    throw new Error(`附件 ${file.name} 超过 5 MB。`);
  }
  return {
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    size: file.size,
    contentBase64: await readFileAsBase64(file, onProgress)
  };
}

function readFileAsBase64(file: File, onProgress?: (progress: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.min(98, Math.max(8, Math.round((event.loaded / event.total) * 100))));
      }
    });
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      onProgress?.(100);
      resolve(value.includes(",") ? value.split(",").slice(1).join(",") : value);
    });
    reader.addEventListener("error", () => reject(new Error(`无法读取附件 ${file.name}。`)));
    reader.readAsDataURL(file);
  });
}

function buildEmailConnectionConfig(draft: EmailAccountDraft) {
  const oauthProvider = isOAuthEmailProvider(draft.provider) ? draft.provider : undefined;
  const hasAnyConfig = [
    ...draft.outboundServices.flatMap((service) => [
      service.fromEmail,
      service.smtpHost,
      service.username,
      service.password,
      service.resendApiKey
    ]),
    draft.imapHost,
    draft.pop3Host,
    draft.username,
    draft.password,
    draft.oauthAccessToken,
    draft.oauthRefreshToken
  ].some((value) => value.trim());
  if (!hasAnyConfig) {
    return undefined;
  }
  const outboundServices = draft.outboundServices.map((service) => ({
    id: service.id,
    name: service.name.trim() || (service.type === "smtp" ? "SMTP" : "Resend"),
    type: service.type,
    enabled: draft.sendEnabled && service.enabled,
    fromEmail: service.fromEmail.trim() || draft.emailAddress.trim() || undefined,
    smtpHost: service.type === "smtp" ? service.smtpHost.trim() || undefined : undefined,
    smtpPort: service.type === "smtp" && service.smtpPort ? Number(service.smtpPort) : undefined,
    smtpSecure: service.type === "smtp" ? service.smtpSecure : undefined,
    smtpStartTls: service.type === "smtp" ? service.smtpStartTls : undefined,
    username: service.type === "smtp" ? service.username.trim() || undefined : undefined,
    password: service.type === "smtp" ? service.password || undefined : undefined,
    resendApiKey: service.type === "resend" ? service.resendApiKey.trim() || undefined : undefined
  }));
  return {
    inbound: {
      syncProtocol: draft.syncProtocol,
      imapHost: draft.imapHost.trim() || undefined,
      imapPort: draft.imapPort ? Number(draft.imapPort) : undefined,
      imapSecure: draft.imapSecure,
      pop3Host: draft.pop3Host.trim() || undefined,
      pop3Port: draft.pop3Port ? Number(draft.pop3Port) : undefined,
      pop3Secure: draft.pop3Secure,
      username: draft.username.trim() || undefined,
      password: draft.password || undefined,
      mailbox: draft.mailbox.trim() || "INBOX",
      oauthProvider,
      accessToken: draft.oauthAccessToken.trim() || undefined,
      refreshToken: draft.oauthRefreshToken.trim() || undefined,
      expiresAt: draft.oauthExpiresAt ? new Date(draft.oauthExpiresAt).toISOString() : undefined,
      scope: draft.oauthScope.trim() || undefined
    },
    outboundServices,
    defaultOutboundServiceId: draft.defaultOutboundServiceId || outboundServices[0]?.id
  };
}

function workflowTargetRecordIdFromDefinition(workflow: WorkflowDefinition): string {
  const configuredTarget = workflow.trigger.config?.targetRecordId;
  if (typeof configuredTarget === "string" && configuredTarget.trim()) return configuredTarget.trim();
  const targetCondition = workflow.conditions.find((condition) => condition.key === "target-record" && condition.field === "recordId");
  return typeof targetCondition?.value === "string" ? targetCondition.value : "";
}

function isWorkflowScopedToRecord(workflow: WorkflowDefinition, record: CrmRecord): boolean {
  return workflow.trigger.objectKey === record.objectKey && workflowTargetRecordIdFromDefinition(workflow) === record.id;
}

async function fetchJson<T = unknown>(
  url: string,
  options: {
    method: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
  }
): Promise<T> {
  const response = await fetch(url, {
    method: options.method,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "请求失败");
  }

  return (await response.json().catch(() => ({}))) as T;
}

function titleFor(activeNav: NavKey, activeObjectLabel?: string): string {
  if (coreObjects.has(activeNav) || activeNav === "records") {
    return activeObjectLabel ?? "";
  }

  return navigationItems.find((item) => item.key === activeNav)?.label ?? "AI Agent CRM";
}
