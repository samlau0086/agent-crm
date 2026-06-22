"use client";

import {
  Activity as ActivityIcon,
  BadgeDollarSign,
  Bot,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  LayoutDashboard,
  LayoutList,
  Mail,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Settings,
  Trash2,
  Trophy,
  Upload,
  UserRound,
  XCircle,
  type LucideIcon
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { SettingsAdmin } from "@/components/settings-admin";
import { buildImportJobObservability } from "@/lib/crm/import-observability";
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
  EmailConnectionConfig,
  EmailMessage,
  EmailThread,
  FieldDefinition,
  ImportJobQueueSummary,
  ImportPreset,
  KnowledgeArticle,
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
import { readEmailOAuthCallbackNotice } from "@/lib/email/oauth-callback";
import { getEmailProviderCapability, getEmailProviderSetupVisibility, isOAuthEmailProvider, listEmailProviderCapabilities } from "@/lib/email/providers";
import { buildEmailReplyDraft, type EmailComposeReplyDraft } from "@/lib/email/reply-draft";
import { formatEmailSendResultMessage } from "@/lib/email/status-messages";
import type { EmailDiagnosticStatus, EmailSubsystemDiagnostics } from "@/lib/email/diagnostics";
import { formatCurrency, formatDate, labelForOption } from "@/lib/utils/format";
import { shouldProceedWithDangerousAction } from "@/lib/ui/confirm";
import type { BackupFile } from "@/lib/ops/backups";

interface CrmWorkspaceProps {
  contextUser: User;
  role: Role;
  objects: ObjectDefinition[];
  fields: FieldDefinition[];
  records: CrmRecord[];
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
  knowledgeArticles: KnowledgeArticle[];
  auditLogs: AuditLog[];
  backupFiles: BackupFile[];
  importJobs: CsvImportJob[];
  importPresets: ImportPreset[];
  importJobQueueSummary?: ImportJobQueueSummary;
}

type NavKey = "dashboard" | "contacts" | "companies" | "deals" | "objects" | "records" | "tasks" | "activities" | "email" | "settings";
type RecordPanelMode = "closed" | "create" | "detail" | "import";
type AiSource = { label: string; objectKey?: string; recordId?: string; activityId?: string };
type AiResponse = { text: string; sources: AiSource[] };
type EmailAiSource = EmailAiSourceRef;
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
    result?: { smtp?: "ok" | "skipped"; imap?: "ok" | "skipped"; oauth?: "ok" | "skipped"; oauthAccountEmail?: string };
    reason?: string;
    error?: string;
  }>;
};
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
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpStartTls: boolean;
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  username: string;
  password: string;
  mailbox: string;
  oauthAccessToken: string;
  oauthRefreshToken: string;
  oauthExpiresAt: string;
  oauthScope: string;
};
type EmailAccountUpdatePatch = Partial<Pick<EmailAccount, "name" | "emailAddress" | "provider" | "status" | "syncEnabled" | "sendEnabled">> & {
  connectionConfig?: EmailConnectionConfig;
  clearConnectionConfig?: boolean;
};
type EmailComposeDraft = EmailComposeReplyDraft & {
  clientRequestId: string;
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
  { key: "objects", label: "对象", icon: LayoutList },
  { key: "tasks", label: "任务", icon: CheckCircle2 },
  { key: "activities", label: "活动", icon: ActivityIcon },
  { key: "settings", label: "设置", icon: Settings }
];

const coreObjects = new Set(["contacts", "companies", "deals"]);
const emailAiFeatureMeta: Record<keyof EmailAiSettings["features"], { label: string; description: string; dependsOn?: keyof EmailAiSettings["features"] }> = {
  draft: { label: "AI 写邮件", description: "基于客户背景、沟通历史和知识库生成邮件草稿" },
  translate: { label: "AI 翻译", description: "手动翻译邮件内容" },
  auto_translate: { label: "自动翻译", description: "新入站邮件自动生成翻译", dependsOn: "translate" },
  context_analysis: { label: "上下文分析", description: "分析邮件线程并给出下一步建议" },
  auto_context_analysis: { label: "自动上下文分析", description: "新邮件自动刷新线程分析", dependsOn: "context_analysis" },
  auto_summarize: { label: "自动总结", description: "把长线程压缩成 compact memory 以减少后续 token 消耗" }
};

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
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: cid:; style-src \'unsafe-inline\'; font-src data:;">',
    "<style>html,body{margin:0;padding:12px;background:#fff;color:#111827;font:14px/1.5 Arial,sans-serif;overflow-wrap:anywhere;}table{max-width:100%;}img{max-width:100%;height:auto;}</style>",
    "</head><body>",
    bodyHtml,
    "</body></html>"
  ].join("");
}

function hasEmailHtmlPreview(message: EmailMessage): boolean {
  return Boolean(message.bodyHtml?.trim());
}

const navigationItems: typeof navItems = navItems.some((item) => item.key === "email")
  ? navItems
  : [...navItems.slice(0, -1), { key: "email", label: "邮件", icon: Mail }, navItems[navItems.length - 1]];

function createEmptyEmailAccountDraft(overrides: Partial<EmailAccountDraft> = {}): EmailAccountDraft {
  return {
    name: "",
    emailAddress: "",
    provider: "smtp_imap",
    syncEnabled: true,
    sendEnabled: true,
    smtpHost: "",
    smtpPort: "465",
    smtpSecure: true,
    smtpStartTls: false,
    imapHost: "",
    imapPort: "993",
    imapSecure: true,
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

function createEmailAccountEditDraft(account: EmailAccount): EmailAccountDraft {
  return createEmptyEmailAccountDraft({
    editingAccountId: account.id,
    name: account.name,
    emailAddress: account.emailAddress,
    provider: account.provider,
    syncEnabled: account.syncEnabled,
    sendEnabled: account.sendEnabled
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

export function CrmWorkspace(props: CrmWorkspaceProps) {
  const router = useRouter();
  const [activeNav, setActiveNav] = useState<NavKey>("dashboard");
  const [activeObjectKey, setActiveObjectKey] = useState(props.initialObjectKey);
  const [records, setRecords] = useState<CrmRecord[]>(() => mergeRecords(props.records, props.initialRecordList.records, props.dashboardSummary.deals));
  const [activities, setActivities] = useState<Activity[]>(() =>
    mergeActivities(props.activities, props.dashboardSummary.openTasks, props.dashboardSummary.recentActivities)
  );
  const [selectedRecordId, setSelectedRecordId] = useState(props.initialRecordList.records[0]?.id ?? props.records[0]?.id ?? "");
  const [selectedViewId, setSelectedViewId] = useState("");
  const [recordPage, setRecordPage] = useState(1);
  const [recordListObjectKey, setRecordListObjectKey] = useState(props.initialObjectKey);
  const [recordList, setRecordList] = useState<RecordListResult>(() => props.initialRecordList);
  const [isRecordListLoading, setIsRecordListLoading] = useState(false);
  const [viewDraft, setViewDraft] = useState<ViewDraft>(emptyViewDraft);
  const [query, setQuery] = useState("");
  const [recordPanelMode, setRecordPanelMode] = useState<RecordPanelMode>("closed");
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
  const [selectedEmailThreadId, setSelectedEmailThreadId] = useState(props.emailThreads[0]?.id ?? "");
  const [emailAiSettings, setEmailAiSettings] = useState<EmailAiSettings>(props.emailAiSettings);
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
    attachments: [],
    aiAssisted: false
  });
  const [emailAiPurpose, setEmailAiPurpose] = useState<"draft" | "translate" | "context_analysis" | "summarize">("draft");
  const [emailAiPrompt, setEmailAiPrompt] = useState("");
  const [emailAiResult, setEmailAiResult] = useState<EmailAiGenerateResult | null>(null);
  const [emailDiagnostics, setEmailDiagnostics] = useState<EmailSubsystemDiagnostics | null>(null);
  const [emailConnectionTestRun, setEmailConnectionTestRun] = useState<EmailConnectionTestRun | null>(null);
  const [knowledgeArticles, setKnowledgeArticles] = useState<KnowledgeArticle[]>(props.knowledgeArticles);
  const [knowledgeDraft, setKnowledgeDraft] = useState<KnowledgeArticleDraft>({ title: "", body: "", tags: "", active: true });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isPending, startTransition] = useTransition();
  const previousCreateFormResetKey = useRef("");
  const previousViewDraftResetKey = useRef("");
  const previousEditFormResetKey = useRef("");

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
  const selectedRecordFormResetKey = `${selectedRecord?.objectKey ?? ""}:${selectedRecord?.id ?? ""}`;
  const selectedActivities = useMemo(
    () =>
      activities
        .filter((activity) => activity.recordId === selectedRecord?.id)
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    [activities, selectedRecord?.id]
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
  const openTasks = useMemo(
    () =>
      activities
        .filter((activity) => activity.type === "task" && !activity.completedAt)
        .sort((left, right) => new Date(left.dueAt ?? left.createdAt).getTime() - new Date(right.dueAt ?? right.createdAt).getTime()),
    [activities]
  );
  const deals = props.dashboardSummary.deals;
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
    window.history.replaceState(window.history.state, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  }, []);

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
    setEmailAccounts(props.emailAccounts);
    setEmailThreads(props.emailThreads);
    setEmailAiSettings(props.emailAiSettings);
    setKnowledgeArticles(props.knowledgeArticles);
    setEmailDraft((current) => {
      const accountId = current.accountId || props.emailAccounts[0]?.id || "";
      return accountId === current.accountId ? current : clearEmailDraftAiProvenance({ ...current, accountId });
    });
    const nextSelectedThreadId = props.emailThreads.some((thread) => thread.id === selectedEmailThreadId) ? selectedEmailThreadId : props.emailThreads[0]?.id ?? "";
    if (nextSelectedThreadId !== selectedEmailThreadId) {
      setEmailDraft((current) => clearEmailDraftAiProvenance(current));
      setSelectedEmailThreadId(nextSelectedThreadId);
    }
  }, [props.emailAccounts, props.emailAiSettings, props.emailThreads, props.knowledgeArticles, selectedEmailThreadId]);

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
        const referenceObjectKeys = getReferenceObjectKeysForObject(props.fields, activeObject.key);
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
  }, [activeObject, effectiveView, props.fields, query, recordPage]);

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
    setCreateTitle("");
    setCreateOwnerId(props.contextUser.id);
    setCreateValues(buildInitialValues(objectFields));
    setCreateFormObjectKey(activeObject?.key ?? "");
    setImportCsv(sampleCsvFor(activeObject?.key ?? "contacts", objectFields));
    setImportPreview(null);
  }, [activeObject?.key, createFormResetKey, objectFields, props.contextUser.id]);

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

  function openObject(objectKey: string) {
    setActiveObjectKey(objectKey);
    setActiveNav(coreObjects.has(objectKey) ? (objectKey as NavKey) : "records");
    setQuery("");
    setRecordPanelMode("closed");
    setShowListSettings(false);
    setMessage(null);
    setError(null);
  }

  function openRecord(record: CrmRecord) {
    setRecords((current) => mergeRecords(current, [record]));
    openObject(record.objectKey);
    setSelectedRecordId(record.id);
    setRecordPanelMode("detail");
  }

  async function submitCreateRecord() {
    if (!activeObject) {
      return;
    }

    await postJson(`/api/records/${activeObject.key}`, {
      title: createTitle.trim(),
      stageKey: activeObject.key === "deals" ? activePipeline?.stages[0]?.key : undefined,
      ownerId: createOwnerId || undefined,
      data: parseFormValues(objectFields, createValues)
    });

    setMessage(`已创建${activeObject.label}`);
    setCreateTitle("");
    setCreateOwnerId(props.contextUser.id);
    setCreateValues(buildInitialValues(objectFields));
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
        data: parseFormValues(selectedFields, editValues),
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
    if (!shouldProceedWithDangerousAction(`确定删除记录“${selectedRecord.title}”？相关活动也会被删除。`)) {
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
      !shouldProceedWithDangerousAction(
        `本次导入会更新 ${importPreview.conflictRows} 条已有记录。请确认这些冲突行已经检查无误。`
      )
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
    if (!shouldProceedWithDangerousAction(`删除导入预设“${preset.name}”？`)) {
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
    if (!shouldProceedWithDangerousAction(`确定删除视图“${activeView.name}”？`)) {
      return;
    }

    await fetchJson(`/api/saved-views/${activeView.id}`, { method: "DELETE" });
    setSelectedViewId("");
    setMessage("视图已删除");
    router.refresh();
  }

  async function moveDealStage(record: CrmRecord, stageKey: string) {
    await fetchJson(`/api/records/${record.objectKey}/${record.id}`, {
      method: "PATCH",
      body: { stageKey }
    });
    setMessage("交易阶段已更新");
    router.refresh();
  }

  async function toggleTaskCompletion(activity: Activity, completed: boolean) {
    await fetchJson(`/api/activities/${activity.id}`, {
      method: "PATCH",
      body: { completedAt: completed ? new Date().toISOString() : null }
    });
    setMessage(completed ? "任务已完成" : "任务已重开");
    router.refresh();
  }

  async function closeDeal(record: CrmRecord, outcome: "won" | "lost") {
    if (outcome === "lost" && !shouldProceedWithDangerousAction(`确定将交易“${record.title}”标记为输单？`)) {
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

  async function testEmailConnection(accountId: string) {
    const result = await fetchJson<{ account: EmailAccount; result: { smtp?: "ok" | "skipped"; imap?: "ok" | "skipped"; oauth?: "ok" | "skipped"; oauthAccountEmail?: string } }>("/api/email/test-connection", {
      method: "POST",
      body: { accountId }
    });
    setEmailAccounts((current) => [result.account, ...current.filter((candidate) => candidate.id !== result.account.id)]);
    setMessage(`邮箱连接测试完成：SMTP ${result.result.smtp ?? "skipped"}，IMAP ${result.result.imap ?? "skipped"}，OAuth ${result.result.oauth ?? "skipped"}${result.result.oauthAccountEmail ? `（${result.result.oauthAccountEmail}）` : ""}`);
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

  async function sendEmail() {
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
        bodyText: emailDraft.bodyText,
        clientRequestId: emailDraft.clientRequestId,
        attachments: emailDraft.attachments?.length ? emailDraft.attachments : undefined,
        aiAssisted: emailDraft.aiAssisted || undefined,
        aiPurpose: emailDraft.aiAssisted ? emailDraft.aiPurpose : undefined,
        aiSourceMessageId: emailDraft.aiAssisted ? emailDraft.aiSourceMessageId : undefined,
        aiSources: emailDraft.aiAssisted ? emailDraft.aiSources : undefined,
        aiGeneratedAt: emailDraft.aiAssisted ? emailDraft.aiGeneratedAt : undefined
      }
    });
    setEmailMessagesByThread((current) => ({ ...current, [message.threadId]: upsertEmailMessage(current[message.threadId] ?? [], message) }));
    selectEmailThread(message.threadId);
    setEmailDraft((current) => ({ ...current, clientRequestId: createEmailClientRequestId(), to: "", cc: "", bcc: "", subject: "", bodyText: "", attachments: [], aiAssisted: false, aiPurpose: undefined, aiSourceMessageId: undefined, aiSources: undefined, aiGeneratedAt: undefined }));
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

  async function updateEmailAiSettingsPatch(patch: Partial<Pick<EmailAiSettings, "defaultLocale" | "requireSourceLinks" | "maxHistoryMessages" | "maxKnowledgeArticles" | "maxContextChars">> & { features?: Partial<EmailAiSettings["features"]> }) {
    const settings = await fetchJson<EmailAiSettings>("/api/email/ai-settings", {
      method: "PATCH",
      body: patch
    });
    setEmailAiSettings(settings);
    setMessage("邮件 AI 设置已更新");
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
        setActiveNav("email");
        return;
      }
      const message = await fetchJson<EmailMessage>(`/api/email/messages/${source.messageId}`, { method: "GET" });
      await loadEmailMessages(message.threadId);
      selectEmailThread(message.threadId);
      setActiveNav("email");
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
      setActiveNav("activities");
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
      setActiveNav("email");
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

  function runAction(action: () => Promise<void>) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : "操作失败");
      }
    });
  }

  const showRecordWorkspace = activeNav === "contacts" || activeNav === "companies" || activeNav === "deals" || activeNav === "records";

  return (
    <div
      className="app-shell"
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
                  setActiveNav(item.key);
                  if (item.key === "contacts" || item.key === "companies" || item.key === "deals") {
                    openObject(item.key);
                  }
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

      <main className="main">
        <div className="topbar">
          <div>
            <h1 className="page-title">{titleFor(activeNav, activeObject?.pluralLabel)}</h1>
            <div className="subtle">模块化单体、真实 API、真实表单和可配置 CRM 元数据已经接通。</div>
          </div>
          <div className="toolbar">
            <button className="secondary-button" type="button" onClick={() => router.refresh()}>
              <RefreshCw size={16} />
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

        {message && <section className="section" style={{ marginBottom: 12, borderColor: "#86efac", background: "#f0fdf4" }}>{message}</section>}
        {error && <section className="section" style={{ marginBottom: 12, borderColor: "#fca5a5", background: "#fef2f2" }}>{error}</section>}

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
          />
        )}

        {activeNav === "objects" && (
          <ObjectDirectory objects={props.objects} recordCounts={props.dashboardSummary.recordCounts} onOpenObject={openObject} />
        )}

        {showRecordWorkspace && activeObject && (
          <div className={`workspace-grid ${recordPanelMode !== "closed" ? "has-drawer" : ""}`}>
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
                          <button className="record-title" data-testid={`record-row-${record.id}`} type="button" onClick={() => openRecord(record)}>
                            {record.title}
                          </button>
                        </td>
                        {visibleTableColumns.map((column) => (
                          <td key={column.key}>{displayTableColumnValue(column, record, records, props.users)}</td>
                        ))}
                        <td>{formatDate(record.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredRecords.length === 0 && <div className="empty-state">当前对象下还没有记录</div>}
            </section>

            {recordPanelMode !== "closed" && (
            <aside className="detail-panel record-drawer">
              <div className="drawer-header">
                <div>
                  <div className="subtle">当前对象</div>
                  <h2 className="page-title" style={{ fontSize: 18 }}>{activeObject.label}</h2>
                </div>
                <button className="icon-button" type="button" aria-label="关闭面板" title="关闭面板" onClick={() => setRecordPanelMode("closed")}>
                  <XCircle size={18} />
                </button>
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
                  {objectFields.map((field) => (
                    <FieldInput
                      key={`create-${field.id}`}
                      field={field}
                      value={createValues[field.key] ?? ""}
                      allRecords={records}
                      users={props.users}
                      testId={`create-field-${activeObject.key}-${field.key}`}
                      onRecordsLoaded={mergeLoadedRecords}
                      onChange={(nextValue) => setCreateValues((current) => ({ ...current, [field.key]: nextValue }))}
                    />
                  ))}
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
                      {selectedFields.map((field) => (
                        <FieldInput
                          key={`edit-${field.id}`}
                          field={field}
                          value={editValues[field.key] ?? ""}
                          allRecords={records}
                          users={props.users}
                          testId={`edit-field-${selectedRecord.objectKey}-${field.key}`}
                          onRecordsLoaded={mergeLoadedRecords}
                          onChange={(nextValue) => setEditValues((current) => ({ ...current, [field.key]: nextValue }))}
                        />
                      ))}
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
                        testIdPrefix="record-task"
                        users={props.users}
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
                        <RefreshCw size={16} />
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
                        <RefreshCw size={16} />
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
            selectedRecord={selectedRecord}
            records={records}
            aiSettings={emailAiSettings}
            accountDraft={emailAccountDraft}
            emailDraft={emailDraft}
            aiPurpose={emailAiPurpose}
            aiPrompt={emailAiPrompt}
            aiResult={emailAiResult}
            diagnostics={emailDiagnostics}
            connectionTestRun={emailConnectionTestRun}
            knowledgeArticles={knowledgeArticles}
            knowledgeDraft={knowledgeDraft}
            disabled={isPending}
            canManageEmailSettings={canManageEmailSettings}
            onAccountDraftChange={setEmailAccountDraft}
            onEmailDraftChange={setEmailDraft}
            onKnowledgeDraftChange={setKnowledgeDraft}
            onAiPurposeChange={setEmailAiPurpose}
            onAiPromptChange={setEmailAiPrompt}
            onSelectThread={(threadId) => {
              selectEmailThread(threadId);
              if (!emailMessagesByThread[threadId]) {
                runAction(() => loadEmailMessages(threadId));
              }
            }}
            onUpdateThread={(threadId, recordId) => runAction(() => updateEmailThread(threadId, recordId))}
            onCreateAccount={() => runAction(createEmailAccount)}
            onStartOAuth={() => runAction(startEmailOAuth)}
            onSyncAccount={(accountId) => runAction(() => syncEmailAccount(accountId))}
            onSyncAllAccounts={() => runAction(syncAllEmailAccounts)}
            onTestConnection={(accountId) => runAction(() => testEmailConnection(accountId))}
            onEditAccount={(account) => setEmailAccountDraft(createEmailAccountEditDraft(account))}
            onUpdateAccount={(accountId, patch) => runAction(() => updateEmailAccount(accountId, patch))}
            onUpdateAccountFromDraft={() => runAction(updateEmailAccountFromDraft)}
            onResetAccountDraft={() => setEmailAccountDraft(createEmptyEmailAccountDraft())}
            onSend={() => runAction(sendEmail)}
            onReplyToMessage={replyToEmailMessage}
            onRetryMessage={(messageId) => runAction(() => retryEmailMessage(messageId))}
            onGenerateAiForMessage={(message, purpose) => runAction(() => generateEmailAiForMessage(message, purpose))}
            onGenerateAi={() => runAction(generateEmailAi)}
            onOpenAiSource={(source) => runAction(() => openEmailAiSource(source))}
            onSummarizeThread={() => runAction(summarizeEmailThread)}
            onAnalyzeThread={() => runAction(analyzeEmailThread)}
            onRefreshDiagnostics={() => runAction(refreshEmailDiagnostics)}
            onTestAllConnections={() => runAction(testAllEmailConnections)}
            onCreateKnowledgeArticle={() => runAction(createKnowledgeArticle)}
            onUpdateKnowledgeArticle={(articleId, patch) => runAction(() => updateKnowledgeArticle(articleId, patch))}
            onToggleAiFeature={(feature, enabled) => runAction(() => updateEmailAiFeature(feature, enabled))}
            onUpdateAiSettings={(patch) => runAction(() => updateEmailAiSettingsPatch(patch))}
          />
        )}
        {activeNav === "tasks" && <TaskView activities={openTasks} users={props.users} onToggle={(activity, completed) => runAction(() => toggleTaskCompletion(activity, completed))} />}
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
  onOpenObject
}: {
  objects: ObjectDefinition[];
  recordCounts: Record<string, number>;
  openTasks: Activity[];
  openTaskCount: number;
  totalPipeline: number;
  pipelines: Pipeline[];
  deals: CrmRecord[];
  onOpenObject: (objectKey: string) => void;
}) {
  const defaultPipeline = pipelines.find((pipeline) => pipeline.objectKey === "deals" && pipeline.isDefault);

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
                <div className="pipeline-stage" key={stage.key}>
                  <div className="stage-header">
                    <span>{stage.label}</span>
                    <span className="badge">{Math.round(stage.probability * 100)}%</span>
                  </div>
                  {stageDeals.map((deal) => (
                    <div className="deal-pill" key={deal.id}>
                      <strong>{deal.title}</strong>
                      <div className="subtle">{formatCurrency(deal.data.amount)}</div>
                    </div>
                  ))}
                </div>
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
  selectedRecord,
  records,
  aiSettings,
  accountDraft,
  emailDraft,
  aiPurpose,
  aiPrompt,
  aiResult,
  diagnostics,
  connectionTestRun,
  knowledgeArticles,
  knowledgeDraft,
  disabled,
  canManageEmailSettings,
  onAccountDraftChange,
  onEmailDraftChange,
  onKnowledgeDraftChange,
  onAiPurposeChange,
  onAiPromptChange,
  onSelectThread,
  onUpdateThread,
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
  onOpenAiSource,
  onSummarizeThread,
  onAnalyzeThread,
  onRefreshDiagnostics,
  onTestAllConnections,
  onCreateKnowledgeArticle,
  onUpdateKnowledgeArticle,
  onToggleAiFeature,
  onUpdateAiSettings
}: {
  accounts: EmailAccount[];
  threads: EmailThread[];
  messagesByThread: Record<string, EmailMessage[]>;
  selectedThreadId: string;
  selectedRecord?: CrmRecord;
  records: CrmRecord[];
  aiSettings: EmailAiSettings;
  accountDraft: EmailAccountDraft;
  emailDraft: EmailComposeDraft;
  aiPurpose: EmailAiGenerateResult["purpose"];
  aiPrompt: string;
  aiResult: EmailAiGenerateResult | null;
  diagnostics: EmailSubsystemDiagnostics | null;
  connectionTestRun: EmailConnectionTestRun | null;
  knowledgeArticles: KnowledgeArticle[];
  knowledgeDraft: KnowledgeArticleDraft;
  disabled: boolean;
  canManageEmailSettings: boolean;
  onAccountDraftChange: (draft: EmailAccountDraft) => void;
  onEmailDraftChange: (draft: EmailComposeDraft) => void;
  onKnowledgeDraftChange: (draft: KnowledgeArticleDraft) => void;
  onAiPurposeChange: (purpose: EmailAiGenerateResult["purpose"]) => void;
  onAiPromptChange: (prompt: string) => void;
  onSelectThread: (threadId: string) => void;
  onUpdateThread: (threadId: string, recordId: string) => void;
  onCreateAccount: () => void;
  onStartOAuth: () => void;
  onSyncAccount: (accountId: string) => void;
  onSyncAllAccounts: () => void;
  onTestConnection: (accountId: string) => void;
  onEditAccount: (account: EmailAccount) => void;
  onUpdateAccount: (accountId: string, patch: EmailAccountUpdatePatch) => void;
  onUpdateAccountFromDraft: () => void;
  onResetAccountDraft: () => void;
  onSend: () => void;
  onReplyToMessage: (message: EmailMessage) => void;
  onRetryMessage: (messageId: string) => void;
  onGenerateAiForMessage: (message: EmailMessage, purpose: "translate" | "context_analysis") => void;
  onGenerateAi: () => void;
  onOpenAiSource: (source: EmailAiSource) => void;
  onSummarizeThread: () => void;
  onAnalyzeThread: () => void;
  onRefreshDiagnostics: () => void;
  onTestAllConnections: () => void;
  onCreateKnowledgeArticle: () => void;
  onUpdateKnowledgeArticle: (articleId: string, patch: Partial<Pick<KnowledgeArticle, "title" | "body" | "tags" | "active">>) => void;
  onToggleAiFeature: (feature: keyof EmailAiSettings["features"], enabled: boolean) => void;
  onUpdateAiSettings: (patch: Partial<Pick<EmailAiSettings, "defaultLocale" | "requireSourceLinks" | "maxHistoryMessages" | "maxKnowledgeArticles" | "maxContextChars">>) => void;
}) {
  const selectedThread = threads.find((thread) => thread.id === selectedThreadId);
  const selectedMessages = selectedThread ? messagesByThread[selectedThread.id] ?? [] : [];
  const activeAccounts = accounts.filter((account) => account.status === "active" && account.sendEnabled && account.connectionConfigured && getEmailProviderCapability(account.provider).supportsSend);
  const linkedRecordId = emailDraft.recordId || selectedRecord?.id || selectedThread?.recordId || "";
  const selectedThreadRecordId = selectedThread?.recordId || "";
  const selectedProviderCapability = getEmailProviderCapability(accountDraft.provider);
  const selectedProviderSetupVisibility = getEmailProviderSetupVisibility(accountDraft.provider);
  const selectedEmailAiPurposeEnabled = isEmailAiPurposeEnabled(aiSettings.features, aiPurpose);
  const enabledEmailAiAutomationCount = [aiSettings.features.auto_translate, aiSettings.features.auto_context_analysis, aiSettings.features.auto_summarize].filter(Boolean).length;
  const activeKnowledgeArticleCount = knowledgeArticles.filter((article) => article.active).length;

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
            smtpHost: "",
            smtpPort: "465",
            smtpSecure: true,
            smtpStartTls: false,
            imapHost: "",
            imapPort: "993",
            imapSecure: true,
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

  async function addEmailAttachmentFiles(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []);
    if (!selectedFiles.length) {
      return;
    }
    const existing = emailDraft.attachments ?? [];
    if (existing.length + selectedFiles.length > 10) {
      window.alert("邮件附件最多 10 个文件。");
      return;
    }
    try {
      const attachments = await Promise.all(selectedFiles.map(readEmailAttachmentFile));
      onEmailDraftChange({ ...emailDraft, attachments: [...existing, ...attachments] });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "无法读取邮件附件。");
    }
  }

  function removeEmailAttachment(index: number) {
    onEmailDraftChange({
      ...emailDraft,
      attachments: (emailDraft.attachments ?? []).filter((_, candidateIndex) => candidateIndex !== index)
    });
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

  return (
    <div className="email-grid">
      <section className="section">
        <div className="settings-panel-header">
          <div>
            <h2 className="page-title" style={{ fontSize: 18 }}>邮箱账户</h2>
            <div className="subtle">Provider 通过 adapter 扩展，当前 UI 走统一发送/同步 API。</div>
          </div>
        </div>
        {canManageEmailSettings ? (
          <>
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
              <span className={selectedProviderCapability.supportsOAuth ? "badge" : "badge"}>{selectedProviderCapability.connectionKind}</span>
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
          {selectedProviderSetupVisibility.showSmtpImapFields ? (
            <>
          <label>
            <span className="subtle">SMTP Host</span>
            <input className="input" data-testid="email-account-smtp-host" value={accountDraft.smtpHost} onChange={(event) => onAccountDraftChange({ ...accountDraft, smtpHost: event.target.value })} />
          </label>
          <label>
            <span className="subtle">SMTP Port</span>
            <input className="input" type="number" value={accountDraft.smtpPort} onChange={(event) => onAccountDraftChange({ ...accountDraft, smtpPort: event.target.value })} />
          </label>
          <label className="settings-toggle">
            <input type="checkbox" checked={accountDraft.smtpSecure} onChange={(event) => onAccountDraftChange({ ...accountDraft, smtpSecure: event.target.checked, smtpStartTls: event.target.checked ? false : accountDraft.smtpStartTls })} />
            SMTP TLS
          </label>
          <label className="settings-toggle">
            <input type="checkbox" checked={accountDraft.smtpStartTls} onChange={(event) => onAccountDraftChange({ ...accountDraft, smtpStartTls: event.target.checked, smtpSecure: event.target.checked ? false : accountDraft.smtpSecure })} />
            SMTP STARTTLS
          </label>
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
          <label>
            <span className="subtle">用户名</span>
            <input className="input" value={accountDraft.username} onChange={(event) => onAccountDraftChange({ ...accountDraft, username: event.target.value })} />
          </label>
          <label>
            <span className="subtle">密码/应用密码</span>
            <input className="input" type="password" value={accountDraft.password} onChange={(event) => onAccountDraftChange({ ...accountDraft, password: event.target.value })} />
          </label>
          <label>
            <span className="subtle">邮箱文件夹</span>
            <input className="input" value={accountDraft.mailbox} onChange={(event) => onAccountDraftChange({ ...accountDraft, mailbox: event.target.value })} />
          </label>
            </>
          ) : null}
          {selectedProviderSetupVisibility.showOAuthFields ? (
            <>
          <label>
            <span className="subtle">OAuth Access Token</span>
            <input className="input" type="password" value={accountDraft.oauthAccessToken} onChange={(event) => onAccountDraftChange({ ...accountDraft, oauthAccessToken: event.target.value })} />
          </label>
          <label>
            <span className="subtle">OAuth Refresh Token</span>
            <input className="input" type="password" value={accountDraft.oauthRefreshToken} onChange={(event) => onAccountDraftChange({ ...accountDraft, oauthRefreshToken: event.target.value })} />
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
        </div>
        {accountDraft.editingAccountId ? (
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="primary-button" data-testid="email-account-update" type="button" onClick={onUpdateAccountFromDraft} disabled={disabled || !accountDraft.name.trim() || !accountDraft.emailAddress.trim()}>
              <Save size={16} />
              保存账户
            </button>
            <button className="secondary-button" type="button" onClick={onResetAccountDraft} disabled={disabled}>
              取消编辑
            </button>
          </div>
        ) : null}
        <button className="primary-button" data-testid="email-account-create" type="button" style={{ marginTop: 12 }} onClick={onCreateAccount} disabled={disabled || Boolean(accountDraft.editingAccountId) || !accountDraft.name.trim() || !accountDraft.emailAddress.trim()}>
          <Save size={16} />
          创建账户
        </button>

        <button className="secondary-button" data-testid="email-oauth-start" type="button" style={{ marginTop: 8 }} onClick={onStartOAuth} disabled={disabled || Boolean(accountDraft.editingAccountId) || !accountDraft.emailAddress.trim() || !selectedProviderSetupVisibility.canStartOAuth}>
          <Mail size={16} />
          OAuth 授权
        </button>

          </>
        ) : null}

        {canManageEmailSettings ? (
          <div className="toolbar" style={{ marginTop: 12 }}>
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
              <RefreshCw size={16} />
              同步全部
            </button>
          </div>
        ) : null}

        <div className="settings-list" style={{ marginTop: 16 }}>
          {accounts.map((account) => {
            const capability = getEmailProviderCapability(account.provider);
            return (
            <div className="settings-item" key={account.id}>
              <strong>{account.name}</strong>
              <div className="subtle">{account.emailAddress} · {account.provider} · {account.status}</div>
              <div className="toolbar" style={{ marginTop: 8 }}>
                <span className={account.sendEnabled && capability.supportsSend ? "badge" : "danger-badge"}>发送 {account.sendEnabled && capability.supportsSend ? "on" : "off"}</span>
                <span className={account.syncEnabled && capability.supportsSync ? "badge" : "danger-badge"}>同步 {account.syncEnabled && capability.supportsSync ? "on" : "off"}</span>
                <span className={account.connectionConfigured ? "badge" : "danger-badge"}>连接 {account.connectionConfigured ? "已配置" : "未配置"}</span>
                {canManageEmailSettings ? (
                  <>
                <button className="secondary-button" type="button" onClick={() => onTestConnection(account.id)} disabled={disabled || !account.connectionConfigured}>
                  <RefreshCw size={16} />
                  测试连接
                </button>
                <button className="secondary-button" data-testid={`email-account-edit-${account.id}`} type="button" onClick={() => onEditAccount(account)} disabled={disabled}>
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
                  <RefreshCw size={16} />
                  同步
                </button>
                  </>
                ) : null}
              </div>
              {canManageEmailSettings && account.lastConnectionError ? <div className="subtle">连接错误：{account.lastConnectionError}</div> : null}
            </div>
            );
          })}
          {accounts.length === 0 ? <div className="empty-state">还没有邮箱账户</div> : null}
        </div>
      </section>

      {canManageEmailSettings ? <EmailDiagnosticsPanel diagnostics={diagnostics} connectionTestRun={connectionTestRun} disabled={disabled} onRefresh={onRefreshDiagnostics} onTestAll={onTestAllConnections} onRetryMessage={onRetryMessage} /> : null}

      <section className="section">
        <h2 className="page-title" style={{ fontSize: 18 }}>邮件线程</h2>
        <div className="toolbar" style={{ marginTop: 8 }}>
          {selectedThread?.summaryUpdatedAt ? <span className="subtle">Summary {formatDate(selectedThread.summaryUpdatedAt)}</span> : null}
          {selectedThread?.aiAnalysisUpdatedAt ? <span className="subtle">Analysis {formatDate(selectedThread.aiAnalysisUpdatedAt)}</span> : null}
          {selectedThread ? (
            <label className="toolbar" style={{ gap: 6 }}>
              <span className="subtle">关联记录</span>
              <select className="select" data-testid="email-thread-record" value={selectedThreadRecordId} onChange={(event) => onUpdateThread(selectedThread.id, event.target.value)} disabled={disabled}>
                <option value="">不关联</option>
                {records.slice(0, 100).map((record) => (
                  <option key={record.id} value={record.id}>{record.title}</option>
                ))}
              </select>
            </label>
          ) : null}
          <button className="secondary-button" data-testid="email-thread-analyze" type="button" onClick={onAnalyzeThread} disabled={disabled || !selectedThread || !aiSettings.features.context_analysis}>
            <Bot size={16} />
            刷新分析
          </button>
          <button className="secondary-button" data-testid="email-thread-summarize" type="button" onClick={onSummarizeThread} disabled={disabled || !selectedThread || !aiSettings.features.auto_summarize}>
            <Bot size={16} />
            刷新摘要
          </button>
        </div>
        <div className="settings-list" style={{ marginTop: 12 }}>
          {threads.map((thread) => (
            <button className={`settings-select ${thread.id === selectedThreadId ? "selected" : ""}`} key={thread.id} type="button" onClick={() => onSelectThread(thread.id)}>
              <strong>{thread.subject}</strong>
              <div className="subtle">{thread.participantEmails.join(", ")}</div>
              {thread.summary ? <div>{thread.summary}</div> : null}
              {thread.aiAnalysis ? <div className="subtle">{thread.aiAnalysis}</div> : null}
            </button>
          ))}
          {threads.length === 0 ? <div className="empty-state">还没有邮件线程</div> : null}
        </div>
        {selectedThread?.summary ? (
          <div className="ai-box" data-testid="email-thread-summary" style={{ marginTop: 12 }}>
            <div className="activity-meta">Compact 摘要 {selectedThread.summaryUpdatedAt ? `(${formatDate(selectedThread.summaryUpdatedAt)})` : ""}</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{selectedThread.summary}</div>
            <div className="toolbar" style={{ marginTop: 8 }}>
              <span className="badge">用于后续 AI 上下文</span>
              <span className="badge">减少长线程 token 消耗</span>
            </div>
          </div>
        ) : null}
        {selectedThread?.aiAnalysis ? (
          <div className="ai-box" style={{ marginTop: 12 }}>
            <div className="activity-meta">AI 线程分析 {selectedThread.aiAnalysisUpdatedAt ? `(${formatDate(selectedThread.aiAnalysisUpdatedAt)})` : ""}</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{selectedThread.aiAnalysis}</div>
            {renderEmailAiSources(selectedThread.aiAnalysisSources)}
          </div>
        ) : null}
        <div className="activity-list" style={{ marginTop: 16 }}>
          {selectedMessages.map((message) => (
            <div className="activity-item" key={message.id}>
              <div className="activity-meta">{message.direction} · {message.status} · {formatDate(message.createdAt)}</div>
              {message.aiAssisted ? <span className="badge">AI 辅助{message.aiPurpose ? ` · ${message.aiPurpose}` : ""}</span> : null}
              {message.aiAssisted ? renderEmailAiSources(message.aiSources) : null}
              <strong>{message.subject}</strong>
              {message.direction === "outbound" && message.status === "failed" ? (
                <div className="toolbar" style={{ marginTop: 8 }}>
                  {message.failureReason ? <span className="danger-badge">{message.failureReason}</span> : null}
                  <button className="secondary-button" type="button" onClick={() => onRetryMessage(message.id)} disabled={disabled}>
                    <RefreshCw size={14} />
                    重试
                  </button>
                </div>
              ) : null}
              <div className="subtle">发件人 {message.from} · 收件人 {message.to.join(", ")}</div>
              <div>{message.bodyText}</div>
                {hasEmailHtmlPreview(message) ? (
                  <details className="activity-item" style={{ marginTop: 8 }}>
                    <summary>HTML 预览</summary>
                    <iframe sandbox="" srcDoc={buildEmailHtmlPreview(message.bodyHtml ?? "")} data-testid={`email-message-html-${message.id}`} className="email-html-preview" title={`HTML preview ${message.id}`} />
                  </details>
                ) : null}
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
                      <span className="badge" key={`${message.id}-attachment-${attachment.id ?? attachment.providerAttachmentId ?? index}`}>
                        {label}
                      </span>
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
                <button className="secondary-button" data-testid={`email-message-reply-${message.id}`} type="button" onClick={() => onReplyToMessage(message)} disabled={disabled}>
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
            </div>
          ))}
          {selectedThread && selectedMessages.length === 0 ? <div className="empty-state">选择线程后会加载消息</div> : null}
        </div>
      </section>

      <section className="section">
        <h2 className="page-title" style={{ fontSize: 18 }}>撰写与 AI</h2>
        <div className="form-grid" style={{ marginTop: 12 }}>
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
          <label className="wide">
            <span className="subtle">收件人</span>
            <input className="input" data-testid="email-compose-to" value={emailDraft.to} onChange={(event) => onEmailDraftChange(clearEmailDraftAiProvenance({ ...emailDraft, to: event.target.value }))} placeholder="buyer@example.com, team@example.com" />
          </label>
          <label>
            <span className="subtle">CC</span>
            <input className="input" data-testid="email-compose-cc" value={emailDraft.cc} onChange={(event) => onEmailDraftChange(clearEmailDraftAiProvenance({ ...emailDraft, cc: event.target.value }))} placeholder="manager@example.com" />
          </label>
          <label>
            <span className="subtle">BCC</span>
            <input className="input" data-testid="email-compose-bcc" value={emailDraft.bcc} onChange={(event) => onEmailDraftChange(clearEmailDraftAiProvenance({ ...emailDraft, bcc: event.target.value }))} placeholder="archive@example.com" />
          </label>
          <label className="wide">
            <span className="subtle">主题</span>
            <input className="input" data-testid="email-compose-subject" value={emailDraft.subject} onChange={(event) => onEmailDraftChange(clearEmailDraftAiProvenance({ ...emailDraft, subject: event.target.value }))} />
          </label>
          <label className="wide">
            <span className="subtle">正文</span>
            <textarea className="textarea" data-testid="email-compose-body" value={emailDraft.bodyText} onChange={(event) => onEmailDraftChange(clearEmailDraftAiProvenance({ ...emailDraft, bodyText: event.target.value }))} />
          </label>
          <label className="wide">
            <span className="subtle">附件</span>
            <input
              className="input"
              data-testid="email-compose-attachments"
              multiple
              type="file"
              onChange={(event) => {
                void addEmailAttachmentFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
          {emailDraft.attachments?.length ? (
            <div className="toolbar wide">
              {emailDraft.attachments.map((attachment, index) => (
                <button className="secondary-button" key={`${attachment.fileName}-${index}`} type="button" onClick={() => removeEmailAttachment(index)}>
                  <Upload size={14} />
                  {attachment.fileName} · {formatBytes(attachment.size)}
                  <XCircle size={14} />
                </button>
              ))}
            </div>
          ) : null}
        </div>
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
          <button className="primary-button" data-testid="email-send" type="button" onClick={onSend} disabled={disabled || !emailDraft.accountId || !emailDraft.to.trim() || !emailDraft.subject.trim() || !emailDraft.bodyText.trim()}>
            <Send size={16} />
            发送
          </button>
        </div>

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
          {canManageEmailSettings ? (
            <>
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
            </>
          ) : null}
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

function TaskView({
  activities,
  users,
  onToggle
}: {
  activities: Activity[];
  users: User[];
  onToggle: (activity: Activity, completed: boolean) => void;
}) {
  return (
    <section className="section">
      <h2 className="page-title">待办任务</h2>
      <TaskList
        activities={activities}
        emptyMessage="暂无待办任务"
        testIdPrefix="task-view-task"
        users={users}
        onToggle={onToggle}
      />
    </section>
  );
}

function TaskList({
  activities,
  emptyMessage,
  testIdPrefix,
  users,
  onToggle
}: {
  activities: Activity[];
  emptyMessage: string;
  testIdPrefix?: string;
  users: User[];
  onToggle: (activity: Activity, completed: boolean) => void;
}) {
  if (activities.length === 0) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  return (
    <div className="activity-list" style={{ marginTop: 12 }}>
      {activities.map((activity) => {
        const completed = Boolean(activity.completedAt);
        const overdue = isTaskOverdue(activity);
        return (
          <div
            className="activity-item"
            data-completed={completed ? "true" : "false"}
            data-testid={testIdPrefix ? `${testIdPrefix}-${activity.id}` : undefined}
            key={activity.id}
          >
            <div className="activity-meta">
              <CalendarClock size={15} />
              截止 {formatDate(activity.dueAt)} · {users.find((user) => user.id === activity.actorId)?.name ?? "未分配"}
              {completed && <span className="badge">已完成</span>}
              {!completed && overdue && <span className="badge danger-badge">已逾期</span>}
            </div>
            <strong>{activity.title}</strong>
            {activity.body && <div className="subtle">{activity.body}</div>}
            <div className="toolbar" style={{ marginTop: 10 }}>
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
            </div>
          </div>
        );
      })}
    </div>
  );
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
      {activities.map((activity) => (
        <div className="activity-item" data-testid={testIdPrefix ? `${testIdPrefix}-${activity.id}` : undefined} key={activity.id}>
          <div className="activity-meta">{renderMeta(activity)}</div>
          <strong>{activity.title}</strong>
          {activity.body && <div className="subtle">{activity.body}</div>}
        </div>
      ))}
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
          <RefreshCw size={16} />
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
                <RefreshCw size={15} />
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

function FieldInput({
  field,
  value,
  allRecords,
  users,
  testId,
  onRecordsLoaded,
  onChange
}: {
  field: FieldDefinition;
  value: string;
  allRecords: CrmRecord[];
  users: User[];
  testId?: string;
  onRecordsLoaded?: (records: CrmRecord[]) => void;
  onChange: (value: string) => void;
}) {
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
      <label>
        <span className="subtle">{field.label}</span>
        <select className="select" data-testid={testId} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">请选择</option>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
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

  return (
    <label>
      <span className="subtle">{field.label}</span>
      <input
        className="input"
        data-testid={testId ? `${testId}-search` : undefined}
        disabled={!referencedObjectKey}
        placeholder="搜索引用记录"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        style={{ marginBottom: 8 }}
      />
      <select className="select" data-testid={testId} disabled={!referencedObjectKey} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{isSearching ? "搜索中..." : "请选择"}</option>
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.title}
          </option>
        ))}
      </select>
      {searchError ? <span className="subtle">{searchError}</span> : null}
    </label>
  );
}

function buildInitialValues(fields: FieldDefinition[]): Record<string, string> {
  return fields.reduce<Record<string, string>>((accumulator, field) => {
    accumulator[field.key] = "";
    return accumulator;
  }, {});
}

function buildRecordValues(fields: FieldDefinition[], record: CrmRecord): Record<string, string> {
  const values = buildInitialValues(fields);

  for (const field of fields) {
    values[field.key] = toInputValue(record.data[field.key]);
  }

  if (record.stageKey) {
    values.__stageKey = record.stageKey;
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

function parseFormValues(fields: FieldDefinition[], values: Record<string, string>): Record<string, unknown> {
  return fields.reduce<Record<string, unknown>>((data, field) => {
    const raw = values[field.key];
    if (raw === undefined || raw === "") {
      return data;
    }

    if (field.type === "number" || field.type === "currency") {
      data[field.key] = Number(raw);
    } else if (field.type === "boolean") {
      data[field.key] = raw === "true";
    } else {
      data[field.key] = raw;
    }

    return data;
  }, {});
}

function displayTableColumnValue(column: TableColumn, record: CrmRecord, records: CrmRecord[], users: User[]): string {
  if (column.type === "owner") {
    return ownerLabel(record.ownerId, users);
  }

  return displayValue(column.field, record.data[column.field.key], records, users);
}

function displayValue(field: FieldDefinition | undefined, value: unknown, records: CrmRecord[], users: User[]): string {
  if (!field) {
    return String(value ?? "-");
  }
  if (field.type === "currency") {
    return formatCurrency(value);
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

  return String(value ?? "-");
}

function ownerLabel(ownerId: string | undefined, users: User[]): string {
  const owner = users.find((user) => user.id === ownerId);
  return owner ? `${owner.name} · ${owner.email}` : "-";
}

function isTaskOverdue(activity: Activity): boolean {
  if (activity.completedAt || !activity.dueAt) {
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

function getReferenceObjectKeysForObject(fields: FieldDefinition[], objectKey: string): Set<string> {
  return fields.reduce<Set<string>>((keys, field) => {
    if (field.objectKey === objectKey && field.type === "reference") {
      const referencedObjectKey = field.options?.[0]?.value;
      if (referencedObjectKey) {
        keys.add(referencedObjectKey);
      }
    }
    return keys;
  }, new Set());
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
          <RefreshCw size={16} />
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
                      <RefreshCw size={14} />
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

function formatEmailConnectionTestResult(entry: EmailConnectionTestRun["results"][number]): string {
  if (entry.skipped) {
    return entry.reason ?? "已跳过";
  }
  if (!entry.ok) {
    return entry.error ?? "连接测试失败";
  }
  const channels = [
    entry.result?.smtp ? `SMTP ${entry.result.smtp}` : undefined,
    entry.result?.imap ? `IMAP ${entry.result.imap}` : undefined,
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

async function readEmailAttachmentFile(file: File): Promise<EmailAttachment> {
  if (file.size > MAX_EMAIL_ATTACHMENT_BYTES) {
    throw new Error(`附件 ${file.name} 超过 5 MB。`);
  }
  return {
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    size: file.size,
    contentBase64: await readFileAsBase64(file)
  };
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      resolve(value.includes(",") ? value.split(",").slice(1).join(",") : value);
    });
    reader.addEventListener("error", () => reject(new Error(`无法读取附件 ${file.name}。`)));
    reader.readAsDataURL(file);
  });
}

function buildEmailConnectionConfig(draft: EmailAccountDraft) {
  const oauthProvider = isOAuthEmailProvider(draft.provider) ? draft.provider : undefined;
  const hasAnyConfig = [draft.smtpHost, draft.imapHost, draft.username, draft.password, draft.oauthAccessToken, draft.oauthRefreshToken].some((value) => value.trim());
  if (!hasAnyConfig) {
    return undefined;
  }
  return {
    smtpHost: draft.smtpHost.trim() || undefined,
    smtpPort: draft.smtpPort ? Number(draft.smtpPort) : undefined,
    smtpSecure: draft.smtpSecure,
    smtpStartTls: draft.smtpStartTls,
    imapHost: draft.imapHost.trim() || undefined,
    imapPort: draft.imapPort ? Number(draft.imapPort) : undefined,
    imapSecure: draft.imapSecure,
    username: draft.username.trim() || undefined,
    password: draft.password || undefined,
    mailbox: draft.mailbox.trim() || "INBOX",
    oauthProvider,
    accessToken: draft.oauthAccessToken.trim() || undefined,
    refreshToken: draft.oauthRefreshToken.trim() || undefined,
    expiresAt: draft.oauthExpiresAt ? new Date(draft.oauthExpiresAt).toISOString() : undefined,
    scope: draft.oauthScope.trim() || undefined
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
  if (activeNav === "contacts" || activeNav === "companies" || activeNav === "deals" || activeNav === "records") {
    return activeObjectLabel ?? "";
  }

  return navigationItems.find((item) => item.key === activeNav)?.label ?? "AI Agent CRM";
}
