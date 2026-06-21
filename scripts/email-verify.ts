import { createEmailProviderAdapter } from "@/lib/email/provider";
import { buildEmailAttachmentHref } from "@/lib/email/attachments";
import { generateEmailAiOutput } from "@/lib/email/ai-generation";
import { assertDatabaseReachable } from "./database-preflight.ts";
import { loadLocalEnvFiles } from "./load-env.ts";
import type { CrmRecord, EmailAiSettings, EmailMessage, FieldDefinition, KnowledgeArticle, RequestContext } from "@/lib/crm/types";

loadLocalEnvFiles();

const args = parseArgs(process.argv.slice(2));
const userId = String(args["user-id"] ?? process.env.EMAIL_VERIFY_USER_ID ?? process.env.JOB_USER_ID ?? "user-admin");
const runConnectionTests = Boolean(args["test-connections"]);
const runSmoke = Boolean(args.smoke);
const keepSmokeData = Boolean(args["keep-smoke-data"]);
const plan = buildEmailVerificationPlan({ userId, runConnectionTests, runSmoke });

if (args["dry-run"]) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

try {
  await assertDatabaseReachable({ label: "email-verify" });
  const { getCrmRepository, getRequestContextByUserId } = await import("@/lib/crm/repository");
  const { checkEmailSubsystemDiagnosticsForContext } = await import("@/lib/email/diagnostics");
  const repository = getCrmRepository();
  const context = await getRequestContextByUserId(userId);
  const accounts = await repository.listEmailAccounts(context);
  const diagnostics = await checkEmailSubsystemDiagnosticsForContext(context, repository, { includeJobs: true });
  const connectionTests = runConnectionTests ? await testConnections(context, repository, accounts) : [];
  const applicationSmoke = runSmoke ? await runApplicationSmoke(context, repository, { keepSmokeData }) : undefined;
  const ok = diagnostics.ok && connectionTests.every((test) => test.ok) && (applicationSmoke?.ok ?? true);

  console.log(
    JSON.stringify(
      {
        ok,
        userId: context.user.id,
        workspaceId: context.workspaceId,
        diagnostics,
        connectionTests,
        applicationSmoke,
        manualVerification: buildManualVerificationSteps()
      },
      null,
      2
    )
  );

  if (!ok) {
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Email verification failed.");
  process.exit(1);
}

function buildEmailVerificationPlan(options: { userId: string; runConnectionTests: boolean; runSmoke: boolean }) {
  return {
    userId: options.userId,
    runConnectionTests: options.runConnectionTests,
    runSmoke: options.runSmoke,
    steps: [
      "Load admin request context",
      "List workspace email accounts",
      "Run email subsystem diagnostics with mailbox accounts, sync scheduler policy, AI context policy, recent AI automation failure audit, and recent AI provider fallback audit",
      ...(options.runConnectionTests ? ["Run provider connection tests for active configured accounts"] : []),
      ...(options.runSmoke ? ["Run application smoke flow with a temporary CRM record, knowledge article, inbound email, AI draft, attachment, and dry-run send"] : []),
      "Print manual send, sync, AI, and OAuth callback verification steps"
    ],
    requiredEnvironment: [
      "DATABASE_URL",
      "EMAIL_CONFIG_SECRET or APP_SECRET",
      "APP_BASE_URL",
      "AI_API_KEY when remote AI generation is required",
      "GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET when Gmail accounts are used",
      "OUTLOOK_OAUTH_CLIENT_ID and OUTLOOK_OAUTH_CLIENT_SECRET when Outlook accounts are used",
      "REDIS_URL when JOB_EXECUTOR=redis"
    ],
    automatedVerification: [
      "npm test includes the email crm smoke flow: account setup, inbound history, knowledge context, AI draft, attachment, dry-run send, and audit metadata.",
      "npm run email:verify checks environment readiness and can run real provider connection tests with -- --test-connections.",
      "npm run email:verify -- --smoke runs the same application-level smoke flow against the configured database using dry-run email delivery in the script process.",
      "npm run test:e2e -- tests/e2e/email-flow.spec.ts covers the browser email workspace path when Postgres is reachable at DATABASE_URL."
    ],
    manualVerification: buildManualVerificationSteps()
  };
}

async function testConnections(context: Awaited<ReturnType<typeof import("@/lib/crm/repository").getRequestContextByUserId>>, repository: ReturnType<typeof import("@/lib/crm/repository").getCrmRepository>, accounts: Array<{ id: string; emailAddress: string; status: string; connectionConfigured: boolean }>) {
  const adapter = createEmailProviderAdapter(repository);
  const activeConfiguredAccounts = accounts.filter((account) => account.status === "active" && account.connectionConfigured);
  const results = [];
  for (const account of activeConfiguredAccounts) {
    try {
      const result = await adapter.testConnection(context, account.id);
      results.push({
        accountId: account.id,
        emailAddress: account.emailAddress,
        ok: true,
        result: result.result
      });
    } catch (error) {
      results.push({
        accountId: account.id,
        emailAddress: account.emailAddress,
        ok: false,
        error: error instanceof Error ? error.message : "Connection test failed"
      });
    }
  }
  return results;
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

async function cleanupSmokeData(context: RequestContext, artifacts: { accountId?: string; recordId?: string; threadId?: string; inboundMessageId?: string; outboundMessageId?: string; knowledgeArticleId?: string }) {
  const { prisma } = await import("@/lib/db");
  const ids = [artifacts.accountId, artifacts.recordId, artifacts.threadId, artifacts.inboundMessageId, artifacts.outboundMessageId, artifacts.knowledgeArticleId].filter((value): value is string => Boolean(value));
  if (ids.length) {
    await prisma.auditLog.deleteMany({
      where: {
        workspaceId: context.workspaceId,
        OR: [{ entityId: { in: ids } }, { details: { path: ["threadId"], equals: artifacts.threadId } }]
      }
    });
  }
  if (artifacts.inboundMessageId || artifacts.outboundMessageId) {
    await prisma.emailMessage.deleteMany({
      where: { workspaceId: context.workspaceId, id: { in: [artifacts.inboundMessageId, artifacts.outboundMessageId].filter((value): value is string => Boolean(value)) } }
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
