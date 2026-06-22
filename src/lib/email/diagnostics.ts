import type { AuditLog, EmailAccount, EmailAiSettings, EmailMessage, EmailProviderType } from "@/lib/crm/types";
import type { RequestContext } from "@/lib/crm/types";
import { requirePermission } from "@/lib/auth/rbac";
import { getEmailDeliveryMode } from "@/lib/email/delivery-mode";
import { EMAIL_AUTO_SUMMARY_MIN_NEW_MESSAGES } from "@/lib/email/automations";
import { normalizeEmailAiFeatures } from "@/lib/email/assistant";
import { MAX_EMAIL_AI_OUTPUT_CHARS, MAX_EMAIL_AI_SUBJECT_CHARS, MAX_EMAIL_MODEL_PROMPT_CHARS } from "@/lib/email/ai-generation";
import { getOAuthEmailProviderCapability, oauthEmailProviderKeys, type OAuthEmailProviderType } from "@/lib/email/providers";
import { checkJobHealth, type JobHealth } from "@/lib/ops/health";

export type EmailDiagnosticStatus = "ok" | "warning" | "error";

export interface EmailDiagnosticCheck {
  status: EmailDiagnosticStatus;
  message: string;
}

export interface OAuthProviderDiagnostic extends EmailDiagnosticCheck {
  provider: OAuthEmailProviderType;
  configured: boolean;
  required: boolean;
  scope: string;
  missingScopes: string[];
}

export interface EmailAccountDiagnostics {
  total: number;
  active: number;
  draft: number;
  disabled: number;
  error: number;
  syncEnabled: number;
  sendEnabled: number;
  connectionConfigured: number;
  activeConnectionConfigured: number;
  syncConnectionConfigured: number;
  sendConnectionConfigured: number;
  missingConnectionConfig: number;
  withLastConnectionError: number;
  byProvider: Record<EmailProviderType, number>;
}

export interface EmailAiAutomationFailureDiagnostics extends EmailDiagnosticCheck {
  recentFailureCount: number;
  recentFailures: Array<{
    purpose?: string;
    threadId?: string;
    sourceMessageId?: string;
    errorMessage?: string;
    createdAt: string;
  }>;
}

export interface EmailAiProviderFallbackDiagnostics extends EmailDiagnosticCheck {
  recentFallbackCount: number;
  recentFallbacks: Array<{
    purpose?: string;
    generationMode?: string;
    threadId?: string;
    sourceMessageId?: string;
    providerError?: string;
    createdAt: string;
  }>;
}

export interface EmailAutoSummaryPolicyDiagnostics extends EmailDiagnosticCheck {
  enabled: boolean;
  minNewMessages: number;
  maxHistoryMessages: number;
  maxContextChars: number;
}

export interface EmailAiContextPolicyDiagnostics extends EmailDiagnosticCheck {
  loaded: boolean;
  requireSourceLinks: boolean;
  defaultLocale: string;
  maxHistoryMessages: number;
  maxKnowledgeArticles: number;
  maxContextChars: number;
  enabledFeatures: EmailAiSettings["features"];
  enabledAutomationCount: number;
  featureDependencies: Array<{
    feature: keyof EmailAiSettings["features"];
    dependsOn: keyof EmailAiSettings["features"];
  }>;
  automationEligibleStatuses: {
    inbound: EmailMessage["status"][];
    outbound: EmailMessage["status"][];
  };
  autoContextAnalysisScope: "inbound_received_only";
  budgetPolicy: {
    maxModelPromptChars: number;
    maxGeneratedOutputChars: number;
    maxSuggestedSubjectChars: number;
  };
}

export interface EmailSyncSchedulerDiagnostics extends EmailDiagnosticCheck {
  intervalMs: number;
  limit?: number;
  userId: string;
  queueBacked: boolean;
  syncEnabledAccounts?: number;
}

export interface EmailSendClaimDiagnostics extends EmailDiagnosticCheck {
  timeoutMs: number;
  sendingCount: number;
  staleCount: number;
  staleMessages: Array<{
    id: string;
    accountId: string;
    subject: string;
    sendAttemptedAt?: string;
  }>;
}

export interface EmailSubsystemDiagnostics {
  ok: boolean;
  status: EmailDiagnosticStatus;
  encryption: EmailDiagnosticCheck;
  oauthState: EmailDiagnosticCheck;
  oauthCallback: EmailDiagnosticCheck & { callbackUrl?: string };
  deliveryMode: EmailDiagnosticCheck;
  aiProvider: EmailDiagnosticCheck;
  aiContextPolicy: EmailAiContextPolicyDiagnostics;
  autoSummaryPolicy: EmailAutoSummaryPolicyDiagnostics;
  syncScheduler: EmailSyncSchedulerDiagnostics;
  sendClaims: EmailSendClaimDiagnostics;
  aiAutomationFailures: EmailAiAutomationFailureDiagnostics;
  aiProviderFallbacks: EmailAiProviderFallbackDiagnostics;
  oauthProviders: Record<OAuthEmailProviderType, OAuthProviderDiagnostic>;
  jobs?: JobHealth;
  accounts?: EmailAccountDiagnostics;
}

export interface EmailSubsystemDiagnosticOptions {
  env?: NodeJS.ProcessEnv;
  accounts?: EmailAccount[];
  sendingMessages?: EmailMessage[];
  aiSettings?: EmailAiSettings;
  auditLogs?: AuditLog[];
  includeJobs?: boolean;
  checkJobs?: () => Promise<JobHealth>;
}

export interface EmailDiagnosticsRepository {
  listEmailAccounts(context: RequestContext): EmailAccount[] | Promise<EmailAccount[]>;
  listEmailSendingMessages?(context: RequestContext, limit?: number): EmailMessage[] | Promise<EmailMessage[]>;
  getEmailAiSettings?(context: RequestContext): EmailAiSettings | Promise<EmailAiSettings>;
  listAuditLogs?(context: RequestContext, query?: { entityType?: string; page?: number; pageSize?: number }): AuditLog[] | Promise<AuditLog[]>;
}

export async function checkEmailSubsystemDiagnosticsForContext(
  context: RequestContext,
  repository: EmailDiagnosticsRepository,
  options: Omit<EmailSubsystemDiagnosticOptions, "accounts"> = {}
): Promise<EmailSubsystemDiagnostics> {
  requirePermission(context, "crm.admin");
  const accounts = await repository.listEmailAccounts(context);
  const sendingMessages = repository.listEmailSendingMessages ? await repository.listEmailSendingMessages(context, 50) : undefined;
  const aiSettings = repository.getEmailAiSettings ? await repository.getEmailAiSettings(context) : undefined;
  const auditLogs = repository.listAuditLogs ? await repository.listAuditLogs(context, { entityType: "email_ai_generation", page: 1, pageSize: 50 }) : undefined;
  return checkEmailSubsystemDiagnostics({ ...options, accounts, sendingMessages, aiSettings, auditLogs });
}

export async function checkEmailSubsystemDiagnostics(options: EmailSubsystemDiagnosticOptions = {}): Promise<EmailSubsystemDiagnostics> {
  const env = options.env ?? process.env;
  const accounts = options.accounts;
  const accountDiagnostics = accounts ? buildEmailAccountDiagnostics(accounts) : undefined;
  const aiContextPolicy = buildEmailAiContextPolicyDiagnostics(options.aiSettings);
  const autoSummaryPolicy = buildEmailAutoSummaryPolicyDiagnostics(options.aiSettings);
  const syncScheduler = buildEmailSyncSchedulerDiagnostics(env, accountDiagnostics);
  const sendClaims = buildEmailSendClaimDiagnostics(options.sendingMessages ?? [], env);
  const aiAutomationFailures = buildEmailAiAutomationFailureDiagnostics(options.auditLogs ?? []);
  const aiProviderFallbacks = buildEmailAiProviderFallbackDiagnostics(options.auditLogs ?? []);
  const usedProviders = new Set((accounts ?? []).map((account) => account.provider));
  const oauthProviders = buildOAuthProviderDiagnostics(env, usedProviders);
  const encryption = checkSecret(env.EMAIL_CONFIG_SECRET ?? env.APP_SECRET, "Mailbox credential encryption is configured", "EMAIL_CONFIG_SECRET or APP_SECRET must be at least 16 characters");
  const oauthState = checkSecret(
    env.EMAIL_OAUTH_STATE_SECRET ?? env.APP_SECRET ?? env.EMAIL_CONFIG_SECRET,
    "OAuth state signing is configured",
    "EMAIL_OAUTH_STATE_SECRET, APP_SECRET, or EMAIL_CONFIG_SECRET must be at least 16 characters"
  );
  const diagnostics: EmailSubsystemDiagnostics = {
    ok: true,
    status: "ok",
    encryption,
    oauthState,
    oauthCallback: checkOAuthCallback(env, Object.values(oauthProviders).some((provider) => provider.configured || provider.required)),
    deliveryMode: checkDeliveryMode(env),
    aiProvider: checkAiProvider(env),
    aiContextPolicy,
    autoSummaryPolicy,
    syncScheduler,
    sendClaims,
    aiAutomationFailures,
    aiProviderFallbacks,
    oauthProviders,
    ...(accountDiagnostics ? { accounts: accountDiagnostics } : {})
  };

  if (options.includeJobs) {
    diagnostics.jobs = await (options.checkJobs ?? checkJobHealth)();
  }

  const statuses = [
    diagnostics.encryption.status,
    diagnostics.oauthState.status,
    diagnostics.oauthCallback.status,
    diagnostics.deliveryMode.status,
    diagnostics.aiProvider.status,
    diagnostics.aiContextPolicy.status,
    diagnostics.autoSummaryPolicy.status,
    diagnostics.syncScheduler.status,
    diagnostics.sendClaims.status,
    diagnostics.aiAutomationFailures.status,
    diagnostics.aiProviderFallbacks.status,
    ...Object.values(diagnostics.oauthProviders).map((diagnostic) => diagnostic.status),
    diagnostics.jobs && !diagnostics.jobs.ok ? "error" : "ok",
    accountDiagnostics && accountDiagnostics.active > accountDiagnostics.activeConnectionConfigured ? "warning" : "ok",
    accountDiagnostics && accountDiagnostics.error > 0 ? "warning" : "ok"
  ].filter(Boolean) as EmailDiagnosticStatus[];
  diagnostics.status = statuses.includes("error") ? "error" : statuses.includes("warning") ? "warning" : "ok";
  diagnostics.ok = diagnostics.status !== "error";
  return diagnostics;
}

export function buildEmailSyncSchedulerDiagnostics(
  env: NodeJS.ProcessEnv,
  accounts?: Pick<EmailAccountDiagnostics, "syncEnabled">
): EmailSyncSchedulerDiagnostics {
  const rawInterval = env.EMAIL_SYNC_INTERVAL_MS?.trim();
  const parsedInterval = rawInterval ? Number(rawInterval) : 300000;
  const rawLimit = env.EMAIL_SYNC_LIMIT?.trim();
  const parsedLimit = rawLimit ? Number(rawLimit) : undefined;
  const userId = env.EMAIL_SYNC_USER_ID?.trim() || env.JOB_USER_ID?.trim() || "user-admin";
  const queueBacked = (env.JOB_EXECUTOR ?? "inline").trim() === "redis";
  const syncEnabledAccounts = accounts?.syncEnabled;

  if (!Number.isFinite(parsedInterval) || parsedInterval <= 0) {
    return {
      status: "error",
      intervalMs: 300000,
      userId,
      queueBacked,
      syncEnabledAccounts,
      message: "EMAIL_SYNC_INTERVAL_MS must be a positive integer when continuous mailbox sync is enabled"
    };
  }

  const intervalMs = Math.floor(parsedInterval);
  if (parsedLimit !== undefined && (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 100)) {
    return {
      status: "error",
      intervalMs,
      userId,
      queueBacked,
      syncEnabledAccounts,
      message: "EMAIL_SYNC_LIMIT must be an integer between 1 and 100 when configured"
    };
  }
  const limit = parsedLimit === undefined ? undefined : Math.floor(parsedLimit);
  if (syncEnabledAccounts && syncEnabledAccounts > 0 && !queueBacked) {
    return {
      status: "warning",
      intervalMs,
      limit,
      userId,
      queueBacked,
      syncEnabledAccounts,
      message: `Email sync scheduler runs every ${intervalMs} ms as ${userId}${limit ? ` with limit ${limit}` : ""}; ${syncEnabledAccounts} sync-enabled account(s) will run inline unless JOB_EXECUTOR=redis is configured`
    };
  }

  return {
    status: "ok",
    intervalMs,
    limit,
    userId,
    queueBacked,
    syncEnabledAccounts,
    message: `Email sync scheduler runs every ${intervalMs} ms as ${userId}${limit ? ` with limit ${limit}` : ""}${queueBacked ? " and enqueues jobs through Redis" : ""}`
  };
}

export function buildEmailSendClaimDiagnostics(messages: EmailMessage[], env: NodeJS.ProcessEnv = process.env): EmailSendClaimDiagnostics {
  const timeoutMs = normalizeEmailSendClaimTimeoutMs(env.EMAIL_SEND_CLAIM_TIMEOUT_MS);
  const staleBefore = new Date(Date.now() - timeoutMs);
  const sendingMessages = messages.filter((message) => message.direction === "outbound" && message.status === "sending");
  const staleMessages = sendingMessages
    .filter((message) => isEmailSendClaimStale(message.sendAttemptedAt, staleBefore))
    .slice(0, 10)
    .map((message) => ({
      id: message.id,
      accountId: message.accountId,
      subject: message.subject,
      sendAttemptedAt: message.sendAttemptedAt
    }));
  const staleCount = sendingMessages.filter((message) => isEmailSendClaimStale(message.sendAttemptedAt, staleBefore)).length;

  if (staleCount > 0) {
    return {
      status: "warning",
      timeoutMs,
      sendingCount: sendingMessages.length,
      staleCount,
      staleMessages,
      message: `${staleCount} outbound email send claim(s) are stale and can be reclaimed by the next send worker`
    };
  }

  return {
    status: "ok",
    timeoutMs,
    sendingCount: sendingMessages.length,
    staleCount: 0,
    staleMessages: [],
    message: sendingMessages.length
      ? `${sendingMessages.length} outbound email send claim(s) are currently in progress`
      : "No outbound email sends are currently claimed"
  };
}

export function buildEmailAiContextPolicyDiagnostics(settings: EmailAiSettings | undefined): EmailAiContextPolicyDiagnostics {
  const enabledFeatures = normalizeEmailAiFeatures(settings?.features);
  const maxHistoryMessages = normalizeLimit(settings?.maxHistoryMessages, 8, 1, 20);
  const maxKnowledgeArticles = normalizeLimit(settings?.maxKnowledgeArticles, 5, 0, 20);
  const maxContextChars = normalizeLimit(settings?.maxContextChars, 8000, 1000, 20000);
  const requireSourceLinks = settings?.requireSourceLinks ?? true;
  const defaultLocale = settings?.defaultLocale?.trim() || "zh-CN";
  const enabledAutomationCount = [
    enabledFeatures.auto_translate,
    enabledFeatures.auto_context_analysis,
    enabledFeatures.auto_summarize
  ].filter(Boolean).length;
  const featureDependencies: EmailAiContextPolicyDiagnostics["featureDependencies"] = [
    { feature: "auto_translate", dependsOn: "translate" },
    { feature: "auto_context_analysis", dependsOn: "context_analysis" }
  ];
  const automationEligibleStatuses: EmailAiContextPolicyDiagnostics["automationEligibleStatuses"] = {
    inbound: ["received"],
    outbound: ["sent"]
  };
  const autoContextAnalysisScope: EmailAiContextPolicyDiagnostics["autoContextAnalysisScope"] = "inbound_received_only";
  const budgetPolicy: EmailAiContextPolicyDiagnostics["budgetPolicy"] = {
    maxModelPromptChars: MAX_EMAIL_MODEL_PROMPT_CHARS,
    maxGeneratedOutputChars: MAX_EMAIL_AI_OUTPUT_CHARS,
    maxSuggestedSubjectChars: MAX_EMAIL_AI_SUBJECT_CHARS
  };

  if (!settings) {
    return {
      status: "ok",
      loaded: false,
      requireSourceLinks,
      defaultLocale,
      maxHistoryMessages,
      maxKnowledgeArticles,
      maxContextChars,
      enabledFeatures,
      enabledAutomationCount,
      featureDependencies,
      automationEligibleStatuses,
      autoContextAnalysisScope,
      budgetPolicy,
      message: "Email AI workspace settings were not loaded; context policy is enforced when a workspace request runs"
    };
  }

  const warnings = [
    !requireSourceLinks ? "source references are optional" : undefined,
    maxKnowledgeArticles === 0 ? "knowledge base context is disabled" : undefined
  ].filter(Boolean);

  return {
    status: warnings.length ? "warning" : "ok",
    loaded: true,
    requireSourceLinks,
    defaultLocale,
    maxHistoryMessages,
    maxKnowledgeArticles,
    maxContextChars,
    enabledFeatures,
      enabledAutomationCount,
      featureDependencies,
      automationEligibleStatuses,
      autoContextAnalysisScope,
      budgetPolicy,
      message: [
        requireSourceLinks ? "Source references are required" : "Source references are optional",
        `history ${maxHistoryMessages} messages`,
        `knowledge ${maxKnowledgeArticles} articles`,
        `context budget ${maxContextChars} chars`,
        `model prompt cap ${budgetPolicy.maxModelPromptChars} chars`,
        `output cap ${budgetPolicy.maxGeneratedOutputChars} chars`,
        `automations ${enabledAutomationCount} enabled`,
        "dependencies auto_translate->translate, auto_context_analysis->context_analysis",
        "automation states inbound received/outbound sent",
        "auto analysis inbound only"
    ].join("; ")
  };
}

export function buildEmailAutoSummaryPolicyDiagnostics(settings: EmailAiSettings | undefined): EmailAutoSummaryPolicyDiagnostics {
  const maxHistoryMessages = normalizeLimit(settings?.maxHistoryMessages, 8, 1, 20);
  const maxContextChars = normalizeLimit(settings?.maxContextChars, 8000, 1000, 20000);
  const minNewMessages = Math.min(EMAIL_AUTO_SUMMARY_MIN_NEW_MESSAGES, maxHistoryMessages);
  const enabled = settings?.features.auto_summarize ?? false;

  if (!settings) {
    return {
      status: "ok",
      enabled: false,
      minNewMessages,
      maxHistoryMessages,
      maxContextChars,
      message: "Email AI settings were not loaded; workspace settings will control automatic summarization at runtime"
    };
  }

  if (!enabled) {
    return {
      status: "ok",
      enabled,
      minNewMessages,
      maxHistoryMessages,
      maxContextChars,
      message: "Automatic email thread summarization is disabled"
    };
  }

  return {
    status: "ok",
    enabled,
    minNewMessages,
    maxHistoryMessages,
    maxContextChars,
    message: `Automatic summaries are throttled until a thread reaches ${maxHistoryMessages} history messages, ${minNewMessages} new messages after the last summary, or enough text to pressure the context budget`
  };
}

export function buildEmailAiAutomationFailureDiagnostics(auditLogs: AuditLog[]): EmailAiAutomationFailureDiagnostics {
  const recentFailures = auditLogs
    .filter((log) => log.entityType === "email_ai_generation" && log.details?.automationFailed === true)
    .slice(0, 10)
    .map((log) => ({
      purpose: typeof log.details?.purpose === "string" ? log.details.purpose : undefined,
      threadId: typeof log.details?.threadId === "string" ? log.details.threadId : undefined,
      sourceMessageId: typeof log.details?.sourceMessageId === "string" ? log.details.sourceMessageId : undefined,
      errorMessage: typeof log.details?.errorMessage === "string" ? log.details.errorMessage : undefined,
      createdAt: log.createdAt
    }));
  if (!recentFailures.length) {
    return {
      status: "ok",
      message: "No recent email AI automation failures were found",
      recentFailureCount: 0,
      recentFailures: []
    };
  }
  return {
    status: "warning",
    message: `${recentFailures.length} recent email AI automation failure${recentFailures.length === 1 ? "" : "s"} found`,
    recentFailureCount: recentFailures.length,
    recentFailures
  };
}

export function buildEmailAiProviderFallbackDiagnostics(auditLogs: AuditLog[]): EmailAiProviderFallbackDiagnostics {
  const recentFallbacks = auditLogs
    .filter((log) => log.entityType === "email_ai_generation" && log.details?.generationMode === "provider_fallback")
    .slice(0, 10)
    .map((log) => ({
      purpose: typeof log.details?.purpose === "string" ? log.details.purpose : undefined,
      generationMode: typeof log.details?.generationMode === "string" ? log.details.generationMode : undefined,
      threadId: typeof log.details?.threadId === "string" ? log.details.threadId : undefined,
      sourceMessageId: typeof log.details?.sourceMessageId === "string" ? log.details.sourceMessageId : undefined,
      providerError: typeof log.details?.providerError === "string" ? log.details.providerError : undefined,
      createdAt: log.createdAt
    }));
  if (!recentFallbacks.length) {
    return {
      status: "ok",
      message: "No recent email AI provider fallbacks were found",
      recentFallbackCount: 0,
      recentFallbacks: []
    };
  }
  return {
    status: "warning",
    message: `${recentFallbacks.length} recent email AI provider fallback${recentFallbacks.length === 1 ? "" : "s"} found`,
    recentFallbackCount: recentFallbacks.length,
    recentFallbacks
  };
}

export function buildEmailAccountDiagnostics(accounts: EmailAccount[]): EmailAccountDiagnostics {
  const byProvider = {
    smtp_imap: 0,
    gmail: 0,
    outlook: 0,
    custom: 0
  } satisfies Record<EmailProviderType, number>;

  for (const account of accounts) {
    byProvider[account.provider] += 1;
  }

  return {
    total: accounts.length,
    active: accounts.filter((account) => account.status === "active").length,
    draft: accounts.filter((account) => account.status === "draft").length,
    disabled: accounts.filter((account) => account.status === "disabled").length,
    error: accounts.filter((account) => account.status === "error").length,
    syncEnabled: accounts.filter((account) => account.syncEnabled).length,
    sendEnabled: accounts.filter((account) => account.sendEnabled).length,
    connectionConfigured: accounts.filter((account) => account.connectionConfigured).length,
    activeConnectionConfigured: accounts.filter((account) => account.status === "active" && account.connectionConfigured).length,
    syncConnectionConfigured: accounts.filter((account) => account.status === "active" && account.syncEnabled && account.connectionConfigured).length,
    sendConnectionConfigured: accounts.filter((account) => account.status === "active" && account.sendEnabled && account.connectionConfigured).length,
    missingConnectionConfig: accounts.filter((account) => !account.connectionConfigured).length,
    withLastConnectionError: accounts.filter((account) => Boolean(account.lastConnectionError)).length,
    byProvider
  };
}

function checkSecret(value: string | undefined, okMessage: string, errorMessage: string): EmailDiagnosticCheck {
  return value && value.length >= 16 ? { status: "ok", message: okMessage } : { status: "error", message: errorMessage };
}

function checkAiProvider(env: NodeJS.ProcessEnv): EmailDiagnosticCheck {
  const provider = (env.AI_PROVIDER ?? "openai-compatible").trim() || "openai-compatible";
  if (provider !== "openai-compatible") {
    return { status: "ok", message: `AI provider ${provider} is configured` };
  }
  return env.AI_API_KEY?.trim()
    ? { status: "ok", message: "OpenAI-compatible AI provider is configured" }
    : { status: "warning", message: "AI_API_KEY is empty; email AI will use the local fallback" };
}

function checkDeliveryMode(env: NodeJS.ProcessEnv): EmailDiagnosticCheck {
  if (getEmailDeliveryMode(env) !== "dry-run") {
    return { status: "ok", message: "Email delivery mode is live" };
  }
  if (env.NODE_ENV === "production") {
    return { status: "error", message: "EMAIL_DELIVERY_MODE=dry-run must not be enabled in production" };
  }
  return { status: "warning", message: "Email delivery mode is dry-run; outbound messages are recorded without reaching a mailbox provider" };
}

function checkOAuthCallback(env: NodeJS.ProcessEnv, oauthRelevant: boolean): EmailDiagnosticCheck & { callbackUrl?: string } {
  const appBaseUrl = env.APP_BASE_URL?.trim();
  if (!appBaseUrl) {
    return {
      status: oauthRelevant ? "error" : "warning",
      message: "APP_BASE_URL is not configured; OAuth callback URL cannot be derived"
    };
  }

  let url: URL;
  try {
    url = new URL(appBaseUrl);
  } catch {
    return {
      status: "error",
      message: "APP_BASE_URL must be a valid URL before mailbox OAuth can be used"
    };
  }

  const originOnly = url.pathname === "/" && !url.search && !url.hash;
  const callbackUrl = `${url.origin}/api/email/oauth/callback`;
  if (!originOnly) {
    return {
      status: "warning",
      message: "APP_BASE_URL should be an origin only; OAuth callback uses the origin portion",
      callbackUrl
    };
  }

  const isLoopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase());
  if (oauthRelevant && url.protocol !== "https:" && !isLoopback) {
    return {
      status: "error",
      message: "Mailbox OAuth requires an externally reachable HTTPS APP_BASE_URL",
      callbackUrl
    };
  }

  return {
    status: "ok",
    message: "OAuth callback URL is derived from APP_BASE_URL",
    callbackUrl
  };
}

function buildOAuthProviderDiagnostics(env: NodeJS.ProcessEnv, usedProviders: Set<EmailProviderType>): Record<OAuthEmailProviderType, OAuthProviderDiagnostic> {
  return Object.fromEntries(
    oauthEmailProviderKeys.map((provider) => [provider, checkOAuthProvider(provider, env, usedProviders.has(provider))])
  ) as Record<OAuthEmailProviderType, OAuthProviderDiagnostic>;
}

function checkOAuthProvider(provider: OAuthEmailProviderType, env: NodeJS.ProcessEnv, required: boolean): OAuthProviderDiagnostic {
  const capability = getOAuthEmailProviderCapability(provider);
  const prefix = capability.oauthEnvPrefix;
  const configured = Boolean(env[`${prefix}_OAUTH_CLIENT_ID`]?.trim() && env[`${prefix}_OAUTH_CLIENT_SECRET`]?.trim());
  const scope = env[`${prefix}_OAUTH_SCOPE`]?.trim() || capability.defaultScope;
  const missingScopes = getMissingOAuthScopes(provider, scope);
  if (configured) {
    if (missingScopes.length) {
      return {
        provider,
        configured,
        required,
        scope,
        missingScopes,
        status: "error",
        message: `${prefix}_OAUTH_SCOPE is missing required permission(s): ${missingScopes.join(", ")}`
      };
    }
    return {
      provider,
      configured,
      required,
      scope,
      missingScopes,
      status: "ok",
      message: `${prefix}_OAUTH_CLIENT_ID, ${prefix}_OAUTH_CLIENT_SECRET, and ${prefix}_OAUTH_SCOPE are configured`
    };
  }

  return {
    provider,
    configured,
    required,
    scope,
    missingScopes,
    status: required ? "error" : "warning",
    message: required
      ? `${prefix}_OAUTH_CLIENT_ID and ${prefix}_OAUTH_CLIENT_SECRET are required because ${provider} accounts exist`
      : `${prefix}_OAUTH_CLIENT_ID and ${prefix}_OAUTH_CLIENT_SECRET are not configured`
  };
}

function getMissingOAuthScopes(provider: OAuthEmailProviderType, scope: string): string[] {
  const scopes = scope
    .split(/\s+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const has = (value: string) => scopes.includes(value.toLowerCase());
  const hasAny = (values: string[]) => values.some(has);

  if (provider === "gmail") {
    const hasFullMail = has("https://mail.google.com/");
    const hasRead = hasAny(["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.modify"]);
    const hasSend = hasAny(["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.compose"]);
    return [
      !hasFullMail && !hasRead ? "gmail.readonly or https://mail.google.com/" : undefined,
      !hasFullMail && !hasSend ? "gmail.send or https://mail.google.com/" : undefined
    ].filter((item): item is string => Boolean(item));
  }

  const hasRead = hasAny(["https://graph.microsoft.com/mail.read", "https://graph.microsoft.com/mail.readwrite"]);
  const hasSend = has("https://graph.microsoft.com/mail.send");
  const hasOffline = has("offline_access");
  return [
    !hasRead ? "Mail.Read or Mail.ReadWrite" : undefined,
    !hasSend ? "Mail.Send" : undefined,
    !hasOffline ? "offline_access" : undefined
  ].filter((item): item is string => Boolean(item));
}

const DEFAULT_EMAIL_SEND_CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const MIN_EMAIL_SEND_CLAIM_TIMEOUT_MS = 60 * 1000;

function normalizeEmailSendClaimTimeoutMs(value: string | undefined): number {
  const configured = Number(value);
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

function normalizeLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value as number))) : fallback;
}
