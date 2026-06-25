"use client";

import {
  Activity as ActivityIcon,
  Archive,
  BadgeDollarSign,
  Bold,
  Bot,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
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
  Menu,
  Minus,
  MoreVertical,
  Package,
  Paperclip,
  Pencil,
  FileText,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  Star,
  Tag,
  Trash2,
  Trophy,
  Underline,
  Upload,
  UserPlus,
  UserRound,
  XCircle,
  type LucideIcon
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition, type DragEvent, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SettingsAdmin } from "@/components/settings-admin";
import { convertCurrencyAmount, formatMoneyWithCurrency, getBaseCurrencyCode, getCurrencyDefinitions, normalizeCurrencyCode } from "@/lib/crm/currencies";
import { buildImportJobObservability } from "@/lib/crm/import-observability";
import { crmPathForNav, resolveCrmRoute } from "@/lib/crm/navigation";
import { calculateQuoteTotals, normalizeQuoteFees, normalizeQuoteLineItems, quoteLineItemFromProductForCurrency, type QuoteFee, type QuoteLineItem } from "@/lib/crm/quotes";
import type {
  Activity,
  ApiKey,
  AuditLog,
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
  EmailThread,
  FieldDefinition,
  ImportJobQueueSummary,
  ImportPreset,
  KnowledgeArticle,
  MediaAsset,
  ObjectDefinition,
  Pipeline,
  RecordListResult,
  RelationDefinition,
  Role,
  SavedView,
  Team,
  User,
  WebhookEndpoint
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
import { formatCurrency, formatDate, labelForOption } from "@/lib/utils/format";
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
  emailAccounts: EmailAccount[];
  emailThreads: EmailThread[];
  emailAiSettings: EmailAiSettings;
  emailSyncSettings?: EmailSyncSettings;
  knowledgeArticles: KnowledgeArticle[];
  mediaAssets: MediaAsset[];
  auditLogs: AuditLog[];
  backupFiles: BackupFile[];
  importJobs: CsvImportJob[];
  importPresets: ImportPreset[];
  importJobQueueSummary?: ImportJobQueueSummary;
}

type NavKey = "dashboard" | "contacts" | "companies" | "deals" | "products" | "quotes" | "objects" | "records" | "tasks" | "activities" | "email" | "settings";
type RecordPanelMode = "closed" | "create" | "detail" | "import";
type EmailWorkspaceView = "mail" | "settings" | "ai";
type EmailSettingsStep = "identity" | "inbound" | "outbound" | "review";
type EmailMailboxKey = "inbox" | "starred" | "snoozed" | "important" | "sent" | "drafts" | "archived" | "trash" | "all";
type EmailCategoryKey = "primary" | "promotions" | "social" | "updates";
type EmailMailMode = "list" | "detail";
type EmailThreadUiState = {
  archived?: boolean;
  category?: EmailCategoryKey;
  deleted?: boolean;
  important?: boolean;
  labels?: string[];
  read?: boolean;
  snoozedUntil?: string;
  starred?: boolean;
};
type AiSource = { label: string; objectKey?: string; recordId?: string; activityId?: string };
type AiResponse = { text: string; sources: AiSource[] };
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
};
type EmailSignatureOption = {
  id: string;
  label: string;
  bodyText: string;
  bodyHtml: string;
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
type TaskDetailsPayload = {
  format: "task.v1";
  text: string;
  attachments: TaskAttachment[];
};
type TaskEditDraft = {
  title: string;
  dueAt: string;
  text: string;
  attachments: TaskAttachment[];
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

function buildEmailHtmlPreview(bodyHtml: string): string {
  const repairedHtml = repairEmailMojibake(bodyHtml);
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    '<base target="_blank">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: cid:; style-src \'unsafe-inline\'; font-src data:;">',
    "<style>html,body{margin:0;padding:12px;background:#fff;color:#111827;font:14px/1.5 Arial,sans-serif;overflow-wrap:anywhere;}table{max-width:100%;}img{max-width:100%;height:auto;}</style>",
    "</head><body>",
    repairedHtml,
    "</body></html>"
  ].join("");
}

function hasEmailHtmlPreview(message: EmailMessage): boolean {
  return Boolean(message.bodyHtml?.trim());
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

function getEmailSignatureOptions(accounts: EmailAccount[], selectedAccountId: string): EmailSignatureOption[] {
  const account = accounts.find((candidate) => candidate.id === selectedAccountId) ?? accounts[0];
  const sender = account?.emailAddress || "Sales team";
  return [
    { id: noEmailSignatureId, label: "不使用签名", bodyText: "", bodyHtml: "" },
    {
      id: "default",
      label: "默认签名",
      bodyText: `Best regards,\n${sender}`,
      bodyHtml: `<p>Best regards,<br>${escapeHtml(sender)}</p>`
    },
    {
      id: "cn-sales",
      label: "中文商务签名",
      bodyText: `谢谢，\n${sender}`,
      bodyHtml: `<p>谢谢，<br>${escapeHtml(sender)}</p>`
    }
  ];
}

function getSelectedEmailSignature(draft: EmailComposeDraft, accounts: EmailAccount[]): EmailSignatureOption {
  const options = getEmailSignatureOptions(accounts, draft.accountId);
  return options.find((signature) => signature.id === (draft.signatureId || noEmailSignatureId)) ?? options[0];
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

function prepareEmailDraftForSend(draft: EmailComposeDraft, accounts: EmailAccount[]): EmailComposeDraft {
  const signature = getSelectedEmailSignature(draft, accounts);
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
  return Array.from(labels);
}

function getEmailThreadDisplayLabels(thread: EmailThread, state: EmailThreadUiState = {}, messages: EmailMessage[] = []): string[] {
  return Array.from(new Set([...(state.labels ?? thread.labels ?? []), ...buildEmailThreadLabels(thread, messages)]));
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
  return messages.some((message) => message.direction === "outbound" || message.status === "sent" || message.status === "queued" || message.status === "sending");
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

export function CrmWorkspace(props: CrmWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeRecordId = searchParams.get("recordId") ?? "";
  const routeReturnEmailThreadId = searchParams.get("returnEmailThreadId") ?? "";
  const routeEmailThreadId = searchParams.get("emailThreadId") ?? "";
  const routeMode = searchParams.get("mode") ?? "";
  const routeCompanyId = searchParams.get("companyId") ?? "";
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
  const [recordListObjectKey, setRecordListObjectKey] = useState(props.initialObjectKey);
  const [recordList, setRecordList] = useState<RecordListResult>(() => props.initialRecordList);
  const [isRecordListLoading, setIsRecordListLoading] = useState(false);
  const [viewDraft, setViewDraft] = useState<ViewDraft>(emptyViewDraft);
  const [query, setQuery] = useState("");
  const [recordPanelMode, setRecordPanelMode] = useState<RecordPanelMode>(routeRecordId ? "detail" : "closed");
  const [recordReturnEmailThreadId, setRecordReturnEmailThreadId] = useState(routeReturnEmailThreadId);
  const [recordEmailActivityFilter, setRecordEmailActivityFilter] = useState("");
  const [showListSettings, setShowListSettings] = useState(false);
  const [createFormObjectKey, setCreateFormObjectKey] = useState(props.initialObjectKey);
  const [createTitle, setCreateTitle] = useState("");
  const [createOwnerId, setCreateOwnerId] = useState(props.contextUser.id);
  const [createValues, setCreateValues] = useState<Record<string, string>>({});
  const [editTitle, setEditTitle] = useState("");
  const [editOwnerId, setEditOwnerId] = useState("");
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [dealCloseReason, setDealCloseReason] = useState("");
  const [activityType, setActivityType] = useState<Activity["type"]>("note");
  const [activityTitle, setActivityTitle] = useState("");
  const [activityBody, setActivityBody] = useState("");
  const [activityDueAt, setActivityDueAt] = useState("");
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
  const [emailThreads, setEmailThreads] = useState<EmailThread[]>(props.emailThreads);
  const [emailMessagesByThread, setEmailMessagesByThread] = useState<Record<string, EmailMessage[]>>({});
  const [selectedEmailThreadId, setSelectedEmailThreadId] = useState(routeEmailThreadId || props.emailThreads[0]?.id || "");
  const [emailDetailThreadId, setEmailDetailThreadId] = useState(routeEmailThreadId);
  const [emailWorkspaceView, setEmailWorkspaceView] = useState<EmailWorkspaceView>("mail");
  const [emailAiSettings, setEmailAiSettings] = useState<EmailAiSettings>(props.emailAiSettings);
  const [emailSyncSettings, setEmailSyncSettings] = useState<EmailSyncSettings>(props.emailSyncSettings ?? defaultEmailSyncSettings);
  const [emailAccountDraft, setEmailAccountDraft] = useState<EmailAccountDraft>(() => createEmptyEmailAccountDraft());
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
    aiAssisted: false
  });
  const [emailAiPurpose, setEmailAiPurpose] = useState<"draft" | "translate" | "context_analysis" | "summarize">("draft");
  const [emailAiPrompt, setEmailAiPrompt] = useState("");
  const [emailAiResult, setEmailAiResult] = useState<EmailAiGenerateResult | null>(null);
  const [emailDiagnostics, setEmailDiagnostics] = useState<EmailSubsystemDiagnostics | null>(null);
  const [emailConnectionTestRun, setEmailConnectionTestRun] = useState<EmailConnectionTestRun | null>(null);
  const [knowledgeArticles, setKnowledgeArticles] = useState<KnowledgeArticle[]>(props.knowledgeArticles);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>(props.mediaAssets);
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
  const previousCreateFormResetKey = useRef("");
  const previousViewDraftResetKey = useRef("");
  const previousEditFormResetKey = useRef("");
  const pendingRecordOpenRef = useRef<{ objectKey: string; recordId: string; returnEmailThreadId: string } | null>(null);
  const pendingRecordCreateRef = useRef<{ objectKey: string; values: Record<string, string> } | null>(null);
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const promptResolverRef = useRef<((value: string | null) => void) | null>(null);

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
  const filteredRecords = objectRecords;
  const exportRecordsUrl = activeObject ? buildRecordListUrl(activeObject.key, effectiveView, query, 1, `/api/records/${activeObject.key}/export`, 200) : "#";
  const importTemplateUrl = activeObject ? `/api/imports/templates/${activeObject.key}` : "#";
  const importFieldGuideUrl = activeObject ? `/api/imports/templates/${activeObject.key}/fields` : "#";
  const selectedRecord = useMemo(
    () =>
      records.find((record) => record.id === selectedRecordId && record.objectKey === activeObject?.key) ??
      filteredRecords[0] ??
      objectRecords[0],
    [activeObject?.key, filteredRecords, objectRecords, records, selectedRecordId]
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
    setRecords(mergeRecords(props.records, props.initialRecordList.records, props.dashboardSummary.deals));
    setActivities(mergeActivities(props.activities, props.dashboardSummary.openTasks, props.dashboardSummary.recentActivities));
    setRecordList(props.initialRecordList);
    setRecordListObjectKey(props.initialObjectKey);
  }, [props.activities, props.dashboardSummary.deals, props.dashboardSummary.openTasks, props.dashboardSummary.recentActivities, props.initialObjectKey, props.initialRecordList, props.records]);

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
  }, [activeObjectKey, query, selectedViewId, viewDraft.filterField, viewDraft.filterOperator, viewDraft.filterValue, viewDraft.sortField, viewDraft.sortDirection]);

  useEffect(() => {
    setImportJobs(props.importJobs);
  }, [props.importJobs]);

  useEffect(() => {
    setImportPresets(props.importPresets);
  }, [props.importPresets]);

  useEffect(() => {
    setRecordEmailActivityFilter("");
  }, [selectedRecord?.id]);

  useEffect(() => {
    setEmailAccounts(props.emailAccounts);
    setEmailThreads(props.emailThreads);
    setEmailAiSettings(props.emailAiSettings);
    setEmailSyncSettings(props.emailSyncSettings ?? defaultEmailSyncSettings);
    setKnowledgeArticles(props.knowledgeArticles);
    setMediaAssets(props.mediaAssets);
    setEmailDraft((current) => {
      const accountId = current.accountId || props.emailAccounts[0]?.id || "";
      return accountId === current.accountId ? current : clearEmailDraftAiProvenance({ ...current, accountId });
    });
    const preferredThreadId = routeEmailThreadId || selectedEmailThreadId;
    const nextSelectedThreadId = props.emailThreads.some((thread) => thread.id === preferredThreadId) ? preferredThreadId : props.emailThreads[0]?.id ?? "";
    if (nextSelectedThreadId !== selectedEmailThreadId) {
      setEmailDraft((current) => clearEmailDraftAiProvenance(current));
      setSelectedEmailThreadId(nextSelectedThreadId);
    }
  }, [props.emailAccounts, props.emailAiSettings, props.emailSyncSettings, props.emailThreads, props.knowledgeArticles, props.mediaAssets, routeEmailThreadId, selectedEmailThreadId]);

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
      return undefined;
    }

    const controller = new AbortController();
    setIsRecordListLoading(true);

    fetchJson<RecordListResult>(buildRecordListUrl(activeObject.key, effectiveView, query, recordPage), {
      method: "GET",
      signal: controller.signal
    })
      .then(async (result) => {
        if (!Array.isArray(result.records)) {
          throw new Error("Record list response is invalid");
        }
        const referenceObjectKeys = getReferenceObjectKeysForObject(props.fields, activeObject.key, props.relations);
        const referenceLists = await Promise.all(
          [...referenceObjectKeys].map((objectKey) =>
            fetchJson<RecordListResult>(buildRecordListUrl(objectKey, emptySavedView(objectKey), "", 1), {
              method: "GET",
              signal: controller.signal
            })
          )
        );
        setRecordList(result);
        setRecordListObjectKey(activeObject.key);
        setRecords((current) => mergeRecords(current, result.records, ...referenceLists.map((list) => list.records)));
      })
      .catch((listError) => {
        if (listError instanceof DOMException && listError.name === "AbortError") {
          return;
        }
        setError(listError instanceof Error ? listError.message : "列表加载失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsRecordListLoading(false);
        }
      });

    return () => controller.abort();
  }, [activeObject, effectiveView, props.fields, props.relations, query, recordPage]);

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
      setActivityType("note");
      setActivityTitle("");
      setActivityBody("");
      setActivityDueAt("");
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
    setActivityType("note");
    setActivityTitle("");
    setActivityBody("");
    setActivityDueAt("");
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

  function openRecord(record: CrmRecord, options: { returnEmailThreadId?: string } = {}) {
    const nextNav = coreObjects.has(record.objectKey) ? (record.objectKey as NavKey) : "records";
    const nextPath = crmPathForNav(nextNav, record.objectKey);
    const detailParams = new URLSearchParams({ recordId: record.id });
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
      router.push(crmPathForNav(coreObjects.has(activeObject.key) ? activeObject.key : "records", activeObject.key));
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

  async function submitUpdateRecord() {
    if (!selectedRecord) {
      return;
    }

    await fetchJson(`/api/records/${selectedRecord.objectKey}/${selectedRecord.id}`, {
      method: "PATCH",
      body: {
        title: editTitle.trim(),
        data: parseFormValues(selectedFields, editValues, selectedRecord.objectKey, currencyRecords),
        stageKey: selectedRecord.objectKey === "deals" ? String(editValues.__stageKey ?? selectedRecord.stageKey ?? "") : undefined,
        ownerId: editOwnerId || undefined
      }
    });

    setMessage("记录已更新");
    router.refresh();
  }

  async function submitDeleteRecord() {
    if (!selectedRecord) {
      return;
    }
    if (
      !(await requestConfirm({
        title: "删除记录",
        message: `确定删除记录“${selectedRecord.title}”？相关活动也会被删除。`,
        confirmLabel: "删除",
        danger: true
      }))
    ) {
      return;
    }

    await fetchJson(`/api/records/${selectedRecord.objectKey}/${selectedRecord.id}`, { method: "DELETE" });
    setMessage("记录已删除");
    setRecordPanelMode("closed");
    router.refresh();
  }

  async function submitCreateActivity() {
    if (!selectedRecord) {
      return;
    }

    await postJson("/api/activities", {
      recordId: selectedRecord.id,
      type: activityType,
      title: activityTitle.trim(),
      body: activityBody.trim() || undefined,
      dueAt: activityType === "task" && activityDueAt ? activityDueAt : undefined
    });

    setMessage(`已添加${activityType === "task" ? "任务" : "活动"}`);
    setActivityType("note");
    setActivityTitle("");
    setActivityBody("");
    setActivityDueAt("");
    router.refresh();
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

  async function moveDealStage(record: CrmRecord, stageKey: string) {
    const updated = await fetchJson<CrmRecord>(`/api/records/${record.objectKey}/${record.id}`, {
      method: "PATCH",
      body: { stageKey }
    });
    setRecords((current) => mergeRecords(current, [updated]));
    setMessage("交易阶段已更新");
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
    if (
      !(await requestConfirm({
        title: "删除任务",
        message: `确定删除任务“${activity.title}”？`,
        confirmLabel: "删除",
        danger: true
      }))
    ) {
      return;
    }
    await fetchJson(`/api/activities/${activity.id}`, { method: "DELETE" });
    setDeletedActivityIds((current) => new Set([...current, activity.id]));
    setActivities((current) => current.filter((candidate) => candidate.id !== activity.id));
    showSuccess("任务已删除");
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

  async function openEmailThread(threadId: string) {
    const nextEmailThreadPath = `${crmPathForNav("email")}?emailThreadId=${encodeURIComponent(threadId)}`;
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
    setRecords((current) => mergeRecords(current, [record]));
    setSelectedRecordId(record.id);
    setSelectedEmailThreadId("");
    setEmailDetailThreadId("");
    setEmailAiResult(null);
    setEmailDraft((current) =>
      clearEmailDraftAiProvenance({
        ...current,
        accountId: current.accountId || emailAccounts.find((account) => account.status === "active" && account.sendEnabled && account.connectionConfigured)?.id || "",
        recordId: record.id,
        to: emailAddress,
        cc: "",
        bcc: "",
        subject: "",
        bodyText: "",
        attachments: []
      })
    );
    setEmailWorkspaceView("mail");
    navigateToWorkspace("email");
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

  async function deleteEmailThread(threadId: string) {
    await deleteEmailThreads([threadId]);
  }

  async function deleteEmailThreads(threadIds: string[]) {
    const ids = Array.from(new Set(threadIds)).filter(Boolean);
    if (!ids.length) {
      return;
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
      return;
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
    setMessage(ids.length > 1 ? `已彻底删除 ${ids.length} 个邮件线程` : "邮件线程已彻底删除");
    router.refresh();
  }

  async function sendEmail() {
    const preparedDraft = prepareEmailDraftForSend(emailDraft, emailAccounts);
    const message = await fetchJson<EmailMessage>("/api/email/send", {
      method: "POST",
      body: {
        accountId: emailDraft.accountId,
        threadId: selectedEmailThreadId || undefined,
        recordId: emailDraft.recordId || selectedRecord?.id,
        to: splitEmailList(emailDraft.to),
        cc: splitEmailList(emailDraft.cc),
        bcc: splitEmailList(emailDraft.bcc),
        subject: emailDraft.subject,
        bodyText: preparedDraft.bodyText,
        bodyHtml: preparedDraft.bodyHtml,
        clientRequestId: emailDraft.clientRequestId,
        attachments: preparedDraft.attachments?.length ? preparedDraft.attachments : undefined,
        aiAssisted: emailDraft.aiAssisted || undefined,
        aiPurpose: emailDraft.aiAssisted ? emailDraft.aiPurpose : undefined,
        aiSourceMessageId: emailDraft.aiAssisted ? emailDraft.aiSourceMessageId : undefined,
        aiSources: emailDraft.aiAssisted ? emailDraft.aiSources : undefined,
        aiGeneratedAt: emailDraft.aiAssisted ? emailDraft.aiGeneratedAt : undefined
      }
    });
    setEmailMessagesByThread((current) => ({ ...current, [message.threadId]: upsertEmailMessage(current[message.threadId] ?? [], message) }));
    selectEmailThread(message.threadId);
    setEmailDraft((current) => ({
      ...current,
      clientRequestId: createEmailClientRequestId(),
      to: "",
      cc: "",
      bcc: "",
      subject: "",
      bodyText: "",
      bodyHtml: "",
      signatureId: "",
      replyOriginalBodyText: undefined,
      replyOriginalBodyHtml: undefined,
      replyOriginalFrom: undefined,
      replyOriginalSentAt: undefined,
      attachments: [],
      aiAssisted: false,
      aiPurpose: undefined,
      aiSourceMessageId: undefined,
      aiSources: undefined,
      aiGeneratedAt: undefined
    }));
    setMessage(formatEmailSendResultMessage(message));
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
    const imageFiles = Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) {
      showToast({ intent: "info", message: "请选择图片文件。" });
      return [];
    }
    const createdAssets: MediaAsset[] = [];
    for (const file of imageFiles.slice(0, 10)) {
      if (file.size > MAX_EMAIL_ATTACHMENT_BYTES) {
        showToast({ intent: "error", message: `${file.name} 超过 ${formatBytes(MAX_EMAIL_ATTACHMENT_BYTES)}，已跳过。` });
        continue;
      }
      const asset = await fetchJson<MediaAsset>("/api/media-assets", {
        method: "POST",
        body: {
          name: file.name,
          contentType: file.type || "image/png",
          size: file.size,
          contentBase64: await readFileAsBase64(file)
        }
      });
      createdAssets.push(asset);
    }
    if (createdAssets.length) {
      setMediaAssets((current) => mergeMediaAssets(createdAssets, current));
      showSuccess(`已上传 ${createdAssets.length} 张图片到媒体库`);
    }
    return createdAssets;
  }

  async function updateMediaAsset(assetId: string, patch: Partial<Pick<MediaAsset, "name" | "contentType" | "size" | "contentBase64">>) {
    const updated = await fetchJson<MediaAsset>(`/api/media-assets/${assetId}`, {
      method: "PATCH",
      body: patch
    });
    setMediaAssets((current) => mergeMediaAssets([updated], current.filter((asset) => asset.id !== updated.id)));
    showSuccess(`媒体图片已更新：${updated.name}`);
  }

  async function deleteMediaAsset(asset: MediaAsset) {
    if (
      !(await requestConfirm({
        title: "删除媒体图片",
        message: `确定从媒体库删除“${asset.name}”？已经使用该图片的记录不会自动清空。`,
        confirmLabel: "删除",
        danger: true
      }))
    ) {
      return;
    }
    await fetchJson(`/api/media-assets/${asset.id}`, { method: "DELETE" });
    setMediaAssets((current) => current.filter((candidate) => candidate.id !== asset.id));
    showSuccess(`媒体图片已删除：${asset.name}`);
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

  function toggleAppSidebar() {
    setAppSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(sidebarCollapsedStorageKey, String(next));
      return next;
    });
  }

  const showRecordWorkspace = coreObjects.has(activeNav) || activeNav === "records";

  return (
    <div
      className={`app-shell ${appSidebarCollapsed ? "sidebar-collapsed" : ""}`}
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
        <div className="topbar">
          <div className="topbar-title">
            <AppSidebarToggleButton collapsed={appSidebarCollapsed} onToggle={toggleAppSidebar} />
            <div>
              <h1 className="page-title">{titleFor(activeNav, activeObject?.pluralLabel)}</h1>
              <div className="subtle">模块化单体、真实 API、真实表单和可配置 CRM 元数据已经接通。</div>
            </div>
          </div>
          <div className="toolbar">
            <button className="secondary-button" type="button" onClick={() => router.refresh()}>
              <RefreshCw className={isPending ? "spin-icon" : undefined} size={16} />
              刷新
            </button>
            {showRecordWorkspace && activeObject ? (
              <a
                className="secondary-button"
                data-testid="topbar-export-records"
                download={`${activeObject.key}-export.csv`}
                href={exportRecordsUrl}
              >
                <Download size={16} />
                导出
              </a>
            ) : null}
          </div>
        </div>
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
            onOpenObject={openObject}
            onOpenDeal={openRecord}
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
                <label>
                  <span className="subtle">搜索</span>
                  <input
                    className="input"
                    data-testid={`record-search-${activeObject.key}`}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={`搜索${activeObject.pluralLabel}`}
                  />
                </label>
                <span className="icon-button" aria-label="当前列表由保存视图驱动" title="当前列表由保存视图驱动">
                  <Filter size={16} />
                </span>
                <button className="secondary-button" type="button" onClick={() => setShowListSettings((current) => !current)}>
                  <LayoutList size={16} />
                  列表设置
                </button>
                <a className="secondary-button" href={exportRecordsUrl} download={`${activeObject.key}-export.csv`} data-testid={`export-records-${activeObject.key}`}>
                  <Download size={16} />
                  导出
                </a>
                <button className="secondary-button" type="button" onClick={() => setRecordPanelMode("import")}>
                  <Upload size={16} />
                  导入
                </button>
                <button
                  className="primary-button"
                  data-testid={`open-create-record-${activeObject.key}`}
                  type="button"
                  onClick={() => setRecordPanelMode("create")}
                  disabled={isPending}
                >
                  <UserRound size={16} />
                  新建
                </button>
              </div>
              <div className="list-tools" style={{ paddingTop: 0 }}>
                <span className="subtle">
                  {isRecordListLoading ? "列表加载中..." : `显示 ${filteredRecords.length} / ${recordList.total} 条`}
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
                    {recordList.page} / {recordList.pageCount}
                  </span>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setRecordPage((current) => Math.min(recordList.pageCount, current + 1))}
                    disabled={isRecordListLoading || recordList.page >= recordList.pageCount}
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
                          <RecordTitleButton record={record} onOpen={() => openRecord(record)} />
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
            </section>
            )}

            {recordPanelMode !== "closed" && (
            <aside className="detail-panel record-drawer">
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
                      onUploadMediaAssets={(files) => runAction(() => uploadMediaAssets(files).then(() => undefined))}
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
                    <div className="form-grid" style={{ marginTop: 12 }}>
                      <label className="wide">
                        <span className="subtle">名称</span>
                        <input className="input" data-testid="edit-record-title" value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
                      </label>
                      <OwnerSelect
                        disabled={!canManageViews}
                        testId="edit-record-owner"
                        users={props.users}
                        value={editOwnerId}
                        onChange={setEditOwnerId}
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
                        <FieldInput
                          key={`edit-${field.id}`}
                          field={field}
                          value={editValues[field.key] ?? ""}
                          allRecords={records}
                          mediaAssets={mediaAssets}
                          users={props.users}
                          testId={`edit-field-${selectedRecord.objectKey}-${field.key}`}
                          onRecordsLoaded={mergeLoadedRecords}
                          onUploadMediaAssets={(files) => runAction(() => uploadMediaAssets(files).then(() => undefined))}
                          onChange={(nextValue) => setEditValues((current) => ({ ...current, [field.key]: nextValue }))}
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
                      {selectedRecord.objectKey === "contacts" ? (
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
                          <CompanyAddressesEditor
                            title="Billing address"
                            testIdPrefix="edit-company-billing-address"
                            value={editValues[companyBillingAddressesValueKey] ?? ""}
                            onChange={(addresses) => setEditValues((current) => withCompanyAddressValues(current, companyBillingAddressesValueKey, addresses))}
                          />
                          <CompanyAddressesEditor
                            title="Shipping address"
                            testIdPrefix="edit-company-shipping-address"
                            value={editValues[companyShippingAddressesValueKey] ?? ""}
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
                      <button className="danger-button" type="button" onClick={() => runAction(submitDeleteRecord)} disabled={isPending}>
                        <Trash2 size={16} />
                        删除
                      </button>
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

                    {selectedRecord.objectKey === "companies" && (
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

                    {(selectedRecordEmailAddresses.length > 0 || selectedRecordEmailThreads.length > 0) && (
                      <section style={{ marginTop: 16 }}>
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

                    {selectedRecord.objectKey === "deals" && (
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

                    <section style={{ marginTop: 16 }}>
                      <div className="property-name" style={{ marginBottom: 8 }}>
                        记录活动
                      </div>
                      <div className="form-grid">
                        <label>
                          <span className="subtle">类型</span>
                          <select className="select" data-testid="activity-type" value={activityType} onChange={(event) => setActivityType(event.target.value as Activity["type"])}>
                            <option value="note">备注</option>
                            <option value="call">电话</option>
                            <option value="meeting">会议</option>
                            <option value="task">任务</option>
                          </select>
                        </label>
                        {activityType === "task" && (
                          <label>
                            <span className="subtle">截止日期</span>
                            <input className="input" data-testid="activity-due-at" type="date" value={activityDueAt} onChange={(event) => setActivityDueAt(event.target.value)} />
                          </label>
                        )}
                        <label className="wide">
                          <span className="subtle">标题</span>
                          <input className="input" data-testid="activity-title" value={activityTitle} onChange={(event) => setActivityTitle(event.target.value)} />
                        </label>
                        <label className="wide">
                          <span className="subtle">内容</span>
                          <textarea className="textarea" data-testid="activity-body" value={activityBody} onChange={(event) => setActivityBody(event.target.value)} />
                        </label>
                      </div>
                      <div className="toolbar" style={{ marginTop: 12 }}>
                        <button
                          className="secondary-button"
                          data-testid="activity-submit"
                          type="button"
                          onClick={() => runAction(submitCreateActivity)}
                          disabled={isPending || !activityTitle.trim() || (activityType === "task" && !activityDueAt)}
                        >
                          <Save size={16} />
                          添加活动
                        </button>
                      </div>
                    </section>

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

                    <section style={{ marginTop: 16 }}>
                      <div className="property-name" style={{ marginBottom: 8 }}>
                        任务
                      </div>
                      <TaskList
                        activities={selectedTasks}
                        emptyMessage="暂无任务"
                        mediaAssets={mediaAssets}
                        testIdPrefix="record-task"
                        users={props.users}
                        onArchive={(activity, archived) => runAction(() => toggleTaskArchive(activity, archived))}
                        onDelete={(activity) => runAction(() => deleteTask(activity))}
                        onEdit={(activity) => {
                          navigateToWorkspace("tasks");
                          showToast({ intent: "info", message: `请在任务工作台中编辑“${activity.title}”。` });
                        }}
                        onToggle={(activity, completed) => runAction(() => toggleTaskCompletion(activity, completed))}
                      />
                    </section>

                    <section style={{ marginTop: 16 }}>
                      <div className="property-name" style={{ marginBottom: 8 }}>
                        备注
                      </div>
                      <ActivityList
                        activities={selectedNotes}
                        emptyMessage="暂无备注"
                        testIdPrefix="record-note"
                        renderMeta={(activity) => (
                          <>
                            <ActivityIcon size={15} />
                            {formatDate(activity.createdAt)}
                          </>
                        )}
                      />
                    </section>

                    <section style={{ marginTop: 16 }}>
                      <div className="property-name" style={{ marginBottom: 8 }}>
                        活动时间线
                      </div>
                      <ActivityList
                        activities={selectedActivities}
                        emptyMessage="暂无活动"
                        testIdPrefix="record-activity"
                        renderMeta={(activity) => (
                          <>
                            <ActivityIcon size={15} />
                            {formatActivityType(activity.type)} · {formatDate(activity.createdAt)}
                          </>
                        )}
                      />
                    </section>

                    {coreObjects.has(selectedRecord.objectKey) && (
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
            threads={emailThreads}
            messagesByThread={emailMessagesByThread}
            selectedThreadId={selectedEmailThreadId}
            detailThreadId={emailDetailThreadId}
            view={emailWorkspaceView}
            selectedRecord={selectedRecord}
            records={records}
            aiSettings={emailAiSettings}
            syncSettings={emailSyncSettings}
            accountDraft={emailAccountDraft}
            emailDraft={emailDraft}
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
            onEmailDraftChange={setEmailDraft}
            onKnowledgeDraftChange={setKnowledgeDraft}
            onUploadMediaAssets={uploadMediaAssets}
            onAiPurposeChange={setEmailAiPurpose}
            onAiPromptChange={setEmailAiPrompt}
            onViewChange={setEmailWorkspaceView}
            onSelectThread={(threadId) => {
              selectEmailThread(threadId);
              if (!emailMessagesByThread[threadId]) {
                runAction(() => loadEmailMessages(threadId));
              }
            }}
            onUpdateThread={(threadId, recordId) => runAction(() => updateEmailThread(threadId, recordId))}
            onUpdateThreadState={(threadId, patch) => updateEmailThreadState(threadId, patch)}
            onDeleteThread={(threadId) => runAction(() => deleteEmailThread(threadId))}
            onDeleteThreads={(threadIds) => runAction(() => deleteEmailThreads(threadIds))}
            onCreateContactFromEmail={(threadId, emailAddress) => runAction(() => createContactFromEmail(threadId, emailAddress))}
            onLinkExistingContactFromEmail={(threadId, contactId, emailAddress) => runAction(() => linkExistingContactFromEmail(threadId, contactId, emailAddress))}
            onUnlinkContactEmailFromThread={(threadId, contactId, emailAddress) => runAction(() => unlinkContactEmailFromThread(threadId, contactId, emailAddress))}
            onOpenEmailContact={(threadId, contact) => openEmailContact(threadId, contact)}
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
            onUpdateMediaAsset={(assetId, patch) => runAction(() => updateMediaAsset(assetId, patch))}
            onDeleteMediaAsset={(asset) => runAction(() => deleteMediaAsset(asset))}
            onToggleAiFeature={(feature, enabled) => runAction(() => updateEmailAiFeature(feature, enabled))}
            onUpdateAiSettings={(patch) => runAction(() => updateEmailAiSettingsPatch(patch))}
            onUpdateSyncSettings={(patch) => runAction(() => updateEmailSyncSettingsPatch(patch))}
            onShowToast={showToast}
            onShowSuccess={showSuccess}
            onRequestPrompt={requestPrompt}
            sidebarCollapsed={appSidebarCollapsed}
            onToggleAppSidebar={toggleAppSidebar}
          />
        )}
        {activeNav === "tasks" && (
          <TaskView
            activities={taskActivities}
            mediaAssets={mediaAssets}
            users={props.users}
            onToggle={(activity, completed) => runAction(() => toggleTaskCompletion(activity, completed))}
            onArchive={(activity, archived) => runAction(() => toggleTaskArchive(activity, archived))}
            onDelete={(activity) => runAction(() => deleteTask(activity))}
            onCreateTask={(input) => runAction(() => createTaskFromCalendar(input))}
            onUpdateTask={(activity, draft) => runAction(() => updateTask(activity, draft))}
            onUploadMediaAssets={uploadMediaAssets}
            onRequestPrompt={requestPrompt}
            onShowToast={showToast}
          />
        )}
        {activeNav === "activities" && <ActivityTimeline activities={activities} records={records} />}
        {activeNav === "settings" && (
          <SettingsAdmin
            role={props.role}
            objects={props.objects}
            fields={props.fields}
            relations={props.relations}
            pipelines={props.pipelines}
            savedViews={props.savedViews}
            records={records}
            roles={props.roles}
            users={props.users}
            teams={props.teams}
            apiKeys={props.apiKeys}
            webhooks={props.webhooks}
            auditLogs={props.auditLogs}
            backupFiles={props.backupFiles}
            importJobQueueSummary={props.importJobQueueSummary}
          />
        )}

      </main>
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

function Dashboard({
  objects,
  recordCounts,
  openTasks,
  openTaskCount,
  totalPipeline,
  pipelines,
  deals,
  onOpenObject,
  onOpenDeal,
  onMoveDealStage
}: {
  objects: ObjectDefinition[];
  recordCounts: Record<string, number>;
  openTasks: Activity[];
  openTaskCount: number;
  totalPipeline: number;
  pipelines: Pipeline[];
  deals: CrmRecord[];
  onOpenObject: (objectKey: string) => void;
  onOpenDeal: (deal: CrmRecord) => void;
  onMoveDealStage: (deal: CrmRecord, stageKey: string) => void;
}) {
  const defaultPipeline = pipelines.find((pipeline) => pipeline.objectKey === "deals" && pipeline.isDefault);
  const [draggedDealId, setDraggedDealId] = useState("");

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
  threads,
  messagesByThread,
  selectedThreadId,
  detailThreadId,
  view,
  selectedRecord,
  records,
  aiSettings,
  syncSettings,
  accountDraft,
  emailDraft,
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
  onEmailDraftChange,
  onKnowledgeDraftChange,
  onUploadMediaAssets,
  onAiPurposeChange,
  onAiPromptChange,
  onViewChange,
  onSelectThread,
  onUpdateThread,
  onUpdateThreadState,
  onDeleteThread,
  onDeleteThreads,
  onCreateContactFromEmail,
  onLinkExistingContactFromEmail,
  onUnlinkContactEmailFromThread,
  onOpenEmailContact,
  onCreateAccount,
  onStartOAuth,
  onSyncAccount,
  onSyncAllAccounts,
  onTestConnection,
  onEditAccount,
  onUpdateAccount,
  onUpdateAccountFromDraft,
  onResetAccountDraft,
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
  onUpdateMediaAsset,
  onDeleteMediaAsset,
  onToggleAiFeature,
  onUpdateAiSettings,
  onUpdateSyncSettings,
  onShowToast,
  onShowSuccess,
  onRequestPrompt,
  sidebarCollapsed,
  onToggleAppSidebar
}: {
  accounts: EmailAccount[];
  threads: EmailThread[];
  messagesByThread: Record<string, EmailMessage[]>;
  selectedThreadId: string;
  detailThreadId: string;
  view: EmailWorkspaceView;
  selectedRecord?: CrmRecord;
  records: CrmRecord[];
  aiSettings: EmailAiSettings;
  syncSettings: EmailSyncSettings;
  accountDraft: EmailAccountDraft;
  emailDraft: EmailComposeDraft;
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
  onEmailDraftChange: (draft: EmailComposeDraft) => void;
  onKnowledgeDraftChange: (draft: KnowledgeArticleDraft) => void;
  onUploadMediaAssets: (files: FileList | File[] | null) => Promise<MediaAsset[]>;
  onAiPurposeChange: (purpose: EmailAiGenerateResult["purpose"]) => void;
  onAiPromptChange: (prompt: string) => void;
  onViewChange: (view: EmailWorkspaceView) => void;
  onSelectThread: (threadId: string) => void;
  onUpdateThread: (threadId: string, recordId: string) => void;
  onUpdateThreadState: (threadId: string, patch: Partial<EmailThreadUiState>) => Promise<EmailThread>;
  onDeleteThread: (threadId: string) => void;
  onDeleteThreads: (threadIds: string[]) => void;
  onCreateContactFromEmail: (threadId: string, emailAddress: string) => void;
  onLinkExistingContactFromEmail: (threadId: string, contactId: string, emailAddress: string) => void;
  onUnlinkContactEmailFromThread: (threadId: string, contactId: string, emailAddress: string) => void;
  onOpenEmailContact: (threadId: string, contact: CrmRecord) => void;
  onCreateAccount: () => void;
  onStartOAuth: () => void;
  onSyncAccount: (accountId: string) => void;
  onSyncAllAccounts: () => void;
  onTestConnection: (accountId: string, options?: { scope?: EmailConnectionTestScope; outboundServiceId?: string }) => Promise<void>;
  onEditAccount: (account: EmailAccount) => void;
  onUpdateAccount: (accountId: string, patch: EmailAccountUpdatePatch) => void;
  onUpdateAccountFromDraft: () => void;
  onResetAccountDraft: () => void;
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
  onRequestPrompt: (options: PromptDialogState) => Promise<string | null>;
  sidebarCollapsed: boolean;
  onToggleAppSidebar: () => void;
}) {
  const selectedThread = threads.find((thread) => thread.id === selectedThreadId);
  const selectedMessages = selectedThread ? messagesByThread[selectedThread.id] ?? [] : [];
  const activeAccounts = accounts.filter((account) => account.status === "active" && account.sendEnabled && account.connectionConfigured && getEmailProviderCapability(account.provider).supportsSend);
  const linkedRecordId = emailDraft.recordId || selectedRecord?.id || selectedThread?.recordId || "";
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
  const [mailbox, setMailbox] = useState<EmailMailboxKey>("inbox");
  const [category, setCategory] = useState<EmailCategoryKey>("primary");
  const [mailMode, setMailMode] = useState<EmailMailMode>("list");
  const [selectedMailboxAccountId, setSelectedMailboxAccountId] = useState<string>(allEmailAccountsKey);
  const [searchQuery, setSearchQuery] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(() => new Set());
  const [threadUiState, setThreadUiState] = useState<Record<string, EmailThreadUiState>>(() => buildEmailThreadUiStateMap(threads));
  const selectedThreadState = selectedThread ? threadUiState[selectedThread.id] ?? {} : {};
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMinimized, setComposeMinimized] = useState(false);
  const [emailSettingsStep, setEmailSettingsStep] = useState<EmailSettingsStep>("identity");
  const [accountConnectionTests, setAccountConnectionTests] = useState<Record<string, { status: "testing" | "success" | "failed"; message: string; testedAt?: string }>>({});
  const [existingContactId, setExistingContactId] = useState("");
  const [existingContactPickerOpen, setExistingContactPickerOpen] = useState(false);
  const [composeAiPrompt, setComposeAiPrompt] = useState("");
  const [aiProviderApiKeyDraft, setAiProviderApiKeyDraft] = useState("");
  const [composePromptGenerating, setComposePromptGenerating] = useState(false);
  const [attachmentModalOpen, setAttachmentModalOpen] = useState(false);
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false);
  const [editingMediaAssetId, setEditingMediaAssetId] = useState("");
  const [mediaAssetNameDraft, setMediaAssetNameDraft] = useState("");
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const [attachmentUploads, setAttachmentUploads] = useState<EmailAttachmentUploadItem[]>([]);
  const composeEditorRef = useRef<HTMLDivElement>(null);
  const composeInlineImageInputRef = useRef<HTMLInputElement>(null);
  const mediaReplaceInputRef = useRef<HTMLInputElement>(null);
  const composeAttachmentInputRef = useRef<HTMLInputElement>(null);
  const hasEmailDraftContent = Boolean(emailDraft.to.trim() || emailDraft.cc.trim() || emailDraft.bcc.trim() || emailDraft.subject.trim() || hasEmailDraftBody(emailDraft) || emailDraft.attachments?.length || emailDraft.aiAssisted);
  const signatureOptions = useMemo(() => getEmailSignatureOptions(accounts, emailDraft.accountId), [accounts, emailDraft.accountId]);
  const selectedSignature = signatureOptions.find((signature) => signature.id === (emailDraft.signatureId || noEmailSignatureId)) ?? signatureOptions[0];
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
                    : mailbox === "drafts"
                      ? hasDraft && !isDeleted
                      : mailbox === "all"
                        ? !isDeleted
                        : !isDeleted && !isArchived && !isSnoozed;
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
      if (!isDeleted && !isArchived && !isSnoozed) counts.inbox += 1;
      if (state.starred && !isDeleted) counts.starred += 1;
      if (isSnoozed && !isDeleted) counts.snoozed += 1;
      if (state.important && !isDeleted) counts.important += 1;
      if (emailThreadHasOutbound(messages) && !isDeleted) counts.sent += 1;
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
    setLabelFilter(normalizedLabel);
    onShowSuccess(`已添加标签：${normalizedLabel}`);
  }

  function removeEmailLabel(threadId: string, label: string) {
    const thread = threads.find((candidate) => candidate.id === threadId);
    if (!thread) {
      return;
    }
    const state = threadUiState[threadId] ?? {};
    updateThreadLabels(threadId, (state.labels ?? thread.labels ?? []).filter((candidate) => candidate !== label));
    if (labelFilter === label) {
      setLabelFilter("");
    }
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
      setSelectedMailboxAccountId(allEmailAccountsKey);
      setSelectedThreadIds(new Set());
    }
  }, [accounts, selectedMailboxAccountId]);

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
    const messages = messagesByThread[detailThreadId] ?? [];
    const state = threadUiState[detailThreadId] ?? {};
    const isDeleted = Boolean(state.deleted);
    const isArchived = Boolean(state.archived);
    const isSnoozed = Boolean(state.snoozedUntil && new Date(state.snoozedUntil).getTime() > Date.now());
    const nextCategory = state.category ?? inferEmailThreadCategory(thread, messages);
    const nextMailbox = isDeleted ? "trash" : isArchived ? "archived" : isSnoozed ? "snoozed" : "inbox";
    setSelectedMailboxAccountId((current) => (current === allEmailAccountsKey ? current : allEmailAccountsKey));
    setSearchQuery((current) => (current ? "" : current));
    setSelectedThreadIds((current) => (current.size ? new Set() : current));
    setCategory((current) => (current === nextCategory ? current : nextCategory));
    setMailbox((current) => (current === nextMailbox ? current : nextMailbox));
    setMailMode((current) => (current === "detail" ? current : "detail"));
    if (detailThreadId !== selectedThreadId) {
      onSelectThread(detailThreadId);
    }
    if (!state.read) {
      patchThreadUiState([detailThreadId], { read: true });
      persistThreadState(detailThreadId, { read: true });
    }
  }, [detailThreadId, messagesByThread, onSelectThread, patchThreadUiState, persistThreadState, selectedThreadId, threadUiState, threads]);

  useEffect(() => {
    if (view === "mail" && hasEmailDraftContent) {
      setComposeOpen(true);
      setComposeMinimized(false);
    }
  }, [hasEmailDraftContent, view]);

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
    setSelectedMailboxAccountId(accountId);
    setMailMode("list");
    setLabelFilter("");
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
    setComposeOpen(true);
    setComposeMinimized(false);
    window.setTimeout(() => {
      document.querySelector<HTMLInputElement>("[data-testid='email-compose-to']")?.focus();
    }, 0);
  }

  function closeComposePopup() {
    setComposeOpen(false);
    setComposeMinimized(false);
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

  function startEditingMediaAsset(asset: MediaAsset) {
    setEditingMediaAssetId(asset.id);
    setMediaAssetNameDraft(asset.name);
  }

  function saveMediaAssetName(asset: MediaAsset) {
    const nextName = mediaAssetNameDraft.trim();
    if (!nextName) {
      onShowToast({ intent: "error", message: "请输入图片名称。" });
      return;
    }
    onUpdateMediaAsset(asset.id, { name: nextName });
    setEditingMediaAssetId("");
    setMediaAssetNameDraft("");
  }

  async function replaceEditingMediaAsset(files: FileList | null) {
    const asset = mediaAssets.find((candidate) => candidate.id === editingMediaAssetId);
    const file = files?.[0];
    if (!asset || !file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      onShowToast({ intent: "error", message: "请选择图片文件。" });
      return;
    }
    if (file.size > MAX_EMAIL_ATTACHMENT_BYTES) {
      onShowToast({ intent: "error", message: `${file.name} 超过 ${formatBytes(MAX_EMAIL_ATTACHMENT_BYTES)}。` });
      return;
    }
    onUpdateMediaAsset(asset.id, {
      name: mediaAssetNameDraft.trim() || file.name,
      contentType: file.type || "image/png",
      size: file.size,
      contentBase64: await readFileAsBase64(file)
    });
    setEditingMediaAssetId("");
    setMediaAssetNameDraft("");
  }

  function performMailboxAction(action: "archive" | "unarchive" | "delete" | "restore" | "read" | "unread" | "snooze" | "important", threadIds = selectedThreadIdsArray) {
    if (!threadIds.length) {
      return;
    }
    let patchByThreadId = new Map<string, Partial<EmailThreadUiState>>();
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
    } else {
      patchByThreadId = new Map(threadIds.map((threadId) => [threadId, { important: !(threadUiState[threadId]?.important ?? false) }]));
    }
    for (const [threadId, patch] of patchByThreadId) {
      patchThreadUiState([threadId], patch);
      persistThreadState(threadId, patch);
    }
    setSelectedThreadIds(new Set());
    if (threadIds.includes(selectedThreadId) && (action === "archive" || action === "delete" || action === "restore" || action === "unarchive" || action === "snooze")) {
      setMailMode("list");
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
    setMailMode("detail");
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
          <input data-testid="email-search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索邮件" />
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
            <div className="gmail-label-title">
              <span>邮箱账户</span>
              <small>{accounts.length}</small>
            </div>
            <button
              className={`gmail-folder ${selectedMailboxAccountId === allEmailAccountsKey ? "active" : ""}`}
              data-testid="email-mailbox-account-all"
              type="button"
              onClick={() => selectMailboxAccount(allEmailAccountsKey)}
            >
              <Inbox size={16} />
              <span>全部邮箱</span>
              <small>{threads.filter((thread) => !(threadUiState[thread.id]?.deleted)).length || ""}</small>
            </button>
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
          <nav className="gmail-folder-list" aria-label="邮箱">
            {emailMailboxMeta.map((item) => {
              const Icon = item.icon;
              return (
                <button className={`gmail-folder ${mailbox === item.key ? "active" : ""}`} key={item.key} type="button" onClick={() => { setMailbox(item.key); setMailMode("list"); setSelectedThreadIds(new Set()); }}>
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
              <button className={`gmail-folder ${labelFilter === label ? "active" : ""}`} data-testid={`email-label-filter-${sanitizeTestId(label)}`} key={label} type="button" onClick={() => { setLabelFilter(labelFilter === label ? "" : label); setMailMode("list"); }}>
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
                    <button className="icon-button" data-testid="email-thread-bulk-permanent-delete" aria-label="彻底删除" title="彻底删除" type="button" onClick={() => onDeleteThreads(selectedThreadIdsArray)} disabled={!selectedThreadIds.size}>
                      <Trash2 size={16} />
                    </button>
                  </>
                ) : (
                  <button className="icon-button" aria-label="删除" title="删除" type="button" onClick={() => performMailboxAction("delete")} disabled={!selectedThreadIds.size}>
                    <Trash2 size={16} />
                  </button>
                )}
                <button className="icon-button" aria-label="稍后提醒" title="稍后提醒" type="button" onClick={() => performMailboxAction("snooze")} disabled={!selectedThreadIds.size}>
                  <Clock3 size={16} />
                </button>
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
                    <button className={`gmail-category-tab ${category === item.key ? "active" : ""}`} key={item.key} type="button" onClick={() => setCategory(item.key)}>
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
                  const snippet = messages.at(-1)?.bodyText || thread.summary || thread.aiAnalysis || "";
                  const isRead = state.read ?? false;
                  return (
                    <article className={`gmail-thread-row ${selectedThreadId === thread.id ? "selected" : ""} ${isRead ? "" : "unread"}`} key={thread.id}>
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
                        <span className="gmail-thread-sender">{emailThreadSender(thread, activeAccounts)}</span>
                        <span className="gmail-thread-subject">{thread.subject}</span>
                        <span className="gmail-thread-snippet">{snippet}</span>
                        <span className="gmail-thread-labels">
                          {labels.map((label) => <span className="badge" key={label}>{label}</span>)}
                          {state.snoozedUntil ? <span className="badge">稍后 {formatDate(state.snoozedUntil)}</span> : null}
                        </span>
                      </button>
                      <span className="gmail-thread-date">{formatDate(emailThreadTimeValue(thread))}</span>
                      <div className="gmail-row-actions">
                        {state.archived ? (
                          <button className="icon-button" aria-label="取消归档" type="button" onClick={() => performMailboxAction("unarchive", [thread.id])}><RotateCcw size={15} /></button>
                        ) : (
                          <button className="icon-button" aria-label="归档" type="button" onClick={() => performMailboxAction("archive", [thread.id])}><Archive size={15} /></button>
                        )}
                        {state.deleted ? (
                          <>
                            <button className="icon-button" aria-label="恢复" type="button" onClick={() => performMailboxAction("restore", [thread.id])}><RotateCcw size={15} /></button>
                            <button className="icon-button" aria-label="彻底删除" type="button" onClick={() => onDeleteThread(thread.id)}><Trash2 size={15} /></button>
                          </>
                        ) : (
                          <button className="icon-button" aria-label="删除" type="button" onClick={() => performMailboxAction("delete", [thread.id])}><Trash2 size={15} /></button>
                        )}
                        <button className="icon-button" aria-label="稍后提醒" type="button" onClick={() => performMailboxAction("snooze", [thread.id])}><Clock3 size={15} /></button>
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
                <button className="icon-button" aria-label="返回列表" type="button" onClick={() => setMailMode("list")}>
                  <ChevronLeft size={18} />
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
                {selectedThreadState.deleted ? (
                  <>
                    <button className="icon-button" data-testid="email-thread-restore" aria-label="恢复" title="恢复" type="button" onClick={() => selectedThread && performMailboxAction("restore", [selectedThread.id])} disabled={!selectedThread}>
                      <RotateCcw size={16} />
                    </button>
                    <button className="icon-button" data-testid="email-thread-permanent-delete" aria-label="彻底删除" title="彻底删除" type="button" onClick={() => selectedThread && onDeleteThread(selectedThread.id)} disabled={!selectedThread}>
                      <Trash2 size={16} />
                    </button>
                  </>
                ) : (
                  <button className="icon-button" aria-label="删除" title="删除" type="button" onClick={() => selectedThread && performMailboxAction("delete", [selectedThread.id])} disabled={!selectedThread}>
                    <Trash2 size={16} />
                  </button>
                )}
                <button className="icon-button" aria-label="稍后提醒" title="稍后提醒" type="button" onClick={() => selectedThread && performMailboxAction("snooze", [selectedThread.id])} disabled={!selectedThread}>
                  <Clock3 size={16} />
                </button>
                <button className="icon-button" aria-label="标记未读" title="标记未读" type="button" onClick={() => selectedThread && performMailboxAction("unread", [selectedThread.id])} disabled={!selectedThread}>
                  <Mail size={16} />
                </button>
                <button className="icon-button" aria-label="重要" title="重要" type="button" onClick={() => selectedThread && performMailboxAction("important", [selectedThread.id])} disabled={!selectedThread}>
                  <Tag size={16} />
                </button>
                <button className="icon-button" aria-label="添加标签" title="添加标签" type="button" onClick={() => { if (selectedThread) void promptAddEmailLabel([selectedThread.id]); }} disabled={!selectedThread}>
                  <Tag size={16} />
                </button>
                <button className="icon-button" aria-label="更多" type="button">
                  <MoreVertical size={16} />
                </button>
              </div>
              {selectedThread ? (
                <>
                  <div className="gmail-detail-header">
                    <h2>{selectedThread.subject}</h2>
                    <div className="toolbar">
                      <span className="badge">类别：{getEmailCategoryLabel((threadUiState[selectedThread.id]?.category ?? inferEmailThreadCategory(selectedThread, selectedMessages)) as EmailCategoryKey)}</span>
                      {threadUiState[selectedThread.id]?.starred ? <span className="badge">星标</span> : null}
                      {threadUiState[selectedThread.id]?.important ? <span className="badge">重要</span> : null}
                      {getEmailThreadDisplayLabels(selectedThread, threadUiState[selectedThread.id] ?? {}, selectedMessages).map((label) => (
                        <span className="email-label-pill" key={label}>
                          {label}
                          {(threadUiState[selectedThread.id]?.labels ?? selectedThread.labels ?? []).includes(label) ? (
                            <button aria-label={`移除标签 ${label}`} type="button" onClick={() => removeEmailLabel(selectedThread.id, label)}>
                              <XCircle size={12} />
                            </button>
                          ) : null}
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
                    <button className="secondary-button" data-testid="email-thread-analyze" type="button" onClick={onAnalyzeThread} disabled={disabled || !aiSettings.features.context_analysis}>
                      <Bot size={16} />
                      刷新分析
                    </button>
                    <button className="secondary-button" data-testid="email-thread-summarize" type="button" onClick={onSummarizeThread} disabled={disabled || !aiSettings.features.auto_summarize}>
                      <Bot size={16} />
                      刷新摘要
                    </button>
                  </div>
                  {selectedThread.summary ? (
                    <div className="ai-box" data-testid="email-thread-summary">
                      <div className="activity-meta">Compact 摘要 {selectedThread.summaryUpdatedAt ? `(${formatDate(selectedThread.summaryUpdatedAt)})` : ""}</div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{selectedThread.summary}</div>
                      <div className="toolbar" style={{ marginTop: 8 }}>
                        <span className="badge">用于后续 AI 上下文</span>
                        <span className="badge">减少长线程 token 消耗</span>
                      </div>
                    </div>
                  ) : null}
                  {selectedThread.aiAnalysis ? (
                    <details className="ai-box email-thread-analysis" data-testid="email-thread-analysis">
                      <summary>
                        <span>
                          AI 线程分析 {selectedThread.aiAnalysisUpdatedAt ? `(${formatDate(selectedThread.aiAnalysisUpdatedAt)})` : ""}
                        </span>
                        <strong>{getEmailAnalysisPreview(selectedThread.aiAnalysis)}</strong>
                      </summary>
                      <div className="email-thread-analysis-body">{formatEmailAnalysisForDisplay(selectedThread.aiAnalysis)}</div>
                      {renderEmailAiSources(selectedThread.aiAnalysisSources)}
                    </details>
                  ) : null}
                  <div className="email-message-list">
                    {selectedMessages.map((message) => (
                      <article className="email-message-card gmail-message-card" key={message.id}>
                        <div className="email-message-header">
                          <div>
                            <strong>{message.from}</strong>
                            <div className="subtle">收件人 {message.to.join(", ")} · {message.direction} · {message.status}</div>
                          </div>
                          <div className="activity-meta">{formatDate(message.createdAt)}</div>
                        </div>
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
                            <iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={buildEmailHtmlPreview(message.bodyHtml ?? "")} data-testid={`email-message-html-${message.id}`} className="email-html-preview-frame" title={`HTML preview ${message.id}`} />
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
                    ))}
                    {selectedMessages.length === 0 ? <div className="empty-state">选择线程后会加载消息</div> : null}
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
            className={`gmail-compose-popup ${composeMinimized ? "minimized" : ""}`}
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
                  <EmailRecipientInput
                    label="收件人"
                    testId="email-compose-to"
                    value={emailDraft.to}
                    contactByEmail={contactByEmail}
                    placeholder="buyer@example.com"
                    onChange={(nextValue) => onEmailDraftChange(clearEmailDraftAiProvenance({ ...emailDraft, to: nextValue }))}
                  />
                  <EmailRecipientInput
                    label="CC"
                    testId="email-compose-cc"
                    value={emailDraft.cc}
                    contactByEmail={contactByEmail}
                    placeholder="manager@example.com"
                    onChange={(nextValue) => onEmailDraftChange(clearEmailDraftAiProvenance({ ...emailDraft, cc: nextValue }))}
                  />
                  <EmailRecipientInput
                    label="BCC"
                    testId="email-compose-bcc"
                    value={emailDraft.bcc}
                    contactByEmail={contactByEmail}
                    placeholder="archive@example.com"
                    onChange={(nextValue) => onEmailDraftChange(clearEmailDraftAiProvenance({ ...emailDraft, bcc: nextValue }))}
                  />
                  <label>
                    <span className="subtle">主题</span>
                    <input className="input" data-testid="email-compose-subject" value={emailDraft.subject} onChange={(event) => onEmailDraftChange(clearEmailDraftAiProvenance({ ...emailDraft, subject: event.target.value }))} />
                  </label>
                  <label>
                    <span className="subtle">签名</span>
                    <select className="select" data-testid="email-compose-signature" value={emailDraft.signatureId || noEmailSignatureId} onChange={(event) => onEmailDraftChange({ ...emailDraft, signatureId: event.target.value })}>
                      {signatureOptions.map((signature) => (
                        <option key={signature.id} value={signature.id}>{signature.label}</option>
                      ))}
                    </select>
                  </label>
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
                <Send size={16} />
                发送
              </button>
            </div>
              </div>
            )}
          </section>
        ) : null}

        {mediaLibraryOpen ? (
          <div className="modal-backdrop" data-testid="email-media-library-modal" role="dialog" aria-modal="true" aria-label="媒体库">
            <div className="modal-panel media-library-modal">
              <div className="email-pane-header compact">
                <div>
                  <h2 className="page-title" style={{ fontSize: 18 }}>媒体库</h2>
                  <p className="subtle">选择图片插入邮件正文，或上传新图片供产品主图和邮件复用。</p>
                </div>
                <button className="icon-button" aria-label="关闭媒体库" type="button" onClick={() => setMediaLibraryOpen(false)}>
                  <XCircle size={16} />
                </button>
              </div>
              <div className="toolbar">
                <button className="secondary-button" type="button" onClick={() => composeInlineImageInputRef.current?.click()} disabled={disabled}>
                  <ImageIcon size={16} />
                  上传图片
                </button>
                <input
                  ref={mediaReplaceInputRef}
                  hidden
                  accept="image/*"
                  type="file"
                  onChange={(event) => {
                    void replaceEditingMediaAsset(event.target.files);
                    event.target.value = "";
                  }}
                />
              </div>
              {mediaAssets.length ? (
                <div className="media-library-grid">
                  {mediaAssets.map((asset) => (
                    <div className="media-library-card" key={asset.id}>
                      <button className="media-library-select" type="button" onClick={() => insertMediaAssetInline(asset)}>
                        <img alt={asset.name} src={mediaAssetDataUrl(asset)} />
                      </button>
                      {editingMediaAssetId === asset.id ? (
                        <div className="media-library-edit">
                          <input className="input" data-testid={`media-asset-name-${asset.id}`} value={mediaAssetNameDraft} onChange={(event) => setMediaAssetNameDraft(event.target.value)} />
                          <div className="toolbar compact-toolbar">
                            <button className="secondary-button" type="button" onClick={() => saveMediaAssetName(asset)} disabled={disabled || !mediaAssetNameDraft.trim()}>
                              <Save size={14} />
                              保存
                            </button>
                            <button className="secondary-button" type="button" onClick={() => mediaReplaceInputRef.current?.click()} disabled={disabled}>
                              <Upload size={14} />
                              替换
                            </button>
                            <button className="secondary-button" type="button" onClick={() => setEditingMediaAssetId("")}>
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="media-library-card-footer">
                          <span title={asset.name}>{asset.name}</span>
                          <div className="toolbar compact-toolbar">
                            <button className="icon-button" aria-label={`编辑 ${asset.name}`} data-testid={`media-asset-edit-${asset.id}`} type="button" onClick={() => startEditingMediaAsset(asset)} disabled={disabled}>
                              <Pencil size={14} />
                            </button>
                            <button className="icon-button danger-button" aria-label={`删除 ${asset.name}`} data-testid={`media-asset-delete-${asset.id}`} type="button" onClick={() => onDeleteMediaAsset(asset)} disabled={disabled}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">媒体库暂无图片</div>
              )}
            </div>
          </div>
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

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function sanitizeTestId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function TaskView({
  activities,
  mediaAssets,
  users,
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
  users: User[];
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
  const [view, setView] = useState<TaskCalendarView>("list");
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

  async function uploadTaskImages(files: FileList | File[] | null) {
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
      onShowToast({ intent: "error", message: error instanceof Error ? error.message : "图片上传失败" });
    } finally {
      setIsUploadingTaskImage(false);
    }
  }

  return (
    <section className="section">
      <div className="section-header task-view-header">
        <div>
          <h2 className="page-title">任务</h2>
          <p className="subtle">按待办、已完成、归档管理销售跟进事项，也可以在日历中按日期和时间直接创建任务。</p>
        </div>
        <div className="toolbar" role="group" aria-label="任务视图">
          <button className="primary-button" data-testid="task-create-from-list" type="button" onClick={requestTaskWithoutDate}>
            <CheckCircle2 size={16} />
            新建任务
          </button>
          {(["list", "month", "week", "day"] as TaskCalendarView[]).map((mode) => (
            <button
              aria-pressed={view === mode}
              className={view === mode ? "primary-button" : "secondary-button"}
              data-testid={`task-view-${mode}`}
              key={mode}
              type="button"
              onClick={() => setView(mode)}
            >
              {mode === "list" ? <List size={16} /> : <CalendarClock size={16} />}
              {taskViewLabel(mode)}
            </button>
          ))}
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
          onUploadImages={uploadTaskImages}
        />
      )}
    </section>
  );
}

function TaskList({
  activities,
  emptyMessage,
  mediaAssets = [],
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
                  <Trash2 size={16} />
                  删除
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
            <p className="subtle">修改标题、截止时间、备注，并添加图片附件。</p>
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
            <strong>图片附件</strong>
            <div className="toolbar">
              <button className="secondary-button" type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                <ImageIcon size={16} />
                {isUploading ? "上传中" : "上传图片"}
              </button>
              <input
                ref={fileInputRef}
                hidden
                accept="image/*"
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
                  <img alt={asset.name} src={mediaAssetDataUrl(asset)} />
                </button>
              ))}
            </div>
          ) : (
            <div className="subtle">媒体库暂无图片，可先上传。</div>
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
            {asset ? <img alt={attachment.name} src={mediaAssetDataUrl(asset)} /> : <Paperclip size={18} />}
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

function ActivityTimeline({ activities, records }: { activities: Activity[]; records: CrmRecord[] }) {
  const sortedActivities = [...activities].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  return (
    <section className="section">
      <h2 className="page-title">全部活动</h2>
      <ActivityList
        activities={sortedActivities}
        emptyMessage="暂无活动"
        testIdPrefix="activity-view-activity"
        renderMeta={(activity) => (
          <>
            <ActivityIcon size={15} />
            {formatActivityType(activity.type)} · {records.find((record) => record.id === activity.recordId)?.title ?? "未关联记录"}
          </>
        )}
      />
    </section>
  );
}

function ActivityList({
  activities,
  emptyMessage,
  testIdPrefix,
  renderMeta
}: {
  activities: Activity[];
  emptyMessage: string;
  testIdPrefix?: string;
  renderMeta: (activity: Activity) => ReactNode;
}) {
  if (activities.length === 0) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  return (
    <div className="activity-list" style={{ marginTop: 12 }}>
      {activities.map((activity) => {
        const body = activity.type === "task" ? parseTaskDetails(activity.body).text : activity.body;
        return (
          <div className="activity-item" data-testid={testIdPrefix ? `${testIdPrefix}-${activity.id}` : undefined} key={activity.id}>
            <div className="activity-meta">{renderMeta(activity)}</div>
            <strong>{activity.title}</strong>
            {body && <div className="subtle">{body}</div>}
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

function MediaImageFieldInput({
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
  onUploadMediaAssets?: (files: FileList | File[] | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <label className="wide media-field">
      <span className="subtle">{label}</span>
      <div className="media-field-grid">
        <div className="media-field-preview">
          {value ? <img alt={label} src={value} /> : <span className="subtle">未选择图片</span>}
        </div>
        <div className="media-field-controls">
          <input className="input" data-testid={testId} value={value} onChange={(event) => onChange(event.target.value)} placeholder="图片 URL 或从媒体库选择" />
          <div className="toolbar compact-toolbar">
            <button className="secondary-button" type="button" onClick={() => fileInputRef.current?.click()}>
              <ImageIcon size={15} />
              上传图片
            </button>
            <input
              ref={fileInputRef}
              hidden
              accept="image/*"
              type="file"
              onChange={(event) => {
                onUploadMediaAssets?.(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
          {mediaAssets.length ? (
            <div className="media-picker-strip" data-testid={testId ? `${testId}-media-library` : undefined}>
              {mediaAssets.slice(0, 12).map((asset) => (
                <button key={asset.id} type="button" onClick={() => onChange(mediaAssetDataUrl(asset))} title={asset.name}>
                  <img alt={asset.name} src={mediaAssetDataUrl(asset)} />
                </button>
              ))}
            </div>
          ) : (
            <span className="subtle">媒体库暂无图片，可先上传。</span>
          )}
        </div>
      </div>
    </label>
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
  onChange
}: {
  field: FieldDefinition;
  value: string;
  allRecords: CrmRecord[];
  mediaAssets?: MediaAsset[];
  users: User[];
  testId?: string;
  onRecordsLoaded?: (records: CrmRecord[]) => void;
  onUploadMediaAssets?: (files: FileList | File[] | null) => void;
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
  options: Array<{ label: string; value: string }>;
  testId?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const filteredOptions = normalizedSearch
    ? options.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(normalizedSearch))
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
  const visibleValue = open ? search : selectedLabel;
  const selectedOption = options.find((option) => option.value === value);

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
        value={visibleValue}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          onSearchChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          onSearchChange("");
          setOpen(true);
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
        <div className="search-dropdown-menu">
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
      fetchJson<RecordListResult>(buildRecordListUrl(referencedObjectKey, emptySavedView(referencedObjectKey), search, 1, `/api/records/${referencedObjectKey}`, 20), {
        method: "GET",
        signal: controller.signal
      })
        .then((result) => {
          setRemoteCandidates((current) => mergeRecords(current, result.records));
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
  const visibleCandidates = normalizedSearch
    ? candidates.filter((candidate) => `${candidate.title} ${candidate.id}`.toLowerCase().includes(normalizedSearch))
    : candidates;
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
      fetchJson<RecordListResult>(buildRecordListUrl("products", emptySavedView("products"), search, 1, "/api/records/products", 20), {
        method: "GET",
        signal: controller.signal
      })
        .then((result) => {
          setRemoteCandidates((current) => mergeRecords(current, result.records));
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
  const visibleCandidates = normalizedSearch
    ? candidates.filter((candidate) => `${candidate.title} ${candidate.data.sku ?? ""}`.toLowerCase().includes(normalizedSearch))
    : candidates;
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

function ProductThumbnail({ imageUrl, title }: { imageUrl: unknown; title: string }) {
  const src = typeof imageUrl === "string" ? imageUrl.trim() : "";
  return (
    <div className="product-thumb" aria-label={title ? `${title} 主图` : "产品主图"} style={src ? { backgroundImage: `url("${src.replace(/"/g, "%22")}")` } : undefined}>
      {src ? null : <Package size={18} />}
    </div>
  );
}

type ContactMethodType = "email" | "whatsapp" | "mob" | "tel" | "wechat" | "linkedin" | "instagram" | "facebook" | "x" | "website" | "other";

type ContactMethodDraft = {
  id: string;
  type: ContactMethodType;
  value: string;
  label?: string;
  primary?: boolean;
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
              <label>
                <span className="subtle">国家/地区</span>
                <input className="input" value={address.country ?? ""} onChange={(event) => updateAddress(address.id, { country: event.target.value })} />
              </label>
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
    .map<CompanyAddressDraft | undefined>((item, index) => {
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

function emptyCompanyAddress(): CompanyAddressDraft {
  return {
    id: `address-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
  return methods.find((method) => method.type === "mob" || method.type === "tel" || method.type === "whatsapp")?.value ?? "";
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

  return String(value);
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

function parseTaskDetails(body?: string): TaskDetailsPayload {
  if (!body) {
    return { format: "task.v1", text: "", attachments: [] };
  }
  try {
    const parsed = JSON.parse(body) as Partial<TaskDetailsPayload>;
    if (parsed?.format === "task.v1") {
      return {
        format: "task.v1",
        text: typeof parsed.text === "string" ? parsed.text : "",
        attachments: Array.isArray(parsed.attachments) ? parsed.attachments.filter(isTaskAttachment) : []
      };
    }
  } catch {
    // Existing task bodies were plain text before task attachments were introduced.
  }
  return { format: "task.v1", text: body, attachments: [] };
}

function serializeTaskDetails(input: Pick<TaskDetailsPayload, "text" | "attachments">): string | undefined {
  const text = input.text.trim();
  const attachments = input.attachments.filter(isTaskAttachment);
  if (!text && !attachments.length) {
    return undefined;
  }
  return JSON.stringify({ format: "task.v1", text, attachments } satisfies TaskDetailsPayload);
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

function taskAttachmentFromMediaAsset(asset: MediaAsset): TaskAttachment {
  return {
    id: `${asset.id}-${Date.now()}`,
    mediaAssetId: asset.id,
    name: asset.name,
    contentType: asset.contentType,
    size: asset.size
  };
}

function appendUniqueTaskAttachment(attachments: TaskAttachment[], attachment: TaskAttachment): TaskAttachment[] {
  if (attachments.some((candidate) => candidate.mediaAssetId === attachment.mediaAssetId)) {
    return attachments;
  }
  return [...attachments, attachment];
}

function isTaskAttachment(value: unknown): value is TaskAttachment {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as TaskAttachment;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.mediaAssetId === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.contentType === "string" &&
    typeof candidate.size === "number"
  );
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
  return [...new Map(records.map((record) => [record.id, record])).values()];
}

function mergeActivities(...groups: Array<Array<Activity | null | undefined> | null | undefined>): Activity[] {
  const activities = groups.flatMap((group) => group ?? []).filter((activity): activity is Activity => Boolean(activity?.id));
  return [...new Map(activities.map((activity) => [activity.id, activity])).values()].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

function mergeEmailAccounts(current: EmailAccount[], updated: EmailAccount[]): EmailAccount[] {
  const updates = new Map(updated.map((account) => [account.id, account]));
  const merged = current.map((account) => updates.get(account.id) ?? account);
  const currentIds = new Set(current.map((account) => account.id));
  return [...merged, ...updated.filter((account) => !currentIds.has(account.id))];
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

function buildRecordListUrl(objectKey: string, view: SavedView, query: string, page: number, path = `/api/records/${objectKey}`, pageSize = 50): string {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize)
  });

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
