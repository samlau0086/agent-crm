import type { EmailSubsystemDiagnostics } from "@/lib/email/diagnostics";
import type { JobHealth } from "@/lib/ops/health";

export type ServiceHealthDatabaseStatus = "ok" | "error";

export interface ServiceHealthInput {
  checkedAt: string;
  database: ServiceHealthDatabaseStatus;
  jobs: JobHealth;
  email: EmailSubsystemDiagnostics;
  errors?: string[];
}

export interface ServiceHealthEmailReadiness {
  ok: boolean;
  status: EmailSubsystemDiagnostics["status"];
  encryption: EmailSubsystemDiagnostics["encryption"]["status"];
  oauthState: EmailSubsystemDiagnostics["oauthState"]["status"];
  oauthCallback: EmailSubsystemDiagnostics["oauthCallback"]["status"];
  deliveryMode: EmailSubsystemDiagnostics["deliveryMode"]["status"];
  aiProvider: EmailSubsystemDiagnostics["aiProvider"]["status"];
  aiContextPolicy: {
    status: EmailSubsystemDiagnostics["aiContextPolicy"]["status"];
    loaded: boolean;
    requireSourceLinks: boolean;
    defaultLocale: string;
    maxHistoryMessages: number;
    maxKnowledgeArticles: number;
    maxContextChars: number;
    enabledFeatures: EmailSubsystemDiagnostics["aiContextPolicy"]["enabledFeatures"];
    enabledAutomationCount: number;
    featureDependencies: EmailSubsystemDiagnostics["aiContextPolicy"]["featureDependencies"];
    automationEligibleStatuses: EmailSubsystemDiagnostics["aiContextPolicy"]["automationEligibleStatuses"];
    autoContextAnalysisScope: EmailSubsystemDiagnostics["aiContextPolicy"]["autoContextAnalysisScope"];
    budgetPolicy: EmailSubsystemDiagnostics["aiContextPolicy"]["budgetPolicy"];
  };
  autoSummaryPolicy: {
    status: EmailSubsystemDiagnostics["autoSummaryPolicy"]["status"];
    enabled: boolean;
    minNewMessages: number;
    maxHistoryMessages: number;
    maxContextChars: number;
  };
  syncScheduler: {
    status: EmailSubsystemDiagnostics["syncScheduler"]["status"];
    intervalMs: number;
    limit?: number;
    userId: string;
    queueBacked: boolean;
    syncEnabledAccounts?: number;
  };
  sendClaims: {
    status: EmailSubsystemDiagnostics["sendClaims"]["status"];
    sendingCount: number;
    staleCount: number;
    timeoutMs: number;
  };
  aiAutomationFailures: {
    status: EmailSubsystemDiagnostics["aiAutomationFailures"]["status"];
    recentFailureCount: number;
  };
  aiProviderFallbacks: {
    status: EmailSubsystemDiagnostics["aiProviderFallbacks"]["status"];
    recentFallbackCount: number;
  };
  accounts?: NonNullable<EmailSubsystemDiagnostics["accounts"]>;
  oauthProviders: Record<string, { status: string; configured: boolean; required: boolean; missingScopes: string[] }>;
  jobs?: JobHealth;
}

export interface ServiceHealthPayload {
  ok: boolean;
  service: "ai-agent-crm";
  database: ServiceHealthDatabaseStatus;
  jobs: JobHealth;
  email: EmailSubsystemDiagnostics;
  emailReadiness: ServiceHealthEmailReadiness;
  error?: string;
  checkedAt: string;
}

export function buildServiceHealthPayload(input: ServiceHealthInput): ServiceHealthPayload {
  const errors = input.errors?.filter(Boolean) ?? [];
  const ok = input.database === "ok" && input.jobs.ok && input.email.ok;

  return {
    ok,
    service: "ai-agent-crm",
    database: input.database,
    jobs: input.jobs,
    email: input.email,
    emailReadiness: buildEmailReadiness(input.email),
    error: errors.length > 0 ? errors.join("; ") : undefined,
    checkedAt: input.checkedAt
  };
}

export function buildEmailReadiness(email: EmailSubsystemDiagnostics): ServiceHealthEmailReadiness {
  const oauthProviders = Object.fromEntries(
    Object.entries(email.oauthProviders).map(([provider, diagnostic]) => [
      provider,
      {
        status: diagnostic.status,
        configured: diagnostic.configured,
        required: diagnostic.required,
        missingScopes: diagnostic.missingScopes
      }
    ])
  );

  return {
    ok: email.ok,
    status: email.status,
    encryption: email.encryption.status,
    oauthState: email.oauthState.status,
    oauthCallback: email.oauthCallback.status,
    deliveryMode: email.deliveryMode.status,
    aiProvider: email.aiProvider.status,
    aiContextPolicy: {
      status: email.aiContextPolicy.status,
      loaded: email.aiContextPolicy.loaded,
      requireSourceLinks: email.aiContextPolicy.requireSourceLinks,
      defaultLocale: email.aiContextPolicy.defaultLocale,
      maxHistoryMessages: email.aiContextPolicy.maxHistoryMessages,
      maxKnowledgeArticles: email.aiContextPolicy.maxKnowledgeArticles,
      maxContextChars: email.aiContextPolicy.maxContextChars,
      enabledFeatures: email.aiContextPolicy.enabledFeatures,
      enabledAutomationCount: email.aiContextPolicy.enabledAutomationCount,
      featureDependencies: email.aiContextPolicy.featureDependencies,
      automationEligibleStatuses: email.aiContextPolicy.automationEligibleStatuses,
      autoContextAnalysisScope: email.aiContextPolicy.autoContextAnalysisScope,
      budgetPolicy: email.aiContextPolicy.budgetPolicy
    },
    autoSummaryPolicy: {
      status: email.autoSummaryPolicy.status,
      enabled: email.autoSummaryPolicy.enabled,
      minNewMessages: email.autoSummaryPolicy.minNewMessages,
      maxHistoryMessages: email.autoSummaryPolicy.maxHistoryMessages,
      maxContextChars: email.autoSummaryPolicy.maxContextChars
    },
    syncScheduler: {
      status: email.syncScheduler.status,
      intervalMs: email.syncScheduler.intervalMs,
      limit: email.syncScheduler.limit,
      userId: email.syncScheduler.userId,
      queueBacked: email.syncScheduler.queueBacked,
      syncEnabledAccounts: email.syncScheduler.syncEnabledAccounts
    },
    sendClaims: {
      status: email.sendClaims.status,
      sendingCount: email.sendClaims.sendingCount,
      staleCount: email.sendClaims.staleCount,
      timeoutMs: email.sendClaims.timeoutMs
    },
    aiAutomationFailures: {
      status: email.aiAutomationFailures.status,
      recentFailureCount: email.aiAutomationFailures.recentFailureCount
    },
    aiProviderFallbacks: {
      status: email.aiProviderFallbacks.status,
      recentFallbackCount: email.aiProviderFallbacks.recentFallbackCount
    },
    ...(email.accounts ? { accounts: email.accounts } : {}),
    oauthProviders,
    ...(email.jobs ? { jobs: email.jobs } : {})
  };
}
