import { createEmailProviderAdapter } from "@/lib/email/provider";
import { buildEmailAttachmentHref } from "@/lib/email/attachments";
import { generateEmailAiOutput } from "@/lib/email/ai-generation";
import { buildEmailAssistantContext, createDefaultEmailAiSettings } from "@/lib/email/assistant";
import { assertDatabaseReachable } from "./database-preflight.ts";
import { loadLocalEnvFiles } from "./load-env.ts";
import { configuredOperationalUserId, resolveOperationalUser } from "./operational-user.ts";
import type { CrmRecord, EmailAiSettings, EmailMessage, FieldDefinition, KnowledgeArticle, RequestContext } from "@/lib/crm/types";
import type { EmailDiagnosticCheck, EmailSubsystemDiagnostics } from "@/lib/email/diagnostics";

loadLocalEnvFiles();

const args = parseArgs(process.argv.slice(2));
const userSelection = configuredOperationalUserId(args, ["EMAIL_VERIFY_USER_ID", "JOB_USER_ID"]);
const requireLiveReadiness = Boolean(args["require-live-readiness"]);
const runConnectionTests = Boolean(args["test-connections"] || requireLiveReadiness);
const runAiProviderTest = Boolean(args["test-ai-provider"] || requireLiveReadiness);
const runSmoke = Boolean(args.smoke || requireLiveReadiness);
const keepSmokeData = Boolean(args["keep-smoke-data"]);
const plan = buildEmailVerificationPlan({ userId: userSelection.userId, strictUserId: userSelection.strict, runConnectionTests, runAiProviderTest, runSmoke, requireLiveReadiness });

if (args["dry-run"]) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

try {
  await assertDatabaseReachable({ label: "email-verify" });
  const { getCrmRepository } = await import("@/lib/crm/repository");
  const { checkEmailSubsystemDiagnostics, checkEmailSubsystemDiagnosticsForContext } = await import("@/lib/email/diagnostics");
  const repository = getCrmRepository();
  const requiresOperationalUser = runConnectionTests || runSmoke || requireLiveReadiness;
  const userResolution = requiresOperationalUser
    ? await resolveOperationalUser({
      userId: userSelection.userId,
      strict: userSelection.strict,
      purpose: "email verification"
    })
    : undefined;
  const context = userResolution?.context;
  const accounts = context ? await repository.listEmailAccounts(context) : [];
  const diagnostics = context
    ? await checkEmailSubsystemDiagnosticsForContext(context, repository, { includeJobs: true })
    : await checkEmailSubsystemDiagnostics({ includeJobs: true });
  const connectionTests = runConnectionTests && context ? await testConnections(context, repository, accounts) : [];
  const aiProviderTest = runAiProviderTest ? await testAiProvider() : undefined;
  const applicationSmoke = runSmoke && context ? await runApplicationSmoke(context, repository, { keepSmokeData }) : undefined;
  const automatedChecksOk = diagnostics.ok && connectionTests.every((test) => test.ok) && (aiProviderTest?.ok ?? true) && (applicationSmoke?.ok ?? true);
  const readiness = buildEmailVerificationReadiness({
    diagnostics,
    connectionTests,
    aiProviderTest,
    applicationSmoke,
    runConnectionTests,
    runAiProviderTest,
    runSmoke
  });
  const ok = automatedChecksOk && (!requireLiveReadiness || readiness.liveTrafficReady);

  console.error(formatEmailVerificationReadinessSummary(readiness));
  console.log(
    JSON.stringify(
        {
          ok,
          liveReadinessRequired: requireLiveReadiness,
          userId: context?.user.id,
          operationalUser: userResolution
            ? {
              requestedUserId: userResolution.requestedUserId,
              resolvedUserId: userResolution.resolvedUserId,
              strict: userResolution.strict,
              fallbackUsed: userResolution.fallbackUsed,
              requiredPermission: userResolution.requiredPermission
            }
            : {
              required: false,
              reason: "No workspace-scoped email verification checks were requested."
            },
          workspaceId: context?.workspaceId,
        readiness,
        diagnostics,
        connectionTests,
        aiProviderTest,
        applicationSmoke,
        manualVerification: buildManualVerificationSteps()
      },
      null,
      2
    )
  );

  if (!ok) {
    if (requireLiveReadiness && !readiness.liveTrafficReady) {
      console.error("Email live readiness is required but readiness.liveTrafficReady=false.");
    }
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Email verification failed.");
  process.exit(1);
}

function buildEmailVerificationPlan(options: { userId: string; strictUserId: boolean; runConnectionTests: boolean; runAiProviderTest: boolean; runSmoke: boolean; requireLiveReadiness: boolean }) {
  return {
    userId: options.userId,
    userResolution: options.strictUserId
      ? "Use the explicit --user-id value and fail if it is unavailable or lacks crm.admin."
      : "Try the configured user id first, then fall back to the first active user with crm.admin.",
    runConnectionTests: options.runConnectionTests,
    runAiProviderTest: options.runAiProviderTest,
    runSmoke: options.runSmoke,
    requireLiveReadiness: options.requireLiveReadiness,
    steps: [
      "Load admin request context",
      "List workspace email accounts",
      "Run email subsystem diagnostics with mailbox accounts, sync scheduler policy, AI context policy, recent AI automation failure audit, and recent AI provider fallback audit",
      ...(options.runConnectionTests ? ["Run provider connection tests for active configured accounts"] : []),
      ...(options.runAiProviderTest ? ["Run a source-backed AI provider generation check and require generationMode=provider"] : []),
      ...(options.runSmoke ? ["Run application smoke flow with a temporary CRM record, knowledge article, inbound email, AI draft, attachment, dry-run send, and stale send claim recovery"] : []),
      "Print manual send, sync, AI, and OAuth callback verification steps"
    ],
    requiredEnvironment: [
      "DATABASE_URL",
      "EMAIL_CONFIG_SECRET or APP_SECRET",
      "APP_BASE_URL",
      "AI_API_KEY when remote AI generation is required or --test-ai-provider is used",
      "GMAIL_OAUTH_SCOPE must include https://mail.google.com/ or Gmail read plus send scopes when Gmail OAuth is configured",
      "GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET when Gmail accounts are used",
      "OUTLOOK_OAUTH_SCOPE must include Mail.Read or Mail.ReadWrite, Mail.Send, and offline_access when Outlook OAuth is configured",
      "OUTLOOK_OAUTH_CLIENT_ID and OUTLOOK_OAUTH_CLIENT_SECRET when Outlook accounts are used",
      "REDIS_URL when JOB_EXECUTOR=redis"
    ],
    automatedVerification: [
      "npm test includes the email crm smoke flow: account setup, inbound history, knowledge context, AI draft, attachment, dry-run send, stale send claim recovery, and audit metadata.",
      "npm run email:verify checks environment readiness and can run real provider connection tests with -- --test-connections.",
      "npm run email:verify -- --test-ai-provider calls the configured OpenAI-compatible provider with bounded CRM, email, and knowledge context and fails unless generationMode=provider.",
      "npm run email:verify -- --smoke runs the same application-level smoke flow against the configured database using dry-run email delivery in the script process, including stale send claim recovery.",
      "npm run email:verify -- --require-live-readiness runs real mailbox, AI provider, and smoke checks, then fails unless readiness.liveTrafficReady=true.",
      "npm run test:e2e -- tests/e2e/email-flow.spec.ts covers the browser email workspace path when Postgres is reachable at DATABASE_URL."
    ],
    readinessReport: {
      emittedByDefault: true,
      fields: [
        "automatedChecksOk",
        "liveTrafficReady",
        "outboundConfigured",
        "inboundSyncConfigured",
        "externalMailboxVerified",
        "aiProviderVerified",
        "applicationSmokeVerified",
        "oauthProviders",
        "blockers",
        "warnings",
        "manualActions"
      ],
      liveTrafficReadyRequires: [
        "diagnostics status ok",
        "live email delivery mode",
        "at least one active configured mailbox with successful --test-connections result",
        "AI provider verified with --test-ai-provider",
        "application smoke verified with --smoke before launch"
      ]
    },
    manualVerification: buildManualVerificationSteps()
  };
}

async function testAiProvider() {
  const settings = createDefaultEmailAiSettings("email-verify-workspace", new Date().toISOString());
  settings.features = { ...settings.features, draft: true };
  settings.maxContextChars = 3000;
  settings.maxHistoryMessages = 2;
  settings.maxKnowledgeArticles = 1;
  const assistantContext = buildEmailAssistantContext({
    settings,
    purpose: "draft",
    record: {
      id: "email-verify-record",
      workspaceId: settings.workspaceId,
      objectKey: "contacts",
      title: "Email Verify Customer",
      data: {
        email: "buyer@example.invalid",
        lifecycle: "evaluation"
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    fields: [
      {
        id: "email-verify-field-email",
        workspaceId: settings.workspaceId,
        objectKey: "contacts",
        key: "email",
        label: "Email",
        type: "text",
        required: false,
        unique: false,
        isSystem: true,
        position: 1
      }
    ],
    messages: [
      {
        id: "email-verify-message",
        workspaceId: settings.workspaceId,
        threadId: "email-verify-thread",
        accountId: "email-verify-account",
        direction: "inbound",
        status: "received",
        from: "buyer@example.invalid",
        to: ["sales@example.invalid"],
        subject: "Private deployment verification",
        bodyText: "Please confirm the next step for private deployment readiness.",
        createdAt: new Date().toISOString(),
        receivedAt: new Date().toISOString()
      }
    ],
    knowledgeArticles: [
      {
        id: "email-verify-knowledge",
        workspaceId: settings.workspaceId,
        title: "Private deployment checklist",
        body: "A private deployment readiness reply should mention environment access, OAuth callback URLs, mailbox connection tests, and launch verification.",
        tags: ["deployment", "email", "verification"],
        active: true,
        createdById: "email-verify",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    targetLocale: "en-US"
  });
  const result = await generateEmailAiOutput({
    context: assistantContext,
    userPrompt: "Write one concise verification reply."
  });
  const ok = result.enabled && result.generationMode === "provider";
  return {
    ok,
    generationMode: result.generationMode,
    providerError: sanitizeVerifierText(result.providerError),
    sourceCount: result.sources.length,
    textLength: result.text.length,
    suggestedSubjectProvided: Boolean(result.suggestedSubject),
    budget: result.budget,
    message: ok
      ? "AI provider returned a source-backed provider result."
      : "AI provider verification did not return generationMode=provider; check AI_PROVIDER, AI_API_KEY, AI_BASE_URL, AI_MODEL, and AI_TIMEOUT_MS."
  };
}

interface EmailConnectionVerificationResult {
  accountId: string;
  emailAddress: string;
  ok: boolean;
  result?: SafeEmailConnectionTestResult;
  error?: string;
}

interface SafeEmailConnectionTestResult {
  smtp?: "ok" | "skipped";
  imap?: "ok" | "skipped";
  pop3?: "ok" | "skipped";
  oauth?: "ok" | "skipped";
  oauthAccountEmail?: string;
}

interface EmailProviderVerificationResult {
  ok: boolean;
  generationMode?: string;
  providerError?: string;
  sourceCount?: number;
  textLength?: number;
  suggestedSubjectProvided?: boolean;
  budget?: unknown;
  message: string;
}

interface ApplicationSmokeVerificationResult {
  ok: boolean;
  marker?: string;
  cleanedUp?: boolean;
  dryRunDelivery?: boolean;
  accountId?: string;
  recordId?: string;
  threadId?: string;
  inboundMessageId?: string;
  outboundMessageId?: string;
  staleOutboundMessageId?: string;
  sourceCount?: number;
  attachmentHref?: string;
}

interface EmailVerificationReadinessInput {
  diagnostics: EmailSubsystemDiagnostics;
  connectionTests: EmailConnectionVerificationResult[];
  aiProviderTest?: EmailProviderVerificationResult;
  applicationSmoke?: ApplicationSmokeVerificationResult;
  runConnectionTests: boolean;
  runAiProviderTest: boolean;
  runSmoke: boolean;
}

async function testConnections(
  context: Awaited<ReturnType<typeof import("@/lib/crm/repository").getRequestContextByUserId>>,
  repository: ReturnType<typeof import("@/lib/crm/repository").getCrmRepository>,
  accounts: Array<{ id: string; emailAddress: string; status: string; connectionConfigured: boolean }>
): Promise<EmailConnectionVerificationResult[]> {
  const adapter = createEmailProviderAdapter(repository);
  const activeConfiguredAccounts = accounts.filter((account) => account.status === "active" && account.connectionConfigured);
  const results: EmailConnectionVerificationResult[] = [];
  for (const account of activeConfiguredAccounts) {
    try {
      const result = await adapter.testConnection(context, account.id);
      results.push({
        accountId: account.id,
        emailAddress: account.emailAddress,
        ok: true,
        result: sanitizeConnectionTestResult(result.result)
      });
    } catch (error) {
      results.push({
        accountId: account.id,
        emailAddress: account.emailAddress,
        ok: false,
        error: sanitizeVerifierText(error instanceof Error ? error.message : "Connection test failed")
      });
    }
  }
  return results;
}

function sanitizeConnectionTestResult(result: unknown): SafeEmailConnectionTestResult {
  if (!result || typeof result !== "object") {
    return {};
  }
  const value = result as Record<string, unknown>;
  return {
    ...(value.smtp === "ok" || value.smtp === "skipped" ? { smtp: value.smtp } : {}),
    ...(value.imap === "ok" || value.imap === "skipped" ? { imap: value.imap } : {}),
    ...(value.pop3 === "ok" || value.pop3 === "skipped" ? { pop3: value.pop3 } : {}),
    ...(value.oauth === "ok" || value.oauth === "skipped" ? { oauth: value.oauth } : {}),
    ...(typeof value.oauthAccountEmail === "string" && value.oauthAccountEmail.trim() ? { oauthAccountEmail: value.oauthAccountEmail.trim() } : {})
  };
}

function sanitizeVerifierText(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }
  return value
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, "$1 [redacted]")
    .replace(/\b(access_token|refresh_token|id_token|api[_-]?key|client_secret|password|secret|token)\s*[:=]\s*["']?[^"',\s}]+/gi, "$1=[redacted]")
    .replace(/(authorization["']?\s*[:=]\s*["']?)(?:Bearer|Basic)?\s*[^"',\s}]+/gi, "$1[redacted]")
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{16,}/g, "[redacted-jwt]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-[redacted]");
}

function buildEmailVerificationReadiness(input: EmailVerificationReadinessInput) {
  const { diagnostics, connectionTests } = input;
  const diagnosticMessages = collectDiagnosticMessages(diagnostics);
  const accounts = diagnostics.accounts;
  const activeConfiguredAccounts = accounts?.activeConnectionConfigured ?? 0;
  const connectionFailures = connectionTests.filter((test) => !test.ok);
  const externalMailboxVerified = input.runConnectionTests && connectionTests.length > 0 && connectionFailures.length === 0;
  const aiProviderVerified = input.runAiProviderTest && input.aiProviderTest?.ok === true;
  const applicationSmokeVerified = input.runSmoke && input.applicationSmoke?.ok === true;
  const outboundConfigured = Boolean(accounts && accounts.sendConnectionConfigured > 0);
  const inboundSyncConfigured = Boolean(accounts && accounts.syncConnectionConfigured > 0);
  const manualActions = buildOutstandingManualActions(input, {
    activeConfiguredAccounts,
    externalMailboxVerified,
    aiProviderVerified,
    applicationSmokeVerified
  });
  const liveTrafficReady =
    diagnostics.status === "ok" &&
    diagnostics.deliveryMode.status === "ok" &&
    externalMailboxVerified &&
    aiProviderVerified &&
    applicationSmokeVerified;

  return {
    automatedChecksOk:
      diagnostics.ok &&
      connectionFailures.length === 0 &&
      (input.aiProviderTest?.ok ?? true) &&
      (input.applicationSmoke?.ok ?? true),
    liveTrafficReady,
    outboundConfigured,
    inboundSyncConfigured,
    externalMailboxVerified,
    aiProviderVerified,
    applicationSmokeVerified,
    mailboxConnections: {
      requested: input.runConnectionTests,
      activeConfiguredAccounts,
      tested: connectionTests.length,
      passed: connectionTests.filter((test) => test.ok).length,
      failed: connectionFailures.length
    },
    ai: {
      providerStatus: diagnostics.aiProvider.status,
      generationMode: input.aiProviderTest?.generationMode,
      providerError: sanitizeVerifierText(input.aiProviderTest?.providerError),
      sourceCount: input.aiProviderTest?.sourceCount,
      requireSourceLinks: diagnostics.aiContextPolicy.requireSourceLinks,
      enabledFeatures: diagnostics.aiContextPolicy.enabledFeatures,
      enabledAutomationCount: diagnostics.aiContextPolicy.enabledAutomationCount,
      autoSummaryEnabled: diagnostics.autoSummaryPolicy.enabled,
      maxHistoryMessages: diagnostics.aiContextPolicy.maxHistoryMessages,
      maxKnowledgeArticles: diagnostics.aiContextPolicy.maxKnowledgeArticles,
      maxContextChars: diagnostics.aiContextPolicy.maxContextChars,
      budgetPolicy: diagnostics.aiContextPolicy.budgetPolicy
    },
    oauthProviders: Object.fromEntries(
      Object.entries(diagnostics.oauthProviders).map(([provider, diagnostic]) => [
        provider,
        {
          status: diagnostic.status,
          configured: diagnostic.configured,
          required: diagnostic.required,
          scope: diagnostic.scope,
          missingScopes: diagnostic.missingScopes
        }
      ])
    ),
    blockers: diagnosticMessages.errors.concat(connectionFailures.map((test) => sanitizeVerifierText(`connection:${test.emailAddress}: ${test.error ?? "connection test failed"}`))),
    warnings: diagnosticMessages.warnings,
    manualActions
  };
}

function formatEmailVerificationReadinessSummary(readiness: ReturnType<typeof buildEmailVerificationReadiness>): string {
  const lines = [
    [
      "[email-verify]",
      `automatedChecksOk=${readiness.automatedChecksOk}`,
      `liveTrafficReady=${readiness.liveTrafficReady}`,
      `mailboxes=${readiness.mailboxConnections.passed}/${readiness.mailboxConnections.tested}`,
      `mailboxFailures=${readiness.mailboxConnections.failed}`,
      `aiProviderVerified=${readiness.aiProviderVerified}`,
      `applicationSmokeVerified=${readiness.applicationSmokeVerified}`,
      `blockers=${readiness.blockers.length}`,
      `warnings=${readiness.warnings.length}`,
      `manualActions=${readiness.manualActions.length}`
    ].join(" ")
  ];
  if (readiness.blockers.length) {
    lines.push(`[email-verify] blockers: ${readiness.blockers.slice(0, 5).join(" | ")}`);
  }
  if (readiness.manualActions.length) {
    lines.push(`[email-verify] manualActions: ${readiness.manualActions.slice(0, 5).join(" | ")}`);
  }
  return lines.join("\n");
}

function collectDiagnosticMessages(diagnostics: EmailSubsystemDiagnostics): { errors: string[]; warnings: string[] } {
  const checks: Array<{ name: string; check: EmailDiagnosticCheck }> = [
    { name: "encryption", check: diagnostics.encryption },
    { name: "oauthState", check: diagnostics.oauthState },
    { name: "oauthCallback", check: diagnostics.oauthCallback },
    { name: "deliveryMode", check: diagnostics.deliveryMode },
    { name: "aiProvider", check: diagnostics.aiProvider },
    { name: "aiContextPolicy", check: diagnostics.aiContextPolicy },
    { name: "autoSummaryPolicy", check: diagnostics.autoSummaryPolicy },
    { name: "syncScheduler", check: diagnostics.syncScheduler },
    { name: "sendClaims", check: diagnostics.sendClaims },
    { name: "aiAutomationFailures", check: diagnostics.aiAutomationFailures },
    { name: "aiProviderFallbacks", check: diagnostics.aiProviderFallbacks },
    ...Object.entries(diagnostics.oauthProviders).map(([provider, check]) => ({ name: `oauth:${provider}`, check }))
  ];
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const item of checks) {
    if (item.check.status === "error") {
      errors.push(sanitizeVerifierText(`${item.name}: ${item.check.message}`) ?? `${item.name}: redacted error`);
    } else if (item.check.status === "warning") {
      warnings.push(sanitizeVerifierText(`${item.name}: ${item.check.message}`) ?? `${item.name}: redacted warning`);
    }
  }
  if (diagnostics.jobs && !diagnostics.jobs.ok) {
    errors.push(sanitizeVerifierText(`jobs: ${diagnostics.jobs.error ?? "job executor is not healthy"}`) ?? "jobs: redacted error");
  }
  if (diagnostics.accounts && diagnostics.accounts.active > diagnostics.accounts.activeConnectionConfigured) {
    warnings.push("accounts: at least one active mailbox is missing connection configuration");
  }
  if (diagnostics.accounts && diagnostics.accounts.error > 0) {
    warnings.push("accounts: at least one mailbox is in error status");
  }
  return { errors, warnings };
}

function buildOutstandingManualActions(
  input: EmailVerificationReadinessInput,
  state: {
    activeConfiguredAccounts: number;
    externalMailboxVerified: boolean;
    aiProviderVerified: boolean;
    applicationSmokeVerified: boolean;
  }
): string[] {
  const actions: string[] = [];
  const accounts = input.diagnostics.accounts;
  if (!accounts || accounts.total === 0) {
    actions.push("Create at least one mailbox account before validating real send and sync behavior.");
  } else if (accounts.active === 0) {
    actions.push("Activate at least one mailbox account before production traffic.");
  } else if (accounts.active > accounts.activeConnectionConfigured) {
    actions.push("Finish OAuth or SMTP/IMAP credential setup for every active mailbox.");
  }
  if (input.diagnostics.deliveryMode.status !== "ok") {
    actions.push("Switch EMAIL_DELIVERY_MODE to live before production delivery.");
  }
  for (const [provider, diagnostic] of Object.entries(input.diagnostics.oauthProviders)) {
    if (diagnostic.missingScopes.length) {
      actions.push(`Update ${provider} OAuth scope to include: ${diagnostic.missingScopes.join(", ")}.`);
    }
  }
  if (!input.runConnectionTests) {
    actions.push("Run npm run email:verify -- --test-connections after connecting real mailboxes.");
  } else if (!state.externalMailboxVerified) {
    actions.push("Resolve failed or missing mailbox connection tests before production traffic.");
  }
  if (state.activeConfiguredAccounts === 0) {
    actions.push("Complete at least one real mailbox authorization or SMTP/IMAP credential test.");
  }
  if (!input.runAiProviderTest) {
    actions.push("Run npm run email:verify -- --test-ai-provider when AI email features will be enabled.");
  } else if (!state.aiProviderVerified) {
    actions.push("Fix AI provider configuration before enabling AI draft, translate, analysis, or summarize features.");
  }
  if (!input.runSmoke) {
    actions.push("Run npm run email:verify -- --smoke before launch to validate the CRM email flow against the configured database.");
  } else if (!state.applicationSmokeVerified) {
    actions.push("Fix the application smoke failure before launch.");
  }
  return [...new Set(actions)];
}

async function runApplicationSmoke(
  context: RequestContext,
  repository: ReturnType<typeof import("@/lib/crm/repository").getCrmRepository>,
  options: { keepSmokeData: boolean }
) {
  const marker = `email-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const previousMode = process.env.EMAIL_DELIVERY_MODE;
  const previousNodeEnv = process.env.NODE_ENV;
  const artifacts: {
    accountId?: string;
    recordId?: string;
    threadId?: string;
    inboundMessageId?: string;
    outboundMessageId?: string;
    staleOutboundMessageId?: string;
    knowledgeArticleId?: string;
  } = {};
  let previousSettings: EmailAiSettings | undefined;

  process.env.EMAIL_DELIVERY_MODE = "dry-run";
  process.env.NODE_ENV = "test";
  try {
    previousSettings = await repository.getEmailAiSettings(context);
    await repository.updateEmailAiSettings(context, {
      features: {
        draft: true,
        translate: true,
        auto_translate: false,
        context_analysis: true,
        auto_context_analysis: false,
        auto_summarize: false
      },
      requireSourceLinks: true,
      maxHistoryMessages: 4,
      maxKnowledgeArticles: 2,
      maxContextChars: 4000
    });

    const account = await repository.createEmailAccount(context, {
      name: `Email Smoke Inbox ${marker}`,
      emailAddress: `${marker}@example.invalid`,
      provider: "smtp_imap",
      status: "active",
      sendEnabled: true,
      syncEnabled: false
    });
    artifacts.accountId = account.id;

    const record = await createSmokeRecord(context, repository, marker);
    artifacts.recordId = record.id;

    const knowledge = await repository.createKnowledgeArticle(context, {
      title: `Email smoke knowledge ${marker}`,
      body: "Private deployment includes Docker Compose, admin training, and a pre-launch health check.",
      tags: ["email-smoke", "deployment"],
      active: true
    });
    artifacts.knowledgeArticleId = knowledge.id;

    const inbound = await repository.recordEmailMessage(context, {
      accountId: account.id,
      direction: "inbound",
      from: "buyer@example.invalid",
      to: [account.emailAddress],
      subject: `Email smoke inbound ${marker}`,
      bodyText: "Please confirm the private deployment plan and launch training.",
      recordId: record.id,
      externalMessageId: `${marker}-inbound`,
      receivedAt: new Date().toISOString()
    });
    artifacts.inboundMessageId = inbound.id;
    artifacts.threadId = inbound.threadId;

    const assistantContext = await repository.buildEmailAssistantContext(context, {
      purpose: "draft",
      threadId: inbound.threadId,
      sourceMessageId: inbound.id
    });
    const aiResult = await generateEmailAiOutput({ context: assistantContext, userPrompt: "Reply with the next deployment step." });
    await repository.recordEmailAiGeneration(context, {
      purpose: "draft",
      enabled: aiResult.enabled,
      recordId: assistantContext.recordId,
      threadId: assistantContext.threadId,
      sourceMessageId: assistantContext.sourceMessageId,
      sourceCount: aiResult.sources.length,
      sourceLabels: aiResult.sources.map((source) => source.label),
      userPromptLength: "Reply with the next deployment step.".length,
      resultTextLength: aiResult.text.length,
      contextCharCount: aiResult.budget.contextCharCount,
      maxContextChars: aiResult.budget.maxContextChars,
      modelPromptChars: aiResult.budget.modelPromptChars,
      contextTruncated: aiResult.budget.truncated,
      outputTruncated: aiResult.budget.outputTruncated,
      generationMode: aiResult.generationMode,
      providerError: aiResult.providerError,
      suggestedSubjectProvided: Boolean(aiResult.suggestedSubject)
    });

    const queued = await repository.queueEmailMessage(context, {
      accountId: account.id,
      threadId: inbound.threadId,
      recordId: record.id,
      to: ["buyer@example.invalid"],
      subject: aiResult.suggestedSubject ?? `Re: Email smoke inbound ${marker}`,
      bodyText: aiResult.text,
      attachments: [
        {
          fileName: "deployment-smoke.txt",
          contentType: "text/plain",
          size: "deployment smoke".length,
          contentBase64: Buffer.from("deployment smoke").toString("base64")
        }
      ],
      aiAssisted: true,
      aiPurpose: "draft",
      aiSourceMessageId: inbound.id,
      aiSources: aiResult.sources,
      aiGeneratedAt: new Date().toISOString()
    });

    const sent = await createEmailProviderAdapter(repository).sendQueued(context, queued.id);
    artifacts.outboundMessageId = sent.id;
    assertSmoke(sent.status === "sent", "Dry-run send did not mark the outbound message sent");
    assertSmoke(Boolean(sent.externalMessageId?.startsWith("dry-run-")), "Dry-run send did not stamp a dry-run external message id");
    assertSmoke(Boolean(sent.aiAssisted), "Outbound message did not preserve AI assisted provenance");
    assertSmoke(Boolean(sent.attachments?.[0]), "Outbound message did not preserve the smoke attachment");
    assertSmoke(
      buildEmailAttachmentHref(sent.id, 0, sent.attachments?.[0] ?? {}) === `/api/email/messages/${encodeURIComponent(sent.id)}/attachments/0`,
      "Smoke attachment did not produce a retrievable attachment href"
    );
    assertSmoke(aiResult.sources.some((source) => source.recordId === record.id), "AI result did not include the smoke CRM record source");
    assertSmoke(aiResult.sources.some((source) => source.messageId === inbound.id), "AI result did not include the inbound email source");
    assertSmoke(aiResult.sources.some((source) => source.knowledgeArticleId === knowledge.id), "AI result did not include the smoke knowledge source");

    const staleOutbound = await repository.recordEmailMessage(context, {
      accountId: account.id,
      direction: "outbound",
      status: "sending",
      from: account.emailAddress,
      to: ["buyer@example.invalid"],
      subject: `Email smoke stale send ${marker}`,
      bodyText: "This message simulates a worker crash after claiming the outbound send.",
      threadId: inbound.threadId,
      recordId: record.id,
      sendAttemptedAt: new Date(Date.now() - 120000).toISOString()
    });
    artifacts.staleOutboundMessageId = staleOutbound.id;

    const recovered = await createEmailProviderAdapter(repository).sendQueued(context, staleOutbound.id);
    assertSmoke(recovered.status === "sent", "Stale sending message was not recovered by the send claim path");
    assertSmoke(recovered.externalMessageId === `dry-run-${staleOutbound.id}`, "Recovered stale sending message did not receive the expected dry-run external id");

    return {
      ok: true,
      marker,
      cleanedUp: !options.keepSmokeData,
      dryRunDelivery: true,
      accountId: account.id,
      recordId: record.id,
      threadId: inbound.threadId,
      inboundMessageId: inbound.id,
      outboundMessageId: sent.id,
      staleOutboundMessageId: recovered.id,
      sourceCount: aiResult.sources.length,
      attachmentHref: buildEmailAttachmentHref(sent.id, 0, sent.attachments?.[0] ?? {})
    };
  } finally {
    if (previousSettings) {
      await repository.updateEmailAiSettings(context, previousSettings);
    }
    restoreEnv("EMAIL_DELIVERY_MODE", previousMode);
    restoreEnv("NODE_ENV", previousNodeEnv);
    if (!options.keepSmokeData) {
      await cleanupSmokeData(context, artifacts);
    }
  }
}

async function createSmokeRecord(
  context: RequestContext,
  repository: ReturnType<typeof import("@/lib/crm/repository").getCrmRepository>,
  marker: string
): Promise<CrmRecord> {
  const objectKey = "contacts";
  const objects = await repository.listObjectDefinitions(context);
  if (!objects.some((object) => object.key === objectKey)) {
    throw new Error("Email smoke requires a contacts object or pass an existing record in a future verifier extension.");
  }
  const fields = await repository.listFieldDefinitions(context, objectKey);
  const data = buildSmokeRecordData(fields, marker, context);
  return repository.createRecord(context, objectKey, {
    title: `Email Smoke Contact ${marker}`,
    data,
    ownerId: context.user.id
  });
}

function buildSmokeRecordData(fields: FieldDefinition[], marker: string, context: RequestContext): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    const value = smokeValueForField(field, marker, context);
    if (value !== undefined && (field.required || field.key === "email")) {
      data[field.key] = value;
    }
  }
  return data;
}

function smokeValueForField(field: FieldDefinition, marker: string, context: RequestContext): unknown {
  if (field.key.toLowerCase().includes("email")) {
    return `${marker}@example.invalid`;
  }
  if (field.type === "text" || field.type === "textarea") {
    return `${field.label || field.key} ${marker}`;
  }
  if (field.type === "number" || field.type === "currency") {
    return 1;
  }
  if (field.type === "date") {
    return new Date().toISOString().slice(0, 10);
  }
  if (field.type === "boolean") {
    return true;
  }
  if (field.type === "select") {
    const first = field.options?.[0]?.value;
    if (!first && field.required) {
      throw new Error(`Email smoke cannot populate required select field ${field.key} because it has no options.`);
    }
    return first;
  }
  if (field.type === "user") {
    return context.user.id;
  }
  if (field.type === "reference" && field.required) {
    throw new Error(`Email smoke cannot safely populate required reference field ${field.key}; use a simpler contacts schema before running --smoke.`);
  }
  return undefined;
}

async function cleanupSmokeData(context: RequestContext, artifacts: { accountId?: string; recordId?: string; threadId?: string; inboundMessageId?: string; outboundMessageId?: string; staleOutboundMessageId?: string; knowledgeArticleId?: string }) {
  const { prisma } = await import("@/lib/db");
  const ids = [artifacts.accountId, artifacts.recordId, artifacts.threadId, artifacts.inboundMessageId, artifacts.outboundMessageId, artifacts.staleOutboundMessageId, artifacts.knowledgeArticleId].filter((value): value is string => Boolean(value));
  if (ids.length) {
    await prisma.auditLog.deleteMany({
      where: {
        workspaceId: context.workspaceId,
        OR: [{ entityId: { in: ids } }, { details: { path: ["threadId"], equals: artifacts.threadId } }]
      }
    });
  }
  if (artifacts.inboundMessageId || artifacts.outboundMessageId || artifacts.staleOutboundMessageId) {
    await prisma.emailMessage.deleteMany({
      where: { workspaceId: context.workspaceId, id: { in: [artifacts.inboundMessageId, artifacts.outboundMessageId, artifacts.staleOutboundMessageId].filter((value): value is string => Boolean(value)) } }
    });
  }
  if (artifacts.threadId) {
    await prisma.emailThread.deleteMany({ where: { workspaceId: context.workspaceId, id: artifacts.threadId } });
  }
  if (artifacts.accountId) {
    await prisma.emailAccount.deleteMany({ where: { workspaceId: context.workspaceId, id: artifacts.accountId } });
  }
  if (artifacts.knowledgeArticleId) {
    await prisma.knowledgeArticle.deleteMany({ where: { workspaceId: context.workspaceId, id: artifacts.knowledgeArticleId } });
  }
  if (artifacts.recordId) {
    await prisma.activity.deleteMany({ where: { workspaceId: context.workspaceId, recordId: artifacts.recordId } });
    await prisma.crmRecord.deleteMany({ where: { workspaceId: context.workspaceId, id: artifacts.recordId } });
  }
}

function assertSmoke(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function restoreEnv(name: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = previous;
}

function buildManualVerificationSteps(): string[] {
  return [
    "Open the email workspace and run diagnostics until encryption, OAuth, AI, queue, and account checks are ok or intentionally warning-only.",
    "Confirm APP_BASE_URL produces the exact OAuth callback URL configured in Gmail or Outlook provider consoles.",
    "For each Gmail or Outlook mailbox, complete OAuth authorization and confirm the test connection shows the expected authorized mailbox address.",
    "For each SMTP/IMAP mailbox, run test connection and confirm SMTP/IMAP statuses match enabled send/sync toggles.",
    "Send a test email with a small attachment, then confirm the outbound message becomes sent and has no failureReason.",
    "Run account sync and confirm importedCount, scannedCount, skippedDuplicateCount, and hasMore are understandable.",
    "Open a linked contact/company/deal and confirm email messages appear in the activity timeline or email thread.",
    "Run draft, translate, context analysis, and summarize actions with toggles on and off, confirming disabled features do not call AI.",
    "Inspect audit logs and confirm AI entries include source counts, generationMode, providerError when fallback occurs, budget metadata, and text lengths without storing generated text or prompts."
  ];
}

function parseArgs(values: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      continue;
    }
    const [key, inline] = value.slice(2).split("=", 2);
    if (inline !== undefined) {
      parsed[key] = inline;
      continue;
    }
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}
