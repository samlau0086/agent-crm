import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { listAiAgentDefinitions, normalizeGlobalAiAgentSettings, recordSummaryAgentKey, smartReminderPlannerAgentKey, talkAboutThisAgentKey, workflowAiAgentNodeKey } from "../src/lib/ai/agents.ts";
import { runAiAgent } from "../src/lib/ai/harness.ts";
import { createAiProvider } from "../src/lib/ai/provider.ts";
import { buildAiQueryPlan, validateAiQueryPlan } from "../src/lib/ai/query-planner.ts";
import { assertReadOnlyAiQuestion } from "../src/lib/ai/query-guard.ts";
import { getApiErrorAuditCredential } from "../src/lib/api-audit.ts";
import { ApiError, toApiErrorPayload } from "../src/lib/api-error.ts";
import { parseFormBody, parseJsonBody, parseOptionalJsonBody } from "../src/lib/api-validation.ts";
import { createApiKeyToken, getApiKeyTokenPrefix, hashApiKeyToken, getBearerToken } from "../src/lib/auth/api-key.ts";
import { clearFailedLogin, isLoginRateLimited, recordFailedLogin, resetLoginRateLimitsForTests } from "../src/lib/auth/login-rate-limit.ts";
import { createPasswordSetupToken, hashPasswordSetupToken, normalizePasswordSetupPurpose } from "../src/lib/auth/password-setup.ts";
import { createSessionToken, hashSessionToken } from "../src/lib/auth/session.ts";
import { describePermission, permissionCatalog } from "../src/lib/auth/permissions.ts";
import { crmPathForNav, resolveCrmRoute } from "../src/lib/crm/navigation.ts";
import {
  activityUpdateSchema,
  activityCreateSchema,
  aiTalkRequestSchema,
  customerLevelChangeRequestSchema,
  customerLevelSettingsUpdateSchema,
  customerLevelSuggestionGenerateSchema,
  csvImportSchema,
  currentUserAvatarMediaAssetCreateSchema,
  currentUserPasswordUpdateSchema,
  currentUserProfileUpdateSchema,
  emailAccountCreateSchema,
  emailAccountUpdateSchema,
  emailAiGenerateSchema,
  emailAiSettingsUpdateSchema,
  emailConnectionTestSchema,
  emailMessageTranslateSchema,
  emailMessageCreateSchema,
  emailOAuthStartSchema,
  emailSendSchema,
  emailSyncAllSchema,
  emailSyncSchema,
  emailThreadStateUpdateSchema,
  emailThreadUpdateSchema,
  importPresetCreateSchema,
  knowledgeArticleCreateSchema,
  knowledgeArticleUpdateSchema,
  MAX_CSV_IMPORT_CHARS,
  MAX_IMPORT_MAPPING_FIELDS,
  MAX_SAVED_VIEW_COLUMNS,
  MAX_SAVED_VIEW_FILTERS,
  poolSettingsUpdateSchema,
  recordDeleteRequestSchema,
  recordWriteSchema,
  recordPatchWithReasonSchema,
  savedViewCreateSchema,
  workflowCreateSchema
} from "../src/lib/crm/api-schemas.ts";
import { defaultWorkspaceId, seedData } from "../src/lib/crm/seed.ts";
import { parseAddressWithLocalAi } from "../src/lib/crm/address-parser.ts";
import { resolveCountry } from "../src/lib/crm/countries.ts";
import { nextSmartReminderPriority, smartReminderCooldownDays, smartReminderNextEligibleAt } from "../src/lib/crm/smart-reminder-lifecycle.ts";
import { getCountryOfficialLanguage, getLanguageLabel, getLanguageSelectOptions } from "../src/lib/crm/languages.ts";
import { CrmStore } from "../src/lib/crm/store.ts";
import { buildEmailModelPrompt, generateEmailAiOutput, MAX_EMAIL_AI_OUTPUT_CHARS, MAX_EMAIL_AI_SUBJECT_CHARS, MAX_EMAIL_MODEL_PROMPT_CHARS } from "../src/lib/email/ai-generation.ts";
import { decryptEmailConnectionConfig, encryptEmailConnectionConfig, getDefaultOutboundService, getInboundConnectionConfig, normalizeEmailConnectionConfig } from "../src/lib/email/connection-config.ts";
import { testEmailAccountConnections } from "../src/lib/email/connection-tests.ts";
import { buildEmailAccountDiagnostics, buildEmailAiContextPolicyDiagnostics, buildEmailAiProviderFallbackDiagnostics, buildEmailAutoSummaryPolicyDiagnostics, buildEmailSendClaimDiagnostics, buildEmailSyncSchedulerDiagnostics, checkEmailSubsystemDiagnostics, checkEmailSubsystemDiagnosticsForContext } from "../src/lib/email/diagnostics.ts";
import { downloadOAuthAttachment, fetchRecentOAuthEmails, sendOAuthEmail } from "../src/lib/email/oauth-api.ts";
import { assertOAuthConfig, buildOAuthAuthorizationUrl, createEmailOAuthState, exchangeOAuthAuthorizationCode, refreshOAuthAccessToken, shouldRefreshOAuthToken, verifyEmailOAuthState } from "../src/lib/email/oauth.ts";
import { buildOAuthEmailConnectedRedirectUrl, buildOAuthEmailErrorRedirectUrl, connectOAuthEmailAccount } from "../src/lib/email/oauth-account.ts";
import { MAX_OUTBOUND_EMAIL_RECIPIENTS, validateOutboundEmailRecipientPolicy } from "../src/lib/email/outbound-policy.ts";
import { createEmailProviderAdapter } from "../src/lib/email/provider.ts";
import { sendResendEmail } from "../src/lib/email/resend.ts";
import { getEmailProviderCapability, getEmailProviderSetupVisibility, getOAuthEmailProviderCapability, isOAuthEmailProvider, listEmailProviderCapabilities, oauthEmailProviderKeys } from "../src/lib/email/providers.ts";
import { buildEmailReplyDraft } from "../src/lib/email/reply-draft.ts";
import { parseEmailThreadSearchCommand } from "../src/lib/email/search-command.ts";
import { getFailedEmailSendResultOrThrow } from "../src/lib/email/send-failure.ts";
import { repairEmailMojibake } from "../src/lib/email/mojibake.ts";
import { getEmailTemplateVariableDefinitions, hasEmailTemplateVariables, renderEmailTemplate } from "../src/lib/email/template-variables.ts";
import { buildImapFallbackExternalMessageId, buildRfc822Message, fetchRecentImapEmailBatch, fetchRecentImapEmails, parseRawEmailMessage, resolveSmtpTransport, sendSmtpEmail, withImapFallbackExternalMessageId } from "../src/lib/email/smtp-imap.ts";
import { getFailedEmailSyncResultOrThrow } from "../src/lib/email/sync-failure.ts";
import { scheduleEmailSyncForActiveAccounts } from "../src/lib/email/sync-scheduler.ts";
import { formatEmailSendResultMessage } from "../src/lib/email/status-messages.ts";
import { extractInboundMetadata } from "../src/lib/email/tracking.ts";
import { formatAuditAction } from "../src/lib/crm/audit-labels.ts";
import { buildCsv } from "../src/lib/crm/csv.ts";
import { getCurrencyDefinitions } from "../src/lib/crm/currencies.ts";
import { buildTemplateContext, evaluatePdfTemplateCondition, renderPdfTemplateText, renderSalesDocumentPdf } from "../src/lib/crm/document-pdf.ts";
import { compilePdfTemplateLayout, PdfTemplateValidationError, validatePdfTemplate } from "../src/lib/crm/pdf-template-layout.ts";
import { previewSalesDocumentNumber, renderSalesDocumentNumber, salesDocumentLocalDate, validateSalesDocumentNumberRule } from "../src/lib/crm/document-numbering.ts";
import { renderPdfFileName, validatePdfFileNamePattern } from "../src/lib/crm/pdf-file-name.ts";
import { buildPaymentTermSchedule, getPaymentTermDefinitions } from "../src/lib/crm/payment-terms.ts";
import { salesDocumentNextObjectKey } from "../src/lib/crm/quotes.ts";
import { generateWorkflowWithAiDesigner } from "../src/lib/workflows/ai-designer.ts";
import { buildWorkflowDraftFromGoal, graphToLegacyWorkflow, legacyWorkflowToGraph, workflowMatchesEvent } from "../src/lib/workflows/core.ts";
import { buildImportJobObservability } from "../src/lib/crm/import-observability.ts";
import { parseAuditLogQuery } from "../src/lib/crm/audit-query.ts";
import { hasRecordPatchChanges, isContactMethodsAdditionOnly, previousRecordApprovalPatch, splitRecordApprovalPatch, stripRecordApprovalMetadata } from "../src/lib/crm/record-approval.ts";
import { parseRecordListQuery } from "../src/lib/crm/record-query.ts";
import { getBackupFile, listBackupFiles, resolveBackupFilePath } from "../src/lib/ops/backups.ts";
import { getDatabaseObservabilitySnapshot, listRecentApiRequestMetrics, recordApiRequestMetric } from "../src/lib/ops/observability.ts";
import { assertValidFieldDefinition, validateRecordPayload } from "../src/lib/crm/validation.ts";
import { compareRecords, findRelatedRecords, matchesSavedView } from "../src/lib/crm/views.ts";
import { assertValidWebhookEvents, assertValidWebhookUrl, assertWebhookDeliveryTarget, buildWebhookSignatureHeader, createWebhookSecret, expandWebhookEventsForPayload, isValidWebhookEvent, signWebhookPayload } from "../src/lib/integrations/webhook.ts";
import { buildCsvImportJobEnvelope, buildEmailAnalyzeJobEnvelope, buildEmailClassifyJobEnvelope, buildEmailSendJobEnvelope, buildEmailSummarizeJobEnvelope, buildEmailSyncJobEnvelope, buildEmailTranslateJobEnvelope, buildWebhookEventEnvelope, buildWorkflowRunJobEnvelope, InlineBackgroundJobExecutor, RedisBackgroundJobExecutor } from "../src/lib/jobs/executor.ts";
import { encodeRedisCommand, getDeadLetterQueueName } from "../src/lib/jobs/redis-queue.ts";
import { buildFailedJobEnvelope, getMaxJobAttempts, getMaxJobAttemptsForEnvelope } from "../src/lib/jobs/worker-policy.ts";
import { formatJobWorkerResult, processQueuedJobEnvelope } from "../src/lib/jobs/worker.ts";
import { checkJobHealth, toSafeDatabaseHealthError, toSafeHealthError } from "../src/lib/ops/health.ts";
import { buildServiceHealthPayload } from "../src/lib/ops/service-health.ts";
import { appUrl, getAppBaseUrl } from "../src/lib/security/app-origin.ts";
import { shouldBlockCrossSiteMutation } from "../src/lib/security/csrf.ts";
import { applySecurityHeaders, buildSecurityHeaders } from "../src/lib/security/headers.ts";
import { buildEmailAttachmentResponse } from "../src/lib/email/attachment-response.ts";
import { canOpenEmailAiSource, emailAiSourceKey } from "../src/lib/email/ai-sources.ts";
import { buildEmailAttachmentHref, MAX_EMAIL_ATTACHMENT_BYTES } from "../src/lib/email/attachments.ts";
import { parseEmailThreadCategory } from "../src/lib/email/classification.ts";
import { isEmailMessageEligibleForAutomation, runEmailAutomationsBestEffort, scheduleEmailAutomationsBestEffort, shouldRunEmailAutoSummary } from "../src/lib/email/automations.ts";
import { buildEmailAssistantContext as buildEmailPromptContext, canRunEmailAiAutomation, createDefaultEmailAiSettings, emailClassificationAgentKey, emailContextAnalysisAgentKey, emailDraftAgentKey, emailThreadSummaryAgentKey, emailTranslationAgentKey, getAiAgentSetting, getEmailAiPurposeFeature, inboundEmailPreprocessAgentKey, isEmailAiPurposeEnabled, normalizeAiAgentSettings, normalizeEmailAiFeatures, workflowDesignerAgentKey } from "../src/lib/email/assistant.ts";
import { readEmailOAuthCallbackNotice, readEmailOAuthConnectedNotice } from "../src/lib/email/oauth-callback.ts";
import { getDatabaseConnectionTarget } from "../scripts/database-preflight.ts";
import { formatDatabasePreflightFailure } from "../scripts/runtime-preflight.mjs";
import { loadLocalEnvFiles } from "../scripts/load-env.ts";
import { runMcpTests } from "./mcp.test.ts";

const results = [];

async function run(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error });
  }
}

async function flushAsyncWork(cycles = 5) {
  for (let index = 0; index < cycles; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function makeTempDir(prefix) {
  const directory = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(directory, { recursive: true });
  return directory;
}

function restoreEnvValue(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function startFakeSmtpServer() {
  let capturedMessage = "";
  const server = createServer((socket) => {
    let commandBuffer = "";
    let dataBuffer = "";
    let inData = false;
    socket.setEncoding("utf8");
    socket.write("220 fake-smtp.local ESMTP\r\n");
    socket.on("data", (chunk) => {
      if (inData) {
        dataBuffer += chunk;
        const endIndex = dataBuffer.indexOf("\r\n.\r\n");
        if (endIndex >= 0) {
          capturedMessage = dataBuffer.slice(0, endIndex);
          inData = false;
          dataBuffer = dataBuffer.slice(endIndex + 5);
          socket.write("250 queued\r\n");
        }
        return;
      }
      commandBuffer += chunk;
      const lines = commandBuffer.split(/\r\n/);
      commandBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        if (/^EHLO /i.test(line)) {
          socket.write("250 fake-smtp.local\r\n");
        } else if (/^AUTH /i.test(line)) {
          socket.write("235 authenticated\r\n");
        } else if (/^(MAIL FROM|RCPT TO)/i.test(line)) {
          socket.write("250 ok\r\n");
        } else if (/^DATA$/i.test(line)) {
          inData = true;
          dataBuffer = "";
          socket.write("354 end with dot\r\n");
        } else if (/^QUIT$/i.test(line)) {
          socket.write("221 bye\r\n");
          socket.end();
        } else {
          socket.write("250 ok\r\n");
        }
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      resolve({
        port: address.port,
        message: () => capturedMessage,
        close: () => new Promise((closeResolve, closeReject) => server.close((error) => (error ? closeReject(error) : closeResolve())))
      });
    });
  });
}

await run("email templates personalize contact and company variables per recipient", () => {
  const contact = {
    id: "contact-george",
    workspaceId: "workspace-1",
    objectKey: "contacts",
    title: "George Shepherd",
    tags: [],
    tagColors: {},
    data: { email: "george@example.com", companyId: "company-viper" },
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z"
  };
  const company = {
    id: "company-viper",
    workspaceId: "workspace-1",
    objectKey: "companies",
    title: "Viper <Tech>",
    tags: [],
    tagColors: {},
    data: { billingAddresses: [{ line1: "1 Nebula Way", city: "London", country: "GB" }] },
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z"
  };
  const context = { recipientEmail: "george@example.com", contact, company };
  assert.equal(hasEmailTemplateVariables("Hello {{contact.firstName}}"), true);
  assert.equal(
    renderEmailTemplate("Hello {{contact.firstName}} {{contact.lastName}} from {{company.name}} at {{company.address}}", context).value,
    "Hello George Shepherd from Viper <Tech> at 1 Nebula Way, London, GB"
  );
  assert.match(renderEmailTemplate("<p>{{company.name}}</p>", context, { html: true }).value, /Viper &lt;Tech&gt;/);
  assert.deepEqual(renderEmailTemplate("{{contact.phone}}", context).missingVariables, ["contact.phone"]);
});

await run("email template variable catalog includes custom contact and company fields", () => {
  const definitions = getEmailTemplateVariableDefinitions([
    { id: "field-1", workspaceId: "workspace-1", objectKey: "contacts", key: "jobTitle", label: "职位", type: "text", required: false, unique: false, isSystem: false, position: 1 },
    { id: "field-2", workspaceId: "workspace-1", objectKey: "companies", key: "industry", label: "行业", type: "text", required: false, unique: false, isSystem: false, position: 1 }
  ]);
  assert.ok(definitions.some((definition) => definition.token === "{{contact.jobTitle}}"));
  assert.ok(definitions.some((definition) => definition.token === "{{company.industry}}"));
});

await run("field definition rejects invalid key", () => {
  assert.throws(() => assertValidFieldDefinition({ key: "Bad Key", label: "Bad field", type: "text" }), /key/);
});

await run("field definition requires select options", () => {
  assert.throws(() => assertValidFieldDefinition({ key: "tier", label: "Tier", type: "select" }), /options/);
});

await run("record validation rejects missing required value", () => {
  const emailField = {
    id: "field-email",
    workspaceId: "workspace-private",
    objectKey: "contacts",
    key: "email",
    label: "Email",
    type: "text",
    required: true,
    unique: true,
    isSystem: true,
    position: 1
  };

  assert.throws(() => validateRecordPayload([emailField], {}, []), /Email/);
});

await run("smart reminders support portfolio operating actions", () => {
  const smartReminderDefinition = listAiAgentDefinitions().find((definition) => definition.key === smartReminderPlannerAgentKey);
  assert(smartReminderDefinition);
  assert.match(smartReminderDefinition.defaultAgentMarkdown, /portfolioMetrics/);
  assert.match(smartReminderDefinition.defaultAgentMarkdown, /portfolio_health/);
  assert.match(smartReminderDefinition.defaultAgentMarkdown, /data_quality/);
  const typesSource = readFileSync("src/lib/crm/types.ts", "utf8");
  assert.match(typesSource, /portfolio_health/);
  assert.match(typesSource, /pipeline_optimization/);
  const repositorySource = readFileSync("src/lib/crm/repository.ts", "utf8");
  assert.match(repositorySource, /buildSmartReminderPortfolioMetrics/);
  assert.match(repositorySource, /lowCompletenessContacts/);
  assert.match(repositorySource, /stalePrivateRecords/);
  assert.match(repositorySource, /kind: query.kind/);
  assert.match(repositorySource, /pruneStaleSmartReminderRecordSources\(context, reminders\.map\(mapSmartReminder\)\)/);
  assert.match(repositorySource, /tx\.smartReminder\.deleteMany\(\{[\s\S]*\{ recordId \}[\s\S]*array_contains: \[\{ objectKey, recordId \}\]/);
  assert.match(repositorySource, /const taskDueAt = reminder\.dueAt \? new Date\(reminder\.dueAt\)\.toISOString\(\) : smartReminderDefaultDueAt\(\);/);
  assert.match(repositorySource, /convertSmartReminderToTask[\s\S]*dueAt: taskDueAt/);
  assert.match(repositorySource, /dueAt: normalizeOptionalDate\(raw\.dueAt\) \?\? smartReminderDefaultDueAt\(\)/);
  assert.match(repositorySource, /function smartReminderDefaultDueAt\(now = new Date\(\)\): string/);
  assert.match(repositorySource, /buildSmartReminderIssueKey\(candidate\)/);
  assert.match(repositorySource, /localCalendarDayKey\(existing\.lastSeenAt\) !== localCalendarDayKey\(now\)/);
  assert.match(repositorySource, /nextSmartReminderPriority\(candidateFloor\)/);
  assert.match(repositorySource, /smartReminderNextEligibleAt\(existing\.priority, now\)/);
  assert.match(repositorySource, /linked_task_completed/);
  assert.match(repositorySource, /pipeline_improved/);
  const workspaceSource = readFileSync("src/components/crm-workspace.tsx", "utf8");
  assert.match(workspaceSource, /function smartReminderFallbackObjectKey\(kind: SmartReminder\["kind"\], availableObjectKeys: string\[\]\): string/);
  assert.match(workspaceSource, /const isAvailableRecordObject = \(objectKey\?: string\) => Boolean\(objectKey && props\.objects\.some\(\(object\) => object\.key === objectKey\)\)/);
  assert.match(workspaceSource, /reminder\.objectKey === "emails" \|\| reminder\.objectKey === "emailThreads"/);
  assert.match(workspaceSource, /\(isAvailableRecordObject\(reminder\.objectKey\) \? reminder\.objectKey : undefined\)/);
  assert.match(workspaceSource, /function SmartReminderUrgency/);
  assert.match(workspaceSource, /Array\.from\(\{ length: 6 \}/);
  assert.match(workspaceSource, /\[1, 2, 3\]\.map\(\(days\)/);
  const migrationSource = readFileSync("prisma/migrations/20260713170000_smart_reminder_lifecycle/migration.sql", "utf8");
  assert.match(migrationSource, /"issueKey" TEXT/);
  assert.match(migrationSource, /SmartReminder_workspaceId_userId_issueKey_key/);
  assert.match(migrationSource, /row_number\(\) OVER/);
});

await run("smart reminder lifecycle escalates once per level and applies calendar-day cooldowns", () => {
  assert.equal(nextSmartReminderPriority("info"), "low");
  assert.equal(nextSmartReminderPriority("urgent"), "critical");
  assert.equal(nextSmartReminderPriority("critical"), "critical");
  assert.equal(smartReminderCooldownDays("critical"), 1);
  assert.equal(smartReminderCooldownDays("high"), 2);
  assert.equal(smartReminderCooldownDays("low"), 3);
  const completedAt = new Date(2026, 6, 13, 21, 30, 0);
  assert.deepEqual(
    ["critical", "high", "low"].map((priority) => {
      const eligible = smartReminderNextEligibleAt(priority, completedAt);
      return [eligible.getFullYear(), eligible.getMonth() + 1, eligible.getDate(), eligible.getHours()];
    }),
    [[2026, 7, 15, 0], [2026, 7, 16, 0], [2026, 7, 17, 0]]
  );
});

await run("workflow permissions and designer agent are registered", () => {
  assert(permissionCatalog.some((permission) => permission.key === "workflow.read"));
  assert(permissionCatalog.some((permission) => permission.key === "workflow.write"));
  assert(permissionCatalog.some((permission) => permission.key === "workflow.admin"));
  const settings = createDefaultEmailAiSettings();
  assert.equal(getAiAgentSetting(settings, workflowDesignerAgentKey)?.scenario, "system");
});

await run("workflow schema accepts generated key/name actions", () => {
  const parsed = workflowCreateSchema.parse({
    name: "7 day follow up",
    goal: "7 天未回复自动跟进",
    status: "draft",
    trigger: { type: "crm_event", event: "record.updated", objectKey: "contacts" },
    conditions: [{ key: "owner-exists", type: "field", field: "ownerId", operator: "exists" }],
    actions: [{ key: "task", type: "create_activity", name: "创建跟进任务", config: { activityType: "task", title: "跟进客户" } }]
  });
  assert.equal(parsed.actions[0].key, "task");
});

await run("workflow schema supports control nodes and record-scoped generation", () => {
  const parsed = workflowCreateSchema.parse({
    name: "Targeted automation",
    goal: "只针对指定联系人自动跟进",
    status: "draft",
    trigger: { type: "crm_event", event: "record.updated", objectKey: "contacts" },
    conditions: [
      { key: "if-target", type: "if", field: "recordId", operator: "equals", value: "contact-lin", config: { branch: "matched" } },
      { key: "switch-stage", type: "switch", field: "stageKey", operator: "exists", config: { cases: "new,qualified" } },
      { key: "loop-items", type: "loop", field: "items", operator: "exists", config: { collectionField: "items", maxIterations: 10 } }
    ],
    actions: [
      {
        key: "send-email",
        type: "send_email",
        name: "Send follow up",
        config: { mode: "queued", accountId: "account-1", to: ["buyer@example.com"], cc: ["manager@example.com"], bcc: ["archive@example.com"], subject: "Follow up", bodyHtml: "<p>Hello</p>" }
      },
      {
        key: "ai-agent",
        type: "run_ai_agent",
        name: "AI Agent",
        config: { goal: "Pick the next best action", allowedTools: ["create_task", "create_email_draft"], useKnowledge: true, autoExecuteTools: false }
      }
    ],
    graph: {
      scope: { mode: "record", objectKey: "contacts", recordId: "contact-lin", recordTitle: "林晓" },
      nodes: [
        { id: "start", type: "start", label: "Start: 林晓", position: { x: 0, y: 0 }, config: { trigger: { type: "crm_event", event: "record.updated", objectKey: "contacts" } } },
        { id: "if-target", type: "if", label: "IF target", position: { x: 260, y: 0 }, config: { field: "recordId", operator: "equals", value: "contact-lin" } },
        { id: "agent", type: "ai_agent", label: "AI Agent", position: { x: 390, y: 0 }, config: { goal: "Pick the next best action", allowedTools: ["create_task"], useKnowledge: true } },
        { id: "task", type: "create_task", label: "Task", position: { x: 520, y: 0 }, config: { title: "Follow up" } },
        { id: "end", type: "end", label: "End", position: { x: 780, y: 0 }, config: {} }
      ],
      edges: [
        { id: "edge-start-if", sourceNodeId: "start", sourceHandle: "main", targetNodeId: "if-target" },
        { id: "edge-if-agent", sourceNodeId: "if-target", sourceHandle: "true", targetNodeId: "agent" },
        { id: "edge-agent-review-task", sourceNodeId: "agent", sourceHandle: "needs_review", targetNodeId: "task" },
        { id: "edge-agent-done-task", sourceNodeId: "agent", sourceHandle: "done", targetNodeId: "task" },
        { id: "edge-if-end", sourceNodeId: "if-target", sourceHandle: "false", targetNodeId: "end" },
        { id: "edge-task-end", sourceNodeId: "task", sourceHandle: "main", targetNodeId: "end" }
      ]
    }
  });
  assert.deepEqual(parsed.conditions.map((condition) => condition.type), ["if", "switch", "loop"]);
  assert.equal(parsed.graph.scope.mode, "record");
  assert(parsed.graph.nodes.some((node) => node.type === "ai_agent"));
  assert(parsed.actions.some((action) => action.type === "run_ai_agent"));
  assert.deepEqual(parsed.graph.edges.map((edge) => edge.sourceHandle), ["main", "true", "needs_review", "done", "false", "main"]);
  assert.equal(parsed.actions[0].config.mode, "queued");
  const draft = buildWorkflowDraftFromGoal({ goal: "联系人更新后自动跟进", objectKey: "contacts", recordId: "contact-lin", recordTitle: "林晓" });
  assert.match(draft.workflow.name, /林晓/);
  assert.equal(draft.workflow.graph.scope.mode, "record");
  assert.equal(draft.workflow.graph.scope.recordId, "contact-lin");
  assert.equal(draft.workflow.trigger.config.targetRecordId, "contact-lin");
  assert.equal(draft.workflow.conditions[0].type, "if");
  assert.equal(draft.workflow.conditions[0].value, "contact-lin");
  const converted = legacyWorkflowToGraph(draft.workflow);
  const legacy = graphToLegacyWorkflow(converted);
  assert.equal(legacy.trigger.config.targetRecordId, "contact-lin");
  const scopedWorkflow = {
    ...draft.workflow,
    id: "workflow-scoped",
    workspaceId: "workspace-private",
    createdById: "user-admin",
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    status: "active"
  };
  assert.equal(workflowMatchesEvent(scopedWorkflow, "record.updated", { objectKey: "contacts", recordId: "contact-lin" }), true);
  assert.equal(workflowMatchesEvent(scopedWorkflow, "record.updated", { objectKey: "contacts", recordId: "other-contact" }), false);
});

await run("workflow schema allows graph drafts without action nodes", () => {
  const parsed = workflowCreateSchema.parse({
    name: "Draft branch workflow",
    goal: "保存仍在编排中的图形化工作流草稿",
    status: "draft",
    trigger: { type: "crm_event", event: "record.updated", objectKey: "contacts" },
    conditions: [{ key: "if-record", type: "if", field: "recordId", operator: "exists" }],
    actions: [],
    graph: {
      scope: { mode: "record", objectKey: "contacts", recordId: "contact-lin", recordTitle: "林晓" },
      nodes: [
        { id: "start", type: "start", label: "Start: 林晓", position: { x: 40, y: 160 }, config: {} },
        { id: "condition:if-record", type: "if", label: "IF", position: { x: 320, y: 160 }, config: { field: "recordId", operator: "exists" } },
        { id: "end", type: "end", label: "End", position: { x: 620, y: 160 }, config: {} }
      ],
      edges: [
        { id: "edge:start:main:if", sourceNodeId: "start", sourceHandle: "main", targetNodeId: "condition:if-record" },
        { id: "edge:if:true:end", sourceNodeId: "condition:if-record", sourceHandle: "true", targetNodeId: "end" },
        { id: "edge:if:false:end", sourceNodeId: "condition:if-record", sourceHandle: "false", targetNodeId: "end" }
      ]
    }
  });

  assert.deepEqual(parsed.actions, []);
  assert.equal(parsed.graph.scope.mode, "record");
});

await run("workflow graph supports follow-up wait reply and draft email nodes", () => {
  const generated = buildWorkflowDraftFromGoal({ goal: "7 天未回复的报价客户自动跟进", objectKey: "contacts", recordId: "contact-lin", recordTitle: "林晓" });
  assert.equal(generated.workflow.graph.scope.mode, "record");
  assert.equal(generated.workflow.graph.scope.recordId, "contact-lin");
  assert.equal(generated.workflow.trigger.type, "email_event");
  assert.equal(generated.workflow.trigger.event, "email.message.sent");
  assert(generated.workflow.graph.nodes.some((node) => node.type === "wait_delay"));
  assert(generated.workflow.graph.nodes.some((node) => node.type === "wait_reply"));
  assert(generated.workflow.graph.nodes.some((node) => node.type === "create_email_draft"));
  assert(generated.workflow.graph.nodes.some((node) => node.type === "create_task"));
  assert(generated.workflow.graph.edges.some((edge) => edge.sourceNodeId === "wait-reply" && edge.sourceHandle === "not_replied" && edge.targetNodeId === "draft-follow-up-email"));
  assert(generated.workflow.graph.edges.some((edge) => edge.sourceNodeId === "wait-reply" && edge.sourceHandle === "replied" && edge.targetNodeId === "end"));
  assert.equal(generated.workflow.conditions.some((condition) => condition.type === "email_behavior"), true);
  const draftAction = generated.workflow.actions.find((action) => action.type === "send_email" && action.config.mode === "draft");
  assert(draftAction);
  assert.match(String(draftAction.config.bodyText), /您好 \{\{record\.title\}\}/);
  assert.doesNotMatch(String(draftAction.config.bodyText), /Draft a concise|Use CRM context|knowledge base|source footer/i);
  assert.match(String(draftAction.config.aiInstructions), /CRM context/);

  const graph = workflowCreateSchema.parse({
    name: "Reply follow-up workflow",
    goal: "Wait for a reply and draft a follow-up when there is no response",
    status: "draft",
    trigger: { type: "crm_event", event: "record.updated", objectKey: "contacts" },
    conditions: [],
    actions: [],
    graph: {
      scope: { mode: "record", objectKey: "contacts", recordId: "contact-lin", recordTitle: "林晓" },
      nodes: [
        { id: "start", type: "start", label: "Start: 林晓", position: { x: 40, y: 160 }, config: {} },
        { id: "wait-delay", type: "wait_delay", label: "Wait 2 days", position: { x: 300, y: 160 }, config: { delayAmount: 2, delayUnit: "days" } },
        { id: "wait-reply", type: "wait_reply", label: "Wait for reply", position: { x: 560, y: 160 }, config: { lookbackDays: 7, replySource: "email" } },
        { id: "draft-email", type: "create_email_draft", label: "Draft email", position: { x: 820, y: 60 }, config: { to: ["{{record.data.email}}"], subject: "Follow up {{record.title}}", bodyText: "Checking in." } },
        { id: "task", type: "create_task", label: "Create task", position: { x: 820, y: 260 }, config: { activityType: "task", title: "Reply received task", assigneeMode: "record_owner", priority: "high", preventDuplicate: true } },
        { id: "end", type: "end", label: "End", position: { x: 1080, y: 160 }, config: {} }
      ],
      edges: [
        { id: "edge-start-delay", sourceNodeId: "start", sourceHandle: "main", targetNodeId: "wait-delay" },
        { id: "edge-delay-reply", sourceNodeId: "wait-delay", sourceHandle: "after_delay", targetNodeId: "wait-reply" },
        { id: "edge-reply-task", sourceNodeId: "wait-reply", sourceHandle: "replied", targetNodeId: "task" },
        { id: "edge-no-reply-draft", sourceNodeId: "wait-reply", sourceHandle: "not_replied", targetNodeId: "draft-email" },
        { id: "edge-draft-end", sourceNodeId: "draft-email", sourceHandle: "main", targetNodeId: "end" },
        { id: "edge-task-end", sourceNodeId: "task", sourceHandle: "main", targetNodeId: "end" }
      ]
    }
  }).graph;
  const legacy = graphToLegacyWorkflow(graph);
  assert.equal(legacy.conditions[0].type, "email_behavior");
  assert.equal(legacy.actions.find((action) => action.key === "draft-email")?.type, "send_email");
  assert.equal(legacy.actions.find((action) => action.key === "draft-email")?.requiresApproval, false);
  assert.equal(legacy.actions.find((action) => action.key === "draft-email")?.config.mode, "draft");

  const store = new CrmStore(seedData);
  const context = store.getContext();
  const contact = store.listRecords(context, "contacts")[0];
  store.createEmailAccount(context, {
    name: "Workflow Drafts",
    emailAddress: "workflow@example.com",
    provider: "smtp_imap",
    status: "active",
    sendEnabled: true
  });
  const workflow = store.createWorkflow(context, {
    name: "Reply follow-up workflow",
    goal: "Wait for a reply and draft a follow-up when there is no response",
    status: "active",
    trigger: { type: "crm_event", event: "record.updated", objectKey: "contacts" },
    conditions: legacy.conditions,
    actions: legacy.actions,
    graph: { ...graph, scope: { mode: "record", objectKey: "contacts", recordId: contact.id, recordTitle: contact.title } }
  });
  const noReplyRun = store.testWorkflow(context, workflow.id, { objectKey: "contacts", recordId: contact.id, title: contact.title });
  assert.equal(noReplyRun.nodeResults?.some((result) => result.nodeId === "wait-delay" && result.outputHandle === "after_delay"), true);
  assert.equal(noReplyRun.nodeResults?.some((result) => result.nodeId === "wait-reply" && result.outputHandle === "not_replied"), true);
  assert.equal(noReplyRun.actionResults.find((result) => result.actionKey === "draft-email")?.status, "completed");

  const replyRun = store.testWorkflow(context, workflow.id, { objectKey: "contacts", recordId: contact.id, title: contact.title, direction: "inbound" });
  assert.equal(replyRun.nodeResults?.some((result) => result.nodeId === "wait-reply" && result.outputHandle === "replied"), true);
});

await run("workflow wait delay persists a resume and resumes from the next node", () => {
  const store = new CrmStore(seedData);
  const context = store.getContext();
  const contact = store.listRecords(context, "contacts")[0];
  store.createEmailAccount(context, {
    name: "Workflow Drafts",
    emailAddress: "workflow@example.com",
    provider: "smtp_imap",
    status: "active",
    sendEnabled: true
  });
  const graph = {
    scope: { mode: "record", objectKey: "contacts", recordId: contact.id, recordTitle: contact.title },
    nodes: [
      { id: "start", type: "start", label: "Start", position: { x: 40, y: 160 }, config: {} },
      { id: "wait-delay", type: "wait_delay", label: "Wait", position: { x: 300, y: 160 }, config: { delayAmount: 1, delayUnit: "minutes" } },
      { id: "wait-reply", type: "wait_reply", label: "Check reply", position: { x: 560, y: 160 }, config: { lookbackDays: 7 } },
      { id: "draft-email", type: "create_email_draft", label: "Draft follow-up", position: { x: 820, y: 80 }, config: { to: ["{{record.data.email}}"], subject: "Follow up", bodyText: "Checking in." } },
      { id: "end", type: "end", label: "End", position: { x: 1080, y: 160 }, config: {} }
    ],
    edges: [
      { id: "edge-start-wait", sourceNodeId: "start", sourceHandle: "main", targetNodeId: "wait-delay" },
      { id: "edge-wait-reply", sourceNodeId: "wait-delay", sourceHandle: "after_delay", targetNodeId: "wait-reply" },
      { id: "edge-reply-end", sourceNodeId: "wait-reply", sourceHandle: "replied", targetNodeId: "end" },
      { id: "edge-no-reply-draft", sourceNodeId: "wait-reply", sourceHandle: "not_replied", targetNodeId: "draft-email" },
      { id: "edge-draft-end", sourceNodeId: "draft-email", sourceHandle: "main", targetNodeId: "end" }
    ]
  };
  const workflow = store.createWorkflow(context, {
    name: "Wait resume workflow",
    goal: "Wait then follow up",
    status: "active",
    trigger: { type: "crm_event", event: "record.updated", objectKey: "contacts" },
    conditions: [],
    actions: [],
    graph
  });
  const [run] = store.runWorkflowsForEvent(context, "record.updated", { objectKey: "contacts", recordId: contact.id, updatedAt: "2026-07-08T00:00:00.000Z" });
  assert.equal(run.status, "waiting");
  assert.equal(run.nodeResults?.at(-1)?.nodeId, "wait-delay");
  assert.equal(run.nodeResults?.at(-1)?.status, "waiting");
  const [resume] = store.listWorkflowResumes(context, workflow.id);
  assert.equal(resume.status, "pending");
  assert.equal(resume.nodeId, "wait-reply");
  const scan = store.runWorkflowResumeScan(context, { now: new Date(Date.now() + 5 * 60_000) });
  assert.equal(scan.resumed, 1);
  assert.equal(scan.runs[0].status, "completed");
  assert.equal(scan.runs[0].nodeResults?.some((result) => result.nodeId === "draft-email"), true);
});

await run("workflow wait reply detects an inbound contact reply after the wait", () => {
  const store = new CrmStore(seedData);
  const context = store.getContext();
  const contact = store.listRecords(context, "contacts")[0];
  const account = store.createEmailAccount(context, {
    name: "Workflow Replies",
    emailAddress: "workflow-replies@example.com",
    provider: "smtp_imap",
    status: "active",
    syncEnabled: true,
    sendEnabled: true
  });
  const graph = {
    scope: { mode: "record", objectKey: "contacts", recordId: contact.id, recordTitle: contact.title },
    nodes: [
      { id: "start", type: "start", label: "Start", position: { x: 40, y: 160 }, config: {} },
      { id: "wait-delay", type: "wait_delay", label: "Wait", position: { x: 300, y: 160 }, config: { delayAmount: 1, delayUnit: "minutes" } },
      { id: "wait-reply", type: "wait_reply", label: "Check reply", position: { x: 560, y: 160 }, config: { lookbackDays: 7 } },
      { id: "task", type: "create_task", label: "Handle reply", position: { x: 820, y: 80 }, config: { activityType: "task", title: "Handle reply", body: "Customer replied." } },
      { id: "end", type: "end", label: "End", position: { x: 1080, y: 160 }, config: {} }
    ],
    edges: [
      { id: "edge-start-wait", sourceNodeId: "start", sourceHandle: "main", targetNodeId: "wait-delay" },
      { id: "edge-wait-reply", sourceNodeId: "wait-delay", sourceHandle: "after_delay", targetNodeId: "wait-reply" },
      { id: "edge-reply-task", sourceNodeId: "wait-reply", sourceHandle: "replied", targetNodeId: "task" },
      { id: "edge-no-reply-end", sourceNodeId: "wait-reply", sourceHandle: "not_replied", targetNodeId: "end" },
      { id: "edge-task-end", sourceNodeId: "task", sourceHandle: "main", targetNodeId: "end" }
    ]
  };
  store.createWorkflow(context, {
    name: "Reply detection workflow",
    goal: "Wait until reply",
    status: "active",
    trigger: { type: "crm_event", event: "record.updated", objectKey: "contacts" },
    conditions: [],
    actions: [],
    graph
  });
  store.runWorkflowsForEvent(context, "record.updated", { objectKey: "contacts", recordId: contact.id, updatedAt: "2026-07-08T00:00:00.000Z" });
  store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: String(contact.data.email),
    to: [account.emailAddress],
    subject: "Re: follow up",
    bodyText: "Thanks, I am interested.",
    recordId: contact.id,
    receivedAt: new Date().toISOString()
  });
  const scan = store.runWorkflowResumeScan(context, { now: new Date(Date.now() + 5 * 60_000) });
  assert.equal(scan.runs[0].nodeResults?.some((result) => result.nodeId === "wait-reply" && result.outputHandle === "replied"), true);
  assert.equal(scan.runs[0].nodeResults?.some((result) => result.nodeId === "task"), true);
});

await run("workflow generator creates birthday greeting schedule drafts", () => {
  const generated = buildWorkflowDraftFromGoal({ goal: "在此联系人生日的时候发送生日祝福邮件", objectKey: "contacts" });
  assert.equal(generated.workflow.trigger.type, "schedule");
  assert.equal(generated.workflow.trigger.event, "schedule.daily");
  assert.equal(generated.workflow.trigger.config.dateField, "birthday");
  assert(generated.workflow.graph.nodes.some((node) => node.id === "match-birthday" && node.config.dateMatch === true && node.config.field === "birthday"));
  assert(generated.workflow.graph.nodes.some((node) => node.id === "draft-birthday-email" && node.type === "create_email_draft"));
  const draftAction = generated.workflow.actions.find((action) => action.key === "draft-birthday-email");
  assert.equal(draftAction?.config.mode, "draft");
});

await run("workflow generator creates a cold outreach until reply sequence", () => {
  const generated = buildWorkflowDraftFromGoal({ goal: "冷邮件联系直到客户回复为止", objectKey: "contacts" });
  const nodes = generated.workflow.graph.nodes;
  const edges = generated.workflow.graph.edges;
  assert.equal(generated.workflow.trigger.type, "crm_event");
  assert.equal(generated.workflow.trigger.event, "record.created");
  assert.equal(generated.workflow.graph.scope.mode, "object");
  assert.equal(nodes.filter((node) => node.type === "if").length, 0);
  assert.equal(nodes.some((node) => node.type === "if" && node.config?.field === "recordId" && node.config?.value === ""), false);
  assert.equal(nodes.filter((node) => node.type === "wait_reply").length, 2);
  assert(nodes.some((node) => node.id === "draft-cold-email" && node.type === "create_email_draft"));
  assert(nodes.some((node) => node.id === "draft-follow-up-1" && node.type === "create_email_draft"));
  assert(nodes.some((node) => node.id === "draft-follow-up-2" && node.type === "create_email_draft"));
  assert(edges.some((edge) => edge.sourceNodeId === "wait-first-reply" && edge.sourceHandle === "not_replied" && edge.targetNodeId === "draft-follow-up-1"));
  assert(edges.some((edge) => edge.sourceNodeId === "wait-first-reply" && edge.sourceHandle === "replied" && edge.targetNodeId === "create-reply-task"));
  assert(edges.some((edge) => edge.sourceNodeId === "wait-second-reply" && edge.sourceHandle === "not_replied" && edge.targetNodeId === "draft-follow-up-2"));
  assert(edges.some((edge) => edge.sourceNodeId === "wait-second-reply" && edge.sourceHandle === "replied" && edge.targetNodeId === "create-reply-task"));
  assert.match(generated.explanation.expectedOutcome, /initial cold email|cold email/i);

  const scoped = buildWorkflowDraftFromGoal({ goal: "冷邮件联系直到客户回复为止", objectKey: "contacts", recordId: "contact-lin", recordTitle: "林晓" });
  const scopedIfNodes = scoped.workflow.graph.nodes.filter((node) => node.type === "if");
  assert.equal(scoped.workflow.graph.scope.mode, "record");
  assert.equal(scopedIfNodes.length, 1);
  assert.equal(scopedIfNodes[0].id, "scope-record");
  assert.equal(scopedIfNodes[0].config.condition?.value, "contact-lin");
});

await run("workflow AI designer asks the model for graph logic instead of only using templates", async () => {
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, new Date().toISOString());
  const fetchCalls = [];
  const aiGraph = {
    scope: { mode: "object", objectKey: "contacts" },
    nodes: [
      {
        id: "start",
        type: "start",
        label: "Start: new cold prospect",
        position: { x: 40, y: 160 },
        config: { trigger: { type: "crm_event", event: "record.created", objectKey: "contacts" } }
      },
      {
        id: "draft-intro-from-ai",
        type: "create_email_draft",
        label: "Draft personalized cold email",
        position: { x: 340, y: 80 },
        config: {
          to: "{{record.data.email}}",
          subject: "Quick question for {{record.title}}",
          body: "Hi {{record.title}}, I noticed your company may be exploring automation. Would it be useful to compare your current follow-up process with a lightweight CRM workflow?",
          requiresApproval: true
        }
      },
      { id: "wait-three-days", type: "wait_delay", label: "Wait 3 days", position: { x: 640, y: 160 }, config: { delayAmount: 3, delayUnit: "days" } },
      { id: "check-reply", type: "wait_reply", label: "Check for reply", position: { x: 940, y: 160 }, config: { lookbackDays: 3, replySource: "email" } },
      {
        id: "task-handle-reply",
        type: "create_task",
        label: "Sales review replied lead",
        position: { x: 1240, y: 40 },
        config: { activityType: "task", title: "Review reply from {{record.title}}", body: "客户已回复，检查意向并决定下一步。", dueInDays: 0 }
      },
      {
        id: "draft-second-followup",
        type: "create_email_draft",
        label: "Draft second follow-up",
        position: { x: 1240, y: 260 },
        config: {
          to: "{{record.data.email}}",
          subject: "Following up on automation",
          body: "Hi {{record.title}}, just following up in case this is relevant. If timing is not right, I can close the loop.",
          requiresApproval: true
        }
      },
      { id: "end", type: "end", label: "End", position: { x: 1540, y: 160 }, config: {} }
    ],
    edges: [
      { id: "edge-start-draft", sourceNodeId: "start", sourceHandle: "main", targetNodeId: "draft-intro-from-ai" },
      { id: "edge-draft-wait", sourceNodeId: "draft-intro-from-ai", sourceHandle: "main", targetNodeId: "wait-three-days" },
      { id: "edge-wait-check", sourceNodeId: "wait-three-days", sourceHandle: "after_delay", targetNodeId: "check-reply" },
      { id: "edge-replied-task", sourceNodeId: "check-reply", sourceHandle: "replied", targetNodeId: "task-handle-reply" },
      { id: "edge-no-reply-followup", sourceNodeId: "check-reply", sourceHandle: "not_replied", targetNodeId: "draft-second-followup" },
      { id: "edge-task-end", sourceNodeId: "task-handle-reply", sourceHandle: "main", targetNodeId: "end" },
      { id: "edge-followup-end", sourceNodeId: "draft-second-followup", sourceHandle: "main", targetNodeId: "end" }
    ]
  };
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              name: "AI designed cold outreach",
              description: "Cold email sequence that waits for a reply and branches.",
              goal: "冷邮件联系直到客户回复为止",
              trigger: { type: "crm_event", event: "record.created", objectKey: "contacts" },
              graph: aiGraph,
              explanation: {
                triggerReason: "New contacts should enter the outreach sequence.",
                expectedOutcome: "A human-reviewed cold email and follow-up are drafted until the contact replies.",
                risks: ["Email drafts require review before sending."]
              }
            })
          }
        }
      ]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const generated = await generateWorkflowWithAiDesigner(
    { goal: "冷邮件联系直到客户回复为止", objectKey: "contacts" },
    {
      settings,
      providerConfig: { provider: "openai", baseUrl: "https://ai.example/v1", apiKey: "test-key", model: "test-model", timeoutMs: 10000 },
      fetchImpl
    }
  );

  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /https:\/\/ai\.example\/v1\/chat\/completions/);
  const systemPrompt = fetchCalls[0].body.messages[0].content;
  assert.match(systemPrompt, /Do not use fixed templates blindly/);
  assert.match(systemPrompt, /wait_reply/);
  assert.match(systemPrompt, /replied and not_replied/);
  assert.match(systemPrompt, /Supported node types and output handles/);
  assert.equal(generated.workflow.name, "AI designed cold outreach");
  assert.equal(generated.workflow.graph.nodes.some((node) => node.id === "draft-intro-from-ai"), true);
  assert.equal(generated.workflow.graph.nodes.some((node) => node.id === "draft-cold-email"), false);
  assert.equal(generated.workflow.graph.edges.some((edge) => edge.sourceNodeId === "check-reply" && edge.sourceHandle === "not_replied" && edge.targetNodeId === "draft-second-followup"), true);
  assert.equal(generated.workflow.actions.filter((action) => action.type === "send_email").length, 2);
  assert.equal(generated.workflow.conditions.some((condition) => condition.type === "email_behavior"), true);
});

await run("workflow AI designer enforces record scope returned by record pages", async () => {
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, new Date().toISOString());
  const fetchImpl = async () => new Response(JSON.stringify({
    choices: [
      {
        message: {
          content: JSON.stringify({
            name: "Bad scope from model",
            goal: "只跟进林晓",
            trigger: { type: "crm_event", event: "record.updated", objectKey: "contacts" },
            graph: {
              scope: { mode: "object", objectKey: "contacts" },
              nodes: [
                { id: "start", type: "start", label: "Start", position: { x: 40, y: 160 }, config: { trigger: { type: "crm_event", event: "record.updated", objectKey: "contacts" } } },
                { id: "end", type: "end", label: "End", position: { x: 320, y: 160 }, config: {} }
              ],
              edges: [{ id: "edge-start-end", sourceNodeId: "start", sourceHandle: "main", targetNodeId: "end" }]
            }
          })
        }
      }
    ]
  }), { status: 200, headers: { "content-type": "application/json" } });

  const generated = await generateWorkflowWithAiDesigner(
    { goal: "只跟进林晓", objectKey: "contacts", recordId: "contact-lin", recordTitle: "林晓" },
    {
      settings,
      providerConfig: { provider: "openai", baseUrl: "https://ai.example/v1", apiKey: "test-key", model: "test-model", timeoutMs: 10000 },
      fetchImpl
    }
  );

  const start = generated.workflow.graph.nodes.find((node) => node.id === "start");
  assert.equal(generated.workflow.graph.scope.mode, "record");
  assert.equal(generated.workflow.graph.scope.recordId, "contact-lin");
  assert.equal(start?.config.trigger?.config?.targetRecordId, "contact-lin");
});

await run("workflow AI designer makes repeated email touches distinct", async () => {
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, new Date().toISOString());
  const repeatedBody = "Hi {{record.title}}, I wanted to follow up about automation. Would you like to talk?";
  const fetchImpl = async () => new Response(JSON.stringify({
    choices: [
      {
        message: {
          content: JSON.stringify({
            name: "Repeated email draft sequence",
            goal: "冷邮件联系直到客户回复为止",
            trigger: { type: "crm_event", event: "record.created", objectKey: "contacts" },
            graph: {
              scope: { mode: "object", objectKey: "contacts" },
              nodes: [
                { id: "start", type: "start", label: "Start", position: { x: 40, y: 160 }, config: { trigger: { type: "crm_event", event: "record.created", objectKey: "contacts" } } },
                { id: "email-1", type: "create_email_draft", label: "Email 1", position: { x: 320, y: 120 }, config: { subject: "Intro", bodyText: repeatedBody } },
                { id: "wait-1", type: "wait_reply", label: "Wait reply", position: { x: 600, y: 120 }, config: { lookbackDays: 3 } },
                { id: "email-2", type: "create_email_draft", label: "Email 2", position: { x: 880, y: 80 }, config: { subject: "Follow up", bodyText: repeatedBody } },
                { id: "end", type: "end", label: "End", position: { x: 1160, y: 120 }, config: {} }
              ],
              edges: [
                { id: "edge-start-email-1", sourceNodeId: "start", sourceHandle: "main", targetNodeId: "email-1" },
                { id: "edge-email-1-wait", sourceNodeId: "email-1", sourceHandle: "main", targetNodeId: "wait-1" },
                { id: "edge-wait-email-2", sourceNodeId: "wait-1", sourceHandle: "not_replied", targetNodeId: "email-2" },
                { id: "edge-wait-end", sourceNodeId: "wait-1", sourceHandle: "replied", targetNodeId: "end" },
                { id: "edge-email-2-end", sourceNodeId: "email-2", sourceHandle: "main", targetNodeId: "end" }
              ]
            }
          })
        }
      }
    ]
  }), { status: 200, headers: { "content-type": "application/json" } });

  const generated = await generateWorkflowWithAiDesigner(
    { goal: "冷邮件联系直到客户回复为止", objectKey: "contacts" },
    {
      settings,
      providerConfig: { provider: "openai", baseUrl: "https://ai.example/v1", apiKey: "test-key", model: "test-model", timeoutMs: 10000 },
      fetchImpl
    }
  );

  const emailOne = generated.workflow.graph.nodes.find((node) => node.id === "email-1");
  const emailTwo = generated.workflow.graph.nodes.find((node) => node.id === "email-2");
  assert.equal(emailOne?.config.touchIndex, 1);
  assert.equal(emailTwo?.config.touchIndex, 2);
  assert.equal(emailTwo?.config.previousTouchCount, 1);
  assert.notEqual(emailTwo?.config.bodyText, repeatedBody);
  assert.match(String(emailTwo?.config.bodyText), /do not repeat the earlier email/i);
  assert.match(String(emailTwo?.config.messageGoal), /different angle/i);
});

await run("workflow AI designer removes recipient identity from generated email subjects", async () => {
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, new Date().toISOString());
  const fetchImpl = async () => new Response(JSON.stringify({
    choices: [
      {
        message: {
          content: JSON.stringify({
            name: "Quote follow-up",
            goal: "7 天未回复的报价客户自动跟进",
            trigger: { type: "crm_event", event: "record.updated", objectKey: "contacts" },
            graph: {
              scope: { mode: "object", objectKey: "contacts" },
              nodes: [
                { id: "start", type: "start", label: "Start", position: { x: 40, y: 160 }, config: { trigger: { type: "crm_event", event: "record.updated", objectKey: "contacts" } } },
                { id: "email-1", type: "create_email_draft", label: "Email 1", position: { x: 320, y: 120 }, config: { subject: "Follow up {{record.title}}", bodyText: "您好 {{record.title}}，想跟进一下之前发送的报价方案。" } },
                { id: "end", type: "end", label: "End", position: { x: 620, y: 120 }, config: {} }
              ],
              edges: [
                { id: "edge-start-email-1", sourceNodeId: "start", sourceHandle: "main", targetNodeId: "email-1" },
                { id: "edge-email-1-end", sourceNodeId: "email-1", sourceHandle: "main", targetNodeId: "end" }
              ]
            }
          })
        }
      }
    ]
  }), { status: 200, headers: { "content-type": "application/json" } });

  const generated = await generateWorkflowWithAiDesigner(
    { goal: "7 天未回复的报价客户自动跟进", objectKey: "contacts" },
    {
      settings,
      providerConfig: { provider: "openai", baseUrl: "https://ai.example/v1", apiKey: "test-key", model: "test-model", timeoutMs: 10000 },
      fetchImpl
    }
  );

  const emailOne = generated.workflow.graph.nodes.find((node) => node.id === "email-1");
  assert.equal(emailOne?.config.subject, "关于报价方案的跟进");
  assert.doesNotMatch(String(emailOne?.config.subject), /\{\{record\.title\}\}/);
  assert.match(String(emailOne?.config.bodyText), /\{\{record\.title\}\}/);
});

await run("workflow AI designer collapses duplicate sequential wait delays", async () => {
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, new Date().toISOString());
  const fetchImpl = async () => new Response(JSON.stringify({
    choices: [
      {
        message: {
          content: JSON.stringify({
            name: "Quote no reply follow-up",
            goal: "7 天未回复的报价客户自动跟进",
            trigger: { type: "crm_event", event: "record.updated", objectKey: "contacts" },
            graph: {
              scope: { mode: "object", objectKey: "contacts" },
              nodes: [
                { id: "start", type: "start", label: "Start", position: { x: 40, y: 160 }, config: { trigger: { type: "crm_event", event: "record.updated", objectKey: "contacts" } } },
                { id: "wait-a", type: "wait_delay", label: "Wait 7 days", position: { x: 320, y: 160 }, config: { delayAmount: 7, delayUnit: "days" } },
                { id: "wait-b", type: "wait_delay", label: "Wait 7 days again", position: { x: 600, y: 160 }, config: { delayAmount: 7, delayUnit: "days" } },
                { id: "reply-check", type: "wait_reply", label: "Check reply", position: { x: 880, y: 160 }, config: { lookbackDays: 7 } },
                { id: "end", type: "end", label: "End", position: { x: 1160, y: 160 }, config: {} }
              ],
              edges: [
                { id: "edge-start-wait-a", sourceNodeId: "start", sourceHandle: "main", targetNodeId: "wait-a" },
                { id: "edge-wait-a-wait-b", sourceNodeId: "wait-a", sourceHandle: "after_delay", targetNodeId: "wait-b" },
                { id: "edge-wait-b-reply", sourceNodeId: "wait-b", sourceHandle: "after_delay", targetNodeId: "reply-check" },
                { id: "edge-reply-end", sourceNodeId: "reply-check", sourceHandle: "replied", targetNodeId: "end" }
              ]
            }
          })
        }
      }
    ]
  }), { status: 200, headers: { "content-type": "application/json" } });

  const generated = await generateWorkflowWithAiDesigner(
    { goal: "7 天未回复的报价客户自动跟进", objectKey: "contacts" },
    {
      settings,
      providerConfig: { provider: "openai", baseUrl: "https://ai.example/v1", apiKey: "test-key", model: "test-model", timeoutMs: 10000 },
      fetchImpl
    }
  );

  assert.equal(generated.workflow.graph.nodes.filter((node) => node.type === "wait_delay").length, 1);
  assert(!generated.workflow.graph.nodes.some((node) => node.id === "wait-b"));
  assert(generated.workflow.graph.edges.some((edge) => edge.sourceNodeId === "wait-a" && edge.targetNodeId === "reply-check"));
});

await run("Prisma workflow generation uses the Workflow Designer Agent provider", () => {
  const repositorySource = readFileSync("src/lib/crm/repository.ts", "utf8");
  assert.match(repositorySource, /generateWorkflowWithAiDesigner/);
  assert.match(repositorySource, /ensureEmailAiSettings\(context\.workspaceId\)/);
  assert.match(repositorySource, /getEmailAiProviderConfigForWorkspace\(context\.workspaceId\)/);
});

await run("workflow graph conversion fills blank action labels before save", () => {
  const graph = legacyWorkflowToGraph({
    trigger: { type: "crm_event", event: "record.updated", objectKey: "contacts" },
    conditions: [],
    actions: []
  });
  const legacy = graphToLegacyWorkflow({
    ...graph,
    nodes: [
      { id: "start", type: "start", label: "Start", position: { x: 40, y: 160 }, config: {} },
      {
        id: "action:create-follow-up-task",
        type: "create_task",
        label: "   ",
        position: { x: 320, y: 160 },
        config: {
          action: {
            key: "create-follow-up-task",
            type: "create_activity",
            name: "   ",
            requiresApproval: false,
            config: { activityType: "task", title: "   ", body: "   ", dueInDays: 2 }
          }
        }
      },
      { id: "end", type: "end", label: "End", position: { x: 620, y: 160 }, config: {} }
    ],
    edges: [
      { id: "edge:start:main:task", sourceNodeId: "start", sourceHandle: "main", targetNodeId: "action:create-follow-up-task" },
      { id: "edge:task:main:end", sourceNodeId: "action:create-follow-up-task", sourceHandle: "main", targetNodeId: "end" }
    ]
  });

  assert.equal(legacy.actions[0].name, "Create Task");
  assert.equal(legacy.actions[0].config.title, "Create Task");
  workflowCreateSchema.parse({
    name: "Workflow",
    goal: "Save draft",
    status: "draft",
    ...legacy,
    graph
  });
});

await run("workflow creates low-risk follow-up activity and is idempotent", () => {
  const store = new CrmStore(seedData);
  const context = store.getContext();
  const contact = store.listRecords(context, "contacts")[0];
  const workflow = store.createWorkflow(context, {
    name: "Follow up on contact update",
    goal: "Create a task when a contact is updated",
    status: "active",
    trigger: { type: "crm_event", event: "record.updated", objectKey: "contacts" },
    conditions: [],
    actions: [{ key: "create-task", type: "create_activity", name: "Create task", config: { activityType: "task", title: "Workflow task for {{record.title}}" } }]
  });
  const eventData = { objectKey: "contacts", recordId: contact.id, title: contact.title, updatedAt: "2026-06-30T00:00:00.000Z" };
  const firstRuns = store.runWorkflowsForEvent(context, "record.updated", eventData);
  const secondRuns = store.runWorkflowsForEvent(context, "record.updated", eventData);
  assert.equal(firstRuns.length, 1);
  assert.equal(secondRuns.length, 1);
  assert.equal(store.listWorkflowRuns(context, workflow.id).length, 1);
  assert(store.listActivities(context, contact.id).some((activity) => activity.title.includes("Workflow task")));
});

await run("workflow test runs always persist unique idempotency keys", () => {
  const store = new CrmStore(seedData);
  const context = store.getContext();
  const contact = store.listRecords(context, "contacts")[0];
  const workflow = store.createWorkflow(context, {
    name: "Testable follow up",
    goal: "Allow repeated manual tests",
    status: "draft",
    trigger: { type: "manual", event: "manual.run", objectKey: "contacts" },
    conditions: [],
    actions: [{ key: "create-task", type: "create_activity", name: "Create task", config: { activityType: "task", title: "Test task" } }]
  });
  const firstRun = store.testWorkflow(context, workflow.id, { objectKey: "contacts", recordId: contact.id, title: contact.title });
  const secondRun = store.testWorkflow(context, workflow.id, { objectKey: "contacts", recordId: contact.id, title: contact.title });
  assert.match(firstRun.idempotencyKey ?? "", /^.+:manual\.run:test:/);
  assert.match(secondRun.idempotencyKey ?? "", /^.+:manual\.run:test:/);
  assert.notEqual(firstRun.idempotencyKey, secondRun.idempotencyKey);
  assert.equal(store.listWorkflowRuns(context, workflow.id).length, 2);
});

await run("workflow graph routes branches and records node results", () => {
  const store = new CrmStore(seedData);
  const context = store.getContext();
  const contact = store.listRecords(context, "contacts")[0];
  const otherContact = store.listRecords(context, "contacts").find((record) => record.id !== contact.id);
  const workflow = store.createWorkflow(context, {
    name: "Graph scoped follow up",
    goal: "Only run for one contact",
    status: "active",
    trigger: { type: "crm_event", event: "record.updated", objectKey: "contacts" },
    conditions: [],
    actions: [],
    graph: {
      scope: { mode: "record", objectKey: "contacts", recordId: contact.id, recordTitle: contact.title },
      nodes: [
        { id: "start", type: "start", label: `Start: ${contact.title}`, position: { x: 0, y: 0 }, config: { trigger: { type: "crm_event", event: "record.updated", objectKey: "contacts" } } },
        { id: "if-target", type: "if", label: "IF target", position: { x: 240, y: 0 }, config: { field: "recordId", operator: "equals", value: contact.id } },
        { id: "switch-stage", type: "switch", label: "Switch stage", position: { x: 480, y: 0 }, config: { field: "stageKey", cases: ["qualified"] } },
        { id: "task", type: "create_task", label: "Graph task", position: { x: 720, y: 0 }, config: { activityType: "task", title: "Graph task for {{record.title}}" } },
        { id: "end", type: "end", label: "End", position: { x: 960, y: 0 }, config: {} }
      ],
      edges: [
        { id: "edge-start-if", sourceNodeId: "start", sourceHandle: "main", targetNodeId: "if-target" },
        { id: "edge-if-switch", sourceNodeId: "if-target", sourceHandle: "true", targetNodeId: "switch-stage" },
        { id: "edge-if-end", sourceNodeId: "if-target", sourceHandle: "false", targetNodeId: "end" },
        { id: "edge-switch-task", sourceNodeId: "switch-stage", sourceHandle: "case:qualified", targetNodeId: "task" },
        { id: "edge-switch-end", sourceNodeId: "switch-stage", sourceHandle: "default", targetNodeId: "end" },
        { id: "edge-task-end", sourceNodeId: "task", sourceHandle: "main", targetNodeId: "end" }
      ]
    }
  });
  const [run] = store.runWorkflowsForEvent(context, "record.updated", { objectKey: "contacts", recordId: contact.id, stageKey: "qualified", title: contact.title, updatedAt: "2026-06-30T00:02:00.000Z" });
  assert.equal(run.workflowId, workflow.id);
  assert.equal(run.nodeResults.some((result) => result.nodeId === "if-target" && result.outputHandle === "true"), true);
  assert.equal(run.nodeResults.some((result) => result.nodeId === "switch-stage" && result.outputHandle === "case:qualified"), true);
  assert.equal(run.actionResults[0].status, "completed");
  assert(store.listActivities(context, contact.id).some((activity) => activity.title.includes("Graph task")));
  if (otherContact) {
    const otherRuns = store.runWorkflowsForEvent(context, "record.updated", { objectKey: "contacts", recordId: otherContact.id, stageKey: "qualified", updatedAt: "2026-06-30T00:03:00.000Z" });
    assert.equal(otherRuns.length, 0);
  }
});

await run("workflow high-risk email action requires approval", () => {
  const store = new CrmStore(seedData);
  const context = store.getContext();
  const contact = store.listRecords(context, "contacts")[0];
  store.createWorkflow(context, {
    name: "Draft email approval",
    goal: "Draft a follow-up email after contact update",
    status: "active",
    trigger: { type: "crm_event", event: "record.updated", objectKey: "contacts" },
    conditions: [],
    actions: [{ key: "draft-email", type: "send_email", name: "Draft email", config: { mode: "draft", subject: "Follow up" } }]
  });
  const [run] = store.runWorkflowsForEvent(context, "record.updated", { objectKey: "contacts", recordId: contact.id, updatedAt: "2026-06-30T00:01:00.000Z" });
  assert.equal(run.status, "approval_required");
  const approvals = store.listWorkflowApprovals(context);
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].status, "pending");
});

await run("session tokens are random and stored as one-way hashes", () => {
  const tokenA = createSessionToken();
  const tokenB = createSessionToken();
  const hashA = hashSessionToken(tokenA);

  assert.notEqual(tokenA, tokenB);
  assert.notEqual(hashA, tokenA);
  assert.equal(hashA, hashSessionToken(tokenA));
  assert.match(hashA, /^[0-9a-f]{64}$/);
});

await run("api key tokens are random hashed and bearer parseable", () => {
  const tokenA = createApiKeyToken();
  const tokenB = createApiKeyToken();
  const hashA = hashApiKeyToken(tokenA);

  assert.match(tokenA, /^crm_live_/);
  assert.notEqual(tokenA, tokenB);
  assert.notEqual(hashA, tokenA);
  assert.equal(hashA, hashApiKeyToken(tokenA));
  assert.match(hashA, /^[0-9a-f]{64}$/);
  assert.equal(getApiKeyTokenPrefix(tokenA), tokenA.slice(0, 18));
  assert.equal(getBearerToken(`Bearer ${tokenA}`), tokenA);
  assert.equal(getBearerToken("Basic abc"), undefined);
});

await run("webhook secrets sign payloads with timestamped hmac headers", () => {
  const secret = createWebhookSecret();
  const payload = JSON.stringify({ event: "webhook.test" });
  const signature = signWebhookPayload(secret, payload, 123);
  const header = buildWebhookSignatureHeader(secret, payload, 123);

  assert.match(secret, /^whsec_/);
  assert.match(signature, /^[0-9a-f]{64}$/);
  assert.equal(header, `t=123,v1=${signature}`);
  assert.deepEqual(assertValidWebhookEvents(["webhook.test", "record.created", "webhook.test"]), ["webhook.test", "record.created"]);
  assert.deepEqual(assertValidWebhookEvents(["record.contacts.updated", "email.message.created"]), ["record.contacts.updated", "email.message.created"]);
  assert.deepEqual(assertValidWebhookEvents(["email.message.received", "email.message.queued", "email.message.sent", "email.message.failed"]), ["email.message.received", "email.message.queued", "email.message.sent", "email.message.failed"]);
  assert.equal(isValidWebhookEvent("record.companies.deleted"), true);
  assert.equal(isValidWebhookEvent("email.message.sent"), true);
  assert.deepEqual(expandWebhookEventsForPayload("record.updated", { objectKey: "contacts" }), ["record.updated", "record.contacts.updated"]);
  assert.throws(() => assertValidWebhookEvents(["bad.event"]), /unsupported events/);
  assert.equal(assertValidWebhookUrl("https://example.com/hook", { NODE_ENV: "production" }), "https://example.com/hook");
  assert.equal(assertValidWebhookUrl("http://127.0.0.1:9/hook", { NODE_ENV: "development" }), "http://127.0.0.1:9/hook");
  assert.equal(assertValidWebhookUrl("http://10.0.0.5/hook", { NODE_ENV: "production", ALLOW_PRIVATE_WEBHOOK_URLS: "true" }), "http://10.0.0.5/hook");
  assert.throws(() => assertValidWebhookUrl("http://example.com/hook", { NODE_ENV: "development" }), /HTTPS/);
  assert.throws(() => assertValidWebhookUrl("https://127.0.0.1/hook", { NODE_ENV: "production" }), /private network/);
  assert.throws(() => assertValidWebhookUrl("https://localhost/hook", { NODE_ENV: "production" }), /private network/);
  assert.throws(() => assertValidWebhookUrl("https://metadata/hook", { NODE_ENV: "production" }), /private network/);
  assert.throws(() => assertValidWebhookUrl("https://user:pass@example.com/hook", { NODE_ENV: "production" }), /credentials/);
});

await run("webhook delivery target validation blocks DNS rebinding to private addresses", async () => {
  await assertWebhookDeliveryTarget("https://hooks.example.com/crm", {
    env: { NODE_ENV: "production" },
    resolver: async () => [{ address: "203.0.113.10", family: 4 }]
  });

  await assert.rejects(
    () =>
      assertWebhookDeliveryTarget("https://hooks.example.com/crm", {
        env: { NODE_ENV: "production" },
        resolver: async () => [{ address: "10.0.0.5", family: 4 }]
      }),
    /private network/
  );

  await assert.rejects(
    () =>
      assertWebhookDeliveryTarget("https://hooks.example.com/crm", {
        env: { NODE_ENV: "production" },
        resolver: async () => [{ address: "127.0.0.1", family: 4 }]
      }),
    /private network/
  );

  await assertWebhookDeliveryTarget("https://hooks.example.com/crm", {
    env: { NODE_ENV: "production", ALLOW_PRIVATE_WEBHOOK_URLS: "true" },
    resolver: async () => [{ address: "10.0.0.5", family: 4 }]
  });
});

await run("password setup tokens are random one-way values with constrained purposes", () => {
  const tokenA = createPasswordSetupToken();
  const tokenB = createPasswordSetupToken();
  const hashA = hashPasswordSetupToken(tokenA);

  assert.notEqual(tokenA, tokenB);
  assert.notEqual(hashA, tokenA);
  assert.equal(hashA, hashPasswordSetupToken(tokenA));
  assert.match(hashA, /^[0-9a-f]{64}$/);
  assert.equal(normalizePasswordSetupPurpose("invite"), "invite");
  assert.equal(normalizePasswordSetupPurpose("anything-else"), "reset");
});

await run("login rate limit locks repeated failed attempts by email and ip", () => {
  const previousMax = process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS;
  const previousWindow = process.env.LOGIN_RATE_LIMIT_WINDOW_MS;
  const previousLock = process.env.LOGIN_RATE_LIMIT_LOCK_MS;
  process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS = "3";
  process.env.LOGIN_RATE_LIMIT_WINDOW_MS = "60000";
  process.env.LOGIN_RATE_LIMIT_LOCK_MS = "120000";
  resetLoginRateLimitsForTests();
  try {
    const identity = { email: "Admin@Example.com", ip: "10.0.0.1" };
    const otherIp = { email: "admin@example.com", ip: "10.0.0.2" };

    assert.equal(isLoginRateLimited(identity, 1000).limited, false);
    assert.equal(recordFailedLogin(identity, 1000).limited, false);
    assert.equal(recordFailedLogin(identity, 2000).limited, false);
    assert.equal(recordFailedLogin(identity, 3000).limited, true);
    assert.equal(isLoginRateLimited(identity, 4000).limited, true);
    assert.equal(isLoginRateLimited(otherIp, 4000).limited, false);

    clearFailedLogin(identity);
    assert.equal(isLoginRateLimited(identity, 5000).limited, false);
  } finally {
    resetLoginRateLimitsForTests();
    restoreEnv("LOGIN_RATE_LIMIT_MAX_ATTEMPTS", previousMax);
    restoreEnv("LOGIN_RATE_LIMIT_WINDOW_MS", previousWindow);
    restoreEnv("LOGIN_RATE_LIMIT_LOCK_MS", previousLock);
  }
});

await run("api helpers return structured invalid json and validation errors", async () => {
  await assert.rejects(
    () => parseJsonBody(new Request("http://local.test", { method: "POST", body: "{", headers: { "content-type": "application/json" } })),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "INVALID_JSON"
  );

  await assert.rejects(
    () =>
      parseJsonBody(
        new Request("http://local.test", {
          method: "POST",
          body: JSON.stringify({ email: "not-an-email" }),
          headers: { "content-type": "application/json" }
        }),
        z.object({ email: z.string().email() })
      ),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_ERROR"
  );

  const { status, payload } = toApiErrorPayload(new ApiError(403, "FORBIDDEN", "Missing permission: crm.admin"));
  assert.equal(status, 403);
  assert.equal(payload.code, "FORBIDDEN");
  assert.equal(payload.error, "Missing permission: crm.admin");
});

await run("api optional json helper preserves empty-body command compatibility", async () => {
  const schema = z.object({ limit: z.number().int().min(1).max(100).optional() }).strict();
  assert.deepEqual(
    await parseOptionalJsonBody(new Request("http://local.test", { method: "POST" }), schema, {}),
    {}
  );
  assert.deepEqual(
    await parseOptionalJsonBody(
      new Request("http://local.test", {
        method: "POST",
        body: JSON.stringify({ limit: 25 }),
        headers: { "content-type": "application/json" }
      }),
      schema,
      {}
    ),
    { limit: 25 }
  );
  await assert.rejects(
    () =>
      parseOptionalJsonBody(
        new Request("http://local.test", {
          method: "POST",
          body: JSON.stringify({ limit: 101 }),
          headers: { "content-type": "application/json" }
        }),
        schema,
        {}
      ),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_ERROR"
  );
});

await run("record approval schemas accept short Chinese reasons", async () => {
  assert.deepEqual(
    await parseOptionalJsonBody(
      new Request("http://local.test", {
        method: "DELETE",
        body: JSON.stringify({ changeReason: "重复" }),
        headers: { "content-type": "application/json" }
      }),
      recordDeleteRequestSchema,
      {}
    ),
    { changeReason: "重复" }
  );
  assert.equal(recordPatchWithReasonSchema.parse({ changeReason: "误删" }).changeReason, "误删");
});

await run("customer level schemas accept settings and approval changes", () => {
  const settings = customerLevelSettingsUpdateSchema.parse({
    enabled: true,
    levels: [
      { value: "A", label: "A 级客户", color: "#dc2626", position: 1, enabled: true, minScore: 85, maxScore: 100 },
      { value: "B", label: "B 级客户", color: "#ea580c", position: 2, enabled: true, minScore: 65, maxScore: 84 },
      { value: "C", label: "C 级客户", color: "#2563eb", position: 3, enabled: true, minScore: 40, maxScore: 64 },
      { value: "D", label: "D 级客户", color: "#64748b", position: 4, enabled: true, minScore: 0, maxScore: 39 }
    ],
    rules: {
      dealAmount: 24,
      dealStage: 18,
      recentActivity: 18,
      emailEngagement: 16,
      inactivity: 14,
      overdueTasks: 10
    }
  });
  assert.equal(settings.levels?.length, 4);
  assert.equal(customerLevelChangeRequestSchema.parse({ level: "A", changeReason: "重要客户" }).level, "A");
  assert.equal(customerLevelChangeRequestSchema.parse({ level: "", changeReason: "重新评级" }).level, "");
  assert.deepEqual(customerLevelSuggestionGenerateSchema.parse({ objectKey: "companies", recordId: "company-acme" }), {
    objectKey: "companies",
    recordId: "company-acme"
  });
  assert.throws(() => customerLevelSuggestionGenerateSchema.parse({ objectKey: "contacts", recordId: "contact-lin" }), /Invalid enum value|validation/i);
});

await run("contact and company details keep customer level explanations visible", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.match(source, /explanationRecord\?: CrmRecord/);
  assert.match(source, /const ratingBasisRecord = explanationRecord \?\? record/);
  assert.match(source, /ratingBasisRecord\.data\.customerLevelReasons/);
  assert.match(source, /data-testid="customer-level-definition"/);
  assert.match(source, /currentDefinition\.minScore[\s\S]*currentDefinition\.maxScore/);
  assert.match(source, /data-testid="customer-level-explanation"/);
  assert.match(source, /suggestedLevel === currentLevel \? "当前等级评分依据" : "最近建议依据"/);
  assert.match(source, /以下内容仅说明最近一次系统建议/);
  assert.match(source, /reasons\.slice\(0, 5\)/);
  assert.match(source, /explanationRecord=\{company\}/);
  assert.match(source, /关联公司暂无系统评分依据，请到公司详情刷新建议/);
  assert.match(source, /临时等级暂无系统评分依据；系统评分仅针对公司生成/);
  assert.match(styles, /\.customer-level-definition/);
  assert.match(styles, /\.customer-level-explanation/);
  assert.match(styles, /\.customer-level-explanation-meta/);
});

await run("pool settings schema accepts level rules and rejects invalid level rules", () => {
  const settings = poolSettingsUpdateSchema.parse({
    privateLimit: 100,
    autoReclaimDays: 30,
    levelRules: [
      { level: "A", enabled: true, privateLimit: 20, autoReclaimDays: 60 },
      { level: "unrated", enabled: true, privateLimit: 100, autoReclaimDays: 21 }
    ]
  });

  assert.equal(settings.levelRules?.[0]?.level, "A");
  assert.equal(settings.levelRules?.[1]?.level, "unrated");
  assert.throws(() => poolSettingsUpdateSchema.parse({ levelRules: [{ level: "VIP", enabled: true }] }), /Invalid enum value|validation/i);
  assert.throws(() => poolSettingsUpdateSchema.parse({ levelRules: [{ level: "A", privateLimit: 0 }] }), /too_small|greater than|validation/i);
  assert.throws(() => poolSettingsUpdateSchema.parse({ levelRules: [{ level: "B", autoReclaimDays: -1 }] }), /too_small|greater than|validation/i);
});

await run("seed includes customer level fields settings and default columns", () => {
  const customerLevelFields = seedData.fieldDefinitions.filter((field) => field.key.startsWith("customerLevel"));
  assert.equal(customerLevelFields.some((field) => field.objectKey === "contacts" && field.key === "customerLevel"), false);
  assert.ok(customerLevelFields.some((field) => field.objectKey === "companies" && field.key === "customerLevel"));
  assert.ok(seedData.fieldDefinitions.some((field) => field.objectKey === "contacts" && field.key === "contactTempCustomerLevel"));

  assert.equal(seedData.customerLevelSettings?.[0]?.workspaceId, defaultWorkspaceId);
  assert.deepEqual(
    seedData.customerLevelSettings?.[0]?.levels.map((level) => level.value),
    ["A", "B", "C", "D"]
  );

  const contactView = seedData.savedViews.find((view) => view.objectKey === "contacts" && view.isDefault);
  const companyView = seedData.savedViews.find((view) => view.objectKey === "companies" && view.isDefault);
  assert.ok(contactView?.columns.includes("contactTempCustomerLevel"));
  assert.equal(contactView?.columns.includes("customerLevel"), false);
  assert.ok(companyView?.columns.includes("customerLevel"));
});

await run("record approval patch splits empty-value additions from non-empty changes", () => {
  const record = {
    id: "record-1",
    workspaceId: "workspace-1",
    objectKey: "contacts",
    title: "Instagram",
    ownerId: "user-1",
    data: {
      address: "China",
      birthday: "",
      sameValue: "same",
      emptyList: [],
      tags: ["vip"],
      profile: { source: "expo" },
      preferences: { language: "en" }
    },
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z"
  };

  const { approvalPatch, immediatePatch, previousPatch } = splitRecordApprovalPatch(record, {
    title: "Instagram",
    ownerId: "user-1",
    data: {
      address: "Shenzhen, China",
      birthday: "2026-06-09",
      sameValue: "same",
      emptyList: ["new"],
      tags: ["vip", "priority"],
      profile: { source: "expo", region: "south" },
      preferences: { language: "zh" }
    }
  });

  assert.deepEqual(approvalPatch, { data: { address: "Shenzhen, China", preferences: { language: "zh" } } });
  assert.deepEqual(previousPatch, { data: { address: "China", preferences: { language: "en" } } });
  assert.deepEqual(immediatePatch, {
    data: {
      birthday: "2026-06-09",
      emptyList: ["new"],
      tags: ["vip", "priority"],
      profile: { source: "expo", region: "south" }
    }
  });
  assert.equal(hasRecordPatchChanges(approvalPatch), true);
  assert.equal(hasRecordPatchChanges({}), false);

  const patchWithMetadata = { ...approvalPatch, previous: previousPatch };
  assert.deepEqual(previousRecordApprovalPatch(patchWithMetadata), previousPatch);
  assert.deepEqual(stripRecordApprovalMetadata(patchWithMetadata), approvalPatch);
});

await run("record approval patch keeps tag additions and colors immediate but requires approval for deletions", () => {
  const record = {
    id: "record-1",
    workspaceId: "workspace-1",
    objectKey: "contacts",
    title: "Tagged",
    ownerId: "user-1",
    tags: ["vip", "north"],
    tagColors: { vip: "navy", north: "mint" },
    data: {},
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z"
  };

  const added = splitRecordApprovalPatch(record, {
    tags: ["vip", "north", "priority"],
    tagColors: { vip: "navy", north: "sky", priority: "amber" }
  });
  assert.deepEqual(added.approvalPatch, {});
  assert.deepEqual(added.previousPatch, {});
  assert.deepEqual(added.immediatePatch, {
    tags: ["vip", "north", "priority"],
    tagColors: { vip: "navy", north: "sky", priority: "amber" }
  });

  const removed = splitRecordApprovalPatch(record, {
    tags: ["vip"],
    tagColors: { vip: "navy" }
  });
  assert.deepEqual(removed.immediatePatch, {});
  assert.deepEqual(removed.approvalPatch, { tags: ["vip"], tagColors: { vip: "navy" } });
  assert.deepEqual(removed.previousPatch, { tags: ["vip", "north"], tagColors: { vip: "navy", north: "mint" } });
});

await run("record approval patch treats new contact methods as immediate additions", () => {
  const record = {
    id: "record-1",
    workspaceId: "workspace-1",
    objectKey: "contacts",
    title: "Instagram",
    data: {
      email: "no-reply@mail.instagram.com",
      phone: "",
      contactMethods: [{ id: "method-email", type: "email", value: "no-reply@mail.instagram.com", label: "Email", primary: true }]
    },
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z"
  };

  const nextMethods = [
    { id: "method-email", type: "email", value: "no-reply@mail.instagram.com", label: "Email", primary: true },
    { id: "method-whatsapp", type: "whatsapp", value: "85265426672", label: "WhatsApp", primary: false }
  ];
  assert.equal(isContactMethodsAdditionOnly(record.data.contactMethods, nextMethods), true);
  const nextMethodsWithNewPrimary = [
    { id: "method-email", type: "email", value: "no-reply@mail.instagram.com", label: "Email", primary: false },
    { id: "method-whatsapp", type: "whatsapp", value: "85265426672", label: "WhatsApp", primary: true }
  ];
  assert.equal(isContactMethodsAdditionOnly(record.data.contactMethods, nextMethodsWithNewPrimary), true);
  assert.deepEqual(splitRecordApprovalPatch(record, { data: { contactMethods: nextMethodsWithNewPrimary } }), {
    approvalPatch: {},
    previousPatch: {},
    immediatePatch: {
      data: {
        contactMethods: nextMethodsWithNewPrimary
      }
    }
  });
  const added = splitRecordApprovalPatch(record, {
    data: {
      contactMethods: nextMethods,
      email: "no-reply@mail.instagram.com",
      phone: "85265426672"
    }
  });

  assert.deepEqual(added.approvalPatch, {});
  assert.deepEqual(added.previousPatch, {});
  assert.deepEqual(added.immediatePatch, {
    data: {
      contactMethods: nextMethods,
      phone: "85265426672"
    }
  });

  const nextMethodsWithNewPrimaryEmail = [
    { id: "method-email", type: "email", value: "no-reply@mail.instagram.com", label: "Email", primary: false },
    { id: "method-alt-email", type: "email", value: "sales@example.com", label: "Work Email", primary: true }
  ];
  const addedPrimaryEmail = splitRecordApprovalPatch(record, {
    data: {
      contactMethods: nextMethodsWithNewPrimaryEmail,
      email: "sales@example.com"
    }
  });

  assert.deepEqual(addedPrimaryEmail.approvalPatch, {});
  assert.deepEqual(addedPrimaryEmail.previousPatch, {});
  assert.deepEqual(addedPrimaryEmail.immediatePatch, {
    data: {
      contactMethods: nextMethodsWithNewPrimaryEmail,
      email: "sales@example.com"
    }
  });

  const recordWithSecondaryEmail = {
    ...record,
    data: {
      ...record.data,
      contactMethods: [
        { id: "method-email", type: "email", value: "no-reply@mail.instagram.com", label: "Email", primary: true },
        { id: "method-alt-email", type: "email", value: "sales@example.com", label: "Work Email", primary: false }
      ]
    }
  };
  const switchedToExistingPrimary = [
    { id: "method-email", type: "email", value: "no-reply@mail.instagram.com", label: "Email", primary: false },
    { id: "method-alt-email", type: "email", value: "sales@example.com", label: "Work Email", primary: true },
    { id: "method-wechat", type: "wechat", value: "sales-wechat", label: "WeChat", primary: false }
  ];
  assert.equal(isContactMethodsAdditionOnly(recordWithSecondaryEmail.data.contactMethods, switchedToExistingPrimary), false);
  const switchedExisting = splitRecordApprovalPatch(recordWithSecondaryEmail, {
    data: {
      contactMethods: switchedToExistingPrimary,
      email: "sales@example.com"
    }
  });
  assert.deepEqual(switchedExisting.approvalPatch, {
    data: {
      contactMethods: switchedToExistingPrimary,
      email: "sales@example.com"
    }
  });

  const changedExisting = splitRecordApprovalPatch(record, {
    data: {
      contactMethods: [{ id: "method-email", type: "email", value: "sales@example.com", label: "Email", primary: true }],
      email: "sales@example.com"
    }
  });
  assert.deepEqual(changedExisting.approvalPatch, {
    data: {
      contactMethods: [{ id: "method-email", type: "email", value: "sales@example.com", label: "Email", primary: true }],
      email: "sales@example.com"
    }
  });
  assert.deepEqual(changedExisting.previousPatch, {
    data: {
      contactMethods: [{ id: "method-email", type: "email", value: "no-reply@mail.instagram.com", label: "Email", primary: true }],
      email: "no-reply@mail.instagram.com"
    }
  });
  assert.equal(isContactMethodsAdditionOnly(record.data.contactMethods, changedExisting.approvalPatch.data.contactMethods), false);

  const removedExisting = splitRecordApprovalPatch(record, {
    data: {
      contactMethods: [],
      email: ""
    }
  });
  assert.deepEqual(removedExisting.approvalPatch, {
    data: {
      contactMethods: [],
      email: ""
    }
  });
  assert.deepEqual(removedExisting.previousPatch, {
    data: {
      contactMethods: [{ id: "method-email", type: "email", value: "no-reply@mail.instagram.com", label: "Email", primary: true }],
      email: "no-reply@mail.instagram.com"
    }
  });
});

await run("api json helper rejects oversized request bodies", async () => {
  await assert.rejects(
    () =>
      parseJsonBody(
        new Request("http://local.test", {
          method: "POST",
          body: JSON.stringify({ value: "too large" }),
          headers: { "content-type": "application/json", "content-length": "100" }
        }),
        z.object({ value: z.string() }),
        { maxBytes: 10 }
      ),
    (error) => error instanceof ApiError && error.status === 413 && error.code === "PAYLOAD_TOO_LARGE"
  );

  await assert.rejects(
    () =>
      parseJsonBody(
        new Request("http://local.test", {
          method: "POST",
          body: JSON.stringify({ value: "abcdef" }),
          headers: { "content-type": "application/json" }
        }),
        z.object({ value: z.string() }),
        { maxBytes: 5 }
      ),
    (error) => error instanceof ApiError && error.status === 413 && error.code === "PAYLOAD_TOO_LARGE"
  );
});

await run("api form helper rejects non-form request bodies", async () => {
  const form = await parseFormBody(
    new Request("http://local.test", {
      method: "POST",
      body: new URLSearchParams({ email: "admin@example.com", password: "Admin123!" })
    })
  );

  assert.equal(form.get("email"), "admin@example.com");
  await assert.rejects(
    () =>
      parseFormBody(
        new Request("http://local.test", {
          method: "POST",
          body: JSON.stringify({ email: "admin@example.com" }),
          headers: { "content-type": "application/json" }
        })
      ),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "BAD_REQUEST"
  );
});

await run("api form helper rejects oversized urlencoded bodies without content length", async () => {
  await assert.rejects(
    () =>
      parseFormBody(
        new Request("http://local.test", {
          method: "POST",
          body: new URLSearchParams({ token: "abc", password: "x".repeat(20) }),
          headers: { "content-type": "application/x-www-form-urlencoded" }
        }),
        { maxBytes: 10 }
      ),
    (error) => error instanceof ApiError && error.status === 413 && error.code === "PAYLOAD_TOO_LARGE"
  );
});

await run("crm api schemas cap oversized import and view payloads", () => {
  assert.equal(
    csvImportSchema.safeParse({
      objectKey: "contacts",
      csv: "x".repeat(MAX_CSV_IMPORT_CHARS + 1)
    }).success,
    false
  );

  const oversizedMapping = Object.fromEntries(Array.from({ length: MAX_IMPORT_MAPPING_FIELDS + 1 }, (_, index) => [`Column ${index}`, `field_${index}`]));
  assert.equal(
    importPresetCreateSchema.safeParse({
      objectKey: "contacts",
      name: "Oversized Mapping",
      mapping: oversizedMapping
    }).success,
    false
  );

  assert.equal(
    savedViewCreateSchema.safeParse({
      objectKey: "contacts",
      name: "Oversized View",
      columns: Array.from({ length: MAX_SAVED_VIEW_COLUMNS + 1 }, (_, index) => `field_${index}`),
      isDefault: false
    }).success,
    false
  );

  assert.equal(
    savedViewCreateSchema.safeParse({
      objectKey: "contacts",
      name: "Oversized Filters",
      columns: ["title"],
      filters: Array.from({ length: MAX_SAVED_VIEW_FILTERS + 1 }, (_, index) => ({ field: `field_${index}`, operator: "contains", value: "x" })),
      isDefault: false
    }).success,
    false
  );
});

await run("api error audit credentials prefer bearer tokens over session cookies", () => {
  const credential = getApiErrorAuditCredential(
    new Request("http://local.test/api/records/contacts", {
      headers: {
        authorization: "Bearer crm_live_test_token",
        cookie: "crm_session=session-token"
      }
    })
  );

  assert.deepEqual(credential, { type: "api_key", token: "crm_live_test_token" });
});

await run("api error audit credentials allow test user header only when enabled", () => {
  const previous = process.env.ALLOW_TEST_USER_HEADER;
  try {
    delete process.env.ALLOW_TEST_USER_HEADER;
    assert.equal(
      getApiErrorAuditCredential(new Request("http://local.test/api/records/contacts", { headers: { "x-user-id": "user-admin" } })),
      undefined
    );

    process.env.ALLOW_TEST_USER_HEADER = "true";
    assert.deepEqual(
      getApiErrorAuditCredential(new Request("http://local.test/api/records/contacts", { headers: { "x-user-id": "user-admin" } })),
      { type: "test_user", userId: "user-admin" }
    );
  } finally {
    restoreEnv("ALLOW_TEST_USER_HEADER", previous);
  }
});

await run("api error audit credentials fall back to session cookie", () => {
  assert.deepEqual(
    getApiErrorAuditCredential(new Request("http://local.test/api/records/contacts", { headers: { cookie: "theme=dark; crm_session=session-token" } })),
    { type: "session", token: "session-token" }
  );
});

await run("app base url ignores untrusted origin headers and supports configured public url", () => {
  const previous = process.env.APP_BASE_URL;
  try {
    delete process.env.APP_BASE_URL;
    assert.equal(getAppBaseUrl("http://internal.local/api/auth/login"), "http://internal.local");
    assert.equal(String(appUrl("/login?error=invalid", "http://internal.local/api/auth/login")), "http://internal.local/login?error=invalid");
    assert.equal(
      getAppBaseUrl(new Request("http://localhost:3014/api/auth/login", { headers: { origin: "http://127.0.0.1:3014" } })),
      "http://127.0.0.1:3014"
    );
    assert.equal(
      getAppBaseUrl(new Request("https://crm.example.com/api/auth/login", { headers: { origin: "https://evil.example" } })),
      "https://crm.example.com"
    );

    process.env.APP_BASE_URL = "https://crm.example.com/app";
    assert.equal(getAppBaseUrl("http://internal.local/api/auth/login"), "https://crm.example.com");
    assert.equal(String(appUrl("/setup-password?token=abc", "http://internal.local/api/users/user-1/password-link")), "https://crm.example.com/setup-password?token=abc");
  } finally {
    restoreEnv("APP_BASE_URL", previous);
  }
});

await run("security headers include framing referrer permissions and production hsts", () => {
  const developmentHeaders = new Headers();
  applySecurityHeaders(developmentHeaders, { NODE_ENV: "development", APP_BASE_URL: "https://crm.example.com" });
  assert.equal(developmentHeaders.get("X-Content-Type-Options"), "nosniff");
  assert.equal(developmentHeaders.get("X-Frame-Options"), "DENY");
  assert.equal(developmentHeaders.get("Referrer-Policy"), "same-origin");
  assert.match(developmentHeaders.get("Permissions-Policy") ?? "", /camera=\(\)/);
  assert.match(developmentHeaders.get("Content-Security-Policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(developmentHeaders.get("Strict-Transport-Security"), null);

  const productionHeaders = buildSecurityHeaders({ NODE_ENV: "production", APP_BASE_URL: "https://crm.example.com" });
  assert.deepEqual(
    productionHeaders.find(([name]) => name === "Strict-Transport-Security"),
    ["Strict-Transport-Security", "max-age=31536000; includeSubDomains"]
  );
  assert.equal(buildSecurityHeaders({ NODE_ENV: "production", APP_BASE_URL: "http://127.0.0.1:3000" }).some(([name]) => name === "Strict-Transport-Security"), false);
});

await run("cross-site mutation guard blocks browser-origin writes without blocking server calls", () => {
  const previous = process.env.APP_BASE_URL;
  try {
    delete process.env.APP_BASE_URL;
    assert.equal(
      shouldBlockCrossSiteMutation({
        method: "POST",
        url: "http://localhost:3014/api/records/contacts",
        origin: "http://127.0.0.1:3014"
      }),
      false
    );
    assert.equal(
      shouldBlockCrossSiteMutation({
        method: "POST",
        url: "https://crm.example.com/api/records/contacts",
        origin: "https://evil.example"
      }),
      true
    );
    assert.equal(
      shouldBlockCrossSiteMutation({
        method: "GET",
        url: "https://crm.example.com/api/records/contacts",
        origin: "https://evil.example"
      }),
      false
    );
    assert.equal(
      shouldBlockCrossSiteMutation({
        method: "PATCH",
        url: "https://crm.example.com/api/records/contacts/1"
      }),
      false
    );
    assert.equal(
      shouldBlockCrossSiteMutation({
        method: "DELETE",
        url: "https://crm.example.com/api/records/contacts/1",
        secFetchSite: "cross-site"
      }),
      true
    );

    process.env.APP_BASE_URL = "https://crm.example.com";
    assert.equal(
      shouldBlockCrossSiteMutation({
        method: "POST",
        url: "http://internal:3000/api/records/contacts",
        origin: "https://crm.example.com"
      }),
      false
    );
  } finally {
    restoreEnv("APP_BASE_URL", previous);
  }
});

await run("record list query accepts search alias and q precedence", () => {
  const aliasQuery = parseRecordListQuery({
    nextUrl: new URL("http://local.test/api/records/contacts?search=Acme&page=2&pageSize=25")
  });
  assert.equal(aliasQuery.q, "Acme");
  assert.equal(aliasQuery.page, 2);
  assert.equal(aliasQuery.pageSize, 25);

  const explicitQuery = parseRecordListQuery({
    nextUrl: new URL("http://local.test/api/records/contacts?q=Primary&search=Fallback")
  });
  assert.equal(explicitQuery.q, "Primary");
});

await run("list query pagination accepts only positive integers and caps page size", () => {
  const invalidRecordQuery = parseRecordListQuery({
    nextUrl: new URL("http://local.test/api/records/contacts?page=-2&pageSize=2.5")
  });
  assert.equal(invalidRecordQuery.page, undefined);
  assert.equal(invalidRecordQuery.pageSize, undefined);

  const cappedRecordQuery = parseRecordListQuery({
    nextUrl: new URL("http://local.test/api/records/contacts?page=3&pageSize=9999")
  });
  assert.equal(cappedRecordQuery.page, 3);
  assert.equal(cappedRecordQuery.pageSize, 200);

  const cappedAuditQuery = parseAuditLogQuery({
    nextUrl: new URL("http://local.test/api/audit-logs?page=4&pageSize=9999")
  });
  assert.equal(cappedAuditQuery.page, 4);
  assert.equal(cappedAuditQuery.pageSize, 200);
});

await run("record list query parses keyset cursor and projected fields", () => {
  const query = parseRecordListQuery({
    nextUrl: new URL("http://local.test/api/records/contacts?keyset=1&cursor=abc123&fields=title,email,phone,bad-field,%20&pageSize=25")
  });

  assert.equal(query.keyset, true);
  assert.equal(query.cursor, "abc123");
  assert.deepEqual(query.fields, ["title", "email", "phone"]);
  assert.equal(query.pageSize, 25);
});

await run("audit action labels are readable Chinese text", () => {
  assert.equal(formatAuditAction("create"), "创建");
  assert.equal(formatAuditAction("update"), "更新");
  assert.equal(formatAuditAction("delete"), "删除");
  assert.equal(formatAuditAction("import"), "导入");
  assert.equal(formatAuditAction("api_error"), "API 错误");
  for (const action of ["create", "update", "delete", "import", "api_error"]) {
    assert.doesNotMatch(formatAuditAction(action), /\?\?|閿泑閵唡\uFFFD/);
  }
});

await run("csv builder escapes commas quotes newlines and object values", () => {
  const csv = buildCsv(["name", "note", "meta"], [{ name: "Acme, Inc.", note: "He said \"yes\"\nsoon", meta: { tier: "gold" } }]);

  assert.equal(csv, 'name,note,meta\r\n"Acme, Inc.","He said ""yes""\nsoon","{""tier"":""gold""}"');
});

await run("backup file listing includes only backup artifacts", async () => {
  const directory = join(tmpdir(), `ai-agent-crm-backups-${Date.now()}`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(join(directory, "latest.dump"), "dump");
    await writeFile(join(directory, "manual.sql"), "select 1;");
    await writeFile(join(directory, "notes.txt"), "ignore");

    const backups = await listBackupFiles(directory);

    assert.deepEqual(
      backups.map((backup) => backup.name).sort(),
      ["latest.dump", "manual.sql"]
    );
    assert.equal(backups.every((backup) => backup.sizeBytes > 0), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await run("backup file access is constrained to named backup artifacts", async () => {
  const directory = join(tmpdir(), `ai-agent-crm-backup-access-${Date.now()}`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(join(directory, "latest.dump"), "dump");

    const backup = await getBackupFile("latest.dump", directory);

    assert.equal(backup?.name, "latest.dump");
    assert.equal(resolveBackupFilePath("latest.dump", directory), join(directory, "latest.dump"));
    assert.throws(() => resolveBackupFilePath("../latest.dump", directory), /Invalid backup file name/);
    assert.throws(() => resolveBackupFilePath("latest.txt", directory), /Invalid backup file name/);
    assert.equal(await getBackupFile("missing.dump", directory), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await run("database backup dry run can use direct pg_dump with DATABASE_URL", () => {
  const output = join(tmpdir(), `ai-agent-crm-dry-backup-${Date.now()}.dump`);
  const databaseUrl = "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public";
  const result = spawnSync(process.execPath, ["scripts/db-backup.mjs", "--dry-run", "--mode=direct", "--output", output], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: databaseUrl }
  });

  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.output, output);
  assert.equal(plan.mode, "direct");
  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.candidates[0].kind, "direct");
  assert.equal(plan.candidates[0].command, "pg_dump");
  assert.deepEqual(plan.candidates[0].args, ["--format=custom", "--no-owner", "--no-acl", databaseUrl]);
});

await run("database restore dry run can use direct pg_restore with DATABASE_URL", async () => {
  const directory = join(tmpdir(), `ai-agent-crm-dry-restore-${Date.now()}`);
  const input = join(directory, "restore.dump");
  const databaseUrl = "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public";

  await mkdir(directory, { recursive: true });
  await writeFile(input, "not a real dump", "utf8");
  try {
    const result = spawnSync(process.execPath, ["scripts/db-restore.mjs", input, "--dry-run", "--mode=direct"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: databaseUrl }
    });

    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.input, input);
    assert.equal(plan.mode, "direct");
    assert.equal(plan.candidates.length, 1);
    assert.equal(plan.candidates[0].kind, "direct");
    assert.equal(plan.candidates[0].command, "pg_restore");
    assert.deepEqual(plan.candidates[0].args, ["--dbname", databaseUrl, "--clean", "--if-exists", "--no-owner", "--no-acl", input]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await run("deployment verification dry run describes docker health and backup checks", () => {
  const healthUrl = "http://127.0.0.1:3999/api/health";
  const backupOutput = "/app/backups/deploy-verify-test.dump";
  const result = spawnSync(
    process.execPath,
    ["scripts/deploy-verify.mjs", "--dry-run", "--skip-build", "--skip-up", "--health-url", healthUrl, "--backup-output", backupOutput],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.healthUrl, healthUrl);
  assert.equal(plan.backupOutput, backupOutput);
  assert.deepEqual(
    plan.steps.map((step) => step.name),
    [
      "Check Docker Compose",
      "Validate Docker Compose config",
      "Check application health",
      "Validate web container environment",
      "Verify PostgreSQL client inside web container",
      "Verify container backup plan",
      "Validate email subsystem diagnostics"
    ]
  );
  assert.equal(plan.steps.find((step) => step.name === "Check application health")?.url, healthUrl);
  assert.deepEqual(plan.steps.find((step) => step.name === "Validate web container environment")?.args, [
    "compose",
    "exec",
    "-T",
    "web",
    "node",
    "scripts/validate-env.mjs"
  ]);
  assert.deepEqual(plan.steps.find((step) => step.name === "Verify PostgreSQL client inside web container")?.args, [
    "compose",
    "exec",
    "-T",
    "web",
    "pg_dump",
    "--version"
  ]);
  assert.deepEqual(plan.steps.find((step) => step.name === "Verify container backup plan")?.args, [
    "compose",
    "exec",
    "-T",
    "web",
    "node",
    "scripts/db-backup.mjs",
    "--dry-run",
    "--mode=direct",
    "--output",
    backupOutput
  ]);
  assert.deepEqual(plan.steps.find((step) => step.name === "Validate email subsystem diagnostics")?.args, [
    "compose",
    "exec",
    "-T",
    "web",
    "node",
    "--experimental-strip-types",
    "--import",
    "./scripts/register-alias.mjs",
    "scripts/email-verify.ts"
  ]);
});

await run("activity update schema accepts task archive state", () => {
  assert.equal(activityUpdateSchema.parse({ archivedAt: "2026-06-23T10:00:00.000Z" }).archivedAt, "2026-06-23T10:00:00.000Z");
  assert.equal(activityUpdateSchema.parse({ archivedAt: null }).archivedAt, null);
  assert.throws(() => activityUpdateSchema.parse({ archivedAt: "" }), z.ZodError);
});

await run("crm tag schemas normalize validate and dedupe values", () => {
  assert.deepEqual(recordWriteSchema.parse({ title: "Tagged", data: {}, tags: [" VIP ", "vip", "重点"] }).tags, ["vip", "重点"]);
  assert.deepEqual(recordWriteSchema.parse({ title: "Tagged", data: {}, tags: ["vip"], tagColors: { vip: "cyan" } }).tagColors, { vip: "cyan" });
  assert.deepEqual(recordWriteSchema.parse({ title: "Tagged", data: {}, tags: ["vip"], tagColors: { vip: "navy" } }).tagColors, { vip: "navy" });
  assert.deepEqual(activityCreateSchema.parse({ type: "task", title: "Tagged task", tags: [" Follow-Up ", "follow-up"] }).tags, ["follow-up"]);
  assert.deepEqual(activityCreateSchema.parse({ type: "task", title: "Tagged task", tags: ["follow-up"], tagColors: { "follow-up": "amber" } }).tagColors, { "follow-up": "amber" });
  assert.throws(() => recordWriteSchema.parse({ title: "Too long", data: {}, tags: ["x".repeat(41)] }), z.ZodError);
  assert.throws(() => recordWriteSchema.parse({ title: "Bad color", data: {}, tags: ["vip"], tagColors: { vip: "not-a-color" } }), z.ZodError);
  assert.throws(() => recordWriteSchema.parse({ title: "Robin is not a color", data: {}, tags: ["vip"], tagColors: { vip: "robin" } }), z.ZodError);
  assert.throws(
    () => recordWriteSchema.parse({ title: "Too many", data: {}, tags: Array.from({ length: 51 }, (_, index) => `tag-${index}`) }),
    z.ZodError
  );
});

await run("next production build defaults to standard output with guarded artifact checks", () => {
  const config = readFileSync("next.config.mjs", "utf8");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const entrypoint = readFileSync("scripts/docker-entrypoint.sh", "utf8");
  const e2eStart = readFileSync("scripts/e2e-next-start.mjs", "utf8");
  const buildNext = readFileSync("scripts/build-next.mjs", "utf8");
  assert.match(config, /NEXT_OUTPUT === "standalone"/);
  for (const pattern of [
    ".agents/**/*",
    ".codex/**/*",
    ".vs/**/*",
    ".next-*/**/*",
    ".postgres-data/**/*",
    "resources/**/*",
    "test-results/**/*",
    ".tmp-*.log",
    "dev-*.log",
    "*.log"
  ]) {
    assert.equal(config.includes(`\"${pattern}\"`), true, `${pattern} should stay excluded from standalone tracing`);
  }
  assert.equal(packageJson.scripts.build, "node scripts/build-next.mjs");
  assert.equal(packageJson.scripts["build:artifacts"], "node scripts/check-build-artifacts.mjs");
  assert.match(packageJson.scripts.verify, /npm run build:artifacts/);
  assert.match(buildNext, /checkBuildArtifacts/);
  assert.match(buildNext, /NEXT_BUILD_EXIT_GRACE_MS/);
  assert.match(dockerfile, /COPY --from=builder \/app\/\.next \.\/\.next/);
  assert.doesNotMatch(dockerfile, /\.next\/standalone/);
  assert.match(entrypoint, /exec npm run start/);
  assert.match(e2eStart, /nextBin, "start"/);
  assert.doesNotMatch(e2eStart, /standalone/);
});

await run("deployment verification can include real email ai and smoke checks", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/deploy-verify.mjs",
      "--dry-run",
      "--skip-build",
      "--skip-up",
      "--skip-backup",
      "--skip-health",
      "--require-live-email"
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  const emailStep = plan.steps.find((step) => step.name === "Validate email subsystem diagnostics");
  assert.equal(emailStep.args.includes("--test-connections"), false);
  assert.equal(emailStep.args.includes("--test-ai-provider"), false);
  assert.equal(emailStep.args.includes("--smoke"), false);
  assert.equal(emailStep.args.includes("--require-live-readiness"), true);
});

await run("email verification report summarizes saved readiness json", async () => {
  const directory = await makeTempDir("crm-email-verify-report");
  const reportPath = join(directory, "email-verify-last.json");
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        ok: false,
        liveReadinessRequired: true,
        userId: "user-admin",
        operationalUser: { resolvedUserId: "user-admin", fallbackUsed: false },
        readiness: {
          liveTrafficReady: false,
          automatedChecksOk: true,
          mailboxConnections: { passed: 1, tested: 2, required: true },
          aiProvider: { status: "ok", verified: true },
          applicationSmoke: { status: "error", verified: false },
          blockers: ["smoke failed"],
          warnings: ["one mailbox failed"],
          manualActions: ["reconnect mailbox"]
        }
      },
      null,
      2
    )
  );

  const result = spawnSync(process.execPath, ["scripts/email-verify-report.mjs", "--file", reportPath, "--fail-on-not-ready=false"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ok=false/);
  assert.match(result.stdout, /liveTrafficReady=false/);
  assert.match(result.stdout, /mailboxes=1\/2/);
  assert.match(result.stdout, /applicationSmoke=error/);
  assert.match(result.stdout, /blockers=1/);
  assert.match(result.stdout, /- smoke failed/);
});

await run("github actions vps deployment publishes ghcr image and deploys compose under opt", () => {
  const workflow = readFileSync(".github/workflows/deploy-vps.yml", "utf8");
  const remoteDeploy = readFileSync("deploy/vps-remote-deploy.sh", "utf8");
  const compose = readFileSync("deploy/docker-compose.vps.yml", "utf8");
  const envExample = readFileSync("deploy/vps.env.example", "utf8");
  const docs = readFileSync("docs/vps-github-actions-deploy.md", "utf8");
  const readme = readFileSync("README.md", "utf8");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const workerEntrypoint = readFileSync("scripts/docker-worker-entrypoint.sh", "utf8");
  const emailSyncEntrypoint = readFileSync("scripts/docker-email-sync-entrypoint.sh", "utf8");

  assert.match(workflow, /name: Deploy VPS/);
  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /run_email_connections:/);
  assert.match(workflow, /run_email_ai_provider:/);
  assert.match(workflow, /run_email_smoke:/);
  assert.match(workflow, /require_live_email:/);
  assert.match(workflow, /DEPLOY_PATH: \/opt\/ai-agent-crm/);
  assert.match(workflow, /docker\/build-push-action@v6/);
  assert.match(workflow, /ghcr\.io\/\$\{repository\}/);
  assert.match(workflow, /VPS_HOST/);
  assert.match(workflow, /VPS_SSH_KEY/);
  assert.match(workflow, /VPS_PORT: \$\{\{ vars\.VPS_PORT \|\| secrets\.VPS_PORT \|\| '22' \}\}/);
  assert.match(workflow, /APP_BASE_URL_CONFIGURED: \$\{\{ vars\.APP_BASE_URL \|\| secrets\.APP_BASE_URL \}\}/);
  assert.match(workflow, /POSTGRES_PASSWORD/);
  assert.match(workflow, /chown -R 999:999 "\$DEPLOY_PATH\/postgres-data"/);
  assert.match(workflow, /chmod 700 "\$DEPLOY_PATH\/postgres-data"/);
  assert.match(compose, /entrypoint: \["sh", "scripts\/docker-worker-entrypoint\.sh"\]/);
  assert.match(compose, /entrypoint: \["sh", "scripts\/docker-email-sync-entrypoint\.sh"\]/);
  assert.match(workerEntrypoint, /scripts\/wait-for-database\.mjs/);
  assert.match(workerEntrypoint, /exec node --experimental-strip-types --import \.\/scripts\/register-alias\.mjs scripts\/job-worker\.ts --loop/);
  assert.match(emailSyncEntrypoint, /scripts\/wait-for-database\.mjs/);
  assert.match(emailSyncEntrypoint, /exec node --experimental-strip-types --import \.\/scripts\/register-alias\.mjs scripts\/email-sync\.ts --loop/);
  assert.match(workflow, /EMAIL_CONFIG_SECRET/);
  assert.match(workflow, /Weak email secret/);
  assert.match(workflow, /EMAIL_CONFIG_SECRET EMAIL_OAUTH_STATE_SECRET/);
  assert.match(workflow, /must be at least 16 characters/);
  assert.match(workflow, /Placeholder email secret/);
  assert.match(workflow, /replace-with-\*/);
  assert.match(workflow, /Duplicate email secrets/);
  assert.match(workflow, /EMAIL_CONFIG_SECRET and EMAIL_OAUTH_STATE_SECRET must be different random values/);
  assert.match(workflow, /RUN_EMAIL_AI_PROVIDER_TEST: \$\{\{ inputs\.run_email_ai_provider \|\| vars\.RUN_EMAIL_AI_PROVIDER_TEST \|\| 'false' \}\}/);
  assert.match(workflow, /REQUIRE_LIVE_EMAIL_READINESS: \$\{\{ inputs\.require_live_email \|\| vars\.REQUIRE_LIVE_EMAIL_READINESS \|\| 'false' \}\}/);
  assert.match(workflow, /Missing AI secret/);
  assert.match(workflow, /AI_API_KEY is required when AI provider verification or live email readiness is enabled/);
  assert.match(workflow, /Partial OAuth configuration/);
  assert.match(workflow, /OAuth requires both \$\{id_name\} and \$\{secret_name\}/);
  assert.match(workflow, /APP_PORT must be an integer between 1 and 65535/);
  assert.match(workflow, /POSTGRES_HOST is required/);
  assert.match(workflow, /POSTGRES_PORT must be an integer between 1 and 65535/);
  assert.match(workflow, /Invalid Postgres identifier/);
  assert.match(workflow, /POSTGRES_HOST: \$\{\{ vars\.POSTGRES_HOST \|\| 'postgres' \}\}/);
  assert.match(workflow, /POSTGRES_PORT: \$\{\{ vars\.POSTGRES_PORT \|\| '5432' \}\}/);
  assert.match(workflow, /POSTGRES_USER: \$\{\{ vars\.POSTGRES_USER \|\| 'crm' \}\}/);
  assert.match(workflow, /POSTGRES_DB: \$\{\{ vars\.POSTGRES_DB \|\| 'ai_agent_crm' \}\}/);
  assert.match(workflow, /SEED_ON_EMPTY: \$\{\{ vars\.SEED_ON_EMPTY \|\| 'false' \}\}/);
  assert.match(workflow, /EMAIL_DELIVERY_MODE: \$\{\{ vars\.EMAIL_DELIVERY_MODE \|\| 'live' \}\}/);
  assert.match(workflow, /EMAIL_SYNC_INTERVAL_MS: \$\{\{ vars\.EMAIL_SYNC_INTERVAL_MS \|\| '300000' \}\}/);
  assert.match(workflow, /EMAIL_SYNC_LIMIT: \$\{\{ vars\.EMAIL_SYNC_LIMIT \|\| '25' \}\}/);
  assert.match(workflow, /EMAIL_SEND_CLAIM_TIMEOUT_MS: \$\{\{ vars\.EMAIL_SEND_CLAIM_TIMEOUT_MS \|\| '900000' \}\}/);
  assert.match(workflow, /RUN_EMAIL_CONNECTION_TESTS: \$\{\{ inputs\.run_email_connections \|\| vars\.RUN_EMAIL_CONNECTION_TESTS \|\| 'false' \}\}/);
  assert.match(workflow, /RUN_EMAIL_SMOKE_TEST: \$\{\{ inputs\.run_email_smoke \|\| vars\.RUN_EMAIL_SMOKE_TEST \|\| 'false' \}\}/);
  assert.match(workflow, /require_bool\(\)/);
  assert.match(workflow, /require_positive_integer\(\)/);
  assert.match(workflow, /RUN_EMAIL_CONNECTION_TESTS RUN_EMAIL_AI_PROVIDER_TEST RUN_EMAIL_SMOKE_TEST REQUIRE_LIVE_EMAIL_READINESS SEED_ON_EMPTY/);
  assert.match(workflow, /\$\{name\} must be true or false/);
  assert.match(workflow, /EMAIL_DELIVERY_MODE must be live or dry-run/);
  assert.match(workflow, /REQUIRE_LIVE_EMAIL_READINESS requires EMAIL_DELIVERY_MODE=live/);
  assert.match(workflow, /\$\{name\} must be a positive integer/);
  assert.match(workflow, /require_positive_integer EMAIL_SYNC_INTERVAL_MS/);
  assert.match(workflow, /require_positive_integer EMAIL_SEND_CLAIM_TIMEOUT_MS/);
  assert.match(workflow, /EMAIL_SYNC_LIMIT must be an integer between 1 and 100/);
  assert.match(workflow, /EMAIL_VERIFY_USER_ID: \$\{\{ vars\.EMAIL_VERIFY_USER_ID \|\| vars\.EMAIL_SYNC_USER_ID \|\| 'user-admin' \}\}/);
  assert.match(workflow, /EMAIL_SEND_CLAIM_TIMEOUT_MS: \$\{\{ vars\.EMAIL_SEND_CLAIM_TIMEOUT_MS \|\| '900000' \}\}/);
  assert.match(workflow, /encodeURIComponent/);
  assert.match(workflow, /write_env DATABASE_URL "\$database_url"/);
  assert.match(workflow, /write_env SEED_ON_EMPTY "\$SEED_ON_EMPTY"/);
  assert.match(workflow, /write_env EMAIL_VERIFY_USER_ID "\$EMAIL_VERIFY_USER_ID"/);
  assert.match(workflow, /write_env EMAIL_SEND_CLAIM_TIMEOUT_MS "\$EMAIL_SEND_CLAIM_TIMEOUT_MS"/);
  assert.match(workflow, /name: Validate rendered VPS env file/);
  assert.match(workflow, /NODE_ENV: production/);
  assert.match(workflow, /node scripts\/validate-env\.mjs --env-file vps\.env/);
  assert.match(workflow, /scp .*deploy\/docker-compose\.vps\.yml/);
  assert.match(workflow, /scp .*deploy\/vps-remote-deploy\.sh/);
  assert.match(workflow, /sh '\$DEPLOY_PATH\/vps-remote-deploy\.sh'/);
  assert.match(remoteDeploy, /if \[ "\$\{postgres_host:-postgres\}" != "postgres" \]; then/);
  assert.match(remoteDeploy, /docker run --rm --add-host=host\.docker\.internal:host-gateway alpine:3\.20/);
  assert.match(remoteDeploy, /nc -z -w 5/);
  assert.match(remoteDeploy, /Postgres schema permission denied/);
  assert.match(remoteDeploy, /docker compose pull/);
  assert.match(remoteDeploy, /docker compose up -d --remove-orphans/);
  assert.match(remoteDeploy, /docker compose exec -T web node scripts\/healthcheck\.mjs/);
  assert.doesNotMatch(remoteDeploy, /curl --fail --retry/);
  assert.match(workflow, /RUN_EMAIL_CONNECTION_TESTS/);
  assert.match(workflow, /RUN_EMAIL_AI_PROVIDER_TEST/);
  assert.match(workflow, /RUN_EMAIL_SMOKE_TEST/);
  assert.match(workflow, /REQUIRE_LIVE_EMAIL_READINESS/);
  assert.match(remoteDeploy, /\[ "\$\{REQUIRE_LIVE_EMAIL_READINESS:-false\}" = "true" \] && email_verify_args="\$email_verify_args --require-live-readiness"/);
  assert.match(remoteDeploy, /\[ "\$\{REQUIRE_LIVE_EMAIL_READINESS:-false\}" = "true" \] \|\| \[ "\$\{RUN_EMAIL_CONNECTION_TESTS:-false\}" != "true" \]/);
  assert.match(remoteDeploy, /--require-live-readiness/);
  assert.match(remoteDeploy, /verify_stdout="\$\(mktemp\)"/);
  assert.match(remoteDeploy, /verify_stderr="\$\(mktemp\)"/);
  assert.match(remoteDeploy, /rm -f email-verify-last\.json email-verify-last-summary\.txt/);
  assert.match(remoteDeploy, /scripts\/email-verify\.ts \$email_verify_args >"\$verify_stdout" 2>"\$verify_stderr"/);
  assert.match(remoteDeploy, /cp "\$verify_stderr" email-verify-last-summary\.txt/);
  assert.match(remoteDeploy, /chmod 600 email-verify-last-summary\.txt/);
  assert.match(remoteDeploy, /cp "\$verify_stdout" email-verify-last\.json/);
  assert.match(remoteDeploy, /chmod 600 email-verify-last\.json/);
  assert.match(remoteDeploy, /cat "\$verify_stdout"/);
  assert.match(remoteDeploy, /scripts\/email-verify\.ts \$email_verify_args/);

  assert.match(compose, /image: \$\{CRM_IMAGE:\?Set CRM_IMAGE\}/);
  assert.match(compose, /DATABASE_URL: \$\{DATABASE_URL:\?Set DATABASE_URL\}/);
  assert.match(compose, /EMAIL_SEND_CLAIM_TIMEOUT_MS: \$\{EMAIL_SEND_CLAIM_TIMEOUT_MS:-900000\}/);
  assert.match(compose, /EMAIL_VERIFY_USER_ID: \$\{EMAIL_VERIFY_USER_ID:-user-admin\}/);
  assert.match(compose, /GMAIL_OAUTH_CLIENT_ID: \$\{GMAIL_OAUTH_CLIENT_ID:-\}/);
  assert.match(compose, /OUTLOOK_OAUTH_CLIENT_SECRET: \$\{OUTLOOK_OAUTH_CLIENT_SECRET:-\}/);
  assert.equal((compose.match(/^\s+GMAIL_OAUTH_CLIENT_ID: \$\{GMAIL_OAUTH_CLIENT_ID:-\}/gm) ?? []).length, 3);
  assert.equal((compose.match(/^\s+OUTLOOK_OAUTH_TOKEN_URL:/gm) ?? []).length, 3);
  assert.match(compose, /"\$\{APP_PORT:-3000\}:3000"/);
  assert.match(compose, /host\.docker\.internal:host-gateway/);
  assert.match(compose, /^\s+postgres:\s*$/m);
  assert.match(compose, /image: pgvector\/pgvector:pg16/);
  assert.match(compose, /POSTGRES_DB: \$\{POSTGRES_DB:-ai_agent_crm\}/);
  assert.match(compose, /POSTGRES_USER: \$\{POSTGRES_USER:-crm\}/);
  assert.match(compose, /POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:\?Set POSTGRES_PASSWORD\}/);
  assert.match(compose, /pg_isready -U/);
  assert.match(compose, /\$\{CRM_DATA_DIR:-\/opt\/ai-agent-crm\}\/redis-data:\/data/);
  assert.match(compose, /\$\{CRM_DATA_DIR:-\/opt\/ai-agent-crm\}\/postgres-data:\/var\/lib\/postgresql\/data/);
  assert.match(compose, /\$\{CRM_DATA_DIR:-\/opt\/ai-agent-crm\}\/backups:\/app\/backups/);
  assert.doesNotMatch(compose, /build:\s*\n/);

  assert.match(envExample, /CRM_DATA_DIR=\/opt\/ai-agent-crm/);
  assert.match(envExample, /APP_PORT=3000/);
  assert.match(envExample, /pgvector\/pgvector:pg16/);
  assert.match(envExample, /POSTGRES_HOST=postgres/);
  assert.match(envExample, /POSTGRES_PORT=5432/);
  assert.match(envExample, /SEED_ON_EMPTY=false/);
  assert.match(envExample, /EMAIL_VERIFY_USER_ID=user-admin/);
  assert.match(envExample, /POSTGRES_PASSWORD=replace-with-database-password/);
  assert.match(envExample, /URL-encode POSTGRES_USER, POSTGRES_PASSWORD, and POSTGRES_DB/);
  assert.match(envExample, /DATABASE_URL=postgresql:\/\/crm:replace-with-url-encoded-database-password@postgres:5432\/ai_agent_crm\?schema=public/);
  assert.match(docs, /\/opt\/ai-agent-crm/);
  assert.match(docs, /VPS_APP_PORT/);
  assert.match(docs, /APP_BASE_URL/);
  assert.match(docs, /VPS_PORT/);
  assert.match(docs, /POSTGRES_PASSWORD/);
  assert.match(docs, /URL-encodes/);
  assert.match(docs, /EMAIL_SEND_CLAIM_TIMEOUT_MS/);
  assert.match(docs, /EMAIL_VERIFY_USER_ID/);
  assert.match(docs, /SEED_ON_EMPTY=true/);
  assert.match(docs, /RUN_EMAIL_CONNECTION_TESTS/);
  assert.match(docs, /REQUIRE_LIVE_EMAIL_READINESS/);
  assert.match(docs, /AI_API_KEY.*RUN_EMAIL_AI_PROVIDER_TEST=true.*REQUIRE_LIVE_EMAIL_READINESS=true/);
  assert.match(docs, /GMAIL_OAUTH_CLIENT_ID.*GMAIL_OAUTH_CLIENT_SECRET/);
  assert.match(docs, /OUTLOOK_OAUTH_CLIENT_ID.*OUTLOOK_OAUTH_CLIENT_SECRET/);
  assert.match(docs, /Pre-Deployment Validation/);
  assert.match(docs, /AI_API_KEY.*missing while AI provider verification or live email readiness is enabled/);
  assert.match(docs, /OAuth client id configured without the matching client secret/);
  assert.match(docs, /EMAIL_DELIVERY_MODE.*live readiness enabled while delivery mode is not `live`/);
  assert.match(docs, /EMAIL_SYNC_INTERVAL_MS.*EMAIL_SYNC_LIMIT.*EMAIL_SEND_CLAIM_TIMEOUT_MS/);
  assert.match(docs, /validate-env\.mjs --env-file vps\.env/);
  assert.match(docs, /email-verify-last\.json/);
  assert.match(docs, /email-verify-last-summary\.txt/);
  assert.match(docs, /email-verify-report\.mjs/);
  assert.match(docs, /--file \/dev\/stdin/);
  assert.match(docs, /old JSON file is not left behind/);
  assert.match(docs, /scripts\/email-verify\.ts/);
  assert.match(docs, /Postgres host/);
  assert.match(docs, /pgvector\/pgvector:pg16/);
  assert.match(docs, /postgres-data/);
  assert.match(docs, /999:999/);
  assert.match(docs, /pg_filenode\.map: Permission denied/);
  assert.match(docs, /5433:5432/);
  assert.match(readme, /GitHub Actions 部署到 VPS/);
  assert.match(readme, /GitHub Actions Secrets/);
  assert.match(readme, /GitHub Actions Variables/);
  assert.match(readme, /EMAIL_CONFIG_SECRET.*凭据加密密钥/);
  assert.match(readme, /EMAIL_OAUTH_STATE_SECRET.*OAuth state 签名密钥/);
  assert.match(readme, /至少 16 字符/);
  assert.match(readme, /建议 32 字符以上/);
  assert.match(readme, /npm run config:secrets/);
  assert.match(readme, /openssl rand -base64 32/);
  assert.match(readme, /不要提交到 Git/);
  assert.match(readme, /VPS_APP_PORT/);
  assert.match(readme, /APP_BASE_URL/);
  assert.match(readme, /VPS_PORT/);
  assert.match(readme, /POSTGRES_HOST/);
  assert.match(readme, /POSTGRES_PORT/);
  assert.match(readme, /EMAIL_SEND_CLAIM_TIMEOUT_MS/);
  assert.match(readme, /EMAIL_VERIFY_USER_ID/);
  assert.match(readme, /AI_API_KEY.*RUN_EMAIL_AI_PROVIDER_TEST=true.*REQUIRE_LIVE_EMAIL_READINESS=true/);
  assert.match(readme, /GMAIL_OAUTH_CLIENT_ID.*GMAIL_OAUTH_CLIENT_SECRET/);
  assert.match(readme, /OUTLOOK_OAUTH_CLIENT_ID.*OUTLOOK_OAUTH_CLIENT_SECRET/);
  assert.match(readme, /Gmail\/Outlook OAuth client id 和 secret 必须成对出现/);
  assert.match(readme, /EMAIL_DELIVERY_MODE.*EMAIL_SYNC_INTERVAL_MS.*EMAIL_SYNC_LIMIT.*EMAIL_SEND_CLAIM_TIMEOUT_MS/);
  assert.match(readme, /SEED_ON_EMPTY=true/);
  assert.match(readme, /RUN_EMAIL_CONNECTION_TESTS/);
  assert.match(readme, /REQUIRE_LIVE_EMAIL_READINESS/);
  assert.match(readme, /email-verify-last\.json/);
  assert.match(readme, /email-verify-last-summary\.txt/);
  assert.match(readme, /run_email_connections/);
  assert.match(readme, /pgvector\/pgvector:pg16/);
  assert.match(readme, /postgres:5432/);
  assert.equal(packageJson.scripts["deploy:verify:dry-run"], "node scripts/deploy-verify.mjs --dry-run");
  assert.equal(
    packageJson.scripts["deploy:verify:live-email"],
    "node scripts/deploy-verify.mjs --run-email-connections --run-email-ai-provider --run-email-smoke --require-live-email"
  );
  assert.equal(packageJson.scripts["email:verify:report"], "node scripts/email-verify-report.mjs");
  assert.match(readme, /deploy:verify:dry-run/);
  assert.match(readme, /deploy:verify:live-email/);
  assert.match(readme, /email:verify:report/);
});

await run("product quote currency migration handles malformed quote json arrays", () => {
  const migrationPath = "prisma/migrations/20260624_product_images_quote_currencies/migration.sql";
  const migrationBytes = readFileSync(migrationPath);
  const migration = migrationBytes.toString("utf8");
  assert.notDeepEqual([...migrationBytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(/^[\x00-\x7F]*$/.test(migration), true);
  assert.match(migration, /jsonb_typeof\("CrmRecord"\."data"->'lineItems'\) = 'array'/);
  assert.match(migration, /jsonb_typeof\("CrmRecord"\."data"->'fees'\) = 'array'/);
  assert.doesNotMatch(migration, /jsonb_array_elements\(COALESCE\("CrmRecord"\."data"->'lineItems'/);
  assert.doesNotMatch(migration, /jsonb_array_elements\(COALESCE\("CrmRecord"\."data"->'fees'/);
});

await run("performance phase one adds indexed CRM record query paths", () => {
  const migration = readFileSync("prisma/migrations/20260626090000_perf_phase_one/migration.sql", "utf8");
  const repository = readFileSync("src/lib/crm/repository.ts", "utf8");

  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pg_trgm/);
  assert.match(migration, /"CrmRecord_contacts_company_id_idx"/);
  assert.match(migration, /"CrmRecord_contacts_methods_trgm_idx"/);
  assert.match(migration, /"CrmRecord_companies_domain_eq_idx"/);
  assert.match(repository, /listRecordsForUniqueValidation\(context, objectKey, fields, data\)/);
  assert.match(repository, /listRecordsForUniqueValidation\(context, objectKey, fields, nextData, recordId\)/);
  assert.doesNotMatch(repository, /const existing = await this\.listRecordsForValidation\(context, objectKey\);[\s\S]{0,260}validateRecordPayload\(fields, data, existing\)/);
  assert.match(repository, /function recordSearchSql\(objectKey: string, search: string\): Prisma\.Sql/);
  assert.match(repository, /if \(objectKey === "contacts"\)[\s\S]*"data"->>'contactMethods'/);
  assert.match(repository, /if \(objectKey === "companies"\)[\s\S]*"data"->>'domain'/);
});

await run("approved contact method patches merge against current database methods", () => {
  const repository = readFileSync("src/lib/crm/repository.ts", "utf8");
  assert.match(repository, /function canMergeApprovedContactMethodPatch\(currentValue: unknown, approvedValue: unknown\): boolean/);
  assert.match(repository, /canMergeApprovedContactMethodPatch\(currentData\.contactMethods, nextContactMethods\)/);
  assert.match(repository, /contactMethods: mergeContactMethodsForApproval\(currentData\.contactMethods, nextContactMethods\)/);
});

await run("performance phase two adds cursor pagination remote lookup and explain tooling", () => {
  const repository = readFileSync("src/lib/crm/repository.ts", "utf8");
  const workspace = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const explainScript = readFileSync("scripts/crm-explain-analyze.ts", "utf8");

  assert.match(repository, /canUseKeysetPagination\(normalizedQuery\)/);
  assert.match(repository, /findRecordsKeysetPage\(whereSql, normalizedQuery, pageSize\)/);
  assert.match(repository, /encodeRecordCursor\(lastRow\.updatedAt, lastRow\.id\)/);
  assert.match(repository, /recordDataProjectionSql\(fields\?: string\[\]\)/);
  assert.match(repository, /listRecordsForCsvConflictCandidates/);
  assert.doesNotMatch(repository, /const existing = await this\.listRecordsForValidation\(context, objectKey\);[\s\S]{0,220}const errors: string\[\] = \[\];/);
  assert.match(workspace, /const \[recordCursorStack, setRecordCursorStack\] = useState<string\[\]>\(\[""\]\)/);
  assert.match(workspace, /fields: recordListFields[\s\S]*keyset: true/);
  assert.match(workspace, /setRemoteCandidates\(result\.records\)/);
  assert.match(workspace, /paginationMode === "keyset"/);
  assert.equal(packageJson.scripts["db:explain:crm"], "node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/crm-explain-analyze.ts");
  assert.match(explainScript, /EXPLAIN \(ANALYZE, BUFFERS, FORMAT TEXT\)/);
  assert.match(explainScript, /contacts by companyId/);
});

await run("observability adds postgres slow query api timing and database snapshots", async () => {
  const compose = readFileSync("docker-compose.yml", "utf8");
  const vpsCompose = readFileSync("deploy/docker-compose.vps.yml", "utf8");
  const migration = readFileSync("prisma/migrations/20260626120000_observability_pg_stat_statements/migration.sql", "utf8");
  const api = readFileSync("src/lib/api.ts", "utf8");
  const db = readFileSync("src/lib/db.ts", "utf8");
  const route = readFileSync("src/app/api/admin/observability/db/route.ts", "utf8");
  const recordsRoute = readFileSync("src/app/api/records/[objectKey]/route.ts", "utf8");
  const emailThreadsRoute = readFileSync("src/app/api/email/threads/route.ts", "utf8");
  const emailSendRoute = readFileSync("src/app/api/email/send/route.ts", "utf8");
  const healthRoute = readFileSync("src/app/api/health/route.ts", "utf8");

  for (const content of [compose, vpsCompose]) {
    assert.match(content, /shared_preload_libraries=pg_stat_statements/);
    assert.match(content, /pg_stat_statements\.track=all/);
    assert.match(content, /log_min_duration_statement=500/);
    assert.match(content, /log_lock_waits=on/);
    assert.match(content, /log_temp_files=10485760/);
  }
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pg_stat_statements/);

  assert.match(api, /export function withApiMetrics/);
  assert.match(api, /event: "api_request"/);
  assert.match(api, /recordApiRequestMetric\(metric\)/);
  assert.match(db, /event: "db_slow_query"/);
  assert.match(db, /DB_SLOW_QUERY_MS/);
  assert.match(route, /requirePermission\(context, "crm.admin"\)/);
  assert.match(route, /getDatabaseObservabilitySnapshot\(prisma\)/);
  assert.match(route, /withApiMetrics\("GET \/api\/admin\/observability\/db"/);
  assert.match(recordsRoute, /withApiMetrics\("GET \/api\/records\/\[objectKey\]"/);
  assert.match(recordsRoute, /withApiMetrics\("POST \/api\/records\/\[objectKey\]"/);
  assert.match(emailThreadsRoute, /withApiMetrics\("GET \/api\/email\/threads"/);
  assert.match(emailSendRoute, /withApiMetrics\("POST \/api\/email\/send"/);
  assert.match(healthRoute, /withApiMetrics\("GET \/api\/health"/);

  recordApiRequestMetric({ route: "GET /api/one", method: "GET", path: "/api/one", status: 200, durationMs: 10, recordedAt: "2026-01-01T00:00:00.000Z" }, 3);
  recordApiRequestMetric({ route: "GET /api/two", method: "GET", path: "/api/two", status: 200, durationMs: 20, recordedAt: "2026-01-01T00:00:01.000Z" }, 3);
  recordApiRequestMetric({ route: "GET /api/three", method: "GET", path: "/api/three", status: 503, durationMs: 30, recordedAt: "2026-01-01T00:00:02.000Z" }, 3);
  recordApiRequestMetric({ route: "GET /api/four", method: "GET", path: "/api/four", status: 200, durationMs: 40, recordedAt: "2026-01-01T00:00:03.000Z" }, 3);
  assert.deepEqual(listRecentApiRequestMetrics(2).map((item) => item.route), ["GET /api/four", "GET /api/three"]);

  const fakePrisma = {
    async $queryRaw(strings, ...values) {
      const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
      if (sql.includes("GROUP BY COALESCE")) {
        return [{ state: "active", count: 2n }, { state: "idle", count: 3n }];
      }
      if (sql.includes("count(*) AS total")) {
        return [{ total: 5n, active: 2n, idle: 3n, idle_in_transaction: 0n, waiting: 1n }];
      }
      if (sql.includes("pg_settings")) {
        return [{ setting: "100" }];
      }
      if (sql.includes("pg_extension")) {
        return [{ exists: true }];
      }
      if (sql.includes("pg_stat_statements")) {
        assert.equal(values[0], 5);
        return [{
          query: "SELECT  *  FROM  \"CrmRecord\"  WHERE  id = $1",
          calls: 4n,
          total_exec_time: 123.456,
          mean_exec_time: 30.864,
          max_exec_time: 55.5,
          rows: 4n
        }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const snapshot = await getDatabaseObservabilitySnapshot(fakePrisma, { apiMetricLimit: 1, slowQueryLimit: 5 });
  assert.equal(snapshot.connectionPool.total, 5);
  assert.equal(snapshot.connectionPool.waiting, 1);
  assert.equal(snapshot.connectionPool.usagePercent, 5);
  assert.equal(snapshot.pgStatStatements.enabled, true);
  assert.equal(snapshot.pgStatStatements.topSlowQueries[0].meanExecTimeMs, 30.86);
  assert.equal(snapshot.recentApiRequests[0].route, "GET /api/four");
});

await run("service health payload exposes email readiness summary", async () => {
  const email = await checkEmailSubsystemDiagnostics({
    env: {
      APP_SECRET: "test-app-secret-32-bytes",
      APP_BASE_URL: "http://127.0.0.1:3000",
      EMAIL_DELIVERY_MODE: "dry-run",
      AI_API_KEY: "test-ai-key",
      JOB_EXECUTOR: "redis",
      EMAIL_SYNC_INTERVAL_MS: "120000",
      EMAIL_SYNC_LIMIT: "25",
      EMAIL_SYNC_USER_ID: "user-admin"
    },
    accounts: [
      {
        id: "email-account-health",
        workspaceId: defaultWorkspaceId,
        name: "Health Mailbox",
        emailAddress: "health@example.com",
        provider: "smtp_imap",
        status: "active",
        syncEnabled: true,
        sendEnabled: true,
        connectionConfigured: true,
        createdById: "user-admin",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    aiSettings: createDefaultEmailAiSettings(defaultWorkspaceId, "2026-01-01T00:00:00.000Z"),
    auditLogs: [],
    includeJobs: true,
    checkJobs: async () => ({ ok: true, executor: "inline", queue: "inline" })
  });
  const payload = buildServiceHealthPayload({
    checkedAt: "2026-01-01T00:00:00.000Z",
    database: "ok",
    jobs: { ok: true, executor: "inline", queue: "inline" },
    email
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.emailReadiness.ok, true);
  assert.equal(payload.emailReadiness.status, "warning");
  assert.equal(payload.emailReadiness.encryption, "ok");
  assert.equal(payload.emailReadiness.oauthState, "ok");
  assert.equal(payload.emailReadiness.oauthCallback, "ok");
  assert.equal(payload.emailReadiness.accounts?.active, 1);
  assert.equal(payload.emailReadiness.aiProvider, "ok");
  assert.equal(payload.emailReadiness.aiContextPolicy.loaded, true);
  assert.equal(payload.emailReadiness.aiContextPolicy.requireSourceLinks, true);
  assert.equal(payload.emailReadiness.aiContextPolicy.enabledFeatures.auto_summarize, true);
  assert.equal(payload.emailReadiness.aiContextPolicy.enabledFeatures.auto_translate, false);
  assert.equal(payload.emailReadiness.aiContextPolicy.enabledAutomationCount, 1);
  assert.deepEqual(payload.emailReadiness.aiContextPolicy.featureDependencies, [
    { feature: "auto_translate", dependsOn: "translate" },
    { feature: "auto_context_analysis", dependsOn: "context_analysis" }
  ]);
  assert.deepEqual(payload.emailReadiness.aiContextPolicy.automationEligibleStatuses.inbound, ["received"]);
  assert.deepEqual(payload.emailReadiness.aiContextPolicy.automationEligibleStatuses.outbound, ["sent"]);
  assert.equal(payload.emailReadiness.aiContextPolicy.autoContextAnalysisScope, "inbound_received_only");
  assert.equal(payload.emailReadiness.aiContextPolicy.budgetPolicy.maxModelPromptChars, MAX_EMAIL_MODEL_PROMPT_CHARS);
  assert.equal(payload.emailReadiness.aiContextPolicy.budgetPolicy.maxGeneratedOutputChars, MAX_EMAIL_AI_OUTPUT_CHARS);
  assert.equal(payload.emailReadiness.aiContextPolicy.budgetPolicy.maxSuggestedSubjectChars, MAX_EMAIL_AI_SUBJECT_CHARS);
  assert.equal(payload.emailReadiness.autoSummaryPolicy.enabled, true);
  assert.equal(payload.emailReadiness.syncScheduler.status, "ok");
  assert.equal(payload.emailReadiness.syncScheduler.intervalMs, 120000);
  assert.equal(payload.emailReadiness.syncScheduler.limit, 25);
  assert.equal(payload.emailReadiness.syncScheduler.configuredUserId, "user-admin");
  assert.equal(payload.emailReadiness.syncScheduler.userIdSource, "EMAIL_SYNC_USER_ID");
  assert.equal(payload.emailReadiness.syncScheduler.fallbackToAdmin, true);
  assert.equal(payload.emailReadiness.syncScheduler.queueBacked, true);
  assert.equal(payload.emailReadiness.sendClaims.status, "ok");
  assert.equal(payload.emailReadiness.sendClaims.staleCount, 0);
  assert.equal(payload.emailReadiness.aiAutomationFailures.recentFailureCount, 0);
  assert.equal(payload.emailReadiness.aiProviderFallbacks.recentFallbackCount, 0);
  assert.equal(payload.emailReadiness.jobs?.ok, true);
  assert.deepEqual(payload.emailReadiness.oauthProviders.gmail.missingScopes, []);
});

await run("health scripts report email readiness fields", () => {
  const healthcheck = readFileSync("scripts/healthcheck.mjs", "utf8");
  const deployVerify = readFileSync("scripts/deploy-verify.mjs", "utf8");
  assert.match(healthcheck, /emailReadiness/);
  assert.match(healthcheck, /emailSecrets/);
  assert.match(healthcheck, /emailOAuthState/);
  assert.match(healthcheck, /emailOAuthCallback/);
  assert.match(healthcheck, /emailAiContext/);
  assert.match(healthcheck, /emailAiAutomations/);
  assert.match(healthcheck, /emailAiFallbacks/);
  assert.match(healthcheck, /emailAutoSummary/);
  assert.match(healthcheck, /emailSync/);
  assert.match(healthcheck, /emailSyncUserSource/);
  assert.match(healthcheck, /emailSyncFallback/);
  assert.match(healthcheck, /syncScheduler/);
  assert.match(healthcheck, /emailSendClaims/);
  assert.doesNotMatch(deployVerify, /emailReadiness\?\.ok/);
  assert.match(deployVerify, /formatHealthSummary/);
  assert.match(deployVerify, /emailSecrets/);
  assert.match(deployVerify, /emailOAuthState/);
  assert.match(deployVerify, /emailOAuthCallback/);
  assert.match(deployVerify, /emailAiAutomations/);
  assert.match(deployVerify, /emailAiFallbacks/);
  assert.match(deployVerify, /emailSendClaims/);
  assert.match(deployVerify, /emailSync/);
  assert.match(deployVerify, /emailSyncUserSource/);
  assert.match(deployVerify, /emailSyncFallback/);
  assert.match(deployVerify, /syncScheduler/);
});

await run("service health stays up when optional email readiness has errors", async () => {
  const email = await checkEmailSubsystemDiagnostics({
    env: {
      EMAIL_CONFIG_SECRET: "",
      EMAIL_OAUTH_STATE_SECRET: "",
      APP_BASE_URL: "http://crm.example.com",
      EMAIL_DELIVERY_MODE: "live"
    }
  });
  const payload = buildServiceHealthPayload({
    checkedAt: "2026-01-01T00:00:00.000Z",
    database: "ok",
    jobs: { ok: true, executor: "redis", queue: "ok", redis: "ok" },
    email
  });

  assert.equal(email.ok, false);
  assert.equal(payload.ok, true);
  assert.equal(payload.emailReadiness.ok, false);
});

await run("public api docs describe email and ai mail endpoints", () => {
  const docs = readFileSync("docs/public-api.md", "utf8");
  assert.match(docs, /\/api\/email\/accounts/);
  assert.match(docs, /\/api\/email\/send/);
  assert.match(docs, /\/api\/email\/sync-all/);
  assert.match(docs, /\/api\/email\/ai-settings/);
  assert.match(docs, /\/api\/email\/ai-context/);
  assert.match(docs, /\/api\/email\/ai-generate/);
  assert.match(docs, /\/api\/knowledge\/articles/);
  assert.match(docs, /feature toggle/);
  assert.match(docs, /source-backed/);
  assert.match(docs, /stale `sending` message/);
});

await run("email sync route uses configured background executor and forwards bounded sync limit", () => {
  const source = readFileSync("src/app/api/email/sync/route.ts", "utf8");
  assert.match(source, /getBackgroundJobExecutor\(repository\)/);
  assert.doesNotMatch(source, /new InlineBackgroundJobExecutor/);
  assert.match(source, /body\.fullResync && process\.env\.JOB_EXECUTOR !== "redis"/);
  assert.match(source, /markEmailAccountSyncQueued\(context, body\.accountId\)/);
  assert.match(source, /setTimeout\(\(\) => \{/);
  assert.match(source, /runEmailSyncJob\(context,\s*\{\s*accountId:\s*body\.accountId,\s*limit:\s*body\.limit,\s*fullResync:\s*body\.fullResync\s*\}\)/);
  assert.match(source, /result\.status === "queued" \? 202 : 200/);
});

await run("email sync-all route keeps empty body support and uses configured background executor", () => {
  const source = readFileSync("src/app/api/email/sync-all/route.ts", "utf8");
  assert.match(source, /parseOptionalJson\(request,\s*emailSyncAllSchema,\s*\{\s*\}\)/);
  assert.doesNotMatch(source, /new InlineBackgroundJobExecutor/);
  assert.match(source, /scheduleEmailSyncForActiveAccounts\(context,\s*\{\s*repository,\s*limit:\s*body\.limit,\s*fullResync:\s*body\.fullResync\s*\}\)/);
  assert.match(source, /account\.status === "queued"\) \? 202 : 200/);
});

await run("email send route rejects live unconfigured accounts before queueing", () => {
  const source = readFileSync("src/app/api/email/send/route.ts", "utf8");
  assert.match(source, /getEmailDeliveryMode\(\) !== "dry-run"/);
  assert.match(source, /account\.status === "active" && account\.sendEnabled && capability\.supportsSend && !account\.connectionConfigured/);
  assert.match(source, /throw new Error\("Email account connection is not configured"\)/);
  assert.match(source, /getEmailAccount\(context, body\.accountId\)[\s\S]*applySelectedSignature\(/);
  assert.match(source, /queueEmailMessage\(context, queuedBody\)/);
  assert.match(source, /candidate\.id === account\.defaultSignatureId/);
  assert.match(source, /!candidate\.accountId && candidate\.isDefault/);
});

await run("email workspace exposes sync-all control backed by the sync-all api", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const providerSource = readFileSync("src/lib/email/provider.ts", "utf8");
  assert.match(source, /async function syncAllEmailAccounts\(\)/);
  assert.match(source, /\/api\/email\/sync-all/);
  assert.match(source, /data-testid="email-sync-all"/);
  assert.match(source, /data-testid="email-account-sync-protocol"/);
  assert.match(source, /POP3 \$\{result\.result\.pop3 \?\? "skipped"\}/);
  assert.match(source, /onSyncAllAccounts/);
  assert.match(source, /\(account\.status === "active" \|\| account\.status === "error"\) && account\.syncEnabled && account\.connectionConfigured && capability\.supportsSync/);
  assert.match(source, /disabled=\{disabled \|\| !account\.syncEnabled \|\| !account\.connectionConfigured \|\| !capability\.supportsSync \|\| \(account\.status !== "active" && account\.status !== "error"\)\}/);
  assert.match(source, /function canSelectEmailAccountForSending\(account: EmailAccount\): boolean/);
  assert.match(source, /account\.status !== "disabled" && account\.sendEnabled && account\.connectionConfigured/);
  assert.match(providerSource, /fetchRecentMailboxEmails\(config, syncLimit\)/);
  assert.doesNotMatch(providerSource, /fetchRecentImapEmails\(config, syncLimit\)/);
});

await run("email workspace treats queued sync as background work and polls for imported mail", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const mediaLibrary = readFileSync("src/components/media-library.tsx", "utf8");
  assert.match(source, /result\.status === "queued"/);
  assert.match(source, /lastSyncStatus:\s*"running"/);
  assert.match(source, /accountActionKey === `sync:\$\{account\.id\}`/);
  assert.match(source, /accountActionKey === `full-sync:\$\{account\.id\}`/);
  assert.match(source, /className=\{isTesting \? "spin-icon" : undefined\}/);
  assert.doesNotMatch(source, /测试中" : "测试连接"[\s\S]{0,120}<RefreshCw className=\{disabled \? "spin-icon" : undefined\}/);
  assert.match(source, /const queued = result\.accounts\.filter\(\(account\) => account\.status === "queued"\)/);
  assert.match(source, /scheduleEmailThreadsRefreshPolling\(\{[\s\S]*reloadSelectedMessages: true[\s\S]*accountIds:/);
  assert.match(source, /summarizeEmailSyncCompletion/);
  assert.match(source, /邮箱同步已提交后台/);
  assert.match(source, /邮箱后台同步已提交/);
  assert.match(source, /account\.status === "synced"/);
});

await run("email full resync button submits without a blocking confirm dialog", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const fullResyncFunction = source.slice(source.indexOf("async function fullResyncEmailAccount"), source.indexOf("async function syncAllEmailAccounts"));
  assert.match(fullResyncFunction, /await syncEmailAccount\(accountId, \{ fullResync: true \}\)/);
  assert.doesNotMatch(fullResyncFunction, /requestConfirm/);
  assert.match(source, /body: \{ accountId, \.\.\.\(options\.fullResync \? \{ fullResync: true, limit: 100 \} : \{\}\) \}/);
  assert.match(source, /data-testid=\{`email-account-full-sync-\$\{account\.id\}`\}/);
});

await run("crm workspace routes modules through stable paths", () => {
  assert.deepEqual(resolveCrmRoute([], ["contacts", "companies"]), { navKey: "dashboard", objectKey: "contacts", path: "/" });
  assert.deepEqual(resolveCrmRoute(["companies"], ["contacts", "companies"]), { navKey: "companies", objectKey: "companies", path: "/companies" });
  assert.deepEqual(resolveCrmRoute(["sales-documents"], ["contacts", "quotes"]), { navKey: "sales-documents", objectKey: "quotes", path: "/sales-documents" });
  assert.deepEqual(resolveCrmRoute(["salesorders"], ["contacts", "salesorders"]), { navKey: "sales-documents", objectKey: "salesorders", path: "/sales-documents" });
  assert.deepEqual(resolveCrmRoute(["email"], ["contacts", "companies"]), { navKey: "email", objectKey: "contacts", path: "/email" });
  assert.deepEqual(resolveCrmRoute(["automation"], ["contacts", "companies"]), { navKey: "automation", objectKey: "contacts", path: "/automation" });
  assert.deepEqual(resolveCrmRoute(["records", "partners"], ["contacts", "partners"]), { navKey: "records", objectKey: "partners", path: "/records/partners" });
  assert.equal(resolveCrmRoute(["unknown"], ["contacts"]), null);
  assert.equal(crmPathForNav("automation"), "/automation");
  assert.equal(crmPathForNav("settings"), "/settings");
  assert.equal(crmPathForNav("records", "partners"), "/records/partners");
  assert.equal(crmPathForNav("sales-documents"), "/sales-documents");
  assert.equal(crmPathForNav("salesorders"), "/sales-documents");

  const rootPage = readFileSync("src/app/page.tsx", "utf8");
  const modulePage = readFileSync("src/app/[...module]/page.tsx", "utf8");
  const workspace = readFileSync("src/components/crm-workspace.tsx", "utf8");
  assert.match(rootPage, /return <CrmPage searchParams=\{searchParams\} \/>/);
  assert.match(modulePage, /<CrmPage moduleSegments=\{params\.module \?\? \[\]\} searchParams=\{searchParams\} \/>/);
  assert.match(readFileSync("src/app/crm-page.tsx", "utf8"), /repository\.getRecord\(context, initialObjectKey, routeRecordId\)/);
  assert.match(workspace, /initialNavKey: NavKey/);
  assert.match(workspace, /useState<NavKey>\(props\.initialNavKey\)/);
  assert.match(workspace, /usePathname\(\)/);
  assert.match(workspace, /resolveCrmRoute\(pathname\.split\("\/"\)\.filter\(Boolean\), routeObjectKeys\)/);
  assert.match(workspace, /router\.push\(nextPath\)/);
  assert.match(workspace, /type NavKey = [^\n]*"automation"/);
  assert.match(workspace, /\{ key: "automation", label: "自动化", icon: WorkflowIcon \}/);
  assert.match(workspace, /activeNav === "automation"[\s\S]*<AutomationWorkspace/);
  assert.doesNotMatch(workspace, /useState<NavKey>\("dashboard"\)/);
});

await run("automation workspace is a first-class visual workflow module", () => {
  const navigation = readFileSync("src/lib/crm/navigation.ts", "utf8");
  const workspace = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const automation = readFileSync("src/components/automation-workspace.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.match(navigation, /automation: "\/automation"/);
  assert.match(automation, /export function AutomationWorkspace/);
  assert.match(automation, /automationObjects/);
  assert.match(automation, /automation-object-\$\{item\.key\}/);
  assert.match(automation, /contacts/);
  assert.match(automation, /companies/);
  assert.match(automation, /deals/);
  assert.match(automation, /email/);
  assert.match(automation, /automation-node-canvas/);
  assert.match(automation, /WorkflowGraphCanvas/);
  assert.match(automation, /WorkflowGraphInspector/);
  assert.match(automation, /workflow-graph-node/);
  assert.match(automation, /workflow-node-drag-handle/);
  assert.match(automation, /workflow-node-delete-button/);
  assert.match(automation, /workflow-node-delete-\$\{node\.id\}/);
  assert.match(automation, /onPointerDown=\{\(event\) => \{[\s\S]*event\.stopPropagation\(\);[\s\S]*onClick=\{\(event\) => \{[\s\S]*onDeleteNode\(node\.id\)/);
  assert.match(automation, /onPointerDown=\{\(event\) => startNodeMove\(event, node\)\}/);
  assert.match(automation, /shouldIgnoreNodeMove/);
  assert.match(automation, /data-no-node-drag="true"/);
  assert.match(automation, /Delete workflow node/);
  assert.match(automation, /onDoubleClick/);
  assert.match(automation, /workflow-node-modal/);
  assert.match(automation, /workflow-node-dialog-backdrop/);
  assert.match(automation, /workflow-fullscreen-save/);
  assert.match(automation, /onSave=\{\(\) => \{ void saveDraft\(\); \}\}/);
  assert.match(automation, /nodeDeleteCandidate/);
  assert.match(automation, /confirmDeleteGraphNode/);
  assert.match(automation, /workflow-floating-palette/);
  assert.match(automation, /workflow-floating-palette-toggle/);
  assert.match(automation, /isFloatingPaletteOpen/);
  assert.match(automation, /floatingPalettePosition/);
  assert.match(automation, /startPaletteMove/);
  assert.match(automation, /WORKFLOW_CANVAS_ORIGIN_OFFSET/);
  assert.match(automation, /visibleCanvasPoint/);
  assert.match(automation, /WorkflowRichTextEditor/);
  assert.match(automation, /richTextHtmlToPlainText/);
  assert.match(automation, /application\/x-workflow-node-type/);
  assert.match(automation, /isWorkflowPaletteNodeType/);
  assert.match(automation, /onPointerDown/);
  assert.match(automation, /pointermove/);
  assert.match(automation, /panningCanvas/);
  assert.match(automation, /startCanvasPan/);
  assert.match(automation, /event\.button !== 2/);
  assert.match(automation, /onContextMenu=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(automation, /workflow-node-output/);
  assert.match(automation, /workflow-fullscreen-button/);
  assert.match(automation, /workflow-edge-delete-button/);
  assert.match(automation, /workflow-graph-edge-hit/);
  assert.match(automation, /workflow-graph-edge-preview/);
  assert.match(automation, /connectionPreview/);
  assert.match(automation, /updateConnectionPreview/);
  assert.match(automation, /buildWorkflowPreviewEdge/);
  assert.match(automation, /Delete workflow connection/);
  assert.match(automation, /Maximize2/);
  assert.match(automation, /Minimize2/);
  assert.match(automation, /workflow-input-\$\{node\.id\}/);
  assert.match(automation, /workflow-port-\$\{node\.id\}-\$\{handle\}/);
  assert.match(automation, /application\/x-workflow-connection/);
  assert.match(automation, /workflow-quick-add/);
  assert.match(automation, /quickAddNodeTypesForHandle/);
  assert.match(automation, /onCreateConnectedNode/);
  assert.match(automation, /onOpenQuickAdd/);
  assert.match(automation, /sourceHandle/);
  assert.match(automation, /continue/);
  assert.match(automation, /break/);
  assert.match(automation, /workflow-loop-help/);
  assert.match(automation, /workflow-loop-port-guide/);
  assert.match(automation, /Connect the last node back to this Loop/);
  assert.match(automation, /wait_delay/);
  assert.match(automation, /wait_reply/);
  assert.match(automation, /ai_agent/);
  assert.match(automation, /workflow-ai-agent-help/);
  assert.match(automation, /autoExecuteTools/);
  assert.match(automation, /needs_review/);
  assert.match(automation, /Allowed tools/);
  assert.match(automation, /create_email_draft/);
  assert.match(automation, /after_delay/);
  assert.match(automation, /not_replied/);
  assert.match(automation, /assigneeMode/);
  assert.match(automation, /preventDuplicate/);
  assert.match(automation, /graphToLegacyWorkflow/);
  assert.match(automation, /legacyWorkflowToGraph/);
  assert.match(automation, /function stripWorkflowReadonlyFields/);
  assert.doesNotMatch(automation, /version: workflow\.version/);
  assert.match(automation, /typeof payload\?\.error === "string"/);
  assert.match(automation, /automation-target-record/);
  assert.match(automation, /recordId: selectedTargetRecord\?\.id/);
  assert.match(automation, /workflowTargetRecordId/);
  assert.match(automation, /applyWorkflowRecordScope/);
  assert.match(automation, /workflow-start-record-select/);
  assert.match(automation, /selectStartRecord/);
  assert.match(automation, /applyWorkflowRecordScope\(createWorkflowDraft\(objectKey\), targetRecord\)/);
  assert.match(automation, /IF 条件分支/);
  assert.match(automation, /SWITCH 多分支/);
  assert.match(automation, /LOOP 循环/);
  assert.match(automation, /accountId/);
  assert.match(automation, /bodyHtml/);
  assert.match(automation, /splitConfigList/);
  assert.match(automation, /\/api\/workflows\/generate/);
  assert.match(automation, /isGeneratingWorkflow/);
  assert.match(automation, /aria-busy=\{isGeneratingWorkflow\}/);
  assert.match(automation, /automation-ai-loading/);
  assert.match(automation, /Loader2 className="spin-icon"/);
  assert.match(automation, /\/api\/workflows\/\$\{workflow\.id\}\/test/);
  assert.match(workspace, /import \{ AutomationWorkspace \} from "@\/components\/automation-workspace"/);
  assert.match(workspace, /emailAccounts=\{props\.emailAccounts\}/);
  assert.match(workspace, /record-automation-\$\{selectedRecord\.id\}/);
  assert.match(workspace, /selectedRecordWorkflows/);
  assert.match(workspace, /workflowId/);
  assert.match(workspace, /crmPathForNav\("automation"\)\}\?\$\{nextParams\.toString\(\)\}/);
  assert.match(styles, /\.automation-layout/);
  assert.match(styles, /\.automation-ai-loading/);
  assert.match(styles, /\.workflow-graph-canvas/);
  assert.match(styles, /\.workflow-graph-canvas\.canvas-panning/);
  assert.match(styles, /\.workflow-graph-stage/);
  assert.match(styles, /\.workflow-graph-canvas\.fullscreen/);
  assert.match(styles, /\.workflow-fullscreen-button/);
  assert.match(styles, /\.workflow-fullscreen-save-button/);
  assert.match(styles, /\.workflow-graph-edge-hit/);
  assert.match(styles, /\.workflow-graph-edge-preview/);
  assert.match(styles, /\.workflow-edge-delete-button/);
  assert.match(styles, /\.workflow-quick-add/);
  assert.match(styles, /\.workflow-node-drag-handle/);
  assert.match(styles, /\.workflow-node-delete-button/);
  assert.match(styles, /z-index:\s*8/);
  assert.match(styles, /\.workflow-node-modal/);
  assert.match(styles, /\.workflow-node-help/);
  assert.match(styles, /\.workflow-graph-node\.ai_agent/);
  assert.match(styles, /\.workflow-loop-port-guide/);
  assert.match(styles, /\.workflow-node-dialog-backdrop/);
  assert.match(styles, /\.app-dialog-backdrop/);
  assert.match(styles, /\.workflow-floating-palette/);
  assert.match(styles, /\.workflow-floating-palette-toggle/);
  assert.match(styles, /\.workflow-floating-palette-header/);
  assert.match(styles, /\.workflow-floating-palette-item/);
  assert.match(styles, /\.workflow-rich-editor/);
  assert.match(styles, /\.workflow-rich-toolbar/);
  assert.match(styles, /\.workflow-rich-content/);
  assert.match(styles, /\.workflow-node-input::after/);
  assert.match(styles, /\.workflow-node-output/);
  assert.match(styles, /\.workflow-node-port/);
  assert.match(styles, /\.workflow-node-output\.active \.workflow-node-port/);
  assert.match(styles, /\.workflow-graph-node\.selected/);
  assert.match(styles, /\.record-workflow-list/);
  assert.doesNotMatch(automation, /window\.(alert|prompt|confirm)/);
});

await run("company detail loads inverse contact relationships", () => {
  const workspace = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const crmPage = readFileSync("src/app/crm-page.tsx", "utf8");

  assert.match(crmPage, /getRelationObjectKeys\(relations, initialObjectKey\)\.forEach\(\(objectKey\) => referenceObjectKeys\.add\(objectKey\)\)/);
  assert.match(crmPage, /function getRelationObjectKeys\(relations: RelationDefinition\[\], objectKey: string\): Set<string>/);
  assert.match(workspace, /getReferenceObjectKeysForObject\(props\.fields, activeObject\.key, props\.relations\)/);
  assert.match(workspace, /function getReferenceObjectKeysForObject\(fields: FieldDefinition\[\], objectKey: string, relations: RelationDefinition\[\] = \[\]\): Set<string>/);
  assert.match(workspace, /relation\.fromObjectKey === objectKey[\s\S]*keys\.add\(relation\.toObjectKey\)/);
  assert.match(workspace, /selectedRecord\?\.objectKey !== "companies"[\s\S]*filters: \[\{ field: "companyId", operator: "equals", value: selectedRecord\.id \}\]/);
  assert.match(workspace, /buildRecordListUrl\("contacts", companyContactsView, "", 1, "\/api\/records\/contacts", 200\)/);
  assert.match(workspace, /function getCompanyContactRecords\(company: CrmRecord, records: CrmRecord\[\]\): CrmRecord\[\] \{[\s\S]*recordReferencesId\(record\.data\.companyId, company\.id\)/);
  assert.match(workspace, /function recordReferencesId\(value: unknown, recordId: string\): boolean/);
  assert.match(workspace, /Array\.isArray\(value\)[\s\S]*value\.some\(\(item\) => recordReferencesId\(item, recordId\)\)/);
});

await run("PDF template visual editor supports palette, canvas, properties, JSON, and history", () => {
  const editor = readFileSync("src/components/document-template-visual-editor.tsx", "utf8");
  const settings = readFileSync("src/components/settings-admin.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.match(settings, /<DocumentTemplateVisualEditor/);
  assert.match(editor, /data-testid="pdf-visual-editor"/);
  assert.match(editor, /"text" \| "todayOffset" \| "row" \| "splitter" \| "table" \| "image"/);
  assert.match(editor, /距离今日 \+ N 天/);
  assert.match(editor, /dateAdd generatedAt/);
  assert.match(editor, /draggable/);
  assert.match(editor, /application\/x-pdf-template-node/);
  assert.match(editor, /可视化/);
  assert.match(editor, /data-testid="document-template-json"/);
  assert.match(editor, /Undo2/);
  assert.match(editor, /Redo2/);
  assert.match(editor, /PropertyFields/);
  assert.match(styles, /\.pdf-editor-workspace/);
  assert.match(styles, /\.pdf-editor-page/);
});

await run("PDF template visual editor phase two supports resize blocks images conditions pages and live preview", () => {
  const editor = readFileSync("src/components/document-template-visual-editor.tsx", "utf8");
  const previewRoute = readFileSync("src/app/api/document-templates/preview/route.ts", "utf8");
  assert.match(editor, /ColumnResizeHandle/);
  assert.match(editor, /templateBlocks/);
  assert.match(editor, /mediaAssetDataUrl/);
  assert.match(editor, /type: "condition"/);
  assert.match(editor, /type: "pageBreak"/);
  assert.match(editor, /\/api\/document-templates\/preview/);
  assert.match(editor, /700/);
  assert.match(previewRoute, /renderSalesDocumentPdf/);
  assert.match(previewRoute, /Cache-Control.*no-store/);
});

await run("settings admin groups configuration panels by tabs", () => {
  const source = readFileSync("src/components/settings-admin.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.match(source, /type SettingsTabKey = "profile" \| "access" \| "crm" \| "pool" \| "smartReminders" \| "aiAgents" \| "workflows" \| "integrations" \| "operations"/);
  assert.match(source, /const settingsTabs/);
  assert.match(source, /AI Agents/);
  assert.match(source, /type AiAgentConfigTabKey = "providers" \| "agents" \| "knowledge"/);
  assert.match(source, /activeAiAgentConfigTab === "providers"[\s\S]*data-testid="ai-provider-profiles"/);
  assert.match(source, /activeAiAgentConfigTab === "agents"[\s\S]*data-testid="ai-agent-harness-config"/);
  assert.match(source, /activeAiAgentConfigTab === "knowledge"[\s\S]*data-testid="settings-knowledge-base"/);
  assert.match(source, /<KnowledgeBaseManager/);
  assert.match(source, /Save providers/);
  assert.match(source, /保存 Agent/);
  assert.match(source, /\/api\/ai\/agents/);
  assert.match(source, /activeSettingsTab === "aiAgents"[\s\S]*agent\.md/);
  assert.match(source, /data-testid="ai-agent-harness-config"/);
  assert.match(source, /Harness config/);
  assert.match(source, /Include CRM record context/);
  assert.match(source, /Allowed tools/);
  assert.match(source, /<SearchableTagInput/);
  assert.match(source, /testId="ai-agent-allowed-tools"/);
  assert.match(source, /function SearchableTagInput/);
  assert.match(source, /data-testid=\{testId\}/);
  assert.match(source, /className="tag-select-token"/);
  assert.match(source, /Remove \$\{option\?\.label \?\? value\}/);
  assert.match(source, /updateAiAgentToolPolicy/);
  assert.match(source, /公海规则/);
  assert.match(source, /\/api\/pool-settings/);
  assert.match(source, /activeSettingsTab === "pool"[\s\S]*保存公海规则/);
  assert.match(source, /activeSettingsTab === "workflows"/);
  assert.match(source, /\/api\/workflows\/generate/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /aria-selected=\{activeSettingsTab === tab\.key\}/);
  assert.match(source, /activeSettingsTab === "access"[\s\S]*UserTeamAdminPanel[\s\S]*RoleAdminPanel[\s\S]*PermissionMatrix/);
  assert.match(source, /activeSettingsTab === "crm"[\s\S]*CurrencyAdminPanel[\s\S]*settings-grid settings-grid-wide[\s\S]*settings-grid settings-grid-wide/);
  assert.match(source, /data-testid="pipeline-stage-editor"/);
  assert.match(source, /pipelineDraft\.stages\.map/);
  assert.match(source, /function addPipelineStage/);
  assert.match(source, /function movePipelineStage/);
  assert.match(source, /function removePipelineStage/);
  assert.match(source, /normalizePipelineStagesForSave\(pipelineDraft\.stages\)/);
  assert.match(source, /Win Probability[\s\S]*type="range"/);
  assert.doesNotMatch(source, /stagesText/);
  assert.match(source, /activeSettingsTab === "integrations"[\s\S]*ApiKeyAdminPanel[\s\S]*WebhookAdminPanel/);
  assert.match(source, /activeSettingsTab === "operations"[\s\S]*ImportQueueMonitor[\s\S]*BackupOperationsPanel[\s\S]*audit-panel/);
  assert.match(styles, /\.settings-tabs-shell/);
  assert.match(styles, /\.settings-tab-list/);
  assert.match(styles, /\.settings-tab-list\.compact-tab-list/);
  assert.match(styles, /\.settings-tab-button\.active/);
  assert.match(styles, /\.tag-select-input/);
  assert.match(styles, /\.tag-select-menu/);
  assert.match(styles, /\.tag-select-token/);
  assert.match(styles, /\.pipeline-stage-editor/);
  assert.match(styles, /\.pipeline-stage-row/);
});

await run("workspace and settings use friendly feedback instead of browser dialogs", () => {
  const workspace = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const settings = readFileSync("src/components/settings-admin.tsx", "utf8");
  const automation = readFileSync("src/components/automation-workspace.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");
  const sourceWithUi = `${workspace}\n${settings}`;

  assert.doesNotMatch(sourceWithUi, /window\.(alert|prompt|confirm)/);
  assert.doesNotMatch(sourceWithUi, /shouldProceedWithDangerousAction/);
  assert.match(workspace, /function ToastViewport/);
  assert.match(workspace, /function ConfirmDialog/);
  assert.match(workspace, /function PromptDialog/);
  assert.match(settings, /function ToastViewport/);
  assert.match(workspace, /const TOAST_AUTO_DISMISS_MS = 5_000;[\s\S]*window\.setTimeout\(\(\) => onDismissRef\.current\(\), TOAST_AUTO_DISMISS_MS\)/);
  assert.match(settings, /const TOAST_AUTO_DISMISS_MS = 5_000;[\s\S]*window\.setTimeout\(\(\) => onDismissRef\.current\(\), TOAST_AUTO_DISMISS_MS\)/);
  assert.match(automation, /const TOAST_AUTO_DISMISS_MS = 5_000;[\s\S]*}, TOAST_AUTO_DISMISS_MS\)/);
  assert.match(settings, /function ConfirmDialog/);
  assert.match(sourceWithUi, /requestConfirm\(\{[\s\S]*danger: true/);
  assert.match(styles, /\.toast/);
  assert.match(styles, /\.app-dialog/);
  assert.match(styles, /\.spin-icon/);
  assert.match(styles, /@keyframes spin/);
  assert.match(styles, /button:not\(:disabled\):active/);
  assert.match(sourceWithUi, /<RefreshCw className=\{[^}]*spin-icon/);
});

await run("record change approval actions use local feedback instead of global transition", () => {
  const settings = readFileSync("src/components/settings-admin.tsx", "utf8");

  assert.match(settings, /const \[reviewingRecordChangeRequestId, setReviewingRecordChangeRequestId\] = useState\(""\)/);
  assert.match(settings, /setReviewingRecordChangeRequestId\(request\.id\)[\s\S]*fetchJson<RecordChangeReviewResponse>\(`\/api\/record-change-requests\/\$\{request\.id\}`/);
  assert.match(settings, /props\.onRecordsUpdated\?\.\(\[result\.record\]\)/);
  assert.match(settings, /catch \(actionError\)[\s\S]*showError\(actionError instanceof Error \? actionError\.message/);
  assert.match(settings, /finally \{[\s\S]*setReviewingRecordChangeRequestId\(""\)/);
  assert.match(settings, /reviewingRequestId=\{reviewingRecordChangeRequestId\}/);
  assert.match(settings, /onApprove=\{\(request\) => \{ void reviewRecordChangeRequest\(request, "approve"\); \}\}/);
  assert.match(settings, /disabled=\{Boolean\(reviewingRequestId\)\}/);
  assert.doesNotMatch(settings, /onApprove=\{\(request\) => runAction\(\(\) => reviewRecordChangeRequest\(request, "approve"\)\)\}/);
});

await run("webhook admin uses scoped events and local action feedback", () => {
  const settings = readFileSync("src/components/settings-admin.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.match(settings, /const \[webhookActionKey, setWebhookActionKey\] = useState\(""\)/);
  assert.match(settings, /async function runWebhookAction/);
  assert.match(settings, /objects=\{props\.objects\}/);
  assert.match(settings, /actionKey=\{webhookActionKey\}/);
  assert.match(settings, /record\.\$\{object\.key\}\.created/);
  assert.match(settings, /email\.message\.created/);
  assert.match(settings, /className="wide webhook-event-groups"/);
  assert.match(settings, /onDelete=\{\(webhook\) => \{ void handleDeleteWebhook\(webhook\); \}\}/);
  assert.match(settings, /onToggle=\{\(webhook\) => \{ void handleToggleWebhook\(webhook\); \}\}/);
  assert.match(settings, /onTest=\{\(webhook\) => \{ void handleTestWebhook\(webhook\); \}\}/);
  assert.doesNotMatch(settings, /onDelete=\{\(webhook\) => runAction\(\(\) => deleteWebhook\(webhook\)\)\}/);
  assert.match(styles, /\.webhook-event-groups/);
  assert.match(styles, /\.webhook-event-picker/);
});

await run("record change approval renders readable field diffs instead of raw json", () => {
  const settings = readFileSync("src/components/settings-admin.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");
  const panelSource = settings.slice(settings.indexOf("function RecordChangeRequestAdminPanel"), settings.indexOf("function BackupOperationsPanel"));

  assert.match(settings, /fields=\{props\.fields\}/);
  assert.match(settings, /objects=\{props\.objects\}/);
  assert.match(settings, /records=\{props\.records\}/);
  assert.match(settings, /activities=\{props\.activities\}/);
  assert.match(panelSource, /const reviewRows = buildRecordReviewRows\(request, record, requestFields, users, records, activities\)/);
  assert.match(panelSource, /request\.objectKey === "activities"/);
  assert.match(panelSource, /label: "活动类型"/);
  assert.match(panelSource, /label: "关联记录"/);
  assert.match(panelSource, /previousRecordApprovalPatch\(patch\)/);
  assert.match(panelSource, /const previousData = isRecordReviewObject\(previousPatch\.data\) \? previousPatch\.data : \{\}/);
  assert.match(panelSource, /const oldValue = key in previousData \? previousData\[key\] : record\?\.data\[key\]/);
  assert.match(panelSource, /className="record-review-diff-table"/);
  assert.match(panelSource, /className="record-review-value old-value"/);
  assert.match(panelSource, /className="record-review-value new-value"/);
  assert.match(panelSource, /formatContactMethodsForReview/);
  assert.doesNotMatch(panelSource, /<code className="audit-details">\{formatAuditDetails\(request\.patch/);
  assert.match(styles, /\.record-review-diff-table/);
  assert.match(styles, /\.record-review-diff-row/);
  assert.match(styles, /\.record-review-value \{[\s\S]*white-space: pre-wrap/);
  assert.match(styles, /\.record-review-value \{[\s\S]*overflow-wrap: anywhere/);
});

await run("record workspace refresh cannot leave create locked behind global pending", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");

  assert.match(source, /const recordListRequestTimeoutMs = 15_000/);
  assert.match(source, /const routeRefreshTimeoutMs = 10_000/);
  assert.match(source, /const recordListRequestSeq = useRef\(0\)/);
  assert.match(source, /const \[isRouteRefreshPending, startRouteRefreshTransition\] = useTransition\(\)/);
  assert.match(source, /controller\.abort\(\);\s*\}, recordListRequestTimeoutMs\)/);
  assert.match(source, /recordListRequestSeq\.current === requestSeq[\s\S]*setIsRecordListLoading\(false\)/);
  assert.match(source, /onClick=\{refreshRoute\}/);
  assert.match(source, /className=\{isRouteRefreshing \|\| isRouteRefreshPending \? "spin-icon" : undefined\}/);
  assert.doesNotMatch(source, /data-testid=\{`open-create-record-\$\{activeObject\.key\}`\}[\s\S]{0,260}disabled=\{isPending\}/);
});

await run("workspace supports deal pipeline drag and email sidebar collapse", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");
  const stageRoute = readFileSync("src/app/api/records/[objectKey]/[recordId]/stage/route.ts", "utf8");
  const schemas = readFileSync("src/lib/crm/api-schemas.ts", "utf8");
  assert.match(source, /const \[appSidebarCollapsed, setAppSidebarCollapsed\] = useState\(false\)/);
  assert.match(source, /const sidebarCollapsedStorageKey = "ai-agent-crm:sidebar-collapsed"/);
  assert.match(source, /window\.localStorage\.getItem\(sidebarCollapsedStorageKey\)/);
  assert.match(source, /function toggleAppSidebar\(\)/);
  assert.match(source, /window\.localStorage\.setItem\(sidebarCollapsedStorageKey, String\(next\)\)/);
  assert.doesNotMatch(source, /item\.key === "email"[\s\S]{0,160}setAppSidebarCollapsed\(true\)/);
  assert.doesNotMatch(source, /function openObject\(objectKey: string\) \{[\s\S]{0,120}setAppSidebarCollapsed/);
  assert.match(source, /className=\{`app-shell \$\{appSidebarCollapsed \? "sidebar-collapsed" : ""\} theme-\$\{appTheme\}`\}/);
  assert.match(source, /function ModuleWorkspaceHeader/);
  assert.match(source, /function AppSidebarToggleButton/);
  assert.match(source, /testId = "app-sidebar-toggle"/);
  assert.match(source, /testId="email-app-sidebar-toggle"/);
  assert.match(source, /className="topbar-title gmail-topbar-title"/);
  assert.match(source, /activeNav !== "email" \?/);
  assert.match(source, /view !== "mail" \?/);
  assert.match(source, /className=\{`email-workspace \$\{view === "mail" \? "mail-view" : ""\}`\}/);
  assert.doesNotMatch(source, /function handleDealDragStart/);
  assert.match(source, /type DealWorkspaceView = "pipeline" \| "list"/);
  assert.match(source, /const routeDealView = normalizeDealWorkspaceView\(searchParams\.get\("view"\)\)/);
  assert.match(source, /const \[dealWorkspaceView, setDealWorkspaceView\] = useState<DealWorkspaceView>\(routeDealView\)/);
  assert.match(source, /function changeDealWorkspaceView\(nextView: DealWorkspaceView\)/);
  assert.match(source, /nextParams\.set\("view", nextView\)/);
  assert.match(source, /const isDealPipelineView = activeObject\?\.key === "deals" && dealWorkspaceView === "pipeline"/);
  assert.match(source, /<DealPipelineWorkspace/);
  assert.match(source, /data-testid="deal-view-switch"/);
  assert.match(source, /data-testid="deal-view-pipeline"/);
  assert.match(source, /data-testid="deal-view-list"/);
  assert.match(source, /function DealPipelineWorkspace/);
  assert.match(source, /data-testid="deal-pipeline-workspace"/);
  assert.match(source, /data-testid=\{`deal-pipeline-stage-\$\{stage\.key\}`\}/);
  assert.match(source, /data-testid=\{`deal-pipeline-deal-\$\{deal\.id\}`\}/);
  assert.match(source, /data-testid="deal-pipeline-drag-overlay"/);
  assert.match(source, /data-testid="deal-pipeline-drop-placeholder"/);
  assert.match(source, /data-testid=\{`deal-pipeline-deal-\$\{deal\.id\}`\}[\s\S]{0,900}onClick=\{\(\) => \{[\s\S]{0,360}onOpenDeal\(deal\);/);
  assert.match(source, /const dealPipelineCardColorStorageKey = "ai-agent-crm:deal-pipeline-card-colors"/);
  assert.match(source, /const dealCardColorOptions = \[/);
  assert.match(source, /setDealCardColor\(floatingColorDeal\.id, option\.key\)/);
  assert.match(source, /getFloatingLayerPosition/);
  assert.match(source, /function handleDealPointerDown/);
  assert.match(source, /function finishDealDrag/);
  assert.match(source, /const \[pipelineDeals, setPipelineDeals\] = useState\(deals\)/);
  assert.match(source, /pendingDealMovesRef\.current\[deal\.id\] = \{ pipelineOrder: nextOrder, stageKey: preview\.stageKey \}/);
  assert.match(source, /setPipelineDeals\(\(current\) => mergeRecords\(current, \[optimisticDeal\]\)\)/);
  assert.match(source, /moveDealStage\(deal, stageKey, pipelineOrder, \{ refresh: false \}\)/);
  assert.match(source, /mergeRecordIntoCurrentList\(optimisticRecord\)/);
  assert.match(source, /const systemFields = activeObject\?\.key === "deals" \? \["pipelineOrder"\] : \[\]/);
  assert.match(source, /disabled=\{false\}/);
  assert.match(source, /window\.addEventListener\("pointermove"/);
  assert.match(source, /window\.addEventListener\("pointerup"/);
  assert.match(source, /window\.addEventListener\("pointercancel"/);
  assert.doesNotMatch(source, /setPointerCapture/);
  assert.match(source, /function computeDealDropPreview/);
  assert.match(source, /function computeDealPipelineOrderForDrop/);
  assert.match(source, /pipelineOrder/);
  assert.match(source, /className="deal-card-menu floating"/);
  assert.match(source, /data-testid=\{`deal-card-color-popover-\$\{floatingColorDeal\.id\}`\}/);
  assert.match(source, /data-testid=\{`deal-card-menu-\$\{floatingMenuDeal\.id\}`\}/);
  assert.match(source, /onCreateActivity\(floatingMenuDeal\)/);
  assert.doesNotMatch(source, /编辑交易/);
  assert.doesNotMatch(source, /onEditDeal\(floatingMenuDeal\)/);
  assert.match(source, /openPipelineDealActivityDialog/);
  assert.match(source, /function DealPipelineActivityDialog/);
  assert.match(source, /data-testid="deal-pipeline-activity-dialog"/);
  assert.match(source, /submitPipelineDealActivity/);
  assert.match(source, /\/api\/records\/\$\{record\.objectKey\}\/\$\{record\.id\}\/stage/);
  assert.match(source, /data-testid="dashboard-pipeline-summary"/);
  assert.match(source, /data-testid=\{`dashboard-pipeline-stage-\$\{stage\.key\}`\}/);
  assert.match(source, /className="dashboard-pipeline-stage-count"/);
  assert.doesNotMatch(source, /data-testid=\{`pipeline-deal-\$\{deal\.id\}`\}/);
  assert.doesNotMatch(source, /data-testid=\{`pipeline-stage-\$\{stage\.key\}`\}/);
  assert.doesNotMatch(source, /function handleStageDrop/);
  assert.match(styles, /\.app-shell\.sidebar-collapsed \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styles, /@media \(max-width: 980px\) \{[\s\S]*\.app-shell:not\(\.sidebar-collapsed\)::before \{[\s\S]*position: fixed;[\s\S]*z-index: 899;/);
  assert.match(styles, /@media \(max-width: 980px\) \{[\s\S]*\.sidebar \{[\s\S]*position: fixed;/);
  assert.match(styles, /@media \(max-width: 980px\) \{[\s\S]*\.sidebar \{[\s\S]*z-index: 900;/);
  assert.match(styles, /@media \(max-width: 980px\) \{[\s\S]*\.sidebar \{[\s\S]*height: 100dvh;/);
  assert.match(styles, /\.main \{[\s\S]*padding: 22px;/);
  assert.doesNotMatch(styles, /\.main\.email-main \{[\s\S]{0,80}padding: 0;/);
  assert.match(styles, /\.gmail-client \{[\s\S]*grid-template-rows: max-content minmax\(0, 1fr\);/);
  assert.match(styles, /\.gmail-client \{[\s\S]*align-content: start;/);
  assert.match(styles, /\.gmail-client \{[\s\S]*min-height: calc\(100vh - 44px\);/);
  assert.match(styles, /\.gmail-topbar \{[\s\S]*grid-template-columns: minmax\(172px, max-content\) minmax\(220px, 680px\) 40px 40px;/);
  assert.match(styles, /\.gmail-topbar \{[\s\S]*padding: 0;/);
  assert.match(styles, /\.gmail-topbar-title \{[\s\S]*align-items: center;/);
  assert.match(styles, /\.email-workspace\.mail-view \{\s*padding: 0;/);
  assert.match(styles, /\.deal-pill\.dragging/);
  assert.match(styles, /\.record-view-switch/);
  assert.match(styles, /\.deal-pipeline-workspace/);
  assert.match(styles, /\.deal-pipeline-board/);
  assert.match(styles, /\.deal-card-color-strip/);
  assert.match(styles, /\.deal-card-color-button/);
  assert.match(styles, /\.deal-card-color-popover/);
  assert.match(styles, /\.deal-card-menu/);
  assert.match(styles, /\.deal-card-activity-count/);
  assert.match(styles, /\.deal-pipeline-drop-placeholder/);
  assert.match(styles, /\.deal-pipeline-drag-overlay/);
  assert.match(styles, /body\.deal-pipeline-dragging/);
  assert.match(styles, /\.dashboard-pipeline-summary/);
  assert.match(styles, /\.dashboard-pipeline-stage-count/);
  assert.match(schemas, /export const recordStageUpdateSchema/);
  assert.match(schemas, /pipelineOrder: z\.number\(\)\.finite\(\)\.optional\(\)/);
  assert.match(stageRoute, /recordStageUpdateSchema/);
  assert.match(stageRoute, /params\.objectKey !== "deals"/);
  assert.match(stageRoute, /data: \{ pipelineOrder: body\.pipelineOrder \}/);
});

await run("email thread contact linking is driven by sender email and can return to the email", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");
  const repository = readFileSync("src/lib/crm/repository.ts", "utf8");
  const store = readFileSync("src/lib/crm/store.ts", "utf8");
  const threadRoute = readFileSync("src/app/api/email/threads/[id]/route.ts", "utf8");

  assert.match(source, /const \[recordReturnEmailThreadId, setRecordReturnEmailThreadId\] = useState\(routeReturnEmailThreadId\)/);
  assert.match(source, /useSearchParams\(\)/);
  assert.match(source, /const routeRecordId = searchParams\.get\("recordId"\) \?\? ""/);
  assert.match(source, /const routeEmailThreadId = searchParams\.get\("emailThreadId"\) \?\? ""/);
  assert.match(source, /const \[selectedEmailThreadId, setSelectedEmailThreadId\] = useState\(routeEmailThreadId \|\| props\.emailThreads\[0\]\?\.id \|\| ""\)/);
  assert.match(source, /const \[emailDetailThreadId, setEmailDetailThreadId\] = useState\(routeEmailThreadId\)/);
  assert.match(source, /const \[emailComposeOpenRequestKey, setEmailComposeOpenRequestKey\] = useState\(""\)/);
  assert.match(source, /const pendingRecordOpenRef = useRef<\{ objectKey: string; recordId: string; returnEmailThreadId: string \} \| null>\(null\)/);
  assert.match(source, /function openRecord\(record: CrmRecord, options: \{ returnEmailThreadId\?: string \} = \{\}\)/);
  assert.match(source, /new URLSearchParams\(\{ recordId: record\.id \}\)/);
  assert.match(source, /router\.push\(nextDetailPath\)/);
  assert.match(source, /pendingRecordOpenRef\.current = \{[\s\S]*recordId: record\.id[\s\S]*returnEmailThreadId: options\.returnEmailThreadId \?\? ""[\s\S]*\}/);
  assert.match(source, /if \(routeRecordId\) \{[\s\S]*setSelectedRecordId\(routeRecordId\)[\s\S]*setRecordPanelMode\("detail"\)/);
  assert.match(source, /else if \(nextNav === "email"\) \{[\s\S]*if \(routeEmailThreadId\) \{[\s\S]*setSelectedEmailThreadId\(routeEmailThreadId\)[\s\S]*setEmailDetailThreadId\(routeEmailThreadId\)/);
  assert.match(source, /const preferredThreadId = routeEmailThreadId \|\| selectedEmailThreadId/);
  assert.match(source, /const preserveComposeDraft = Boolean\(emailComposeOpenRequestKey && !routeEmailThreadId\)/);
  assert.match(source, /if \(!preserveComposeDraft && nextSelectedThreadId !== selectedEmailThreadId\)/);
  assert.match(source, /if \(!routeEmailThreadId\) \{[\s\S]*return;[\s\S]*setSelectedEmailThreadId\(routeEmailThreadId\)[\s\S]*fetchJson<EmailMessage\[\]>\(`\/api\/email\/threads\/\$\{routeEmailThreadId\}\/messages`/);
  assert.match(source, /pendingRecordOpen\?\.objectKey === nextObjectKey[\s\S]*setSelectedRecordId\(pendingRecordOpen\.recordId\)[\s\S]*setRecordPanelMode\("detail"\)/);
  assert.match(source, /async function closeRecordPanel\(\)[\s\S]*await openEmailThread\(threadId\)/);
  assert.match(source, /async function openEmailThread\(threadId: string\)[\s\S]*void updateEmailThreadState\(threadId, \{ read: true \}\)/);
  assert.match(source, /async function openEmailThread\(threadId: string\)[\s\S]*const nextEmailThreadPath = buildEmailRoutePath\(\{ mailbox: routeEmailMailbox, category: routeEmailCategory, accountId: routeEmailAccountId, label: routeEmailLabel, listDisplayMode: routeEmailListDisplayMode, search: routeEmailSearch, mailMode: "detail", threadId \}\)[\s\S]*selectEmailThread\(threadId\)[\s\S]*setEmailDetailThreadId\(threadId\)[\s\S]*pushEmailHistoryRoute\(nextEmailThreadPath\)[\s\S]*await loadEmailMessages\(threadId\)/);
  assert.match(source, /if \(!detailThreadId\) \{[\s\S]*return;[\s\S]*const thread = threads\.find\(\(candidate\) => candidate\.id === detailThreadId\)/);
  assert.match(source, /setMailMode\(\(current\) => \{[\s\S]*const nextMode = routeEmailThreadIdToMode\(detailThreadId, routeMailMode\)[\s\S]*return current === nextMode \? current : nextMode/);
  assert.match(source, /function startCreateContactForCompany\(company: CrmRecord\)/);
  assert.match(source, /onOpenEmailContact=\{\(threadId, contact\) => openEmailContact\(threadId, contact\)\}/);
  assert.match(source, /data-testid="email-thread-contact-link"/);
  assert.match(source, /data-testid="email-thread-open-contact"/);
  assert.match(source, /data-testid="email-thread-unlink-record"/);
  assert.match(source, /const \[manuallyUnlinkedThreadIds, setManuallyUnlinkedThreadIds\] = useState<Set<string>>/);
  assert.match(source, /selectedThreadManuallyUnlinked[\s\S]*selectedThreadContact/);
  assert.match(source, /function linkEmailThreadRecord|const linkEmailThreadRecord/);
  assert.match(source, /data-testid="email-thread-create-contact"/);
  assert.match(source, /testId="email-thread-existing-contact"/);
  assert.match(source, /data-testid="email-thread-link-existing-contact"/);
  assert.match(source, /async function linkExistingContactFromEmail\(threadId: string, contactId: string, emailAddress: string\)/);
  assert.match(source, /contactMethods: methods/);
  assert.match(source, /await updateEmailThread\(threadId, updatedContact\.id\)/);
  assert.match(source, /async function unlinkContactEmailFromThread\(threadId: string, contactId: string, emailAddress: string\)/);
  assert.match(source, /contactMethodsFromRecordData\(contact\)\.filter\(\(method\) => !\(method\.type === "email" && method\.value\.trim\(\)\.toLowerCase\(\) === normalizedEmail\)\)/);
  assert.match(source, /contactMethods: methods[\s\S]*email: nextEmail[\s\S]*await updateEmailThread\(threadId, ""\)/);
  assert.match(source, /onUnlinkContactEmailFromThread=\{\(threadId, contactId, emailAddress\) => runAction\(\(\) => unlinkContactEmailFromThread\(threadId, contactId, emailAddress\)\)\}/);
  assert.match(source, /const unlinkEmailThreadContact = \(threadId: string, contact: CrmRecord, emailAddress: string\)/);
  assert.match(source, /selectedThread\.recordId \|\| \(selectedThreadDisplayRecord\.objectKey === "contacts" && selectedThreadSenderEmail\)/);
  assert.match(source, /onClick=\{\(\) => unlinkEmailThreadContact\(selectedThread\.id, selectedThreadDisplayRecord, selectedThreadSenderEmail\)\}/);
  assert.match(source, /function EmailContactSearchDropdown/);
  assert.match(source, /<SearchDropdown[\s\S]*testId="email-thread-existing-contact"/);
  assert.match(source, /onLinkExistingContactFromEmail=\{\(threadId, contactId, emailAddress\) => runAction\(\(\) => linkExistingContactFromEmail\(threadId, contactId, emailAddress\)\)\}/);
  assert.match(source, /onClick=\{\(\) => setExistingContactPickerOpen\(\(current\) => !current\)\}/);
  assert.match(source, /linkExistingEmailContact\(selectedThread\.id, contactId, selectedThreadSenderEmail\)/);
  assert.match(source, /data-testid="email-thread-restore"/);
  assert.match(source, /data-testid="email-thread-permanent-delete"/);
  assert.match(source, /data-testid="email-thread-bulk-permanent-delete"/);
  assert.match(source, /data-testid=\{`email-thread-row-permanent-delete-\$\{thread\.id\}`\}/);
  assert.match(source, /async function deleteEmailThreads\(threadIds: string\[\]\)/);
  assert.match(source, /function openThreadDetail\(threadId: string, messageId = ""\)[\s\S]*patchThreadUiState\(\[threadId\], \{ read: true \}\)[\s\S]*persistThreadState\(threadId, \{ read: true \}\)/);
  assert.match(source, /action === "delete" && threadIds\.some\(\(threadId\) => Boolean\(threadUiState\[threadId\]\?\.deleted\)\)/);
  assert.match(source, /selectedThreadState\.deleted \|\| mailbox === "trash"/);
  assert.match(source, /className=\{`gmail-thread-row \$\{selectedThreadId === thread\.id \? "selected" : ""\} \$\{isThreadListRow \? "parent-row" : ""\} \$\{isRead \? "" : "unread"\} \$\{mailbox === "trash" \? "trash-row" : ""\}`\}/);
  assert.match(source, /aria-label="回复"[\s\S]*onReplyToMessage\(message\);[\s\S]*openComposePopup\(\)/);
  assert.match(source, /aria-label=\{selectedThreadIsRead \? "标记未读" : "标记已读"\}/);
  assert.match(source, /selectedThreadIsRead \? <Mail size=\{16\} \/> : <MailOpen size=\{16\} \/>/);
  assert.match(source, /<Flag className=\{selectedThreadState\.important \? "active-icon" : undefined\} size=\{16\} \/>/);
  assert.match(source, /className="toolbar-menu-panel"/);
  assert.match(source, /aria-label=\{`移除标签 \$\{label\}`\} title=\{`移除标签 \$\{label\}`\}/);
  assert.match(source, /performMailboxAction\(action: "archive" \| "unarchive" \| "delete" \| "restore"/);
  assert.doesNotMatch(source, /data-testid="email-thread-record"/);
  assert.match(source, /const contactMethodsValueKey = "__contactMethods"/);
  assert.match(source, /const companyPrimaryContactValueKey = "__primaryContactId"/);
  assert.match(source, /function QuickActionList/);
  assert.match(source, /type QuickActionItem = \{/);
  assert.match(source, /function ContactMethodsQuickActions/);
  assert.match(source, /record-contact-quick-actions-\$\{record\.id\}/);
  assert.match(source, /onComposeEmail\(value\)/);
  assert.match(source, /onStartWhatsApp\?: \(method: ContactMethodDraft\) => void/);
  assert.match(source, /onStartWhatsApp \? \(\) => onStartWhatsApp\(method\) : undefined/);
  assert.match(source, /onStartCall\?: \(method: ContactMethodDraft\) => void/);
  assert.match(source, /onStartCall \? \(\) => onStartCall\(method\) : undefined/);
  assert.match(source, /sourceRecordId\?: string/);
  assert.match(source, /onEditMethod\?: \(method: ContactMethodDraft\) => void/);
  assert.match(source, /const editAction = onEditMethod/);
  assert.match(source, /const methodRecordId = method\.sourceRecordId \|\| record\.id/);
  assert.match(source, /editingMethodId === method\.id && editingRecordId === methodRecordId \? "收起" : "编辑"/);
  assert.match(source, /onClick: \(\) => onEditMethod\(method\)/);
  assert.match(source, /secondaryActions: \[[\s\S]*onFilterEmail[\s\S]*editAction[\s\S]*\]\.filter/);
  assert.match(source, /href: onStartCall \? undefined : `tel:\$\{normalizePhoneHref\(value\)\}`/);
  assert.match(source, /https:\/\/wa\.me\/\$\{phone\}/);
  assert.match(source, /function openContactFollowUp\(record: CrmRecord, method: ContactMethodDraft, channel: ContactFollowUpDraft\["channel"\]\)/);
  assert.match(source, /function ContactFollowUpDialog/);
  assert.match(source, /purpose: "draft"[\s\S]*Generate one concise WhatsApp opening or follow-up message/);
  assert.match(source, /await createRecordActivity\(\{[\s\S]*title: `\$\{contactFollowUpDraft\.channel === "call" \? "电话跟进" : "WhatsApp 跟进"\}/);
  assert.match(source, /window\.open\(`\$\{whatsappUrl\}\$\{separator\}text=\$\{encodeURIComponent\(messageText\)\}`/);
  assert.match(source, /function getQuickContactMethodsForRecord\(record: CrmRecord, records: CrmRecord\[\]\): ContactMethodDraft\[\]/);
  assert.match(source, /sourceRecordId: primaryContact\.id/);
  assert.match(source, /sourceRecordId: contact\.id/);
  assert.match(source, /selectedRecordQuickContactMethods\.length > 0 && \(!selectedRecordUsesActivityTabs \|\| showContactAllSections\) \? \([\s\S]*<ContactMethodsQuickActions/);
  assert.match(source, /const \[contactMethodEditingId, setContactMethodEditingId\] = useState\(""\)/);
  assert.match(source, /const \[contactMethodEditingRecordId, setContactMethodEditingRecordId\] = useState\(""\)/);
  assert.match(source, /const \[contactMethodEditingValue, setContactMethodEditingValue\] = useState\(""\)/);
  assert.match(source, /const \[companyAddressEditing, setCompanyAddressEditing\] = useState<\{ valueKey: string; addressId: string \} \| null>\(null\)/);
  assert.match(source, /selectedRecord\.objectKey === "contacts" && selectedRecordQuickContactMethods\.length === 0/);
  assert.match(source, /function toggleQuickContactMethodEditor\(method: ContactMethodDraft\)/);
  assert.match(source, /function saveContactMethodEditor\(\)/);
  assert.match(source, /data-testid="quick-contact-method-editor"/);
  assert.match(source, /<ContactMethodSingleEditor/);
  assert.match(source, /onEditMethod=\{toggleQuickContactMethodEditor\}/);
  assert.match(source, /editingRecordId=\{contactMethodEditingRecordId\}/);
  assert.match(source, /保存联系方式/);
  assert.match(source, /新增联系方式/);
  assert.match(source, /startNewContactMethodEditor\(selectedRecord\)/);
  assert.match(source, /function ContactMethodsEditor/);
  assert.match(source, /function ContactMethodSingleEditor/);
  assert.match(source, /const existingMethod = methods\.find\(\(candidate\) => candidate\.id === methodId\)/);
  assert.match(source, /const method = existingMethod \?\?/);
  assert.match(source, /const sourceMethods = hasExistingMethod \? methods : \[\.\.\.methods, method\]/);
  assert.match(source, /removeMethod\(\)[\s\S]*methods\.filter\(\(candidate\) => candidate\.id !== methodId\)/);
  assert.match(source, /data-testid=\{`\$\{testIdPrefix\}-add-\$\{type\}`\}/);
  assert.match(source, /patch\.primary === true[\s\S]*primary: method\.id === methodId/);
  assert.match(source, /function contactMethodsFromValues\(values: Record<string, string>\): ContactMethodDraft\[\] \{[\s\S]*normalizeContactMethods\(parseJsonValue\(values\[contactMethodsValueKey\]\)\)\.filter\(\(method\) => method\.value\.trim\(\)\)/);
  assert.match(source, /function CompanyPrimaryContactSelect/);
  assert.match(source, /data-testid="company-primary-contact-select"/);
  assert.match(source, /data-testid="company-primary-contact-link"/);
  assert.match(source, /<CompanyAddressCards[\s\S]*testIdPrefix="edit-company-billing-address"/);
  assert.match(source, /editingAddressId=\{companyAddressEditing\?\.valueKey === companyBillingAddressesValueKey \? companyAddressEditing\.addressId : ""\}/);
  assert.match(source, /onAdd=\{\(\) => setCompanyAddressEditing\(\{ valueKey: companyBillingAddressesValueKey, addressId: createCompanyAddressId\(\) \}\)\}/);
  assert.match(source, /onEdit=\{\(addressId\) =>[\s\S]*setCompanyAddressEditing\(\(current\) =>/);
  assert.match(source, /function CompanyAddressCards/);
  assert.match(source, /function CompanyAddressSingleEditor/);
  assert.match(source, /const existingAddress = addresses\.find\(\(candidate\) => candidate\.id === addressId\)/);
  assert.match(source, /const sourceAddresses = hasExistingAddress \? addresses : \[\.\.\.addresses, address\]/);
  assert.match(source, /removeAddress\(\)[\s\S]*addresses\.filter\(\(candidate\) => candidate\.id !== addressId\)/);
  assert.match(source, /getRecordEmailAddressesForComposer\(selectedFields, selectedRecord, records\)/);
  assert.match(source, /getCompanyPrimaryContact\(record, records\)/);
  assert.match(source, /const routeEmailCompose = searchParams\.get\("compose"\) === "1"/);
  assert.match(source, /const handledRouteEmailComposeRef = useRef\(""\)/);
  assert.match(source, /const requestKey = `record:\$\{record\.id\}:\$\{Date\.now\(\)\}`/);
  assert.match(source, /composeParams = new URLSearchParams\(\{[\s\S]*compose: "1"[\s\S]*composeRecordId: record\.id[\s\S]*to: emailAddress/);
  assert.match(source, /router\.push\(`\$\{crmPathForNav\("email"\)\}\?\$\{composeParams\.toString\(\)\}`\)/);
  assert.match(source, /setEmailComposeOpenRequestKey\(""\)/);
  assert.match(source, /window\.setTimeout\(\(\) => setEmailComposeOpenRequestKey\(requestKey\), 0\)/);
  assert.match(source, /function closeEmailComposeRequest\(\)/);
  assert.match(source, /params\.delete\("compose"\)/);
  assert.match(source, /composeOpenRequestKey=\{emailComposeOpenRequestKey\}/);
  assert.match(source, /onComposeClosed=\{closeEmailComposeRequest\}/);
  assert.match(source, /const handledComposeOpenRequestRef = useRef\(""\)/);
  assert.match(styles, /\.quick-action-panel \{/);
  assert.match(styles, /\.quick-action-grid \{/);
  assert.match(styles, /\.quick-action-chip \{/);
  assert.match(styles, /\.quick-action-actions \{/);
  assert.match(styles, /\.quick-action-secondary \{/);
  assert.match(styles, /\.address-card-grid \{/);
  assert.match(styles, /\.address-card \{/);
  assert.match(styles, /\.company-address-single-editor \{/);
  assert.match(source, /handledComposeOpenRequestRef\.current = composeOpenRequestKey/);
  assert.match(source, /setComposeOpen\(true\);[\s\S]*setComposeMinimized\(false\);/);
  assert.match(source, /function getThreadPrimarySenderEmail/);
  assert.match(source, /function findContactByEmail/);
  assert.match(source, /function formatEmailContactLabel\(record: CrmRecord, fallbackEmail = ""\): string[\s\S]*`\$\{record\.title\}<\$\{emailAddress\}>`/);
  assert.match(source, /return thread\.participantEmails\.some\(\(emailAddress\) => emailAddresses\.has\(emailAddress\.toLowerCase\(\)\)\)/);
  assert.match(styles, /\.email-contact-link/);
  assert.match(styles, /\.email-contact-link-actions/);
  assert.match(repository, /recordDataHasEmail\(candidate\.data, email\)/);
  assert.match(repository, /function recordDataHasEmail\(data: unknown, emailAddress: string\): boolean/);
  assert.match(repository, /record\.contactMethods/);
  assert.match(repository, /async deleteEmailThread\(context: RequestContext, threadId: string\): Promise<void>/);
  assert.match(store, /find\(\(record\) => emails\.some\(\(email\) => recordDataHasEmail\(record\.data, email\)\)\)\?\.id/);
  assert.match(store, /deleteEmailThread\(context: RequestContext, threadId: string\): void/);
  assert.match(threadRoute, /export const DELETE = withApiMetrics\("DELETE \/api\/email\/threads\/\[id\]"/);
  assert.match(threadRoute, /deleteEmailThread\(context, params\.id\)/);
});

await run("contact and company editing refinements are guarded", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const addressParser = readFileSync("src/lib/crm/address-parser.ts", "utf8");
  const seed = readFileSync("src/lib/crm/seed.ts", "utf8");
  const migration = readFileSync("prisma/migrations/20260707110000_company_domain_optional/migration.sql", "utf8");

  assert.match(source, /function contactMethodTypePatch/);
  assert.match(source, /contactMethodTypePatch\(method, event\.target\.value as ContactMethodType\)/);
  assert.match(source, /function hasRecordUpdatePatchChanges/);
  assert.match(source, /function normalizeComparableRecordJsonValue/);
  assert.match(source, /function isEmptyComparableRecordObject/);
  assert.match(source, /value\.length \? JSON\.stringify\(value\.map\(\(item\) => normalizeComparableRecordJsonValue\(item\)\)\) : ""/);
  assert.match(source, /selectedRecordApprovalSaveDisabled/);
  assert.match(source, /saveDisabled=\{selectedRecordApprovalSaveDisabled\}/);
  assert.match(source, /saveDisabled\?: boolean/);
  assert.match(source, /disabled=\{isPending \|\| !title\.trim\(\) \|\| Boolean\(saveDisabled\)\}/);
  assert.match(source, /!hasRecordUpdatePatchChanges\(approvalBaselineRecord, updatePatch\)/);
  assert.match(source, /未检测到修改，无需提交审批/);
  assert.match(source, /setEditOwnerId\(selectedRecord\.ownerId \?\? ""\)/);
  assert.doesNotMatch(source, /setEditOwnerId\(selectedRecord\.ownerId \?\? props\.contextUser\.id\)/);
  assert.match(source, /function TimezoneSearchInput/);
  assert.match(source, /<TimezoneSearchInput/);
  assert.match(source, /function AddressAiParserButton/);
  assert.match(source, /parseAddressWithLocalAi\(initialText\)/);
  assert.match(addressParser, /export function parseAddressWithLocalAi/);
  assert.match(source, /isAddressTextField\(field\)/);
  assert.match(source, /formatParsedAddressText\(address\)/);
  assert.match(source, /<AddressAiParserButton[\s\S]*initialText=\{formatParsedAddressText\(address\)\}/);
  assert.match(seed, /id: "field-company-domain"[\s\S]*required: false/);
  assert.match(migration, /FROM "ObjectDefinition" object_definition/);
  assert.match(migration, /field_definition\."objectDefinitionId" = object_definition\."id"/);
  assert.match(migration, /object_definition\."key" = 'companies'/);
  assert.match(migration, /"key" = 'domain'/);
});

await run("tag migration is idempotent and included in VPS failed-migration recovery", () => {
  const migration = readFileSync("prisma/migrations/20260711130000_record_activity_tags/migration.sql", "utf8");
  const ensureMigration = readFileSync("prisma/migrations/20260711143000_ensure_record_activity_tags/migration.sql", "utf8");
  const recoveryScript = readFileSync("scripts/recover-known-failed-migrations.mjs", "utf8");
  const verifyScript = readFileSync("scripts/verify-crm-tags-schema.mjs", "utf8");
  const deployWorkflow = readFileSync(".github/workflows/deploy-vps.yml", "utf8");
  const remoteDeploy = readFileSync("deploy/vps-remote-deploy.sh", "utf8");

  assert.match(migration, /ADD COLUMN IF NOT EXISTS "tags"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "tagColors"/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "CrmRecord_tags_gin_idx"/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "Activity_tags_gin_idx"/);
  assert.match(ensureMigration, /ADD COLUMN IF NOT EXISTS "tags"/);
  assert.match(ensureMigration, /ADD COLUMN IF NOT EXISTS "tagColors"/);
  assert.match(ensureMigration, /CREATE INDEX IF NOT EXISTS "CrmRecord_tags_gin_idx"/);
  assert.match(ensureMigration, /CREATE INDEX IF NOT EXISTS "Activity_tags_gin_idx"/);
  assert.match(recoveryScript, /20260711130000_record_activity_tags/);
  assert.match(recoveryScript, /20260711143000_ensure_record_activity_tags/);
  assert.match(verifyScript, /CrmRecord\.tagColors/);
  assert.match(verifyScript, /Activity\.tagColors/);
  assert.match(deployWorkflow, /deploy\/vps-remote-deploy\.sh/);
  assert.match(remoteDeploy, /20260711130000_record_activity_tags/);
  assert.match(remoteDeploy, /20260711143000_ensure_record_activity_tags/);
  assert.match(remoteDeploy, /ADD COLUMN IF NOT EXISTS "tagColors"/);
  assert.match(remoteDeploy, /verify-crm-tags-schema\.mjs/);
});

await run("record create and detail panels render full width in the main content flow", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.match(source, /recordPanelMode === "closed" && \([\s\S]*<section className="table-shell">/);
  assert.match(source, /recordPanelMode !== "closed" && \([\s\S]*<aside className=\{`detail-panel record-drawer \$\{recordPanelMode === "import" \? "import-drawer-modal" : ""\}`\}>/);
  assert.match(source, /const created = await fetchJson<CrmRecord>\(`\/api\/records\/\$\{activeObject\.key\}`,[\s\S]*method: "POST"[\s\S]*openRecord\(created\)/);
  assert.doesNotMatch(source, /async function submitCreateRecord\(\)[\s\S]*setRecordPanelMode\("closed"\)[\s\S]*async function loadRecordForApprovalDecision/);
  assert.match(source, /className="drawer-header record-panel-header"/);
  assert.match(source, /data-testid="record-panel-back"[\s\S]*runAction\(closeRecordPanel\)[\s\S]*recordReturnEmailThreadId \? "返回邮件" : "返回列表"/);
  assert.match(source, /const \[recordActivityComposerType, setRecordActivityComposerType\] = useState<Activity\["type"\] \| "">\(""\)/);
  assert.match(source, /setRecordActivityComposerType\(""\);[\s\S]*selectedRecord\?\.id/);
  assert.match(source, /function RecordSectionHeader/);
  assert.match(source, /aria-expanded=\{isOpen\}/);
  assert.match(source, /isOpen \? <ChevronDown size=\{16\} \/> : <Plus size=\{16\} \/>/);
  assert.match(source, /function RecordActivityComposer/);
  assert.match(source, /data-testid=\{`\$\{testIdPrefix\}-composer`\}/);
  assert.match(source, /recordActivityComposerType === "task" \? \([\s\S]*<RecordActivityComposer[\s\S]*type="task"/);
  assert.match(source, /recordActivityComposerType === "note" \? \([\s\S]*<RecordActivityComposer[\s\S]*type="note"/);
  assert.match(source, /recordActivityComposerType === "call" \? \([\s\S]*<RecordActivityComposer[\s\S]*type="call"/);
  assert.match(source, /recordActivityComposerType === "meeting" \? \([\s\S]*<RecordActivityComposer[\s\S]*type="meeting"/);
  assert.match(source, /onToggle=\{\(\) => setRecordActivityComposerType\(\(current\) => \(current === "task" \? "" : "task"\)\)\}/);
  assert.match(source, /setRecordActivityComposerType\(""\);[\s\S]*setMessage\("已添加任务"\)/);
  assert.match(source, /<div className=\{`record-activity-grid \$\{selectedRecordUsesActivityTabs \? "contact-detail-tab-panel" : ""\}`\}>/);
  assert.match(source, /title="任务"/);
  assert.match(source, /title="备注"/);
  assert.match(source, /title="电话"/);
  assert.match(source, /title="会议"/);
  assert.match(source, /type="task"[\s\S]*testIdPrefix="record-task"/);
  assert.match(source, /type="note"[\s\S]*testIdPrefix="record-note"/);
  assert.match(source, /type="call"[\s\S]*testIdPrefix="record-call"/);
  assert.match(source, /type="meeting"[\s\S]*testIdPrefix="record-meeting"/);
  assert.match(source, /<ActivityTimeline[\s\S]*testIdPrefix="record-activity"/);
  assert.match(source, /function activityTimelineIcon\(type: Activity\["type"\]\): LucideIcon/);
  assert.match(source, /case "email":[\s\S]*return Mail/);
  assert.match(source, /case "stage_change":[\s\S]*return Trophy/);
  assert.match(styles, /\.activity-timeline-item \{[\s\S]*grid-template-columns: 42px minmax\(0, 1fr\);/);
  assert.match(styles, /\.activity-timeline-item::before/);
  assert.match(styles, /\.activity-timeline-marker\.email/);
  assert.match(styles, /\.activity-timeline-card/);
  assert.doesNotMatch(source, /data-testid="activity-type"/);
  assert.doesNotMatch(source, /data-testid="activity-submit"/);
  assert.doesNotMatch(source, /aria-label="关闭面板"[\s\S]{0,120}setRecordPanelMode\("closed"\)/);
  assert.match(styles, /\.workspace-grid\.has-drawer \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styles, /\.record-drawer \{[\s\S]*order: -1;[\s\S]*position: static;[\s\S]*max-height: none;[\s\S]*overflow: visible;/);
  assert.match(styles, /\.record-drawer \.drawer-header \{\s*position: static;/);
  assert.match(styles, /\.record-panel-header \{[\s\S]*justify-content: flex-start;/);
  assert.match(styles, /\.record-activity-grid \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(styles, /\.record-activity-card \{/);
  assert.match(styles, /@media \(max-width: 760px\) \{[\s\S]*\.record-activity-grid \{[\s\S]*grid-template-columns: 1fr;/);
  assert.match(styles, /\.record-section-header \{/);
  assert.match(styles, /\.record-activity-composer \{/);
  assert.doesNotMatch(styles, /\.workspace-grid\.has-drawer \{[\s\S]{0,120}minmax\(360px, 440px\)/);
  assert.doesNotMatch(styles, /\.record-drawer \{\s*position: sticky/);
});

await run("task workspace exposes todo completed archived and delete actions", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const route = readFileSync("src/app/api/activities/[id]/route.ts", "utf8");
  const repository = readFileSync("src/lib/crm/repository.ts", "utf8");

  assert.match(source, /useState<"todo" \| "completed" \| "archived">\("todo"\)/);
  assert.match(source, /data-testid="task-tab-todo"/);
  assert.match(source, /data-testid="task-tab-completed"/);
  assert.match(source, /data-testid="task-tab-archived"/);
  assert.match(source, /body: \{ archivedAt: archived \? new Date\(\)\.toISOString\(\) : null \}/);
  assert.match(source, /method: "DELETE"/);
  assert.match(source, /body: \{ changeReason: changeReason\.trim\(\) \}/);
  assert.match(source, /pendingActivityDeleteRequestsById/);
  assert.match(source, /删除待审核/);
  assert.match(source, /取消删除申请/);
  assert.match(source, /onDelete=\{\(activity\) => \{ void runImmediateAction\(\(\) => deleteTask\(activity\)\); \}\}/);
  assert.match(source, /data-testid=\{testIdPrefix \? `\$\{testIdPrefix\}-archive-\$\{activity\.id\}` : undefined\}/);
  assert.match(source, /data-testid=\{testIdPrefix \? `\$\{testIdPrefix\}-delete-\$\{activity\.id\}` : undefined\}/);
  assert.match(source, /activity\.completedAt \|\| activity\.archivedAt \|\| !activity\.dueAt/);
  assert.match(route, /export const DELETE = withApiMetrics\("DELETE \/api\/activities\/\[id\]"/);
  assert.match(route, /parseOptionalJson\(request, recordDeleteRequestSchema, \{\}\)/);
  assert.match(route, /requestActivityDelete\(context, params\.id, body\.changeReason \?\? ""\)/);
  assert.match(repository, /async requestActivityDelete\(context: RequestContext, activityId: string, reason: string\): Promise<RecordChangeRequest>/);
  assert.match(repository, /objectKey: "activities"[\s\S]*recordId: activity\.id[\s\S]*action: "delete"/);
  assert.match(repository, /request\.action === "delete" && request\.objectKey === "activities"[\s\S]*await this\.deleteActivity\(context, request\.recordId\)/);
});

await run("task workspace exposes calendar views and date slot task creation", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.match(source, /type TaskCalendarView = "list" \| "month" \| "week" \| "day"/);
  assert.match(source, /type TaskCreateInput = \{[\s\S]*title: string;[\s\S]*dueAt\?: string;/);
  assert.match(source, /useState<TaskCalendarView>\("list"\)/);
  assert.match(source, /data-testid="task-create-from-list"/);
  assert.match(source, /data-testid="task-edit-title"/);
  assert.match(source, /data-testid="task-edit-due-at"/);
  assert.match(source, /data-testid="task-edit-body"/);
  assert.match(source, /data-testid="task-edit-save"/);
  assert.match(source, /data-testid="task-attachment-grid"/);
  assert.match(source, /data-testid="task-edit-media-library"/);
  assert.match(source, /type TaskAttachment = \{/);
  assert.match(source, /format: "task\.v1"/);
  assert.match(source, /function parseTaskDetails/);
  assert.match(source, /function serializeTaskDetails/);
  assert.match(source, /function TaskEditDialog/);
  assert.match(source, /function TaskAttachmentPreview/);
  assert.match(source, /onUpdateTask=\{\(activity, draft\) => runAction\(\(\) => updateTask\(activity, draft\)\)\}/);
  assert.match(source, /method: "PATCH"[\s\S]*body: \{[\s\S]*title: draft\.title,[\s\S]*body: serializeTaskDetails/);
  assert.doesNotMatch(source, /setDeletedActivityIds\(\(current\) => new Set\(\[\.\.\.current, activity\.id\]\)\)/);
  assert.match(source, /data-testid=\{`task-view-\$\{mode\}`\}/);
  assert.match(source, /data-testid=\{`task-calendar-\$\{view\}`\}/);
  assert.match(source, /function TaskMonthCalendar/);
  assert.match(source, /function TaskWeekCalendar/);
  assert.match(source, /function TaskDayCalendar/);
  assert.match(source, /function requestTaskWithoutDate\(\)/);
  assert.match(source, /onRequestPrompt\(\{/);
  assert.match(source, /onCreateTask\(\{ title: trimmedTitle, dueAt: dueAt\.toISOString\(\) \}\)/);
  assert.match(source, /onCreateTask\(\{ title: trimmedTitle \}\)/);
  assert.match(source, /fetchJson<Activity>\("\/api\/activities", \{/);
  assert.match(source, /type: "task",[\s\S]*title: input\.title,[\s\S]*dueAt: input\.dueAt \|\| undefined/);
  assert.match(styles, /\.task-month-calendar \{[\s\S]*grid-template-columns: repeat\(7, minmax\(140px, 1fr\)\);/);
  assert.match(styles, /\.task-week-calendar \{[\s\S]*grid-template-columns: 68px repeat\(7, minmax\(150px, 1fr\)\);/);
  assert.match(styles, /\.task-day-slot \{[\s\S]*grid-template-columns: 78px minmax\(0, 1fr\);/);
  assert.match(styles, /\.task-edit-dialog/);
  assert.match(styles, /\.task-attachment-grid/);
  assert.match(styles, /\.task-attachment-item/);
});

await run("contact and company lists render avatar and logo media fields", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const seed = readFileSync("src/lib/crm/seed.ts", "utf8");
  const migration = readFileSync("prisma/migrations/20260625_contact_avatar_company_logo/migration.sql", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.match(seed, /objectKey: "contacts", key: "avatarUrl"/);
  assert.match(seed, /objectKey: "companies", key: "logoUrl"/);
  assert.match(migration, /'avatarUrl'/);
  assert.match(migration, /'logoUrl'/);
  assert.match(source, /function RecordTitleButton/);
  assert.match(source, /record\.objectKey === "contacts" \? record\.data\.avatarUrl : record\.objectKey === "companies" \? record\.data\.logoUrl/);
  assert.match(source, /<RecordTitleButton record=\{record\} onOpen=\{\(\) => openRecord\(record\)\} \/>/);
  assert.match(source, /className="record-name-cell"/);
  assert.match(source, /className=\{`record-owner-meta \$\{record\.ownerId \? "" : "public"\}`\}/);
  assert.match(source, /return owner \? `私海 · \$\{owner\.name\}` : "私海"/);
  assert.match(source, /field\.objectKey === "contacts" && field\.key === "avatarUrl"/);
  assert.match(source, /field\.objectKey === "companies" && field\.key === "logoUrl"/);
  assert.match(source, /record\.objectKey === "contacts" && column\.field\.key === "avatarUrl"/);
  assert.match(source, /record\.objectKey === "companies" && column\.field\.key === "logoUrl"/);
  assert.match(styles, /\.record-title-with-media/);
  assert.match(styles, /\.record-name-cell/);
  assert.match(styles, /\.record-owner-meta/);
  assert.match(styles, /\.record-list-avatar/);
  assert.match(styles, /\.record-list-logo/);
});

await run("contact and company country fields use searchable sovereign country options", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const countries = readFileSync("src/lib/crm/countries.ts", "utf8");
  const addressParser = readFileSync("src/lib/crm/address-parser.ts", "utf8");
  const seed = readFileSync("src/lib/crm/seed.ts", "utf8");
  const migration = readFileSync("prisma/migrations/20260702090000_add_contact_company_country_fields/migration.sql", "utf8");

  assert.match(countries, /export const countryOptions/);
  assert.equal((countries.match(/code: "/g) ?? []).length, 195);
  assert.match(countries, /name: "United States"/);
  assert.match(countries, /name: "China"/);
  assert.match(countries, /name: "Holy See"/);
  assert.match(countries, /name: "Palestine"/);
  assert.match(countries, /name: "Zimbabwe"/);
  assert.doesNotMatch(countries, /name: "Hong Kong"/);
  assert.match(countries, /developmentTier: "advanced"[\s\S]*name: "China"[\s\S]*developmentTier: "upper_middle_income"[\s\S]*name: "India"[\s\S]*developmentTier: "lower_middle_income"/);
  assert.match(countries, /meta: `\$\{country\.code\} - \$\{country\.developmentLabel\}`/);
  assert.match(source, /import \{ getCountryLabel, getCountrySelectOptions \} from "@\/lib\/crm\/countries"/);
  assert.match(source, /function CountrySearchInput/);
  assert.match(source, /function isCountryField\(field: FieldDefinition\): boolean \{[\s\S]*contacts[\s\S]*companies[\s\S]*field\.key === "country"/);
  assert.match(source, /options=\{getCountrySelectOptions\(\)\}/);
  assert.match(source, /\$\{option\.label\} \$\{option\.value\} \$\{option\.meta \?\? ""\}/);
  assert.match(source, /testId=\{`\$\{testIdPrefix\}-country-\$\{index\}`\}/);
  assert.match(source, /testId=\{`\$\{testIdPrefix\}-country`\}/);
  assert.match(addressParser, /getCountryLabel\(address\.country\)/);
  assert.match(seed, /objectKey: "contacts", key: "country"/);
  assert.match(seed, /objectKey: "companies", key: "country"/);
  assert.match(seed, /columns: \["title", "contactTempCustomerLevel", "email", "phone", "companyId", "country", "birthday", "gender"\]/);
  assert.match(seed, /columns: \["title", "customerLevel", "domain", "industry", "country", "billingAddresses", "shippingAddresses"\]/);
  assert.match(migration, /'country', '国家\/地区', 'text'/);
  assert.match(migration, /ARRAY\['title', 'email', 'phone', 'companyId', 'country', 'birthday', 'gender'\]/);
  assert.match(migration, /ARRAY\['title', 'domain', 'industry', 'country', 'billingAddresses', 'shippingAddresses'\]/);
});

await run("address parser maps UK aliases and postcodes into CRM country values", () => {
  const parsed = parseAddressWithLocalAi("27 Tresham Road\nOrton Southgate, Peterborough, UK\nPE2 6SG");

  assert.equal(parsed.country, "United Kingdom");
  assert.equal(parsed.region ?? "", "");
  assert.equal(parsed.city, "Peterborough");
  assert.equal(parsed.postalCode, "PE2 6SG");
  assert.equal(parsed.line1, "27 Tresham Road");
  assert.equal(parsed.line2, "Orton Southgate");
  assert.equal(resolveCountry("UK")?.name, "United Kingdom");
  assert.equal(resolveCountry("U.S.A.")?.name, "United States");
});

await run("contact and company communication preferences drive compose translation and scheduling", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const languages = readFileSync("src/lib/crm/languages.ts", "utf8");
  const seed = readFileSync("src/lib/crm/seed.ts", "utf8");
  const migration = readFileSync("prisma/migrations/20260704120000_contact_company_preferences/migration.sql", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.equal(getCountryOfficialLanguage("China"), "zh-CN");
  assert.equal(getCountryOfficialLanguage("US"), "en");
  assert.equal(getLanguageLabel("zh-CN"), "Chinese (Simplified)");
  assert.equal(getLanguageSelectOptions().some((option) => option.value === "es" && option.label.includes("Spanish")), true);
  assert.match(languages, /export const languageOptions/);
  assert.match(languages, /officialLanguageByCountryCode/);
  assert.match(languages, /resolveCountry\(country\)/);

  assert.match(seed, /objectKey: "contacts", key: "preferredLanguage"/);
  assert.match(seed, /objectKey: "contacts", key: "preferredContactWindow"/);
  assert.match(seed, /objectKey: "companies", key: "preferredLanguage"/);
  assert.match(seed, /objectKey: "companies", key: "preferredContactWindow"/);
  assert.match(seed, /preferredLanguage: "zh-CN"/);
  assert.match(seed, /preferredContactWindow: \{ timezone: "Asia\/Shanghai", daysOfWeek: \[1, 2, 3, 4, 5\], startTime: "09:00", endTime: "18:00" \}/);
  assert.match(migration, /'preferredLanguage'/);
  assert.match(migration, /'preferredContactWindow'/);
  assert.match(migration, /jsonb_set\("data", '\{preferredLanguage\}', '"zh-CN"', true\)/);

  assert.match(source, /function LanguageSearchInput/);
  assert.match(source, /function PreferredContactWindowInput/);
  assert.match(source, /isPreferredLanguageField\(field\)/);
  assert.match(source, /isPreferredContactWindowField\(field\)/);
  assert.match(source, /getLanguageSelectOptions\(\)/);
  assert.match(source, /data-testid="email-compose-auto-translate"/);
  assert.match(source, /data-testid="email-compose-preferred-time"/);
  assert.match(source, /data-testid="email-compose-preference-preview"/);
  assert.match(source, /computeNextPreferredSendAt/);
  assert.match(source, /buildPreferenceAwareDrafts/);
  assert.match(source, /purpose: "translate"/);
  assert.match(source, /targetLocale: preference\.language/);
  assert.match(source, /function resolveEmailDraftAiTargetLocale\(\): string \| undefined/);
  assert.match(source, /targetLocale,\s*userPrompt: prompt \|\| undefined/);
  assert.match(source, /targetLocale,\s*userPrompt: `请用简体中文生成一段简洁、可执行的邮件撰写 Agent 提示词/);
  assert.match(source, /const contact = contactByEmail \?\? linkedContact/);
  assert.match(source, /主题和正文都必须使用该语言/);
  assert.match(source, /translatedBodyText: translatedText/);
  assert.match(source, /scheduledSendAt: sendAt/);
  assert.match(source, /const sendAt = emailDraft\.scheduledSendAt\s*\?\?/);
  assert.match(source, /function formatRecipientSendTime\(value: string, timezone\?: string\)/);
  assert.match(source, /北京时间 \$\{beijingTime\} · 当地时间 \$\{localTime\}（\$\{timezone\}）/);
  assert.match(source, /formatRecipientSendTime\(preference\.scheduledSendAt, preference\.contactWindow\?\.timezone\)/);
  assert.match(source, /定时发送优先 · 将在 \{scheduledSendTimeLabel\} 发送/);
  assert.match(source, /function formatScheduledSendTimeForRecipients/);
  assert.match(source, /各收件人当地时间见下方/);
  assert.match(source, /收件人发送时间预览/);
  assert.match(source, /未配置偏好时段，将立即发送/);
  assert.match(styles, /\.email-preference-preview/);
  assert.match(styles, /\.preferred-window-editor/);
});

await run("contact detail uses a social profile layout instead of a flat form", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.match(source, /selectedRecord\.objectKey === "contacts" \? \(/);
  assert.match(source, /<ContactProfileEditor/);
  assert.match(source, /saveLabel=\{editApprovalObjectKeys\.has\(selectedRecord\.objectKey\) \? "提交修改审批" : "保存"\}/);
  assert.match(source, /onSave=\{\(\) => runRecordSaveAction\(submitUpdateRecord\)\}/);
  assert.match(source, /const editApprovalObjectKeys = new Set\(\["contacts", "companies", "deals"\]\)/);
  assert.match(source, /function loadRecordForApprovalDecision/);
  assert.match(source, /fetchJson<CrmRecord>\(`\/api\/records\/\$\{record\.objectKey\}\/\$\{record\.id\}`/);
  assert.match(source, /const approvalBaselineRecord = await loadRecordForApprovalDecision\(selectedRecord\)/);
  assert.match(source, /hasRecordPatchChanges\(splitRecordApprovalPatch\(approvalBaselineRecord, updatePatch\)\.approvalPatch\)/);
  assert.match(source, /type RecordApprovalReasonRequiredResponse = \{ approvalReasonRequired: true \}/);
  assert.match(source, /if \("approvalReasonRequired" in result\) \{[\s\S]*const fallbackReason = await requestPrompt\(\{/);
  const recordRoute = readFileSync("src/app/api/records/[objectKey]/[recordId]/route.ts", "utf8");
  assert.match(recordRoute, /hasRecordPatchChanges\(approvalPatch\) && !changeReason\?\.trim\(\)[\s\S]*approvalReasonRequired: true/);
  assert.match(recordRoute, /pendingApproval: true, request: approvalRequest, record: updatedRecord/);
  assert.match(source, /const approvalBaselineRecord = await loadRecordForApprovalDecision\(targetRecord\)/);
  assert.match(source, /hasRecordPatchChanges\(splitRecordApprovalPatch\(approvalBaselineRecord, contactMethodPatch\)\.approvalPatch\)/);
  assert.match(source, /const contactMethodData: Record<string, unknown> = \{[\s\S]*contactMethods: methods[\s\S]*\}/);
  assert.match(source, /if \(hasPhoneMethod \|\| hadPhoneMethod\) \{[\s\S]*contactMethodData\.phone = primaryPhone/);
  assert.match(source, /function getContactMethodPhone\(methods: ContactMethodDraft\[\]\): string \{[\s\S]*method\.type === "mob" \|\| method\.type === "tel"/);
  assert.doesNotMatch(source, /function getContactMethodPhone\(methods: ContactMethodDraft\[\]\): string \{[\s\S]*method\.type === "whatsapp"[\s\S]*\}/);
  assert.match(source, /if \("pendingApproval" in result\) \{[\s\S]*setRecords\(\(current\) => mergeRecords\(current, \[result\.record\]\)\)/);
  assert.match(source, /function mergeRecord\(existing: CrmRecord, incoming: CrmRecord\): CrmRecord \{[\s\S]*data: \{[\s\S]*\.\.\.existing\.data,[\s\S]*\.\.\.incoming\.data[\s\S]*\}/);
  assert.doesNotMatch(source, /new Map\(records\.map\(\(record\) => \[record\.id, record\]\)\)/);
  assert.match(source, /previousRecordApprovalPatch\(patch\)/);
  assert.match(source, /const \[isRecordSavePending, setIsRecordSavePending\] = useState\(false\)/);
  assert.match(source, /setRecordChangeRequests\(\(current\) => mergeRecordChangeRequests\(current, \[result\.request\]\)\)/);
  assert.match(source, /const selectedRecordPendingUpdateRequest = useMemo/);
  assert.match(source, /<RecordUpdatePendingBanner/);
  assert.match(source, /pendingUpdateRequest=\{selectedRecordPendingUpdateRequest\}/);
  assert.match(source, /data-testid="record-update-pending-banner"/);
  assert.match(source, /function buildRecordUpdateDiffs/);
  assert.match(source, /data-testid="contact-profile-layout"/);
  assert.match(source, /<ContactProfileInfoStrip/);
  assert.match(source, /testId="contact-profile-info-strip"/);
  assert.doesNotMatch(source, /资料已建立|公司已关联|可直接联系|可持续跟进/);
  assert.match(source, /function EditableFieldRow/);
  assert.match(source, /function EditableOwnerRow/);
  assert.match(source, /function submitSingleRecordField/);
  assert.match(source, /data: \{\s*\[field\.key\]: parseSingleFieldValue\(field, nextValue\)/);
  assert.match(source, /onSaveField=\{submitSingleRecordField\}/);
  assert.match(source, /<EditableFieldRow[\s\S]*onSave=\{\(nextValue\) => onSaveField\(field, nextValue\)\}/);
  assert.match(source, /<EditableOwnerRow[\s\S]*onSave=\{onSaveOwner\}/);
  assert.match(source, /<ContactDetailActivityTabs/);
  assert.match(source, /activeTab=\{contactDetailActivityTab\}/);
  assert.match(source, /onChange=\{setContactDetailActivityTab\}/);
  assert.match(source, /const selectedRecordUsesActivityTabs = selectedRecord \? \["contacts", "companies", "deals"\]\.includes\(selectedRecord\.objectKey\) : false/);
  assert.match(source, /showContactEmailSections/);
  assert.match(source, /showContactActivityTimeline/);
  assert.match(source, /className=\{selectedRecordUsesActivityTabs \? "contact-detail-tab-panel" : ""\}/);
  assert.match(source, /record-activity-grid \$\{selectedRecordUsesActivityTabs \? "contact-detail-tab-panel" : ""\}/);
  assert.match(source, /selectedRecordQuickContactMethods\.length > 0 && \(!selectedRecordUsesActivityTabs \|\| showContactAllSections\)/);
  assert.match(source, /selectedRecordEmailAddresses\.length > 0 \|\| selectedRecordEmailThreads\.length > 0\) && \(!selectedRecordUsesActivityTabs \|\| showContactEmailSections\)/);
  assert.match(source, /data-testid=\{`contact-detail-activity-tab-\$\{tab\.key\}`\}/);
  assert.match(source, /aria-pressed=\{activeTab === tab\.key\}/);
  assert.match(source, /data-testid="contact-detail-activity-tabs"/);
  assert.match(source, /function ContactProfileEditor/);
  assert.match(source, /function ContactProfileInfoStrip/);
  assert.match(source, /function ContactDetailActivityTabs/);
  assert.match(source, /function ContactAvatarEditor/);
  assert.match(source, /ContactMethodsEditor[\s\S]*showContactMethodEditor/);
  assert.match(styles, /\.contact-profile-layout/);
  assert.match(styles, /\.contact-profile-hero/);
  assert.match(styles, /\.contact-profile-info-strip/);
  assert.match(styles, /\.contact-profile-info-item/);
  assert.match(styles, /\.contact-profile-info-label/);
  assert.match(styles, /\.editable-field-row/);
  assert.match(styles, /\.editable-field-dialog/);
  assert.match(styles, /\.contact-detail-activity-tabs/);
  assert.match(styles, /\.contact-detail-activity-tab:hover/);
  assert.match(styles, /\.contact-detail-activity-tab\.active/);
  assert.match(styles, /\.contact-detail-tab-panel \{[\s\S]*min-height: max\(320px, 42vh\);/);
  assert.match(styles, /\.contact-detail-tab-panel > \.empty-state \{[\s\S]*place-items: center;/);
  assert.match(styles, /\.contact-profile-hero\.update-pending/);
  assert.match(styles, /\.record-update-pending-banner/);
  assert.match(styles, /\.record-change-old-value[\s\S]*text-decoration: line-through/);
  assert.match(styles, /\.record-change-new-value/);
  assert.match(styles, /\.contact-profile-avatar/);
  assert.match(styles, /\.contact-profile-grid/);
});

await run("company detail uses the same profile layout pattern as contacts", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.match(source, /selectedRecord\.objectKey === "companies" \? \(/);
  assert.match(source, /<CompanyProfileEditor/);
  assert.match(source, /saveLabel=\{editApprovalObjectKeys\.has\(selectedRecord\.objectKey\) \? "提交修改审批" : "保存"\}/);
  assert.match(source, /onSave=\{\(\) => runRecordSaveAction\(submitUpdateRecord\)\}/);
  assert.match(source, /pendingUpdateRequest=\{selectedRecordPendingUpdateRequest\}/);
  assert.match(source, /data-testid="company-profile-layout"/);
  assert.match(source, /<CompanyProfileInfoStrip/);
  assert.match(source, /testId="company-profile-info-strip"/);
  assert.match(source, /<CompanyProfileEditor[\s\S]*<ContactDetailActivityTabs/);
  assert.match(source, /selectedRecord\.objectKey === "companies" && showContactAllSections/);
  assert.match(source, /function CompanyProfileEditor/);
  assert.match(source, /function CompanyProfileInfoStrip/);
  assert.match(source, /function CompanyLogoEditor/);
  assert.match(source, /<EditablePrimaryContactRow[\s\S]*primaryContactId/);
  assert.match(source, /function EditablePrimaryContactRow/);
  assert.match(source, /<CompanyAddressCards[\s\S]*testIdPrefix="edit-company-billing-address"/);
  assert.match(source, /<CompanyAddressCards[\s\S]*testIdPrefix="edit-company-shipping-address"/);
  assert.match(styles, /\.company-profile-cover/);
  assert.match(styles, /\.company-profile-logo/);
  assert.match(styles, /\.company-profile-addresses/);
});

await run("deal detail uses profile layout with a one-click stage bar", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.match(source, /selectedRecord\.objectKey === "deals" \? \(/);
  assert.match(source, /<DealProfileEditor/);
  assert.match(source, /stages=\{activePipelineStages\}/);
  assert.match(source, /onMoveStage=\{\(stageKey\) => runAction\(\(\) => moveDealStage\(selectedRecord, stageKey\)\)\}/);
  assert.match(source, /function DealProfileEditor/);
  assert.match(source, /function DealStageProgressBar/);
  assert.match(source, /function DealProfileInfoStrip/);
  assert.match(source, /data-testid="deal-profile-layout"/);
  assert.match(source, /testId="deal-profile-info-strip"/);
  assert.match(source, /<DealProfileEditor[\s\S]*<ContactDetailActivityTabs/);
  assert.match(source, /selectedRecord\.objectKey === "deals" && showContactAllSections/);
  assert.match(source, /data-testid="deal-stage-progress-bar"/);
  assert.match(source, /data-testid=\{`deal-stage-bar-\$\{stage\.key\}`\}/);
  assert.match(source, /onClick=\{\(\) => onMoveStage\(stage\.key\)\}/);
  assert.match(source, /\/api\/records\/\$\{record\.objectKey\}\/\$\{record\.id\}\/stage/);
  assert.match(source, /<EditableFieldRow[\s\S]*key=\{`deal-profile-\$\{field\.id\}`\}/);
  assert.match(source, /<EditableFieldRow[\s\S]*key=\{`deal-relation-\$\{field\.id\}`\}/);
  assert.match(styles, /\.deal-profile-cover/);
  assert.match(styles, /\.deal-profile-avatar/);
  assert.match(styles, /\.deal-profile-stage-bar/);
  assert.match(styles, /\.deal-profile-stage-button/);
  assert.match(styles, /\.deal-profile-stage-button\.active/);
  assert.match(styles, /\.deal-profile-stage-button\.completed/);
  assert.match(styles, /\.deal-profile-stage-empty/);
});

await run("workspace exposes product and quote modules as first-class crm objects", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");
  assert.match(source, /key: "products", label: "产品", icon: Package/);
  assert.match(source, /key: "sales-documents", label: "销售单据", icon: ReceiptText/);
  assert.match(source, /salesDocumentTabItems = \[/);
  assert.match(source, /objectKey: "quotes", label: "报价", icon: FileText/);
  assert.match(source, /data-testid=\{`sales-document-tab-\$\{item\.objectKey\}`\}/);
  assert.match(styles, /\.sales-document-tabs/);
  assert.match(source, /new Set\(\["contacts", "companies", "deals", "products", "quotes", "salesorders", "proformainvoices", "commercialinvoices"\]\)/);
  assert.match(source, /objectKey === "products"[\s\S]*SKU-AI-SALES-STD/);
  assert.match(source, /objectKey === "quotes"[\s\S]*companyId,contactId,paymentTerm,totalAmount/);
  assert.match(source, /QuotePricingEditor/);
  assert.match(source, /SearchDropdown/);
  assert.match(source, /compat-select/);
  assert.match(source, /const inputRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(source, /className="search-dropdown-menu floating" style=\{menuStyle\}/);
  assert.match(styles, /\.search-dropdown-menu\.floating \{[\s\S]*position: fixed;[\s\S]*z-index: 140;/);
});

await run("email workspace refreshes threads and selected messages after sync", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  assert.match(source, /async function refreshEmailThreads\(options: \{ reloadSelectedMessages\?: boolean \} = \{\}\)/);
  assert.match(source, /fetchJson<EmailThread\[]>\("\/api\/email\/threads", \{ method: "GET" \}\)/);
  assert.match(source, /setEmailThreads\(visibleThreads\)/);
  assert.match(source, /await loadEmailMessages\(threadId\)/);
  assert.match(source, /async function syncEmailAccount[\s\S]*await refreshEmailThreads\(\{ reloadSelectedMessages: true \}\)[\s\S]*router\.refresh\(\)/);
  assert.match(source, /async function syncAllEmailAccounts[\s\S]*await refreshEmailThreads\(\{ reloadSelectedMessages: true \}\)[\s\S]*router\.refresh\(\)/);
});

await run("email workspace supports multiple mailbox account filters", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.match(source, /const allEmailAccountsKey = "all"/);
  assert.match(source, /const \[selectedMailboxAccountId, setSelectedMailboxAccountId\] = useState<string>\(routeAccountId\)/);
  assert.match(source, /const \[mailboxAccountsCollapsed, setMailboxAccountsCollapsed\] = useState\(true\)/);
  assert.match(source, /accountFilteredThreads = useMemo/);
  assert.match(source, /thread\.accountId === selectedMailboxAccountId/);
  assert.match(source, /data-testid="email-mailbox-account-switcher"/);
  assert.match(source, /data-testid="email-mailbox-account-all"/);
  assert.match(source, /data-testid=\{`email-mailbox-account-\$\{account\.id\}`\}/);
  assert.match(source, /aria-expanded=\{!mailboxAccountsCollapsed\}/);
  assert.match(source, /aria-label=\{mailboxAccountsCollapsed \? "展开邮箱账户" : "折叠邮箱账户"\}/);
  assert.match(source, /className="gmail-account-summary-main"[\s\S]*onClick=\{\(\) => selectMailboxAccount\(allEmailAccountsKey\)\}/);
  assert.match(source, /className="gmail-account-summary-toggle"[\s\S]*onClick=\{\(\) => setMailboxAccountsCollapsed\(\(current\) => !current\)\}/);
  assert.match(source, /!mailboxAccountsCollapsed \? \([\s\S]*<div className="gmail-account-list">/);
  assert.match(source, /function syncCurrentMailboxAccount\(\)/);
  assert.match(source, /selectedMailboxAccountId === allEmailAccountsKey[\s\S]*onSyncAllAccounts\(\)/);
  assert.match(source, /onSyncAccount\(selectedMailboxAccountId\)/);
  assert.match(source, /selectedAccountCanSend \? selectedMailboxAccountId : emailDraft\.accountId \|\| activeAccounts\[0\]\?\.id \|\| ""/);
  assert.match(source, /if \(mailbox === "inbox"\) \{[\s\S]*message\.direction === "inbound" && message\.status === "received"/);
  assert.match(source, /\["inbox", "all", "sent", "scheduled", "drafts", "spam", "trash"\]\.includes\(mailbox\)/);
  assert.match(source, /\{ key: "spam", label: "垃圾邮件", icon: ShieldAlert \}/);
  assert.match(source, /message\.inboundMetadata\?\.sourceMailboxRole !== "spam"/);
  assert.match(source, /message\.inboundMetadata\?\.sourceMailboxRole === "spam"/);
  assert.match(source, /const hasInboxMessage = getEmailThreadMailboxMessages\(messages, "inbox"\)\.length > 0/);
  assert.match(source, /!isDeleted && !isArchived && !isSnoozed && hasInboxMessage/);
  assert.doesNotMatch(source, /!hasLoadedMessages \|\| hasInboxMessage/);
  assert.match(styles, /\.gmail-account-folder span \{/);
  assert.match(styles, /\.gmail-account-folder strong,/);
  assert.match(styles, /\.gmail-account-summary \{/);
  assert.match(styles, /\.gmail-account-summary-main \{/);
  assert.match(styles, /\.gmail-account-summary-toggle \{/);
});

await run("email mailbox location is URL based and survives refresh", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");

  assert.match(source, /const routeEmailMailbox = normalizeEmailMailboxKey\(searchParams\.get\("mailbox"\)\)/);
  assert.match(source, /const routeEmailCategory = normalizeEmailCategoryKey\(searchParams\.get\("category"\)\)/);
  assert.match(source, /const routeEmailMode = normalizeEmailMailMode\(searchParams\.get\("mailMode"\)\)/);
  assert.match(source, /const \[emailListDisplayModePreference, setEmailListDisplayModePreference\] = useState<EmailListDisplayMode>\(props\.contextUser\.emailListDisplayMode\)/);
  assert.match(source, /const routeEmailListDisplayMode = searchParams\.has\("mailListView"\) \? normalizeEmailListDisplayMode\(searchParams\.get\("mailListView"\)\) : emailListDisplayModePreference/);
  assert.match(source, /const routeEmailView = normalizeEmailWorkspaceView\(searchParams\.get\("emailView"\)\)/);
  assert.match(source, /const routeEmailAccountId = searchParams\.get\("accountId"\) \?\? allEmailAccountsKey/);
  assert.match(source, /const routeEmailSearch = searchParams\.get\("mailSearch"\) \?\? ""/);
  assert.match(source, /function buildEmailRoutePath\(patch: EmailRoutePatch\)/);
  assert.match(source, /params\.set\("mailbox", patch\.mailbox \?\? "inbox"\)/);
  assert.match(source, /function normalizeEmailListDisplayMode\(value: string \| null\): EmailListDisplayMode/);
  assert.match(source, /if \(patch\.listDisplayMode === "message"\) \{[\s\S]*params\.set\("mailListView", "message"\)/);
  assert.match(source, /if \(patch\.messageId\) \{[\s\S]*params\.set\("emailMessageId", patch\.messageId\)/);
  assert.match(source, /if \(patch\.emailView && patch\.emailView !== "mail"\) \{[\s\S]*params\.set\("emailView", patch\.emailView\)/);
  assert.match(source, /params\.set\("mailMode", "detail"\)[\s\S]*params\.set\("emailThreadId", patch\.threadId\)/);
  assert.match(source, /const \[emailWorkspaceView, setEmailWorkspaceView\] = useState<EmailWorkspaceView>\(routeEmailView\)/);
  assert.match(source, /setEmailWorkspaceView\(routeEmailView\)/);
  assert.match(source, /function pushEmailHistoryRoute\(nextPath: string\)/);
  assert.match(source, /window\.history\.pushState\(window\.history\.state, "", nextPath\)/);
  assert.match(source, /onViewChange=\{\(nextView\) => \{[\s\S]*emailView: nextView[\s\S]*pushEmailHistoryRoute\(nextPath\)/);
  assert.match(source, /onRouteChange=\{\(patch\) => \{[\s\S]*const nextPath = buildEmailRoutePath\(patch\)[\s\S]*pushEmailHistoryRoute\(nextPath\)/);
  assert.match(source, /const applyEmailRoute = useCallback\(\(patch: EmailRoutePatch\) => \{[\s\S]*const nextListDisplayMode = patch\.listDisplayMode \?\? emailListDisplayMode[\s\S]*const nextMessageId = patch\.messageId \?\? \(nextMode === "detail" \? selectedDetailMessageId : ""\)[\s\S]*onRouteChange\(\{[\s\S]*listDisplayMode: nextListDisplayMode[\s\S]*mailbox: nextMailbox[\s\S]*mailMode: nextMode[\s\S]*messageId: nextMessageId[\s\S]*threadId: nextThreadId/);
  assert.match(source, /async function updateCurrentUserPreferencesPatch\(patch: Partial<Pick<User, "emailListDisplayMode">>\)/);
  assert.match(source, /fetchJson<User>\("\/api\/users\/me\/preferences", \{[\s\S]*method: "PATCH"[\s\S]*body: patch/);
  assert.match(source, /onUpdateListDisplayModePreference=\{\(mode\) => \{ void runImmediateAction\(\(\) => updateCurrentUserPreferencesPatch\(\{ emailListDisplayMode: mode \}\)\); \}\}/);
  assert.match(source, /const pendingEmailRouteRef = useRef<\{/);
  assert.match(source, /pendingEmailRouteRef\.current = \{[\s\S]*listDisplayMode: nextListDisplayMode[\s\S]*mailMode: nextMode[\s\S]*threadId: nextThreadId[\s\S]*\}/);
  assert.match(source, /if \(localMatchesPending\) \{[\s\S]*return;[\s\S]*\}/);
  assert.match(source, /onClick=\{\(\) => \{ applyEmailRoute\(\{ mailbox: item\.key, mailMode: "list", threadId: "" \}\)/);
  assert.match(source, /function openThreadDetail\(threadId: string, messageId = ""\)[\s\S]*setSelectedDetailViewMode\("thread"\)[\s\S]*applyEmailRoute\(\{ mailMode: "detail", threadId, messageId \}\)/);
  assert.match(source, /function openSingleMessageDetail\(threadId: string, messageId: string\)[\s\S]*setSelectedDetailViewMode\("message"\)[\s\S]*applyEmailRoute\(\{ mailMode: "detail", threadId, messageId \}\)/);
  assert.match(source, /aria-label="返回列表"[\s\S]*onClick=\{\(\) => applyEmailRoute\(\{ mailMode: "list", threadId: "" \}\)\}/);
  assert.match(source, /data-testid="email-tab-settings"[\s\S]*onClick=\{\(\) => onViewChange\("settings"\)\}/);
  assert.match(source, /data-testid="email-tab-ai"[\s\S]*onClick=\{\(\) => onViewChange\("ai"\)\}/);
});

await run("email thread state updates do not reorder the visible list", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");

  assert.match(source, /function replaceEmailThreadsInPlace\(current: EmailThread\[\], updated: EmailThread\[\]\): EmailThread\[\]/);
  assert.match(source, /const merged = current\.map\(\(thread\) => updates\.get\(thread\.id\) \?\? thread\)/);
  assert.match(source, /setEmailThreads\(\(current\) => replaceEmailThreadsInPlace\(current, fetchedThreads\)\)/);
  assert.match(source, /setEmailThreads\(\(current\) => replaceEmailThreadsInPlace\(current, \[thread\]\)\)/);
});

await run("email category tabs only apply to inbox", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");

  assert.match(source, /if \(patch\.category && patch\.mailbox === "inbox"\) \{[\s\S]*params\.set\("category", patch\.category\)/);
  assert.match(source, /const matchesCategory = mailbox === "inbox" \? threadCategory === category : true/);
  assert.match(source, /\{mailbox === "inbox" \? \([\s\S]*<div className="gmail-category-tabs">/);
  assert.doesNotMatch(source, /mailbox === "inbox" \|\| mailbox === "all" \? threadCategory === category : true/);
});

await run("email account settings separate inbound credentials from outbound services", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const schema = readFileSync("src/lib/crm/api-schemas.ts", "utf8");

  assert.match(source, /defaultOutboundServiceId: string/);
  assert.match(source, /outboundServices: EmailAccountDraftOutboundService\[\]/);
  assert.match(source, /data-testid="email-account-outbound-type"/);
  assert.match(source, /email-account-smtp-username/);
  assert.match(source, /data-testid="email-account-inbound-username"/);
  assert.match(source, /email-account-resend-api-key/);
  assert.match(source, /data-testid="email-test-inbound"/);
  assert.match(source, /data-testid=\{`email-test-outbound-\$\{service\.id\}`\}/);
  assert.match(source, /runAccountConnectionTest\(editingEmailAccount, \{ scope: "inbound" \}\)/);
  assert.match(source, /runAccountConnectionTest\(editingEmailAccount, \{ scope: "outbound", outboundServiceId: service\.id \}\)/);
  assert.match(source, /addOutboundServiceDraft\("smtp"\)/);
  assert.match(source, /addOutboundServiceDraft\("resend"\)/);
  assert.match(source, /SMTP 发件服务/);
  assert.match(source, /Resend 发件服务/);
  assert.match(source, /outboundServices/);
  assert.match(source, /defaultOutboundServiceId: draft\.defaultOutboundServiceId/);
  assert.match(schema, /inbound: emailInboundConnectionConfigSchema\.optional\(\)/);
  assert.match(schema, /outboundServices: z\.array\(emailOutboundServiceConfigSchema\)\.max\(10\)\.optional\(\)/);
  assert.match(schema, /scope: z\.enum\(\["all", "inbound", "outbound"\]\)\.optional\(\)/);
  assert.match(schema, /outboundServiceId: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(120\)\.optional\(\)/);
});

await run("email workspace exposes background sync schedule settings", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const page = readFileSync("src/app/crm-page.tsx", "utf8");
  const route = readFileSync("src/app/api/email/sync-settings/route.ts", "utf8");
  const schema = readFileSync("src/lib/crm/api-schemas.ts", "utf8");
  const migration = readFileSync("prisma/migrations/20260625093000_email_sync_settings/migration.sql", "utf8");
  assert.match(source, /data-testid="email-sync-settings-panel"/);
  assert.match(source, /data-testid="email-sync-enabled"/);
  assert.match(source, /data-testid="email-sync-mode"/);
  assert.match(source, /data-testid="email-sync-interval-minutes"/);
  assert.match(source, /data-testid="email-sync-daily-at"/);
  assert.match(source, /data-testid="email-sync-limit"/);
  assert.match(source, /\/api\/email\/sync-settings/);
  assert.match(page, /getEmailSyncSettings\(context\)/);
  assert.match(route, /emailSyncSettingsUpdateSchema/);
  assert.match(schema, /mode: z\.enum\(\["interval", "daily"\]\)\.optional\(\)/);
  assert.match(schema, /dailyAt: z\.string\(\)\.trim\(\)\.regex/);
  assert.match(migration, /CREATE TABLE "EmailSyncSettings"/);
});

await run("email workspace search supports command autocomplete dropdown", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  assert.match(source, /parseEmailSearchAutocompleteInput/);
  assert.match(source, /emailSearchCommandMeta/);
  assert.match(source, /data-testid="email-search-command-dropdown"/);
  assert.match(source, /data-testid=\{`email-search-suggestion-\$\{suggestion\.kind\}-\$\{suggestion\.command\}`\}/);
  assert.match(source, /buildRecordListUrl\(objectKey, emptySavedView\(objectKey\), trimmedQuery, 1, `\/api\/records\/\$\{objectKey\}`/);
  assert.match(source, /setEmailSearchAutocompleteOpen\(nextAutocompleteInput\.mode !== "none"\)/);
  assert.match(source, /applyEmailSearchSuggestion\(suggestion\)/);
  assert.match(source, /event\.key === "ArrowDown"/);
  assert.match(source, /event\.key === "Enter" \|\| event\.key === "Tab"/);
});

await run("email workspace diagnostics display ai automation eligibility policy", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  assert.match(source, /automationEligibleStatuses\.inbound\.join\("\/"\)/);
  assert.match(source, /automationEligibleStatuses\.outbound\.join\("\/"\)/);
  assert.match(source, /autoContextAnalysisScope/);
  assert.match(source, /budgetPolicy\.maxModelPromptChars/);
  assert.match(source, /budgetPolicy\.maxGeneratedOutputChars/);
  assert.match(source, /accounts\.activeConnectionConfigured/);
  assert.match(source, /accounts\.sendConnectionConfigured/);
  assert.match(source, /accounts\.syncConnectionConfigured/);
  assert.match(source, /syncScheduler\.configuredUserId/);
  assert.match(source, /syncScheduler\.userIdSource/);
  assert.match(source, /syncScheduler\.fallbackToAdmin/);
  assert.match(source, /featureDependencies\.map/);
  assert.match(source, /dependency\.feature\} needs \{dependency\.dependsOn/);
  assert.match(source, /provider\.missingScopes\.length/);
  assert.match(source, /missing scopes: \$\{provider\.missingScopes\.join\(", "\)\}/);
});

await run("email workspace displays compact thread summary provenance", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");
  assert.match(source, /className="gmail-ai-summary-grid"[\s\S]*data-testid="email-thread-summary"[\s\S]*data-testid="email-thread-analysis"/);
  assert.match(source, /data-testid="email-thread-summary"/);
  assert.match(source, /data-testid="email-thread-summary"[\s\S]*data-testid="email-thread-summarize"/);
  assert.match(source, /aiSettings\.features\.auto_summarize/);
  const actionStart = source.indexOf('className="email-thread-actions gmail-detail-actions"');
  const summaryStart = source.indexOf('data-testid="email-thread-summary"');
  const actionSection = source.slice(actionStart, summaryStart);
  assert.doesNotMatch(actionSection, /data-testid="email-thread-summarize"/);
  assert.doesNotMatch(actionSection, /data-testid="email-thread-analyze"/);
  assert.match(source, /selectedThread\?\.summaryUpdatedAt/);
  assert.match(source, /selectedThread\.summary/);
  assert.match(styles, /\.gmail-ai-summary-grid \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*margin: 0 36px;/);
  assert.match(styles, /\.email-message-list \{[\s\S]*margin: 12px 36px 0;/);
  assert.match(styles, /\.gmail-detail-pane > \.talk-panel \{[\s\S]*margin: 12px 36px 0;/);
  assert.match(styles, /\.gmail-ai-summary-grid \{[\s\S]*grid-template-columns: 1fr;[\s\S]*margin: 0 12px;/);
  assert.match(source, /用于后续 AI 上下文/);
  assert.match(source, /减少长线程 token 消耗/);
});

await run("email workspace labels ai output provenance and human review", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  assert.match(source, /data-testid="email-ai-result-provenance"/);
  assert.match(source, /aiResult\.sources\.length \? "badge" : "danger-badge"/);
  assert.match(source, /来源 \{aiResult\.sources\.length\}/);
  assert.match(source, /发送前人工确认/);
});

await run("email workspace labels ai-assisted draft provenance before send", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  assert.match(source, /emailDraft\.aiSources\?\.length \? "badge" : "danger-badge"/);
  assert.match(source, /来源 \{emailDraft\.aiSources\?\.length \?\? 0\}/);
  assert.match(source, /发送时保留 AI provenance/);
  assert.match(source, /aiGeneratedAt \? ` · \$\{formatDate\(emailDraft\.aiGeneratedAt\)\}`/);
});

await run("email ai feature toggles allow disabling stale dependent automations", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  assert.match(source, /checked=\{enabled\}/);
  assert.match(source, /disabled=\{dependencyBlocked && !enabled\}/);
  assert.match(source, /isEmailAiFeatureBlockedByDependency\(featureKey, aiSettings\.features\)/);
});

await run("email workspace summarizes ai token and automation policy", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  assert.match(source, /const enabledEmailAiAutomationCount = \[aiSettings\.features\.auto_translate, aiSettings\.features\.auto_context_analysis, aiSettings\.features\.auto_summarize\]\.filter\(Boolean\)\.length/);
  assert.match(source, /const activeKnowledgeArticleCount = knowledgeArticles\.filter\(\(article\) => article\.active\)\.length/);
  assert.match(source, /data-testid="email-ai-policy-summary"/);
  assert.match(source, /自动任务 \{enabledEmailAiAutomationCount\}\/3/);
  assert.match(source, /来源引用 \{aiSettings\.requireSourceLinks \? "必需" : "可选"\}/);
  assert.match(source, /知识 \{activeKnowledgeArticleCount\}\/\{aiSettings\.maxKnowledgeArticles\}/);
  assert.match(source, /data-testid="email-ai-token-policy"[\s\S]*草稿、队列、发送中和失败邮件不会进入自动 AI 上下文/);
});

await run("email workspace can edit existing knowledge articles for ai context", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const knowledgeManager = readFileSync("src/components/knowledge-base-manager.tsx", "utf8");
  assert.match(knowledgeManager, /editingArticleId\?: string/);
  assert.match(source, /if \(knowledgeDraft\.editingArticleId\)/);
  assert.match(source, /\/api\/knowledge\/articles\/\$\{knowledgeDraft\.editingArticleId\}/);
  assert.match(source, /method: "PATCH"[\s\S]*title: knowledgeDraft\.title[\s\S]*body: knowledgeDraft\.body[\s\S]*tags: splitEmailList\(knowledgeDraft\.tags\)[\s\S]*active: knowledgeDraft\.active/);
  assert.match(source, /<KnowledgeBaseManager/);
  assert.match(knowledgeManager, /data-testid="knowledge-edit"/);
  assert.match(knowledgeManager, /onKnowledgeDraftChange\(\{ editingArticleId: article\.id, title: article\.title, body: article\.body, tags: article\.tags\.join\(", "\), active: article\.active \}\)/);
  assert.match(knowledgeManager, /data-testid="knowledge-edit-cancel"/);
  assert.match(knowledgeManager, /data-testid="knowledge-toggle"/);
});

await run("talk about this panel can chat and save transcript to rag knowledge", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  assert.match(source, /type TalkTarget =[\s\S]*type: "record"[\s\S]*type: "email_thread"/);
  assert.match(source, /function TalkAboutThisPanel/);
  assert.match(source, /data-testid="talk-about-this"/);
  assert.match(source, /const \[isExpanded, setIsExpanded\] = useState\(false\)/);
  assert.match(source, /data-testid="talk-about-this-toggle"/);
  assert.match(source, /fetchJson<TalkMessage\[\]>\(talkMessagesRequestUrl, \{ method: "GET"/);
  assert.match(source, /fetchJson<TalkMessage>\("\/api\/ai\/talk\/messages"/);
  assert.match(source, /fetchJson<TalkResponse>\("\/api\/ai\/talk"/);
  assert.match(source, /fetchJson<KnowledgeArticle>\("\/api\/knowledge\/articles"/);
  assert.match(source, /fetchJson<TalkMessage>\(`\/api\/ai\/talk\/messages\/\$\{message\.id\}`/);
  assert.match(source, /fetchJson<\{ ok: true \}>\(`\/api\/ai\/talk\/messages\/\$\{message\.id\}`/);
  assert.match(source, /buildTalkKnowledgeTags\(target\)/);
  assert.match(source, /\["talk", "rag", target\.objectKey, target\.recordId\]/);
  assert.match(source, /\["talk", "rag", "email_thread", target\.threadId\]/);
  assert.match(source, /target=\{\{ type: "record", objectKey: selectedRecord\.objectKey, recordId: selectedRecord\.id, label: selectedRecord\.title \}\}/);
  assert.match(source, /target=\{\{ type: "email_thread", threadId: selectedThread\.id, label: selectedDetailHeadingMessage\?\.subject \|\| selectedThread\.subject \}\}/);
});

await run("talk about this input suggests context-aware completions", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");
  assert.match(source, /const localSuggestion = shouldSuggest \? buildTalkInputSuggestion\(target, question, messages\) : ""/);
  assert.match(source, /fetchJson<TalkSuggestionResponse>\("\/api\/ai\/talk"/);
  assert.match(source, /mode: "suggestion"/);
  assert.match(source, /function buildTalkInputSuggestion\(target: TalkTarget, input: string, messages: TalkMessage\[\]\): string/);
  assert.match(source, /function applyTalkInputSuggestion\(input: string, candidate: string\): string/);
  assert.match(source, /function talkSuggestionTemplates\(target: TalkTarget, messages: TalkMessage\[\]\): string\[\]/);
  assert.match(source, /function buildTalkMessageKnowledgeBody\(target: TalkTarget, message: TalkMessage, sources: TalkResponse\["sources"\]\): string/);
  assert.match(source, /data-testid=\{`talk-message-save-knowledge-\$\{index\}`\}/);
  assert.match(source, /data-testid=\{`talk-message-delete-\$\{index\}`\}/);
  assert.match(source, /message\.knowledgeArticleId \? <span className="badge">/);
  assert.match(source, /saveMessageToKnowledge\(message, index\)/);
  assert.doesNotMatch(source, /data-testid="talk-about-this-save-knowledge"/);
  assert.match(source, /target\.type === "email_thread"/);
  assert.match(source, /target\.objectKey === "deals"/);
  assert.match(source, /event\.key === "Tab" && suggestion/);
  assert.match(source, /setQuestion\(applyTalkInputSuggestion\(question, suggestion\)\)/);
  assert.match(source, /data-testid="talk-about-this-suggestion"/);
  assert.match(styles, /\.talk-suggestion/);
  assert.match(styles, /\.talk-suggestion kbd/);
  assert.match(styles, /\.talk-message-rag-action/);
});

await run("talk about this api is guarded by ai permission and uses crm context", () => {
  const route = readFileSync("src/app/api/ai/talk/route.ts", "utf8");
  const messagesRoute = readFileSync("src/app/api/ai/talk/messages/route.ts", "utf8");
  const messageRoute = readFileSync("src/app/api/ai/talk/messages/[id]/route.ts", "utf8");
  const schemas = readFileSync("src/lib/crm/api-schemas.ts", "utf8");
  assert.match(route, /requirePermission\(context, "ai\.use"\)/);
  assert.match(route, /parseJson\(request, aiTalkRequestSchema\)/);
  assert.match(route, /buildRecordTalkContext/);
  assert.match(route, /buildEmailThreadTalkContext/);
  assert.match(route, /repository\.listRelevantKnowledgeArticles\(context/);
  assert.match(route, /getGlobalAiAgentSetting\(await repository\.getEmailAiSettings\(context\), talkAboutThisAgentKey\)/);
  assert.match(route, /runAiAgent/);
  assert.match(route, /body\.mode === "suggestion"/);
  assert.match(route, /normalizeTalkSuggestion/);
  assert.match(messagesRoute, /listTalkMessages\(context, target\)/);
  assert.match(messagesRoute, /createTalkMessage\(context/);
  assert.match(messageRoute, /markTalkMessageKnowledgeArticle\(context, params\.id, body\.knowledgeArticleId\)/);
  assert.match(messageRoute, /deleteTalkMessage\(context, params\.id\)/);
  assert.match(schemas, /export const talkMessageCreateSchema/);
  assert.match(schemas, /export const talkMessageKnowledgePatchSchema/);
  assert.match(schemas, /export const aiTalkRequestSchema/);
  assert.match(schemas, /z\.enum\(\["chat", "suggestion"\]\)/);
  assert.match(schemas, /type: z\.literal\("record"\)/);
  assert.match(schemas, /type: z\.literal\("email_thread"\)/);
});

await run("email workspace sends stable client request ids for compose idempotency", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  assert.match(source, /function createEmailClientRequestId\(\)/);
  assert.match(source, /clientRequestId:\s*createEmailClientRequestId\(\)/);
  assert.match(source, /clientRequestId:\s*emailDraft\.clientRequestId/);
  assert.match(source, /const messages = "messages" in result \? result\.messages : \[result\]/);
  assert.match(source, /next\[item\.threadId\] = upsertEmailMessage\(next\[item\.threadId\] \?\? \[\], item\)/);
});

await run("email workspace clears ai provenance after manual draft rewrites", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  assert.match(source, /function clearEmailDraftAiProvenance\(draft: EmailComposeDraft\): EmailComposeDraft/);
  assert.match(source, /aiAssisted:\s*false/);
  assert.match(source, /aiSources:\s*undefined/);
  assert.match(source, /data-testid="email-compose-account"[\s\S]*const accountId = event\.target\.value;[\s\S]*clearEmailDraftAiProvenance\(\{[\s\S]*\.\.\.emailDraft,[\s\S]*accountId,[\s\S]*signatureId: getEmailAccountDefaultComposeSignatureId\(signatures, accounts, accountId\)/);
  assert.match(source, /linkedRecordIds:\s*\[\]/);
  assert.match(source, /const emailComposeLinkableObjectKeys = new Set\(\["contacts", "companies"\]\)/);
  assert.match(source, /function updateEmailDraftLinkedRecords\(draft: EmailComposeDraft, records: CrmRecord\[\], nextRecordIds: string\[\]\): EmailComposeDraft/);
  assert.match(source, /<EmailLinkedRecordPicker[\s\S]*testId="email-compose-record"[\s\S]*values=\{linkedRecordIds\}[\s\S]*updateEmailDraftLinkedRecords\(emailDraft, records, nextRecordIds\)/);
  assert.match(source, /function EmailLinkedRecordPicker\(/);
  assert.match(source, /selectedRecords = values[\s\S]*isEmailComposeLinkableRecord/);
  assert.match(source, /label="添加联系人\/公司"/);
  assert.match(source, /placeholder="搜索联系人或公司"/);
  assert.doesNotMatch(source, /placeholder="搜索联系人、公司、交易或其他记录"/);
  assert.match(source, /<EmailProductContextPicker[\s\S]*selectedProductIds=\{emailDraft\.productIds \?\? \[\]\}/);
  assert.match(source, /function EmailProductContextPicker\(/);
  assert.match(source, /testId="email-compose-product"/);
  assert.match(source, /onOpenRecord=\{\(record\) => onOpenTalkSourceRecord\(\{ objectKey: record\.objectKey, recordId: record\.id \}\)\}/);
  assert.match(source, /aria-label="编辑关联记录"/);
  assert.match(source, /testId="email-compose-to"[\s\S]*onChange=\{\(nextValue\) => onEmailDraftChange\(clearEmailDraftAiProvenance\(\{ \.\.\.emailDraft, to: nextValue \}\)\)\}/);
  assert.match(source, /testId="email-compose-cc"[\s\S]*onChange=\{\(nextValue\) => onEmailDraftChange\(clearEmailDraftAiProvenance\(\{ \.\.\.emailDraft, cc: nextValue \}\)\)\}/);
  assert.match(source, /testId="email-compose-bcc"[\s\S]*onChange=\{\(nextValue\) => onEmailDraftChange\(clearEmailDraftAiProvenance\(\{ \.\.\.emailDraft, bcc: nextValue \}\)\)\}/);
  assert.match(source, /data-testid="email-compose-subject"[\s\S]*clearEmailDraftAiProvenance\(\{ \.\.\.emailDraft, subject: event\.target\.value \}\)/);
  assert.match(source, /data-testid="email-compose-body"[\s\S]*onInput=\{updateComposeBodyFromEditor\}/);
  assert.match(source, /function updateComposeBodyFromEditor\(\)[\s\S]*clearEmailDraftAiProvenance\(\{[\s\S]*bodyHtml,[\s\S]*bodyText: stripHtmlToText\(bodyHtml\)/);
  assert.match(source, /const accountId = current\.accountId \|\| props\.emailAccounts\[0\]\?\.id \|\| "";\s*return accountId === current\.accountId[\s\S]*clearEmailDraftAiProvenance\(\{[\s\S]*\.\.\.current,[\s\S]*accountId,[\s\S]*signatureId: getEmailAccountDefaultComposeSignatureId\(props\.emailSignatures, props\.emailAccounts, accountId\)/);
  assert.match(source, /const preferredThreadId = routeEmailThreadId \|\| selectedEmailThreadId;\s*const nextSelectedThreadId = visibleEmailThreads\.some\(\(thread\) => thread\.id === preferredThreadId\) \? preferredThreadId : visibleEmailThreads\[0\]\?\.id \?\? "";\s*if \(!preserveComposeDraft && nextSelectedThreadId !== selectedEmailThreadId\) \{[\s\S]*setEmailDraft\(\(current\) => clearEmailDraftAiProvenance\(current\)\);[\s\S]*setSelectedEmailThreadId\(nextSelectedThreadId\);/);
  assert.match(source, /setEmailDraft\(\(current\) => clearEmailDraftAiProvenance\(\{ \.\.\.current, accountId: account\.id, signatureId: getEmailAccountDefaultComposeSignatureId\(emailSignatures, \[account, \.\.\.emailAccounts\], account\.id\) \}\)\)/);
  assert.match(source, /function selectEmailThread\(threadId: string\) \{[\s\S]*setEmailDraft\(\(current\) => clearEmailDraftAiProvenance\(current\)\);[\s\S]*setSelectedEmailThreadId\(threadId\);[\s\S]*\}/);
  assert.match(source, /const linkedRecordIds = uniqueEmailLinkedRecordIds\(\[thread\.recordId, \.\.\.\(current\.linkedRecordIds \?\? \[\]\)\], records\);[\s\S]*clearEmailDraftAiProvenance\(\{ \.\.\.current, recordId: linkedRecordIds\[0\] \?\? "", linkedRecordIds \}\)/);
  assert.match(source, /onSelectThread=\{\(threadId\) => \{[\s\S]*selectEmailThread\(threadId\);/);
  assert.match(source, /setEmailDraft\(\(current\) => \(\{[\s\S]*aiAssisted:\s*true[\s\S]*aiSources:\s*result\.sources/);
});

await run("email compose supports ai generation signatures rich text and attachment modal", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");
  assert.match(source, /function prepareEmailDraftForSend\(draft: EmailComposeDraft, signatures: EmailSignature\[\], accounts: EmailAccount\[\]\): EmailComposeDraft/);
  assert.match(source, /function getEmailSignatureOptions\(signatures: EmailSignature\[\], accounts: EmailAccount\[\], selectedAccountId: string\): EmailSignatureOption\[\]/);
  assert.match(source, /function getEmailAccountDefaultComposeSignatureId\(signatures: EmailSignature\[\], accounts: EmailAccount\[\], accountId: string\): string/);
  assert.match(source, /data-testid="email-account-default-signature"/);
  assert.match(source, /defaultSignatureId: emailAccountDraft\.defaultSignatureId \|\| null/);
  assert.match(source, /signatureId: getEmailAccountDefaultComposeSignatureId\(signatures, accounts, accountId\)/);
  assert.match(source, /function renderEmailSignatureTemplate\(value: string, senderEmail: string\): string/);
  assert.match(source, /data-testid="email-signature-settings-panel"/);
  assert.match(source, /data-testid="email-signature-save"/);
  assert.match(source, /function canSelectEmailAccountForSending\(account: EmailAccount\): boolean/);
  assert.match(source, /account\.status !== "disabled" && account\.sendEnabled && account\.connectionConfigured/);
  assert.match(source, /const linkedRecordIds = useMemo\(/);
  assert.match(source, /recordId: emailDraft\.recordId \|\| undefined/);
  assert.match(source, /threadId: emailDraft\.threadId \|\| undefined/);
  assert.match(source, /skipAutoLink: !emailDraft\.threadId/);
  assert.match(source, /const sentThreadIds = Array\.from\(new Set\(messages\.map\(\(item\) => item\.threadId\)\.filter\(Boolean\)\)\)/);
  assert.match(source, /Promise\.all\(sentThreadIds\.map\(\(threadId\) => updateEmailThreadState\(threadId, \{ read: true \}\)\)\)/);
  const sendEmailBody = source.slice(source.indexOf("async function sendEmail()"), source.indexOf("async function retryEmailMessage"));
  assert.doesNotMatch(sendEmailBody, /threadId: selectedEmailThreadId \|\| undefined/);
  const editSentEmailBody = source.slice(source.indexOf("function editSentEmailMessage"), source.indexOf("function replyToEmailMessage"));
  assert.match(editSentEmailBody, /threadId: undefined/);
  assert.doesNotMatch(editSentEmailBody, /threadId: message\.threadId/);
  assert.match(source, /const htmlParts = \[inlineImageResult\.bodyHtml, signatureHtml, originalHtml\]\.filter\(Boolean\)/);
  assert.match(source, /const textParts = \[bodyText, signatureText, originalText\]\.filter\(Boolean\)/);
  assert.match(source, /onGenerateAiForDraft=\{\(prompt\) => runAction\(\(\) => generateEmailAiForDraft\(prompt\)\)\}/);
  assert.match(source, /onGenerateAiPromptForDraft=\{\(prompt\) => generateEmailAiPromptForDraft\(prompt\)\}/);
  assert.match(source, /async function generateEmailAiPromptForDraft\(currentPrompt: string\): Promise<string>/);
  assert.match(source, /const targetLocale = resolveEmailDraftAiTargetLocale\(\)/);
  assert.match(source, /const targetPreference = resolveEmailDraftAiRecipientPreference\(\)/);
  assert.match(source, /The prompt must instruct the drafting agent to write both the subject and body in this language/);
  const aiGenerationSource = readFileSync("src/lib/email/ai-generation.ts", "utf8");
  assert.match(aiGenerationSource, /return the customer-facing subject and body in the requested draft language/);
  assert.ok(source.includes("不要在正文里加入签名"));
  assert.match(source, /data-testid="email-compose-ai-prompt"/);
  assert.match(source, /data-testid="email-compose-ai-prompt-generate"/);
  assert.match(source, /data-testid="email-compose-ai-generate"/);
  assert.ok((source.match(/trackingEnabled:\s*true/g) ?? []).length >= 2);
  assert.ok((source.match(/groupSendMode:\s*true/g) ?? []).length >= 2);
  assert.match(source, /function EmailRecipientInput/);
  assert.match(source, /email-recipient-suggestions/);
  assert.match(source, /event\.key === "ArrowDown"/);
  assert.match(source, /event\.key === "Tab" \|\| event\.key === "Enter"/);
  assert.match(source, /contactByEmail=\{contactByEmail\}/);
  assert.match(source, /const \[composeCcVisible, setComposeCcVisible\] = useState\(false\)/);
  assert.match(source, /const \[composeBccVisible, setComposeBccVisible\] = useState\(false\)/);
  assert.match(source, /data-testid="email-compose-show-cc"[\s\S]*setComposeCcVisible\(true\)/);
  assert.match(source, /data-testid="email-compose-show-bcc"[\s\S]*setComposeBccVisible\(true\)/);
  assert.match(source, /\{composeCcVisible \? \([\s\S]*testId="email-compose-cc"[\s\S]*\) : null\}/);
  assert.match(source, /\{composeBccVisible \? \([\s\S]*testId="email-compose-bcc"[\s\S]*\) : null\}/);
  assert.doesNotMatch(source, /data-testid="email-open-ai"/);
  assert.match(source, /data-testid="email-compose-signature"/);
  assert.match(source, /data-testid="email-signature-preview"/);
  assert.match(source, /email-compose-editor-shell[\s\S]*data-testid="email-compose-signature"[\s\S]*data-testid="email-signature-preview"/);
  assert.match(source, /contentEditable[\s\S]*data-testid="email-compose-body"/);
  assert.match(source, /document\.execCommand\([\s\S]*"insertHTML"[\s\S]*data-content-base64/);
  assert.match(source, /data-testid="email-attachment-modal"/);
  assert.match(source, /data-testid="email-attachment-dropzone"/);
  assert.match(source, /readEmailAttachmentFile\(file, \(progress\) =>/);
  assert.match(styles, /\.email-rich-editor/);
  assert.match(styles, /\.email-recipient-input/);
  assert.match(styles, /\.email-recipient-token/);
  assert.match(styles, /\.email-recipient-suggestions/);
  assert.match(styles, /\.email-compose-recipient-row/);
  assert.match(styles, /\.email-compose-recipient-toggles/);
  assert.match(styles, /\.email-attachment-dropzone/);
});

await run("email account edit loads sanitized connection config without clearing saved secrets", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const repository = readFileSync("src/lib/crm/repository.ts", "utf8");
  const route = readFileSync("src/app/api/email/accounts/[id]/connection-config/route.ts", "utf8");
  assert.match(source, /function createEmailAccountEditDraft\(account: EmailAccount, config\?: SanitizedEmailConnectionConfig\): EmailAccountDraft/);
  assert.match(source, /\/api\/email\/accounts\/\$\{account\.id\}\/connection-config/);
  assert.match(source, /留空保留已保存密码/);
  assert.match(source, /留空保留 Resend API Key/);
  assert.match(repository, /function mergeEmailConnectionConfigSecrets\(existing: EmailConnectionConfig \| undefined, next: EmailConnectionConfig\): EmailConnectionConfig/);
  assert.match(repository, /const outboundServices = \(next\.outboundServices \?\? \[\]\)\.map\(\(service\) => \{/);
  assert.match(repository, /password: service\.password \?\? existingService\?\.password/);
  assert.match(repository, /resendApiKey: service\.resendApiKey \?\? existingService\?\.resendApiKey/);
  assert.match(repository, /encryptEmailConnectionConfig\(mergeEmailConnectionConfigSecrets\(existingConfig, input\.connectionConfig\)\)/);
  assert.match(route, /type SanitizedEmailConnectionConfig/);
  assert.match(route, /hasPassword: Boolean\(normalized\.inbound\.password\)/);
  assert.match(route, /hasResendApiKey: Boolean\(service\.resendApiKey\)/);
});

await run("media library stores reusable images for product main images and email inserts", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260624082000_add_media_assets/migration.sql", "utf8");
  const types = readFileSync("src/lib/crm/types.ts", "utf8");
  const route = readFileSync("src/app/api/media-assets/route.ts", "utf8");
  const itemRoute = readFileSync("src/app/api/media-assets/[id]/route.ts", "utf8");
  const apiSchemas = readFileSync("src/lib/crm/api-schemas.ts", "utf8");
  const repository = readFileSync("src/lib/crm/repository.ts", "utf8");
  const store = readFileSync("src/lib/crm/store.ts", "utf8");
  const page = readFileSync("src/app/crm-page.tsx", "utf8");
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const mediaLibrary = readFileSync("src/components/media-library.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");
  assert.match(schema, /model MediaAsset/);
  assert.match(migration, /CREATE TABLE "MediaAsset"/);
  assert.match(types, /export interface MediaAsset/);
  assert.match(route, /mediaAssetCreateSchema/);
  assert.match(itemRoute, /mediaAssetUpdateSchema/);
  assert.match(itemRoute, /export const PATCH = withApiMetrics\("PATCH \/api\/media-assets\/\[id\]"/);
  assert.match(itemRoute, /export const DELETE = withApiMetrics\("DELETE \/api\/media-assets\/\[id\]"/);
  assert.match(apiSchemas, /export const mediaAssetUpdateSchema/);
  assert.match(repository, /async updateMediaAsset/);
  assert.match(repository, /async deleteMediaAsset/);
  assert.match(store, /updateMediaAsset\(context: RequestContext/);
  assert.match(store, /deleteMediaAsset\(context: RequestContext/);
  assert.match(page, /repository\.listMediaAssets\(context\)/);
  assert.match(source, /async function uploadMediaAssets\(files: FileList \| File\[\] \| null\): Promise<MediaAsset\[\]>/);
  assert.match(source, /contentType: file\.type \|\| "application\/octet-stream"/);
  assert.match(source, /async function updateMediaAsset/);
  assert.match(source, /async function deleteMediaAsset/);
  assert.match(source, /function MediaImageFieldInput/);
  assert.match(source, /field\.objectKey === "products" && field\.key === "mainImageUrl"/);
  assert.match(source, /import \{ MediaAssetPreview, MediaLibraryModal \} from "@\/components\/media-library"/);
  assert.match(mediaLibrary, /function MediaLibraryModal/);
  assert.match(mediaLibrary, /canSelectAsset\?: \(asset: MediaAsset\) => boolean/);
  assert.match(mediaLibrary, /function MediaAssetPreview/);
  assert.match(source, /function isImageMediaAsset/);
  assert.match(source, /testId="email-media-library-modal"/);
  assert.match(source, /testId=\{testId \? `\$\{testId\}-media-library-modal` : "record-media-library-modal"\}/);
  assert.match(source, /function insertMediaAssetInline\(asset: MediaAsset\)/);
  assert.match(mediaLibrary, /data-testid=\{`media-asset-edit-\$\{asset\.id\}`\}/);
  assert.match(mediaLibrary, /data-testid=\{`media-asset-delete-\$\{asset\.id\}`\}/);
  assert.match(mediaLibrary, /function saveEditingAssetName/);
  assert.match(mediaLibrary, /function replaceEditingAsset/);
  assert.match(mediaLibrary, /onDrop=\{\(event\) => \{/);
  assert.match(source, /selectFirstUploaded/);
  assert.match(source, /onDeleteMediaAsset=\{\(asset\) => \{ void runImmediateAction\(\(\) => deleteMediaAsset\(asset\)\); \}\}/);
  assert.match(source, /onUpdateMediaAsset=\{\(assetId, patch\) => runAction\(\(\) => updateMediaAsset\(assetId, patch\)\)\}/);
  assert.match(mediaLibrary, /event\.stopPropagation\(\);[\s\S]*onDeleteMediaAsset\?\.\(asset\)/);
  assert.match(styles, /\.media-library-grid/);
  assert.match(styles, /\.media-library-card/);
  assert.match(styles, /\.media-library-select/);
  assert.match(styles, /\.media-library-edit/);
  assert.match(styles, /\.media-field-preview/);
  assert.match(styles, /\.media-file-preview/);
});

await run("activity records and product records support reusable file attachments", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const apiSchemas = readFileSync("src/lib/crm/api-schemas.ts", "utf8");
  const seed = readFileSync("src/lib/crm/seed.ts", "utf8");
  const migration = readFileSync("prisma/migrations/20260627090000_product_attachments/migration.sql", "utf8");
  assert.match(apiSchemas, /mediaAssetContentTypeSchema/);
  assert.doesNotMatch(apiSchemas, /imageContentTypeSchema/);
  assert.match(source, /type ActivityAttachment = TaskAttachment/);
  assert.match(source, /function AttachmentPicker/);
  assert.match(source, /serializeActivityDetails\(\{ text: body, attachments \}\)/);
  assert.match(source, /function parseActivityDetails/);
  assert.match(source, /function ProductAttachmentsFieldInput/);
  assert.match(source, /field\.objectKey === "products" && field\.key === "attachments"/);
  assert.match(source, /ContactFollowUpDialog[\s\S]*AttachmentPicker/);
  assert.match(source, /ActivityList[\s\S]*TaskAttachmentPreview/);
  assert.match(seed, /field-product-attachments/);
  assert.match(seed, /key: "attachments"/);
  assert.match(migration, /field-product-attachments-/);
  assert.match(migration, /jsonb_set\("data", '\{attachments\}', '\[\]'::jsonb, true\)/);
});

await run("crm settings expose payment term option management", () => {
  const settings = readFileSync("src/components/settings-admin.tsx", "utf8");
  assert.match(settings, /const paymentTermRecords = useMemo/);
  assert.match(settings, /const paymentTermFields = props\.fields\.filter/);
  assert.match(settings, /function PaymentTermAdminPanel/);
  assert.match(settings, /data-testid="settings-payment-terms"/);
  assert.match(settings, /data-testid="settings-payment-term-code"/);
  assert.match(settings, /data-testid="settings-payment-term-deposit-value"/);
  assert.match(settings, /async function savePaymentTerm/);
  assert.match(settings, /async function syncPaymentTermFieldOptions/);
  assert.match(settings, /\/api\/records\/paymentterms/);
  assert.match(settings, /paymentTermOptionsFromRecords\(recordsForOptions\)/);
});

await run("payment term helpers build full deposit fixed and inactive schedules", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const paymentTerms = store.listRecords(context, "paymentterms");
  assert.equal(getPaymentTermDefinitions(paymentTerms).some((term) => term.code === "advance_30_balance_70" && term.mode === "deposit_balance"), true);

  const full = buildPaymentTermSchedule(paymentTerms, "net_30", 1000, "CNY", store.listRecords(context, "currencies"));
  assert.match(full.paymentSummary, /100% Full Payment/);
  assert.match(full.paymentSummary, /1,000/);

  const advance = buildPaymentTermSchedule(paymentTerms, "advance_30_balance_70", 1000, "CNY", store.listRecords(context, "currencies"));
  assert.match(advance.paymentSummary, /30% Payment in Advance/);
  assert.match(advance.paymentSummary, /70% Balance/);
  assert.equal(advance.paymentSchedule[0].amount, 300);
  assert.equal(advance.paymentSchedule[1].amount, 700);

  const fixedTerm = store.createRecord(context, "paymentterms", {
    title: "Fixed deposit",
    data: {
      code: "fixed_200_balance",
      label: "Fixed 200 / Balance",
      active: false,
      mode: "deposit_balance",
      depositPaymentMethod: "Bank Transfer",
      balancePaymentMethod: "Balance",
      depositType: "fixed",
      depositValue: 200,
      paymentInstructions: "Pay to company bank account."
    }
  });
  const fixed = buildPaymentTermSchedule([...paymentTerms, fixedTerm], "fixed_200_balance", 1000, "CNY", store.listRecords(context, "currencies"));
  assert.match(fixed.paymentSummary, /Payment in Advance by Bank Transfer/);
  assert.match(fixed.paymentSummary, /Balance/);
  assert.equal(fixed.paymentSchedule[0].amount, 200);
  assert.equal(fixed.paymentSchedule[1].amount, 800);
  assert.equal(fixed.paymentInstructions, "Pay to company bank account.");

  const missing = buildPaymentTermSchedule(paymentTerms, "missing_term", 1000, "CNY", store.listRecords(context, "currencies"));
  assert.equal(missing.paymentSummary, "");
  assert.equal(missing.paymentSchedule.length, 0);
});

await run("payment term migration creates metadata records and synchronizes sales document options", () => {
  const migration = readFileSync("prisma/migrations/20260712090000_payment_terms_configuration/migration.sql", "utf8");
  assert.match(migration, /'paymentterms'/);
  assert.match(migration, /'field-paymentterm-'/);
  assert.match(migration, /advance_30_balance_70/);
  assert.match(migration, /UPDATE "FieldDefinition"[\s\S]*'quotes', 'salesorders', 'proformainvoices', 'commercialinvoices'/);
  assert.match(migration, /INSERT INTO "SavedView"[\s\S]*view-paymentterms-default/);
});

await run("notification channels support bark webhook and email event delivery", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260626143000_notification_channels/migration.sql", "utf8");
  const types = readFileSync("src/lib/crm/types.ts", "utf8");
  const apiSchemas = readFileSync("src/lib/crm/api-schemas.ts", "utf8");
  const route = readFileSync("src/app/api/notification-channels/route.ts", "utf8");
  const itemRoute = readFileSync("src/app/api/notification-channels/[id]/route.ts", "utf8");
  const repository = readFileSync("src/lib/crm/repository.ts", "utf8");
  const settings = readFileSync("src/components/settings-admin.tsx", "utf8");
  const workspace = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const page = readFileSync("src/app/crm-page.tsx", "utf8");
  assert.match(schema, /model NotificationChannel/);
  assert.match(migration, /"events" TEXT\[\] NOT NULL/);
  assert.match(types, /export interface NotificationChannel/);
  assert.match(apiSchemas, /notificationChannelCreateSchema/);
  assert.match(route, /export const GET = withApiMetrics\("GET \/api\/notification-channels"/);
  assert.match(itemRoute, /export const DELETE = withApiMetrics\("DELETE \/api\/notification-channels\/\[id\]"/);
  assert.match(repository, /async listNotificationChannels/);
  assert.match(repository, /private emitNotificationEvent/);
  assert.match(repository, /private async deliverNotificationChannel/);
  assert.match(repository, /channel\.type === "bark"/);
  assert.match(repository, /channel\.type === "webhook"/);
  assert.match(repository, /channel\.type === "email"/);
  assert.match(settings, /function NotificationChannelAdminPanel/);
  assert.match(settings, /settings-notification-bark-key/);
  assert.match(settings, /settings-notification-email-recipients/);
  assert.match(workspace, /notificationChannels=\{props\.notificationChannels\}/);
  assert.match(workspace, /notificationChannels: props\.notificationChannels/);
  assert.match(workspace, /notificationChannelsForEvents/);
  assert.match(workspace, /同步到 \{formatNotificationChannelSummary\(notification\.syncedChannels\)\}/);
  assert.match(page, /repository\.listNotificationChannels\(context\)/);
});

await run("quick contact actions open follow-up dialogs and save timeline activities", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const formatUtils = readFileSync("src/lib/utils/format.ts", "utf8");
  assert.match(source, /type ContactFollowUpDraft/);
  assert.match(source, /function ContactFollowUpDialog/);
  assert.match(source, /data-testid="contact-follow-up-modal"/);
  assert.match(source, /data-testid="contact-follow-up-ai-generate"/);
  assert.match(source, /function openContactFollowUp/);
  assert.match(source, /function generateContactFollowUpMessage/);
  assert.match(source, /function submitContactFollowUp/);
  assert.match(source, /await createRecordActivity\(\{\s*recordId: contactFollowUpDraft\.recordId/);
  assert.match(source, /contactFollowUpDraft\.channel === "call" \? "电话跟进" : "WhatsApp 跟进"/);
  assert.match(source, /buildContactMethodUrl\("whatsapp", contactFollowUpDraft\.method\.value\)/);
  assert.match(source, /window\.open\(`\$\{whatsappUrl\}\$\{separator\}text=\$\{encodeURIComponent\(messageText\)\}`/);
  assert.match(source, /onStartWhatsApp=\{\(method\) => openContactFollowUp\(selectedRecord, method, "whatsapp"\)\}/);
  assert.match(source, /onStartCall=\{\(method\) => openContactFollowUp\(selectedRecord, method, "call"\)\}/);
  assert.match(formatUtils, /export function formatDateTimeSeconds/);
  assert.match(formatUtils, /timeStyle: "medium"/);
  assert.match(source, /<ActivityTimeline[\s\S]*testIdPrefix="record-activity"/);
  assert.match(source, /<span className="subtle"> - \{formatDateTimeSeconds\(activity\.createdAt\)\}<\/span>/);
  assert.match(source, /Associated with <span>\{linkedRecord\.title\}<\/span>/);
});

await run("current user profile settings support avatar name and password updates", () => {
  assert.deepEqual(currentUserProfileUpdateSchema.parse({ name: "Sam", avatarMediaAssetId: "" }), { name: "Sam", avatarMediaAssetId: "" });
  assert.throws(() => currentUserProfileUpdateSchema.parse({}), z.ZodError);
  assert.equal(currentUserPasswordUpdateSchema.parse({ currentPassword: "old-password", newPassword: "new-password", newPasswordConfirm: "new-password" }).newPassword, "new-password");
  assert.throws(() => currentUserPasswordUpdateSchema.parse({ currentPassword: "old", newPassword: "new-password", newPasswordConfirm: "mismatch" }), z.ZodError);
  assert.equal(currentUserAvatarMediaAssetCreateSchema.parse({ name: "avatar.png", contentType: "image/png", size: 4, contentBase64: "dGVzdA==" }).contentType, "image/png");
  assert.throws(() => currentUserAvatarMediaAssetCreateSchema.parse({ name: "file.txt", contentType: "text/plain", size: 4, contentBase64: "dGVzdA==" }), z.ZodError);

  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260711110000_user_profile_avatar/migration.sql", "utf8");
  const types = readFileSync("src/lib/crm/types.ts", "utf8");
  const repository = readFileSync("src/lib/crm/repository.ts", "utf8");
  const profileRoute = readFileSync("src/app/api/users/me/profile/route.ts", "utf8");
  const passwordRoute = readFileSync("src/app/api/users/me/password/route.ts", "utf8");
  const avatarRoute = readFileSync("src/app/api/users/me/avatar-assets/route.ts", "utf8");
  const settings = readFileSync("src/components/settings-admin.tsx", "utf8");
  const workspace = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const page = readFileSync("src/app/crm-page.tsx", "utf8");
  assert.match(schema, /avatarMediaAssetId\s+String\?/);
  assert.match(schema, /avatarMediaAsset\s+MediaAsset\?/);
  assert.match(migration, /"avatarMediaAssetId" TEXT/);
  assert.match(types, /avatarMediaAssetId\?: string/);
  assert.match(repository, /async updateCurrentUserProfile/);
  assert.match(repository, /asset\.contentType\.toLowerCase\(\)\.startsWith\("image\/"\)/);
  assert.match(repository, /async updateCurrentUserPassword/);
  assert.match(repository, /verifyPassword\(input\.currentPassword/);
  assert.match(repository, /destroyOtherSessionsForUser/);
  assert.match(repository, /async createCurrentUserAvatarMediaAsset/);
  assert.match(profileRoute, /PATCH \/api\/users\/me\/profile/);
  assert.match(passwordRoute, /SESSION_COOKIE_NAME/);
  assert.match(avatarRoute, /currentUserAvatarMediaAssetCreateSchema/);
  assert.match(settings, /function ProfileSettingsPanel/);
  assert.match(settings, /data-testid="profile-settings-panel"/);
  assert.match(settings, /data-testid="profile-password-save"/);
  assert.match(settings, /onUpdateMediaAsset=\{onUpdateMediaAsset\}/);
  assert.match(settings, /onDeleteMediaAsset=\{onDeleteMediaAsset\}/);
  assert.doesNotMatch(settings, /testId="profile-avatar-media-library-modal"[\s\S]{0,500}selectFirstUploaded/);
  assert.match(workspace, /className="user-strip-profile"/);
  assert.match(workspace, /router\.push\("\/settings\/profile"\)/);
  assert.match(workspace, /uploadCurrentUserAvatarAssets/);
  assert.match(workspace, /onUpdateMediaAsset=\{\(assetId, patch\) => runAction\(\(\) => updateMediaAsset\(assetId, patch\)\)\}/);
  assert.match(workspace, /onDeleteMediaAsset=\{\(asset\) => \{ void runImmediateAction\(\(\) => deleteMediaAsset\(asset\)\); \}\}/);
  assert.match(page, /currentUserAvatarAsset/);
});

await run("client date rendering stays deterministic during hydration", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const formatUtils = readFileSync("src/lib/utils/format.ts", "utf8");
  assert.ok((formatUtils.match(/timeZone: "Asia\/Shanghai"/g) ?? []).length >= 2);
  assert.ok((source.match(/timeZone: "Asia\/Shanghai"/g) ?? []).length >= 6);
  assert.match(source, /const \[emailNowMs, setEmailNowMs\] = useState<number \| undefined>\(\)/);
  assert.match(source, /setEmailNowMs\(Date\.now\(\)\)/);
  assert.match(source, /const isFutureEmailTime = useCallback/);
  assert.match(source, /const \[now, setNow\] = useState<number \| undefined>\(\)/);
  assert.match(source, /setNow\(Date\.now\(\)\)/);
  assert.match(source, /const isSnoozedForPanel = useCallback/);
});

await run("email workspace explains when translation fallback is not persisted", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  assert.match(source, /text:\s*translated\.translatedBodyText \?\? "翻译未保存：需要配置可用 AI provider/);
  assert.match(source, /setMessage\(translated\.translatedBodyText \? "邮件翻译已保存。" : "翻译未保存：需要配置可用 AI provider。"\)/);
});

await run("email workspace does not apply compose translation fallback to the draft body", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  assert.match(source, /const canApplyResultToDraft = result\.enabled && \(emailAiPurpose === "draft" \|\| \(emailAiPurpose === "translate" && result\.generationMode === "provider"\)\)/);
  assert.match(source, /if \(canApplyResultToDraft\)[\s\S]*bodyText:\s*result\.text/);
  assert.match(source, /result\.enabled && emailAiPurpose === "translate"[\s\S]*翻译未应用到正文：需要配置可用 AI provider/);
});

await run("email workspace previews html bodies in a sandboxed iframe", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");
  assert.match(source, /function buildEmailHtmlPreview\(bodyHtml: string, allowExternalImages = false\): string/);
  assert.match(source, /http-equiv="Content-Security-Policy"/);
  assert.match(source, /hasEmailHtmlPreview\(message\)/);
  assert.match(source, /data-testid=\{`email-message-html-\$\{message\.id\}`\}/);
  assert.match(source, /import \{ repairEmailMojibake \} from "@\/lib\/email\/mojibake"/);
  assert.match(source, /const repairedHtml = repairEmailMojibake\(bodyHtml\)/);
  assert.match(source, /const imgSrcPolicy = allowExternalImages \? "data: cid: https: http:" : "data: cid:"/);
  assert.match(source, /function emailHtmlHasExternalImages\(bodyHtml: string\): boolean/);
  assert.match(source, /function formatEmailAnalysisForDisplay\(analysis: string\): string/);
  assert.match(source, /looksLikeLeakedEmailAnalysisPrompt\(repaired\)/);
  assert.match(source, /data-testid="email-thread-analysis"/);
  assert.match(source, /data-testid=\{`email-message-external-images-blocked-\$\{message\.id\}`\}/);
  assert.match(source, /data-testid=\{`email-message-load-external-images-\$\{message\.id\}`\}/);
  assert.match(source, /function resolveEmailInlineImageHtml\(message: EmailMessage\): string/);
  assert.match(source, /function stripInternalEmailTrackingHtml\(bodyHtml: string\): string/);
  assert.match(source, /image\.remove\(\)/);
  assert.match(source, /anchor\.setAttribute\("href", target\)/);
  assert.match(source, /pathname\.startsWith\("\/api\/email\/track\/open\/"\)/);
  assert.match(source, /pathname\.startsWith\("\/api\/email\/track\/click\/"\)/);
  assert.match(source, /const attachmentByContentId = new Map<string, EmailAttachment>\(\)/);
  assert.match(source, /image\.setAttribute\("src", src\)/);
  assert.match(source, /buildEmailHtmlPreview\(resolveEmailInlineImageHtml\(message\), selectedThreadAllowsExternalImages\)/);
  assert.match(source, /\{repairEmailMojibake\(message\.bodyText\)\}/);
  assert.doesNotMatch(source, /<div className="email-message-body">\{message\.bodyText\}<\/div>\s*\{hasEmailHtmlPreview\(message\)/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
  assert.match(styles, /\.email-html-preview-frame/);
  assert.match(styles, /\.email-external-image-notice/);
  assert.match(styles, /\.email-thread-analysis-body \{[\s\S]*max-height: 260px;[\s\S]*overflow: auto;/);
  assert.match(styles, /\.gmail-compose-popup-header \.icon-button[\s\S]*background: transparent/);
});

await run("email workspace repairs list snippets after opening a thread", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  assert.match(source, /const snippet = repairEmailMojibake\(displayMessage\?\.bodyText \|\| thread\.summary \|\| thread\.aiAnalysis \|\| ""\)/);
  assert.doesNotMatch(source, /const snippet = messages\.at\(-1\)\?\.bodyText \|\| thread\.summary \|\| thread\.aiAnalysis \|\| ""/);
});

await run("email trash permanent delete buttons use immediate confirm flow", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  assert.match(source, /const \[trashDisplayMessageIds, setTrashDisplayMessageIds\] = useState<EmailTrashDisplayMessageIds>\(\{\}\)/);
  assert.match(source, /getEmailThreadDisplayMessage\(selectedDisplayedMessages, mailbox, selectedThread \? trashDisplayMessageIds\[selectedThread\.id\] : undefined\)/);
  assert.match(source, /getEmailThreadListDisplayMessage\(messages\.length \? messages : displayMessages, mailbox, trashDisplayMessageIds\[thread\.id\]\)/);
  assert.match(source, /const trashDisplayAnchors =[\s\S]*action === "delete"[\s\S]*getEmailThreadDisplayMessage\(messagesByThread\[threadId\] \?\? \[\], mailbox\)/);
  assert.match(source, /setTrashDisplayMessageIds\(\(current\) => \{[\s\S]*next\[threadId\] = messageId/);
  assert.match(source, /async function runImmediateAction<T>\(action: \(\) => Promise<T>\): Promise<T \| undefined>/);
  assert.match(source, /onDeleteThreads=\{\(threadIds\) => runImmediateAction\(\(\) => deleteEmailThreads\(threadIds\)\)\}/);
  assert.match(source, /async function permanentlyDeleteThreads\(threadIds: string\[\]\)/);
  assert.match(source, /async function deleteEmailThreads\(threadIds: string\[\]\): Promise<boolean>/);
  assert.match(source, /return false;[\s\S]*requestConfirm/);
  assert.match(source, /const locallyDeletedEmailThreadIdsRef = useRef<Set<string>>\(new Set\(\)\)/);
  assert.match(source, /const visibleEmailThreads = props\.emailThreads\.filter\(\(thread\) => !locallyDeletedEmailThreadIdsRef\.current\.has\(thread\.id\)\)/);
  assert.match(source, /const visibleThreads = threads\.filter\(\(thread\) => !locallyDeletedEmailThreadIdsRef\.current\.has\(thread\.id\)\)/);
  assert.match(source, /ids\.forEach\(\(threadId\) => locallyDeletedEmailThreadIdsRef\.current\.add\(threadId\)\)/);
  assert.match(source, /const deleted = await onDeleteThreads\(ids\);[\s\S]*if \(!deleted\) \{[\s\S]*return;[\s\S]*\}/);
  assert.match(source, /data-testid="email-thread-bulk-permanent-delete"[\s\S]*permanentlyDeleteThreads\(selectedThreadIdsArray\)/);
  assert.match(source, /data-testid=\{`email-thread-row-permanent-delete-\$\{thread\.id\}`\}[\s\S]*permanentlyDeleteThreads\(\[thread\.id\]\)/);
  assert.match(source, /data-testid="email-thread-permanent-delete"[\s\S]*permanentlyDeleteThreads\(\[selectedThread\.id\]\)/);
  assert.match(source, /showSuccess\(ids\.length > 1 \? `已彻底删除 \$\{ids\.length\} 个邮件线程` : "邮件线程已彻底删除"\)/);
});

await run("email workspace supports labels minimized compose restore and record activity markers", () => {
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");
  assert.match(source, /const \[labelFilter, setLabelFilter\] = useState\(routeLabel\)/);
  assert.match(source, /function promptAddEmailLabel\(threadIds: string\[\]\)/);
  assert.match(source, /function getEmailThreadUserLabels\(thread: EmailThread, state: EmailThreadUiState = \{\}\): string\[\]/);
  assert.match(source, /updateThreadLabels\(threadId, getEmailThreadUserLabels\(thread, state\)\.filter/);
  assert.match(source, /data-testid="email-add-label"/);
  assert.match(source, /getEmailThreadDisplayLabels\(thread, state, messages\)/);
  assert.match(source, /function isEmailFailureLabelFilter\(label: string\): boolean/);
  assert.match(source, /function getEmailThreadMailboxDisplayMessages\(messages: EmailMessage\[\], mailbox: EmailMailboxKey, labelFilter = ""\): EmailMessage\[\]/);
  assert.match(source, /const failedMessages = mailboxMessages\.filter\(\(message\) => message\.direction === "outbound" && message\.status === "failed"\)/);
  assert.match(source, /const labels = getEmailThreadDisplayLabels\(thread, state, displayMessage \? \[displayMessage\] : displayMessages\)/);
  assert.match(source, /buildEmailThreadLabels\(selectedThread, selectedMessages\)\.map/);
  assert.match(source, /getEmailThreadUserLabels\(selectedThread, threadUiState\[selectedThread\.id\] \?\? \{\}\)\.map/);
  assert.match(source, /recordEmailActivityFilter/);
  assert.match(source, /data-testid=\{`record-email-filter-\$\{selectedRecord\.id\}-\$\{sanitizeTestId\(emailAddress\)\}`\}/);
  assert.match(source, /record-email-thread-markers/);
  assert.match(source, /类别：\{getEmailCategoryLabel\(threadCategory\)\}/);
  assert.match(source, /onClick=\{composeMinimized \? \(\) => setComposeMinimized\(false\) : undefined\}/);
  assert.match(source, /<base target="_blank">/);
  assert.match(styles, /\.email-label-pill/);
  assert.match(styles, /\.gmail-compose-popup\.minimized[\s\S]*cursor: pointer/);
});

await run("email diagnostics can recover stale sending messages through retry", () => {
  const workspaceSource = readFileSync("src/components/crm-workspace.tsx", "utf8");
  assert.match(workspaceSource, /EmailDiagnosticsPanel diagnostics=\{diagnostics\}[\s\S]*onRetryMessage=\{onRetryMessage\}/);
  assert.match(workspaceSource, /diagnostics\.sendClaims\.staleMessages\.map/);
  assert.match(workspaceSource, /onClick=\{\(\) => onRetryMessage\(message\.id\)\}/);
  assert.match(workspaceSource, /恢复发送/);

  const routeSource = readFileSync("src/app/api/email/messages/[id]/retry/route.ts", "utf8");
  assert.match(routeSource, /message\.status !== "failed" && message\.status !== "sending"/);
  assert.match(routeSource, /message\.status === "failed"\s*\?\s*await repository\.updateEmailMessageStatus\(context,\s*message\.id,\s*"queued"\)\s*:\s*message/s);
  assert.match(routeSource, /runEmailSendJob\(context,\s*\{\s*messageId:\s*retryMessage\.id\s*\}\)/);
});

await run("prisma email repository treats client request unique races as idempotent", () => {
  const source = readFileSync("src/lib/crm/repository.ts", "utf8");
  assert.match(source, /function isPrismaUniqueConstraintError\(error: unknown\): boolean/);
  assert.match(source, /error instanceof Prisma\.PrismaClientKnownRequestError && error\.code === "P2002"/);
  assert.match(source, /normalizedClientRequestId && isPrismaUniqueConstraintError\(error\)/);
  assert.match(source, /clientRequestId:\s*normalizedClientRequestId/);
});

await run("email message translate route accepts empty body for default locale", () => {
  const source = readFileSync("src/app/api/email/messages/[id]/translate/route.ts", "utf8");
  assert.match(source, /parseOptionalJson\(request,\s*emailMessageTranslateSchema,\s*\{\s*\}\)/);
  assert.match(source, /runEmailTranslateJob\(context,\s*\{\s*messageId:\s*params\.id,\s*targetLocale:\s*body\.targetLocale\s*\}\)/);
});

await run("email ai execution routes use controlled context executors and audit", () => {
  const generateSource = readFileSync("src/app/api/email/ai-generate/route.ts", "utf8");
  const analyzeSource = readFileSync("src/app/api/email/threads/[id]/analyze/route.ts", "utf8");
  const summarizeSource = readFileSync("src/app/api/email/threads/[id]/summarize/route.ts", "utf8");
  const translateSource = readFileSync("src/app/api/email/messages/[id]/translate/route.ts", "utf8");

  assert.match(generateSource, /repository\.buildEmailAssistantContext\(context,\s*body\)/);
  assert.match(generateSource, /getGlobalAiAgentSetting\(settings, assistantContext\.agentKey\)/);
  assert.match(generateSource, /repository\.getAiProviderConfigForAgent\(context,\s*agent\)/);
  assert.match(generateSource, /repository\.getEmailAiProviderConfig\(context\)/);
  assert.match(generateSource, /generateEmailAiOutput\(\{\s*context:\s*assistantContext,\s*userPrompt:\s*body\.userPrompt,\s*sourceText:\s*body\.sourceText\s*\},\s*\{\s*config:\s*providerConfig\s*\}\)/);
  assert.match(generateSource, /repository\.recordEmailAiGeneration\(context,\s*\{/);
  assert.match(generateSource, /generationMode:\s*result\.generationMode/);
  assert.match(generateSource, /providerError:\s*result\.providerError/);
  assert.match(translateSource, /getBackgroundJobExecutor\(repository\)/);
  assert.match(translateSource, /runEmailTranslateJob\(context,\s*\{\s*messageId:\s*params\.id,\s*targetLocale:\s*body\.targetLocale\s*\}\)/);
  assert.match(analyzeSource, /getBackgroundJobExecutor\(repository\)\.runEmailAnalyzeJob\(context,\s*\{\s*threadId:\s*params\.id\s*\}\)/);
  assert.match(summarizeSource, /getBackgroundJobExecutor\(repository\)\.runEmailSummarizeJob\(context,\s*\{\s*threadId:\s*params\.id\s*\}\)/);
});

await run("email verification dry run describes diagnostics and manual mailbox checks", () => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--import", "./scripts/register-alias.mjs", "scripts/email-verify.ts", "--dry-run", "--require-live-readiness", "--user-id", "user-admin"],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.userId, "user-admin");
  assert.match(plan.userResolution, /explicit --user-id/);
  assert.equal(plan.runConnectionTests, true);
  assert.equal(plan.runAiProviderTest, true);
  assert.equal(plan.runSmoke, true);
  assert.equal(plan.requireLiveReadiness, true);
  assert.equal(plan.steps.some((step) => step.includes("sync scheduler policy") && step.includes("AI context policy") && step.includes("AI automation failure audit") && step.includes("AI provider fallback audit")), true);
  assert.equal(plan.steps.includes("Run provider connection tests for active configured accounts"), true);
  assert.equal(plan.steps.includes("Run a source-backed AI provider generation check and require generationMode=provider"), true);
  assert.equal(plan.steps.some((step) => step.includes("Run application smoke flow")), true);
  assert.equal(plan.steps.some((step) => step.includes("stale send claim recovery")), true);
  assert.equal(plan.requiredEnvironment.includes("EMAIL_CONFIG_SECRET or APP_SECRET"), true);
  assert.equal(plan.requiredEnvironment.includes("AI_API_KEY when remote AI generation is required or --test-ai-provider is used"), true);
  assert.equal(plan.automatedVerification.some((step) => step.includes("email crm smoke flow")), true);
  assert.equal(plan.automatedVerification.some((step) => step.includes("--test-ai-provider") && step.includes("generationMode=provider")), true);
  assert.equal(plan.automatedVerification.some((step) => step.includes("--smoke")), true);
  assert.equal(plan.automatedVerification.some((step) => step.includes("--require-live-readiness") && step.includes("liveTrafficReady=true")), true);
  assert.equal(plan.automatedVerification.some((step) => step.includes("stale send claim recovery")), true);
  assert.equal(plan.automatedVerification.some((step) => step.includes("tests/e2e/email-flow.spec.ts")), true);
  assert.equal(plan.requiredEnvironment.some((item) => item.includes("GMAIL_OAUTH_SCOPE") && item.includes("Gmail read plus send")), true);
  assert.equal(plan.requiredEnvironment.some((item) => item.includes("OUTLOOK_OAUTH_SCOPE") && item.includes("offline_access")), true);
  assert.equal(plan.readinessReport.emittedByDefault, true);
  assert.equal(plan.readinessReport.fields.includes("liveTrafficReady"), true);
  assert.equal(plan.readinessReport.fields.includes("externalMailboxVerified"), true);
  assert.equal(plan.readinessReport.fields.includes("oauthProviders"), true);
  assert.equal(plan.readinessReport.fields.includes("manualActions"), true);
  assert.equal(plan.readinessReport.liveTrafficReadyRequires.some((item) => item.includes("--test-connections")), true);
  assert.equal(plan.readinessReport.liveTrafficReadyRequires.some((item) => item.includes("--test-ai-provider")), true);
  assert.equal(plan.readinessReport.liveTrafficReadyRequires.some((item) => item.includes("--smoke")), true);
  assert.equal(plan.manualVerification.some((step) => step.includes("OAuth callback URL")), true);
  assert.equal(plan.manualVerification.some((step) => step.includes("OAuth authorization")), true);
  assert.equal(plan.manualVerification.some((step) => step.includes("AI entries include source counts") && step.includes("generationMode") && step.includes("providerError")), true);
  const script = readFileSync("scripts/email-verify.ts", "utf8");
  const operationalUser = readFileSync("scripts/operational-user.ts", "utf8");
  assert.match(script, /resolveOperationalUser/);
  assert.match(script, /const requiresOperationalUser = runConnectionTests \|\| runSmoke \|\| requireLiveReadiness/);
  assert.match(script, /checkEmailSubsystemDiagnostics\(\{ includeJobs: true \}\)/);
  assert.match(script, /No workspace-scoped email verification checks were requested/);
  assert.match(script, /const runConnectionTests = Boolean\(args\["test-connections"\] \|\| requireLiveReadiness\)/);
  assert.match(script, /const runAiProviderTest = Boolean\(args\["test-ai-provider"\] \|\| requireLiveReadiness\)/);
  assert.match(script, /const runSmoke = Boolean\(args\.smoke \|\| requireLiveReadiness\)/);
  assert.match(script, /operationalUser:\s*userResolution/);
  assert.match(script, /fallbackUsed:\s*userResolution\.fallbackUsed/);
  assert.match(operationalUser, /export interface OperationalUserResolution/);
  assert.match(operationalUser, /fallbackUsed: Boolean\(requestedUserId && requestedUserId !== context\.user\.id\)/);
  assert.match(operationalUser, /findFirst/);
  assert.match(operationalUser, /permissions:\s*\{\s*has:\s*requiredPermission/);
  assert.match(operationalUser, /No active user with \$\{requiredPermission\}/);
  assert.match(script, /const readiness = buildEmailVerificationReadiness/);
  assert.match(script, /console\.error\(formatEmailVerificationReadinessSummary\(readiness\)\)/);
  assert.match(script, /interface SafeEmailConnectionTestResult/);
  assert.match(script, /result: sanitizeConnectionTestResult\(result\.result\)/);
  assert.match(script, /function sanitizeConnectionTestResult\(result: unknown\): SafeEmailConnectionTestResult/);
  assert.match(script, /function sanitizeVerifierText\(value: string \| undefined\): string \| undefined/);
  assert.match(script, /providerError: sanitizeVerifierText\(result\.providerError\)/);
  assert.match(script, /error: sanitizeVerifierText\(error instanceof Error \? error\.message : "Connection test failed"\)/);
  assert.match(script, /providerError: sanitizeVerifierText\(input\.aiProviderTest\?\.providerError\)/);
  assert.match(script, /sanitizeVerifierText\(`connection:\$\{test\.emailAddress\}: \$\{test\.error \?\? "connection test failed"\}`\)/);
  assert.match(script, /Bearer\|Basic/);
  assert.match(script, /access_token\|refresh_token\|id_token\|api\[_-\]\?key\|client_secret\|password\|secret\|token/);
  assert.match(script, /redacted-jwt/);
  assert.match(script, /sk-\[redacted\]/);
  assert.match(script, /value\.smtp === "ok" \|\| value\.smtp === "skipped"/);
  assert.match(script, /value\.imap === "ok" \|\| value\.imap === "skipped"/);
  assert.match(script, /value\.oauth === "ok" \|\| value\.oauth === "skipped"/);
  assert.match(script, /oauthAccountEmail\.trim\(\)/);
  assert.doesNotMatch(script, /result:\s*result\.result/);
  assert.match(script, /function formatEmailVerificationReadinessSummary\(readiness: ReturnType<typeof buildEmailVerificationReadiness>\): string/);
  assert.match(script, /automatedChecksOk=\$\{readiness\.automatedChecksOk\}/);
  assert.match(script, /liveTrafficReady=\$\{readiness\.liveTrafficReady\}/);
  assert.match(script, /mailboxes=\$\{readiness\.mailboxConnections\.passed\}\/\$\{readiness\.mailboxConnections\.tested\}/);
  assert.match(script, /blockers: \$\{readiness\.blockers\.slice\(0, 5\)\.join\(" \| "\)\}/);
  assert.match(script, /manualActions: \$\{readiness\.manualActions\.slice\(0, 5\)\.join\(" \| "\)\}/);
  assert.match(script, /const ok = automatedChecksOk && \(!requireLiveReadiness \|\| readiness\.liveTrafficReady\)/);
  assert.match(script, /Email live readiness is required but readiness\.liveTrafficReady=false/);
  assert.match(script, /externalMailboxVerified &&\s*aiProviderVerified &&\s*applicationSmokeVerified/);
  assert.doesNotMatch(script, /input\.runAiProviderTest \? aiProviderVerified : diagnostics\.aiProvider\.status === "ok"/);
  assert.match(script, /liveTrafficReady/);
  assert.match(script, /externalMailboxVerified/);
  assert.match(script, /manualActions/);
  assert.match(script, /Update \$\{provider\} OAuth scope to include/);
  assert.match(script, /checkEmailSubsystemDiagnosticsForContext/);
  assert.match(script, /staleOutboundMessageId/);
  assert.match(script, /sendAttemptedAt:\s*new Date\(Date\.now\(\) - 120000\)\.toISOString\(\)/);
  assert.match(script, /Stale sending message was not recovered by the send claim path/);
  assert.match(script, /generationMode:\s*aiResult\.generationMode/);
  assert.match(script, /providerError:\s*aiResult\.providerError/);
  assert.match(script, /runAiProviderTest/);
  assert.match(script, /generationMode=provider/);
  assert.match(script, /testAiProvider/);
  assert.doesNotMatch(script, /checkEmailSubsystemDiagnostics\(\{ accounts, includeJobs: true \}\)/);
});

await run("email browser e2e spec is loadable", () => {
  const result = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "tests/e2e/email-flow.spec.ts", "--list"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /email-flow\.spec\.ts/);
  assert.match(result.stdout, /admin can use email workspace reply translate and send flow/);
});

await run("browser e2e database preflight fails early with actionable guidance", () => {
  const startScript = readFileSync("scripts/e2e-next-start.mjs", "utf8");
  const devScript = readFileSync("scripts/e2e-next-dev.mjs", "utf8");
  assert.match(startScript, /e2e-database-preflight\.mjs/);
  assert.match(devScript, /e2e-database-preflight\.mjs/);

  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import { assertE2eDatabaseReachable } from './scripts/e2e-database-preflight.mjs'; await assertE2eDatabaseReachable('postgresql://crm:crm@127.0.0.1:1/app', { label: 'e2e-test', timeoutMs: 25 });"
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, E2E_SKIP_DATABASE_PREFLIGHT: "false" }
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot reach PostgreSQL at 127\.0\.0\.1:1/);
  assert.match(result.stderr, /docker compose up -d postgres/);
});

await run("database preflight explains missing local Docker separately", () => {
  const message = formatDatabasePreflightFailure({
    label: "local-dev",
    target: { host: "127.0.0.1", port: 54329 },
    purpose: "local browser verification",
    skipEnvName: "E2E_SKIP_DATABASE_PREFLIGHT",
    dockerCompose: { available: false, reason: "docker was not found in PATH" }
  });

  assert.match(message, /Cannot reach PostgreSQL at 127\.0\.0\.1:54329/);
  assert.match(message, /Docker CLI or Docker Compose is not available/);
  assert.match(message, /docker was not found in PATH/);
  assert.match(message, /docker compose up -d postgres/);
  assert.match(message, /E2E_SKIP_DATABASE_PREFLIGHT=true/);
});

await run("local env loader reads env files without overriding explicit environment", async () => {
  const directory = await makeTempDir("crm-local-env");
  const previousBase = process.env.CRM_ENV_TEST_BASE;
  const previousLocal = process.env.CRM_ENV_TEST_LOCAL;
  const previousExisting = process.env.CRM_ENV_TEST_EXISTING;
  try {
    await writeFile(join(directory, ".env"), "CRM_ENV_TEST_BASE=from-env\nCRM_ENV_TEST_EXISTING=from-env\n");
    await writeFile(join(directory, ".env.local"), "CRM_ENV_TEST_LOCAL='from-local'\nCRM_ENV_TEST_BASE=from-local\nCRM_ENV_TEST_EXISTING=from-local\n");
    process.env.CRM_ENV_TEST_EXISTING = "already-set";
    delete process.env.CRM_ENV_TEST_BASE;
    delete process.env.CRM_ENV_TEST_LOCAL;

    loadLocalEnvFiles([".env", ".env.local"], directory);

    assert.equal(process.env.CRM_ENV_TEST_BASE, "from-env");
    assert.equal(process.env.CRM_ENV_TEST_LOCAL, "from-local");
    assert.equal(process.env.CRM_ENV_TEST_EXISTING, "already-set");
  } finally {
    await rm(directory, { recursive: true, force: true });
    restoreEnvValue("CRM_ENV_TEST_BASE", previousBase);
    restoreEnvValue("CRM_ENV_TEST_LOCAL", previousLocal);
    restoreEnvValue("CRM_ENV_TEST_EXISTING", previousExisting);
  }
});

await run("email database preflight parses configured database targets", () => {
  assert.deepEqual(getDatabaseConnectionTarget("postgresql://crm:crm@127.0.0.1:54329/ai_agent_crm?schema=public"), {
    host: "127.0.0.1",
    port: 54329
  });
  assert.deepEqual(getDatabaseConnectionTarget("postgresql://crm:crm@postgres/ai_agent_crm"), {
    host: "postgres",
    port: 5432
  });
  assert.throws(() => getDatabaseConnectionTarget(undefined), /DATABASE_URL/);
  assert.throws(() => getDatabaseConnectionTarget("not a url"), /not a valid URL/);
});

await run("email send status messages distinguish queued sent and failed results", () => {
  assert.equal(formatEmailSendResultMessage({ status: "queued", subject: "Proposal" }), "邮件已加入发送队列 Proposal");
  assert.equal(formatEmailSendResultMessage({ status: "queued", subject: "Proposal", scheduledSendAt: "2026-06-25T03:00:00.000Z" }).startsWith("邮件已加入待发送 Proposal"), true);
  assert.equal(formatEmailSendResultMessage({ status: "sending", subject: "Proposal" }), "邮件正在发送 Proposal");
  assert.equal(formatEmailSendResultMessage({ status: "sent", subject: "Proposal" }), "已发送邮件 Proposal");
  assert.equal(
    formatEmailSendResultMessage({ status: "sent", subject: "Proposal", imapSyncStatus: "failed", imapSyncError: "Sent unavailable" }),
    "已发送邮件 Proposal，但同步到远程“已发送”失败：Sent unavailable"
  );
  assert.equal(formatEmailSendResultMessage({ status: "failed", subject: "Proposal" }), "邮件发送失败 Proposal");
  assert.equal(formatEmailSendResultMessage({ status: "failed", subject: "Proposal", failureReason: "SMTP returned 550" }), "邮件发送失败 Proposal：SMTP returned 550");
});

await run("email workspace exposes scheduled send group send tracking and label management", () => {
  const workspace = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const sendRoute = readFileSync("src/app/api/email/send/route.ts", "utf8");
  const schemas = readFileSync("src/lib/crm/api-schemas.ts", "utf8");
  const worker = readFileSync("src/lib/jobs/worker.ts", "utf8");
  const tracking = readFileSync("src/lib/email/tracking.ts", "utf8");

  assert.match(schemas, /scheduledSendAt: z\.string\(\)\.datetime\(\)\.optional\(\)/);
  assert.match(schemas, /trackingEnabled: z\.boolean\(\)\.optional\(\)/);
  assert.match(schemas, /groupSendMode: z\.boolean\(\)\.optional\(\)/);
  assert.match(workspace, /\{ key: "scheduled", label: "待发送", icon: CalendarClock \}/);
  assert.match(workspace, /data-testid="email-compose-scheduled-send-at"/);
  assert.match(workspace, /data-testid="email-compose-group-send"/);
  assert.match(workspace, /data-testid="email-compose-tracking"/);
  assert.match(workspace, /function removeEmailLabel\(threadId: string, label: string\)/);
  assert.match(workspace, /function getEmailMessageSendStatus\(message: EmailMessage \| undefined\)/);
  assert.match(workspace, /label: "已排队"/);
  assert.match(workspace, /label: "发送中"/);
  assert.match(workspace, /label: message\.sentAt \? `已发送 \$\{formatDate\(message\.sentAt\)\}` : "已发送"/);
  assert.match(workspace, /message\.direction === "outbound" && \(message\.status === "queued" \|\| message\.status === "sending"\)/);
  assert.match(workspace, /const resultMailbox: EmailMailboxKey = messages\.some\(\(item\) => item\.status === "queued" \|\| item\.status === "sending"\) \? "scheduled" : "sent"/);
  assert.match(workspace, /data-testid="email-thread-send-status"/);
  assert.match(workspace, /data-testid="email-message-send-status"/);
  assert.match(workspace, /message\.direction === "outbound" && \(message\.status === "sent" \|\| message\.status === "failed"\)/);
  assert.match(workspace, /data-testid=\{`email-message-edit-sent-\$\{message\.id\}`\}/);
  assert.match(workspace, /type EmailListDisplayMode = "thread" \| "message"/);
  assert.match(workspace, /const \[emailListDisplayMode, setEmailListDisplayMode\] = useState<EmailListDisplayMode>\(routeListDisplayMode\)/);
  assert.match(workspace, /const visibleRows = useMemo\(\(\) => \{/);
  assert.match(workspace, /emailListDisplayMode === "message" && displayMessages\.length/);
  assert.match(workspace, /data-testid="email-list-display-toggle"/);
  assert.match(workspace, /const toggleEmailListDisplayMode = useCallback\(\(\) => \{[\s\S]*const nextMode = emailListDisplayMode === "thread" \? "message" : "thread"[\s\S]*onUpdateListDisplayModePreference\(nextMode\)[\s\S]*applyEmailRoute\(\{ listDisplayMode: nextMode \}\)/);
  assert.match(workspace, /onClick=\{toggleEmailListDisplayMode\}/);
  assert.match(workspace, /async function refreshEmailThreadsByIds\(threadIds: string\[\]\): Promise<EmailThread\[]>/);
  assert.match(workspace, /await refreshEmailThreadsByIds\(messages\.map\(\(item\) => item\.threadId\)\)/);
  assert.match(workspace, /for \(const delayMs of \[2500, 8000\]\)/);
  assert.match(workspace, /\["inbox", "all", "sent", "scheduled", "drafts", "spam", "trash"\]\.includes\(mailbox\)/);
  assert.match(workspace, /void onLoadThreadMessages\(thread\.id\)/);
  assert.match(workspace, /function getEmailThreadDisplayMessage\(messages: EmailMessage\[\], mailbox: EmailMailboxKey, preferredMessageId\?: string\): EmailMessage \| undefined/);
  assert.match(workspace, /function getEmailThreadListDisplayMessage\(messages: EmailMessage\[\], mailbox: EmailMailboxKey, preferredMessageId\?: string\): EmailMessage \| undefined/);
  assert.match(workspace, /if \(mailbox === "inbox" \|\| mailbox === "all" \|\| mailbox === "sent"\) \{[\s\S]*return \[\.\.\.messages\]\.sort\(\(left, right\) => emailMessageTimeValue\(right\)\.localeCompare\(emailMessageTimeValue\(left\)\)\)\[0\]/);
  assert.match(workspace, /if \(mailbox === "all"\) \{\s*return messages\.filter\(\(message\) => message\.direction === "inbound" && message\.status === "received"\);\s*\}/);
  assert.match(workspace, /const hasAllMailMessage = getEmailThreadMailboxMessages\(messages, "all"\)\.length > 0/);
  assert.match(workspace, /mailbox === "all"\s*\?\s*!isDeleted && hasAllMailMessage/);
  assert.match(workspace, /if \(!isDeleted && hasAllMailMessage\) counts\.all \+= 1/);
  assert.match(workspace, /if \(mailbox === "trash"\) \{[\s\S]*const preferredMessage = preferredMessageId \? messages\.find/);
  assert.match(workspace, /const inboxMessage = getEmailThreadMailboxMessages\(messages, "inbox"\)/);
  assert.match(workspace, /visibleRows\.map\(\(\{ key, thread, displayMessages, displayMessage \}\) => \{/);
  assert.match(workspace, /displayMessages: messages\.length \? messages : displayMessages/);
  assert.match(workspace, /displayMessage: getEmailThreadListDisplayMessage\(messages\.length \? messages : displayMessages, mailbox, trashDisplayMessageIds\[thread\.id\]\)/);
  assert.match(workspace, /key=\{key\}/);
  assert.match(workspace, /emailMessageParticipantLabel\(displayMessage, thread, activeAccounts\)/);
  assert.match(workspace, /const selectedDisplayedMessages = selectedMailboxMessages\.length > 0 \? selectedMailboxMessages : selectedMessages/);
  assert.match(workspace, /const selectedThreadDetailMessages =\s*selectedDetailViewMode === "message"[\s\S]*\? selectedDetailMessage[\s\S]*\? \[selectedDetailMessage\][\s\S]*: selectedDisplayMessage[\s\S]*\? \[selectedDisplayMessage\][\s\S]*: \[\][\s\S]*: selectedMessages\.length > 0[\s\S]*\? selectedMessages[\s\S]*: selectedDisplayedMessages/);
  assert.match(workspace, /selectedThreadDetailMessages\.map\(\(message, messageIndex\) => \{/);
  assert.match(workspace, /isThreadListRow[\s\S]*openThreadDetail\(thread\.id, parentTargetMessage\?\.id \?\? ""\)[\s\S]*openSingleMessageDetail\(thread\.id, displayMessage\?\.id \?\? ""\)/);
  assert.match(workspace, /"snooze" \| "unsnooze" \| "important"/);
  assert.match(workspace, /snoozedUntil: null/);
  assert.match(workspace, /aria-label="取消稍后提醒"/);
  assert.match(sendRoute, /queuedBody\.groupSendMode && queuedBody\.to\.length > 1/);
  assert.match(sendRoute, /shouldDelaySend/);
  assert.match(worker, /listDueQueuedEmailMessagesForWorker\(1\)/);
  assert.match(tracking, /function appendEmailTrackingHtml/);
  assert.match(tracking, /\/api\/email\/track\/open\/\$\{encodeURIComponent\(trackingId\)\}/);
  const openTrackRoute = readFileSync("src/app/api/email/track/open/[trackingId]/route.ts", "utf8");
  const clickTrackRoute = readFileSync("src/app/api/email/track/click/[trackingId]/route.ts", "utf8");
  assert.match(openTrackRoute, /SESSION_COOKIE_NAME/);
  assert.match(openTrackRoute, /request\.cookies\.get\(SESSION_COOKIE_NAME\)\?\.value[\s\S]*buildTransparentPixelResponse\(\)/);
  assert.match(clickTrackRoute, /SESSION_COOKIE_NAME/);
  assert.match(clickTrackRoute, /request\.cookies\.get\(SESSION_COOKIE_NAME\)\?\.value[\s\S]*Response\.redirect\(targetUrl, 302\)/);
});

await run("email send failure helper returns persisted failed messages for immediate UI feedback", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Failed Send Lookup",
    emailAddress: "failed-send@example.com",
    provider: "smtp_imap",
    status: "active",
    sendEnabled: true
  });
  const queued = store.queueEmailMessage(context, {
    accountId: account.id,
    to: ["buyer@example.com"],
    subject: "Failed send lookup",
    bodyText: "Expose this failure to the UI."
  });
  const failed = store.updateEmailMessageStatus(context, queued.id, "failed", { failureReason: "SMTP returned 550" });
  const originalError = new Error("Original send failure");

  const result = await getFailedEmailSendResultOrThrow(context, store, failed.id, originalError);
  assert.equal(result.status, "failed");
  assert.equal(result.failureReason, "SMTP returned 550");

  const queuedAgain = store.updateEmailMessageStatus(context, failed.id, "queued");
  await assert.rejects(() => getFailedEmailSendResultOrThrow(context, store, queuedAgain.id, originalError), /Original send failure/);
});

await run("email sync failure helper returns updated error accounts for immediate UI feedback", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Sync Error Lookup",
    emailAddress: "sync-error@example.com",
    provider: "smtp_imap",
    status: "active",
    syncEnabled: true
  });
  const originalError = new Error("IMAP authentication failed");
  const failedAccount = store.markEmailAccountConnectionError(context, account.id, originalError.message);

  const result = await getFailedEmailSyncResultOrThrow(context, store, account.id, originalError);
  assert.equal(result.status, "failed");
  assert.equal(result.account.status, "error");
  assert.equal(result.account.lastConnectionError, "IMAP authentication failed");
  assert.equal(result.error, "IMAP authentication failed");
  assert.equal(result.importedCount, 0);
  assert.equal(result.scannedCount, 0);

  const activeAccount = store.createEmailAccount(context, {
    name: "Active Sync Lookup",
    emailAddress: "active-sync-error@example.com",
    provider: "smtp_imap",
    status: "active",
    syncEnabled: true
  });
  const activeResult = await getFailedEmailSyncResultOrThrow(context, store, activeAccount.id, originalError);
  assert.equal(activeResult.status, "failed");
  assert.equal(activeResult.error, "IMAP authentication failed");
  assert.equal(activeResult.account.status, "active");
});

await run("secret generator emits deployable email secrets", () => {
  const result = spawnSync(process.execPath, ["scripts/generate-secrets.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  const secrets = JSON.parse(result.stdout);
  assert.match(secrets.EMAIL_CONFIG_SECRET, /^[A-Za-z0-9_-]{32,}$/);
  assert.match(secrets.EMAIL_OAUTH_STATE_SECRET, /^[A-Za-z0-9_-]{32,}$/);
  assert.notEqual(secrets.EMAIL_CONFIG_SECRET, secrets.EMAIL_OAUTH_STATE_SECRET);
});

await run("env initializer creates non-placeholder email secrets without overwriting", async () => {
  const directory = await makeTempDir("crm-env-init");
  try {
    const examplePath = join(directory, ".env.example");
    const outputPath = join(directory, ".env");
    await writeFile(
      examplePath,
      [
        'DATABASE_URL="postgresql://crm:crm@127.0.0.1:54329/ai_agent_crm?schema=public"',
        'EMAIL_CONFIG_SECRET="replace-with-at-least-32-random-characters"',
        'EMAIL_OAUTH_STATE_SECRET="replace-with-at-least-32-random-characters"'
      ].join("\n"),
      "utf8"
    );

    const created = spawnSync(process.execPath, ["scripts/init-env.mjs", "--example", examplePath, "--output", outputPath], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    assert.equal(created.status, 0, created.stderr);
    const initialized = readFileSync(outputPath, "utf8");
    assert.doesNotMatch(initialized, /replace-with-at-least-32-random-characters/);
    assert.match(initialized, /EMAIL_CONFIG_SECRET="[A-Za-z0-9_-]{32,}"/);
    assert.match(initialized, /EMAIL_OAUTH_STATE_SECRET="[A-Za-z0-9_-]{32,}"/);

    const blocked = spawnSync(process.execPath, ["scripts/init-env.mjs", "--example", examplePath, "--output", outputPath], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /Refusing to overwrite/);

    const partialPath = join(directory, ".env.local");
    await writeFile(
      partialPath,
      [
        'DATABASE_URL="postgresql://postgres@127.0.0.1:54329/ai_agent_crm?schema=public"',
        'AI_MODEL="existing-model"'
      ].join("\n"),
      "utf8"
    );
    const merged = spawnSync(process.execPath, ["scripts/init-env.mjs", "--example", examplePath, "--output", partialPath, "--merge-missing"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    assert.equal(merged.status, 0, merged.stderr);
    const mergedEnv = readFileSync(partialPath, "utf8");
    assert.match(mergedEnv, /DATABASE_URL="postgresql:\/\/postgres@127\.0\.0\.1:54329\/ai_agent_crm\?schema=public"/);
    assert.match(mergedEnv, /AI_MODEL="existing-model"/);
    assert.match(mergedEnv, /EMAIL_CONFIG_SECRET="[A-Za-z0-9_-]{32,}"/);
    assert.match(mergedEnv, /EMAIL_OAUTH_STATE_SECRET="[A-Za-z0-9_-]{32,}"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await run("compose and env example keep email deployment settings aligned", () => {
  const envExample = readFileSync(".env.example", "utf8");
  const compose = readFileSync("docker-compose.yml", "utf8");

  assert.match(envExample, /DATABASE_URL="postgresql:\/\/crm:crm@127\.0\.0\.1:54329\/ai_agent_crm\?schema=public"/);
  assert.match(compose, /- "54329:5432"/);
  assert.match(compose, /APP_BASE_URL: \$\{APP_BASE_URL:-http:\/\/127\.0\.0\.1:3000\}/);
  assert.match(compose, /ALLOW_INSECURE_APP_BASE_URL: \$\{ALLOW_INSECURE_APP_BASE_URL:-false\}/);
  assert.match(compose, /EMAIL_DELIVERY_MODE: \$\{EMAIL_DELIVERY_MODE:-live\}/);
  assert.match(compose, /EMAIL_CONFIG_SECRET: "\$\{EMAIL_CONFIG_SECRET:\?Set EMAIL_CONFIG_SECRET in \.env\}"/);
  assert.match(compose, /EMAIL_OAUTH_STATE_SECRET: "\$\{EMAIL_OAUTH_STATE_SECRET:\?Set EMAIL_OAUTH_STATE_SECRET in \.env\}"/);
  assert.match(compose, /email-sync:/);
  assert.match(compose, /entrypoint: \["sh", "scripts\/docker-worker-entrypoint\.sh"\]/);
  assert.match(compose, /entrypoint: \["sh", "scripts\/docker-email-sync-entrypoint\.sh"\]/);
  assert.match(compose, /EMAIL_SYNC_INTERVAL_MS: \$\{EMAIL_SYNC_INTERVAL_MS:-300000\}/);
  assert.match(compose, /EMAIL_SYNC_LIMIT: \$\{EMAIL_SYNC_LIMIT:-25\}/);
  assert.match(envExample, /EMAIL_SYNC_INTERVAL_MS="300000"/);
  assert.match(envExample, /EMAIL_SYNC_LIMIT="25"/);
  assert.match(envExample, /EMAIL_SYNC_USER_ID="user-admin"/);
  assert.match(envExample, /EMAIL_SEND_CLAIM_TIMEOUT_MS="900000"/);
  assert.equal((compose.match(/^      APP_BASE_URL:/gm) ?? []).length, 3);
  assert.equal((compose.match(/^      ALLOW_INSECURE_APP_BASE_URL:/gm) ?? []).length, 3);
  assert.equal((compose.match(/^      EMAIL_DELIVERY_MODE:/gm) ?? []).length, 3);
  assert.equal((compose.match(/^      EMAIL_CONFIG_SECRET:/gm) ?? []).length, 3);
  assert.equal((compose.match(/^      EMAIL_OAUTH_STATE_SECRET:/gm) ?? []).length, 3);
});

await run("email sync script dry run describes loop scheduler settings", () => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--import", "./scripts/register-alias.mjs", "scripts/email-sync.ts", "--dry-run", "--loop", "--interval-ms", "60000", "--limit", "25", "--user-id", "user-admin"],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.event, "email_sync_plan");
  assert.equal(plan.userId, "user-admin");
  assert.match(plan.userResolution, /explicit --user-id/);
  assert.equal(plan.loop, true);
  assert.equal(plan.intervalMs, 60000);
  assert.equal(plan.limit, 25);
  assert.match(plan.scheduleSource, /database EmailSyncSettings/);
  assert.equal(plan.requiredPermission, "crm.admin");
  const syncScript = readFileSync("scripts/email-sync.ts", "utf8");
  assert.match(syncScript, /resolveOperationalUser/);
  assert.match(syncScript, /runSyncCycle/);
  assert.match(syncScript, /getEmailSyncSettings\(userResolution\.context\)/);
  assert.match(syncScript, /msUntilDailyTime\(settings\.dailyAt\)/);
  assert.match(syncScript, /settings\.intervalMinutes \* 60_000/);
  assert.match(syncScript, /operationalUser:\s*\{/);
  assert.match(syncScript, /fallbackUsed:\s*userResolution\.fallbackUsed/);
});

await run("email sync script rejects invalid bounded sync limits", () => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--import", "./scripts/register-alias.mjs", "scripts/email-sync.ts", "--dry-run", "--limit", "101"],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /integer between 1 and 100/);
});

await run("production environment validation blocks placeholder email secrets", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-env.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public",
      APP_BASE_URL: "https://crm.example.com",
      EMAIL_CONFIG_SECRET: "replace-with-at-least-32-random-characters",
      EMAIL_OAUTH_STATE_SECRET: "replace-with-at-least-32-random-characters"
    }
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.errors.join("\n"), /deployment-specific random value/);
});

await run("production environment validation reads explicit env file", async () => {
  const script = readFileSync("scripts/validate-env.mjs", "utf8");
  assert.match(script, /env = \{\s*NODE_ENV: process\.env\.NODE_ENV,\s*\.\.\.readEnvFile\(String\(args\["env-file"\]\)\)\s*\}/);
  assert.match(script, /if \(!options\.override && process\.env\[key\] !== undefined\) continue/);
  assert.match(script, /function readEnvFile\(path\)/);

  const directory = await makeTempDir("crm-validate-env-file");
  const envFile = join(directory, "vps.env");
  await writeFile(
    envFile,
    [
      "DATABASE_URL='postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public'",
      "APP_BASE_URL='https://crm.example.com'",
      "ALLOW_INSECURE_APP_BASE_URL='false'",
      "EMAIL_CONFIG_SECRET='test-email-config-secret-32-bytes'",
      "EMAIL_OAUTH_STATE_SECRET='test-oauth-state-secret-32-bytes'",
      "EMAIL_DELIVERY_MODE='live'",
      "EMAIL_SYNC_INTERVAL_MS='300000'",
      "EMAIL_SYNC_LIMIT='25'",
      "EMAIL_SEND_CLAIM_TIMEOUT_MS='900000'"
    ].join("\n")
  );

  const result = spawnSync(process.execPath, ["scripts/validate-env.mjs", "--env-file", envFile, "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      NODE_ENV: "production",
      DATABASE_URL: "",
      APP_BASE_URL: "not-a-url",
      EMAIL_CONFIG_SECRET: "short",
      EMAIL_OAUTH_STATE_SECRET: "short",
      ALLOW_TEST_USER_HEADER: "true",
      EMAIL_DELIVERY_MODE: "dry-run",
      GMAIL_OAUTH_CLIENT_ID: "ambient-gmail-client"
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.errors, []);
});

await run("production environment validation blocks dangerous test auth header", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-env.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public",
      APP_BASE_URL: "https://crm.example.com",
      ALLOW_TEST_USER_HEADER: "true"
    }
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.errors.join("\n"), /ALLOW_TEST_USER_HEADER/);
});

await run("production environment validation blocks dry-run email delivery", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-env.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public",
      APP_BASE_URL: "https://crm.example.com",
      EMAIL_CONFIG_SECRET: "test-email-config-secret-32-bytes",
      EMAIL_DELIVERY_MODE: "dry-run"
    }
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.errors.join("\n"), /EMAIL_DELIVERY_MODE/);
});

await run("production environment validation blocks invalid email sync interval", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-env.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public",
      APP_BASE_URL: "https://crm.example.com",
      EMAIL_CONFIG_SECRET: "test-email-config-secret-32-bytes",
      EMAIL_OAUTH_STATE_SECRET: "test-oauth-state-secret-32-bytes",
      EMAIL_SYNC_INTERVAL_MS: "0"
    }
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.errors.join("\n"), /EMAIL_SYNC_INTERVAL_MS/);
});

await run("production environment validation blocks invalid email sync limit", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-env.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public",
      APP_BASE_URL: "https://crm.example.com",
      EMAIL_CONFIG_SECRET: "test-email-config-secret-32-bytes",
      EMAIL_OAUTH_STATE_SECRET: "test-oauth-state-secret-32-bytes",
      EMAIL_SYNC_LIMIT: "101"
    }
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.errors.join("\n"), /EMAIL_SYNC_LIMIT/);
});

await run("production environment validation blocks invalid email send claim timeout", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-env.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public",
      APP_BASE_URL: "https://crm.example.com",
      EMAIL_CONFIG_SECRET: "test-email-config-secret-32-bytes",
      EMAIL_OAUTH_STATE_SECRET: "test-oauth-state-secret-32-bytes",
      EMAIL_SEND_CLAIM_TIMEOUT_MS: "0"
    }
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.errors.join("\n"), /EMAIL_SEND_CLAIM_TIMEOUT_MS/);
});

await run("production environment validation blocks insecure public app base url", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-env.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public",
      APP_BASE_URL: "http://crm.example.com"
    }
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.errors.join("\n"), /https/);
});

await run("production environment validation blocks weak oauth state secret", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-env.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public",
      APP_BASE_URL: "https://crm.example.com",
      EMAIL_CONFIG_SECRET: "test-email-config-secret-32-bytes",
      EMAIL_OAUTH_STATE_SECRET: "short"
    }
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.errors.join("\n"), /EMAIL_OAUTH_STATE_SECRET/);
});

await run("production environment validation blocks duplicate email secrets", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-env.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public",
      APP_BASE_URL: "https://crm.example.com",
      EMAIL_CONFIG_SECRET: "same-email-secret-32-random-bytes",
      EMAIL_OAUTH_STATE_SECRET: "same-email-secret-32-random-bytes"
    }
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.errors.join("\n"), /different random values/);
});

await run("production environment validation blocks live ai readiness without api key", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-env.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public",
      APP_BASE_URL: "https://crm.example.com",
      EMAIL_CONFIG_SECRET: "test-email-config-secret-32-bytes",
      EMAIL_OAUTH_STATE_SECRET: "test-oauth-state-secret-32-bytes",
      REQUIRE_LIVE_EMAIL_READINESS: "true",
      AI_API_KEY: ""
    }
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.errors.join("\n"), /AI_API_KEY is required/);
});

await run("production environment validation blocks partial oauth client pairs", () => {
  const gmail = spawnSync(process.execPath, ["scripts/validate-env.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public",
      APP_BASE_URL: "https://crm.example.com",
      EMAIL_CONFIG_SECRET: "test-email-config-secret-32-bytes",
      EMAIL_OAUTH_STATE_SECRET: "test-oauth-state-secret-32-bytes",
      GMAIL_OAUTH_CLIENT_ID: "gmail-client",
      GMAIL_OAUTH_CLIENT_SECRET: ""
    }
  });
  assert.equal(gmail.status, 1);
  const gmailPayload = JSON.parse(gmail.stdout);
  assert.match(gmailPayload.errors.join("\n"), /GMAIL OAuth requires both/);
  assert.doesNotMatch(gmail.stdout + gmail.stderr, /gmail-client/);

  const outlook = spawnSync(process.execPath, ["scripts/validate-env.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public",
      APP_BASE_URL: "https://crm.example.com",
      EMAIL_CONFIG_SECRET: "test-email-config-secret-32-bytes",
      EMAIL_OAUTH_STATE_SECRET: "test-oauth-state-secret-32-bytes",
      OUTLOOK_OAUTH_CLIENT_ID: "",
      OUTLOOK_OAUTH_CLIENT_SECRET: "outlook-secret"
    }
  });
  assert.equal(outlook.status, 1);
  const outlookPayload = JSON.parse(outlook.stdout);
  assert.match(outlookPayload.errors.join("\n"), /OUTLOOK OAuth requires both/);
  assert.doesNotMatch(outlook.stdout + outlook.stderr, /outlook-secret/);
});

await run("production environment validation blocks invalid oauth provider scopes", () => {
  const gmail = spawnSync(process.execPath, ["scripts/validate-env.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public",
      APP_BASE_URL: "https://crm.example.com",
      EMAIL_CONFIG_SECRET: "test-email-config-secret-32-bytes",
      EMAIL_OAUTH_STATE_SECRET: "test-oauth-state-secret-32-bytes",
      GMAIL_OAUTH_CLIENT_ID: "gmail-client",
      GMAIL_OAUTH_CLIENT_SECRET: "gmail-secret",
      GMAIL_OAUTH_SCOPE: "https://www.googleapis.com/auth/gmail.readonly"
    }
  });
  assert.equal(gmail.status, 1);
  const gmailPayload = JSON.parse(gmail.stdout);
  assert.match(gmailPayload.errors.join("\n"), /GMAIL_OAUTH_SCOPE/);
  assert.match(gmailPayload.errors.join("\n"), /gmail\.send/);
  assert.doesNotMatch(gmail.stdout + gmail.stderr, /gmail-secret/);

  const outlook = spawnSync(process.execPath, ["scripts/validate-env.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public",
      APP_BASE_URL: "https://crm.example.com",
      EMAIL_CONFIG_SECRET: "test-email-config-secret-32-bytes",
      EMAIL_OAUTH_STATE_SECRET: "test-oauth-state-secret-32-bytes",
      OUTLOOK_OAUTH_CLIENT_ID: "outlook-client",
      OUTLOOK_OAUTH_CLIENT_SECRET: "outlook-secret",
      OUTLOOK_OAUTH_SCOPE: "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send"
    }
  });
  assert.equal(outlook.status, 1);
  const outlookPayload = JSON.parse(outlook.stdout);
  assert.match(outlookPayload.errors.join("\n"), /OUTLOOK_OAUTH_SCOPE/);
  assert.match(outlookPayload.errors.join("\n"), /offline_access/);
  assert.doesNotMatch(outlook.stdout + outlook.stderr, /outlook-secret/);
});

await run("production environment validation allows local compose but warns on demo seed", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-env.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://crm:crm@postgres:5432/ai_agent_crm?schema=public",
      APP_BASE_URL: "http://127.0.0.1:3000",
      EMAIL_CONFIG_SECRET: "test-email-config-secret-32-bytes",
      JOB_EXECUTOR: "redis",
      REDIS_URL: "redis://redis:6379",
      SEED_ON_EMPTY: "true"
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.match(payload.warnings.join("\n"), /SEED_ON_EMPTY/);
});

await run("permission catalog describes every seeded permission", () => {
  const catalogKeys = permissionCatalog.map((permission) => permission.key);
  const seededPermissions = [...new Set(seedData.roles.flatMap((role) => role.permissions))];

  assert.equal(new Set(catalogKeys).size, catalogKeys.length);
  assert.deepEqual(
    seededPermissions.filter((permission) => !catalogKeys.includes(permission)),
    []
  );
  for (const permission of permissionCatalog) {
    assert.equal(describePermission(permission.key).key, permission.key);
    assert.ok(permission.label);
    assert.ok(permission.description);
  }
});

await run("admins can create update and delete unassigned roles", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const role = store.createRole(context, {
    name: "Import Operator",
    permissions: ["crm.read", "crm.import"]
  });

  const updated = store.updateRole(context, role.id, {
    name: "Import Manager",
    permissions: ["crm.read", "crm.import", "ai.use"]
  });

  assert.equal(updated.name, "Import Manager");
  assert.deepEqual(updated.permissions, ["crm.read", "crm.import", "ai.use"]);
  assert.equal(store.listRoles(context).some((candidate) => candidate.id === role.id), true);

  store.deleteRole(context, role.id);
  assert.equal(store.listRoles(context).some((candidate) => candidate.id === role.id), false);
});

await run("role management blocks unsafe permission changes", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");

  assert.throws(
    () => store.createRole(context, { name: "Bad Role", permissions: ["crm.read", "crm.drop"] }),
    /unsupported permissions/
  );
  assert.throws(() => store.deleteRole(context, "role-sales"), /assigned to 1 users/);
  assert.throws(() => store.updateRole(context, "role-admin", { permissions: ["crm.read", "crm.write"] }), /crm\.admin/);
});

await run("admins can manage teams and user assignments", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const team = store.createTeam(context, { name: "Enterprise Sales" });
  const role = store.createRole(context, { name: "Account Executive", permissions: ["crm.read", "crm.write"] });
  const user = store.createUser(context, {
    email: "new-sales@example.com",
    name: "New Sales",
    roleId: role.id,
    teamId: team.id,
    password: "NewSales123!"
  });

  assert.equal(user.email, "new-sales@example.com");
  assert.equal(user.teamId, team.id);

  const updatedTeam = store.updateTeam(context, team.id, { name: "Strategic Sales" });
  const updatedUser = store.updateUser(context, user.id, { name: "Strategic Seller", teamId: "", password: "Changed123!" });

  assert.equal(updatedTeam.name, "Strategic Sales");
  assert.equal(updatedUser.name, "Strategic Seller");
  assert.equal(updatedUser.teamId, undefined);
  const disabledUser = store.updateUser(context, user.id, { active: false });
  assert.equal(disabledUser.active, false);
  assert.throws(() => store.getContext(user.id), /disabled/);

  store.deleteTeam(context, team.id);
  assert.equal(store.listTeams(context).some((candidate) => candidate.id === team.id), false);
});

await run("user and team management blocks unsafe changes", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");

  assert.throws(
    () => store.createUser(context, { email: "bad", name: "Bad User", roleId: "role-sales", password: "Password123!" }),
    /email/
  );
  assert.throws(
    () => store.createUser(context, { email: "short@example.com", name: "Short Password", roleId: "role-sales", password: "short" }),
    /Password/
  );
  assert.throws(() => store.deleteTeam(context, "team-sales"), /assigned to 2 users/);
  assert.throws(() => store.updateUser(context, "user-admin", { roleId: "role-sales" }), /crm\.admin/);
  assert.throws(() => store.updateUser(context, "user-admin", { active: false }), /crm\.admin/);
});

await run("admins can create custom metadata and records", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const object = store.createObjectDefinition(context, {
    key: "regions",
    label: "Region",
    pluralLabel: "Regions",
    description: "Sales regions",
    icon: "Map"
  });

  store.createFieldDefinition(context, {
    objectKey: object.key,
    key: "code",
    label: "Region code",
    type: "text",
    required: true,
    unique: true
  });

  const record = store.createRecord(context, object.key, { title: "East China", data: { code: "east" } });
  assert.equal(record.title, "East China");
  assert.equal(store.listRecords(context, "regions").length, 1);
});

await run("admins can create and revoke api keys without storing the plaintext token", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const created = store.createApiKey(context, {
    name: "Warehouse Sync",
    permissions: ["crm.read", "crm.import"]
  });

  assert.match(created.token, /^crm_live_/);
  assert.equal(created.apiKey.name, "Warehouse Sync");
  assert.deepEqual(created.apiKey.permissions, ["crm.read", "crm.import"]);
  assert.equal("tokenHash" in created.apiKey, false);
  assert.equal(store.listApiKeys(context).some((apiKey) => apiKey.id === created.apiKey.id), true);

  const revoked = store.revokeApiKey(context, created.apiKey.id);
  assert.equal(Boolean(revoked.revokedAt), true);
  assert.equal(store.listAuditLogs(context, { entityType: "api_key" }).some((log) => log.entityId === created.apiKey.id), true);
});

await run("api key management requires admin and blocks admin-scoped keys", () => {
  const store = new CrmStore();
  const adminContext = store.getContext("user-admin");
  const salesContext = store.getContext("user-sales");

  assert.throws(() => store.listApiKeys(salesContext), /crm\.admin/);
  assert.throws(() => store.createApiKey(salesContext, { name: "Nope", permissions: ["crm.read"] }), /crm\.admin/);
  assert.throws(() => store.createApiKey(adminContext, { name: "Too Powerful", permissions: ["crm.admin"] }), /unsupported permissions/);
});

await run("admins can create update and test webhooks without exposing stored secrets", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const created = store.createWebhook(context, {
    name: "Ops Hook",
    url: "https://example.com/webhooks/crm",
    events: ["webhook.test", "record.created"]
  });

  assert.match(created.secret, /^whsec_/);
  assert.equal(created.webhook.name, "Ops Hook");
  assert.equal("secret" in created.webhook, false);
  assert.deepEqual(created.webhook.events, ["webhook.test", "record.created"]);

  const updated = store.updateWebhook(context, created.webhook.id, { active: false });
  assert.equal(updated.active, false);
  assert.throws(() => store.testWebhook(context, created.webhook.id), /inactive/);

  store.updateWebhook(context, created.webhook.id, { active: true });
  const delivery = store.testWebhook(context, created.webhook.id);
  assert.equal(delivery.status, "success");
  assert.equal(delivery.event, "webhook.test");
  assert.equal(store.listWebhookDeliveries(context, created.webhook.id).some((candidate) => candidate.id === delivery.id), true);
  assert.equal(store.listAuditLogs(context, { entityType: "webhook_delivery" }).some((log) => log.entityId === delivery.id), true);
});

await run("webhook management requires admin and validates https event subscriptions", () => {
  const store = new CrmStore();
  const adminContext = store.getContext("user-admin");
  const salesContext = store.getContext("user-sales");

  assert.throws(() => store.listWebhooks(salesContext), /crm\.admin/);
  assert.throws(() => store.createWebhook(salesContext, { name: "Nope", url: "https://example.com/hook", events: ["webhook.test"] }), /crm\.admin/);
  assert.throws(() => store.createWebhook(adminContext, { name: "Bad URL", url: "http://example.com/hook", events: ["webhook.test"] }), /HTTPS/);
  assert.throws(() => store.createWebhook(adminContext, { name: "Bad Event", url: "https://example.com/hook", events: ["bad.event"] }), /unsupported events/);
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.throws(() => store.createWebhook(adminContext, { name: "Private URL", url: "https://127.0.0.1/hook", events: ["webhook.test"] }), /private network/);
  } finally {
    restoreEnv("NODE_ENV", previousNodeEnv);
  }
});

await run("webhook subscriptions receive record activity and import events", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const created = store.createWebhook(context, {
    name: "Event Hook",
    url: "https://example.com/webhooks/events",
    events: ["record.created", "record.updated", "record.deleted", "activity.created", "import.completed", "import.failed"]
  });

  const record = store.createRecord(context, "contacts", { title: "Event Contact", data: { email: "event-contact@example.com" } });
  store.updateRecord(context, "contacts", record.id, { data: { phone: "13800000009" } });
  store.createActivity(context, { recordId: record.id, type: "note", title: "Event Note" });
  store.deleteRecord(context, "contacts", record.id);

  const completed = store.createCsvImportJob(context, {
    objectKey: "deals",
    csv: "title,amount\nEvent Deal,1200",
    strategy: "skip-invalid"
  });
  const queued = store.createQueuedCsvImportJob(context, {
    objectKey: "contacts",
    csv: "title,email\nBad Import,bad-import@example.com",
    strategy: "skip-invalid"
  });
  const failed = store.runCsvImportJob(context, queued.id, {
    objectKey: "missing-objects",
    csv: "title,email\nBad Import,bad-import@example.com",
    strategy: "skip-invalid"
  });

  const deliveries = store.listWebhookDeliveries(context, created.webhook.id);
  assert.equal(deliveries.some((delivery) => delivery.event === "record.created" && delivery.requestBody.data?.recordId === record.id), true);
  assert.equal(deliveries.some((delivery) => delivery.event === "record.updated" && delivery.requestBody.data?.recordId === record.id), true);
  assert.equal(deliveries.some((delivery) => delivery.event === "activity.created" && delivery.requestBody.data?.title === "Event Note"), true);
  assert.equal(deliveries.some((delivery) => delivery.event === "record.deleted" && delivery.requestBody.data?.recordId === record.id), true);
  assert.equal(deliveries.some((delivery) => delivery.event === "import.completed" && delivery.requestBody.data?.jobId === completed.id), true);
  assert.equal(deliveries.some((delivery) => delivery.event === "import.failed" && delivery.requestBody.data?.jobId === failed.id), true);

  store.updateWebhook(context, created.webhook.id, { active: false });
  const beforeInactive = store.listWebhookDeliveries(context, created.webhook.id).length;
  store.createRecord(context, "contacts", { title: "Inactive Hook Contact", data: { email: "inactive-hook@example.com" } });
  assert.equal(store.listWebhookDeliveries(context, created.webhook.id).length, beforeInactive);
});

await run("webhook subscriptions can target specific crm objects and email messages", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const created = store.createWebhook(context, {
    name: "Scoped Hook",
    url: "https://example.com/webhooks/scoped",
    events: ["record.contacts.created", "record.companies.created", "email.message.created"]
  });

  const contact = store.createRecord(context, "contacts", { title: "Scoped Contact", data: { email: "scoped-contact@example.com" } });
  const company = store.createRecord(context, "companies", { title: "Scoped Company", data: { domain: "scoped.example" } });
  store.createRecord(context, "deals", { title: "Unscoped Deal", data: { amount: 100 } });
  const account = store.createEmailAccount(context, {
    name: "Scoped Inbox",
    emailAddress: "scoped-inbox@example.com",
    provider: "smtp_imap",
    syncEnabled: true,
    sendEnabled: true,
    status: "active"
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "buyer@example.com",
    to: ["scoped-inbox@example.com"],
    subject: "Scoped email",
    bodyText: "Notify subscribers"
  });

  const deliveries = store.listWebhookDeliveries(context, created.webhook.id);
  assert.equal(deliveries.some((delivery) => delivery.event === "record.contacts.created" && delivery.requestBody.data?.recordId === contact.id), true);
  assert.equal(deliveries.some((delivery) => delivery.event === "record.companies.created" && delivery.requestBody.data?.recordId === company.id), true);
  assert.equal(deliveries.some((delivery) => delivery.event === "record.deals.created"), false);
  assert.equal(deliveries.some((delivery) => delivery.event === "email.message.created" && delivery.requestBody.data?.messageId === message.id), true);
});

await run("email message lifecycle webhook events distinguish received queued sent and failed", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const created = store.createWebhook(context, {
    name: "Email Lifecycle Hook",
    url: "https://example.com/webhooks/email-lifecycle",
    events: ["email.message.created", "email.message.received", "email.message.queued", "email.message.sent", "email.message.failed"]
  });
  const account = store.createEmailAccount(context, {
    name: "Lifecycle Inbox",
    emailAddress: "lifecycle@example.com",
    provider: "smtp_imap",
    syncEnabled: true,
    sendEnabled: true,
    status: "active"
  });

  const inbound = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "buyer@example.com",
    to: ["lifecycle@example.com"],
    subject: "Inbound inquiry",
    bodyText: "Please send details"
  });
  const queued = store.queueEmailMessage(context, {
    accountId: account.id,
    to: ["buyer@example.com"],
    subject: "Queued proposal",
    bodyText: "Queued response"
  });
  const failedQueued = store.queueEmailMessage(context, {
    accountId: account.id,
    to: ["buyer@example.com"],
    subject: "Failed proposal",
    bodyText: "Failed response"
  });
  const sent = store.updateEmailMessageStatus(context, queued.id, "sent", { externalMessageId: "sent-1" });
  const failed = store.updateEmailMessageStatus(context, failedQueued.id, "failed", { failureReason: "SMTP 550" });

  const deliveries = store.listWebhookDeliveries(context, created.webhook.id);
  assert.equal(deliveries.some((delivery) => delivery.event === "email.message.created" && delivery.requestBody.data?.messageId === inbound.id), true);
  assert.equal(deliveries.some((delivery) => delivery.event === "email.message.received" && delivery.requestBody.data?.messageId === inbound.id), true);
  assert.equal(deliveries.some((delivery) => delivery.event === "email.message.queued" && delivery.requestBody.data?.messageId === queued.id), true);
  assert.equal(deliveries.some((delivery) => delivery.event === "email.message.sent" && delivery.requestBody.data?.messageId === sent.id && delivery.requestBody.data?.status === "sent"), true);
  assert.equal(deliveries.some((delivery) => delivery.event === "email.message.failed" && delivery.requestBody.data?.messageId === failed.id && delivery.requestBody.data?.failureReason === "SMTP 550"), true);
});

await run("inbound email recording tolerates malformed participant addresses", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Malformed Inbox",
    emailAddress: "malformed-inbox@example.com",
    provider: "smtp_imap",
    syncEnabled: true,
    sendEnabled: true,
    status: "active"
  });

  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "",
    to: ["undisclosed-recipients:;"],
    cc: ["manager@example.com", "not-an-email"],
    bcc: ["also-not-an-email"],
    subject: "Malformed recipients",
    bodyText: "This inbound message should still sync."
  });

  assert.equal(message.from, "unknown-sender@invalid.local");
  assert.deepEqual(message.to, ["malformed-inbox@example.com"]);
  assert.deepEqual(message.cc, ["manager@example.com"]);
  assert.deepEqual(message.bcc, []);
});

await run("inbound email auto-link tolerates display-name contact emails", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const contact = store.createRecord(context, "contacts", {
    title: "Legacy Instagram Contact",
    data: {
      email: "Instagram<no-reply@mail.instagram.com>",
      contactMethods: [
        {
          id: "legacy-email",
          type: "email",
          label: "Instagram Email",
          value: "Instagram<no-reply@mail.instagram.com>",
          primary: true
        }
      ]
    }
  });
  const account = store.createEmailAccount(context, {
    name: "Legacy Auto Link Inbox",
    emailAddress: "legacy-auto-link@example.com",
    provider: "smtp_imap",
    syncEnabled: true,
    sendEnabled: true,
    status: "active"
  });

  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "no-reply@mail.instagram.com",
    to: ["legacy-auto-link@example.com"],
    subject: "Legacy display-name address",
    bodyText: "This inbound message should auto-link."
  });

  assert.equal(store.getEmailThread(context, message.threadId).recordId, contact.id);
});

await run("outbound email recording still rejects malformed recipient addresses", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Strict Outbox",
    emailAddress: "strict-outbox@example.com",
    provider: "smtp_imap",
    syncEnabled: true,
    sendEnabled: true,
    status: "active"
  });

  assert.throws(
    () =>
      store.recordEmailMessage(context, {
        accountId: account.id,
        direction: "outbound",
        from: "strict-outbox@example.com",
        to: ["not-an-email"],
        subject: "Invalid outbound",
        bodyText: "This should not be sent."
      }),
    /Email address must be valid/
  );
});

await run("webhook delivery filters and retries preserve payload attempts", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const created = store.createWebhook(context, {
    name: "Retry Hook",
    url: "https://example.com/webhooks/retry",
    events: ["webhook.test"]
  });
  const delivery = store.testWebhook(context, created.webhook.id);

  const filtered = store.listWebhookDeliveries(context, created.webhook.id, {
    status: "success",
    event: "webhook.test",
    limit: 1
  });
  assert.deepEqual(filtered.map((candidate) => candidate.id), [delivery.id]);

  const retry = store.retryWebhookDelivery(context, created.webhook.id, delivery.id);
  assert.equal(retry.event, "webhook.test");
  assert.equal(retry.attempts, 2);
  assert.equal(retry.requestBody.data?.test, true);

  store.updateWebhook(context, created.webhook.id, { active: false });
  assert.throws(() => store.retryWebhookDelivery(context, created.webhook.id, delivery.id), /inactive/);
});

await run("admins can manage relations, pipelines, and saved views", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");

  const relation = store.createRelationDefinition(context, {
    fromObjectKey: "companies",
    toObjectKey: "partners",
    key: "company_partners",
    label: "Company Partners",
    cardinality: "many-to-many"
  });
  const updatedRelation = store.updateRelationDefinition(context, relation.id, { label: "Partner Accounts" });

  const pipeline = store.createPipeline(context, {
    objectKey: "partners",
    name: "Partner Pipeline",
    isDefault: true,
    stages: [{ key: "new", label: "New", probability: 0.1, position: 1, color: "#2563eb" }]
  });
  const updatedPipeline = store.updatePipeline(context, pipeline.id, {
    stages: [{ key: "active", label: "Active", probability: 0.6, position: 1, color: "#0f766e" }]
  });

  const view = store.createSavedView(context, {
    objectKey: "partners",
    name: "Partner Overview",
    columns: ["title", "tier"],
    sort: { field: "title", direction: "asc" },
    isDefault: true
  });
  const updatedView = store.updateSavedView(context, view.id, { name: "Partner List" });

  assert.equal(updatedRelation.label, "Partner Accounts");
  assert.equal(updatedPipeline.stages[0]?.key, "active");
  assert.equal(updatedView.name, "Partner List");

  store.deleteRelationDefinition(context, relation.id);
  store.deletePipeline(context, pipeline.id);
  store.deleteSavedView(context, view.id);

  assert.equal(store.listRelationDefinitions(context).some((item) => item.id === relation.id), false);
  assert.equal(store.listPipelines(context).some((item) => item.id === pipeline.id), false);
  assert.equal(store.listSavedViews(context, "partners").some((item) => item.id === view.id), false);
});

await run("saved views reject unknown columns filters and sorts", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");

  assert.throws(
    () =>
      store.createSavedView(context, {
        objectKey: "contacts",
        name: "Bad Column View",
        columns: ["title", "missingField"],
        isDefault: false
      }),
    /unknown column missingField/
  );

  assert.throws(
    () =>
      store.createSavedView(context, {
        objectKey: "contacts",
        name: "Bad Filter View",
        columns: ["title"],
        filters: [{ field: "missingFilter", operator: "equals", value: "x" }],
        isDefault: false
      }),
    /unknown filter field missingFilter/
  );

  const view = store.createSavedView(context, {
    objectKey: "contacts",
    name: "Valid Owner View",
    columns: ["title", "ownerId"],
    filters: [{ field: "ownerId", operator: "equals", value: "user-sales" }],
    sort: { field: "updatedAt", direction: "desc" },
    isDefault: false
  });

  assert.equal(view.columns.includes("ownerId"), true);
  assert.throws(() => store.updateSavedView(context, view.id, { sort: { field: "missingSort", direction: "asc" } }), /unknown sort field missingSort/);
});

await run("object deletion is blocked by records and inbound references", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const region = store.createObjectDefinition(context, {
    key: "regions",
    label: "Region",
    pluralLabel: "Regions"
  });
  store.createRecord(context, "regions", { title: "North", data: {} });

  assert.throws(() => store.deleteObjectDefinition(context, region.id), /still has 1 records/);

  const vendor = store.createObjectDefinition(context, {
    key: "vendors",
    label: "Vendor",
    pluralLabel: "Vendors"
  });
  store.createFieldDefinition(context, {
    objectKey: "contacts",
    key: "vendorId",
    label: "Vendor",
    type: "reference",
    options: [{ label: "Vendor", value: "vendors" }]
  });

  assert.throws(() => store.deleteObjectDefinition(context, vendor.id), /still references it/);
});

await run("relation deletion is blocked while reference data still uses it", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const relation = store.listRelationDefinitions(context).find((item) => item.key === "company_contacts");

  assert.ok(relation);
  assert.throws(() => store.deleteRelationDefinition(context, relation.id), /still uses field/);
});

await run("pipeline stage changes are blocked while records use removed stages", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const pipeline = store.listPipelines(context).find((item) => item.objectKey === "deals" && item.isDefault);

  assert.ok(pipeline);
  assert.throws(
    () =>
      store.updatePipeline(context, pipeline.id, {
        stages: pipeline.stages.filter((stage) => stage.key !== "proposal")
      }),
    /cannot remove stage proposal/
  );
});

await run("pipeline deletion is blocked while records still use pipeline stages", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const pipeline = store.listPipelines(context).find((item) => item.objectKey === "deals" && item.isDefault);

  assert.ok(pipeline);
  assert.throws(() => store.deletePipeline(context, pipeline.id), /still uses a pipeline stage/);
});

await run("field deletion is blocked while records or views still use the field", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const field = store.createFieldDefinition(context, {
    objectKey: "contacts",
    key: "externalCode",
    label: "External Code",
    type: "text"
  });
  const record = store.createRecord(context, "contacts", {
    title: "Delete Guard",
    data: { email: "delete-guard@example.com", externalCode: "EXT-1" }
  });

  assert.throws(() => store.deleteFieldDefinition(context, field.id), /still has data/);
  store.updateRecord(context, "contacts", record.id, { data: { externalCode: "" } });

  const view = store.createSavedView(context, {
    objectKey: "contacts",
    name: "External Codes",
    columns: ["title", "externalCode"],
    isDefault: false
  });
  assert.throws(() => store.deleteFieldDefinition(context, field.id), /saved view/);

  store.deleteSavedView(context, view.id);
  assert.doesNotThrow(() => store.deleteFieldDefinition(context, field.id));
});

await run("unique field changes are rejected when existing records already duplicate values", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const field = store.createFieldDefinition(context, {
    objectKey: "contacts",
    key: "legacyCode",
    label: "Legacy Code",
    type: "text"
  });

  store.createRecord(context, "contacts", { title: "Legacy A", data: { email: "legacy-a@example.com", legacyCode: "DUP" } });
  store.createRecord(context, "contacts", { title: "Legacy B", data: { email: "legacy-b@example.com", legacyCode: "dup" } });

  assert.throws(() => store.updateFieldDefinition(context, field.id, { unique: true }), /cannot be unique/);
});

await run("reference fields require existing target objects and records", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");

  assert.throws(
    () =>
      store.createFieldDefinition(context, {
        objectKey: "contacts",
        key: "missingAccountId",
        label: "Missing Account",
        type: "reference",
        options: [{ label: "Missing", value: "missing_accounts" }]
      }),
    /对象不存在|Object|not found/i
  );

  const field = store.createFieldDefinition(context, {
    objectKey: "contacts",
    key: "primaryDealId",
    label: "Primary Deal",
    type: "reference",
    options: [{ label: "Deal", value: "deals" }]
  });

  assert.equal(field.type, "reference");
  assert.throws(
    () =>
      store.createRecord(context, "contacts", {
        title: "Broken Reference",
        data: { email: "broken-reference@example.com", primaryDealId: "deal-missing" }
      }),
    /missing record/
  );
});

await run("sales users cannot manage metadata", () => {
  const store = new CrmStore();
  const context = store.getContext("user-sales");

  assert.throws(
    () =>
      store.createObjectDefinition(context, {
        key: "regions",
        label: "Region",
        pluralLabel: "Regions"
      }),
    /crm\.admin/
  );

  assert.throws(
    () =>
      store.createRelationDefinition(context, {
        fromObjectKey: "companies",
        toObjectKey: "contacts",
        key: "blocked_relation",
        label: "Blocked Relation",
        cardinality: "one-to-many"
      }),
    /crm\.admin/
  );
});

await run("sales users see public pool and own private contact records only", () => {
  const snapshot = structuredClone(seedData);
  snapshot.teams.push({ id: "team-enterprise", workspaceId: defaultWorkspaceId, name: "Enterprise" });
  snapshot.users.push({
    id: "user-other",
    workspaceId: defaultWorkspaceId,
    email: "other@example.com",
    name: "Other Sales",
    roleId: "role-sales",
    teamId: "team-enterprise"
  });
  snapshot.records.push({
    id: "contact-other",
    workspaceId: defaultWorkspaceId,
    objectKey: "contacts",
    title: "Other Team Contact",
    ownerId: "user-other",
    data: { email: "other-team@example.com" },
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z"
  });
  snapshot.records.push({
    id: "contact-public",
    workspaceId: defaultWorkspaceId,
    objectKey: "contacts",
    title: "Public Pool Contact",
    data: { email: "public-pool@example.com" },
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z"
  });

  const store = new CrmStore(snapshot);
  const salesContext = store.getContext("user-sales");
  const adminContext = store.getContext("user-admin");

  assert.equal(store.listRecords(salesContext, "contacts").some((record) => record.id === "contact-other"), false);
  assert.equal(store.listRecords(salesContext, "contacts").some((record) => record.id === "contact-public"), true);
  assert.deepEqual(
    store.queryRecords(salesContext, "contacts", { pool: "public" }).records.map((record) => record.id),
    ["contact-public"]
  );
  assert.equal(store.queryRecords(salesContext, "contacts", { pool: "private" }).records.every((record) => record.ownerId === "user-sales"), true);
  assert.throws(() => store.getRecord(salesContext, "contacts", "contact-other"), /记录不存在|not found/);
  const hiddenActivity = store.createActivity(adminContext, { recordId: "contact-other", type: "note", title: "Hidden activity" });
  assert.equal(store.listActivities(salesContext, "contact-other").length, 0);
  assert.throws(() => store.getActivity(salesContext, hiddenActivity.id), /Activity not found/);
  assert.throws(
    () => store.createActivity(salesContext, { recordId: "contact-other", type: "note", title: "Blocked" }),
    /记录不存在|not found/
  );
  assert.equal(store.getRecord(adminContext, "contacts", "contact-other").id, "contact-other");
  assert.equal(store.getActivity(adminContext, hiddenActivity.id).title, "Hidden activity");
});

await run("public pool claim release and admin transfer enforce ownership rules", () => {
  const snapshot = structuredClone(seedData);
  snapshot.records.push({
    id: "contact-public-claim",
    workspaceId: defaultWorkspaceId,
    objectKey: "contacts",
    title: "Claimable Contact",
    data: { email: "claimable@example.com" },
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z"
  });
  snapshot.records.push({
    id: "contact-admin-private",
    workspaceId: defaultWorkspaceId,
    objectKey: "contacts",
    title: "Admin Private Contact",
    ownerId: "user-admin",
    data: { email: "admin-private@example.com" },
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z"
  });
  const store = new CrmStore(snapshot);
  const adminContext = store.getContext("user-admin");
  const salesContext = store.getContext("user-sales");

  store.updatePoolSettings(adminContext, { privateLimit: 100 });
  const claimed = store.claimRecord(salesContext, "contacts", "contact-public-claim");
  assert.equal(claimed.record.ownerId, "user-sales");
  assert.equal(store.getRecord(salesContext, "contacts", "contact-public-claim").ownerId, "user-sales");
  assert.throws(() => store.releaseRecord(salesContext, "contacts", "contact-admin-private"), /记录不存在|crm\.pool\.manage|not found/);

  const released = store.releaseRecord(salesContext, "contacts", "contact-public-claim");
  assert.equal(released.record.ownerId, undefined);
  const transferred = store.transferRecord(adminContext, "contacts", "contact-public-claim", "user-admin");
  assert.equal(transferred.record.ownerId, "user-admin");
  const actions = store.listAuditLogs(adminContext).map((log) => log.action);
  assert.ok(actions.includes("record.claimed"));
  assert.ok(actions.includes("record.released"));
  assert.ok(actions.includes("record.transferred"));
});

await run("public pool claim respects private pool limit", () => {
  const snapshot = structuredClone(seedData);
  snapshot.records.push({
    id: "contact-public-limit",
    workspaceId: defaultWorkspaceId,
    objectKey: "contacts",
    title: "Limit Contact",
    data: { email: "limit@example.com" },
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z"
  });
  const store = new CrmStore(snapshot);
  const adminContext = store.getContext("user-admin");
  const salesContext = store.getContext("user-sales");
  store.updatePoolSettings(adminContext, { privateLimit: 1 });
  assert.throws(() => store.claimRecord(salesContext, "contacts", "contact-public-limit"), /私海已达到上限|limit/i);
});

await run("public pool claim respects customer level private limits", () => {
  const snapshot = structuredClone(seedData);
  snapshot.records.push(
    {
      id: "company-a-limit",
      workspaceId: defaultWorkspaceId,
      objectKey: "companies",
      title: "A Limit Company",
      data: { customerLevel: "A" },
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z"
    },
    {
      id: "company-b-limit",
      workspaceId: defaultWorkspaceId,
      objectKey: "companies",
      title: "B Limit Company",
      data: { customerLevel: "B" },
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z"
    },
    {
      id: "contact-private-a-limit",
      workspaceId: defaultWorkspaceId,
      objectKey: "contacts",
      title: "Private A Contact",
      ownerId: "user-sales",
      data: { email: "private-a@example.com", companyId: "company-a-limit" },
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z"
    },
    {
      id: "contact-public-a-limit",
      workspaceId: defaultWorkspaceId,
      objectKey: "contacts",
      title: "Public A Contact",
      data: { email: "public-a@example.com", companyId: "company-a-limit" },
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z"
    },
    {
      id: "contact-public-b-limit",
      workspaceId: defaultWorkspaceId,
      objectKey: "contacts",
      title: "Public B Contact",
      data: { email: "public-b@example.com", companyId: "company-b-limit" },
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z"
    }
  );
  const store = new CrmStore(snapshot);
  const adminContext = store.getContext("user-admin");
  const salesContext = store.getContext("user-sales");

  store.updatePoolSettings(adminContext, {
    privateLimit: 100,
    levelRules: [
      { level: "A", enabled: true, privateLimit: 1, autoReclaimDays: 60 },
      { level: "B", enabled: true, privateLimit: 10, autoReclaimDays: 45 },
      { level: "C", enabled: true, privateLimit: 10, autoReclaimDays: 30 },
      { level: "D", enabled: true, privateLimit: 10, autoReclaimDays: 14 },
      { level: "unrated", enabled: true, privateLimit: 10, autoReclaimDays: 21 }
    ]
  });

  assert.throws(() => store.claimRecord(salesContext, "contacts", "contact-public-a-limit"), /customer level A|level/i);
  const claimed = store.claimRecord(salesContext, "contacts", "contact-public-b-limit");
  assert.equal(claimed.record.ownerId, "user-sales");
  assert.equal(claimed.record.data.companyId, "company-b-limit");
  assert.equal(claimed.record.data.customerLevel, undefined);
});

await run("public pool auto reclaim uses customer level reclaim days", () => {
  const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const snapshot = structuredClone(seedData);
  snapshot.records.push(
    {
      id: "company-a-reclaim",
      workspaceId: defaultWorkspaceId,
      objectKey: "companies",
      title: "A Reclaim Company",
      data: { customerLevel: "A" },
      createdAt: fortyDaysAgo,
      updatedAt: fortyDaysAgo
    },
    {
      id: "company-d-reclaim",
      workspaceId: defaultWorkspaceId,
      objectKey: "companies",
      title: "D Reclaim Company",
      data: { customerLevel: "D" },
      createdAt: fortyDaysAgo,
      updatedAt: fortyDaysAgo
    },
    {
      id: "contact-private-a-fresh-by-level",
      workspaceId: defaultWorkspaceId,
      objectKey: "contacts",
      title: "Private A Level Reclaim",
      ownerId: "user-sales",
      data: { email: "private-a-reclaim@example.com", companyId: "company-a-reclaim" },
      createdAt: fortyDaysAgo,
      updatedAt: fortyDaysAgo
    },
    {
      id: "contact-private-d-stale-by-level",
      workspaceId: defaultWorkspaceId,
      objectKey: "contacts",
      title: "Private D Level Reclaim",
      ownerId: "user-sales",
      data: { email: "private-d-reclaim@example.com", companyId: "company-d-reclaim" },
      createdAt: fortyDaysAgo,
      updatedAt: fortyDaysAgo
    }
  );
  const store = new CrmStore(snapshot);
  const adminContext = store.getContext("user-admin");

  store.updatePoolSettings(adminContext, {
    autoReclaimEnabled: true,
    autoReclaimDays: 30,
    levelRules: [
      { level: "A", enabled: true, privateLimit: 20, autoReclaimDays: 60 },
      { level: "B", enabled: true, privateLimit: 40, autoReclaimDays: 45 },
      { level: "C", enabled: true, privateLimit: 80, autoReclaimDays: 30 },
      { level: "D", enabled: true, privateLimit: 100, autoReclaimDays: 14 },
      { level: "unrated", enabled: true, privateLimit: 100, autoReclaimDays: 21 }
    ]
  });

  const result = store.runPoolAutoReclaim(adminContext);
  assert.equal(result.reclaimedRecordIds.includes("contact-private-a-fresh-by-level"), false);
  assert.equal(result.reclaimedRecordIds.includes("contact-private-d-stale-by-level"), true);
  assert.equal(store.getRecord(adminContext, "contacts", "contact-private-a-fresh-by-level").ownerId, "user-sales");
  assert.equal(store.getRecord(adminContext, "contacts", "contact-private-d-stale-by-level").ownerId, undefined);
});

await run("non-admin record writes keep owner scoped to the current user", () => {
  const store = new CrmStore();
  const salesContext = store.getContext("user-sales");
  const record = store.createRecord(salesContext, "contacts", {
    title: "Owner Scope",
    ownerId: "user-admin",
    data: { email: "owner-scope@example.com" }
  });

  assert.equal(record.ownerId, "user-sales");

  const updated = store.updateRecord(salesContext, "contacts", record.id, {
    ownerId: "user-admin",
    data: { phone: "13900000000" }
  });

  assert.equal(updated.ownerId, "user-sales");
});

await run("unique validation includes records hidden by RBAC", () => {
  const snapshot = structuredClone(seedData);
  snapshot.teams.push({ id: "team-enterprise", workspaceId: defaultWorkspaceId, name: "Enterprise" });
  snapshot.users.push({
    id: "user-other-unique",
    workspaceId: defaultWorkspaceId,
    email: "other-unique@example.com",
    name: "Other Unique Sales",
    roleId: "role-sales",
    teamId: "team-enterprise"
  });
  snapshot.records.push({
    id: "contact-hidden-unique",
    workspaceId: defaultWorkspaceId,
    objectKey: "contacts",
    title: "Hidden Unique Contact",
    ownerId: "user-other-unique",
    data: { email: "hidden-unique@example.com" },
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z"
  });

  const store = new CrmStore(snapshot);
  const salesContext = store.getContext("user-sales");

  assert.throws(
    () => store.createRecord(salesContext, "contacts", { title: "Duplicate Hidden", data: { email: "hidden-unique@example.com" } }),
    /unique|唯一/i
  );
});

await run("critical writes create admin-visible audit logs", () => {
  const store = new CrmStore();
  const adminContext = store.getContext("user-admin");
  const salesContext = store.getContext("user-sales");
  const before = store.listAuditLogs(adminContext).length;

  const record = store.createRecord(salesContext, "contacts", {
    title: "Audit Contact",
    data: { email: "audit-contact@example.com" }
  });
  store.updateActivity(adminContext, "act-2", { completedAt: "2026-06-18T08:30:00.000Z" });
  store.updateRecord(salesContext, "contacts", record.id, { data: { phone: "13800000001" } });

  const logs = store.listAuditLogs(adminContext);
  assert.equal(logs.length, before + 3);
  assert.equal(logs.some((log) => log.action === "create" && log.entityType === "record" && log.entityId === record.id), true);
  assert.equal(logs.some((log) => log.action === "update" && log.entityType === "activity" && log.entityId === "act-2"), true);
  assert.equal(logs.some((log) => log.action === "update" && log.entityType === "record" && log.objectKey === "contacts"), true);
});

await run("audit logs can be filtered by action entity object actor and query", () => {
  const store = new CrmStore();
  const adminContext = store.getContext("user-admin");
  const record = store.createRecord(adminContext, "contacts", {
    title: "Filtered Audit Contact",
    data: { email: "filtered-audit@example.com" }
  });

  assert.equal(store.listAuditLogs(adminContext, { action: "create" }).some((log) => log.entityId === record.id), true);
  assert.equal(store.listAuditLogs(adminContext, { entityType: "record" }).some((log) => log.entityId === record.id), true);
  assert.equal(store.listAuditLogs(adminContext, { objectKey: "contacts" }).some((log) => log.entityId === record.id), true);
  assert.equal(store.listAuditLogs(adminContext, { actorId: adminContext.user.id }).some((log) => log.entityId === record.id), true);
  assert.equal(store.listAuditLogs(adminContext, { q: "Filtered Audit" }).some((log) => log.entityId === record.id), true);
});

await run("audit logs can be exported as filtered csv", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const record = store.createRecord(context, "contacts", {
    title: "Exported Audit Contact",
    data: { email: "exported-audit@example.com" }
  });

  const csv = store.exportAuditLogsCsv(context, { action: "create", entityType: "record", objectKey: "contacts", q: "Exported Audit" });

  assert.match(csv, /^id,createdAt,action,entityType,entityId,objectKey,actorId,summary,details/m);
  assert.match(csv, new RegExp(record.id));
  assert.match(csv, /create,record/);
  assert.match(csv, /contacts/);
  assert.match(csv, /Exported Audit Contact/);
});

await run("audit logs require admin permission", () => {
  const store = new CrmStore();
  const salesContext = store.getContext("user-sales");

  assert.throws(() => store.listAuditLogs(salesContext), /crm\.admin/);
  assert.throws(() => store.exportAuditLogsCsv(salesContext), /crm\.admin/);
});

await run("csv import reports row-level errors", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const result = store.importCsv(context, "contacts", "title,email,gender\nWang Min,wang@example.com,female\nBad Gender,bad-gender@example.com,unknown");

  assert.equal(result.created.length, 1);
  assert.match(result.errors[0] ?? "", /Gender|性别|鎬у埆/);
});

await run("csv import writes a summary audit log", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");

  store.importCsv(context, "contacts", "title,email,gender\nAudit Import,audit-import@example.com,female\nBad Gender,bad-audit@example.com,unknown");
  const logs = store.listAuditLogs(context);

  const importLog = logs.find((log) => log.action === "import" && log.entityType === "csv_import" && log.objectKey === "contacts");
  assert.ok(importLog);
  assert.match(importLog.summary, /1 created, 0 updated, 1 failed/);
  assert.equal(importLog.details?.totalRows, 2);
  assert.equal(importLog.details?.updated, 0);
});

await run("csv import jobs track status counts and audit logs", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const job = store.createCsvImportJob(context, {
    objectKey: "contacts",
    csv: "title,email,gender\nJob Import,job-import@example.com,female\nBad Gender,bad-job@example.com,unknown",
    strategy: "skip-invalid"
  });

  assert.equal(job.status, "completed");
  assert.equal(job.totalRows, 2);
  assert.equal(job.createdCount, 1);
  assert.equal(job.errorCount, 1);
  assert.equal(job.preview?.errorRows, 1);
  assert.equal(store.listImportJobs(context, "contacts").some((candidate) => candidate.id === job.id), true);
  assert.equal(store.listAuditLogs(context, { entityType: "import_job" }).some((log) => log.entityId === job.id), true);
});

await run("csv import jobs can be queued before execution", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const queued = store.createQueuedCsvImportJob(context, {
    objectKey: "contacts",
    csv: "title,email\nQueued Import,queued-import@example.com",
    strategy: "skip-invalid"
  });

  assert.equal(queued.status, "queued");
  assert.equal(queued.createdCount, 0);
  const completed = store.runCsvImportJob(context, queued.id, {
    objectKey: "contacts",
    csv: "title,email\nQueued Import,queued-import@example.com",
    strategy: "skip-invalid"
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.createdCount, 1);
});

await run("csv import jobs can be cancelled while queued", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const queued = store.createQueuedCsvImportJob(context, {
    objectKey: "contacts",
    csv: "title,email\nCancel Import,cancel-import@example.com",
    strategy: "skip-invalid"
  });

  const cancelled = store.cancelCsvImportJob(context, queued.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.completedAt.length > 0, true);
  assert.equal(store.runCsvImportJob(context, queued.id, { objectKey: "contacts", csv: "title,email\nCancel Import,cancel-import@example.com" }).status, "cancelled");
  assert.equal(store.listAuditLogs(context, { entityType: "import_job" }).some((log) => log.entityId === queued.id && /Cancelled/.test(log.summary)), true);
});

await run("csv import jobs retry from the stored source payload", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const queued = store.createQueuedCsvImportJob(context, {
    objectKey: "contacts",
    csv: "title,email\nRetry Import,retry-import@example.com",
    strategy: "skip-invalid"
  });
  const failed = store.runCsvImportJob(context, queued.id, {
    objectKey: "missing-objects",
    csv: "title,email\nRetry Import,retry-import@example.com",
    strategy: "skip-invalid"
  });
  assert.equal(failed.status, "failed");

  const retry = store.createRetryCsvImportJob(context, failed.id);
  const completed = store.runCsvImportJob(context, retry.job.id, retry.payload);
  assert.equal(completed.status, "completed");
  assert.equal(completed.createdCount, 1);
  assert.equal(retry.payload.objectKey, "contacts");
});

await run("csv import jobs preserve update-existing strategy in copied payloads", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const completed = store.createCsvImportJob(context, {
    objectKey: "contacts",
    csv: "title,email,phone\nCopied Strategy Lin,lin@example.com,13912345678",
    strategy: "update-existing"
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.result?.updated.length, 1);

  const rerun = store.createRerunCsvImportJob(context, completed.id);
  assert.equal(rerun.payload.strategy, "update-existing");
});

await run("csv import jobs preserve explicit header mappings", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const completed = store.createCsvImportJob(context, {
    objectKey: "contacts",
    csv: "Name,Email\nMapped Customer,job-mapped@example.com",
    strategy: "skip-invalid",
    mapping: { Name: "title", Email: "email" }
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.createdCount, 1);
  assert.equal(completed.result?.created[0]?.data.email, "job-mapped@example.com");
  assert.deepEqual(completed.sourcePayload?.mapping, { Name: "title", Email: "email" });
  assert.deepEqual(store.listImportJobs(context, "contacts").find((job) => job.id === completed.id)?.sourcePayload?.mapping, { Name: "title", Email: "email" });

  const rerun = store.createRerunCsvImportJob(context, completed.id);
  assert.deepEqual(rerun.payload.mapping, { Name: "title", Email: "email" });
});

await run("csv import jobs preserve preset context and observability summary", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const job = store.createCsvImportJob(context, {
    objectKey: "contacts",
    csv: "Name,Email,Extra\nPreset Import,preset-observe@example.com,ignored\nDuplicate Lin,lin@example.com,ignored",
    strategy: "skip-invalid",
    mapping: { Name: "title", Email: "email" },
    presetId: "preset-contacts-standard",
    presetName: "Contacts standard"
  });

  const details = buildImportJobObservability(job);
  assert.equal(job.sourcePayload?.presetName, "Contacts standard");
  assert.equal(details.presetName, "Contacts standard");
  assert.deepEqual(details.headers, ["Name", "Email", "Extra"]);
  assert.deepEqual(details.mappingEntries, [
    { header: "Name", target: "title" },
    { header: "Email", target: "email" }
  ]);
  assert.deepEqual(details.unmappedHeaders, ["Extra"]);
  assert.deepEqual(details.issueBuckets, [{ label: "conflict", count: 1 }]);
  assert.equal(details.createdSamples.length, 1);
  assert.equal(details.conflictSamples.length, 1);

  const rerun = store.createRerunCsvImportJob(context, job.id);
  assert.equal(rerun.payload.presetName, "Contacts standard");
});

await run("csv import jobs export issue rows as csv", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const job = store.createCsvImportJob(context, {
    objectKey: "contacts",
    csv: "title,email,gender\nBad Gender,bad-issues@example.com,unknown\nDuplicate Lin,lin@example.com,male\nFresh,fresh-issues@example.com,female",
    strategy: "skip-invalid"
  });

  const csv = store.exportImportJobIssuesCsv(context, job.id);
  assert.match(csv, /^rowNumber,status,issues,title,email,gender/m);
  assert.match(csv, /Bad Gender/);
  assert.match(csv, /Duplicate Lin/);
  assert.match(csv, /conflicts with/);
  assert.doesNotMatch(csv, /fresh-issues@example\.com/);

  const preview = store.previewCsvImport(context, "contacts", csv);
  assert.equal(preview.unmappedHeaders.length, 0);
  assert.equal(preview.mappedFields.some((field) => field.key === "email"), true);
});

await run("csv import issue export reuses explicit mappings as field headers", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const job = store.createCsvImportJob(context, {
    objectKey: "contacts",
    csv: "Name,Email,Phone\nDuplicate Lin,lin@example.com,13900000004",
    mapping: { Name: "title", Email: "email", Phone: "phone" }
  });

  const csv = store.exportImportJobIssuesCsv(context, job.id);
  assert.match(csv, /^rowNumber,status,issues,title,email,phone/m);
  assert.doesNotMatch(csv, /Name,Email,Phone/);
  assert.match(csv, /lin@example\.com/);

  const preview = store.previewCsvImport(context, "contacts", csv);
  assert.equal(preview.unmappedHeaders.length, 0);
  assert.equal(preview.rows[0]?.values.email, "lin@example.com");
});

await run("csv import jobs can rerun a completed source payload", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const completed = store.createCsvImportJob(context, {
    objectKey: "deals",
    csv: "title,amount\nRerun Deal,9000",
    strategy: "skip-invalid"
  });
  assert.equal(completed.status, "completed");

  const rerun = store.createRerunCsvImportJob(context, completed.id);
  const rerunCompleted = store.runCsvImportJob(context, rerun.job.id, rerun.payload);
  assert.equal(rerunCompleted.status, "completed");
  assert.equal(rerunCompleted.createdCount, 1);
});

await run("import job queue summary reports status counts and worker failures", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const completed = store.createCsvImportJob(context, {
    objectKey: "contacts",
    csv: "title,email\nSummary Completed,summary-completed@example.com",
    strategy: "skip-invalid"
  });
  const queued = store.createQueuedCsvImportJob(context, {
    objectKey: "contacts",
    csv: "title,email\nSummary Queued,summary-queued@example.com",
    strategy: "skip-invalid"
  });
  const cancelled = store.createQueuedCsvImportJob(context, {
    objectKey: "contacts",
    csv: "title,email\nSummary Cancelled,summary-cancelled@example.com",
    strategy: "skip-invalid"
  });
  store.cancelCsvImportJob(context, cancelled.id);
  store.markCsvImportJobFailedFromWorker(context.workspaceId, queued.id, "contacts", "worker crashed");

  const summary = store.getImportJobQueueSummary(context);
  assert.equal(summary.total, 3);
  assert.equal(summary.completed, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.cancelled, 1);
  assert.equal(summary.deadLettered, 1);
  assert.equal(summary.recentJobs.length, 3);
  assert.equal(summary.recentFailures[0].id, queued.id);
  assert.equal(summary.recentJobs.some((job) => job.id === completed.id), true);
});

await run("import job queue summary requires admin permission", () => {
  const store = new CrmStore();
  const salesContext = store.getContext("user-sales");
  assert.throws(() => store.getImportJobQueueSummary(salesContext), /crm\.admin/);
});

await run("inline background executor runs csv import jobs immediately", async () => {
  const calls = [];
  const repository = {
    async runCsvImportJob(context, jobId, payload) {
      calls.push({ context, jobId, payload });
      return { id: jobId, status: "completed" };
    }
  };
  const executor = new InlineBackgroundJobExecutor(repository);
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const result = await executor.runCsvImportJob(context, "job-inline", { objectKey: "contacts", csv: "title,email\nInline,inline@example.com" });

  assert.equal(result.id, "job-inline");
  assert.equal(result.status, "completed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.objectKey, "contacts");
});

await run("inline background executor dispatches webhook events through the repository", async () => {
  const calls = [];
  const repository = {
    async deliverWebhookEvent(context, event, data) {
      calls.push({ context, event, data });
      return [
        {
          id: "delivery-inline",
          workspaceId: context.workspaceId,
          webhookId: "webhook-inline",
          event,
          status: "success",
          attempts: 1,
          requestBody: { data },
          createdAt: new Date().toISOString()
        }
      ];
    }
  };
  const executor = new InlineBackgroundJobExecutor(repository);
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const result = await executor.runWebhookEvent(context, { event: "record.created", data: { recordId: "record-inline" } });

  assert.equal(result.queued, false);
  assert.equal(result.deliveries.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].event, "record.created");
  assert.equal(calls[0].data.recordId, "record-inline");
});

await run("inline background executor rejects email sync without connection config", async () => {
  const calls = [];
  const account = {
    id: "email-account-inline",
    workspaceId: defaultWorkspaceId,
    name: "Inline mailbox",
    emailAddress: "inline@example.com",
    provider: "smtp_imap",
    status: "active",
    syncEnabled: true,
    sendEnabled: true,
    connectionConfigured: false,
    createdById: "user-admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const repository = {
    async getEmailAccount(context, accountId) {
      calls.push({ method: "getEmailAccount", context, accountId });
      return account;
    },
    async getEmailAccountConnectionConfig() {
      return undefined;
    },
    async markEmailAccountConnectionError(context, accountId, errorMessage) {
      calls.push({ method: "markEmailAccountConnectionError", context, accountId, errorMessage });
      return { ...account, status: "error", lastConnectionError: errorMessage };
    },
    async syncEmailAccount(context, accountId) {
      calls.push({ method: "syncEmailAccount", context, accountId });
      return { account, importedCount: 0, status: "synced" };
    }
  };
  const executor = new InlineBackgroundJobExecutor(repository);
  const store = new CrmStore();
  const context = store.getContext("user-admin");

  await assert.rejects(
    () => executor.runEmailSyncJob(context, { accountId: account.id }),
    /connection is not configured/
  );
  assert.equal(calls.some((call) => call.method === "markEmailAccountConnectionError" && call.errorMessage === "Email account connection is not configured"), true);
  assert.equal(calls.some((call) => call.method === "syncEmailAccount"), false);
});

await run("email sync requires admin before reading provider connection config", async () => {
  const store = new CrmStore();
  const salesContext = store.getContext("user-sales");
  const calls = [];
  const repository = {
    async getEmailAccount() {
      calls.push("getEmailAccount");
      throw new Error("getEmailAccount should not be called");
    },
    async getEmailAccountConnectionConfig() {
      calls.push("getEmailAccountConnectionConfig");
      throw new Error("connection config should not be read");
    },
    async syncEmailAccount() {
      calls.push("syncEmailAccount");
      throw new Error("sync should not run");
    }
  };

  await assert.rejects(
    () => createEmailProviderAdapter(repository).sync(salesContext, "email-account-secret"),
    /crm\.admin/
  );
  assert.deepEqual(calls, []);
});

await run("redis job envelopes preserve workspace user and payload", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const envelope = buildCsvImportJobEnvelope(context, "job-queued", {
    objectKey: "contacts",
    csv: "title,email\nQueued,queued@example.com",
    strategy: "skip-invalid"
  });

  assert.equal(envelope.type, "csv_import");
  assert.equal(envelope.workspaceId, context.workspaceId);
  assert.equal(envelope.userId, context.user.id);
  assert.equal(envelope.jobId, "job-queued");
  assert.equal(envelope.payload.strategy, "skip-invalid");
  assert.match(envelope.enqueuedAt, /^\d{4}-\d{2}-\d{2}T/);
});

await run("email sync job envelopes preserve workspace user and account payload", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const envelope = buildEmailSyncJobEnvelope(context, { accountId: "email-account-queued", limit: 25 });

  assert.equal(envelope.type, "email_sync");
  assert.equal(envelope.workspaceId, context.workspaceId);
  assert.equal(envelope.userId, context.user.id);
  assert.equal(envelope.payload.accountId, "email-account-queued");
  assert.equal(envelope.payload.limit, 25);
  assert.equal(envelope.attempts, 0);
  assert.match(envelope.enqueuedAt, /^\d{4}-\d{2}-\d{2}T/);
});

await run("email send job envelopes preserve workspace user and message payload", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const envelope = buildEmailSendJobEnvelope(context, { messageId: "email-message-queued" });

  assert.equal(envelope.type, "email_send");
  assert.equal(envelope.workspaceId, context.workspaceId);
  assert.equal(envelope.userId, context.user.id);
  assert.equal(envelope.payload.messageId, "email-message-queued");
  assert.equal(envelope.attempts, 0);
  assert.match(envelope.enqueuedAt, /^\d{4}-\d{2}-\d{2}T/);
});

await run("email translate job envelopes preserve workspace user and message payload", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const envelope = buildEmailTranslateJobEnvelope(context, { messageId: "email-message-translate", targetLocale: "en-US" });

  assert.equal(envelope.type, "email_translate");
  assert.equal(envelope.workspaceId, context.workspaceId);
  assert.equal(envelope.userId, context.user.id);
  assert.equal(envelope.payload.messageId, "email-message-translate");
  assert.equal(envelope.payload.targetLocale, "en-US");
  assert.equal(envelope.attempts, 0);
});

await run("email classify job envelopes preserve workspace user and message payload", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const envelope = buildEmailClassifyJobEnvelope(context, { messageId: "email-message-classify" });

  assert.equal(envelope.type, "email_classify");
  assert.equal(envelope.workspaceId, context.workspaceId);
  assert.equal(envelope.userId, context.user.id);
  assert.equal(envelope.payload.messageId, "email-message-classify");
  assert.equal(envelope.attempts, 0);
});

await run("email classification parser accepts only supported categories", () => {
  assert.equal(parseEmailThreadCategory("promotions"), "promotions");
  assert.equal(parseEmailThreadCategory('{"text":"updates"}'), "updates");
  assert.equal(parseEmailThreadCategory("Category: social because this is a LinkedIn notification."), "social");
  assert.equal(parseEmailThreadCategory("sales_lead"), undefined);
});

await run("email analyze job envelopes preserve workspace user and thread payload", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const envelope = buildEmailAnalyzeJobEnvelope(context, { threadId: "email-thread-analyze", sourceMessageId: "email-message-analyze" });

  assert.equal(envelope.type, "email_analyze");
  assert.equal(envelope.workspaceId, context.workspaceId);
  assert.equal(envelope.userId, context.user.id);
  assert.equal(envelope.payload.threadId, "email-thread-analyze");
  assert.equal(envelope.payload.sourceMessageId, "email-message-analyze");
  assert.equal(envelope.attempts, 0);
});

await run("email summarize job envelopes preserve workspace user and thread payload", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const envelope = buildEmailSummarizeJobEnvelope(context, { threadId: "email-thread-summarize" });

  assert.equal(envelope.type, "email_summarize");
  assert.equal(envelope.workspaceId, context.workspaceId);
  assert.equal(envelope.userId, context.user.id);
  assert.equal(envelope.payload.threadId, "email-thread-summarize");
  assert.equal(envelope.attempts, 0);
});

await run("redis email executor checks permissions before enqueueing jobs", async () => {
  const executor = new RedisBackgroundJobExecutor({});
  const noAdminContext = {
    workspaceId: defaultWorkspaceId,
    user: { ...seedData.users[1], id: "user-no-admin" },
    role: { ...seedData.roles[1], permissions: ["crm.read", "crm.write", "ai.use"] }
  };
  const readOnlyContext = {
    workspaceId: defaultWorkspaceId,
    user: { ...seedData.users[1], id: "user-read-only" },
    role: { ...seedData.roles[1], permissions: ["crm.read", "ai.use"] }
  };
  const noAiContext = {
    workspaceId: defaultWorkspaceId,
    user: { ...seedData.users[1], id: "user-no-ai" },
    role: { ...seedData.roles[1], permissions: ["crm.read", "crm.write"] }
  };

  await assert.rejects(() => executor.runEmailSyncJob(noAdminContext, { accountId: "account-queued" }), /crm\.admin/);
  await assert.rejects(() => executor.runEmailSendJob(readOnlyContext, { messageId: "message-queued" }), /crm\.write/);
  await assert.rejects(() => executor.runEmailClassifyJob(noAiContext, { messageId: "message-classify" }), /ai\.use/);
  await assert.rejects(() => executor.runEmailTranslateJob(noAiContext, { messageId: "message-translate" }), /ai\.use/);
  await assert.rejects(() => executor.runEmailAnalyzeJob(noAiContext, { threadId: "thread-analyze" }), /ai\.use/);
  await assert.rejects(() => executor.runEmailSummarizeJob(noAiContext, { threadId: "thread-summarize" }), /ai\.use/);
});

await run("inline background executor fails unsupported custom email provider without silent delivery", async () => {
  const context = { workspaceId: defaultWorkspaceId, user: seedData.users[0], role: seedData.roles[0] };
  const account = {
    id: "legacy-custom-account",
    workspaceId: defaultWorkspaceId,
    name: "Legacy Custom",
    emailAddress: "legacy-custom@example.com",
    provider: "custom",
    status: "active",
    sendEnabled: true,
    syncEnabled: true,
    connectionConfigured: false,
    createdById: "user-admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const queued = {
    id: "legacy-custom-message",
    workspaceId: defaultWorkspaceId,
    threadId: "legacy-custom-thread",
    accountId: account.id,
    direction: "outbound",
    status: "queued",
    from: account.emailAddress,
    to: ["buyer@example.com"],
    subject: "Queued proposal",
    bodyText: "Proposal attached.",
    createdAt: new Date().toISOString()
  };
  let failedStatus;
  const repository = {
    async getEmailMessage() {
      return queued;
    },
    async getEmailAccount() {
      return account;
    },
    async updateEmailMessageStatus(_context, messageId, status, patch) {
      failedStatus = { messageId, status, patch };
      return { ...queued, status, failureReason: patch?.failureReason };
    }
  };
  const adapter = createEmailProviderAdapter(repository);

  await assert.rejects(
    () => adapter.sendQueued(context, queued.id),
    /does not support send/
  );
  assert.equal(failedStatus.status, "failed");
  assert.match(failedStatus.patch.failureReason, /does not support send/);
});

await run("email provider dry-run delivery marks supported queued messages sent without mailbox credentials", async () => {
  const previousMode = process.env.EMAIL_DELIVERY_MODE;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.EMAIL_DELIVERY_MODE = "dry-run";
  process.env.NODE_ENV = "test";
  try {
    const context = { workspaceId: defaultWorkspaceId, user: seedData.users[0], role: seedData.roles[0] };
    const account = {
      id: "dry-run-smtp-account",
      workspaceId: defaultWorkspaceId,
      name: "Dry Run SMTP",
      emailAddress: "dry-run@example.com",
      provider: "smtp_imap",
      status: "active",
      sendEnabled: true,
      syncEnabled: false,
      connectionConfigured: false,
      createdById: "user-admin",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const queued = {
      id: "dry-run-message",
      workspaceId: defaultWorkspaceId,
      threadId: "dry-run-thread",
      accountId: account.id,
      direction: "outbound",
      status: "queued",
      from: account.emailAddress,
      to: ["buyer@example.com"],
      subject: "Dry run proposal",
      bodyText: "Proposal content.",
      createdAt: new Date().toISOString()
    };
    let connectionConfigRead = false;
    const repository = {
      async getEmailMessage() {
        return queued;
      },
      async getEmailAccount() {
        return account;
      },
      async listEmailMessages() {
        return [queued];
      },
      async getEmailAccountConnectionConfig() {
        connectionConfigRead = true;
        return undefined;
      },
      async updateEmailMessageStatus(_context, messageId, status, patch) {
        return { ...queued, id: messageId, status, externalMessageId: patch?.externalMessageId };
      }
    };

    const result = await createEmailProviderAdapter(repository).sendQueued(context, queued.id);
    assert.equal(result.status, "sent");
    assert.equal(result.externalMessageId, "dry-run-dry-run-message");
    assert.equal(connectionConfigRead, false);
  } finally {
    if (previousMode === undefined) {
      delete process.env.EMAIL_DELIVERY_MODE;
    } else {
      process.env.EMAIL_DELIVERY_MODE = previousMode;
    }
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});

await run("email provider does not deliver when another worker already claimed the queued send", async () => {
  const context = { workspaceId: defaultWorkspaceId, user: seedData.users[0], role: seedData.roles[0] };
  const account = {
    id: "claimed-send-account",
    workspaceId: defaultWorkspaceId,
    name: "Claimed Send",
    emailAddress: "claimed-send@example.com",
    provider: "smtp_imap",
    status: "active",
    sendEnabled: true,
    syncEnabled: false,
    connectionConfigured: false,
    createdById: "user-admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const queued = {
    id: "claimed-send-message",
    workspaceId: defaultWorkspaceId,
    threadId: "claimed-send-thread",
    accountId: account.id,
    direction: "outbound",
    status: "queued",
    from: account.emailAddress,
    to: ["buyer@example.com"],
    subject: "Already claimed",
    bodyText: "Another worker is sending this.",
    createdAt: new Date().toISOString()
  };
  let statusUpdateCount = 0;
  const repository = {
    async getEmailMessage() {
      return queued;
    },
    async getEmailAccount() {
      return account;
    },
    async claimEmailMessageForSending() {
      return { message: { ...queued, status: "sending" }, claimed: false };
    },
    async updateEmailMessageStatus() {
      statusUpdateCount += 1;
      throw new Error("Already claimed messages should not be delivered or updated");
    }
  };

  const result = await createEmailProviderAdapter(repository).sendQueued(context, queued.id);

  assert.equal(result.status, "sending");
  assert.equal(statusUpdateCount, 0);
});

await run("email provider reclaims stale sending messages through the queued send path", async () => {
  const previousMode = process.env.EMAIL_DELIVERY_MODE;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousTimeout = process.env.EMAIL_SEND_CLAIM_TIMEOUT_MS;
  process.env.EMAIL_DELIVERY_MODE = "dry-run";
  process.env.NODE_ENV = "test";
  process.env.EMAIL_SEND_CLAIM_TIMEOUT_MS = "60000";
  try {
    const store = new CrmStore();
    const context = store.getContext("user-admin");
    const account = store.createEmailAccount(context, {
      name: "Stale Send Inbox",
      emailAddress: "stale-send@example.com",
      provider: "smtp_imap",
      syncEnabled: false,
      sendEnabled: true,
      status: "active"
    });
    const stale = store.recordEmailMessage(context, {
      accountId: account.id,
      direction: "outbound",
      from: account.emailAddress,
      to: ["buyer@example.com"],
      subject: "Recover stale send",
      bodyText: "This message should be reclaimed.",
      status: "sending",
      sendAttemptedAt: new Date(Date.now() - 120000).toISOString()
    });

    const sent = await createEmailProviderAdapter(store).sendQueued(context, stale.id);

    assert.equal(sent.status, "sent");
    assert.equal(sent.externalMessageId, `dry-run-${stale.id}`);
  } finally {
    if (previousMode === undefined) {
      delete process.env.EMAIL_DELIVERY_MODE;
    } else {
      process.env.EMAIL_DELIVERY_MODE = previousMode;
    }
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousTimeout === undefined) {
      delete process.env.EMAIL_SEND_CLAIM_TIMEOUT_MS;
    } else {
      process.env.EMAIL_SEND_CLAIM_TIMEOUT_MS = previousTimeout;
    }
  }
});

await run("email crm smoke flow links customer context ai draft attachments and dry-run send", async () => {
  const previousMode = process.env.EMAIL_DELIVERY_MODE;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.EMAIL_DELIVERY_MODE = "dry-run";
  process.env.NODE_ENV = "test";
  try {
    const store = new CrmStore();
    const context = store.getContext("user-admin");
    const account = store.createEmailAccount(context, {
      name: "Smoke Sales Inbox",
      emailAddress: "smoke-sales@example.com",
      provider: "smtp_imap",
      status: "active",
      sendEnabled: true,
      syncEnabled: true
    });
    store.updateEmailAiSettings(context, {
      features: {
        draft: true,
        translate: true,
        auto_translate: false,
        context_analysis: true,
        auto_context_analysis: false,
        auto_summarize: true
      },
      requireSourceLinks: true,
      maxHistoryMessages: 4,
      maxKnowledgeArticles: 2,
      maxContextChars: 4000
    });
    const knowledge = store.createKnowledgeArticle(context, {
      title: "私有化部署上线包",
      body: "私有化部署默认包含 Docker Compose、管理员培训和上线前健康检查。",
      tags: ["deployment", "training"],
      active: true
    });
    const inbound = store.recordEmailMessage(context, {
      accountId: account.id,
      direction: "inbound",
      from: "lin@example.com",
      to: ["smoke-sales@example.com"],
      subject: "确认部署计划",
      bodyText: "请确认私有化部署计划和上线培训。",
      recordId: "contact-lin",
      externalMessageId: "smoke-inbound-message-id",
      receivedAt: "2026-06-20T08:30:00.000Z"
    });

    const assistantContext = store.buildEmailAssistantContext(context, {
      purpose: "draft",
      threadId: inbound.threadId,
      sourceMessageId: inbound.id
    });
    const aiResult = await generateEmailAiOutput({ context: assistantContext, userPrompt: "回复客户并确认下一步" });
    store.recordEmailAiGeneration(context, {
      purpose: "draft",
      enabled: aiResult.enabled,
      recordId: assistantContext.recordId,
      threadId: assistantContext.threadId,
      sourceMessageId: assistantContext.sourceMessageId,
      sourceCount: aiResult.sources.length,
      sourceLabels: aiResult.sources.map((source) => source.label),
      userPromptLength: "回复客户并确认下一步".length,
      resultTextLength: aiResult.text.length,
      contextCharCount: aiResult.budget.contextCharCount,
      maxContextChars: aiResult.budget.maxContextChars,
      modelPromptChars: aiResult.budget.modelPromptChars,
      contextTruncated: aiResult.budget.truncated,
      suggestedSubjectProvided: Boolean(aiResult.suggestedSubject)
    });
    const queued = store.queueEmailMessage(context, {
      accountId: account.id,
      threadId: inbound.threadId,
      recordId: "contact-lin",
      to: ["lin@example.com"],
      subject: aiResult.suggestedSubject ?? "Re: 确认部署计划",
      bodyText: aiResult.text,
      attachments: [
        {
          fileName: "deployment-plan.txt",
          contentType: "text/plain",
          size: 19,
          contentBase64: Buffer.from("deployment checklist").toString("base64")
        }
      ],
      aiAssisted: true,
      aiPurpose: "draft",
      aiSourceMessageId: inbound.id,
      aiSources: aiResult.sources,
      aiGeneratedAt: "2026-06-20T08:35:00.000Z"
    });
    const repository = {
      async getEmailMessage(requestContext, messageId) {
        return store.getEmailMessage(requestContext, messageId);
      },
      async getEmailAccount(requestContext, accountId) {
        return store.getEmailAccount(requestContext, accountId);
      },
      async listEmailMessages(requestContext, threadId) {
        return store.listEmailMessages(requestContext, threadId);
      },
      async updateEmailMessageStatus(requestContext, messageId, status, patch) {
        return store.updateEmailMessageStatus(requestContext, messageId, status, patch);
      }
    };
    const sent = await createEmailProviderAdapter(repository).sendQueued(context, queued.id);
    const threadMessages = store.listEmailMessages(context, inbound.threadId);
    const audit = store.listAuditLogs(context, { entityType: "email_ai_generation" }).at(-1);

    assert.equal(assistantContext.enabled, true);
    assert.equal(assistantContext.recordId, "contact-lin");
    assert.match(assistantContext.communicationSummary, /确认部署计划/);
    assert.match(assistantContext.knowledgeBrief, /Docker Compose/);
    assert.equal(aiResult.sources.some((source) => source.messageId === inbound.id), true);
    assert.equal(aiResult.sources.some((source) => source.recordId === "contact-lin"), true);
    assert.equal(aiResult.sources.some((source) => source.knowledgeArticleId === knowledge.id), true);
    assert.equal(sent.status, "sent");
    assert.equal(sent.externalMessageId, `dry-run-${queued.id}`);
    assert.equal(sent.attachments?.[0]?.fileName, "deployment-plan.txt");
    assert.equal(buildEmailAttachmentHref(sent.id, 0, sent.attachments?.[0] ?? {}), `/api/email/messages/${sent.id}/attachments/0`);
    assert.equal(threadMessages.some((message) => message.id === inbound.id), true);
    assert.equal(threadMessages.some((message) => message.id === sent.id && message.aiAssisted), true);
    assert.equal(audit?.details.resultTextLength, aiResult.text.length);
    assert.equal("text" in audit.details, false);
    assert.equal("userPrompt" in audit.details, false);
  } finally {
    if (previousMode === undefined) {
      delete process.env.EMAIL_DELIVERY_MODE;
    } else {
      process.env.EMAIL_DELIVERY_MODE = previousMode;
    }
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});

await run("email provider normalizes unsupported custom send and sync toggles", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Custom connector slot",
    emailAddress: "custom-slot@example.com",
    provider: "custom",
    status: "active",
    sendEnabled: true,
    syncEnabled: true
  });

  assert.equal(account.sendEnabled, false);
  assert.equal(account.syncEnabled, false);
  assert.throws(
    () =>
      store.queueEmailMessage(context, {
        accountId: account.id,
        to: ["buyer@example.com"],
        subject: "Unsupported custom send",
        bodyText: "This should not queue."
      }),
    /not enabled/
  );
});

await run("inline background executor audits local translation fallback without persisting it", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { features: { translate: true, auto_translate: true, context_analysis: true, auto_summarize: true }, defaultLocale: "en-US" });
  const account = store.createEmailAccount(context, {
    name: "Translate mailbox",
    emailAddress: "translate@example.com",
    provider: "custom",
    status: "active",
    sendEnabled: true,
    syncEnabled: true
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "buyer@example.com",
    to: ["translate@example.com"],
    subject: "Translate me",
    bodyText: "Please confirm the implementation plan.",
    recordId: "contact-lin"
  });
  const result = await new InlineBackgroundJobExecutor(store).runEmailTranslateJob(context, { messageId: message.id, targetLocale: "en-US" });

  assert.equal(result.id, message.id);
  assert.equal(result.translatedLocale, undefined);
  assert.equal(result.translatedBodyText, undefined);
  assert.equal(result.translatedSources, undefined);
  assert.equal(result.translatedAt, undefined);
  const audit = store.listAuditLogs(context, { entityType: "email_ai_generation" }).find((log) => log.details.purpose === "translate" && log.entityId === message.threadId);
  assert.equal(audit?.details.purpose, "translate");
  assert.equal(audit?.details.enabled, true);
  assert.equal(audit?.details.sourceMessageId, message.id);
  assert.equal(audit?.details.targetLocale, "en-US");
  assert.equal(audit?.details.sourceCount > 0, true);
  assert.equal(audit?.details.sourceLabels?.some((label) => /Translate me/.test(label)), true);
  assert.equal(audit?.details.sourceTextLength, message.bodyText.length);
  assert.equal(audit?.details.generationMode, "local");
  assert.equal(audit?.details.persisted, false);
  assert.equal("text" in audit.details, false);

  const auditCountBeforeCachedCall = store.listAuditLogs(context, { entityType: "email_ai_generation" }).filter((log) => log.details.purpose === "translate" && log.details.sourceMessageId === message.id).length;
  const cached = await new InlineBackgroundJobExecutor(store).runEmailTranslateJob(context, { messageId: message.id, targetLocale: "en-US" });
  const auditCountAfterCachedCall = store.listAuditLogs(context, { entityType: "email_ai_generation" }).filter((log) => log.details.purpose === "translate" && log.details.sourceMessageId === message.id).length;
  assert.equal(cached.translatedBodyText, undefined);
  assert.equal(cached.translatedAt, undefined);
  assert.equal(auditCountAfterCachedCall, auditCountBeforeCachedCall + 1);
});

await run("inline background executor persists provider translation results", async () => {
  const previousApiKey = process.env.AI_API_KEY;
  const previousProvider = process.env.AI_PROVIDER;
  const previousFetch = globalThis.fetch;
  process.env.AI_API_KEY = "test-email-translation-key";
  process.env.AI_PROVIDER = "openai-compatible";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ text: "Provider translated email body." })
            }
          }
        ]
      }),
      { status: 200 }
    );
  try {
    const store = new CrmStore();
    const context = store.getContext("user-admin");
    store.updateEmailAiSettings(context, { features: { translate: true, auto_translate: true, context_analysis: true, auto_summarize: true }, defaultLocale: "en-US" });
    const account = store.createEmailAccount(context, {
      name: "Provider Translate mailbox",
      emailAddress: "provider-translate@example.com",
      provider: "custom",
      status: "active",
      sendEnabled: true,
      syncEnabled: true
    });
    const message = store.recordEmailMessage(context, {
      accountId: account.id,
      direction: "inbound",
      from: "buyer@example.com",
      to: [account.emailAddress],
      subject: "Translate with provider",
      bodyText: "请翻译这一封邮件。",
      recordId: "contact-lin"
    });

    const result = await new InlineBackgroundJobExecutor(store).runEmailTranslateJob(context, { messageId: message.id, targetLocale: "en-US" });
    const audit = store.listAuditLogs(context, { entityType: "email_ai_generation" }).find((log) => log.details.purpose === "translate" && log.details.sourceMessageId === message.id);

    assert.equal(result.translatedLocale, "en-US");
    assert.equal(result.translatedBodyText, "Provider translated email body.");
    assert.equal(result.translatedSources?.some((source) => source.messageId === message.id), true);
    assert.equal(audit?.details.generationMode, "provider");
    assert.equal(audit?.details.persisted, true);
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.AI_API_KEY;
    } else {
      process.env.AI_API_KEY = previousApiKey;
    }
    if (previousProvider === undefined) {
      delete process.env.AI_PROVIDER;
    } else {
      process.env.AI_PROVIDER = previousProvider;
    }
    globalThis.fetch = previousFetch;
  }
});

await run("email translation records skipped audit when feature is disabled", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, {
    features: { draft: false, translate: false, auto_translate: false, context_analysis: false, auto_summarize: false },
    defaultLocale: "en-US"
  });
  const account = store.createEmailAccount(context, {
    name: "Disabled translate mailbox",
    emailAddress: "disabled-translate@example.com",
    provider: "custom",
    status: "active"
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "buyer@example.com",
    to: [account.emailAddress],
    subject: "Do not translate",
    bodyText: "Translation is disabled for this workspace.",
    recordId: "contact-lin"
  });
  const result = await new InlineBackgroundJobExecutor(store).runEmailTranslateJob(context, { messageId: message.id, targetLocale: "en-US" });
  const audit = store.listAuditLogs(context, { entityType: "email_ai_generation" }).find((log) => log.details.purpose === "translate" && log.details.sourceMessageId === message.id);

  assert.equal(result.translatedBodyText, undefined);
  assert.equal(result.translatedLocale, undefined);
  assert.equal(result.translatedSources, undefined);
  assert.ok(audit);
  assert.equal(audit?.details.enabled, false);
  assert.equal(audit?.details.recordId, "contact-lin");
  assert.equal(audit?.details.threadId, message.threadId);
  assert.equal(audit?.details.targetLocale, "en-US");
  assert.equal(audit?.details.resultTextLength > 0, true);
  assert.equal("text" in audit.details, false);
});

await run("store record email triggers enabled translate summarize and analyze automations", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, {
    features: { draft: true, translate: true, auto_translate: true, context_analysis: true, auto_context_analysis: true, auto_summarize: true },
    defaultLocale: "en-US",
    maxHistoryMessages: 1
  });
  const account = store.createEmailAccount(context, {
    name: "Auto AI mailbox",
    emailAddress: "auto-ai@example.com",
    provider: "custom",
    status: "active",
    sendEnabled: true
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    status: "received",
    from: "buyer@example.com",
    to: [account.emailAddress],
    subject: "Auto translate summarize and analyze",
    bodyText: "Please translate, summarize, and analyze this message."
  });
  await flushAsyncWork();

  const translated = store.getEmailMessage(context, message.id);
  const thread = store.listEmailThreads(context).find((candidate) => candidate.id === message.threadId);
  const aiAudits = store.listAuditLogs(context, { entityType: "email_ai_generation" });

  assert.equal(translated.translatedLocale, undefined);
  assert.equal(translated.translatedBodyText, undefined);
  assert.equal(translated.translatedSources, undefined);
  assert.match(thread?.summary ?? "", /紧凑线程记忆/);
  assert.match(thread?.aiAnalysis ?? "", /AI 线程分析/);
  assert.match(thread?.aiAnalysis ?? "", /建议下一步/);
  assert.equal(thread?.aiAnalysisSources?.some((source) => source.messageId === message.id), true);
  assert.equal(aiAudits.some((log) => log.details.purpose === "classification" && log.details.sourceMessageId === message.id && log.details.persisted === false), true);
  assert.equal(aiAudits.some((log) => log.details.purpose === "translate" && log.details.sourceMessageId === message.id && log.details.persisted === false), true);
  assert.equal(aiAudits.some((log) => log.details.purpose === "summarize" && log.details.threadId === message.threadId), true);
  assert.equal(aiAudits.some((log) => log.details.purpose === "context_analysis" && log.details.threadId === message.threadId), true);
});

await run("inline background executor refreshes email thread summaries through ai", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { features: { draft: true, translate: true, context_analysis: true, auto_summarize: true } });
  const account = store.createEmailAccount(context, {
    name: "Summary mailbox",
    emailAddress: "summary@example.com",
    provider: "custom",
    status: "active",
    sendEnabled: true
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    status: "received",
    from: "buyer@example.com",
    to: [account.emailAddress],
    subject: "Deployment question",
    bodyText: "Can you summarize this thread for the team?",
    recordId: "contact-lin"
  });
  const response = await new InlineBackgroundJobExecutor(store).runEmailSummarizeJob(context, { threadId: message.threadId });
  const thread = response.thread;

  assert.equal(response.updated, true);
  assert.equal(response.result.enabled, true);
  assert.equal(thread?.id, message.threadId);
  assert.match(thread?.summary ?? "", /紧凑线程记忆/);
  const timelineActivity = store.listActivities(context, "contact-lin").find((activity) => activity.type === "email" && activity.title.includes("AI"));
  assert.match(timelineActivity?.body ?? "", /紧凑线程记忆/);
  const audit = store.listAuditLogs(context, { entityType: "email_ai_generation" }).find((log) => log.details.purpose === "summarize" && log.details.threadId === message.threadId);
  assert.equal(audit?.details.enabled, true);
  assert.equal(audit?.details.recordId, "contact-lin");
  assert.equal(audit?.details.sourceCount > 0, true);
  assert.equal(audit?.details.contextCharCount > 0, true);
  assert.equal(audit?.details.maxContextChars > 0, true);
  assert.equal(audit?.details.modelPromptChars > 0, true);
});

await run("email summarization records skipped audit when feature is disabled", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { features: { draft: true, translate: true, context_analysis: true, auto_summarize: false } });
  const account = store.createEmailAccount(context, {
    name: "Disabled summary mailbox",
    emailAddress: "disabled-summary@example.com",
    provider: "custom",
    status: "active",
    sendEnabled: true
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    status: "received",
    from: "buyer@example.com",
    to: [account.emailAddress],
    subject: "Do not summarize",
    bodyText: "Summarization is disabled for this workspace.",
    recordId: "contact-lin"
  });
  const before = store.getEmailThread(context, message.threadId);
  const response = await new InlineBackgroundJobExecutor(store).runEmailSummarizeJob(context, { threadId: message.threadId });
  const after = store.getEmailThread(context, message.threadId);
  const audit = store.listAuditLogs(context, { entityType: "email_ai_generation" }).find((log) => log.details.purpose === "summarize" && log.details.threadId === message.threadId);

  assert.equal(response.updated, false);
  assert.equal(response.result.enabled, false);
  assert.equal(after.summary, before.summary);
  assert.equal(after.summaryUpdatedAt, before.summaryUpdatedAt);
  assert.ok(audit);
  assert.equal(audit?.details.enabled, false);
  assert.equal(audit?.details.recordId, "contact-lin");
  assert.equal(audit?.details.sourceCount > 0, true);
  assert.equal("text" in audit.details, false);
});

await run("recording new email preserves existing ai compact thread summary", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { features: { auto_summarize: true } });
  const account = store.createEmailAccount(context, {
    name: "Preserve AI Summary",
    emailAddress: "preserve-summary@example.com",
    provider: "custom",
    status: "active",
    sendEnabled: true
  });
  const first = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    status: "received",
    from: "buyer@example.com",
    to: [account.emailAddress],
    subject: "Original customer context",
    bodyText: "This first message seeds the thread."
  });

  store.updateEmailThreadSummary(context, first.threadId, "AI compact memory that should remain stable.");
  store.recordEmailMessage(context, {
    accountId: account.id,
    threadId: first.threadId,
    direction: "inbound",
    status: "received",
    from: "buyer@example.com",
    to: [account.emailAddress],
    subject: "New follow up",
    bodyText: "This new message should not overwrite the AI summary."
  });

  const thread = store.getEmailThread(context, first.threadId);
  assert.equal(thread.summary, "AI compact memory that should remain stable.");
});

await run("inline background executor refreshes email thread analysis through ai", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { features: { draft: true, translate: true, context_analysis: true, auto_summarize: true } });
  const account = store.createEmailAccount(context, {
    name: "Analysis mailbox",
    emailAddress: "analysis@example.com",
    provider: "custom",
    status: "active",
    sendEnabled: true
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    status: "received",
    from: "buyer@example.com",
    to: [account.emailAddress],
    subject: "Deployment risk",
    bodyText: "We need a deployment recommendation before Friday.",
    recordId: "contact-lin"
  });
  const response = await new InlineBackgroundJobExecutor(store).runEmailAnalyzeJob(context, { threadId: message.threadId, sourceMessageId: message.id });
  const thread = response.thread;

  assert.equal(response.updated, true);
  assert.equal(response.result.enabled, true);
  assert.equal(thread?.id, message.threadId);
  assert.match(thread?.aiAnalysis ?? "", /AI 线程分析/);
  assert.match(thread?.aiAnalysis ?? "", /建议下一步/);
  assert.doesNotMatch(thread?.aiAnalysis ?? "", /Recent email history:|Knowledge base:|User request:/);
  assert.equal(thread?.aiAnalysisSources?.some((source) => source.recordId === "contact-lin"), true);
  assert.equal(thread?.aiAnalysisSources?.some((source) => source.messageId === message.id), true);
  const audit = store.listAuditLogs(context, { entityType: "email_ai_generation" }).find((log) => log.details.purpose === "context_analysis" && log.details.threadId === message.threadId);
  assert.equal(audit?.details.enabled, true);
  assert.equal(audit?.details.recordId, "contact-lin");
  assert.equal(audit?.details.sourceMessageId, message.id);
  assert.equal(audit?.details.sourceCount > 0, true);
  assert.equal(audit?.details.modelPromptChars > 0, true);
});

await run("email context analysis records skipped audit when feature is disabled", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { features: { draft: true, translate: true, context_analysis: false, auto_summarize: true } });
  const account = store.createEmailAccount(context, {
    name: "Disabled analysis mailbox",
    emailAddress: "disabled-analysis@example.com",
    provider: "custom",
    status: "active",
    sendEnabled: true
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    status: "received",
    from: "buyer@example.com",
    to: [account.emailAddress],
    subject: "Do not analyze",
    bodyText: "Context analysis is disabled for this workspace.",
    recordId: "contact-lin"
  });
  const response = await new InlineBackgroundJobExecutor(store).runEmailAnalyzeJob(context, { threadId: message.threadId, sourceMessageId: message.id });
  const thread = store.getEmailThread(context, message.threadId);
  const audit = store.listAuditLogs(context, { entityType: "email_ai_generation" }).find((log) => log.details.purpose === "context_analysis" && log.details.threadId === message.threadId);

  assert.equal(response.updated, false);
  assert.equal(response.result.enabled, false);
  assert.equal(thread.aiAnalysis, undefined);
  assert.equal(thread.aiAnalysisSources, undefined);
  assert.ok(audit);
  assert.equal(audit?.details.enabled, false);
  assert.equal(audit?.details.sourceMessageId, message.id);
  assert.equal(audit?.details.recordId, "contact-lin");
  assert.equal("text" in audit.details, false);
});

await run("worker rejects email sync job envelopes without connection config", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const calls = [];
  const account = {
    id: "email-account-worker",
    workspaceId: defaultWorkspaceId,
    name: "Worker mailbox",
    emailAddress: "worker@example.com",
    provider: "smtp_imap",
    status: "active",
    syncEnabled: true,
    sendEnabled: true,
    connectionConfigured: false,
    createdById: "user-admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const repository = {
    async getEmailAccount() {
      return account;
    },
    async getEmailAccountConnectionConfig() {
      return undefined;
    },
    async markEmailAccountConnectionError(syncContext, accountId, errorMessage) {
      calls.push({ method: "markEmailAccountConnectionError", syncContext, accountId, errorMessage });
      return { ...account, status: "error", lastConnectionError: errorMessage };
    },
    async syncEmailAccount(syncContext, accountId) {
      calls.push({ method: "syncEmailAccount", syncContext, accountId });
      assert.equal(syncContext.user.id, "user-admin");
      assert.equal(accountId, account.id);
      return { account, importedCount: 2, status: "synced" };
    }
  };

  await assert.rejects(
    () => processQueuedJobEnvelope(buildEmailSyncJobEnvelope(context, { accountId: account.id }), repository, async () => context),
    /connection is not configured/
  );
  assert.equal(calls.some((call) => call.method === "markEmailAccountConnectionError" && call.accountId === account.id), true);
  assert.equal(calls.some((call) => call.method === "syncEmailAccount"), false);
});

await run("worker processes email send job envelopes", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Worker send mailbox",
    emailAddress: "worker-send@example.com",
    provider: "smtp_imap",
    status: "active",
    sendEnabled: true
  });
  const queued = store.queueEmailMessage(context, {
    accountId: account.id,
    to: ["buyer@example.com"],
    subject: "Worker queued proposal",
    bodyText: "Proposal sent from worker."
  });
  await assert.rejects(
    () => processQueuedJobEnvelope(buildEmailSendJobEnvelope(context, { messageId: queued.id }), store, async () => context),
    /connection is not configured/
  );
  const failed = store.getEmailMessage(context, queued.id);
  assert.equal(failed.status, "failed");
  assert.match(failed.failureReason ?? "", /connection is not configured/);
});

await run("worker processes email summarize job envelopes", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { features: { draft: true, translate: true, context_analysis: true, auto_summarize: true } });
  const account = store.createEmailAccount(context, {
    name: "Worker summary mailbox",
    emailAddress: "worker-summary@example.com",
    provider: "custom",
    status: "active",
    sendEnabled: true
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    status: "received",
    from: "buyer@example.com",
    to: [account.emailAddress],
    subject: "Worker summary",
    bodyText: "Summarize this worker thread."
  });
  const result = await processQueuedJobEnvelope(buildEmailSummarizeJobEnvelope(context, { threadId: message.threadId }), store, async () => context);

  assert.equal(result.processed, true);
  assert.equal(result.jobType, "email_summarize");
  assert.equal(result.emailThread.id, message.threadId);
  assert.match(result.emailThread.summary ?? "", /紧凑线程记忆/);
  assert.equal(formatJobWorkerResult(result), `Processed email summarize for thread ${message.threadId}`);
});

await run("worker processes email analyze job envelopes", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { features: { draft: true, translate: true, context_analysis: true, auto_summarize: true } });
  const account = store.createEmailAccount(context, {
    name: "Worker analysis mailbox",
    emailAddress: "worker-analysis@example.com",
    provider: "custom",
    status: "active",
    sendEnabled: true
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    status: "received",
    from: "buyer@example.com",
    to: [account.emailAddress],
    subject: "Worker analysis",
    bodyText: "Analyze this worker thread."
  });
  const result = await processQueuedJobEnvelope(buildEmailAnalyzeJobEnvelope(context, { threadId: message.threadId, sourceMessageId: message.id }), store, async () => context);

  assert.equal(result.processed, true);
  assert.equal(result.jobType, "email_analyze");
  assert.equal(result.emailThread.id, message.threadId);
  assert.match(result.emailThread.aiAnalysis ?? "", /AI 线程分析/);
  assert.match(result.emailThread.aiAnalysis ?? "", /建议下一步/);
  assert.equal(result.emailThread.aiAnalysisSources?.some((source) => source.messageId === message.id), true);
  assert.equal(formatJobWorkerResult(result), `Processed email analyze for thread ${message.threadId}`);
});

await run("failed outbound email messages can be requeued without stale sent timestamps", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Retry mailbox",
    emailAddress: "retry-send@example.com",
    provider: "smtp_imap",
    status: "active",
    sendEnabled: true
  });
  const queued = store.queueEmailMessage(context, {
    accountId: account.id,
    to: ["buyer@example.com"],
    subject: "Retry proposal",
    bodyText: "Retry this proposal."
  });
  const failed = store.updateEmailMessageStatus(context, queued.id, "failed", { failureReason: "SMTP returned 550" });
  const requeued = store.updateEmailMessageStatus(context, failed.id, "queued");
  await assert.rejects(
    () => new InlineBackgroundJobExecutor(store).runEmailSendJob(context, { messageId: requeued.id }),
    /connection is not configured/
  );
  const result = store.getEmailMessage(context, requeued.id);

  assert.equal(failed.status, "failed");
  assert.equal(failed.failureReason, "SMTP returned 550");
  assert.equal(failed.sentAt, undefined);
  assert.equal(requeued.status, "queued");
  assert.equal(requeued.failureReason, undefined);
  assert.equal(requeued.sentAt, undefined);
  assert.equal(result.status, "failed");
  assert.match(result.failureReason ?? "", /connection is not configured/);
  assert.equal(result.sentAt, undefined);
});

await run("queued provider send failures persist a message-level failure reason", async () => {
  const account = {
    id: "gmail-failure-account",
    workspaceId: defaultWorkspaceId,
    name: "Gmail Failure",
    emailAddress: "gmail-failure@example.com",
    provider: "gmail",
    status: "active",
    syncEnabled: true,
    sendEnabled: true,
    connectionConfigured: true,
    createdById: "user-admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const queuedMessage = {
    id: "queued-failure-message",
    workspaceId: defaultWorkspaceId,
    threadId: "thread-failure",
    accountId: account.id,
    direction: "outbound",
    status: "queued",
    from: account.emailAddress,
    to: ["buyer@example.com"],
    subject: "Failure",
    bodyText: "This send will fail.",
    createdAt: new Date().toISOString()
  };
  let failedMessage;
  const fakeRepository = {
    async getEmailMessage() {
      return queuedMessage;
    },
    async getEmailAccount() {
      return account;
    },
    async listEmailMessages() {
      return [queuedMessage];
    },
    async getEmailAccountConnectionConfig() {
      return { oauthProvider: "gmail", accessToken: "access-token", refreshToken: "refresh-token", expiresAt: "2099-06-20T12:00:00.000Z" };
    },
    async updateEmailAccountConnectionConfig() {
      return account;
    },
    async markEmailAccountConnectionError(_context, _accountId, errorMessage) {
      return { ...account, status: errorMessage ? "error" : "active", lastConnectionError: errorMessage ?? undefined };
    },
    async updateEmailMessageStatus(_context, messageId, status, options) {
      const updated = { ...queuedMessage, id: messageId, status, failureReason: options?.failureReason, sentAt: status === "sent" ? new Date().toISOString() : undefined };
      if (status === "failed") {
        failedMessage = updated;
      }
      return updated;
    }
  };
  const adapter = createEmailProviderAdapter(fakeRepository, {
    oauth: {
      fetchImpl: async () => new Response("provider unavailable", { status: 503 })
    }
  });
  const context = { workspaceId: defaultWorkspaceId, user: seedData.users[0], role: seedData.roles[0] };

  await assert.rejects(() => adapter.sendQueued(context, queuedMessage.id), /Gmail send failed with HTTP 503/);
  assert.equal(failedMessage.status, "failed");
  assert.match(failedMessage.failureReason, /Gmail send failed with HTTP 503/);
});

await run("email sync scheduler queues active or retryable sync-enabled accounts and keeps batch errors isolated", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const accounts = [
    {
      id: "email-active-a",
      workspaceId: defaultWorkspaceId,
      name: "Active A",
      emailAddress: "active-a@example.com",
      provider: "smtp_imap",
      status: "active",
      syncEnabled: true,
      sendEnabled: true,
      connectionConfigured: true,
      createdById: "user-admin",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "email-active-b",
      workspaceId: defaultWorkspaceId,
      name: "Active B",
      emailAddress: "active-b@example.com",
      provider: "smtp_imap",
      status: "active",
      syncEnabled: true,
      sendEnabled: true,
      connectionConfigured: true,
      createdById: "user-admin",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "email-error",
      workspaceId: defaultWorkspaceId,
      name: "Retryable Error",
      emailAddress: "retryable-error@example.com",
      provider: "smtp_imap",
      status: "error",
      syncEnabled: true,
      sendEnabled: true,
      connectionConfigured: true,
      lastConnectionError: "Previous mailbox timeout",
      createdById: "user-admin",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "email-disabled",
      workspaceId: defaultWorkspaceId,
      name: "Disabled",
      emailAddress: "disabled@example.com",
      provider: "smtp_imap",
      status: "disabled",
      syncEnabled: true,
      sendEnabled: true,
      connectionConfigured: true,
      createdById: "user-admin",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "email-send-only",
      workspaceId: defaultWorkspaceId,
      name: "Send Only",
      emailAddress: "send-only@example.com",
      provider: "smtp_imap",
      status: "active",
      syncEnabled: false,
      sendEnabled: true,
      connectionConfigured: true,
      createdById: "user-admin",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "email-unconfigured",
      workspaceId: defaultWorkspaceId,
      name: "Unconfigured",
      emailAddress: "unconfigured@example.com",
      provider: "smtp_imap",
      status: "active",
      syncEnabled: true,
      sendEnabled: true,
      connectionConfigured: false,
      createdById: "user-admin",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "email-custom",
      workspaceId: defaultWorkspaceId,
      name: "Custom",
      emailAddress: "custom@example.com",
      provider: "custom",
      status: "active",
      syncEnabled: true,
      sendEnabled: false,
      connectionConfigured: true,
      createdById: "user-admin",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];
  const repository = {
    async listEmailAccounts() {
      return accounts;
    }
  };
  const executor = {
    async runEmailSyncJob(syncContext, payload) {
      assert.equal(syncContext.user.id, "user-admin");
      assert.equal(payload.limit, 20);
      assert.equal(payload.fullResync, undefined);
      if (payload.accountId === "email-active-b") {
        throw new Error("mailbox temporarily unavailable");
      }
      const account = accounts.find((candidate) => candidate.id === payload.accountId);
      return { account, importedCount: 1, status: "queued" };
    }
  };

  const summary = await scheduleEmailSyncForActiveAccounts(context, { repository, executor, limit: 20 });

  assert.equal(summary.scheduledCount, 2);
  assert.equal(summary.skippedCount, 4);
  assert.equal(summary.limit, 20);
  assert.deepEqual(summary.accounts.map((account) => account.accountId), [
    "email-active-a",
    "email-active-b",
    "email-error",
    "email-disabled",
    "email-send-only",
    "email-unconfigured",
    "email-custom"
  ]);
  assert.equal(summary.accounts[0].status, "queued");
  assert.equal(summary.accounts[1].status, "failed");
  assert.match(summary.accounts[1].error, /temporarily unavailable/);
  assert.equal(summary.accounts[2].status, "queued");
  assert.equal(summary.accounts[3].status, "skipped");
  assert.match(summary.accounts[3].skipReason, /disabled/);
  assert.match(summary.accounts[4].skipReason, /未开启收件同步/);
  assert.match(summary.accounts[5].skipReason, /未配置收件连接/);
  assert.match(summary.accounts[6].skipReason, /不支持收件同步/);
});

await run("email sync scheduler forwards full resync requests to each scheduled account", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const now = new Date().toISOString();
  const accounts = [
    {
      id: "email-full-a",
      workspaceId: defaultWorkspaceId,
      name: "Full A",
      emailAddress: "full-a@example.com",
      provider: "smtp_imap",
      status: "active",
      syncEnabled: true,
      sendEnabled: true,
      connectionConfigured: true,
      createdById: "user-admin",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "email-full-b",
      workspaceId: defaultWorkspaceId,
      name: "Full B",
      emailAddress: "full-b@example.com",
      provider: "smtp_imap",
      status: "error",
      syncEnabled: true,
      sendEnabled: true,
      connectionConfigured: true,
      createdById: "user-admin",
      createdAt: now,
      updatedAt: now
    }
  ];
  const payloads = [];
  const repository = {
    async listEmailAccounts() {
      return accounts;
    }
  };
  const executor = {
    async runEmailSyncJob(_context, payload) {
      payloads.push(payload);
      const account = accounts.find((candidate) => candidate.id === payload.accountId);
      return {
        account,
        importedCount: 0,
        scannedCount: 0,
        skippedDuplicateCount: 0,
        hasMore: false,
        status: "queued"
      };
    }
  };

  const summary = await scheduleEmailSyncForActiveAccounts(context, { repository, executor, limit: 100, fullResync: true });

  assert.equal(summary.scheduledCount, 2);
  assert.equal(summary.fullResync, true);
  assert.deepEqual(payloads, [
    { accountId: "email-full-a", limit: 100, fullResync: true },
    { accountId: "email-full-b", limit: 100, fullResync: true }
  ]);
});

await run("email sync scheduler does not enqueue accounts that are already syncing", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const now = new Date().toISOString();
  const accounts = [
    {
      id: "email-queued",
      workspaceId: defaultWorkspaceId,
      name: "Queued",
      emailAddress: "queued@example.com",
      provider: "smtp_imap",
      status: "active",
      syncEnabled: true,
      sendEnabled: true,
      connectionConfigured: true,
      lastSyncStatus: "queued",
      createdById: "user-admin",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "email-running",
      workspaceId: defaultWorkspaceId,
      name: "Running",
      emailAddress: "running@example.com",
      provider: "smtp_imap",
      status: "active",
      syncEnabled: true,
      sendEnabled: true,
      connectionConfigured: true,
      lastSyncStatus: "running",
      lastSyncStartedAt: now,
      createdById: "user-admin",
      createdAt: now,
      updatedAt: now
    }
  ];
  let scheduledCount = 0;
  const repository = {
    async listEmailAccounts() {
      return accounts;
    },
    async markEmailAccountSyncFailed() {
      throw new Error("fresh in-progress sync should not be marked failed");
    }
  };
  const executor = {
    async runEmailSyncJob() {
      scheduledCount += 1;
      throw new Error("fresh in-progress sync should not be scheduled");
    }
  };

  const summary = await scheduleEmailSyncForActiveAccounts(context, { repository, executor });

  assert.equal(scheduledCount, 0);
  assert.equal(summary.scheduledCount, 0);
  assert.equal(summary.skippedCount, 2);
  assert.match(summary.accounts[0].skipReason, /队列/);
  assert.match(summary.accounts[1].skipReason, /正在拉取/);
});

await run("email sync scheduler marks stale running accounts failed before retrying", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const staleTime = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  const account = {
    id: "email-stale-running",
    workspaceId: defaultWorkspaceId,
    name: "Stale Running",
    emailAddress: "stale@example.com",
    provider: "smtp_imap",
    status: "active",
    syncEnabled: true,
    sendEnabled: true,
    connectionConfigured: true,
    lastSyncStatus: "running",
    lastSyncStartedAt: staleTime,
    createdById: "user-admin",
    createdAt: staleTime,
    updatedAt: staleTime
  };
  const calls = [];
  const repository = {
    async listEmailAccounts() {
      return [account];
    },
    async markEmailAccountSyncFailed(_context, accountId, errorMessage) {
      calls.push({ method: "markEmailAccountSyncFailed", accountId, errorMessage });
      return { ...account, lastSyncStatus: "failed", lastSyncError: errorMessage, updatedAt: new Date().toISOString() };
    }
  };
  const executor = {
    async runEmailSyncJob(_context, payload) {
      calls.push({ method: "runEmailSyncJob", accountId: payload.accountId });
      return {
        account: { ...account, lastSyncStatus: "queued" },
        importedCount: 0,
        scannedCount: 0,
        skippedDuplicateCount: 0,
        hasMore: false,
        status: "queued"
      };
    }
  };

  const summary = await scheduleEmailSyncForActiveAccounts(context, { repository, executor });

  assert.equal(summary.scheduledCount, 1);
  assert.equal(summary.skippedCount, 0);
  assert.equal(summary.accounts[0].status, "queued");
  assert.deepEqual(calls.map((call) => call.method), ["markEmailAccountSyncFailed", "runEmailSyncJob"]);
  assert.match(calls[0].errorMessage, /超过 10 分钟未结束/);
});

await run("email sync scheduler requires admin permission", async () => {
  const store = new CrmStore();
  const salesContext = store.getContext("user-sales");
  const repository = {
    async listEmailAccounts() {
      throw new Error("listEmailAccounts should not run");
    }
  };

  await assert.rejects(
    () => scheduleEmailSyncForActiveAccounts(salesContext, { repository }),
    /crm\.admin/
  );
});

await run("webhook job envelopes preserve event payload and retry metadata", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const envelope = buildWebhookEventEnvelope(context, {
    event: "record.updated",
    data: { recordId: "record-queued", objectKey: "contacts" }
  });

  assert.equal(envelope.type, "webhook_event");
  assert.equal(envelope.workspaceId, context.workspaceId);
  assert.equal(envelope.userId, context.user.id);
  assert.equal(envelope.payload.event, "record.updated");
  assert.equal(envelope.payload.data.recordId, "record-queued");
  assert.equal(envelope.attempts, 0);
  assert.match(envelope.enqueuedAt, /^\d{4}-\d{2}-\d{2}T/);
});

await run("redis queue commands are encoded with RESP bulk strings", () => {
  assert.equal(encodeRedisCommand(["LPUSH", "crm:jobs", "{}"]).toString("utf8"), "*3\r\n$5\r\nLPUSH\r\n$8\r\ncrm:jobs\r\n$2\r\n{}\r\n");
});

await run("job health treats inline executor as healthy without redis", async () => {
  const health = await checkJobHealth({
    executor: "inline",
    redisUrl: "",
    ping: async () => {
      throw new Error("Redis should not be checked");
    }
  });

  assert.equal(health.ok, true);
  assert.equal(health.executor, "inline");
  assert.equal(health.queue, "inline");
  assert.equal(health.redis, undefined);
});

await run("job health requires redis url when redis executor is enabled", async () => {
  const health = await checkJobHealth({ executor: "redis", redisUrl: "" });

  assert.equal(health.ok, false);
  assert.equal(health.executor, "redis");
  assert.equal(health.queue, "error");
  assert.equal(health.redis, "missing_config");
  assert.match(health.error ?? "", /REDIS_URL/);
});

await run("job health pings redis when redis executor is enabled", async () => {
  const health = await checkJobHealth({
    executor: "redis",
    redisUrl: "redis://redis:6379",
    ping: async (redisUrl) => {
      assert.equal(redisUrl, "redis://redis:6379");
      return "PONG";
    }
  });

  assert.equal(health.ok, true);
  assert.equal(health.queue, "ok");
  assert.equal(health.redis, "ok");
});

await run("job health reports redis ping failure without leaking connection urls", async () => {
  const health = await checkJobHealth({
    executor: "redis",
    redisUrl: "redis://:secret@redis:6379",
    ping: async () => {
      throw new Error("connect failed for redis://:secret@redis:6379");
    }
  });

  assert.equal(health.ok, false);
  assert.equal(health.redis, "error");
  assert.doesNotMatch(health.error ?? "", /secret/);
  assert.match(health.error ?? "", /redis:\/\/\[redacted\]/);
  assert.equal(toSafeHealthError(new Error("failed postgresql://user:pass@db/app")), "failed postgres://[redacted]");
  const databaseError = toSafeDatabaseHealthError(
    new Error("Can't reach database server at `127.0.0.1:54329` for postgresql://postgres:secret@127.0.0.1:54329/app"),
    "postgresql://postgres:secret@127.0.0.1:54329/ai_agent_crm?schema=public"
  );
  assert.doesNotMatch(databaseError, /secret/);
  assert.match(databaseError, /target=127\.0\.0\.1:54329/);
  assert.match(databaseError, /docker compose up -d postgres/);
  assert.match(databaseError, /postgres:\/\/\[redacted\]/);
});

await run("email subsystem diagnostics report env readiness without secrets", async () => {
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, "2026-06-20T00:00:00.000Z");
  settings.maxHistoryMessages = 4;
  settings.maxContextChars = 6000;
  const diagnostics = await checkEmailSubsystemDiagnostics({
    env: {
      EMAIL_CONFIG_SECRET: "diagnostic-secret-32-chars",
      EMAIL_OAUTH_STATE_SECRET: "oauth-state-secret-32-chars",
      APP_BASE_URL: "https://crm.example.com",
      AI_PROVIDER: "openai-compatible",
      EMAIL_SYNC_INTERVAL_MS: "60000",
      EMAIL_SYNC_LIMIT: "25",
      EMAIL_SYNC_USER_ID: "email-sync-admin",
      JOB_EXECUTOR: "redis",
      GMAIL_OAUTH_CLIENT_ID: "gmail-client",
      GMAIL_OAUTH_CLIENT_SECRET: "gmail-secret"
    },
    aiSettings: settings,
    checkJobs: async () => ({ ok: true, executor: "inline", queue: "inline" }),
    includeJobs: true
  });

  assert.equal(diagnostics.ok, true);
  assert.equal(diagnostics.encryption.status, "ok");
  assert.equal(diagnostics.oauthState.status, "ok");
  assert.equal(diagnostics.oauthCallback.status, "ok");
  assert.equal(diagnostics.oauthCallback.callbackUrl, "https://crm.example.com/api/email/oauth/callback");
  assert.equal(diagnostics.deliveryMode.status, "ok");
  assert.equal(diagnostics.aiProvider.status, "warning");
  assert.equal(diagnostics.aiContextPolicy.status, "ok");
  assert.equal(diagnostics.aiContextPolicy.requireSourceLinks, true);
  assert.equal(diagnostics.aiContextPolicy.maxKnowledgeArticles, 5);
  assert.equal(diagnostics.aiContextPolicy.enabledAutomationCount, 1);
  assert.deepEqual(diagnostics.aiContextPolicy.automationEligibleStatuses.inbound, ["received"]);
  assert.deepEqual(diagnostics.aiContextPolicy.automationEligibleStatuses.outbound, ["sent"]);
  assert.deepEqual(diagnostics.aiContextPolicy.featureDependencies, [
    { feature: "auto_translate", dependsOn: "translate" },
    { feature: "auto_context_analysis", dependsOn: "context_analysis" }
  ]);
  assert.equal(diagnostics.aiContextPolicy.autoContextAnalysisScope, "inbound_received_only");
  assert.equal(diagnostics.aiContextPolicy.budgetPolicy.maxModelPromptChars, MAX_EMAIL_MODEL_PROMPT_CHARS);
  assert.equal(diagnostics.aiContextPolicy.budgetPolicy.maxGeneratedOutputChars, MAX_EMAIL_AI_OUTPUT_CHARS);
  assert.equal(diagnostics.aiContextPolicy.budgetPolicy.maxSuggestedSubjectChars, MAX_EMAIL_AI_SUBJECT_CHARS);
  assert.match(diagnostics.aiContextPolicy.message, /inbound received\/outbound sent/);
  assert.match(diagnostics.aiContextPolicy.message, /auto_translate->translate/);
  assert.match(diagnostics.aiContextPolicy.message, /model prompt cap/);
  assert.match(diagnostics.aiContextPolicy.message, /output cap/);
  assert.equal(diagnostics.autoSummaryPolicy.status, "ok");
  assert.equal(diagnostics.autoSummaryPolicy.enabled, true);
  assert.equal(diagnostics.autoSummaryPolicy.maxHistoryMessages, 4);
  assert.equal(diagnostics.autoSummaryPolicy.minNewMessages, 3);
  assert.match(diagnostics.autoSummaryPolicy.message, /throttled/);
  assert.equal(diagnostics.syncScheduler.status, "ok");
  assert.equal(diagnostics.syncScheduler.intervalMs, 60000);
  assert.equal(diagnostics.syncScheduler.limit, 25);
  assert.equal(diagnostics.syncScheduler.userId, "email-sync-admin");
  assert.equal(diagnostics.syncScheduler.configuredUserId, "email-sync-admin");
  assert.equal(diagnostics.syncScheduler.userIdSource, "EMAIL_SYNC_USER_ID");
  assert.equal(diagnostics.syncScheduler.fallbackToAdmin, true);
  assert.match(diagnostics.syncScheduler.message, /preferred user email-sync-admin from EMAIL_SYNC_USER_ID/);
  assert.equal(diagnostics.syncScheduler.queueBacked, true);
  assert.equal(diagnostics.aiAutomationFailures.status, "ok");
  assert.equal(diagnostics.oauthProviders.gmail.status, "ok");
  assert.equal(diagnostics.oauthProviders.gmail.missingScopes.length, 0);
  assert.match(diagnostics.oauthProviders.gmail.scope, /mail\.google\.com/);
  assert.equal(diagnostics.oauthProviders.outlook.status, "warning");
  assert.equal(diagnostics.jobs?.queue, "inline");
});

await run("email auto summary diagnostics describe workspace settings", async () => {
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, "2026-06-20T00:00:00.000Z");
  settings.maxHistoryMessages = 2;
  settings.maxContextChars = 2500;
  let diagnostics = buildEmailAutoSummaryPolicyDiagnostics(settings);

  assert.equal(diagnostics.enabled, true);
  assert.equal(diagnostics.maxHistoryMessages, 2);
  assert.equal(diagnostics.minNewMessages, 2);
  assert.equal(diagnostics.maxContextChars, 2500);
  assert.match(diagnostics.message, /2 new messages/);

  settings.features.auto_summarize = false;
  diagnostics = buildEmailAutoSummaryPolicyDiagnostics(settings);
  assert.equal(diagnostics.enabled, false);
  assert.match(diagnostics.message, /disabled/);
});

await run("email sync scheduler diagnostics validate interval and queue mode", () => {
  const invalid = buildEmailSyncSchedulerDiagnostics({ EMAIL_SYNC_INTERVAL_MS: "0", EMAIL_SYNC_USER_ID: "admin" });
  assert.equal(invalid.status, "error");
  assert.match(invalid.message, /positive integer/);

  const invalidLimit = buildEmailSyncSchedulerDiagnostics({ EMAIL_SYNC_LIMIT: "101", EMAIL_SYNC_USER_ID: "admin" });
  assert.equal(invalidLimit.status, "error");
  assert.match(invalidLimit.message, /EMAIL_SYNC_LIMIT/);

  const inlineWithAccounts = buildEmailSyncSchedulerDiagnostics({ EMAIL_SYNC_INTERVAL_MS: "90000", EMAIL_SYNC_LIMIT: "30", EMAIL_SYNC_USER_ID: "admin", JOB_EXECUTOR: "inline" }, { syncEnabled: 2 });
  assert.equal(inlineWithAccounts.status, "warning");
  assert.equal(inlineWithAccounts.intervalMs, 90000);
  assert.equal(inlineWithAccounts.limit, 30);
  assert.equal(inlineWithAccounts.queueBacked, false);
  assert.equal(inlineWithAccounts.syncEnabledAccounts, 2);
  assert.match(inlineWithAccounts.message, /JOB_EXECUTOR=redis/);
});

await run("email send claim diagnostics report stale sending messages", () => {
  const freshAttempt = new Date().toISOString();
  const staleAttempt = new Date(Date.now() - 120000).toISOString();
  const diagnostics = buildEmailSendClaimDiagnostics(
    [
      {
        id: "fresh-sending",
        workspaceId: defaultWorkspaceId,
        threadId: "thread-fresh",
        accountId: "account-fresh",
        direction: "outbound",
        status: "sending",
        from: "sales@example.com",
        to: ["buyer@example.com"],
        subject: "Fresh send",
        bodyText: "Still sending",
        sendAttemptedAt: freshAttempt,
        createdAt: freshAttempt
      },
      {
        id: "stale-sending",
        workspaceId: defaultWorkspaceId,
        threadId: "thread-stale",
        accountId: "account-stale",
        direction: "outbound",
        status: "sending",
        from: "sales@example.com",
        to: ["buyer@example.com"],
        subject: "Stale send",
        bodyText: "Worker crashed",
        sendAttemptedAt: staleAttempt,
        createdAt: staleAttempt
      }
    ],
    { EMAIL_SEND_CLAIM_TIMEOUT_MS: "60000" }
  );

  assert.equal(diagnostics.status, "warning");
  assert.equal(diagnostics.timeoutMs, 60000);
  assert.equal(diagnostics.sendingCount, 2);
  assert.equal(diagnostics.staleCount, 1);
  assert.equal(diagnostics.staleMessages[0].id, "stale-sending");
});

await run("email ai context diagnostics warn on weak provenance or missing knowledge context", async () => {
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, "2026-06-20T00:00:00.000Z");
  settings.requireSourceLinks = false;
  settings.maxKnowledgeArticles = 0;
  settings.features.translate = true;
  settings.features.auto_translate = true;
  const diagnostics = buildEmailAiContextPolicyDiagnostics(settings);

  assert.equal(diagnostics.status, "warning");
  assert.equal(diagnostics.loaded, true);
  assert.equal(diagnostics.requireSourceLinks, false);
  assert.equal(diagnostics.maxKnowledgeArticles, 0);
  assert.equal(diagnostics.enabledAutomationCount, 2);
  assert.deepEqual(diagnostics.featureDependencies[0], { feature: "auto_translate", dependsOn: "translate" });
  assert.match(diagnostics.message, /Source references are optional/);
  assert.match(diagnostics.message, /knowledge 0 articles/);
});

await run("email subsystem diagnostics report dry-run delivery mode", async () => {
  const diagnostics = await checkEmailSubsystemDiagnostics({
    env: {
      EMAIL_CONFIG_SECRET: "diagnostic-secret-32-chars",
      EMAIL_OAUTH_STATE_SECRET: "oauth-state-secret-32-chars",
      APP_BASE_URL: "https://crm.example.com",
      AI_PROVIDER: "openai-compatible",
      EMAIL_DELIVERY_MODE: "dry-run"
    }
  });

  assert.equal(diagnostics.ok, true);
  assert.equal(diagnostics.deliveryMode.status, "warning");
  assert.match(diagnostics.deliveryMode.message, /dry-run/);
});

await run("email subsystem diagnostics report recent ai automation failures", async () => {
  const diagnostics = await checkEmailSubsystemDiagnostics({
    env: {
      EMAIL_CONFIG_SECRET: "diagnostic-secret-32-chars",
      EMAIL_OAUTH_STATE_SECRET: "oauth-state-secret-32-chars",
      APP_BASE_URL: "https://crm.example.com",
      AI_PROVIDER: "openai-compatible"
    },
    auditLogs: [
      {
        id: "audit-email-ai-failure",
        workspaceId: defaultWorkspaceId,
        actorId: "user-admin",
        action: "create",
        entityType: "email_ai_generation",
        entityId: "thread-ai-failure",
        summary: "Skipped email AI translate",
        details: {
          purpose: "translate",
          automationFailed: true,
          threadId: "thread-ai-failure",
          sourceMessageId: "message-ai-failure",
          errorMessage: "AI provider timeout"
        },
        createdAt: "2026-06-21T00:00:00.000Z"
      }
    ]
  });

  assert.equal(diagnostics.ok, true);
  assert.equal(diagnostics.status, "warning");
  assert.equal(diagnostics.aiAutomationFailures.status, "warning");
  assert.equal(diagnostics.aiAutomationFailures.recentFailureCount, 1);
  assert.equal(diagnostics.aiAutomationFailures.recentFailures[0].sourceMessageId, "message-ai-failure");
  assert.match(diagnostics.aiAutomationFailures.recentFailures[0].errorMessage ?? "", /timeout/);
});

await run("email subsystem diagnostics report recent ai provider fallbacks", async () => {
  const diagnostics = await checkEmailSubsystemDiagnostics({
    env: {
      EMAIL_CONFIG_SECRET: "diagnostic-secret-32-chars",
      EMAIL_OAUTH_STATE_SECRET: "oauth-state-secret-32-chars",
      APP_BASE_URL: "https://crm.example.com",
      AI_PROVIDER: "openai-compatible",
      AI_API_KEY: "test-key"
    },
    auditLogs: [
      {
        id: "audit-email-ai-provider-fallback",
        workspaceId: defaultWorkspaceId,
        actorId: "user-admin",
        action: "create",
        entityType: "email_ai_generation",
        entityId: "thread-provider-fallback",
        summary: "Generated email AI draft",
        details: {
          purpose: "draft",
          generationMode: "provider_fallback",
          threadId: "thread-provider-fallback",
          sourceMessageId: "message-provider-fallback",
          providerError: "AI provider returned HTTP 503"
        },
        createdAt: "2026-06-21T00:00:00.000Z"
      }
    ]
  });

  assert.equal(diagnostics.ok, true);
  assert.equal(diagnostics.status, "warning");
  assert.equal(diagnostics.aiProviderFallbacks.status, "warning");
  assert.equal(diagnostics.aiProviderFallbacks.recentFallbackCount, 1);
  assert.equal(diagnostics.aiProviderFallbacks.recentFallbacks[0].sourceMessageId, "message-provider-fallback");
  assert.match(diagnostics.aiProviderFallbacks.recentFallbacks[0].providerError ?? "", /HTTP 503/);

  const direct = buildEmailAiProviderFallbackDiagnostics([]);
  assert.equal(direct.status, "ok");
  assert.equal(direct.recentFallbackCount, 0);
});

await run("email subsystem diagnostics cap ai automation failure details", async () => {
  const auditLogs = Array.from({ length: 12 }, (_value, index) => ({
    id: `audit-email-ai-failure-${index}`,
    workspaceId: defaultWorkspaceId,
    actorId: "user-admin",
    action: "create",
    entityType: "email_ai_generation",
    entityId: `thread-ai-failure-${index}`,
    summary: "Skipped email AI summarize",
    details: {
      purpose: "summarize",
      automationFailed: true,
      threadId: `thread-ai-failure-${index}`,
      errorMessage: `failure ${index}`
    },
    createdAt: `2026-06-21T00:00:${String(index).padStart(2, "0")}.000Z`
  }));
  auditLogs.push({
    id: "audit-email-ai-success",
    workspaceId: defaultWorkspaceId,
    actorId: "user-admin",
    action: "create",
    entityType: "email_ai_generation",
    entityId: "thread-ai-success",
    summary: "Generated email AI summarize",
    details: { purpose: "summarize", automationFailed: false },
    createdAt: "2026-06-21T00:01:00.000Z"
  });

  const diagnostics = await checkEmailSubsystemDiagnostics({
    env: {
      EMAIL_CONFIG_SECRET: "diagnostic-secret-32-chars",
      EMAIL_OAUTH_STATE_SECRET: "oauth-state-secret-32-chars",
      APP_BASE_URL: "https://crm.example.com",
      AI_PROVIDER: "openai-compatible"
    },
    auditLogs
  });

  assert.equal(diagnostics.aiAutomationFailures.recentFailureCount, 10);
  assert.equal(diagnostics.aiAutomationFailures.recentFailures.length, 10);
  assert.equal(diagnostics.aiAutomationFailures.recentFailures.some((failure) => failure.threadId === "thread-ai-success"), false);
});

await run("email subsystem diagnostics require admin before listing accounts", async () => {
  const store = new CrmStore();
  const adminContext = store.getContext("user-admin");
  const salesContext = store.getContext("user-sales");
  const calls = [];
  const settingsCalls = [];
  const repository = {
    listEmailAccounts(context) {
      calls.push(context.user.id);
      return [];
    },
    getEmailAiSettings(context) {
      settingsCalls.push(context.user.id);
      return { ...store.getEmailAiSettings(context), maxHistoryMessages: 5 };
    }
  };

  await assert.rejects(
    () => checkEmailSubsystemDiagnosticsForContext(salesContext, repository, { includeJobs: false }),
    /crm\.admin/
  );
  assert.deepEqual(calls, []);

  const diagnostics = await checkEmailSubsystemDiagnosticsForContext(adminContext, repository, {
    env: {
      EMAIL_CONFIG_SECRET: "diagnostic-secret-32-chars",
      EMAIL_OAUTH_STATE_SECRET: "oauth-state-secret-32-chars",
      APP_BASE_URL: "https://crm.example.com",
      AI_PROVIDER: "openai-compatible"
    },
    includeJobs: false
  });
  assert.equal(diagnostics.encryption.status, "ok");
  assert.equal(diagnostics.autoSummaryPolicy.maxHistoryMessages, 5);
  assert.deepEqual(calls, ["user-admin"]);
  assert.deepEqual(settingsCalls, ["user-admin"]);
});

await run("email diagnostics warn when app base url is not origin-only", async () => {
  const diagnostics = await checkEmailSubsystemDiagnostics({
    env: {
      EMAIL_CONFIG_SECRET: "diagnostic-secret-32-chars",
      EMAIL_OAUTH_STATE_SECRET: "oauth-state-secret-32-chars",
      APP_BASE_URL: "https://crm.example.com/app",
      AI_PROVIDER: "openai-compatible"
    }
  });

  assert.equal(diagnostics.ok, true);
  assert.equal(diagnostics.oauthCallback.status, "warning");
  assert.equal(diagnostics.oauthCallback.callbackUrl, "https://crm.example.com/api/email/oauth/callback");
});

await run("email diagnostics require https app base url for configured oauth providers", async () => {
  const diagnostics = await checkEmailSubsystemDiagnostics({
    env: {
      EMAIL_CONFIG_SECRET: "diagnostic-secret-32-chars",
      EMAIL_OAUTH_STATE_SECRET: "oauth-state-secret-32-chars",
      APP_BASE_URL: "http://crm.example.com",
      AI_PROVIDER: "openai-compatible",
      GMAIL_OAUTH_CLIENT_ID: "gmail-client",
      GMAIL_OAUTH_CLIENT_SECRET: "gmail-secret"
    }
  });

  assert.equal(diagnostics.ok, false);
  assert.equal(diagnostics.status, "error");
  assert.equal(diagnostics.oauthCallback.status, "error");
  assert.match(diagnostics.oauthCallback.message, /HTTPS/);
});

await run("email diagnostics validate oauth provider scopes before real mailbox tests", async () => {
  const gmail = await checkEmailSubsystemDiagnostics({
    env: {
      EMAIL_CONFIG_SECRET: "diagnostic-secret-32-chars",
      EMAIL_OAUTH_STATE_SECRET: "oauth-state-secret-32-chars",
      APP_BASE_URL: "https://crm.example.com",
      GMAIL_OAUTH_CLIENT_ID: "gmail-client",
      GMAIL_OAUTH_CLIENT_SECRET: "gmail-secret",
      GMAIL_OAUTH_SCOPE: "https://www.googleapis.com/auth/gmail.readonly"
    }
  });
  assert.equal(gmail.ok, false);
  assert.equal(gmail.oauthProviders.gmail.status, "error");
  assert.deepEqual(gmail.oauthProviders.gmail.missingScopes, ["gmail.send or https://mail.google.com/"]);
  assert.doesNotMatch(gmail.oauthProviders.gmail.message, /gmail-secret/);

  const outlook = await checkEmailSubsystemDiagnostics({
    env: {
      EMAIL_CONFIG_SECRET: "diagnostic-secret-32-chars",
      EMAIL_OAUTH_STATE_SECRET: "oauth-state-secret-32-chars",
      APP_BASE_URL: "https://crm.example.com",
      OUTLOOK_OAUTH_CLIENT_ID: "outlook-client",
      OUTLOOK_OAUTH_CLIENT_SECRET: "outlook-secret",
      OUTLOOK_OAUTH_SCOPE: "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send"
    }
  });
  assert.equal(outlook.ok, false);
  assert.equal(outlook.oauthProviders.outlook.status, "error");
  assert.deepEqual(outlook.oauthProviders.outlook.missingScopes, ["offline_access"]);
  assert.doesNotMatch(outlook.oauthProviders.outlook.message, /outlook-secret/);
});

await run("email provider registry exposes capabilities used by oauth diagnostics and ui", () => {
  const providers = listEmailProviderCapabilities();

  assert.deepEqual(providers.map((provider) => provider.key), ["smtp_imap", "gmail", "outlook", "custom"]);
  assert.deepEqual([...oauthEmailProviderKeys], ["gmail", "outlook"]);
  assert.equal(getEmailProviderCapability("smtp_imap").supportsOAuth, false);
  assert.equal(getEmailProviderCapability("smtp_imap").supportsSend, true);
  assert.equal(isOAuthEmailProvider("gmail"), true);
  assert.equal(isOAuthEmailProvider("custom"), false);
  assert.deepEqual(getEmailProviderSetupVisibility("smtp_imap"), {
    showSmtpImapFields: true,
    showOAuthFields: false,
    canStartOAuth: false
  });
  assert.deepEqual(getEmailProviderSetupVisibility("gmail"), {
    showSmtpImapFields: false,
    showOAuthFields: true,
    canStartOAuth: true
  });
  assert.deepEqual(getEmailProviderSetupVisibility("outlook"), {
    showSmtpImapFields: false,
    showOAuthFields: true,
    canStartOAuth: true
  });
  assert.deepEqual(getEmailProviderSetupVisibility("custom"), {
    showSmtpImapFields: false,
    showOAuthFields: false,
    canStartOAuth: false
  });
  assert.equal(getOAuthEmailProviderCapability("gmail").oauthEnvPrefix, "GMAIL");
  assert.match(getOAuthEmailProviderCapability("outlook").defaultScope, /Mail\.Send/);
});

await run("outbound email recipient policy counts totals and case-insensitive duplicates", () => {
  const result = validateOutboundEmailRecipientPolicy({
    to: ["Buyer@example.com"],
    cc: ["buyer@example.com", "stakeholder@example.com"],
    bcc: ["hidden@example.com"]
  });

  assert.equal(result.total, 4);
  assert.equal(result.uniqueTotal, 3);
  assert.deepEqual(result.duplicateRecipients, ["Buyer@example.com"]);
  assert.match(result.errors.join("\n"), /must be unique/);
});

await run("email subsystem diagnostics require oauth env for configured oauth accounts", async () => {
  const accounts = [
    {
      id: "gmail-account",
      workspaceId: defaultWorkspaceId,
      name: "Gmail",
      emailAddress: "gmail@example.com",
      provider: "gmail",
      status: "active",
      syncEnabled: true,
      sendEnabled: true,
      connectionConfigured: false,
      lastConnectionError: "Missing refresh token",
      createdById: "user-admin",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "smtp-account",
      workspaceId: defaultWorkspaceId,
      name: "SMTP",
      emailAddress: "smtp@example.com",
      provider: "smtp_imap",
      status: "disabled",
      syncEnabled: false,
      sendEnabled: false,
      connectionConfigured: true,
      createdById: "user-admin",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];
  const diagnostics = await checkEmailSubsystemDiagnostics({
    env: {
      EMAIL_CONFIG_SECRET: "diagnostic-secret-32-chars",
      EMAIL_OAUTH_STATE_SECRET: "oauth-state-secret-32-chars",
      AI_API_KEY: "ai-key"
    },
    accounts
  });

  assert.equal(diagnostics.ok, false);
  assert.equal(diagnostics.status, "error");
  assert.equal(diagnostics.oauthProviders.gmail.required, true);
  assert.equal(diagnostics.oauthProviders.gmail.status, "error");
  assert.equal(diagnostics.accounts?.total, 2);
  assert.equal(diagnostics.accounts?.active, 1);
  assert.equal(diagnostics.accounts?.missingConnectionConfig, 1);
  assert.equal(diagnostics.accounts?.withLastConnectionError, 1);
  assert.equal(diagnostics.accounts?.byProvider.gmail, 1);
});

await run("email account diagnostics aggregate provider and status counts", () => {
  const now = new Date().toISOString();
  const diagnostics = buildEmailAccountDiagnostics([
    {
      id: "outlook-account",
      workspaceId: defaultWorkspaceId,
      name: "Outlook",
      emailAddress: "outlook@example.com",
      provider: "outlook",
      status: "error",
      syncEnabled: true,
      sendEnabled: false,
      connectionConfigured: true,
      lastConnectionError: "Token expired",
      createdById: "user-admin",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "active-unconfigured-account",
      workspaceId: defaultWorkspaceId,
      name: "Active Unconfigured",
      emailAddress: "active-unconfigured@example.com",
      provider: "smtp_imap",
      status: "active",
      syncEnabled: true,
      sendEnabled: true,
      connectionConfigured: false,
      createdById: "user-admin",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "active-send-only-account",
      workspaceId: defaultWorkspaceId,
      name: "Active Send Only",
      emailAddress: "active-send-only@example.com",
      provider: "gmail",
      status: "active",
      syncEnabled: false,
      sendEnabled: true,
      connectionConfigured: true,
      createdById: "user-admin",
      createdAt: now,
      updatedAt: now
    }
  ]);

  assert.equal(diagnostics.total, 3);
  assert.equal(diagnostics.active, 2);
  assert.equal(diagnostics.error, 1);
  assert.equal(diagnostics.syncEnabled, 2);
  assert.equal(diagnostics.sendEnabled, 2);
  assert.equal(diagnostics.connectionConfigured, 2);
  assert.equal(diagnostics.activeConnectionConfigured, 1);
  assert.equal(diagnostics.syncConnectionConfigured, 0);
  assert.equal(diagnostics.sendConnectionConfigured, 1);
  assert.equal(diagnostics.byProvider.outlook, 1);
  assert.equal(diagnostics.byProvider.gmail, 1);
  assert.equal(diagnostics.byProvider.smtp_imap, 1);
});

await run("email connection test run aggregates success failures and skipped accounts", async () => {
  const now = new Date("2026-06-20T12:00:00.000Z");
  const baseAccount = {
    workspaceId: defaultWorkspaceId,
    provider: "smtp_imap",
    syncEnabled: true,
    sendEnabled: true,
    createdById: "user-admin",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  const accounts = [
    {
      ...baseAccount,
      id: "ok-account",
      name: "Ok",
      emailAddress: "ok@example.com",
      status: "active",
      connectionConfigured: true
    },
    {
      ...baseAccount,
      id: "failed-account",
      name: "Failed",
      emailAddress: "failed@example.com",
      status: "active",
      connectionConfigured: true
    },
    {
      ...baseAccount,
      id: "draft-account",
      name: "Draft",
      emailAddress: "draft@example.com",
      status: "draft",
      connectionConfigured: true
    },
    {
      ...baseAccount,
      id: "unconfigured-account",
      name: "Unconfigured",
      emailAddress: "unconfigured@example.com",
      status: "active",
      connectionConfigured: false
    }
  ];
  const testedIds = [];
  const repository = {
    async listEmailAccounts() {
      return accounts;
    }
  };
  const adapter = {
    async testConnection(_context, accountId) {
      testedIds.push(accountId);
      const account = accounts.find((candidate) => candidate.id === accountId);
      if (accountId === "failed-account") {
        throw Object.assign(new Error("SMTP authentication failed"), { account: { ...account, lastConnectionError: "SMTP authentication failed" } });
      }
      return { account, result: { smtp: "ok", imap: "ok" } };
    }
  };

  const runResult = await testEmailAccountConnections(
    { workspaceId: defaultWorkspaceId, user: seedData.users[0], role: seedData.roles[0] },
    repository,
    { adapter, now }
  );

  assert.equal(runResult.testedAt, now.toISOString());
  assert.deepEqual(testedIds, ["ok-account", "failed-account"]);
  assert.equal(runResult.total, 4);
  assert.equal(runResult.tested, 2);
  assert.equal(runResult.succeeded, 1);
  assert.equal(runResult.failed, 1);
  assert.equal(runResult.skipped, 2);
  assert.equal(runResult.results.find((entry) => entry.account.id === "failed-account")?.error, "SMTP authentication failed");
  assert.equal(runResult.results.find((entry) => entry.account.id === "draft-account")?.reason, "Account is not active");
  assert.equal(runResult.results.find((entry) => entry.account.id === "unconfigured-account")?.reason, "Connection is not configured");
});

await run("email connection test run requires admin permission", async () => {
  const store = new CrmStore();
  const salesContext = store.getContext("user-sales");
  const repository = {
    async listEmailAccounts() {
      throw new Error("listEmailAccounts should not run");
    }
  };

  await assert.rejects(
    () => testEmailAccountConnections(salesContext, repository),
    /crm\.admin/
  );
});

await run("worker retry envelopes increment attempts and preserve the last error", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const envelope = buildCsvImportJobEnvelope(context, "job-worker-retry", {
    objectKey: "contacts",
    csv: "title,email\nRetry,retry@example.com"
  });
  const failedOnce = buildFailedJobEnvelope(envelope, "database unavailable");

  assert.equal(failedOnce.attempts, 1);
  assert.equal(failedOnce.lastError, "database unavailable");
  assert.equal(failedOnce.jobId, envelope.jobId);
});

await run("worker queue settings expose max attempts and dead letter queue names", () => {
  const previousMaxAttempts = process.env.JOB_MAX_ATTEMPTS;
  const previousEmailSyncMaxAttempts = process.env.EMAIL_SYNC_JOB_MAX_ATTEMPTS;
  const previousDeadLetterQueue = process.env.JOB_DEAD_LETTER_QUEUE_NAME;
  try {
    delete process.env.JOB_MAX_ATTEMPTS;
    delete process.env.EMAIL_SYNC_JOB_MAX_ATTEMPTS;
    delete process.env.JOB_DEAD_LETTER_QUEUE_NAME;
    assert.equal(getMaxJobAttempts(), 3);
    assert.equal(getDeadLetterQueueName("crm:jobs"), "crm:jobs:dead");
    const emailSyncEnvelope = buildEmailSyncJobEnvelope(
      { workspaceId: defaultWorkspaceId, user: { id: "user-admin" } },
      {
        accountId: "account-1",
        limit: 10
      }
    );
    assert.equal(getMaxJobAttemptsForEnvelope(emailSyncEnvelope), 1);

    process.env.JOB_MAX_ATTEMPTS = "5";
    process.env.EMAIL_SYNC_JOB_MAX_ATTEMPTS = "2";
    process.env.JOB_DEAD_LETTER_QUEUE_NAME = "crm:jobs:failed";
    assert.equal(getMaxJobAttempts(), 5);
    assert.equal(getMaxJobAttemptsForEnvelope(emailSyncEnvelope), 2);
    assert.equal(getDeadLetterQueueName("crm:jobs"), "crm:jobs:failed");
  } finally {
    if (previousMaxAttempts === undefined) {
      delete process.env.JOB_MAX_ATTEMPTS;
    } else {
      process.env.JOB_MAX_ATTEMPTS = previousMaxAttempts;
    }
    if (previousEmailSyncMaxAttempts === undefined) {
      delete process.env.EMAIL_SYNC_JOB_MAX_ATTEMPTS;
    } else {
      process.env.EMAIL_SYNC_JOB_MAX_ATTEMPTS = previousEmailSyncMaxAttempts;
    }
    if (previousDeadLetterQueue === undefined) {
      delete process.env.JOB_DEAD_LETTER_QUEUE_NAME;
    } else {
      process.env.JOB_DEAD_LETTER_QUEUE_NAME = previousDeadLetterQueue;
    }
  }
});

await run("csv import all-or-nothing aborts when any row is invalid", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const before = store.listRecords(context, "contacts").length;
  const result = store.importCsv(
    context,
    "contacts",
    "title,email,gender\nAtomic Good,atomic-good@example.com,female\nAtomic Bad,atomic-bad@example.com,unknown",
    "all-or-nothing"
  );

  assert.equal(result.aborted, true);
  assert.equal(result.created.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(store.listRecords(context, "contacts").length, before);
  const importLog = store.listAuditLogs(context).find((log) => log.action === "import" && log.entityType === "csv_import");
  assert.equal(importLog?.details?.strategy, "all-or-nothing");
  assert.equal(importLog?.details?.aborted, true);
});

await run("csv import all-or-nothing creates rows when preview is clean", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const result = store.importCsv(
    context,
    "contacts",
    "title,email\nAtomic One,atomic-one@example.com\nAtomic Two,atomic-two@example.com",
    "all-or-nothing"
  );

  assert.equal(result.aborted, false);
  assert.equal(result.created.length, 2);
  assert.equal(result.errors.length, 0);
});

await run("csv import preview reports mappings and row-level errors without creating records", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const result = store.previewCsvImport(
    context,
    "contacts",
    "title,email,gender,unknown\nValid Contact,valid-preview@example.com,female,x\nBad Gender,bad-preview@example.com,unknown,y\nDuplicate,lin@example.com,male,z"
  );

  assert.equal(result.totalRows, 3);
  assert.equal(result.creatableRows, 1);
  assert.equal(result.errorRows, 1);
  assert.equal(result.conflictRows, 1);
  assert.equal(result.mappedFields.some((field) => field.key === "email"), true);
  assert.deepEqual(result.unmappedHeaders, ["unknown"]);
  assert.equal(result.errors.length, 2);
  assert.deepEqual(
    result.rows.map((row) => row.status),
    ["ready", "error", "conflict"]
  );
  assert.equal(result.rows[2]?.conflicts[0]?.existingRecordId, "contact-lin");
  assert.equal(store.listRecords(context, "contacts").some((record) => record.title === "Valid Contact"), false);
});

await run("csv import supports explicit header mapping for preview and import", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const mapping = { Name: "title", Email: "email", Phone: "phone" };
  const preview = store.previewCsvImport(
    context,
    "contacts",
    "Name,Email,Phone\nMapped Contact,mapped-contact@example.com,13988880000",
    mapping
  );

  assert.equal(preview.creatableRows, 1);
  assert.equal(preview.errorRows, 0);
  assert.equal(preview.unmappedHeaders.length, 0);
  assert.equal(preview.mappedFields.some((field) => field.key === "email"), true);
  assert.equal(preview.rows[0]?.values.email, "mapped-contact@example.com");

  const result = store.importCsv(
    context,
    "contacts",
    "Name,Email,Phone\nMapped Contact,mapped-contact@example.com,13988880000",
    "skip-invalid",
    mapping
  );
  assert.equal(result.created.length, 1);
  assert.equal(result.created[0]?.title, "Mapped Contact");
  assert.equal(result.created[0]?.data.email, "mapped-contact@example.com");
});

await run("csv import rejects mappings that target unknown or duplicate fields", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");

  assert.throws(
    () => store.previewCsvImport(context, "contacts", "Name\nMapped Contact", { Name: "missingField" }),
    /unknown field missingField/
  );
  assert.throws(
    () => store.previewCsvImport(context, "contacts", "Email One,Email Two\none@example.com,two@example.com", { "Email One": "email", "Email Two": "email" }),
    /targets email more than once/
  );
});

await run("csv import skips existing-record conflicts and reports conflict metadata", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const before = store.listRecords(context, "contacts").length;
  const result = store.importCsv(
    context,
    "contacts",
    "title,email\nFresh Import,fresh-import@example.com\nExisting Lin,lin@example.com"
  );

  assert.equal(result.aborted, false);
  assert.equal(result.created.length, 1);
  assert.equal(result.updated.length, 0);
  assert.equal(result.preview.conflictRows, 1);
  assert.equal(result.preview.rows[1]?.status, "conflict");
  assert.equal(result.preview.rows[1]?.conflicts[0]?.existingRecordId, "contact-lin");
  assert.match(result.errors[0], /conflicts with existing record/i);
  assert.equal(store.listRecords(context, "contacts").length, before + 1);
});

await run("csv import update-existing updates conflict rows instead of creating duplicates", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const before = store.listRecords(context, "contacts").length;
  const result = store.importCsv(
    context,
    "contacts",
    "title,email,phone\nLin Updated,lin@example.com,13999990000\nFresh Update Import,fresh-update-import@example.com,13999990001",
    "update-existing"
  );

  const updatedLin = store.getRecord(context, "contacts", "contact-lin");
  assert.equal(result.aborted, false);
  assert.equal(result.created.length, 1);
  assert.equal(result.updated.length, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(result.preview.conflictRows, 1);
  assert.equal(updatedLin.title, "Lin Updated");
  assert.equal(updatedLin.data.phone, "13999990000");
  assert.equal(store.listRecords(context, "contacts").length, before + 1);
  assert.equal(store.listAuditLogs(context, { action: "import", entityType: "csv_import" })[0]?.details?.updated, 1);
});

await run("csv import all-or-nothing aborts on existing-record conflicts", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const before = store.listRecords(context, "contacts").length;
  const result = store.importCsv(
    context,
    "contacts",
    "title,email\nAtomic Fresh,atomic-fresh-conflict@example.com\nAtomic Existing,lin@example.com",
    "all-or-nothing"
  );

  assert.equal(result.aborted, true);
  assert.equal(result.created.length, 0);
  assert.equal(result.preview.errorRows, 0);
  assert.equal(result.preview.conflictRows, 1);
  assert.equal(store.listRecords(context, "contacts").length, before);
});

await run("csv import preview rejects duplicate values inside the same file", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const result = store.previewCsvImport(
    context,
    "contacts",
    "title,email\nFirst,dupe-preview@example.com\nSecond,dupe-preview@example.com"
  );

  assert.equal(result.creatableRows, 1);
  assert.equal(result.errorRows, 1);
  assert.equal(result.rows[1]?.status, "error");
  assert.match(result.rows[1]?.errors[0] ?? "", /unique|唯一|重复|already/i);
});

await run("saved views apply filters and sorting", () => {
  const records = [
    {
      id: "deal-1",
      workspaceId: "workspace-private",
      objectKey: "deals",
      title: "Big Deal",
      data: { amount: 200, status: "open" },
      createdAt: "2026-06-17T12:00:00.000Z",
      updatedAt: "2026-06-17T12:00:00.000Z"
    },
    {
      id: "deal-2",
      workspaceId: "workspace-private",
      objectKey: "deals",
      title: "Small Deal",
      data: { amount: 100, status: "open" },
      createdAt: "2026-06-17T12:00:00.000Z",
      updatedAt: "2026-06-17T12:00:00.000Z"
    },
    {
      id: "deal-3",
      workspaceId: "workspace-private",
      objectKey: "deals",
      title: "Closed Deal",
      data: { amount: 300, status: "closed" },
      createdAt: "2026-06-17T12:00:00.000Z",
      updatedAt: "2026-06-17T12:00:00.000Z"
    }
  ];
  const view = {
    id: "view-open-deals",
    workspaceId: "workspace-private",
    objectKey: "deals",
    name: "Open Deals",
    columns: ["title", "amount"],
    filters: [{ field: "status", operator: "equals", value: "open" }],
    sort: { field: "amount", direction: "desc" },
    isDefault: false
  };

  const visible = records.filter((record) => matchesSavedView(record, view)).sort((left, right) => compareRecords(left, right, view.sort));

  assert.deepEqual(
    visible.map((record) => record.id),
    ["deal-1", "deal-2"]
  );
});

await run("saved views can keep title as the only visible configured column", () => {
  const view = {
    id: "view-title-only",
    workspaceId: "workspace-private",
    objectKey: "resellers",
    name: "Title Only",
    columns: ["title"],
    isDefault: false
  };

  const configuredColumns = view.columns.filter((column) => column !== "title");

  assert.deepEqual(configuredColumns, []);
});

await run("saved view filters can target standard fields and sort metadata fields", () => {
  const records = [
    {
      id: "contact-a",
      workspaceId: "workspace-private",
      objectKey: "contacts",
      title: "Acme Buyer",
      ownerId: "user-sales",
      data: { email: "buyer@acme.example" },
      createdAt: "2026-06-17T12:00:00.000Z",
      updatedAt: "2026-06-18T12:00:00.000Z"
    },
    {
      id: "contact-b",
      workspaceId: "workspace-private",
      objectKey: "contacts",
      title: "Beta Buyer",
      ownerId: "user-admin",
      data: { email: "buyer@beta.example" },
      createdAt: "2026-06-17T12:00:00.000Z",
      updatedAt: "2026-06-19T12:00:00.000Z"
    }
  ];
  const view = {
    id: "view-acme",
    workspaceId: "workspace-private",
    objectKey: "contacts",
    name: "Acme Contacts",
    columns: ["title", "email"],
    filters: [{ field: "title", operator: "contains", value: "Acme" }],
    sort: { field: "updatedAt", direction: "desc" },
    isDefault: false
  };

  assert.deepEqual(
    records.filter((record) => matchesSavedView(record, view)).sort((left, right) => compareRecords(left, right, view.sort)).map((record) => record.id),
    ["contact-a"]
  );

  const ownerView = {
    ...view,
    id: "view-owner",
    name: "Sales Owned",
    columns: ["title", "ownerId"],
    filters: [{ field: "ownerId", operator: "equals", value: "user-sales" }],
    sort: { field: "ownerId", direction: "asc" }
  };

  assert.deepEqual(
    records.filter((record) => matchesSavedView(record, ownerView)).sort((left, right) => compareRecords(left, right, ownerView.sort)).map((record) => record.id),
    ["contact-a"]
  );
});

await run("record list query filters searches sorts and paginates records", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.createRecord(context, "contacts", { title: "Query Alpha", data: { email: "query-alpha@example.com", phone: "13900000001" } });
  store.createRecord(context, "contacts", { title: "Query Beta", data: { email: "query-beta@example.com", phone: "13900000002" } });
  store.createRecord(context, "contacts", { title: "Query Gamma", data: { email: "gamma@example.com", phone: "13900000003" } });

  const result = store.queryRecords(context, "contacts", {
    page: 1,
    pageSize: 1,
    q: "query",
    filters: [{ field: "email", operator: "contains", value: "query-" }],
    sort: { field: "title", direction: "desc" }
  });

  assert.equal(result.total, 2);
  assert.equal(result.pageCount, 2);
  assert.deepEqual(
    result.records.map((record) => record.title),
    ["Query Beta"]
  );
});

await run("record tags can be created searched filtered sorted and exported", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const tagged = store.createRecord(context, "contacts", {
    title: "Tagged Alpha",
    tags: [" VIP ", "vip", "North"],
    tagColors: { vip: "navy", north: "mint", unused: "rose" },
    data: { email: "tagged-alpha@example.com" }
  });
  store.createRecord(context, "contacts", { title: "Plain Beta", tags: ["south"], data: { email: "plain-beta@example.com" } });

  assert.deepEqual(tagged.tags, ["vip", "north"]);
  assert.deepEqual(tagged.tagColors, { vip: "navy", north: "mint" });
  assert.deepEqual(store.createRecord(context, "contacts", { title: "Round Robin", tags: ["one", "two", "three"] }).tagColors, { one: "cyan", two: "mint", three: "sky" });
  const recolored = store.updateRecord(context, "contacts", tagged.id, { tagColors: { vip: "amber", north: "sky", unused: "navy" } });
  assert.deepEqual(recolored.tagColors, { vip: "amber", north: "sky" });
  assert.deepEqual(store.queryRecords(context, "contacts", { q: "north" }).records.map((record) => record.id), [tagged.id]);
  assert.deepEqual(store.queryRecords(context, "contacts", { tags: ["vip"] }).records.map((record) => record.id), [tagged.id]);
  assert.deepEqual(
    store.queryRecords(context, "contacts", { filters: [{ field: "tags", operator: "contains", value: "nor" }] }).records.map((record) => record.id),
    [tagged.id]
  );
  assert.deepEqual(
    store.queryRecords(context, "contacts", { sort: { field: "tags", direction: "asc" }, pageSize: 10 }).records.some((record) => record.id === tagged.id),
    true
  );
  assert.match(store.exportRecordsCsv(context, "contacts", { tags: ["vip"] }), /^id,title,tags,stageKey,ownerId,createdAt,updatedAt/m);
  assert.match(store.exportRecordsCsv(context, "contacts", { tags: ["vip"] }), /vip; north/);
});

await run("record list query normalizes unsafe pagination values at the store boundary", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const result = store.queryRecords(context, "contacts", {
    page: Number.NaN,
    pageSize: Number.POSITIVE_INFINITY
  });

  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 50);

  const capped = store.queryRecords(context, "contacts", {
    page: 1,
    pageSize: 9999
  });
  assert.equal(capped.pageSize, 200);
});

await run("record list query keeps RBAC ownership limits", () => {
  const snapshot = structuredClone(seedData);
  snapshot.teams.push({ id: "team-enterprise", workspaceId: defaultWorkspaceId, name: "Enterprise" });
  snapshot.users.push({
    id: "user-other",
    workspaceId: defaultWorkspaceId,
    email: "other-query@example.com",
    name: "Other Query Sales",
    roleId: "role-sales",
    teamId: "team-enterprise"
  });
  snapshot.records.push({
    id: "contact-query-other",
    workspaceId: defaultWorkspaceId,
    objectKey: "contacts",
    title: "Hidden Query Contact",
    ownerId: "user-other",
    data: { email: "hidden-query@example.com" },
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z"
  });

  const store = new CrmStore(snapshot);
  const salesContext = store.getContext("user-sales");
  const result = store.queryRecords(salesContext, "contacts", { q: "hidden-query", pageSize: 10 });

  assert.equal(result.total, 0);
  assert.equal(result.records.length, 0);
});

await run("record csv export uses filters and RBAC visibility", () => {
  const snapshot = structuredClone(seedData);
  snapshot.teams.push({ id: "team-export-other", workspaceId: defaultWorkspaceId, name: "Export Other Team" });
  snapshot.users.push({
    id: "user-export-other",
    workspaceId: defaultWorkspaceId,
    email: "export-other@example.com",
    name: "Export Other",
    roleId: "role-sales",
    teamId: "team-export-other",
    active: true
  });
  snapshot.records.push(
    {
      id: "contact-export-owned",
      workspaceId: defaultWorkspaceId,
      objectKey: "contacts",
      title: "Export Owned",
      ownerId: "user-sales",
      data: { email: "export-owned@example.com", phone: "139,quoted" },
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z"
    },
    {
      id: "contact-export-hidden",
      workspaceId: defaultWorkspaceId,
      objectKey: "contacts",
      title: "Export Hidden",
      ownerId: "user-export-other",
      data: { email: "export-hidden@example.com", phone: "13800000000" },
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z"
    }
  );

  const store = new CrmStore(snapshot);
  const adminContext = store.getContext("user-admin");
  const salesContext = store.getContext("user-sales");
  const filteredCsv = store.exportRecordsCsv(adminContext, "contacts", { q: "Export Owned" });
  const salesCsv = store.exportRecordsCsv(salesContext, "contacts", { q: "Export" });

  assert.match(filteredCsv, /^id,title,tags,stageKey,ownerId,createdAt,updatedAt,email,phone/m);
  assert.match(filteredCsv, /contact-export-owned,Export Owned/);
  assert.match(filteredCsv, /"139,quoted"/);
  assert.doesNotMatch(filteredCsv, /contact-export-hidden/);
  assert.match(salesCsv, /contact-export-owned/);
  assert.doesNotMatch(salesCsv, /contact-export-hidden/);
});

await run("csv import template exports object field headers and examples", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const csv = store.exportImportTemplateCsv(context, "contacts");

  assert.match(csv, /^title,tags,email,phone,companyId/m);
  assert.match(csv, /Example record/);
  assert.throws(() => store.exportImportTemplateCsv(store.getContext("user-sales"), "contacts"), /crm\.import/);
});

await run("csv import maps record tags and task queries filter tags", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const importResult = store.importCsv(context, "contacts", "title,tags,email\nTagged Import,\"VIP; Import\",tag-import@example.com");
  const imported = importResult.created[0];
  assert.deepEqual(imported.tags, ["vip", "import"]);
  assert.deepEqual(imported.tagColors, { vip: "cyan", import: "mint" });

  const task = store.createActivity(context, {
    recordId: imported.id,
    type: "task",
    title: "Tagged task",
    tags: ["Follow-Up", "vip"],
    tagColors: { "follow-up": "amber", vip: "navy", unused: "rose" }
  });
  assert.deepEqual(task.tags, ["follow-up", "vip"]);
  assert.deepEqual(task.tagColors, { "follow-up": "amber", vip: "navy" });
  assert.deepEqual(store.listActivities(context, { type: "task", tags: ["follow-up"] }).map((activity) => activity.id), [task.id]);

  const updated = store.updateActivity(context, task.id, { tags: ["done"], tagColors: { done: "slate", vip: "navy" } });
  assert.deepEqual(updated.tags, ["done"]);
  assert.deepEqual(updated.tagColors, { done: "slate" });
});

await run("csv import field guide exports validation metadata", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const contactsGuide = store.exportImportTemplateFieldGuideCsv(context, "contacts");
  const companiesGuide = store.exportImportTemplateFieldGuideCsv(context, "companies");

  assert.match(contactsGuide, /^column,label,type,required,unique,defaultValue,allowedValues,referenceObject,exampleValue,notes/m);
  assert.match(contactsGuide, /title,名称,text,yes,no,,,/);
  assert.match(contactsGuide, /email,邮箱,text,no,yes/);
  assert.match(contactsGuide, /gender,性别,select,no,no/);
  assert.match(contactsGuide, /companyId,公司,reference,no,no,,,公司 \(companies\),record-id/);
  assert.match(companiesGuide, /industry,行业,select,no,no,,软件=software; 制造=manufacturing; 金融=finance,,software/);
  assert.throws(() => store.exportImportTemplateFieldGuideCsv(store.getContext("user-sales"), "contacts"), /crm\.import/);
});

await run("csv import presets save reusable strategy and mappings", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const preset = store.createImportPreset(context, {
    objectKey: "contacts",
    name: " Contacts standard ",
    strategy: "update-existing",
    mapping: { Name: "title", Email: "email", " ": "phone" }
  });

  assert.equal(preset.name, "Contacts standard");
  assert.equal(preset.strategy, "update-existing");
  assert.deepEqual(preset.mapping, { Name: "title", Email: "email" });
  assert.throws(
    () => store.createImportPreset(context, { objectKey: "contacts", name: "Broken", mapping: { Email: "missingField" } }),
    /unknown field/
  );
  assert.throws(() => store.listImportPresets(store.getContext("user-sales"), "contacts"), /crm\.import/);

  store.deleteImportPreset(context, preset.id);
  assert.deepEqual(preset.mapping, { Name: "title", Email: "email" });
  assert.equal(store.listImportPresets(context, "contacts").length, 0);
});

await run("csv import presets can be updated without changing object scope", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const preset = store.createImportPreset(context, {
    objectKey: "contacts",
    name: "Initial contacts import",
    strategy: "skip-invalid",
    mapping: { Name: "title" }
  });

  const updated = store.updateImportPreset(context, preset.id, {
    name: "Updated contacts import",
    strategy: "all-or-nothing",
    mapping: { Name: "title", Email: "email" }
  });

  assert.equal(updated.id, preset.id);
  assert.equal(updated.objectKey, "contacts");
  assert.equal(updated.name, "Updated contacts import");
  assert.equal(updated.strategy, "all-or-nothing");
  assert.deepEqual(updated.mapping, { Name: "title", Email: "email" });
  assert.throws(() => store.updateImportPreset(context, preset.id, { mapping: { Email: "missingField" } }), /unknown field/);
  assert.throws(() => store.updateImportPreset(store.getContext("user-sales"), preset.id, { strategy: "update-existing" }), /crm\.import/);
});

await run("dashboard summary aggregates visible CRM data without full page records", () => {
  const store = new CrmStore();
  const context = store.getContext("user-sales");
  const summary = store.getDashboardSummary(context);

  assert.equal(summary.recordCounts.contacts, 1);
  assert.equal(summary.recordCounts.companies, 1);
  assert.equal(summary.totalPipeline, 280000);
  assert.equal(summary.openTaskCount, 1);
  assert.equal(summary.deals.every((record) => record.objectKey === "deals"), true);
  assert.equal(summary.openTasks.every((activity) => activity.type === "task" && !activity.completedAt), true);
});

await run("deal stage updates move records through the configured pipeline", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const pipeline = store.listPipelines(context).find((item) => item.objectKey === "deals" && item.isDefault);
  const nextStage = pipeline?.stages.find((stage) => stage.key === "negotiation");
  assert.equal(nextStage?.key, "negotiation");

  const updated = store.updateRecord(context, "deals", "deal-platform", { stageKey: nextStage.key });

  assert.equal(updated.stageKey, "negotiation");
  assert.equal(store.getRecord(context, "deals", "deal-platform").stageKey, "negotiation");
});

await run("deal stage updates write a stage history activity", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const before = store.listActivities(context, "deal-platform").length;

  store.updateRecord(context, "deals", "deal-platform", { stageKey: "negotiation" });
  const activities = store.listActivities(context, "deal-platform");

  assert.equal(activities.length, before + 1);
  assert.equal(activities[0]?.type, "stage_change");
  assert.match(activities[0]?.title ?? "", /proposal -> negotiation/);
});

await run("tasks can be completed and reopened", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const task = store.listActivities(context, "contact-lin").find((activity) => activity.type === "task");
  assert.ok(task);
  assert.equal(store.getActivity(context, task.id).id, task.id);

  const completed = store.updateActivity(context, task.id, { completedAt: "2026-06-18T08:00:00.000Z" });
  assert.equal(completed.completedAt, "2026-06-18T08:00:00.000Z");
  assert.equal(store.listActivities(context).some((activity) => activity.id === task.id && activity.type === "task" && !activity.completedAt), false);

  const reopened = store.updateActivity(context, task.id, { completedAt: null });
  assert.equal(reopened.completedAt, undefined);
});

await run("tasks can be archived restored and deleted", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const task = store.createActivity(context, {
    recordId: "contact-lin",
    type: "task",
    title: "Archive test task",
    body: "Confirm task lifecycle",
    dueAt: "2026-06-23T09:00:00.000Z"
  });

  const archived = store.updateActivity(context, task.id, { archivedAt: "2026-06-23T10:00:00.000Z" });
  assert.equal(archived.archivedAt, "2026-06-23T10:00:00.000Z");
  assert.equal(store.getDashboardSummary(context).openTasks.some((activity) => activity.id === task.id), false);

  const restored = store.updateActivity(context, task.id, { archivedAt: null });
  assert.equal(restored.archivedAt, undefined);
  assert.equal(store.getDashboardSummary(context).openTasks.some((activity) => activity.id === task.id), true);

  store.deleteActivity(context, task.id);
  assert.throws(() => store.getActivity(context, task.id), /Activity not found/);
  assert.equal(store.listActivities(context).some((activity) => activity.id === task.id), false);
});

await run("deals can be closed won or lost with reasons in extension data", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");

  const won = store.updateRecord(context, "deals", "deal-platform", {
    stageKey: "won",
    data: { dealStatus: "won", wonReason: "Selected private deployment", closedAt: "2026-06-18T09:00:00.000Z" }
  });
  assert.equal(won.stageKey, "won");
  assert.equal(won.data.dealStatus, "won");
  assert.equal(won.data.wonReason, "Selected private deployment");

  const lost = store.updateRecord(context, "deals", "deal-platform", {
    stageKey: "lost",
    data: { dealStatus: "lost", lostReason: "Budget delayed", closedAt: "2026-06-18T10:00:00.000Z" }
  });
  assert.equal(lost.stageKey, "lost");
  assert.equal(lost.data.dealStatus, "lost");
  assert.equal(lost.data.lostReason, "Budget delayed");
});

await run("related records resolve through reference fields", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const objectKeys = store.snapshot().objectDefinitions.map((object) => object.key);
  const records = objectKeys.flatMap((objectKey) => store.listRecords(context, objectKey));
  const fields = store.listFieldDefinitions(context);
  const relations = store.listRelationDefinitions(context);
  const company = store.getRecord(context, "companies", "company-acme");

  const related = findRelatedRecords(company, records, fields, relations);

  assert.equal(related.some((item) => item.record.id === "contact-lin"), true);
  assert.equal(related.some((item) => item.record.id === "deal-platform"), true);
  assert.equal(related.some((item) => item.record.id === "quote-acme-platform"), true);
});

await run("sales document number rules render supported variables in Shanghai time", () => {
  const now = new Date("2026-07-11T16:05:06.000Z");
  assert.equal(salesDocumentLocalDate(now), "2026-07-12");
  assert.equal(
    renderSalesDocumentNumber("Q-$Y$M$D-$h$m$s-$ID-$NUM", 4, { now, recordId: "record-42", sequence: 7 }),
    "Q-20260712-000506-record-42-0007"
  );
  assert.match(previewSalesDocumentNumber({ workspaceId: defaultWorkspaceId, objectKey: "quotes", pattern: "Q-$ID-$NUM", sequencePadding: 4, updatedAt: now.toISOString() }, now), /保存后分配ID.*保存时序号/);
  assert.throws(() => validateSalesDocumentNumberRule("Q-$UNKNOWN", 4), /Unknown number variable/);
  assert.throws(() => validateSalesDocumentNumberRule("Q-$Y$M$D", 4), /must include \$NUM or \$ID/);
  assert.throws(() => validateSalesDocumentNumberRule("Q-$NUM", 0), /Sequence padding/);
});

await run("PDF file name rules require and render the document number variable", () => {
  const now = new Date("2026-07-13T01:02:03.000Z");
  assert.equal(
    renderPdfFileName("报价-$Y$M$D-$NUM-$ID", { now, recordId: "quote/1", documentNumber: "QT:0001" }),
    "报价-20260713-QT_0001-quote_1.pdf"
  );
  assert.throws(() => validatePdfFileNamePattern("报价-$Y$M$D"), /must include \$NUM/);
  assert.throws(() => validatePdfFileNamePattern("$NUM-$UNKNOWN"), /Unknown PDF file name variable/);
});

await run("sales document creation applies configured real id and independent daily sequence", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateSalesDocumentNumberSettings(context, [{ objectKey: "quotes", pattern: "Q-$ID-$NUM", sequencePadding: 3 }]);
  const source = store.getRecord(context, "quotes", "quote-acme-platform");
  const createQuote = (title, quoteNumber, autoGenerateNumber = false) => store.createRecord(context, "quotes", {
    title,
    autoGenerateNumber,
    data: { ...source.data, quoteNumber }
  });
  const first = createQuote("Auto one", "", true);
  assert.equal(first.data.quoteNumber, `Q-${first.id}-001`);
  const manual = createQuote("Manual", "MANUAL-QUOTE");
  assert.equal(manual.data.quoteNumber, "MANUAL-QUOTE");
  const third = createQuote("Auto three", "");
  assert.equal(third.data.quoteNumber, `Q-${third.id}-003`);
  const orderPreview = store.previewSalesDocumentNumber(context, "salesorders");
  assert.match(orderPreview.preview, /^SO-/);
});

await run("product and quote seed metadata supports company and contact associations", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const objects = store.snapshot().objectDefinitions;
  const fields = store.listFieldDefinitions(context);
  const relations = store.listRelationDefinitions(context);

  assert.equal(objects.some((object) => object.key === "products" && object.isSystem), true);
  assert.equal(objects.some((object) => object.key === "quotes" && object.isSystem), true);
  assert.equal(objects.some((object) => object.key === "currencies" && object.isSystem), true);
  assert.equal(objects.some((object) => object.key === "paymentterms" && object.isSystem), true);
  assert.equal(fields.some((field) => field.objectKey === "products" && field.key === "mainImageUrl"), true);
  assert.equal(fields.some((field) => field.objectKey === "products" && field.key === "unitPriceCurrency" && field.required), true);
  assert.equal(fields.some((field) => field.objectKey === "products" && field.key === "attachments" && field.type === "textarea"), true);
  assert.equal(fields.some((field) => field.objectKey === "quotes" && field.key === "quoteCurrency" && field.required), true);
  assert.equal(fields.some((field) => field.objectKey === "quotes" && field.key === "companyId" && field.type === "reference" && field.required), true);
  assert.equal(fields.some((field) => field.objectKey === "quotes" && field.key === "contactId" && field.type === "reference" && field.required), true);
  assert.equal(fields.some((field) => field.objectKey === "quotes" && field.key === "paymentTerm" && field.type === "select" && field.required), true);
  assert.equal(fields.some((field) => field.objectKey === "paymentterms" && field.key === "code" && field.unique), true);
  assert.equal(fields.some((field) => field.objectKey === "paymentterms" && field.key === "mode" && field.type === "select"), true);
  assert.equal(fields.some((field) => field.objectKey === "paymentterms" && field.key === "depositValue" && field.type === "number"), true);
  assert.equal(fields.some((field) => field.objectKey === "quotes" && field.key === "productId"), false);
  assert.equal(relations.some((relation) => relation.key === "company_quotes" && relation.fromObjectKey === "companies" && relation.toObjectKey === "quotes"), true);
  assert.equal(relations.some((relation) => relation.key === "contact_quotes" && relation.fromObjectKey === "contacts" && relation.toObjectKey === "quotes"), true);

  const quote = store.getRecord(context, "quotes", "quote-acme-platform");
  assert.equal(quote.data.companyId, "company-acme");
  assert.equal(quote.data.contactId, "contact-lin");
  assert.equal(quote.data.quoteCurrency, "CNY");
  assert.equal(quote.data.paymentTerm, "net_30");
  assert.equal(quote.data.lineItems[0].productId, "product-ai-sales-standard");
  assert.equal(quote.data.lineItems[0].imageUrl, "https://placehold.co/128x128/e0f2fe/0f172a?text=AI+CRM");
  assert.equal(quote.data.lineItems[0].currency, "CNY");
  assert.equal(quote.data.fees[0].name, "实施服务费");
  assert.equal(quote.data.fees[0].currency, "CNY");
  assert.equal(quote.data.totalAmount, 3499);

  const product = store.getRecord(context, "products", "product-ai-sales-standard");
  assert.equal(product.data.mainImageUrl, "https://placehold.co/128x128/e0f2fe/0f172a?text=AI+CRM");
  assert.equal(product.data.unitPriceCurrency, "CNY");
  assert.deepEqual(product.data.attachments, []);
  const currencyDefinitions = getCurrencyDefinitions(store.listRecords(context, "currencies"));
  assert.equal(currencyDefinitions.some((currency) => currency.code === "CNY" && currency.isBase), true);
  assert.equal(currencyDefinitions.some((currency) => currency.code === "USD" && currency.rateToBase === 7.2), true);
  assert.equal(store.listRecords(context, "paymentterms").some((term) => term.data.code === "advance_30_balance_70" && term.data.depositValue === 30), true);
  const related = findRelatedRecords(product, store.snapshot().records, fields, relations);
  assert.equal(related.some((item) => item.record.id === "quote-acme-platform"), true);

  const createdQuote = store.createRecord(context, "quotes", {
    title: "Acme 扩容报价",
    data: {
      quoteNumber: "Q-2026-002",
      companyId: "company-acme",
      contactId: "contact-lin",
      quoteCurrency: "USD",
      paymentTerm: "net_60",
      lineItems: [
        {
          id: "line-extra-seats",
          productId: "product-ai-sales-standard",
          productName: "AI 销售助手标准版",
          quantity: 2,
          unitPrice: 416.53,
          currency: "USD",
          description: "扩容席位"
        }
      ],
      fees: [{ id: "fee-shipping", name: "保险费", amount: 16.67, currency: "USD" }],
      status: "draft"
    }
  });
  assert.equal(createdQuote.data.quoteCurrency, "USD");
  assert.equal(createdQuote.data.totalAmount, 849.73);
  assert.throws(
    () =>
      store.createRecord(context, "quotes", {
        title: "错误报价",
        data: {
          quoteNumber: "Q-2026-003",
          companyId: "company-acme",
          contactId: "contact-lin",
          paymentTerm: "net_30",
          lineItems: [{ id: "line-missing", productId: "missing-product", productName: "Missing", quantity: 1, unitPrice: 10 }],
          status: "draft"
        }
      }),
    /不存在的产品/
  );
});

await run("PDF template layout compiles rows, offsets, nesting, and splitters", () => {
  const template = {
    content: [
      { type: "row", gutter: 8, columns: [
        { type: "col", span: 4, content: [{ text: "Left" }] },
        { type: "splitter", orientation: "vertical", thickness: 2, height: 30, style: "dashed" },
        { type: "col", span: 8, content: [{ type: "row", columns: [{ type: "col", span: 12, content: [{ text: "Nested" }] }] }] }
      ] },
      { type: "splitter", orientation: "horizontal", color: "#123456", thickness: 2, style: "dashed" },
      { type: "row", columns: [{ type: "col", span: 4, offset: 2, content: [{ text: "Offset" }] }] },
      { text: "Native pdfmake remains unchanged", bold: true }
    ]
  };
  const compiled = compilePdfTemplateLayout(template);
  assert.equal(compiled.content[0].columnGap, 8);
  assert.equal(compiled.content[0].columns[0].width, `${(4 / 12) * 100}%`);
  assert.equal(compiled.content[0].columns[1].width, 2);
  assert.equal(compiled.content[0].columns[2].stack[0].columns[0].width, "100%");
  assert.equal(compiled.content[1].table.widths[0], "*");
  assert.equal(typeof compiled.content[1].layout.hLineWidth, "function");
  assert.equal(compiled.content[2].columns[0].width, `${(2 / 12) * 100}%`);
  assert.deepEqual(compiled.content[3], template.content[3]);
});

await run("PDF template layout reports precise validation paths", () => {
  assert.throws(
    () => validatePdfTemplate({ content: [{ type: "row", columns: [{ type: "col", span: 13, content: [] }] }] }),
    (error) => error instanceof PdfTemplateValidationError && /content\[0\]\.columns\[0\]\.span must be between 1 and 12/.test(error.message)
  );
  assert.throws(() => validatePdfTemplate({ content: [{ type: "row", columns: [] }] }), /columns must contain at least one column/);
  assert.throws(() => validatePdfTemplate({ content: [{ type: "splitter", orientation: "vertical" }] }), /vertical splitter may only be used inside row\.columns/);
  assert.throws(() => validatePdfTemplate({ content: [{ type: "row", columns: [{ type: "col", span: 7, content: [] }, { type: "col", span: 6, content: [] }] }] }), /must not exceed 12/);
});

await run("PDF template conditions evaluate context paths and operators", () => {
  const context = { record: { data: { notes: "Ready", status: "approved" } }, fees: [] };
  assert.equal(evaluatePdfTemplateCondition({ path: "record.data.notes", operator: "notEmpty" }, context), true);
  assert.equal(evaluatePdfTemplateCondition({ path: "record.data.missing", operator: "exists" }, context), false);
  assert.equal(evaluatePdfTemplateCondition({ path: "record.data.status", operator: "equals", value: "approved" }, context), true);
  assert.equal(evaluatePdfTemplateCondition({ path: "record.data.status", operator: "notEquals", value: "draft" }, context), true);
  assert.doesNotThrow(() => validatePdfTemplate({ content: [{ type: "condition", when: { path: "record.data.notes", operator: "notEmpty" }, content: [{ text: "Notes" }] }] }));
  assert.throws(() => validatePdfTemplate({ content: [{ type: "condition", when: { path: "", operator: "invalid" }, content: [] }] }), /context path/);
});

await run("sales documents convert through order and invoice chain and render pdf templates", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const objects = store.snapshot().objectDefinitions;
  const fields = store.listFieldDefinitions(context);
  const relations = store.listRelationDefinitions(context);

  for (const objectKey of ["salesorders", "proformainvoices", "commercialinvoices"]) {
    assert.equal(objects.some((object) => object.key === objectKey && object.isSystem), true);
    assert.equal(fields.some((field) => field.objectKey === objectKey && field.key === "documentNumber" && field.required && field.unique), true);
    assert.equal(fields.some((field) => field.objectKey === objectKey && field.key === "companyId" && field.type === "reference"), true);
    assert.equal(fields.some((field) => field.objectKey === objectKey && field.key === "documentCurrency" && field.required), true);
  }
  assert.equal(relations.some((relation) => relation.key === "quote_salesorders"), true);
  assert.equal(relations.some((relation) => relation.key === "salesorder_proformainvoices"), true);
  assert.equal(relations.some((relation) => relation.key === "proformainvoice_commercialinvoices"), true);

  const firstSalesOrderNumber = store.generateSalesDocumentNumber(context, "salesorders", new Date("2026-07-11T00:00:00.000Z"));
  assert.equal(firstSalesOrderNumber, "SO-202607-0001");
  assert.equal(salesDocumentNextObjectKey.quotes, "salesorders");

  const salesOrder = store.convertSalesDocument(context, "quotes", "quote-acme-platform", "salesorders");
  assert.equal(salesOrder.objectKey, "salesorders");
  assert.match(String(salesOrder.data.documentNumber), /^SO-\d{6}-\d{4}$/);
  assert.equal(salesOrder.data.sourceObjectKey, "quotes");
  assert.equal(salesOrder.data.sourceRecordId, "quote-acme-platform");
  assert.equal(salesOrder.data.companyId, "company-acme");
  assert.equal(salesOrder.data.contactId, "contact-lin");
  assert.equal(salesOrder.data.documentCurrency, "CNY");
  assert.equal(salesOrder.data.paymentTerm, "net_30");
  assert.equal(salesOrder.data.totalAmount, 3499);

  const proformaInvoice = store.convertSalesDocument(context, "salesorders", salesOrder.id, "proformainvoices");
  assert.equal(proformaInvoice.objectKey, "proformainvoices");
  assert.match(String(proformaInvoice.data.documentNumber), /^PI-\d{6}-\d{4}$/);
  assert.equal(proformaInvoice.data.sourceRecordId, salesOrder.id);

  const commercialInvoice = store.convertSalesDocument(context, "proformainvoices", proformaInvoice.id, "commercialinvoices");
  assert.equal(commercialInvoice.objectKey, "commercialinvoices");
  assert.match(String(commercialInvoice.data.documentNumber), /^CI-\d{6}-\d{4}$/);
  assert.equal(commercialInvoice.data.sourceRecordId, proformaInvoice.id);
  assert.throws(() => store.convertSalesDocument(context, "quotes", "quote-acme-platform", "commercialinvoices"), /Cannot convert/);

  const templates = store.listDocumentTemplates(context, "commercialinvoices");
  assert.equal(templates.some((template) => template.isDefault && template.active), true);
  const documentRecords = [...store.listRecords(context, "currencies"), ...store.listRecords(context, "paymentterms")];
  const templateContext = buildTemplateContext({
    record: commercialInvoice,
    company: store.getRecord(context, "companies", String(commercialInvoice.data.companyId)),
    contact: store.getRecord(context, "contacts", String(commercialInvoice.data.contactId)),
    records: documentRecords,
    workspace: { id: context.workspaceId }
  });
  assert.match(String(templateContext.paymentSummary), /100% Full Payment/);
  assert.equal(Array.isArray(templateContext.paymentSchedule), true);
  assert.equal(templateContext.documentTitle, "Commercial Invoice");
  assert.match(String(templateContext.issueDate), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(templateContext.record.data.issueDate, templateContext.issueDate);
  const quoteWithoutIssueDate = store.getRecord(context, "quotes", "quote-acme-platform");
  const quoteTemplateContext = buildTemplateContext({ record: quoteWithoutIssueDate, records: documentRecords, workspace: { id: context.workspaceId } });
  assert.equal(quoteTemplateContext.issueDate, quoteWithoutIssueDate.createdAt.slice(0, 10));
  assert.equal(quoteTemplateContext.record.data.issueDate, quoteWithoutIssueDate.createdAt.slice(0, 10));
  assert.match(renderPdfTemplateText("Fees: {{money totals.feeSubtotal}} / Total: {{money totals.totalAmount \"CNY\"}}", { currency: "USD", currencyDefinitions: [{ code: "USD", label: "US Dollar", symbol: "$", rateToBase: 7.2, isBase: false, active: true }], totals: { feeSubtotal: 0, totalAmount: 2900 } }), /Fees: \$ 0 USD \/ Total: \$ 2,900 USD/);
  assert.equal(renderPdfTemplateText("{{dateAdd generatedAt 30}}", { generatedAt: "2026-07-13T23:30:00.000Z" }), "2026-08-12");
  const pdf = await renderSalesDocumentPdf(templates[0], {
    record: commercialInvoice,
    company: store.getRecord(context, "companies", String(commercialInvoice.data.companyId)),
    contact: store.getRecord(context, "contacts", String(commercialInvoice.data.contactId)),
    records: documentRecords,
    workspace: { id: context.workspaceId }
  });
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  assert.equal(pdf.length > 1000, true);
  await assert.rejects(
    renderSalesDocumentPdf(
      { ...templates[0], templateJson: { content: [{ image: "/definitely/missing-pdf-image.png" }] } },
      { record: commercialInvoice, records: documentRecords, workspace: { id: context.workspaceId } }
    )
  );
});

await run("email accounts messages and thread summaries are workspace scoped", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Sales Inbox",
    emailAddress: "Sales@Example.com",
    provider: "smtp_imap",
    syncEnabled: true,
    sendEnabled: true,
    status: "active"
  });

  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "lin@example.com",
    to: ["sales@example.com"],
    subject: "Private deployment questions",
    bodyText: "Can you confirm Docker Compose delivery and SSO roadmap?",
    recordId: "contact-lin",
    receivedAt: "2026-06-19T09:00:00.000Z"
  });
  const threads = store.listEmailThreads(context, "contact-lin");
  const activities = store.listActivities(context, "contact-lin");

  assert.equal(account.emailAddress, "sales@example.com");
  assert.equal(message.status, "received");
  assert.equal(threads.length, 1);
  assert.match(threads[0].summary ?? "", /Private deployment questions/);
  assert.equal(store.listEmailMessages(context, threads[0].id)[0].id, message.id);
  assert.equal(activities.some((activity) => activity.type === "email" && activity.title === "Private deployment questions"), true);
});

await run("email thread compact summaries do not duplicate the newly recorded message", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Summary Dedupe Inbox",
    emailAddress: "summary-dedupe@example.com",
    provider: "smtp_imap",
    syncEnabled: true,
    sendEnabled: true,
    status: "active"
  });

  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "buyer@example.com",
    to: ["summary-dedupe@example.com"],
    subject: "Single summary entry",
    bodyText: "This subject should appear once in compact memory."
  });
  const thread = store.getEmailThread(context, message.threadId);
  const subjectOccurrences = thread.summary?.match(/Single summary entry/g)?.length ?? 0;

  assert.equal(subjectOccurrences, 1);
});

await run("email thread user state persists per user", () => {
  assert.equal(emailThreadStateUpdateSchema.safeParse({ archived: true, starred: true, read: true, category: "updates", labels: ["CRM", "AI"], snoozedUntil: "2026-06-24T00:00:00.000Z" }).success, true);
  assert.equal(emailThreadStateUpdateSchema.safeParse({ category: "bad" }).success, false);

  const snapshot = structuredClone(seedData);
  snapshot.users.push({
    id: "user-email-state-peer",
    workspaceId: defaultWorkspaceId,
    email: "email-state-peer@example.com",
    name: "Email State Peer",
    roleId: "role-admin",
    active: true
  });
  const store = new CrmStore(snapshot);
  const adminContext = store.getContext("user-admin");
  const peerContext = store.getContext("user-email-state-peer");
  const account = store.createEmailAccount(adminContext, {
    name: "State Inbox",
    emailAddress: "state@example.com",
    provider: "smtp_imap",
    syncEnabled: true,
    sendEnabled: true,
    status: "active"
  });
  const message = store.recordEmailMessage(adminContext, {
    accountId: account.id,
    direction: "inbound",
    from: "buyer@example.com",
    to: ["state@example.com"],
    subject: "Persistent mailbox state",
    bodyText: "Remember my mailbox actions.",
    recordId: "contact-lin"
  });

  const updated = store.updateEmailThreadState(adminContext, message.threadId, {
    archived: true,
    starred: true,
    important: true,
    read: true,
    category: "updates",
    labels: ["CRM", "CRM", "AI"],
    snoozedUntil: "2026-06-24T00:00:00.000Z"
  });

  assert.equal(updated.archived, true);
  assert.equal(updated.starred, true);
  assert.equal(updated.important, true);
  assert.equal(updated.read, true);
  assert.equal(updated.category, "updates");
  assert.deepEqual(updated.labels, ["CRM", "AI"]);
  assert.equal(updated.snoozedUntil, "2026-06-24T00:00:00.000Z");
  assert.equal(store.getEmailThread(adminContext, message.threadId).archived, true);
  assert.equal(store.listEmailThreads(adminContext).find((thread) => thread.id === message.threadId)?.starred, true);
  assert.equal(store.getEmailThread(peerContext, message.threadId).archived, false);
  assert.equal(store.getEmailThread(peerContext, message.threadId).starred, false);
});

await run("email threads support restore unarchive permanent delete and contact method matching", () => {
  const snapshot = structuredClone(seedData);
  snapshot.records.push({
    id: "contact-method-match",
    workspaceId: defaultWorkspaceId,
    objectKey: "contacts",
    title: "Method Match",
    ownerId: "user-admin",
    data: {
      contactMethods: [
        { id: "method-email-1", type: "email", value: "method-match@example.com", label: "Work", primary: true },
        { id: "method-whatsapp-1", type: "whatsapp", value: "+8613800000000", label: "WhatsApp" }
      ]
    },
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z"
  });
  const store = new CrmStore(snapshot);
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Trash Inbox",
    emailAddress: "trash@example.com",
    provider: "smtp_imap",
    syncEnabled: true,
    sendEnabled: true,
    status: "active"
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "method-match@example.com",
    to: ["trash@example.com"],
    subject: "Contact method auto link",
    bodyText: "The thread should link through contactMethods email."
  });

  assert.equal(store.getEmailThread(context, message.threadId).recordId, "contact-method-match");
  assert.equal(store.getEmailThread(context, message.threadId).category, "primary");
  const promo = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "offers@example.com",
    to: ["trash@example.com"],
    subject: "Limited time discount",
    bodyText: "Use this coupon before the sale ends."
  });
  assert.equal(store.getEmailThread(context, promo.threadId).category, "promotions");
  assert.equal(store.updateEmailThreadState(context, message.threadId, { deleted: true }).deleted, true);
  assert.equal(store.updateEmailThreadState(context, message.threadId, { deleted: false }).deleted, false);
  assert.equal(store.setEmailThreadRemoteDeleted(context, message.threadId, true).deleted, true);
  assert.equal(store.updateEmailThreadState(context, message.threadId, { deleted: false }).deleted, true);
  assert.equal(store.setEmailThreadRemoteDeleted(context, message.threadId, false).deleted, false);
  assert.equal(store.updateEmailThreadState(context, message.threadId, { archived: true }).archived, true);
  assert.equal(store.updateEmailThreadState(context, message.threadId, { archived: false }).archived, false);

  const snapshotWithReminders = store.snapshot();
  snapshotWithReminders.smartReminders ??= [];
  snapshotWithReminders.smartReminders.push(
    {
      id: "reminder-email-thread-source",
      workspaceId: defaultWorkspaceId,
      userId: "user-admin",
      kind: "email_reply",
      priority: "high",
      title: "Reply to deleted thread",
      status: "open",
      sources: [{ label: "Thread", threadId: message.threadId }],
      score: 90,
      idempotencyKey: "reminder-email-thread-source",
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z"
    },
    {
      id: "reminder-email-message-source",
      workspaceId: defaultWorkspaceId,
      userId: "user-admin",
      kind: "follow_up",
      priority: "medium",
      title: "Follow up deleted message",
      status: "open",
      sources: [{ label: "Message", messageId: message.id }],
      score: 80,
      idempotencyKey: "reminder-email-message-source",
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z"
    },
    {
      id: "reminder-unrelated-email-source",
      workspaceId: defaultWorkspaceId,
      userId: "user-admin",
      kind: "follow_up",
      priority: "medium",
      title: "Keep unrelated reminder",
      status: "open",
      sources: [{ label: "Other thread", threadId: promo.threadId }],
      score: 70,
      idempotencyKey: "reminder-unrelated-email-source",
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z"
    }
  );
  const reminderStore = new CrmStore(snapshotWithReminders);
  const reminderContext = reminderStore.getContext("user-admin");
  reminderStore.deleteEmailThread(reminderContext, message.threadId);
  assert.throws(() => reminderStore.getEmailThread(reminderContext, message.threadId), /Email thread not found/);
  assert.throws(() => reminderStore.listEmailMessages(reminderContext, message.threadId), /Email thread not found/);
  const remainingReminderIds = new Set((reminderStore.snapshot().smartReminders ?? []).map((reminder) => reminder.id));
  assert.equal(remainingReminderIds.has("reminder-email-thread-source"), false);
  assert.equal(remainingReminderIds.has("reminder-email-message-source"), false);
  assert.equal(remainingReminderIds.has("reminder-unrelated-email-source"), true);
});

await run("email threads respect record visibility and unlinked ownership", () => {
  const snapshot = structuredClone(seedData);
  snapshot.teams.push({ id: "team-enterprise-email", workspaceId: defaultWorkspaceId, name: "Enterprise Email" });
  snapshot.users.push({
    id: "user-email-other",
    workspaceId: defaultWorkspaceId,
    email: "email-other@example.com",
    name: "Email Other Sales",
    roleId: "role-sales",
    teamId: "team-enterprise-email"
  });
  snapshot.records.push({
    id: "contact-email-hidden",
    workspaceId: defaultWorkspaceId,
    objectKey: "contacts",
    title: "Hidden Email Contact",
    ownerId: "user-email-other",
    data: { email: "hidden-email@example.com" },
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z"
  });
  const store = new CrmStore(snapshot);
  const adminContext = store.getContext("user-admin");
  const salesContext = store.getContext("user-sales");
  const account = store.createEmailAccount(adminContext, {
    name: "Visibility Inbox",
    emailAddress: "visibility@example.com",
    provider: "smtp_imap",
    syncEnabled: true,
    sendEnabled: true,
    status: "active"
  });

  const visibleLinked = store.recordEmailMessage(adminContext, {
    accountId: account.id,
    direction: "inbound",
    from: "lin@example.com",
    to: ["visibility@example.com"],
    subject: "Visible contact thread",
    bodyText: "Thread linked to the sales user's contact.",
    recordId: "contact-lin"
  });
  const hiddenUnlinked = store.recordEmailMessage(adminContext, {
    accountId: account.id,
    direction: "inbound",
    from: "unknown@example.com",
    to: ["visibility@example.com"],
    subject: "Unlinked shared inbound",
    bodyText: "This unlinked shared mailbox thread should stay admin-only."
  });
  const hiddenLinkedOwnMessage = store.recordEmailMessage(adminContext, {
    accountId: account.id,
    direction: "outbound",
    from: "visibility@example.com",
    to: ["hidden-email@example.com"],
    subject: "Hidden linked outbound",
    bodyText: "Created by the sales user but linked to a hidden CRM record.",
    recordId: "contact-email-hidden",
    createdById: "user-sales"
  });
  const ownUnlinked = store.queueEmailMessage(salesContext, {
    accountId: account.id,
    to: ["prospect@example.com"],
    subject: "Own unlinked outbound",
    bodyText: "Sales user started this unlinked outbound thread."
  });

  const adminThreadIds = store.listEmailThreads(adminContext).map((thread) => thread.id);
  const salesThreadIds = store.listEmailThreads(salesContext).map((thread) => thread.id);

  assert.equal(adminThreadIds.includes(visibleLinked.threadId), true);
  assert.equal(adminThreadIds.includes(hiddenUnlinked.threadId), true);
  assert.equal(adminThreadIds.includes(hiddenLinkedOwnMessage.threadId), true);
  assert.equal(adminThreadIds.includes(ownUnlinked.threadId), true);
  assert.equal(salesThreadIds.includes(visibleLinked.threadId), true);
  assert.equal(salesThreadIds.includes(hiddenUnlinked.threadId), false);
  assert.equal(salesThreadIds.includes(hiddenLinkedOwnMessage.threadId), false);
  assert.equal(salesThreadIds.includes(ownUnlinked.threadId), true);
  assert.equal(store.getEmailThread(salesContext, visibleLinked.threadId).id, visibleLinked.threadId);
  assert.equal(store.getEmailThread(salesContext, ownUnlinked.threadId).id, ownUnlinked.threadId);
  assert.throws(() => store.getEmailThread(salesContext, hiddenUnlinked.threadId), /Email thread not found/);
  assert.throws(() => store.getEmailThread(salesContext, hiddenLinkedOwnMessage.threadId), /Email thread not found/);
  assert.throws(() => store.listEmailMessages(salesContext, hiddenUnlinked.threadId), /Email thread not found/);
  assert.throws(() => store.listEmailMessages(salesContext, hiddenLinkedOwnMessage.threadId), /Email thread not found/);
  assert.equal(store.listEmailMessages(salesContext, ownUnlinked.threadId)[0].id, ownUnlinked.id);
});

await run("email threads can be relinked to visible records for ai context", () => {
  assert.equal(emailThreadUpdateSchema.safeParse({ recordId: "contact-lin" }).success, true);
  assert.equal(emailThreadUpdateSchema.safeParse({ recordId: "" }).success, true);
  assert.equal(emailThreadUpdateSchema.safeParse({ recordId: null }).success, true);

  const snapshot = structuredClone(seedData);
  snapshot.teams.push({ id: "team-thread-hidden", workspaceId: defaultWorkspaceId, name: "Thread Hidden Team" });
  snapshot.users.push({
    id: "user-thread-hidden",
    workspaceId: defaultWorkspaceId,
    email: "thread-hidden@example.com",
    name: "Thread Hidden Owner",
    roleId: "role-sales",
    teamId: "team-thread-hidden"
  });
  snapshot.records.push({
    id: "contact-thread-hidden",
    workspaceId: defaultWorkspaceId,
    objectKey: "contacts",
    title: "Hidden Thread Contact",
    ownerId: "user-thread-hidden",
    data: { email: "hidden-thread@example.com" },
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z"
  });
  const store = new CrmStore(snapshot);
  const adminContext = store.getContext("user-admin");
  const salesContext = store.getContext("user-sales");
  const account = store.createEmailAccount(adminContext, {
    name: "Relink Inbox",
    emailAddress: "relink@example.com",
    provider: "smtp_imap",
    syncEnabled: true,
    sendEnabled: true,
    status: "active"
  });
  const message = store.recordEmailMessage(salesContext, {
    accountId: account.id,
    direction: "inbound",
    from: "unknown-relink@example.com",
    to: ["relink@example.com"],
    subject: "Manual customer link",
    bodyText: "Please connect this thread to the right customer."
  });

  assert.equal(store.getEmailThread(salesContext, message.threadId).recordId, undefined);
  const linked = store.updateEmailThread(salesContext, message.threadId, { recordId: "contact-lin" });
  assert.equal(linked.recordId, "contact-lin");

  store.updateEmailAiSettings(adminContext, { features: { draft: true } });
  const context = store.buildEmailAssistantContext(salesContext, { purpose: "draft", threadId: message.threadId });
  assert.equal(context.recordId, "contact-lin");
  assert.match(context.customerBrief, /林晓|lin@example\.com/);
  assert.equal(context.sources.some((source) => source.recordId === "contact-lin"), true);
  assert.throws(() => store.updateEmailThread(salesContext, message.threadId, { recordId: "contact-thread-hidden" }), /not found|不存在/i);

  const unlinked = store.updateEmailThread(salesContext, message.threadId, { recordId: null });
  assert.equal(unlinked.recordId, undefined);
});

await run("email accounts can be updated and safely disabled when history exists", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Rotating Inbox",
    emailAddress: "rotate@example.com",
    provider: "smtp_imap",
    syncEnabled: true,
    sendEnabled: true,
    status: "draft"
  });

  const active = store.updateEmailAccount(context, account.id, {
    name: "Rotated Inbox",
    connectionConfig: { smtpHost: "smtp.example.com", smtpPort: 465, smtpSecure: true, username: "rotate@example.com", password: "app-password" }
  });
  assert.equal(active.name, "Rotated Inbox");
  assert.equal(active.status, "active");
  assert.equal(active.connectionConfigured, true);

  const disabled = store.updateEmailAccount(context, account.id, { status: "disabled", syncEnabled: false, sendEnabled: false });
  assert.equal(disabled.status, "disabled");
  assert.equal(disabled.syncEnabled, false);
  assert.equal(disabled.sendEnabled, false);

  store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "buyer@example.com",
    to: ["rotate@example.com"],
    subject: "Keep history",
    bodyText: "Do not delete the account because history exists."
  });
  store.deleteEmailAccount(context, account.id);
  const retained = store.getEmailAccount(context, account.id);
  assert.equal(retained.status, "disabled");
  assert.equal(retained.syncEnabled, false);
  assert.equal(retained.sendEnabled, false);
});

await run("email accounts support per-sender default signature presets", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Signature Inbox",
    emailAddress: "signature@example.com",
    provider: "smtp_imap",
    status: "active",
    sendEnabled: true
  });
  const otherAccount = store.createEmailAccount(context, {
    name: "Other Signature Inbox",
    emailAddress: "other-signature@example.com",
    provider: "smtp_imap",
    status: "active",
    sendEnabled: true
  });
  const globalSignature = store.createEmailSignature(context, {
    name: "Global Signature",
    bodyText: "Regards,\n{{senderEmail}}",
    active: true
  });
  const accountSignature = store.createEmailSignature(context, {
    accountId: account.id,
    name: "Account Signature",
    bodyText: "Account regards",
    active: true
  });
  const otherAccountSignature = store.createEmailSignature(context, {
    accountId: otherAccount.id,
    name: "Other Account Signature",
    bodyText: "Other regards",
    active: true
  });

  assert.equal(store.updateEmailAccount(context, account.id, { defaultSignatureId: globalSignature.id }).defaultSignatureId, globalSignature.id);
  assert.equal(store.updateEmailAccount(context, account.id, { defaultSignatureId: accountSignature.id }).defaultSignatureId, accountSignature.id);
  assert.throws(
    () => store.updateEmailAccount(context, account.id, { defaultSignatureId: otherAccountSignature.id }),
    /global or belong to this account/
  );
  assert.equal(store.updateEmailAccount(context, account.id, { defaultSignatureId: null }).defaultSignatureId, undefined);
  store.updateEmailAccount(context, account.id, { defaultSignatureId: accountSignature.id });
  store.updateEmailSignature(context, accountSignature.id, { active: false });
  assert.equal(store.getEmailAccount(context, account.id).defaultSignatureId, undefined);
  store.updateEmailAccount(context, account.id, { defaultSignatureId: globalSignature.id });
  store.deleteEmailSignature(context, globalSignature.id);
  assert.equal(store.getEmailAccount(context, account.id).defaultSignatureId, undefined);
});

await run("email account addresses are unique per workspace before database constraints", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const first = store.createEmailAccount(context, {
    name: "Primary Inbox",
    emailAddress: "unique-mailbox@example.com",
    provider: "smtp_imap",
    status: "draft"
  });
  const second = store.createEmailAccount(context, {
    name: "Secondary Inbox",
    emailAddress: "secondary-mailbox@example.com",
    provider: "smtp_imap",
    status: "draft"
  });

  assert.throws(
    () =>
      store.createEmailAccount(context, {
        name: "Duplicate Inbox",
        emailAddress: "UNIQUE-MAILBOX@example.com",
        provider: "gmail",
        status: "draft"
      }),
    /already exists/
  );
  assert.throws(
    () => store.updateEmailAccount(context, second.id, { emailAddress: "Unique-Mailbox@example.com" }),
    /already exists/
  );
  assert.equal(store.getEmailAccount(context, first.id).emailAddress, "unique-mailbox@example.com");
  assert.equal(store.getEmailAccount(context, second.id).emailAddress, "secondary-mailbox@example.com");
});

await run("oauth mailbox connection updates an existing account for token rotation", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const existing = store.createEmailAccount(context, {
    name: "Old Gmail",
    emailAddress: "oauth-rotate@example.com",
    provider: "gmail",
    syncEnabled: false,
    sendEnabled: false,
    status: "error"
  });

  const result = await connectOAuthEmailAccount(context, store, {
    provider: "gmail",
    name: "Rotated Gmail",
    emailAddress: "OAUTH-ROTATE@example.com",
    syncEnabled: true,
    sendEnabled: true,
    connectionConfig: {
      oauthProvider: "gmail",
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      expiresAt: "2099-06-20T12:00:00.000Z"
    }
  });
  const accounts = store.listEmailAccounts(context).filter((account) => account.emailAddress === "oauth-rotate@example.com");

  assert.equal(result.created, false);
  assert.equal(result.account.id, existing.id);
  assert.equal(result.account.name, "Rotated Gmail");
  assert.equal(result.account.status, "active");
  assert.equal(result.account.connectionConfigured, true);
  assert.equal(result.account.syncEnabled, true);
  assert.equal(result.account.sendEnabled, true);
  assert.equal(accounts.length, 1);
});

await run("oauth mailbox callback redirect returns admins to the crm workspace", () => {
  const result = buildOAuthEmailConnectedRedirectUrl("https://crm.example.com/api/email/oauth/callback", {
    created: false,
    account: {
      id: "email-account-oauth",
      workspaceId: defaultWorkspaceId,
      name: "OAuth Inbox",
      emailAddress: "oauth@example.com",
      provider: "gmail",
      status: "active",
      syncEnabled: true,
      sendEnabled: true,
      connectionConfigured: true,
      createdById: "user-admin",
      createdAt: "2026-06-20T10:00:00.000Z",
      updatedAt: "2026-06-20T10:00:00.000Z"
    }
  });
  const failed = buildOAuthEmailErrorRedirectUrl("https://crm.example.com/api/email/oauth/callback", new Error("access_denied"));

  assert.equal(result.toString(), "https://crm.example.com/?emailOAuth=connected&emailAccountId=email-account-oauth&emailAccountCreated=false");
  assert.equal(failed.toString(), "https://crm.example.com/?emailOAuth=error&emailOAuthError=access_denied");
});

await run("oauth mailbox connected notice parses browser callback query", () => {
  const created = readEmailOAuthConnectedNotice("?emailOAuth=connected&emailAccountId=account-created&emailAccountCreated=true");
  const updated = readEmailOAuthConnectedNotice("emailOAuth=connected&emailAccountId=account-updated&emailAccountCreated=false");
  const callbackCreated = readEmailOAuthCallbackNotice("?emailOAuth=connected&emailAccountId=account-created&emailAccountCreated=true");
  const callbackFailed = readEmailOAuthCallbackNotice("?emailOAuth=error&emailOAuthError=access_denied");

  assert.equal(created?.accountId, "account-created");
  assert.equal(created?.status, "connected");
  assert.equal(created?.created, true);
  assert.match(created?.message ?? "", /已创建/);
  assert.equal(updated?.accountId, "account-updated");
  assert.equal(updated?.created, false);
  assert.match(updated?.message ?? "", /已更新/);
  assert.equal(callbackCreated?.status, "connected");
  assert.equal(callbackFailed?.status, "error");
  assert.match(callbackFailed?.message ?? "", /access_denied/);
  assert.equal(readEmailOAuthConnectedNotice("?emailOAuth=cancelled&emailAccountId=account"), undefined);
  assert.equal(readEmailOAuthConnectedNotice("?emailOAuth=connected"), undefined);
  assert.equal(readEmailOAuthCallbackNotice("?emailOAuth=cancelled&emailAccountId=account"), undefined);
});

await run("sales users can view configured email accounts but cannot manage them", () => {
  const store = new CrmStore();
  const adminContext = store.getContext("user-admin");
  const salesContext = store.getContext("user-sales");
  const account = store.createEmailAccount(adminContext, {
    name: "Shared Sales Inbox",
    emailAddress: "shared-sales@example.com",
    provider: "custom",
    syncEnabled: false,
    sendEnabled: true,
    status: "active"
  });

  const visibleAccount = store.listEmailAccounts(salesContext).find((candidate) => candidate.id === account.id);
  const readableAccount = store.getEmailAccount(salesContext, account.id);
  assert.equal(visibleAccount?.emailAddress, "shared-sales@example.com");
  assert.equal(visibleAccount?.connectionConfigured, false);
  assert.equal(readableAccount.emailAddress, "shared-sales@example.com");
  assert.equal("connectionConfig" in readableAccount, false);
  assert.throws(() => store.createEmailAccount(salesContext, { name: "Blocked", emailAddress: "blocked@example.com", provider: "custom" }), /crm\.admin/);
  assert.throws(() => store.updateEmailAccount(salesContext, account.id, { status: "disabled" }), /crm\.admin/);
  assert.throws(() => store.deleteEmailAccount(salesContext, account.id), /crm\.admin/);
});

await run("email account connection status changes are audited without duplicate noise", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Observed Inbox",
    emailAddress: "observed@example.com",
    provider: "smtp_imap",
    status: "active",
    syncEnabled: true,
    sendEnabled: true
  });
  const before = store.listAuditLogs(context, { entityType: "email_account" }).length;

  const failed = store.markEmailAccountConnectionError(context, account.id, "SMTP 535 authentication failed");
  assert.equal(failed.status, "error");
  assert.equal(failed.lastConnectionError, "SMTP 535 authentication failed");
  const afterFailure = store.listAuditLogs(context, { entityType: "email_account" });
  assert.equal(afterFailure.length, before + 1);
  const failureLog = afterFailure.find((log) => /connection failed/.test(log.summary));
  assert.equal(Boolean(failureLog), true);
  assert.equal(failureLog.details.error, "SMTP 535 authentication failed");

  store.markEmailAccountConnectionError(context, account.id, "SMTP 535 authentication failed");
  assert.equal(store.listAuditLogs(context, { entityType: "email_account" }).length, before + 1);

  const restored = store.markEmailAccountConnectionError(context, account.id, null);
  assert.equal(restored.status, "active");
  assert.equal(restored.lastConnectionError, undefined);
  const afterRestore = store.listAuditLogs(context, { entityType: "email_account" });
  assert.equal(afterRestore.length, before + 2);
  const restoreLog = afterRestore.find((log) => /connection restored/.test(log.summary));
  assert.equal(Boolean(restoreLog), true);
  assert.equal(restoreLog.details.previousError, "SMTP 535 authentication failed");
});

await run("email message recording is idempotent per account external message id", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const firstAccount = store.createEmailAccount(context, {
    name: "Dedupe One",
    emailAddress: "dedupe-one@example.com",
    provider: "custom",
    status: "active",
    syncEnabled: true
  });
  const secondAccount = store.createEmailAccount(context, {
    name: "Dedupe Two",
    emailAddress: "dedupe-two@example.com",
    provider: "custom",
    status: "active",
    syncEnabled: true
  });
  const first = store.recordEmailMessage(context, {
    accountId: firstAccount.id,
    direction: "inbound",
    from: "buyer@example.com",
    to: [firstAccount.emailAddress],
    subject: "Provider message",
    bodyText: "Imported once.",
    externalMessageId: "provider-message-id"
  });
  const repeated = store.recordEmailMessage(context, {
    accountId: firstAccount.id,
    direction: "inbound",
    from: "buyer@example.com",
    to: [firstAccount.emailAddress],
    subject: "Provider message",
    bodyText: "Imported twice.",
    externalMessageId: "provider-message-id"
  });
  const otherAccount = store.recordEmailMessage(context, {
    accountId: secondAccount.id,
    direction: "inbound",
    from: "buyer@example.com",
    to: [secondAccount.emailAddress],
    subject: "Provider message",
    bodyText: "Same external id in another mailbox.",
    externalMessageId: "provider-message-id"
  });

  assert.equal(repeated.id, first.id);
  assert.equal(store.findEmailMessageByExternalId(context, firstAccount.id, "provider-message-id")?.id, first.id);
  assert.equal(store.listEmailMessages(context, first.threadId).length, 1);
  assert.notEqual(otherAccount.id, first.id);
});

await run("email sync skips externally deleted messages after local thread deletion", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Deleted Sync Inbox",
    emailAddress: "deleted-sync@example.com",
    provider: "custom",
    status: "active",
    syncEnabled: true
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "buyer@example.com",
    to: [account.emailAddress],
    subject: "Do not reimport",
    bodyText: "This was deleted locally.",
    externalMessageId: "provider-deleted-message-id"
  });

  store.deleteEmailThread(context, message.threadId);
  assert.equal(store.isEmailExternalMessageDeleted(context, account.id, "provider-deleted-message-id"), true);

  const adapter = createEmailProviderAdapter(store);
  const result = await adapter.importInboundMessages(context, account, [
    {
      from: "buyer@example.com",
      to: [account.emailAddress],
      cc: [],
      subject: "Do not reimport",
      bodyText: "The provider still has this message.",
      externalMessageId: "provider-deleted-message-id",
      receivedAt: "2026-07-08T07:30:00.000Z"
    }
  ]);

  assert.equal(result.importedCount, 0);
  assert.equal(result.skippedDuplicateCount, 1);
  assert.equal(store.listEmailThreads(context).some((thread) => thread.subject === "Do not reimport"), false);
});

await run("email full resync reimports locally deleted provider messages", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Full Deleted Sync Inbox",
    emailAddress: "full-deleted-sync@example.com",
    provider: "custom",
    status: "active",
    syncEnabled: true
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "buyer@example.com",
    to: [account.emailAddress],
    subject: "Reimport on full sync",
    bodyText: "This was deleted locally.",
    externalMessageId: "provider-full-deleted-message-id"
  });

  store.deleteEmailThread(context, message.threadId);
  assert.equal(store.isEmailExternalMessageDeleted(context, account.id, "provider-full-deleted-message-id"), true);

  const adapter = createEmailProviderAdapter(store);
  const result = await adapter.importInboundMessages(
    context,
    account,
    [
      {
        from: "buyer@example.com",
        to: [account.emailAddress],
        cc: [],
        subject: "Reimport on full sync",
        bodyText: "The provider still has this message.",
        externalMessageId: "provider-full-deleted-message-id",
        receivedAt: "2026-07-08T07:30:00.000Z"
      }
    ],
    { fullResync: true }
  );

  assert.equal(result.importedCount, 1);
  assert.equal(result.skippedDuplicateCount, 0);
  assert.equal(store.listEmailThreads(context).some((thread) => thread.subject === "Reimport on full sync" && !thread.deleted), true);
});

await run("email full resync restores hidden duplicate threads to the inbox", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Full Hidden Duplicate Inbox",
    emailAddress: "full-hidden-duplicate@example.com",
    provider: "custom",
    status: "active",
    syncEnabled: true
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "buyer@example.com",
    to: [account.emailAddress],
    subject: "Restore hidden duplicate",
    bodyText: "Already imported.",
    externalMessageId: "provider-hidden-duplicate-message-id"
  });
  store.updateEmailThreadState(context, message.threadId, { archived: true, deleted: true });

  const adapter = createEmailProviderAdapter(store);
  const result = await adapter.importInboundMessages(
    context,
    account,
    [
      {
        from: "buyer@example.com",
        to: [account.emailAddress],
        cc: [],
        subject: "Restore hidden duplicate",
        bodyText: "Already imported.",
        externalMessageId: "provider-hidden-duplicate-message-id",
        receivedAt: "2026-07-08T07:30:00.000Z"
      }
    ],
    { fullResync: true }
  );

  const restored = store.listEmailThreads(context).find((thread) => thread.id === message.threadId);
  assert.equal(result.importedCount, 0);
  assert.equal(result.skippedDuplicateCount, 1);
  assert.equal(restored?.archived, false);
  assert.equal(restored?.deleted, false);
});

await run("email messages auto-link to contacts by participant email unless explicitly linked", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Auto Link Inbox",
    emailAddress: "sales@example.com",
    provider: "smtp_imap",
    syncEnabled: true,
    sendEnabled: true,
    status: "active"
  });

  const autoLinked = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "lin@example.com",
    to: ["sales@example.com"],
    subject: "Auto link by email",
    bodyText: "Please connect this to the contact automatically."
  });
  assert.equal(store.listEmailThreads(context, "contact-lin").some((thread) => thread.id === autoLinked.threadId), true);
  assert.equal(store.listActivities(context, "contact-lin").some((activity) => activity.title === "Auto link by email"), true);

  const explicit = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "lin@example.com",
    to: ["sales@example.com"],
    subject: "Explicit deal link",
    bodyText: "This message should stay on the deal.",
    recordId: "deal-platform"
  });
  assert.equal(store.listEmailThreads(context, "deal-platform").some((thread) => thread.id === explicit.threadId), true);
  assert.equal(store.listEmailThreads(context, "contact-lin").some((thread) => thread.id === explicit.threadId), false);

  const unlinked = store.queueEmailMessage(context, {
    accountId: account.id,
    to: ["lin@example.com"],
    subject: "Do not link",
    bodyText: "The user explicitly selected no linked record.",
    skipAutoLink: true
  });
  assert.equal(store.listEmailThreads(context, "contact-lin").some((thread) => thread.id === unlinked.threadId), false);
});

await run("email thread search command parser recognizes supported filters", () => {
  assert.deepEqual(parseEmailThreadSearchCommand("/company:Acme China"), { type: "company", value: "Acme China" });
  assert.deepEqual(parseEmailThreadSearchCommand("/contact:lin@example.com"), { type: "contact", value: "lin@example.com" });
  assert.deepEqual(parseEmailThreadSearchCommand("/deal:平台私有化"), { type: "deal", value: "平台私有化" });
  assert.equal(parseEmailThreadSearchCommand(""), undefined);
  assert.equal(parseEmailThreadSearchCommand("/unknown:Acme"), undefined);
  assert.equal(parseEmailThreadSearchCommand("ordinary email search"), undefined);
});

await run("email thread command search filters by contact company and deal company", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Command Search Inbox",
    emailAddress: "command-search@example.com",
    provider: "smtp_imap",
    syncEnabled: true,
    sendEnabled: true,
    status: "active"
  });

  const contactMessage = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "lin@example.com",
    to: [account.emailAddress],
    subject: "Contact command match",
    bodyText: "This should match the Lin contact by participant email."
  });
  const companyMessage = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "unknown-company@example.com",
    to: [account.emailAddress],
    subject: "Company direct record match",
    bodyText: "This should match the Acme company by record id.",
    recordId: "company-acme"
  });
  const dealMessage = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "unknown-deal@example.com",
    to: [account.emailAddress],
    subject: "Deal direct record match",
    bodyText: "This should match the deal by record id.",
    recordId: "deal-platform"
  });
  const unrelatedMessage = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "unrelated@example.com",
    to: [account.emailAddress],
    subject: "Unrelated command miss",
    bodyText: "This should not match command searches.",
    skipAutoLink: true
  });

  const contactThreadIds = new Set(store.listEmailThreads(context, { command: { type: "contact", value: "lin@example.com" } }).map((thread) => thread.id));
  assert.equal(contactThreadIds.has(contactMessage.threadId), true);
  assert.equal(contactThreadIds.has(unrelatedMessage.threadId), false);

  const companyThreadIds = new Set(store.listEmailThreads(context, { command: { type: "company", value: "Acme" } }).map((thread) => thread.id));
  assert.equal(companyThreadIds.has(contactMessage.threadId), true);
  assert.equal(companyThreadIds.has(companyMessage.threadId), true);
  assert.equal(companyThreadIds.has(unrelatedMessage.threadId), false);

  const dealThreadIds = new Set(store.listEmailThreads(context, { command: { type: "deal", value: "平台" } }).map((thread) => thread.id));
  assert.equal(dealThreadIds.has(contactMessage.threadId), true);
  assert.equal(dealThreadIds.has(companyMessage.threadId), true);
  assert.equal(dealThreadIds.has(dealMessage.threadId), true);
  assert.equal(dealThreadIds.has(unrelatedMessage.threadId), false);

  assert.equal(store.listEmailThreads(context, { command: { type: "company", value: "No Such Company" } }).length, 0);
});

await run("email messages without explicit thread id join matching conversation threads conservatively", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Threading Inbox",
    emailAddress: "sales@example.com",
    provider: "custom",
    syncEnabled: true,
    sendEnabled: true,
    status: "active"
  });

  const first = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "lin@example.com",
    to: ["sales@example.com"],
    subject: "Deployment plan",
    bodyText: "Can you send the private deployment plan?"
  });
  const reply = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "outbound",
    from: "sales@example.com",
    to: ["lin@example.com"],
    subject: "Re: Deployment plan",
    bodyText: "Here is the plan."
  });
  const unrelated = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "other@example.com",
    to: ["sales@example.com"],
    subject: "Re: Deployment plan",
    bodyText: "Different participant should not be merged by subject alone."
  });

  assert.equal(reply.threadId, first.threadId);
  assert.notEqual(unrelated.threadId, first.threadId);
  assert.equal(store.listEmailMessages(context, first.threadId).length, 2);
});

await run("email threading ignores stale invalid participant addresses from historical data", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Legacy Thread Inbox",
    emailAddress: "sales@example.com",
    provider: "custom",
    syncEnabled: true,
    sendEnabled: true,
    status: "active"
  });

  const first = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "lin@example.com",
    to: ["sales@example.com"],
    subject: "Legacy address cleanup",
    bodyText: "Please review this thread."
  });

  const snapshot = store.snapshot();
  const staleThread = snapshot.emailThreads?.find((thread) => thread.id === first.threadId);
  assert.ok(staleThread);
  staleThread.participantEmails = ["lin@example.com", "sales@example.com", "undisclosed-recipients:;"];

  const restored = new CrmStore(snapshot);
  const restoredContext = restored.getContext("user-admin");
  const reply = restored.recordEmailMessage(restoredContext, {
    accountId: account.id,
    direction: "outbound",
    from: "sales@example.com",
    to: ["lin@example.com"],
    subject: "Re: Legacy address cleanup",
    bodyText: "This should still join the thread."
  });

  assert.equal(reply.threadId, first.threadId);
  const cleanedThread = restored.snapshot().emailThreads?.find((thread) => thread.id === first.threadId);
  assert.deepEqual(cleanedThread?.participantEmails.sort(), ["lin@example.com", "sales@example.com"]);
});

await run("email reply draft pre-fills recipients subject and linked record conservatively", () => {
  const inboundReply = buildEmailReplyDraft({
    accountEmail: "sales@example.com",
    recordId: "contact-lin",
    message: {
      accountId: "email-account",
      threadId: "thread-inbound-reply",
      direction: "inbound",
      from: "Buyer@Example.com",
      to: ["sales@example.com"],
      cc: ["sales@example.com", "manager@example.com"],
      subject: "Deployment plan",
      bodyText: "Can you send the deployment plan?"
    }
  });
  const outboundReply = buildEmailReplyDraft({
    accountEmail: "sales@example.com",
    message: {
      accountId: "email-account",
      threadId: "thread-outbound-reply",
      direction: "outbound",
      from: "sales@example.com",
      to: ["buyer@example.com", "sales@example.com"],
      cc: ["manager@example.com"],
      subject: "Re: Deployment plan",
      bodyText: "Here is the deployment plan."
    }
  });

  assert.equal(inboundReply.accountId, "email-account");
  assert.equal(inboundReply.threadId, "thread-inbound-reply");
  assert.equal(inboundReply.recordId, "contact-lin");
  assert.equal(inboundReply.to, "buyer@example.com, manager@example.com");
  assert.equal(inboundReply.subject, "Re: Deployment plan");
  assert.equal(inboundReply.bodyText, "");
  assert.equal(outboundReply.to, "buyer@example.com, manager@example.com");
  assert.equal(outboundReply.threadId, "thread-outbound-reply");
  assert.equal(outboundReply.subject, "Re: Deployment plan");
});

await run("queued outbound email messages preserve cc and bcc recipients", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Recipient Inbox",
    emailAddress: "sales@example.com",
    provider: "smtp_imap",
    syncEnabled: false,
    sendEnabled: true,
    status: "active"
  });

  const message = store.queueEmailMessage(context, {
    accountId: account.id,
    to: ["buyer@example.com"],
    cc: ["manager@example.com"],
    bcc: ["archive@example.com"],
    subject: "Recipient coverage",
    bodyText: "Keep all recipient classes."
  });

  assert.deepEqual(message.to, ["buyer@example.com"]);
  assert.deepEqual(message.cc, ["manager@example.com"]);
  assert.deepEqual(message.bcc, ["archive@example.com"]);
  assert.equal(store.listEmailMessages(context, message.threadId)[0].cc?.[0], "manager@example.com");
  assert.equal(store.listEmailMessages(context, message.threadId)[0].bcc?.[0], "archive@example.com");

  const errorAccount = store.markEmailAccountConnectionError(context, account.id, "Previous transient SMTP error");
  assert.equal(errorAccount.status, "error");
  const queuedAfterError = store.queueEmailMessage(context, {
    accountId: account.id,
    to: ["buyer2@example.com"],
    subject: "Retry after transient error",
    bodyText: "The account is configured and not disabled, so it remains selectable for sending."
  });
  assert.equal(queuedAfterError.status, "queued");
});

await run("queued outbound email messages are idempotent by client request id", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Idempotent Outbox",
    emailAddress: "sales@example.com",
    provider: "smtp_imap",
    syncEnabled: false,
    sendEnabled: true,
    status: "active"
  });

  const first = store.queueEmailMessage(context, {
    accountId: account.id,
    to: ["buyer@example.com"],
    subject: "Idempotent send",
    bodyText: "First request body.",
    clientRequestId: "send-request-123"
  });
  const repeated = store.queueEmailMessage(context, {
    accountId: account.id,
    to: ["buyer@example.com"],
    subject: "Idempotent send duplicate",
    bodyText: "Second request body should not create another message.",
    clientRequestId: "send-request-123"
  });

  assert.equal(repeated.id, first.id);
  assert.equal(repeated.subject, "Idempotent send");
  assert.equal(repeated.clientRequestId, "send-request-123");
  assert.equal(store.listEmailMessages(context, first.threadId).filter((message) => message.clientRequestId === "send-request-123").length, 1);
});

await run("sending outbound email claims are reclaimed only after the timeout", () => {
  const previousTimeout = process.env.EMAIL_SEND_CLAIM_TIMEOUT_MS;
  process.env.EMAIL_SEND_CLAIM_TIMEOUT_MS = "60000";
  try {
    const store = new CrmStore();
    const context = store.getContext("user-admin");
    const account = store.createEmailAccount(context, {
      name: "Claim Timeout Inbox",
      emailAddress: "claim-timeout@example.com",
      provider: "smtp_imap",
      syncEnabled: false,
      sendEnabled: true,
      status: "active"
    });
    const freshSending = store.recordEmailMessage(context, {
      accountId: account.id,
      direction: "outbound",
      from: account.emailAddress,
      to: ["buyer@example.com"],
      subject: "Fresh sending",
      bodyText: "Still in progress.",
      status: "sending",
      sendAttemptedAt: new Date().toISOString()
    });
    const staleSending = store.recordEmailMessage(context, {
      accountId: account.id,
      direction: "outbound",
      from: account.emailAddress,
      to: ["buyer@example.com"],
      subject: "Stale sending",
      bodyText: "The previous worker crashed.",
      status: "sending",
      sendAttemptedAt: new Date(Date.now() - 120000).toISOString()
    });

    const freshClaim = store.claimEmailMessageForSending(context, freshSending.id);
    const staleClaim = store.claimEmailMessageForSending(context, staleSending.id);

    assert.equal(freshClaim.claimed, false);
    assert.equal(staleClaim.claimed, true);
    assert.equal(staleClaim.message.status, "sending");
    assert.notEqual(staleClaim.message.sendAttemptedAt, staleSending.sendAttemptedAt);
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.EMAIL_SEND_CLAIM_TIMEOUT_MS;
    } else {
      process.env.EMAIL_SEND_CLAIM_TIMEOUT_MS = previousTimeout;
    }
  }
});

await run("queued outbound email messages preserve structured attachments", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Attachment Inbox",
    emailAddress: "attach@example.com",
    provider: "smtp_imap",
    syncEnabled: false,
    sendEnabled: true,
    status: "active"
  });

  const message = store.queueEmailMessage(context, {
    accountId: account.id,
    to: ["buyer@example.com"],
    subject: "Attachment coverage",
    bodyText: "See attached.",
    attachments: [
      {
        fileName: "proposal.txt",
        contentType: "text/plain",
        size: 11,
        contentBase64: Buffer.from("hello world").toString("base64")
      }
    ]
  });

  assert.equal(message.attachments?.[0]?.fileName, "proposal.txt");
  assert.equal(message.attachments?.[0]?.contentType, "text/plain");
  assert.equal(store.listEmailMessages(context, message.threadId)[0].attachments?.[0]?.size, 11);
  assert.equal(store.listAuditLogs(context, { entityType: "email_message" }).find((log) => log.entityId === message.id)?.details.attachmentCount, 1);
});

await run("queued outbound email messages preserve ai provenance without storing generated content in audit details", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "AI Draft Inbox",
    emailAddress: "ai-draft@example.com",
    provider: "smtp_imap",
    syncEnabled: false,
    sendEnabled: true,
    status: "active"
  });
  const source = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "buyer@example.com",
    to: ["ai-draft@example.com"],
    subject: "Source email",
    bodyText: "Original customer context."
  });
  const article = store.createKnowledgeArticle(context, {
    title: "Onboarding source",
    body: "Use this article when drafting customer onboarding replies."
  });

  const message = store.queueEmailMessage(context, {
    accountId: account.id,
    to: ["buyer@example.com"],
    subject: "AI assisted follow-up",
    bodyText: "Generated draft body that must not be duplicated into audit details.",
    aiAssisted: true,
    aiPurpose: "draft",
    aiSourceMessageId: source.id,
    aiSources: [
      { label: "Source email", messageId: source.id },
      { label: "Knowledge: onboarding", knowledgeArticleId: article.id },
      { label: "" }
    ],
    aiGeneratedAt: "2026-06-20T12:00:00.000Z"
  });
  const audit = store.listAuditLogs(context, { entityType: "email_message" }).find((log) => log.entityId === message.id);

  assert.equal(message.aiAssisted, true);
  assert.equal(message.aiPurpose, "draft");
  assert.equal(message.aiSourceMessageId, source.id);
  assert.equal(message.aiSources?.length, 2);
  assert.equal(message.aiSources?.[0]?.messageId, source.id);
  assert.equal(message.aiSources?.[1]?.knowledgeArticleId, article.id);
  assert.equal(message.aiGeneratedAt, "2026-06-20T12:00:00.000Z");
  assert.equal(audit?.details.aiAssisted, true);
  assert.equal(audit?.details.aiPurpose, "draft");
  assert.equal(audit?.details.aiSourceMessageId, source.id);
  assert.equal(audit?.details.aiSourceCount, 2);
  assert.equal(JSON.stringify(audit?.details).includes("Generated draft body"), false);
});

await run("queued outbound email requires ai permission for ai provenance", () => {
  const store = new CrmStore();
  const adminContext = store.getContext("user-admin");
  const noAiContext = {
    workspaceId: defaultWorkspaceId,
    user: { ...seedData.users[1], id: "user-crm-write-no-ai" },
    role: { ...seedData.roles[1], permissions: ["crm.read", "crm.write"] }
  };
  const account = store.createEmailAccount(adminContext, {
    name: "AI Permission Inbox",
    emailAddress: "ai-permission@example.com",
    provider: "smtp_imap",
    syncEnabled: false,
    sendEnabled: true,
    status: "active"
  });
  const source = store.recordEmailMessage(noAiContext, {
    accountId: account.id,
    direction: "inbound",
    from: "buyer@example.com",
    to: [account.emailAddress],
    subject: "AI permission source",
    bodyText: "Visible source for provenance."
  });

  assert.throws(
    () =>
      store.queueEmailMessage(noAiContext, {
        accountId: account.id,
        to: ["buyer@example.com"],
        subject: "Forged AI provenance",
        bodyText: "This should not be accepted without ai.use.",
        aiAssisted: true,
        aiPurpose: "draft",
        aiSourceMessageId: source.id,
        aiSources: [{ label: "Source email", messageId: source.id }],
        aiGeneratedAt: "2026-06-20T12:05:00.000Z"
      }),
    /ai\.use/
  );
});

await run("queued outbound email requires visible ai sources when source links are enforced", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { requireSourceLinks: true });
  const account = store.createEmailAccount(context, {
    name: "AI Source Required Inbox",
    emailAddress: "ai-source-required@example.com",
    provider: "smtp_imap",
    sendEnabled: true,
    status: "active"
  });

  assert.throws(
    () =>
      store.queueEmailMessage(context, {
        accountId: account.id,
        to: ["buyer@example.com"],
        subject: "AI assisted without sources",
        bodyText: "This should not be queued without source references.",
        aiAssisted: true,
        aiPurpose: "draft",
        aiGeneratedAt: "2026-06-20T12:10:00.000Z"
      }),
    /requires at least one visible source/
  );
});

await run("queued outbound email restricts ai provenance to sendable purposes", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { requireSourceLinks: false });
  const account = store.createEmailAccount(context, {
    name: "AI Purpose Inbox",
    emailAddress: "ai-purpose@example.com",
    provider: "smtp_imap",
    sendEnabled: true,
    status: "active"
  });

  assert.throws(
    () =>
      store.queueEmailMessage(context, {
        accountId: account.id,
        to: ["buyer@example.com"],
        subject: "Missing AI purpose",
        bodyText: "This should not be queued without a provenance purpose.",
        aiAssisted: true
      }),
    /requires aiPurpose/
  );
  assert.throws(
    () =>
      store.queueEmailMessage(context, {
        accountId: account.id,
        to: ["buyer@example.com"],
        subject: "Analysis is not a sent body purpose",
        bodyText: "This should not be marked as context analysis output.",
        aiAssisted: true,
        aiPurpose: "context_analysis",
        aiGeneratedAt: "2026-06-20T12:15:00.000Z"
      }),
    /must be draft or translate/
  );
});

await run("queued outbound email requires ai generated timestamp for provenance", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { requireSourceLinks: false });
  const account = store.createEmailAccount(context, {
    name: "AI Timestamp Inbox",
    emailAddress: "ai-timestamp@example.com",
    provider: "smtp_imap",
    sendEnabled: true,
    status: "active"
  });

  assert.throws(
    () =>
      store.queueEmailMessage(context, {
        accountId: account.id,
        to: ["buyer@example.com"],
        subject: "Missing AI generated timestamp",
        bodyText: "This should not be queued without an AI generation timestamp.",
        aiAssisted: true,
        aiPurpose: "draft"
      }),
    /requires aiGeneratedAt/
  );
  assert.throws(
    () =>
      store.queueEmailMessage(context, {
        accountId: account.id,
        to: ["buyer@example.com"],
        subject: "Invalid AI generated timestamp",
        bodyText: "This should not be queued with an invalid AI generation timestamp.",
        aiAssisted: true,
        aiPurpose: "draft",
        aiGeneratedAt: "not-a-date"
      }),
    /requires aiGeneratedAt/
  );
});

await run("queued outbound email rejects forged ai source message provenance", () => {
  const snapshot = structuredClone(seedData);
  snapshot.teams.push({ id: "team-ai-source-hidden", workspaceId: defaultWorkspaceId, name: "AI Source Hidden" });
  snapshot.users.push({
    id: "user-ai-source-hidden",
    workspaceId: defaultWorkspaceId,
    email: "ai-source-hidden@example.com",
    name: "AI Source Hidden User",
    roleId: "role-sales",
    teamId: "team-ai-source-hidden"
  });
  snapshot.records.push({
    id: "contact-ai-source-hidden",
    workspaceId: defaultWorkspaceId,
    objectKey: "contacts",
    title: "Hidden AI Source Contact",
    ownerId: "user-ai-source-hidden",
    data: { email: "hidden-ai-source@example.com" },
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z"
  });
  const store = new CrmStore(snapshot);
  const context = store.getContext("user-admin");
  const salesContext = store.getContext("user-sales");
  const account = store.createEmailAccount(context, {
    name: "AI Spoof Inbox",
    emailAddress: "ai-spoof@example.com",
    provider: "smtp_imap",
    sendEnabled: true,
    status: "active"
  });
  const hiddenSource = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "hidden-ai-source@example.com",
    to: ["ai-spoof@example.com"],
    subject: "Hidden source email",
    bodyText: "This source email belongs to a hidden CRM record.",
    recordId: "contact-ai-source-hidden"
  });

  assert.throws(
    () =>
      store.queueEmailMessage(context, {
        accountId: account.id,
        to: ["buyer@example.com"],
        subject: "Forged AI source",
        bodyText: "This should not be queued with a forged provenance source.",
        aiAssisted: true,
        aiPurpose: "draft",
        aiSourceMessageId: "missing-source-message",
        aiSources: [{ label: "Missing source", messageId: "missing-source-message" }],
        aiGeneratedAt: "2026-06-20T12:20:00.000Z"
      }),
    /Email message not found/
  );
  assert.throws(
    () =>
      store.queueEmailMessage(salesContext, {
        accountId: account.id,
        to: ["buyer@example.com"],
        subject: "Hidden AI source",
        bodyText: "This should not be queued with an invisible provenance source.",
        aiAssisted: true,
        aiPurpose: "draft",
        aiSources: [{ label: "Hidden source", messageId: hiddenSource.id }],
        aiGeneratedAt: "2026-06-20T12:25:00.000Z"
      }),
    /Email thread not found/
  );
});

await run("email attachment hrefs cover stored provider external and unavailable content", () => {
  assert.equal(
    buildEmailAttachmentHref("message id", 0, { contentBase64: Buffer.from("hello").toString("base64") }),
    "/api/email/messages/message%20id/attachments/0"
  );
  assert.equal(
    buildEmailAttachmentHref("message-id", 2, { providerMessageId: "provider-message", providerAttachmentId: "provider-attachment" }),
    "/api/email/messages/message-id/attachments/2"
  );
  assert.equal(buildEmailAttachmentHref("message-id", 1, { externalUrl: "https://files.example.com/proposal.pdf" }), "https://files.example.com/proposal.pdf");
  assert.equal(buildEmailAttachmentHref("message-id", 1, { externalUrl: " http://files.example.com/proposal.pdf " }), "http://files.example.com/proposal.pdf");
  assert.equal(buildEmailAttachmentHref("message-id", 1, { externalUrl: "javascript:alert(1)" }), undefined);
  assert.equal(buildEmailAttachmentHref("message-id", 1, { externalUrl: "file:///C:/secret.txt" }), undefined);
  assert.equal(buildEmailAttachmentHref("message-id", 1, { externalUrl: "not a url" }), undefined);
  assert.equal(buildEmailAttachmentHref("message-id", 1, { providerAttachmentId: "provider-attachment" }), undefined);
});

await run("email attachment responses sanitize headers and enforce the attachment size cap", async () => {
  const response = buildEmailAttachmentResponse("报价\r\n.pdf", "text/plain; charset=utf-8", Buffer.from("hello world").toString("base64url"));

  assert.equal(await response.text(), "hello world");
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(response.headers.get("content-length"), "11");
  assert.match(response.headers.get("content-disposition") ?? "", /filename=".*\.pdf"/);
  assert.doesNotMatch(response.headers.get("content-disposition") ?? "", /[\r\n]/);
  assert.match(response.headers.get("content-disposition") ?? "", /filename\*=UTF-8''/);

  const sanitized = buildEmailAttachmentResponse("proposal.txt", "text/plain\r\nx-injected: yes", Buffer.from("safe").toString("base64"));
  assert.equal(sanitized.headers.get("content-type"), "application/octet-stream");

  const oversized = Buffer.alloc(MAX_EMAIL_ATTACHMENT_BYTES + 1, "a").toString("base64");
  assert.throws(() => buildEmailAttachmentResponse("large.bin", "application/octet-stream", oversized), /exceeds/);
  assert.throws(() => buildEmailAttachmentResponse("broken.bin", "application/octet-stream", "AA=A"), /valid base64/);
  assert.throws(() => buildEmailAttachmentResponse("broken.bin", "application/octet-stream", "not base64!"), /valid base64/);
});

await run("email ai source helpers expose only navigable references", () => {
  assert.equal(canOpenEmailAiSource({ recordId: "record-1" }), true);
  assert.equal(canOpenEmailAiSource({ activityId: "activity-1" }), true);
  assert.equal(canOpenEmailAiSource({ messageId: "message-1" }), true);
  assert.equal(canOpenEmailAiSource({ knowledgeArticleId: "knowledge-1" }), true);
  assert.equal(canOpenEmailAiSource({}), false);
  assert.equal(emailAiSourceKey({ label: "Contact source", recordId: "contact-1" }), "Contact source-contact-1");
  assert.equal(emailAiSourceKey({ label: "Knowledge source", knowledgeArticleId: "knowledge-1" }), "Knowledge source-knowledge-1");
});

await run("knowledge articles are admin managed and schema bounded", () => {
  const store = new CrmStore();
  const adminContext = store.getContext("user-admin");
  const salesContext = store.getContext("user-sales");
  const parsed = knowledgeArticleCreateSchema.parse({
    title: "Renewal policy",
    body: "Use the approved renewal discount ladder.",
    tags: ["renewal", "pricing"],
    active: true
  });
  const article = store.createKnowledgeArticle(adminContext, parsed);
  const updated = store.updateKnowledgeArticle(adminContext, article.id, knowledgeArticleUpdateSchema.parse({ tags: ["renewal", "approved"], active: false }));

  assert.equal(article.title, "Renewal policy");
  assert.deepEqual(updated.tags, ["renewal", "approved"]);
  assert.equal(updated.active, false);
  assert.equal(store.getKnowledgeArticle(adminContext, article.id).active, false);
  assert.equal(store.getKnowledgeArticle(salesContext, article.id).title, "Renewal policy");
  assert.equal(store.listKnowledgeArticles(adminContext, true).some((candidate) => candidate.id === article.id), false);
  assert.equal(store.listKnowledgeArticles(adminContext, false).some((candidate) => candidate.id === article.id), true);
  assert.throws(() => store.createKnowledgeArticle(salesContext, parsed), /crm\.admin/);
  assert.throws(() => store.updateKnowledgeArticle(salesContext, article.id, { active: true }), /crm\.admin/);
  assert.throws(() => knowledgeArticleCreateSchema.parse({ title: "Empty body", body: "" }), /String must contain/);
});

await run("email thread summaries can be refreshed and audited", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Summary mailbox",
    emailAddress: "summary@example.com",
    provider: "custom"
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "buyer@example.com",
    to: ["summary@example.com"],
    subject: "Long thread",
    bodyText: "The customer asked about deployment and pricing.",
    recordId: "contact-lin"
  });
  const updated = store.updateEmailThreadSummary(context, message.threadId, "Customer needs deployment and pricing follow-up.");

  assert.equal(updated.summary, "Customer needs deployment and pricing follow-up.");
  assert.match(updated.summaryUpdatedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(store.listAuditLogs(context, { entityType: "email_thread" }).some((log) => log.entityId === message.threadId), true);
});

await run("email thread analysis preserves source references", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Analysis source mailbox",
    emailAddress: "analysis-source@example.com",
    provider: "custom",
    status: "active",
    sendEnabled: true
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    status: "received",
    from: "buyer@example.com",
    to: [account.emailAddress],
    subject: "Analysis source",
    bodyText: "Need source-backed analysis.",
    recordId: "contact-lin"
  });
  const activity = store.listActivities(context, "contact-lin").find((candidate) => candidate.type === "email" && candidate.title === "Analysis source");
  assert.ok(activity);
  const article = store.createKnowledgeArticle(context, {
    title: "Analysis knowledge",
    body: "Use this source to explain current sales guidance."
  });
  const updated = store.updateEmailThreadAnalysis(context, message.threadId, "Source-backed recommendation.", [
    { label: "Lin", recordId: "contact-lin" },
    { label: "Message", messageId: message.id },
    { label: "Activity", activityId: activity?.id },
    { label: "Knowledge", knowledgeArticleId: article.id },
    { label: "  " }
  ]);
  const audit = store.listAuditLogs(context, { entityType: "email_thread" }).find((log) => log.entityId === message.threadId && /analysis/.test(log.summary));

  assert.equal(updated.aiAnalysis, "Source-backed recommendation.");
  assert.equal(updated.aiAnalysisSources?.length, 4);
  assert.equal(updated.aiAnalysisSources?.[0]?.recordId, "contact-lin");
  assert.equal(updated.aiAnalysisSources?.[1]?.messageId, message.id);
  assert.equal(updated.aiAnalysisSources?.[2]?.activityId, activity?.id);
  assert.equal(updated.aiAnalysisSources?.[3]?.knowledgeArticleId, article.id);
  assert.equal(audit?.details.sourceCount, 4);
});

await run("email message translation preserves source references", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Translation source mailbox",
    emailAddress: "translation-source@example.com",
    provider: "custom",
    status: "active",
    sendEnabled: true
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    status: "received",
    from: "buyer@example.com",
    to: [account.emailAddress],
    subject: "Translation source",
    bodyText: "Need source-backed translation.",
    recordId: "contact-lin"
  });
  const updated = store.updateEmailMessageTranslation(context, message.id, "Translated with sources.", "en-US", [
    { label: "Lin", recordId: "contact-lin" },
    { label: "Message", messageId: message.id },
    { label: "" }
  ]);
  const audit = store.listAuditLogs(context, { entityType: "email_message" }).find((log) => log.entityId === message.id && /Translated/.test(log.summary));

  assert.equal(updated.translatedBodyText, "Translated with sources.");
  assert.equal(updated.translatedSources?.length, 2);
  assert.equal(updated.translatedSources?.[0]?.recordId, "contact-lin");
  assert.equal(updated.translatedSources?.[1]?.messageId, message.id);
  assert.equal(audit?.details.sourceCount, 2);
});

await run("email ai persisted sources reject invalid references", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "Invalid AI source mailbox",
    emailAddress: "invalid-ai-source@example.com",
    provider: "custom",
    status: "active",
    sendEnabled: true
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    status: "received",
    from: "buyer@example.com",
    to: [account.emailAddress],
    subject: "Invalid source",
    bodyText: "Need invalid source checks.",
    recordId: "contact-lin"
  });

  assert.throws(
    () => store.updateEmailThreadAnalysis(context, message.threadId, "Bad message source.", [{ label: "Missing message", messageId: "missing-message" }]),
    /Email message not found/
  );
  assert.throws(
    () => store.updateEmailThreadAnalysis(context, message.threadId, "Bad activity source.", [{ label: "Missing activity", activityId: "missing-activity" }]),
    /Activity not found/
  );
  assert.throws(
    () => store.updateEmailMessageTranslation(context, message.id, "Bad knowledge source.", "en-US", [{ label: "Missing knowledge", knowledgeArticleId: "missing-knowledge" }]),
    /Knowledge article not found/
  );
});

await run("email assistant compact context uses thread summary instead of summarized history", () => {
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, "2026-06-20T00:00:00.000Z");
  settings.features = { ...settings.features, draft: true, auto_summarize: true };
  const thread = {
    id: "thread-compact",
    workspaceId: defaultWorkspaceId,
    accountId: "account-compact",
    subject: "Compact history",
    participantEmails: ["buyer@example.com"],
    summary: "Existing compact memory about deployment blockers.",
    summaryUpdatedAt: "2026-06-20T10:00:00.000Z",
    createdAt: "2026-06-20T08:00:00.000Z",
    updatedAt: "2026-06-20T10:00:00.000Z"
  };
  const messages = [
    {
      id: "message-old",
      workspaceId: defaultWorkspaceId,
      threadId: thread.id,
      accountId: thread.accountId,
      direction: "inbound",
      status: "received",
      from: "buyer@example.com",
      to: ["sales@example.com"],
      subject: "Old context",
      bodyText: "OLD BODY SHOULD BE COMPRESSED AWAY",
      receivedAt: "2026-06-20T09:00:00.000Z",
      createdAt: "2026-06-20T09:00:00.000Z"
    },
    {
      id: "message-new",
      workspaceId: defaultWorkspaceId,
      threadId: thread.id,
      accountId: thread.accountId,
      direction: "inbound",
      status: "received",
      from: "buyer@example.com",
      to: ["sales@example.com"],
      subject: "New context",
      bodyText: "NEW BODY AFTER SUMMARY",
      receivedAt: "2026-06-20T11:00:00.000Z",
      createdAt: "2026-06-20T11:00:00.000Z"
    }
  ];

  const compact = buildEmailPromptContext({ settings, purpose: "draft", thread, messages });
  assert.match(compact.communicationSummary, /Existing compact memory/);
  assert.doesNotMatch(compact.communicationSummary, /OLD BODY SHOULD BE COMPRESSED AWAY/);
  assert.match(compact.communicationSummary, /NEW BODY AFTER SUMMARY/);

  const summarizeContext = buildEmailPromptContext({ settings, purpose: "summarize", thread, messages });
  assert.match(summarizeContext.communicationSummary, /Existing compact memory/);
  assert.match(summarizeContext.communicationSummary, /OLD BODY SHOULD BE COMPRESSED AWAY/);
  assert.match(summarizeContext.communicationSummary, /NEW BODY AFTER SUMMARY/);

  const compactWithExplicitSource = buildEmailPromptContext({ settings, purpose: "draft", thread, messages, sourceMessage: messages[0] });
  assert.match(compactWithExplicitSource.communicationSummary, /OLD BODY SHOULD BE COMPRESSED AWAY/);
  assert.equal(compactWithExplicitSource.sources.some((source) => source.messageId === "message-old"), true);

  settings.features.auto_summarize = false;
  const uncompressed = buildEmailPromptContext({ settings, purpose: "draft", thread, messages });
  assert.match(uncompressed.communicationSummary, /OLD BODY SHOULD BE COMPRESSED AWAY/);
});

await run("email assistant exposes context budget and model prompt caps long source text", async () => {
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, "2026-06-20T00:00:00.000Z");
  settings.features = { ...settings.features, translate: true, auto_summarize: true };
  settings.maxContextChars = 1000;
  settings.maxKnowledgeArticles = 2;
  const longBody = "LONG_EMAIL_BODY ".repeat(1000);
  const context = buildEmailPromptContext({
    settings,
    purpose: "translate",
    thread: {
      id: "thread-budget",
      workspaceId: defaultWorkspaceId,
      accountId: "account-budget",
      subject: "Budgeted context",
      participantEmails: ["buyer@example.com"],
      createdAt: "2026-06-20T08:00:00.000Z",
      updatedAt: "2026-06-20T10:00:00.000Z"
    },
    messages: [
      {
        id: "message-budget",
        workspaceId: defaultWorkspaceId,
        threadId: "thread-budget",
        accountId: "account-budget",
        direction: "inbound",
        status: "received",
        from: "buyer@example.com",
        to: ["sales@example.com"],
        subject: "Long body",
        bodyText: longBody,
        receivedAt: "2026-06-20T09:00:00.000Z",
        createdAt: "2026-06-20T09:00:00.000Z"
      }
    ],
    knowledgeArticles: [
      { id: "knowledge-budget", workspaceId: defaultWorkspaceId, title: "Large policy", body: "KNOWLEDGE_BODY ".repeat(300), tags: ["policy"], active: true, createdById: "user-admin", createdAt: "2026-06-20T09:00:00.000Z", updatedAt: "2026-06-20T09:00:00.000Z" }
    ],
    sourceMessage: {
      id: "message-budget",
      workspaceId: defaultWorkspaceId,
      threadId: "thread-budget",
      accountId: "account-budget",
      direction: "inbound",
      status: "received",
      from: "buyer@example.com",
      to: ["sales@example.com"],
      subject: "Long body",
      bodyText: longBody,
      receivedAt: "2026-06-20T09:00:00.000Z",
      createdAt: "2026-06-20T09:00:00.000Z"
    }
  });
  const prompt = buildEmailModelPrompt({ context, userPrompt: "Please translate this carefully. ".repeat(100), sourceText: longBody });
  const result = await generateEmailAiOutput({ context, userPrompt: "Please translate this carefully. ".repeat(100), sourceText: longBody });

  assert.equal(context.maxContextChars, 1000);
  assert.equal(context.contextCharCount <= 1000, true);
  assert.equal(context.truncated, true);
  assert.equal(prompt.length <= 2000, true);
  assert.match(prompt, /\[truncated\]/);
  assert.doesNotMatch(prompt, new RegExp("LONG_EMAIL_BODY ".repeat(60).trim()));
  assert.equal(result.budget.maxContextChars, 1000);
  assert.equal(result.budget.truncated, true);
  assert.equal(result.budget.modelPromptChars <= 2000, true);
});

await run("email ai generation bounds provider output before persistence", async () => {
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, "2026-06-20T00:00:00.000Z");
  settings.features = { ...settings.features, draft: true };
  settings.maxContextChars = MAX_EMAIL_AI_OUTPUT_CHARS + 5000;
  const context = buildEmailPromptContext({
    settings,
    purpose: "draft",
    record: {
      id: "record-ai-output-budget",
      workspaceId: defaultWorkspaceId,
      objectKey: "contacts",
      title: "AI Output Budget",
      data: {},
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z"
    }
  });
  const result = await generateEmailAiOutput(
    { context, userPrompt: "draft a bounded reply" },
    {
      config: { provider: "openai-compatible", apiKey: "test-key", baseUrl: "https://ai.example/v1", model: "test-model", timeoutMs: 1000 },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    text: "MODEL_OUTPUT ".repeat(2000),
                    suggestedSubject: "Very long subject ".repeat(40)
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
    }
  );

  assert.equal(result.enabled, true);
  assert.equal(result.generationMode, "provider");
  assert.equal(result.text.length <= MAX_EMAIL_AI_OUTPUT_CHARS, true);
  assert.match(result.text, /\[truncated\]$/);
  assert.equal(result.suggestedSubject.length <= MAX_EMAIL_AI_SUBJECT_CHARS, true);
  assert.match(result.suggestedSubject, /\[truncated\]$/);
  assert.equal(result.budget.outputTruncated, true);
});

await run("email draft generation parses plain text Subject header from provider output", async () => {
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, "2026-06-20T00:00:00.000Z");
  settings.features = { ...settings.features, draft: true };
  const context = buildEmailPromptContext({
    settings,
    purpose: "draft",
    record: {
      id: "record-ai-plain-subject",
      workspaceId: defaultWorkspaceId,
      objectKey: "contacts",
      title: "George",
      data: {},
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z"
    }
  });
  const result = await generateEmailAiOutput(
    { context, userPrompt: "询问最近是否有Nebula Titan Vaporizer的采购计划" },
    {
      config: { provider: "openai-compatible", apiKey: "test-key", baseUrl: "https://ai.example/v1", model: "test-model", timeoutMs: 1000 },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: [
                    "Subject: Inquiry About Nebula Titan Vaporizer Procurement Plans",
                    "",
                    "Dear George,",
                    "",
                    "I wanted to reach out and inquire if there are any recent plans for procuring the Nebula Titan Vaporizer."
                  ].join("\n")
                }
              }
            ]
          }),
          { status: 200 }
        )
    }
  );

  assert.equal(result.suggestedSubject, "Inquiry About Nebula Titan Vaporizer Procurement Plans");
  assert.doesNotMatch(result.text, /^Subject:/i);
  assert.match(result.text, /^Dear George,/);
});

await run("email draft generation parses Chinese subject and body labels from provider output", async () => {
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, "2026-06-20T00:00:00.000Z");
  settings.features = { ...settings.features, draft: true };
  const context = buildEmailPromptContext({
    settings,
    purpose: "draft",
    record: {
      id: "record-ai-chinese-subject",
      workspaceId: defaultWorkspaceId,
      objectKey: "contacts",
      title: "George",
      data: {},
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z"
    }
  });
  const result = await generateEmailAiOutput(
    { context, userPrompt: "询问最近是否有Nebula Titan Vaporizer的采购计划" },
    {
      config: { provider: "openai-compatible", apiKey: "test-key", baseUrl: "https://ai.example/v1", model: "test-model", timeoutMs: 1000 },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: [
                    "主题：Nebula Titan Vaporizer采购计划询问",
                    "",
                    "正文：",
                    "",
                    "Dear George,",
                    "",
                    "请问近期是否有Nebula Titan Vaporizer的采购计划？"
                  ].join("\n")
                }
              }
            ]
          }),
          { status: 200 }
        )
    }
  );

  assert.equal(result.suggestedSubject, "Nebula Titan Vaporizer采购计划询问");
  assert.doesNotMatch(result.text, /^主题：/);
  assert.doesNotMatch(result.text, /^正文：/);
  assert.match(result.text, /^Dear George,/);
});

await run("email draft generation preserves JSON provider subject contract", async () => {
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, "2026-06-20T00:00:00.000Z");
  settings.features = { ...settings.features, draft: true };
  const context = buildEmailPromptContext({
    settings,
    purpose: "draft",
    record: {
      id: "record-ai-json-subject",
      workspaceId: defaultWorkspaceId,
      objectKey: "contacts",
      title: "George",
      data: {},
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z"
    }
  });
  const result = await generateEmailAiOutput(
    { context, userPrompt: "draft a procurement question" },
    {
      config: { provider: "openai-compatible", apiKey: "test-key", baseUrl: "https://ai.example/v1", model: "test-model", timeoutMs: 1000 },
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ text: "Dear George,\n\nDo you have any recent procurement plans?", suggestedSubject: "Procurement plan inquiry" }) } }] }), { status: 200 })
    }
  );

  assert.equal(result.text, "Dear George,\n\nDo you have any recent procurement plans?");
  assert.equal(result.suggestedSubject, "Procurement plan inquiry");
});

await run("email draft generation strips signatures and source footers from body", async () => {
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, "2026-06-20T00:00:00.000Z");
  settings.features = { ...settings.features, draft: true };
  const context = buildEmailPromptContext({
    settings,
    purpose: "draft",
    record: {
      id: "record-ai-no-signature",
      workspaceId: defaultWorkspaceId,
      objectKey: "contacts",
      title: "Instagram Contact",
      data: {},
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z"
    },
    thread: {
      id: "thread-ai-no-signature",
      workspaceId: defaultWorkspaceId,
      accountId: "email-account",
      subject: "Re: Instagram notification",
      participantEmails: ["no-reply@mail.instagram.com"],
      lastMessageAt: "2026-06-20T00:00:00.000Z",
      summary: "Automatic notification with no clear sales intent.",
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z"
    }
  });
  const prompt = buildEmailModelPrompt({ context, userPrompt: "请生成回复邮件" });
  const result = await generateEmailAiOutput(
    { context, userPrompt: "请生成回复邮件" },
    {
      config: { provider: "openai-compatible", apiKey: "test-key", baseUrl: "https://ai.example/v1", model: "test-model", timeoutMs: 1000 },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    text: [
                      "尊敬的客户，",
                      "",
                      "感谢您的来信。我们会先确认当前需求，再给出下一步建议。",
                      "",
                      "祝好，",
                      "",
                      "[您的名字]",
                      "[您的职位]",
                      "[您的公司]",
                      "[您的联系方式]",
                      "",
                      "来源：Instagram 邮件通知"
                    ].join("\n"),
                    suggestedSubject: "Re: Instagram notification"
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
    }
  );

  assert.match(prompt, /do not include a "Sources", "来源", citation, signature, sign-off/);
  assert.equal(result.generationMode, "provider");
  assert.equal(result.text, "尊敬的客户，\n\n感谢您的来信。我们会先确认当前需求，再给出下一步建议。");
  assert.doesNotMatch(result.text, /来源|您的名字|祝好|联系方式/);
});

await run("email assistant blocks generation when required sources are missing", async () => {
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, "2026-06-20T00:00:00.000Z");
  settings.features = { ...settings.features, draft: true };
  settings.requireSourceLinks = true;

  const context = buildEmailPromptContext({ settings, purpose: "draft" });
  const result = await generateEmailAiOutput({ context, userPrompt: "write a cold email" });

  assert.equal(context.enabled, false);
  assert.equal(result.enabled, false);
  assert.match(result.text, /requires at least one/);
  assert.deepEqual(result.sources, []);
});

await run("email ai generation audit stores metadata without generated content", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");

  store.recordEmailAiGeneration(context, {
    purpose: "draft",
    enabled: true,
    recordId: "contact-lin",
    sourceCount: 2,
    sourceLabels: ["Lin Chen", "Deployment notes"],
    targetLocale: "en-US",
    userPromptLength: 24,
    sourceTextLength: 0,
    resultTextLength: 180,
    contextCharCount: 640,
    maxContextChars: 8000,
    modelPromptChars: 1200,
    contextTruncated: true,
    outputTruncated: true,
    generationMode: "provider_fallback",
    providerError: `AI provider returned HTTP 503\n${"provider unavailable ".repeat(80)}`,
    suggestedSubjectProvided: true
  });

  const log = store.listAuditLogs(context, { entityType: "email_ai_generation" })[0];
  assert.equal(log.action, "create");
  assert.equal(log.entityId, "contact-lin");
  assert.equal(log.details.purpose, "draft");
  assert.equal(log.details.sourceCount, 2);
  assert.equal(log.details.targetLocale, "en-US");
  assert.equal(log.details.resultTextLength, 180);
  assert.equal(log.details.contextCharCount, 640);
  assert.equal(log.details.maxContextChars, 8000);
  assert.equal(log.details.modelPromptChars, 1200);
  assert.equal(log.details.contextTruncated, true);
  assert.equal(log.details.outputTruncated, true);
  assert.equal(log.details.generationMode, "provider_fallback");
  assert.match(log.details.providerError, /^AI provider returned HTTP 503 provider unavailable/);
  assert.equal(log.details.providerError.length <= 500, true);
  assert.doesNotMatch(log.details.providerError, /\n/);
  assert.equal(log.details.suggestedSubjectProvided, true);
  assert.equal("generatedText" in log.details, false);
  assert.equal("userPrompt" in log.details, false);
});

await run("email assistant context obeys feature toggles and includes CRM history and knowledge", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const account = store.createEmailAccount(context, {
    name: "AI Mailbox",
    emailAddress: "ai-sales@example.com",
    provider: "custom"
  });
  const article = store.createKnowledgeArticle(context, {
    title: "SSO Roadmap",
    body: "Enterprise SSO is planned after the private deployment baseline is stable.",
    tags: ["sso", "deployment"]
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "lin@example.com",
    to: ["ai-sales@example.com"],
    subject: "SSO and deployment",
    bodyText: "We need private deployment details and SSO timing.",
    recordId: "deal-platform"
  });
  const thread = store.listEmailThreads(context, "deal-platform")[0];

  store.updateEmailAiSettings(context, { features: { draft: false, translate: true, context_analysis: true, auto_summarize: true }, maxHistoryMessages: 1 });
  const disabledDraft = store.buildEmailAssistantContext(context, {
    purpose: "draft",
    objectKey: "deals",
    recordId: "deal-platform",
    threadId: thread.id
  });
  assert.equal(disabledDraft.enabled, false);
  assert.match(disabledDraft.instruction, /disabled/);

  store.updateEmailAiSettings(context, { features: { draft: true } });
  const draftContext = store.buildEmailAssistantContext(context, {
    purpose: "draft",
    objectKey: "deals",
    recordId: "deal-platform",
    threadId: thread.id,
    targetLocale: "en-US"
  });

  assert.equal(draftContext.enabled, true);
  assert.match(draftContext.customerBrief, /Acme/);
  assert.match(draftContext.communicationSummary, /SSO and deployment/);
  assert.match(draftContext.knowledgeBrief, /SSO Roadmap/);
  assert.equal(draftContext.sources.some((source) => source.messageId === message.id), true);
  assert.equal(draftContext.sources.some((source) => source.knowledgeArticleId === article.id), true);
});

await run("email assistant context ranks knowledge by customer context relevance", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { features: { draft: true }, maxKnowledgeArticles: 1 });
  const account = store.createEmailAccount(context, {
    name: "Knowledge Ranking Mailbox",
    emailAddress: "knowledge-ranking@example.com",
    provider: "custom"
  });
  const billingArticle = store.createKnowledgeArticle(context, {
    title: "Billing FAQ",
    body: "Invoices, tax forms, and payment terms are handled by finance operations.",
    tags: ["billing", "finance"]
  });
  const deploymentArticle = store.createKnowledgeArticle(context, {
    title: "Private Deployment Checklist",
    body: "Private deployment requires networking, SSO, security review, and database readiness.",
    tags: ["deployment", "sso", "security"]
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "buyer@example.com",
    to: [account.emailAddress],
    subject: "SSO deployment review",
    bodyText: "We need the private deployment and SSO security checklist before procurement.",
    recordId: "deal-platform"
  });

  const assistantContext = store.buildEmailAssistantContext(context, {
    purpose: "draft",
    objectKey: "deals",
    recordId: "deal-platform",
    threadId: message.threadId
  });

  assert.match(assistantContext.knowledgeBrief, /Private Deployment Checklist/);
  assert.doesNotMatch(assistantContext.knowledgeBrief, /Billing FAQ/);
  assert.equal(assistantContext.sources.some((source) => source.knowledgeArticleId === deploymentArticle.id), true);
  assert.equal(assistantContext.sources.some((source) => source.knowledgeArticleId === billingArticle.id), false);
});

await run("email assistant injects active product catalog into draft prompts", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { features: { draft: true } });
  const activeProduct = store.createRecord(context, "products", {
    title: "Docker Compose Deployment",
    data: {
      active: true,
      sku: "DC-01",
      description: "Private deployment package with web, PostgreSQL, Redis, and worker services.",
      unitPrice: 499,
      unitPriceCurrency: "USD",
      billingCycle: "one_time",
      mainImageUrl: "https://example.com/docker-compose.png",
      attachments: [{ title: "Deployment overview", url: "https://example.com/overview.pdf" }]
    }
  });
  const inactiveProduct = store.createRecord(context, "products", {
    title: "Legacy Product",
    data: { active: false, sku: "OLD-01", unitPrice: 99, unitPriceCurrency: "USD", description: "This inactive product must not be injected." }
  });

  const assistantContext = store.buildEmailAssistantContext(context, {
    purpose: "draft",
    productIds: [inactiveProduct.id, activeProduct.id],
    productQuery: "docker compose private deployment",
    userPrompt: "Ask whether the customer is interested in our product"
  });
  const prompt = buildEmailModelPrompt({ context: assistantContext, userPrompt: "Ask whether the customer is interested in our product" });

  assert.match(assistantContext.productBrief, /Docker Compose Deployment/);
  assert.match(assistantContext.productBrief, /SKU: DC-01/);
  assert.match(assistantContext.productBrief, /Price: 499 USD/);
  assert.doesNotMatch(assistantContext.productBrief, /Legacy Product/);
  assert.equal(assistantContext.sources.some((source) => source.objectKey === "products" && source.recordId === activeProduct.id), true);
  assert.equal(assistantContext.sources.some((source) => source.recordId === inactiveProduct.id), false);
  assert.match(prompt, /Product catalog:/);
  assert.match(prompt, /do not invent product names/i);
});

await run("email assistant context excludes uncommitted outbound history", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { features: { draft: true }, maxHistoryMessages: 10 });
  const account = store.createEmailAccount(context, {
    name: "Committed Context Mailbox",
    emailAddress: "committed-context@example.com",
    provider: "custom"
  });
  const inbound = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "buyer@example.com",
    to: [account.emailAddress],
    subject: "Received customer request",
    bodyText: "Customer approved using the committed history.",
    recordId: "contact-lin"
  });
  const sent = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "outbound",
    status: "sent",
    from: account.emailAddress,
    to: ["buyer@example.com"],
    subject: "Sent follow up",
    bodyText: "This sent follow-up is safe to include.",
    threadId: inbound.threadId,
    sentAt: "2026-06-20T09:00:00.000Z"
  });
  store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "outbound",
    status: "queued",
    from: account.emailAddress,
    to: ["buyer@example.com"],
    subject: "Queued draft should be hidden",
    bodyText: "Do not expose this queued draft in AI context.",
    threadId: inbound.threadId
  });
  store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "outbound",
    status: "failed",
    from: account.emailAddress,
    to: ["buyer@example.com"],
    subject: "Failed draft should be hidden",
    bodyText: "Do not expose this failed outbound body in AI context.",
    threadId: inbound.threadId
  });

  const assistantContext = store.buildEmailAssistantContext(context, {
    purpose: "draft",
    recordId: "contact-lin",
    threadId: inbound.threadId
  });

  assert.match(assistantContext.communicationSummary, /Received customer request/);
  assert.match(assistantContext.communicationSummary, /Sent follow up/);
  assert.doesNotMatch(assistantContext.communicationSummary, /Queued draft should be hidden/);
  assert.doesNotMatch(assistantContext.communicationSummary, /Failed draft should be hidden/);
  assert.equal(assistantContext.sources.some((source) => source.messageId === inbound.id), true);
  assert.equal(assistantContext.sources.some((source) => source.messageId === sent.id), true);
});

await run("email assistant prompt excludes bcc recipients and attachment content", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { features: { draft: true }, maxHistoryMessages: 10 });
  const account = store.createEmailAccount(context, {
    name: "Prompt Privacy Mailbox",
    emailAddress: "prompt-privacy@example.com",
    provider: "custom"
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "buyer@example.com",
    to: [account.emailAddress],
    cc: ["visible-manager@example.com"],
    bcc: ["hidden-archive@example.com"],
    subject: "Attachment privacy",
    bodyText: "Please review the visible implementation plan.",
    attachments: [
      {
        fileName: "private-notes.txt",
        contentType: "text/plain",
        size: "secret attachment body".length,
        contentBase64: Buffer.from("secret attachment body").toString("base64")
      }
    ],
    recordId: "contact-lin"
  });

  const assistantContext = store.buildEmailAssistantContext(context, {
    purpose: "draft",
    recordId: "contact-lin",
    threadId: message.threadId
  });
  const prompt = buildEmailModelPrompt({ context: assistantContext, userPrompt: "draft a reply" });

  assert.match(prompt, /Please review the visible implementation plan/);
  assert.doesNotMatch(prompt, /hidden-archive@example\.com/);
  assert.doesNotMatch(prompt, /secret attachment body/);
  assert.doesNotMatch(prompt, /private-notes\.txt/);
});

await run("email message translation and analysis use CRM thread context and knowledge", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { features: { translate: true, context_analysis: true, auto_summarize: true } });
  const article = store.createKnowledgeArticle(context, {
    title: "Translation glossary",
    body: "Translate onboarding as implementation kickoff when writing customer-facing English.",
    tags: ["translation", "onboarding"]
  });
  const account = store.createEmailAccount(context, {
    name: "AI Translation Inbox",
    emailAddress: "sales@example.com",
    provider: "custom",
    syncEnabled: true,
    sendEnabled: true,
    status: "active"
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "lin@example.com",
    to: ["sales@example.com"],
    subject: "Customer email",
    bodyText: "We want to confirm the private deployment and onboarding plan.",
    recordId: "contact-lin"
  });

  const translationContext = store.buildEmailAssistantContext(context, { purpose: "translate", threadId: message.threadId, sourceMessageId: message.id, recordId: "contact-lin", targetLocale: "en-US" });
  const translation = await generateEmailAiOutput({ context: translationContext, sourceText: message.bodyText });
  const analysisContext = store.buildEmailAssistantContext(context, { purpose: "context_analysis", threadId: message.threadId, sourceMessageId: message.id, recordId: "contact-lin" });
  const analysis = await generateEmailAiOutput({ context: analysisContext, sourceText: message.bodyText });

  assert.equal(translation.enabled, true);
  assert.match(translation.text, /待翻译内容/);
  assert.match(translation.text, /private deployment/i);
  assert.equal(translation.sources.some((source) => source.recordId === "contact-lin"), true);
  assert.equal(translation.sources.some((source) => source.messageId === message.id), true);
  assert.equal(translation.sources.some((source) => source.knowledgeArticleId === article.id), true);
  assert.equal(analysis.enabled, true);
  assert.match(analysis.text, /AI 线程分析/);
  assert.match(analysis.text, /建议下一步/);
  assert.doesNotMatch(analysis.text, /Recent email history:|Knowledge base:|User request:/);
});

await run("email context analysis repairs mojibake and hides prompt internals", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { features: { context_analysis: true, auto_summarize: true }, requireSourceLinks: false });
  const account = store.createEmailAccount(context, {
    name: "Mojibake analysis inbox",
    emailAddress: "mojibake-analysis@example.com",
    provider: "custom",
    status: "active"
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    status: "received",
    from: "no-reply@mail.instagram.com",
    to: [account.emailAddress],
    subject: "Instagram notification",
    bodyText: "? nugplugger ????????????"
  });
  const assistantContext = store.buildEmailAssistantContext(context, { purpose: "context_analysis", threadId: message.threadId, sourceMessageId: message.id });
  const analysis = await generateEmailAiOutput({ context: assistantContext });

  assert.match(assistantContext.communicationSummary, /和其他用户发布了新内容/);
  assert.match(analysis.text, /AI 线程分析/);
  assert.match(analysis.text, /自动通知|社交类邮件/);
  assert.doesNotMatch(analysis.text, /ã|å|User request:|Recent email history:/);
});

await run("email assistant context infers thread and customer record from source message", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { features: { context_analysis: true, auto_summarize: true } });
  store.createKnowledgeArticle(context, {
    title: "Private deployment playbook",
    body: "Use the deployment checklist when customers ask about private deployment readiness.",
    tags: ["deployment"]
  });
  const account = store.createEmailAccount(context, {
    name: "Source Message Inbox",
    emailAddress: "source-message@example.com",
    provider: "custom"
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "lin@example.com",
    to: ["source-message@example.com"],
    subject: "Deployment checklist",
    bodyText: "Can you review the private deployment checklist before our next call?",
    recordId: "contact-lin"
  });

  const assistantContext = store.buildEmailAssistantContext(context, {
    purpose: "context_analysis",
    sourceMessageId: message.id
  });
  const result = await generateEmailAiOutput({ context: assistantContext, sourceText: message.bodyText });

  assert.equal(assistantContext.enabled, true);
  assert.equal(assistantContext.recordId, "contact-lin");
  assert.equal(assistantContext.threadId, message.threadId);
  assert.equal(assistantContext.sourceMessageId, message.id);
  assert.equal(result.recordId, "contact-lin");
  assert.equal(result.threadId, message.threadId);
  assert.equal(result.sourceMessageId, message.id);
  assert.match(assistantContext.customerBrief, /林晓|lin@example\.com/);
  assert.match(assistantContext.communicationSummary, /Deployment checklist/);
  assert.match(assistantContext.knowledgeBrief, /Private deployment playbook/);
  assert.equal(assistantContext.sources.some((source) => source.recordId === "contact-lin"), true);
  assert.equal(assistantContext.sources.some((source) => source.messageId === message.id), true);
});

await run("email assistant context rejects mismatched record and thread anchors", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { features: { draft: true, context_analysis: true } });
  const account = store.createEmailAccount(context, {
    name: "AI Anchor Guard Inbox",
    emailAddress: "ai-anchor-guard@example.com",
    provider: "custom"
  });
  const message = store.recordEmailMessage(context, {
    accountId: account.id,
    direction: "inbound",
    from: "lin@example.com",
    to: ["ai-anchor-guard@example.com"],
    subject: "Do not mix customer context",
    bodyText: "Please keep this thread tied to the correct customer.",
    recordId: "contact-lin"
  });

  assert.throws(
    () =>
      store.buildEmailAssistantContext(context, {
        purpose: "draft",
        recordId: "deal-platform",
        threadId: message.threadId
      }),
    /record does not match/
  );
  assert.throws(
    () =>
      store.buildEmailAssistantContext(context, {
        purpose: "context_analysis",
        recordId: "deal-platform",
        sourceMessageId: message.id
      }),
    /record does not match/
  );
});

await run("email ai settings normalize missing feature keys for existing workspaces", () => {
  const store = new CrmStore({
    ...seedData,
    emailAiSettings: [
      {
        ...seedData.emailAiSettings[0],
        features: {
          draft: true,
          translate: true,
          context_analysis: true,
          auto_summarize: true
        }
      }
    ]
  });
  const context = store.getContext("user-admin");
  const settings = store.getEmailAiSettings(context);
  const updated = store.updateEmailAiSettings(context, { features: { draft: false } });

  assert.equal(settings.features.auto_translate, false);
  assert.equal(settings.features.auto_context_analysis, false);
  assert.equal(updated.features.draft, false);
  assert.equal(updated.features.translate, true);
  assert.equal(updated.features.auto_translate, false);
  assert.equal(updated.features.auto_context_analysis, false);
  assert.equal(updated.features.auto_summarize, true);
  assert.deepEqual(
    normalizeEmailAiFeatures({
      draft: true,
      translate: false,
      auto_translate: true,
      context_analysis: false,
      auto_context_analysis: true,
      auto_summarize: true
    }),
    {
      draft: true,
      translate: false,
      auto_translate: false,
      context_analysis: false,
      auto_context_analysis: false,
      auto_summarize: true
    }
  );
  const cleaned = store.updateEmailAiSettings(context, {
    features: {
      translate: false,
      auto_translate: true,
      context_analysis: false,
      auto_context_analysis: true
    }
  });
  assert.equal(cleaned.features.translate, false);
  assert.equal(cleaned.features.auto_translate, false);
  assert.equal(cleaned.features.context_analysis, false);
  assert.equal(cleaned.features.auto_context_analysis, false);
  assert.equal(getEmailAiPurposeFeature("draft"), "draft");
  assert.equal(getEmailAiPurposeFeature("translate"), "translate");
  assert.equal(getEmailAiPurposeFeature("context_analysis"), "context_analysis");
  assert.equal(getEmailAiPurposeFeature("summarize"), "auto_summarize");
  assert.equal(isEmailAiPurposeEnabled(updated.features, "draft"), false);
  assert.equal(isEmailAiPurposeEnabled(updated.features, "translate"), true);
  assert.equal(isEmailAiPurposeEnabled(updated.features, "context_analysis"), true);
  assert.equal(isEmailAiPurposeEnabled(updated.features, "summarize"), true);
  assert.equal(isEmailAiPurposeEnabled({ ...updated.features, auto_summarize: false }, "summarize"), false);
});

await run("email ai settings expose configurable backend agents", () => {
  const store = new CrmStore({
    ...seedData,
    emailAiSettings: [
      {
        ...seedData.emailAiSettings[0],
        agents: []
      }
    ]
  });
  const context = store.getContext("user-admin");
  const settings = store.getEmailAiSettings(context);
  const classificationAgent = getAiAgentSetting(settings, emailClassificationAgentKey);
  const draftAgent = getAiAgentSetting(settings, emailDraftAgentKey);
  const translationAgent = getAiAgentSetting(settings, emailTranslationAgentKey);
  const contextAgent = getAiAgentSetting(settings, emailContextAnalysisAgentKey);
  const summaryAgent = getAiAgentSetting(settings, emailThreadSummaryAgentKey);

  assert.equal(settings.agents.length >= 5, true);
  assert.equal(classificationAgent?.enabled, true);
  assert.match(classificationAgent?.agentMarkdown ?? "", /Email Classification Agent/);
  assert.match(draftAgent?.agentMarkdown ?? "", /Email Draft Agent/);
  assert.match(translationAgent?.agentMarkdown ?? "", /Email Translation Agent/);
  assert.match(contextAgent?.agentMarkdown ?? "", /Email Context Analysis Agent/);
  assert.match(summaryAgent?.agentMarkdown ?? "", /Email Thread Summary Agent/);
  assert.equal(normalizeAiAgentSettings([{ key: inboundEmailPreprocessAgentKey, name: "Custom", scenario: "email", enabled: false, model: "custom-model", agentMarkdown: "# Agent", maxOutputChars: 1500 }]).some((agent) => agent.key === inboundEmailPreprocessAgentKey), false);
  assert.equal(getAiAgentSetting({ agents: normalizeAiAgentSettings([{ key: inboundEmailPreprocessAgentKey, name: "Custom", scenario: "email", enabled: false, model: "custom-model", agentMarkdown: "# Agent", maxOutputChars: 1500 }]) }, emailClassificationAgentKey)?.model, "custom-model");

  const updated = store.updateEmailAiSettings(context, {
    agents: settings.agents.map((agent) => (agent.key === emailClassificationAgentKey ? { ...agent, enabled: false, model: "crm-classifier-model", agentMarkdown: "# Custom classifier agent", maxOutputChars: 2500 } : agent))
  });
  const updatedAgent = getAiAgentSetting(updated, emailClassificationAgentKey);
  assert.equal(updatedAgent?.enabled, false);
  assert.equal(updatedAgent?.model, "crm-classifier-model");
  assert.equal(updatedAgent?.maxOutputChars, 2500);

  const parsed = emailAiSettingsUpdateSchema.parse({
    agents: updated.agents
  });
  assert.equal(parsed.agents?.some((agent) => agent.key === emailClassificationAgentKey), true);

  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const aiGeneration = readFileSync("src/lib/email/ai-generation.ts", "utf8");
  assert.match(source, /data-testid="email-ai-agents-panel"/);
  assert.match(source, /邮件分类 Agent 负责收件后归类到主要、推广、社交或更新/);
  assert.match(source, /canManageAiSettings/);
  assert.match(source, /data-testid=\{`email-ai-agent-\$\{agent\.key\}`\}/);
  assert.match(source, /data-testid=\{`email-ai-agent-model-\$\{agent\.key\}`\}/);
  assert.match(source, /data-testid=\{`email-ai-agent-md-\$\{agent\.key\}`\}/);
  assert.match(aiGeneration, /model: options\?\.config\?\.model \?\? context\.agentModel/);
});

await run("global ai agent registry includes the first wave agents", () => {
  const definitions = listAiAgentDefinitions();
  const keys = definitions.map((definition) => definition.key);
  assert.equal(keys.includes(emailDraftAgentKey), true);
  assert.equal(keys.includes(recordSummaryAgentKey), true);
  assert.equal(keys.includes(talkAboutThisAgentKey), true);
  assert.equal(keys.includes(workflowDesignerAgentKey), true);
  assert.equal(keys.includes(workflowAiAgentNodeKey), true);

  const settings = normalizeGlobalAiAgentSettings([]);
  assert.equal(settings.length >= definitions.length, true);
  assert.equal(settings.some((agent) => agent.key === recordSummaryAgentKey && agent.outputSchema === "text"), true);
  assert.equal(settings.some((agent) => agent.key === talkAboutThisAgentKey && agent.toolPolicy?.allowWrite === false), true);
});

await run("global ai agent settings preserve workspace overrides", () => {
  const settings = normalizeGlobalAiAgentSettings([
    {
      key: recordSummaryAgentKey,
      name: "Custom Summary Agent",
      scenario: "sales",
      enabled: false,
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "custom-summary-model",
      agentMarkdown: "# Custom summary agent",
      contextPolicy: {
        includeRecord: true,
        includeActivities: false,
        includeEmailThread: true,
        includeKnowledge: false,
        maxContextChars: 4321,
        maxHistoryMessages: 7
      },
      toolPolicy: {
        allowRead: true,
        allowWrite: false,
        allowedTools: ["query_records"],
        highRiskRequiresApproval: true
      },
      outputSchema: "text",
      maxOutputChars: 1234
    }
  ]);
  const agent = settings.find((candidate) => candidate.key === recordSummaryAgentKey);
  assert.equal(agent?.name, "Custom Summary Agent");
  assert.equal(agent?.enabled, false);
  assert.equal(agent?.provider, "openrouter");
  assert.equal(agent?.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(agent?.model, "custom-summary-model");
  assert.equal(agent?.contextPolicy?.maxContextChars, 4321);
  assert.deepEqual(agent?.toolPolicy?.allowedTools, ["query_records"]);

  const parsed = emailAiSettingsUpdateSchema.parse({ agents: settings });
  assert.equal(parsed.agents?.some((candidate) => candidate.key === recordSummaryAgentKey && candidate.provider === "openrouter"), true);
});

await run("ai agent harness falls back locally without provider key", async () => {
  const agent = normalizeGlobalAiAgentSettings([]).find((candidate) => candidate.key === recordSummaryAgentKey);
  assert.ok(agent);

  const result = await runAiAgent(
    {
      agentKey: recordSummaryAgentKey,
      task: "Summarize this record for a sales rep.",
      context: {
        record: {
          title: "Acme China",
          data: { industry: "software" }
        }
      }
    },
    {
      agent,
      providerConfig: {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-test",
        timeoutMs: 1000
      }
    }
  );

  assert.equal(result.agentKey, recordSummaryAgentKey);
  assert.equal(result.generationMode, "local");
  assert.match(result.text, /本地降级输出/);
  assert.equal(result.provider, "openai");
  assert.equal(result.budget.promptChars > 0, true);
});

await run("email ai settings expose encrypted provider profiles", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const updated = store.updateEmailAiSettings(context, {
    providerConfig: {
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "secret-openrouter-key",
      model: "openai/gpt-4.1-mini",
      timeoutMs: 12000
    }
  });
  assert.equal(updated.providerConfig.provider, "openrouter");
  assert.equal(updated.providerConfig.hasApiKey, true);
  assert.equal(updated.providerConfig.apiKey, undefined);
  assert.equal(store.getEmailAiProviderConfig(context).apiKey, "secret-openrouter-key");
  const withProfile = store.updateEmailAiSettings(context, {
    providerProfiles: [
      {
        key: "openrouter-sales",
        name: "OpenRouter Sales",
        enabled: true,
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "secret-profile-key",
        model: "anthropic/claude-3-haiku",
        timeoutMs: 13000,
        isDefault: true
      }
    ]
  });
  assert.deepEqual(withProfile.providerProfiles.map((profile) => profile.key), ["openrouter-sales"]);
  assert.equal(withProfile.providerProfiles[0]?.isDefault, true);
  assert.equal(store.getEmailAiProviderConfig(context).apiKey, "secret-profile-key");
  const afterProfileRemoval = store.updateEmailAiSettings(context, { providerProfiles: [] });
  assert.deepEqual(afterProfileRemoval.providerProfiles, []);
  const restoredProfile = store.updateEmailAiSettings(context, {
    providerProfiles: [
      {
        key: "openrouter-sales",
        name: "OpenRouter Sales",
        enabled: true,
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "secret-profile-key",
        model: "anthropic/claude-3-haiku",
        timeoutMs: 13000,
        isDefault: true
      },
      {
        key: "custom-default",
        name: "Custom Default",
        enabled: true,
        provider: "custom",
        baseUrl: "https://custom-default.example/v1",
        apiKey: "secret-default-key",
        model: "default-model",
        timeoutMs: 14000,
        isDefault: true
      }
    ]
  });
  const publicProfile = restoredProfile.providerProfiles.find((profile) => profile.key === "openrouter-sales");
  assert.equal(publicProfile?.hasApiKey, true);
  assert.equal(publicProfile?.apiKey, undefined);
  assert.equal(publicProfile?.isDefault, false);
  const defaultProfile = restoredProfile.providerProfiles.find((profile) => profile.key === "custom-default");
  assert.equal(defaultProfile?.hasApiKey, true);
  assert.equal(defaultProfile?.apiKey, undefined);
  assert.equal(defaultProfile?.isDefault, true);
  const defaultConfig = store.getEmailAiProviderConfig(context);
  assert.equal(defaultConfig.provider, "custom");
  assert.equal(defaultConfig.baseUrl, "https://custom-default.example/v1");
  assert.equal(defaultConfig.apiKey, "secret-default-key");
  const defaultAgent = store.listAiAgents(context).find((agent) => agent.key === emailDraftAgentKey);
  const defaultAgentConfig = store.getAiProviderConfigForAgent(context, defaultAgent);
  assert.equal(defaultAgentConfig.provider, "custom");
  assert.equal(defaultAgentConfig.baseUrl, "https://custom-default.example/v1");
  assert.equal(defaultAgentConfig.apiKey, "secret-default-key");
  const profileAgent = store.updateAiAgent(context, emailDraftAgentKey, {
    providerProfileKey: "openrouter-sales",
    provider: "gemini",
    baseUrl: "https://legacy-override.example/v1"
  });
  const profileConfig = store.getAiProviderConfigForAgent(context, profileAgent);
  assert.equal(profileConfig.provider, "openrouter");
  assert.equal(profileConfig.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(profileConfig.apiKey, "secret-profile-key");

  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260624093000_add_ai_provider_config/migration.sql", "utf8");
  const apiSchema = readFileSync("src/lib/crm/api-schemas.ts", "utf8");
  const repository = readFileSync("src/lib/crm/repository.ts", "utf8");
  const providerConfig = readFileSync("src/lib/ai/provider-config.ts", "utf8");
  const source = readFileSync("src/components/crm-workspace.tsx", "utf8");
  const settingsSource = readFileSync("src/components/settings-admin.tsx", "utf8");
  const emailGenerateRoute = readFileSync("src/app/api/email/ai-generate/route.ts", "utf8");
  assert.match(schema, /encryptedProviderConfig String\?/);
  assert.match(migration, /ADD COLUMN "encryptedProviderConfig" TEXT/);
  assert.match(apiSchema, /providerConfig: z/);
  assert.match(apiSchema, /providerProfiles: z\.array\(aiProviderProfileSchema\)/);
  assert.match(apiSchema, /providerProfileKey: z\.string\(\)\.trim\(\)/);
  assert.match(apiSchema, /z\.enum\(\["openai", "gemini", "openrouter", "custom", "openai-compatible"\]\)/);
  assert.match(apiSchema, /hasApiKey: z\.boolean\(\)\.optional\(\)/);
  assert.match(apiSchema, /isDefault: z\.boolean\(\)\.optional\(\)/);
  assert.match(repository, /encryptAiProviderSettingsBundle\(\{ providerConfig:/);
  assert.match(repository, /getAiProviderConfigForAgent\(context: RequestContext, agent: AiAgentSetting\)/);
  assert.match(repository, /getEmailAiProviderConfig\(context: RequestContext\)/);
  assert.match(providerConfig, /openrouter: \{ baseUrl: "https:\/\/openrouter\.ai\/api\/v1"/);
  assert.match(providerConfig, /gemini: \{ baseUrl: "https:\/\/generativelanguage\.googleapis\.com\/v1beta\/openai"/);
  assert.match(providerConfig, /resolveAiProviderConfigForAgent/);
  assert.match(providerConfig, /resolveDefaultAiProviderProfile/);
  assert.doesNotMatch(providerConfig, /agent\.provider\s*\?\?/);
  assert.doesNotMatch(providerConfig, /provider:\s*agent\.provider/);
  assert.doesNotMatch(providerConfig, /agent\.baseUrl/);
  assert.match(source, /data-testid="email-ai-provider-profile-notice"/);
  assert.match(source, /data-testid=\{`email-ai-agent-provider-profile-\$\{agent\.key\}`\}/);
  assert.match(source, /默认 Provider profile/);
  assert.match(source, /不限制知识库文章语言/);
  assert.doesNotMatch(source, /data-testid="email-ai-provider-panel"/);
  assert.doesNotMatch(source, /data-testid="email-ai-provider-api-key-save"/);
  assert.doesNotMatch(source, /sanitizeAiProviderConfigForPatch/);
  assert.doesNotMatch(source, /providerConfig:\s*\{\s*\.\.\.aiSettings\.providerConfig,\s*\.\.\.patch\s*\}/);
  assert.doesNotMatch(settingsSource, /Legacy provider override/);
  assert.doesNotMatch(settingsSource, /Provider Base URL override/);
  assert.doesNotMatch(settingsSource, /Use global provider base URL/);
  assert.match(emailGenerateRoute, /getGlobalAiAgentSetting\(settings, assistantContext\.agentKey\)/);
  assert.match(emailGenerateRoute, /getAiProviderConfigForAgent\(context, agent\)/);
  assert.match(emailGenerateRoute, /getEmailAiProviderConfig\(context\)/);
});

await run("crm admins inherit ai administration for upgraded workspaces", () => {
  const store = new CrmStore({
    ...seedData,
    roles: seedData.roles.map((role) =>
      role.id === "role-admin"
        ? { ...role, permissions: ["crm.read", "crm.write", "crm.import", "crm.admin"] }
        : role
    )
  });
  const context = store.getContext("user-admin");
  const updated = store.updateEmailAiSettings(context, {
    providerConfig: { provider: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-1.5-flash", timeoutMs: 10000 }
  });
  const migration = readFileSync("prisma/migrations/20260624104000_backfill_ai_admin_permissions/migration.sql", "utf8");
  const rbac = readFileSync("src/lib/auth/rbac.ts", "utf8");
  assert.equal(updated.providerConfig.provider, "gemini");
  assert.match(migration, /'crm\.admin' = ANY\("permissions"\)/);
  assert.match(migration, /'ai\.admin'/);
  assert.match(rbac, /permission === "ai\.admin"[\s\S]*crm\.admin/);
});

await run("email ai settings require admin to modify global toggles", () => {
  const store = new CrmStore();
  const salesContext = store.getContext("user-sales");

  assert.equal(store.getEmailAiSettings(salesContext).features.auto_summarize, true);
  assert.throws(
    () => store.updateEmailAiSettings(salesContext, { features: { draft: true, translate: true, auto_translate: true } }),
    /ai\.admin/
  );
});

await run("email ai automations require ai permission and dependent feature toggles", () => {
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, new Date().toISOString());
  settings.features = {
    draft: true,
    translate: true,
    auto_translate: true,
    context_analysis: true,
    auto_context_analysis: true,
    auto_summarize: true
  };
  const aiContext = { role: { permissions: ["crm.read", "crm.write", "ai.use"] } };
  const noAiContext = { role: { permissions: ["crm.read", "crm.write"] } };

  assert.equal(canRunEmailAiAutomation(aiContext, settings, "auto_translate"), true);
  assert.equal(canRunEmailAiAutomation(aiContext, settings, "auto_context_analysis"), true);
  assert.equal(canRunEmailAiAutomation(aiContext, settings, "auto_summarize"), true);
  assert.equal(canRunEmailAiAutomation(noAiContext, settings, "auto_translate"), false);
  assert.equal(canRunEmailAiAutomation(noAiContext, settings, "auto_context_analysis"), false);
  assert.equal(canRunEmailAiAutomation(noAiContext, settings, "auto_summarize"), false);

  settings.agents = settings.agents.map((agent) => (agent.key === emailTranslationAgentKey ? { ...agent, enabled: false } : agent));
  assert.equal(canRunEmailAiAutomation(aiContext, settings, "auto_translate"), false);
  assert.equal(canRunEmailAiAutomation(aiContext, settings, "auto_context_analysis"), true);
  assert.equal(canRunEmailAiAutomation(aiContext, settings, "auto_summarize"), true);
  settings.agents = settings.agents.map((agent) => (agent.key === emailTranslationAgentKey ? { ...agent, enabled: true } : agent));
  settings.agents = settings.agents.map((agent) => (agent.key === emailContextAnalysisAgentKey ? { ...agent, enabled: false } : agent));
  assert.equal(canRunEmailAiAutomation(aiContext, settings, "auto_translate"), true);
  assert.equal(canRunEmailAiAutomation(aiContext, settings, "auto_context_analysis"), false);
  assert.equal(canRunEmailAiAutomation(aiContext, settings, "auto_summarize"), true);
  settings.agents = settings.agents.map((agent) => (agent.key === emailContextAnalysisAgentKey ? { ...agent, enabled: true } : agent));
  settings.agents = settings.agents.map((agent) => (agent.key === emailThreadSummaryAgentKey ? { ...agent, enabled: false } : agent));
  assert.equal(canRunEmailAiAutomation(aiContext, settings, "auto_translate"), true);
  assert.equal(canRunEmailAiAutomation(aiContext, settings, "auto_context_analysis"), true);
  assert.equal(canRunEmailAiAutomation(aiContext, settings, "auto_summarize"), false);
  settings.agents = settings.agents.map((agent) => (agent.key === emailThreadSummaryAgentKey ? { ...agent, enabled: true } : agent));

  settings.features.translate = false;
  assert.equal(canRunEmailAiAutomation(aiContext, settings, "auto_translate"), false);
  settings.features.context_analysis = false;
  assert.equal(canRunEmailAiAutomation(aiContext, settings, "auto_context_analysis"), false);
});

await run("email auto summary scheduling waits until it can reduce prompt history", () => {
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, new Date().toISOString());
  settings.maxHistoryMessages = 3;
  settings.maxContextChars = 2000;
  const thread = {
    id: "thread-auto-summary-policy",
    workspaceId: defaultWorkspaceId,
    accountId: "account-auto-summary-policy",
    subject: "Auto summary policy",
    participantEmails: ["buyer@example.com"],
    createdAt: "2026-06-20T08:00:00.000Z",
    updatedAt: "2026-06-20T08:00:00.000Z"
  };
  const makeMessage = (id, bodyText, createdAt) => ({
    id,
    workspaceId: defaultWorkspaceId,
    threadId: thread.id,
    accountId: thread.accountId,
    direction: "inbound",
    status: "received",
    from: "buyer@example.com",
    to: ["sales@example.com"],
    subject: `Message ${id}`,
    bodyText,
    createdAt
  });
  const messages = [
    makeMessage("message-summary-1", "short first note", "2026-06-20T09:00:00.000Z"),
    makeMessage("message-summary-2", "short second note", "2026-06-20T09:05:00.000Z"),
    makeMessage("message-summary-3", "short third note", "2026-06-20T09:10:00.000Z")
  ];

  assert.equal(shouldRunEmailAutoSummary(settings, thread, messages.slice(0, 2)), false);
  assert.equal(shouldRunEmailAutoSummary(settings, thread, messages), true);
  assert.equal(shouldRunEmailAutoSummary(settings, thread, [makeMessage("message-summary-long", "LONG_BODY ".repeat(120), "2026-06-20T09:15:00.000Z")]), true);

  const summarizedThread = {
    ...thread,
    summary: "Existing AI compact memory.",
    summaryUpdatedAt: "2026-06-20T10:00:00.000Z"
  };
  const oldMessage = makeMessage("message-summary-old", "old body", "2026-06-20T09:00:00.000Z");
  const newMessages = [
    makeMessage("message-summary-new-1", "new one", "2026-06-20T10:05:00.000Z"),
    makeMessage("message-summary-new-2", "new two", "2026-06-20T10:10:00.000Z"),
    makeMessage("message-summary-new-3", "new three", "2026-06-20T10:15:00.000Z")
  ];

  assert.equal(shouldRunEmailAutoSummary(settings, summarizedThread, [oldMessage, ...newMessages.slice(0, 2)]), false);
  assert.equal(shouldRunEmailAutoSummary(settings, summarizedThread, [oldMessage, ...newMessages]), true);
});

await run("email ai automations are best effort and audit failures", async () => {
  const context = {
    workspaceId: defaultWorkspaceId,
    user: seedData.users[0],
    role: { ...seedData.roles[0], permissions: ["crm.read", "crm.write", "ai.use"] }
  };
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, new Date().toISOString());
  settings.features = {
    draft: true,
    translate: true,
    auto_translate: true,
    context_analysis: true,
    auto_context_analysis: true,
    auto_summarize: true
  };
  const message = {
    id: "message-automation-failure",
    workspaceId: defaultWorkspaceId,
    threadId: "thread-automation-failure",
    accountId: "account-automation-failure",
    direction: "inbound",
    status: "received",
    from: "buyer@example.com",
    to: ["sales@example.com"],
    subject: "Automation failure",
    bodyText: "This email should still be recorded.",
    createdAt: new Date().toISOString()
  };
  const audits = [];
  const repository = {
    async recordEmailAiGeneration(_context, input) {
      audits.push(input);
    }
  };
  const executor = {
    async runEmailClassifyJob() {
      throw new Error("classification provider unavailable");
    },
    async runEmailTranslateJob() {
      throw new Error("translate provider unavailable");
    },
    async runEmailAnalyzeJob() {
      throw new Error("analysis provider unavailable");
    },
    async runEmailSummarizeJob() {
      throw new Error("summary queue unavailable");
    }
  };

  await assert.doesNotReject(() => runEmailAutomationsBestEffort(context, repository, executor, message, settings));
  assert.equal(audits.length, 4);
  assert.equal(audits.every((audit) => audit.enabled === false && audit.automationFailed === true), true);
  assert.equal(audits.some((audit) => audit.purpose === "classification" && audit.sourceMessageId === message.id && /classification provider/.test(audit.errorMessage)), true);
  assert.equal(audits.some((audit) => audit.purpose === "translate" && audit.sourceMessageId === message.id && /translate provider/.test(audit.errorMessage)), true);
  assert.equal(audits.some((audit) => audit.purpose === "context_analysis" && audit.sourceMessageId === message.id && /analysis provider/.test(audit.errorMessage)), true);
  assert.equal(audits.some((audit) => audit.purpose === "summarize" && audit.threadId === message.threadId && /summary queue/.test(audit.errorMessage)), true);
});

await run("email ai automations run only for committed communication states", async () => {
  const context = {
    workspaceId: defaultWorkspaceId,
    user: seedData.users[0],
    role: { ...seedData.roles[0], permissions: ["crm.read", "crm.write", "ai.use"] }
  };
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, new Date().toISOString());
  settings.features = {
    draft: true,
    translate: true,
    auto_translate: true,
    context_analysis: true,
    auto_context_analysis: true,
    auto_summarize: true
  };
  const baseMessage = {
    id: "message-automation-state",
    workspaceId: defaultWorkspaceId,
    threadId: "thread-automation-state",
    accountId: "account-automation-state",
    from: "sales@example.com",
    to: ["buyer@example.com"],
    subject: "Automation state",
    bodyText: "This message should only run automation after delivery.",
    createdAt: new Date().toISOString()
  };
  const calls = [];
  const repository = {
    async recordEmailAiGeneration() {
      throw new Error("should not audit successful automation");
    }
  };
  const executor = {
    async runEmailTranslateJob() {
      calls.push("translate");
      return { ...baseMessage, direction: "inbound", status: "received" };
    },
    async runEmailAnalyzeJob() {
      calls.push("analyze");
      return {};
    },
    async runEmailSummarizeJob() {
      calls.push("summarize");
      return {};
    }
  };

  const queuedOutbound = { ...baseMessage, direction: "outbound", status: "queued" };
  const failedOutbound = { ...baseMessage, direction: "outbound", status: "failed" };
  const sentOutbound = { ...baseMessage, direction: "outbound", status: "sent", sentAt: new Date().toISOString() };

  assert.equal(isEmailMessageEligibleForAutomation(queuedOutbound), false);
  assert.equal(isEmailMessageEligibleForAutomation(failedOutbound), false);
  assert.equal(isEmailMessageEligibleForAutomation(sentOutbound), true);

  await runEmailAutomationsBestEffort(context, repository, executor, queuedOutbound, settings);
  await runEmailAutomationsBestEffort(context, repository, executor, failedOutbound, settings);
  assert.deepEqual(calls, []);

  await runEmailAutomationsBestEffort(context, repository, executor, sentOutbound, settings);
  assert.deepEqual(calls, ["summarize"]);
});

await run("sent outbound status updates trigger auto summary after delivery", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, {
    features: { auto_summarize: true },
    maxHistoryMessages: 1,
    requireSourceLinks: true
  });
  const account = store.createEmailAccount(context, {
    name: "Automation Delivery Mailbox",
    emailAddress: "automation-delivery@example.com",
    provider: "smtp_imap",
    status: "active",
    sendEnabled: true,
    syncEnabled: false
  });
  const queued = store.queueEmailMessage(context, {
    accountId: account.id,
    to: ["buyer@example.com"],
    subject: "Delivered outbound summary",
    bodyText: "Summarize this only after it is delivered."
  });
  assert.equal(store.getEmailThread(context, queued.threadId).summaryUpdatedAt, undefined);

  const sent = store.updateEmailMessageStatus(context, queued.id, "sent", { externalMessageId: "<delivered-summary@example.com>" });
  assert.equal(sent.status, "sent");
  await flushAsyncWork();

  const thread = store.getEmailThread(context, queued.threadId);
  assert.equal(Boolean(thread.summaryUpdatedAt), true);
  const summaryAudits = store.listAuditLogs(context, { entityType: "email_ai_generation" }).filter((audit) => audit.details?.purpose === "summarize" && audit.details?.threadId === queued.threadId);
  assert.equal(summaryAudits.length >= 1, true);
});

await run("email ai automation scheduling does not block email intake", async () => {
  const context = {
    workspaceId: defaultWorkspaceId,
    user: seedData.users[0],
    role: { ...seedData.roles[0], permissions: ["crm.read", "crm.write", "ai.use"] }
  };
  const settings = createDefaultEmailAiSettings(defaultWorkspaceId, new Date().toISOString());
  settings.features = {
    draft: true,
    translate: true,
    auto_translate: true,
    context_analysis: true,
    auto_context_analysis: false,
    auto_summarize: false
  };
  settings.agents = settings.agents.map((agent) => (agent.key === emailClassificationAgentKey ? { ...agent, enabled: false } : agent));
  const message = {
    id: "message-automation-slow",
    workspaceId: defaultWorkspaceId,
    threadId: "thread-automation-slow",
    accountId: "account-automation-slow",
    direction: "inbound",
    status: "received",
    from: "buyer@example.com",
    to: ["sales@example.com"],
    subject: "Slow automation",
    bodyText: "This email should return before automation finishes.",
    createdAt: new Date().toISOString()
  };
  const audits = [];
  let releaseAutomation;
  const automationStarted = new Promise((resolveStarted) => {
    const executor = {
      async runEmailClassifyJob() {
        throw new Error("should not run");
      },
      async runEmailTranslateJob() {
        resolveStarted();
        await new Promise((resolveRelease) => {
          releaseAutomation = resolveRelease;
        });
        throw new Error("slow translate failed");
      },
      async runEmailAnalyzeJob() {
        throw new Error("should not run");
      },
      async runEmailSummarizeJob() {
        throw new Error("should not run");
      }
    };
    scheduleEmailAutomationsBestEffort(context, { recordEmailAiGeneration: async (_context, input) => audits.push(input) }, executor, message, settings);
  });

  assert.equal(audits.length, 0);
  await automationStarted;
  assert.equal(audits.length, 0);
  releaseAutomation();
  await flushAsyncWork();
  assert.equal(audits.length, 1);
  assert.equal(audits[0].automationFailed, true);
  assert.match(audits[0].errorMessage, /slow translate failed/);
});

await run("email send sync and ai schemas validate bounded payloads", () => {
  assert.equal(emailSendSchema.parse({
    accountId: "email-account",
    to: ["buyer@example.com"],
    cc: ["manager@example.com"],
    bcc: ["archive@example.com"],
    subject: "Follow up",
    bodyText: "Thanks for your time.",
    signatureName: "Cigafun",
    clientRequestId: "send-request-123",
    attachments: [{ fileName: "proposal.txt", contentType: "text/plain", size: 11, contentBase64: Buffer.from("hello world").toString("base64") }]
  }).clientRequestId, "send-request-123");
  assert.equal(emailSyncSchema.parse({ accountId: "email-account", limit: 50 }).limit, 50);
  assert.throws(() => emailSyncSchema.parse({ accountId: "email-account", limit: 101 }), z.ZodError);
  assert.equal(emailSyncAllSchema.parse({ limit: 40 }).limit, 40);
  assert.deepEqual(emailSyncAllSchema.parse({}), {});
  assert.throws(() => emailSyncAllSchema.parse({ accountId: "email-account", limit: 40 }), z.ZodError);
  assert.throws(() => emailSyncAllSchema.parse({ limit: 0 }), z.ZodError);
  assert.equal(emailConnectionTestSchema.parse({ accountId: "email-account" }).accountId, "email-account");
  assert.deepEqual(emailMessageTranslateSchema.parse({}), {});
  assert.equal(emailMessageTranslateSchema.parse({ targetLocale: "en-US" }).targetLocale, "en-US");
  assert.throws(() => emailMessageTranslateSchema.parse({ targetLocale: "e" }), z.ZodError);
  assert.throws(() => emailMessageTranslateSchema.parse({ targetLocale: "x".repeat(21) }), z.ZodError);
  assert.equal(
    emailMessageCreateSchema.parse({
      accountId: "email-account",
      direction: "inbound",
      status: "received",
      from: "buyer@example.com",
      to: ["sales@example.com"],
      subject: "Inbound",
      bodyText: "Received through a provider or controlled import."
    }).direction,
    "inbound"
  );
  assert.throws(
    () =>
      emailMessageCreateSchema.parse({
        accountId: "email-account",
        direction: "outbound",
        status: "sent",
        from: "sales@example.com",
        to: ["buyer@example.com"],
        subject: "Bypass send",
        bodyText: "This should go through /api/email/send."
      }),
    /use \/api\/email\/send/
  );
  assert.throws(
    () =>
      emailMessageCreateSchema.parse({
        accountId: "email-account",
        direction: "inbound",
        status: "sent",
        from: "buyer@example.com",
        to: ["sales@example.com"],
        subject: "Wrong inbound status",
        bodyText: "Inbound public records must be received."
      }),
    /received status/
  );
  assert.equal(emailAiSettingsUpdateSchema.parse({ features: { auto_context_analysis: true } }).features.auto_context_analysis, true);
  assert.equal(emailAiGenerateSchema.parse({ purpose: "draft", recordId: "record-1", userPrompt: "short follow-up" }).purpose, "draft");
  assert.deepEqual(emailAiGenerateSchema.parse({ purpose: "draft", recordId: "record-1", userPrompt: "short follow-up", productIds: ["product-1"], productQuery: "docker" }).productIds, ["product-1"]);
  assert.equal(emailSendSchema.parse({ accountId: "email-account", to: ["buyer@example.com"], subject: "Hello", bodyText: "Body", skipAutoLink: true }).skipAutoLink, true);
  assert.equal(emailAiGenerateSchema.parse({ purpose: "draft", sourceMessageId: "message-1" }).sourceMessageId, "message-1");
  assert.equal(emailAiGenerateSchema.parse({ purpose: "translate", threadId: "thread-1", sourceMessageId: "message-1", sourceText: "hola" }).sourceMessageId, "message-1");
  assert.equal(emailAiGenerateSchema.parse({ purpose: "context_analysis", threadId: "thread-1" }).threadId, "thread-1");
  assert.equal(emailAiGenerateSchema.parse({ purpose: "summarize", threadId: "thread-1" }).purpose, "summarize");
  assert.equal(emailAiGenerateSchema.parse({ purpose: "summarize", sourceMessageId: "message-1" }).sourceMessageId, "message-1");
  assert.throws(() => emailAiGenerateSchema.parse({ purpose: "draft" }), z.ZodError);
  assert.throws(() => emailAiGenerateSchema.parse({ purpose: "translate", sourceMessageId: "message-1" }), z.ZodError);
  assert.throws(() => emailAiGenerateSchema.parse({ purpose: "context_analysis" }), z.ZodError);
  assert.throws(() => emailAiGenerateSchema.parse({ purpose: "summarize" }), z.ZodError);
  assert.throws(() => emailAiGenerateSchema.parse({ purpose: "draft", userPrompt: "write a follow-up" }), z.ZodError);
  assert.throws(() => emailAiGenerateSchema.parse({ purpose: "translate", sourceText: "hola" }), z.ZodError);
  assert.throws(() => emailAiGenerateSchema.parse({ purpose: "context_analysis", sourceText: "standalone email text" }), z.ZodError);
  assert.throws(() => emailAiGenerateSchema.parse({ purpose: "summarize", sourceText: "standalone thread text" }), z.ZodError);
  const aiSettingsPatch = emailAiSettingsUpdateSchema.parse({ features: { auto_translate: true }, defaultLocale: "en-US", requireSourceLinks: false, maxHistoryMessages: 12, maxKnowledgeArticles: 4, maxContextChars: 12000 });
  assert.equal(aiSettingsPatch.features?.auto_translate, true);
  assert.equal(aiSettingsPatch.defaultLocale, "en-US");
  assert.equal(aiSettingsPatch.requireSourceLinks, false);
  assert.equal(aiSettingsPatch.maxHistoryMessages, 12);
  assert.equal(aiSettingsPatch.maxKnowledgeArticles, 4);
  assert.equal(aiSettingsPatch.maxContextChars, 12000);
  assert.throws(() => emailAiSettingsUpdateSchema.parse({ maxContextChars: 999 }), z.ZodError);
  assert.equal(
    aiTalkRequestSchema.parse({
      target: { type: "record", objectKey: "contacts", recordId: "contact-1" },
      question: "What should we do next?",
      history: [{ role: "assistant", content: "Use the CRM context." }]
    }).target.type,
    "record"
  );
  assert.equal(
    aiTalkRequestSchema.parse({
      target: { type: "email_thread", threadId: "thread-1" },
      question: "Summarize the risk."
    }).target.type,
    "email_thread"
  );
  assert.throws(() => aiTalkRequestSchema.parse({ target: { type: "record", objectKey: "Contacts", recordId: "contact-1" }, question: "bad object key" }), z.ZodError);
  assert.throws(() => aiTalkRequestSchema.parse({ target: { type: "email_thread" }, question: "missing thread" }), z.ZodError);
  assert.equal(emailAccountUpdateSchema.parse({ status: "disabled", syncEnabled: false, sendEnabled: false }).status, "disabled");
  assert.equal(
    emailAccountUpdateSchema.parse({
      connectionConfig: { smtpHost: "smtp.example.com", smtpPort: 587, smtpSecure: false, smtpStartTls: true, username: "sales@example.com", password: "app-password" }
    }).connectionConfig?.smtpHost,
    "smtp.example.com"
  );
  assert.equal(
    emailAccountUpdateSchema.parse({
      connectionConfig: { smtpHost: "smtp.example.com", smtpPort: 587, smtpStartTls: true, username: "sales@example.com", password: "app-password" }
    }).connectionConfig?.smtpStartTls,
    true
  );
});

await run("email provider test connection requires encrypted config", async () => {
  const fakeRepository = {
    async getEmailAccount() {
      return {
        id: "email-account",
        workspaceId: defaultWorkspaceId,
        name: "Sales inbox",
        emailAddress: "sales@example.com",
        provider: "smtp_imap",
        status: "active",
        syncEnabled: true,
        sendEnabled: true,
        connectionConfigured: false,
        createdById: "user-admin",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    },
    async getEmailAccountConnectionConfig() {
      return undefined;
    }
  };
  const adapter = createEmailProviderAdapter(fakeRepository);
  await assert.rejects(
    () => adapter.testConnection({ workspaceId: defaultWorkspaceId, user: seedData.users[0], role: seedData.roles[0] }, "email-account"),
    /not configured/
  );
});

await run("queued email send enforces outbound recipient policy before provider delivery", async () => {
  const account = {
    id: "policy-account",
    workspaceId: defaultWorkspaceId,
    name: "Policy Account",
    emailAddress: "sales@example.com",
    provider: "smtp_imap",
    status: "active",
    syncEnabled: true,
    sendEnabled: true,
    connectionConfigured: true,
    createdById: "user-admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const message = {
    id: "policy-message",
    workspaceId: defaultWorkspaceId,
    threadId: "policy-thread",
    accountId: account.id,
    direction: "outbound",
    status: "queued",
    from: account.emailAddress,
    to: ["buyer@example.com"],
    cc: ["BUYER@example.com"],
    bcc: [],
    subject: "Duplicate recipient",
    bodyText: "Body",
    attachments: [],
    createdAt: new Date().toISOString()
  };
  let deliveryAttempted = false;
  let failedReason = "";
  const fakeRepository = {
    async getEmailMessage() {
      return message;
    },
    async getEmailAccount() {
      return account;
    },
    async listEmailMessages() {
      return [];
    },
    async getEmailAccountConnectionConfig() {
      deliveryAttempted = true;
      return { smtpHost: "smtp.example.com", smtpPort: 465, smtpSecure: true, username: "sales@example.com", password: "app-password" };
    },
    async updateEmailMessageStatus(_context, messageId, status, patch) {
      assert.equal(messageId, message.id);
      assert.equal(status, "failed");
      failedReason = patch.failureReason;
      return { ...message, status, failureReason: patch.failureReason };
    }
  };
  const adapter = createEmailProviderAdapter(fakeRepository);

  await assert.rejects(
    () => adapter.sendQueued({ workspaceId: defaultWorkspaceId, user: seedData.users[0], role: seedData.roles[0] }, message.id),
    /must be unique/
  );
  assert.equal(deliveryAttempted, false);
  assert.match(failedReason, /must be unique/);
});

await run("oauth email provider test connection probes provider api and persists refreshed tokens", async () => {
  const account = {
    id: "gmail-test-account",
    workspaceId: defaultWorkspaceId,
    name: "Gmail Test",
    emailAddress: "gmail-test@example.com",
    provider: "gmail",
    status: "active",
    syncEnabled: true,
    sendEnabled: true,
    connectionConfigured: true,
    createdById: "user-admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const requestedUrls = [];
  let persistedConfig;
  const fakeRepository = {
    async getEmailAccount() {
      return account;
    },
    async getEmailAccountConnectionConfig() {
      return { oauthProvider: "gmail", accessToken: "old-access-token", refreshToken: "refresh-token", expiresAt: "2026-06-20T09:59:00.000Z" };
    },
    async updateEmailAccountConnectionConfig(_context, accountId, config) {
      assert.equal(accountId, account.id);
      persistedConfig = config;
      return account;
    },
    async markEmailAccountConnectionError(_context, accountId, errorMessage) {
      assert.equal(accountId, account.id);
      assert.equal(errorMessage, null);
      return { ...account, lastConnectionError: undefined };
    }
  };
  const adapter = createEmailProviderAdapter(fakeRepository, {
    oauth: {
      now: new Date("2026-06-20T10:00:00.000Z"),
      providerConfig: { tokenUrl: "https://oauth.example/token", clientId: "client-id", clientSecret: "client-secret" },
      fetchImpl: async (url) => {
        const requestUrl = String(url);
        requestedUrls.push(requestUrl);
        if (requestUrl === "https://oauth.example/token") {
          return new Response(JSON.stringify({ access_token: "new-access-token", expires_in: 3600, token_type: "Bearer" }), { status: 200 });
        }
        assert.equal(requestUrl, "https://gmail.googleapis.com/gmail/v1/users/me/profile");
        return new Response(JSON.stringify({ emailAddress: account.emailAddress }), { status: 200 });
      }
    }
  });

  const result = await adapter.testConnection({ workspaceId: defaultWorkspaceId, user: seedData.users[0], role: seedData.roles[0] }, account.id);

  assert.equal(result.result.oauth, "ok");
  assert.equal(result.result.oauthAccountEmail, account.emailAddress);
  assert.deepEqual(requestedUrls, ["https://oauth.example/token", "https://gmail.googleapis.com/gmail/v1/users/me/profile"]);
  assert.equal(persistedConfig.accessToken, "new-access-token");
  assert.equal(persistedConfig.expiresAt, "2026-06-20T11:00:00.000Z");
});

await run("oauth email connection schema accepts bounded token config", () => {
  const parsed = emailConnectionTestSchema.parse({ accountId: "email-account" });
  assert.equal(parsed.accountId, "email-account");
  assert.equal(emailOAuthStartSchema.parse({ provider: "gmail", emailAddress: "gmail@example.com" }).provider, "gmail");
  assert.equal(emailAccountCreateSchema.parse({
    name: "Gmail",
    emailAddress: "gmail@example.com",
    provider: "gmail",
    connectionConfig: {
      oauthProvider: "gmail",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: "2099-06-20T12:00:00.000Z",
      scope: "https://mail.google.com/"
    }
  }).provider, "gmail");
});

await run("oauth authorization flow signs state builds urls and exchanges codes", async () => {
  const secret = "test-oauth-state-secret-32-bytes";
  const state = createEmailOAuthState(
    {
      provider: "gmail",
      workspaceId: defaultWorkspaceId,
      userId: "user-admin",
      emailAddress: "gmail@example.com",
      name: "Gmail Inbox",
      syncEnabled: true,
      sendEnabled: true
    },
    secret
  );
  const verified = verifyEmailOAuthState(state, secret, new Date(Date.now() + 1000));
  assert.equal(verified.emailAddress, "gmail@example.com");
  assert.throws(() => verifyEmailOAuthState(`${state.slice(0, -2)}xx`, secret), /signature/);

  const authorizationUrl = buildOAuthAuthorizationUrl({
    provider: "gmail",
    redirectUri: "https://crm.example.com/api/email/oauth/callback",
    state,
    providerConfig: {
      authUrl: "https://accounts.example/auth",
      tokenUrl: "https://accounts.example/token",
      clientId: "client-id",
      clientSecret: "client-secret",
      scope: "mail.scope"
    }
  });
  const parsedUrl = new URL(authorizationUrl);
  assert.equal(parsedUrl.searchParams.get("client_id"), "client-id");
  assert.equal(parsedUrl.searchParams.get("redirect_uri"), "https://crm.example.com/api/email/oauth/callback");
  assert.equal(parsedUrl.searchParams.get("state"), state);
  assert.equal(parsedUrl.searchParams.get("access_type"), "offline");

  let requestedBody = "";
  const config = await exchangeOAuthAuthorizationCode({
    provider: "gmail",
    code: "authorization-code",
    redirectUri: "https://crm.example.com/api/email/oauth/callback",
    now: new Date("2026-06-20T10:00:00.000Z"),
    providerConfig: { tokenUrl: "https://accounts.example/token", clientId: "client-id", clientSecret: "client-secret", scope: "mail.scope" },
    fetchImpl: async (_url, init) => {
      requestedBody = String(init?.body);
      return new Response(JSON.stringify({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600, token_type: "Bearer" }), { status: 200 });
    }
  });
  assert.match(requestedBody, /grant_type=authorization_code/);
  assert.equal(config.oauthProvider, "gmail");
  assert.equal(config.accessToken, "access-token");
  assert.equal(config.refreshToken, "refresh-token");
  assert.equal(config.expiresAt, "2026-06-20T11:00:00.000Z");
});

await run("email connection config is encrypted and requires a stable secret", () => {
  const secret = "test-email-config-secret-32-bytes";
  const encrypted = encryptEmailConnectionConfig(
    {
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      smtpSecure: true,
      imapHost: "imap.example.com",
      imapPort: 993,
      imapSecure: true,
      username: "sales@example.com",
      password: "app-password",
      mailbox: "INBOX"
    },
    secret
  );

  assert.equal(encrypted.includes("app-password"), false);
  const decrypted = decryptEmailConnectionConfig(encrypted, secret);
  assert.equal(decrypted.smtpHost, "smtp.example.com");
  assert.equal(decrypted.password, "app-password");
  assert.throws(() => encryptEmailConnectionConfig({ username: "sales@example.com", password: "secret" }, "short"), /at least 16 characters/);
});

await run("email connection config separates inbound mailbox and outbound services", () => {
  const normalized = normalizeEmailConnectionConfig({
    inbound: {
      syncProtocol: "imap",
      imapHost: "imap.example.com",
      username: "inbound-user",
      password: "inbound-password"
    },
    outboundServices: [
      {
        id: "resend",
        name: "Resend",
        type: "resend",
        fromEmail: "sales@example.com",
        resendApiKey: "re_test_key"
      },
      {
        id: "smtp",
        name: "SMTP",
        type: "smtp",
        smtpHost: "smtp.example.com",
        username: "smtp-user",
        password: "smtp-password"
      }
    ],
    defaultOutboundServiceId: "resend"
  });

  assert.equal(getInboundConnectionConfig(normalized).username, "inbound-user");
  assert.equal(getDefaultOutboundService(normalized)?.type, "resend");
  assert.equal(getDefaultOutboundService(normalized)?.resendApiKey, "re_test_key");

  const legacy = normalizeEmailConnectionConfig({
    smtpHost: "smtp.legacy.example",
    imapHost: "imap.legacy.example",
    username: "legacy-user",
    password: "legacy-password"
  });
  assert.equal(getInboundConnectionConfig(legacy).imapHost, "imap.legacy.example");
  assert.equal(getDefaultOutboundService(legacy)?.type, "smtp");
  assert.equal(getDefaultOutboundService(legacy)?.username, "legacy-user");
});

await run("smtp transport resolves direct tls starttls and plaintext ports", () => {
  assert.deepEqual(resolveSmtpTransport({ smtpHost: "smtp.example.com", smtpSecure: true }), { port: 465, secure: true, startTls: false });
  assert.deepEqual(resolveSmtpTransport({ smtpHost: "smtp.example.com", smtpSecure: false }), { port: 25, secure: false, startTls: false });
  assert.deepEqual(resolveSmtpTransport({ smtpHost: "smtp.example.com", smtpStartTls: true }), { port: 587, secure: false, startTls: true });
  assert.deepEqual(resolveSmtpTransport({ smtpHost: "smtp.example.com", smtpPort: 2525, smtpStartTls: true }), { port: 2525, secure: false, startTls: true });
  const source = readFileSync("src/lib/email/smtp-imap.ts", "utf8");
  assert.match(source, /function isTransientDnsError\(error: unknown\): boolean/);
  assert.match(source, /code === "EAI_AGAIN"/);
  assert.match(source, /dnsRetryDelaysMs = \[500, 1_500, 3_000\]/);
  assert.match(source, /SMTP 服务器域名/);
});

await run("smtp provider encodes non-ascii message headers", async () => {
  const smtp = await startFakeSmtpServer();
  try {
    await sendSmtpEmail(
      {
        smtpHost: "127.0.0.1",
        smtpPort: smtp.port,
        smtpSecure: false,
        username: "sales@example.com",
        password: "password"
      },
      {
        accountId: "smtp-account",
        to: ["buyer@example.com"],
        cc: ["manager@example.com"],
        bcc: ["archive@example.com"],
        subject: "报价方案",
        bodyText: "请查看附件。",
        messageId: "smtp-non-ascii-message",
        attachments: [
          {
            fileName: "报价.txt",
            contentType: "text/plain",
            size: 6,
            contentBase64: Buffer.from("hello").toString("base64")
          }
        ]
      },
      "sales@example.com"
    );
    const raw = smtp.message();
    const encodedSubject = Buffer.from("报价方案", "utf8").toString("base64");
    const encodedFileName = Buffer.from("报价.txt", "utf8").toString("base64");
    assert.match(raw, new RegExp(`^Subject: =\\?UTF-8\\?B\\?${encodedSubject}\\?=$`, "m"));
    assert.match(raw, new RegExp(`filename="=\\?UTF-8\\?B\\?${encodedFileName}\\?="`));
    assert.doesNotMatch(raw, /^Subject: 报价方案$/m);
    assert.match(raw, /Message-ID: <smtp-non-ascii-message@ai-agent-crm\.local>/);
  } finally {
    await smtp.close();
  }
});

await run("resend outbound service sends with api key and mapped from address", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ id: "resend-message-id" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await sendResendEmail(
      {
        id: "resend",
        name: "Resend",
        type: "resend",
        fromEmail: "sales@example.com",
        resendApiKey: "re_test_key"
      },
      {
        accountId: "email-account",
        to: ["buyer@example.com"],
        subject: "Resend quote",
        bodyText: "Hello from Resend"
      },
      "fallback@example.com"
    );
    assert.equal(result.externalMessageId, "resend-message-id");
    assert.equal(requests[0]?.url, "https://api.resend.com/emails");
    assert.equal(requests[0]?.init?.headers?.authorization, "Bearer re_test_key");
    assert.equal(JSON.parse(requests[0]?.init?.body).from, "sales@example.com");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await run("imap raw email parser extracts multipart body and attachments", () => {
  const raw = [
    "Message-ID: <imap-message@example.com>",
    "From: Buyer <buyer@example.com>",
    "To: Sales <sales@example.com>",
    "Cc: Manager <manager@example.com>, reviewer@example.com",
    "Subject: =?UTF-8?B?UHJvcG9zYWwgZmlsZXM=?=",
    "Date: Sat, 20 Jun 2026 10:30:00 +0000",
    "Content-Type: multipart/mixed; boundary=\"crm-boundary\"",
    "",
    "--crm-boundary",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Hello=2C please review the attached proposal.",
    "--crm-boundary",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<p>Hello, please review the <strong>attached</strong> proposal.</p>",
    "--crm-boundary",
    "Content-Type: text/plain; name=\"=?UTF-8?B?cHJvcG9zYWwudHh0?=\"",
    "Content-Disposition: attachment; filename=\"=?UTF-8?B?cHJvcG9zYWwudHh0?=\"",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("proposal body", "utf8").toString("base64"),
    "--crm-boundary--",
    ""
  ].join("\r\n");

  const parsed = parseRawEmailMessage(raw);
  assert.equal(parsed?.externalMessageId, "<imap-message@example.com>");
  assert.equal(parsed?.from, "buyer@example.com");
  assert.deepEqual(parsed?.to, ["sales@example.com"]);
  assert.deepEqual(parsed?.cc, ["manager@example.com", "reviewer@example.com"]);
  assert.equal(parsed?.subject, "Proposal files");
  assert.equal(parsed?.bodyText, "Hello, please review the attached proposal.");
  assert.equal(parsed?.bodyHtml, "<p>Hello, please review the <strong>attached</strong> proposal.</p>");
  assert.equal(parsed?.attachments?.[0]?.fileName, "proposal.txt");
  assert.equal(parsed?.attachments?.[0]?.contentType, "text/plain");
  assert.equal(Buffer.from(parsed?.attachments?.[0]?.contentBase64 ?? "", "base64").toString("utf8"), "proposal body");
  assert.equal(parsed?.attachments?.[0]?.size, "proposal body".length);
});

await run("imap raw email parser decodes quoted printable charset html bodies", () => {
  const raw = [
    "Message-ID: <instagram-message@example.com>",
    "From: Instagram <no-reply@mail.instagram.com>",
    "To: Info <info@example.com>",
    "Subject: =?UTF-8?Q?=E7=9C=8B=E7=9C=8B_Instagram_=E4=B8=8A=E7=9A=84=E6=96=B0=E9=B2=9C=E4=BA=8B=E5=90=A7?=",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "<p>=E4=BD=A0=E5=A5=BD Instagram</p>"
  ].join("\r\n");

  const parsed = parseRawEmailMessage(raw);
  assert.equal(parsed?.subject, "看看 Instagram 上的新鲜事吧");
  assert.equal(parsed?.bodyHtml, "<p>你好 Instagram</p>");
  assert.equal(parsed?.bodyText, "你好 Instagram");
});

await run("imap raw email parser ignores invalid recipient headers and keeps valid addresses", () => {
  const parsed = parseRawEmailMessage(
    [
      "Message-ID: <invalid-recipients@example.com>",
      "From: Sam Lau <sam@example.com>",
      "To: undisclosed-recipients:;",
      "Cc: Not an email, Manager <manager@example.com>",
      "Subject: Invalid recipients",
      "",
      "Hello"
    ].join("\r\n")
  );

  assert.equal(parsed?.from, "sam@example.com");
  assert.deepEqual(parsed?.to, []);
  assert.deepEqual(parsed?.cc, ["manager@example.com"]);
  assert.equal(parsed?.subject, "Invalid recipients");
});

await run("email inbound metadata geo lookup tolerates esm geoip-lite exports", () => {
  const metadata = extractInboundMetadata({
    received: "from mail.example.com (mail.example.com [8.8.8.8]) by mx.example.com with ESMTPS id abc"
  });
  assert.equal(metadata?.sourceIp, "8.8.8.8");
});

await run("email mojibake repair recovers already-stored utf8 text decoded as windows-1252", () => {
  const mojibake = new TextDecoder("windows-1252").decode(Buffer.from("看看 Instagram 上的新鲜事吧", "utf8"));
  assert.notEqual(mojibake, "看看 Instagram 上的新鲜事吧");
  assert.equal(repairEmailMojibake(mojibake), "看看 Instagram 上的新鲜事吧");
  assert.equal(repairEmailMojibake(`<p>${mojibake}</p>`), "<p>看看 Instagram 上的新鲜事吧</p>");

  const parsed = parseRawEmailMessage(
    [
      "Message-ID: <mojibake@example.com>",
      "From: Instagram <no-reply@mail.instagram.com>",
      "To: Info <info@example.com>",
      "Content-Type: text/html; charset=utf-8",
      "",
      `<p>${mojibake}</p>`
    ].join("\r\n")
  );
  assert.equal(parsed?.bodyHtml, "<p>看看 Instagram 上的新鲜事吧</p>");
  assert.equal(parsed?.bodyText, "看看 Instagram 上的新鲜事吧");
});

await run("imap sync fallback message ids prevent duplicate imports without message-id headers", () => {
  const parsed = parseRawEmailMessage(
    [
      "From: Buyer <buyer@example.com>",
      "To: Sales <sales@example.com>",
      "Subject: Missing message id",
      "",
      "This mailbox provider omitted Message-ID."
    ].join("\r\n")
  );
  assert.ok(parsed);
  assert.equal(parsed.externalMessageId, undefined);
  assert.equal(buildImapFallbackExternalMessageId("INBOX/Sales Team", "42"), "imap:inbox_sales_team:42");

  const withFallback = withImapFallbackExternalMessageId(parsed, "INBOX/Sales Team", "42");
  assert.equal(withFallback.externalMessageId, "imap:inbox_sales_team:42");

  const withProviderId = withImapFallbackExternalMessageId({ ...parsed, externalMessageId: "<provider@example.com>" }, "INBOX", "43");
  assert.equal(withProviderId.externalMessageId, "<provider@example.com>");
});

await run("imap provider fetches a bounded recent sequence range without scanning the whole mailbox", async () => {
  const net = await import("node:net");
  const commands = [];
  const messageForSequence = (sequenceNumber) =>
    [
      `From: Buyer ${sequenceNumber} <buyer${sequenceNumber}@example.com>`,
      "To: Sales <sales@example.com>",
      `Subject: Test ${sequenceNumber}`,
      `Date: Wed, 01 Jul 2026 00:0${sequenceNumber}:00 +0000`,
      "",
      `Message ${sequenceNumber}`
    ].join("\r\n");
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("* OK fake imap ready\r\n");
    socket.on("data", (chunk) => {
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
        const match = line.match(/^(\S+)\s+(.+)$/);
        if (!match) {
          continue;
        }
        const [, tag, command] = match;
        commands.push(command);
        if (/^CAPABILITY\b/i.test(command)) {
          socket.write(`* CAPABILITY IMAP4rev1 UIDPLUS\r\n${tag} OK CAPABILITY completed\r\n`);
          continue;
        }
        if (/^LOGIN\b/i.test(command)) {
          socket.write(`${tag} OK LOGIN completed\r\n`);
          continue;
        }
        if (/^(LIST|LSUB)\b/i.test(command)) {
          const listCommand = command.toUpperCase().startsWith("LSUB") ? "LSUB" : "LIST";
          socket.write(`* ${listCommand} (\\HasNoChildren) "/" "INBOX"\r\n${tag} OK ${listCommand} completed\r\n`);
          continue;
        }
        if (/^(SELECT|EXAMINE)\b/i.test(command)) {
          const openCommand = command.split(/\s+/)[0].toUpperCase();
          socket.write(`* FLAGS (\\Seen)\r\n* 4 EXISTS\r\n* OK [UIDVALIDITY 20260709] UIDs valid\r\n* OK [UIDNEXT 1005] Predicted next UID\r\n${tag} OK [READ-ONLY] ${openCommand} completed\r\n`);
          continue;
        }
        const searchMatch = command.match(/^UID SEARCH\s+(?:UID\s+)?(\d+):\*$/i);
        if (searchMatch) {
          const startSequenceNumber = Number(searchMatch[1]);
          const uids = [1, 2, 3, 4].filter((sequenceNumber) => sequenceNumber >= startSequenceNumber).map((sequenceNumber) => String(1000 + sequenceNumber));
          socket.write(`* SEARCH ${uids.join(" ")}\r\n${tag} OK SEARCH completed\r\n`);
          continue;
        }
        const fetchMatch = command.match(/^UID FETCH\s+(\d+)\s+\(UID (?:RFC822\.SIZE )?BODY\.PEEK\[\]<0\.(\d+)>\)$/i);
        if (fetchMatch) {
          const sequenceNumber = Number(fetchMatch[1]) - 1000;
          const raw = messageForSequence(sequenceNumber);
          socket.write(`* ${sequenceNumber} FETCH (UID ${1000 + sequenceNumber} BODY[] {${Buffer.byteLength(raw, "utf8")}}\r\n${raw}\r\n)\r\n${tag} OK FETCH completed\r\n`);
          continue;
        }
        if (/^LOGOUT\b/i.test(command)) {
          socket.write(`* BYE logging out\r\n${tag} OK LOGOUT completed\r\n`);
          continue;
        }
        socket.write(`${tag} BAD unsupported command\r\n`);
      }
    });
  });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  try {
    const address = server.address();
    const messages = await fetchRecentImapEmails(
      {
        imapHost: "127.0.0.1",
        imapPort: address.port,
        imapSecure: false,
        username: "user",
        password: "pass",
        mailbox: "INBOX"
      },
      3
    );
    assert.deepEqual(messages.map((message) => message.subject), ["Test 2", "Test 3", "Test 4"]);
    assert.equal(messages[0].externalMessageId, "imap:inbox:1002");
    assert.equal(commands.some((command) => /UID SEARCH (?:UID )?2:\*/i.test(command)), true);
    assert.equal(commands.some((command) => /^UID FETCH 1001\b/i.test(command)), false);
    assert.equal(commands.some((command) => /^UID FETCH 1002\b/i.test(command)), true);
    assert.equal(commands.some((command) => /^UID FETCH 1004\b/i.test(command)), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

await run("smtp and imap sent synchronization can reuse one stable rfc822 message", () => {
  const input = {
    accountId: "smtp-account",
    to: ["buyer@example.com"],
    cc: ["manager@example.com"],
    bcc: ["hidden@example.com"],
    subject: "Stable sent copy",
    bodyText: "Same bytes for SMTP and IMAP.",
    messageId: "stable-sent-copy"
  };
  const raw = buildRfc822Message(input, "sales@example.com");
  assert.match(raw, /Message-ID: <stable-sent-copy@ai-agent-crm\.local>/);
  assert.match(raw, /^To: buyer@example\.com$/m);
  assert.match(raw, /^Cc: manager@example\.com$/m);
  assert.doesNotMatch(raw, /^Bcc:/m);
  assert.equal(buildRfc822Message(input, "sales@example.com").replace(/^Date: .*$/m, "Date: normalized"), raw.replace(/^Date: .*$/m, "Date: normalized"));
});

await run("imap full resync paginates backward through historical messages", async () => {
  const net = await import("node:net");
  const commands = [];
  const messageForUid = (uid) => {
    const sequenceNumber = uid - 1000;
    return [
      `From: Buyer ${sequenceNumber} <buyer${sequenceNumber}@example.com>`,
      "To: Sales <sales@example.com>",
      `Subject: Full ${sequenceNumber}`,
      `Date: Wed, 01 Jul 2026 00:0${sequenceNumber}:00 +0000`,
      "",
      `Message ${sequenceNumber}`
    ].join("\r\n");
  };
  const writeFetch = (socket, tag, uid) => {
    const raw = messageForUid(uid);
    const sequenceNumber = uid - 1000;
    socket.write(`* ${sequenceNumber} FETCH (UID ${uid} BODY[] {${Buffer.byteLength(raw, "utf8")}}\r\n${raw}\r\n)\r\n${tag} OK FETCH completed\r\n`);
  };
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("* OK fake imap ready\r\n");
    socket.on("data", (chunk) => {
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
        const match = line.match(/^(\S+)\s+(.+)$/);
        if (!match) {
          continue;
        }
        const [, tag, command] = match;
        commands.push(command);
        if (/^CAPABILITY\b/i.test(command)) {
          socket.write(`* CAPABILITY IMAP4rev1 UIDPLUS\r\n${tag} OK CAPABILITY completed\r\n`);
          continue;
        }
        if (/^LOGIN\b/i.test(command)) {
          socket.write(`${tag} OK LOGIN completed\r\n`);
          continue;
        }
        if (/^(LIST|LSUB)\b/i.test(command)) {
          const listCommand = command.toUpperCase().startsWith("LSUB") ? "LSUB" : "LIST";
          socket.write(`* ${listCommand} (\\HasNoChildren) "/" "INBOX"\r\n${tag} OK ${listCommand} completed\r\n`);
          continue;
        }
        if (/^(SELECT|EXAMINE)\b/i.test(command)) {
          const openCommand = command.split(/\s+/)[0].toUpperCase();
          socket.write(`* FLAGS (\\Seen)\r\n* 4 EXISTS\r\n* OK [UIDVALIDITY 20260709] UIDs valid\r\n* OK [UIDNEXT 1005] Predicted next UID\r\n${tag} OK [READ-ONLY] ${openCommand} completed\r\n`);
          continue;
        }
        const searchMatch = command.match(/^UID SEARCH\s+(?:UID\s+)?(\d+):(\*|\d+)$/i);
        if (searchMatch) {
          const startUid = Number(searchMatch[1]);
          const endUid = searchMatch[2] === "*" ? Number.MAX_SAFE_INTEGER : Number(searchMatch[2]);
          const uids = [1001, 1002, 1003, 1004].filter((uid) => uid >= startUid && uid <= endUid);
          socket.write(`* SEARCH ${uids.join(" ")}\r\n${tag} OK SEARCH completed\r\n`);
          continue;
        }
        const fetchMatch = command.match(/^UID FETCH\s+(\d+)\s+\(UID (?:RFC822\.SIZE )?BODY\.PEEK\[\]<0\.(\d+)>\)$/i);
        if (fetchMatch) {
          writeFetch(socket, tag, Number(fetchMatch[1]));
          continue;
        }
        if (/^LOGOUT\b/i.test(command)) {
          socket.write(`* BYE logging out\r\n${tag} OK LOGOUT completed\r\n`);
          continue;
        }
        socket.write(`${tag} BAD unsupported command\r\n`);
      }
    });
  });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  try {
    const address = server.address();
    const config = {
      imapHost: "127.0.0.1",
      imapPort: address.port,
      imapSecure: false,
      username: "user",
      password: "pass",
      mailbox: "INBOX"
    };
    const firstPage = await fetchRecentImapEmailBatch(config, 2, { fullResync: true });
    const secondPage = await fetchRecentImapEmailBatch(config, 2, {
      fullResync: true,
      fullResyncBeforeUid: firstPage.fullResyncBeforeUid
    });

    assert.equal(firstPage.hasMore, true);
    assert.equal(firstPage.fullResyncBeforeUid, "1003");
    assert.equal(firstPage.imapLastSeenUid, "1004");
    assert.equal(secondPage.hasMore, false);
    assert.equal(secondPage.fullResyncBeforeUid, "1001");
    assert.equal(secondPage.imapLastSeenUid, "1002");
    assert.equal(commands.some((command) => /UID SEARCH (?:UID )?1:\*/i.test(command)), true);
    assert.equal(commands.some((command) => /UID SEARCH (?:UID )?1:1002/i.test(command)), true);
    assert.deepEqual(
      commands.filter((command) => /^UID FETCH\b/i.test(command)).map((command) => command.match(/^UID FETCH\s+(\d+)/i)?.[1]),
      ["1003", "1004", "1001", "1002"]
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

await run("imap raw email parser ignores malformed date headers", () => {
  const parsed = parseRawEmailMessage(
    [
      "Message-ID: <bad-date@example.com>",
      "From: Buyer <buyer@example.com>",
      "To: Sales <sales@example.com>",
      "Subject: Bad date",
      "Date: not a valid email date",
      "",
      "This email should still import."
    ].join("\r\n")
  );

  assert.equal(parsed?.subject, "Bad date");
  assert.equal(parsed?.receivedAt, undefined);
});

await run("imap raw email parser keeps oversized attachments as metadata only", () => {
  const oversized = Buffer.alloc(MAX_EMAIL_ATTACHMENT_BYTES + 1, "a").toString("base64");
  const raw = [
    "Message-ID: <large-imap-message@example.com>",
    "From: Buyer <buyer@example.com>",
    "To: Sales <sales@example.com>",
    "Subject: Large attachment",
    "Content-Type: multipart/mixed; boundary=\"large-boundary\"",
    "",
    "--large-boundary",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Large attachment attached.",
    "--large-boundary",
    "Content-Type: application/octet-stream; name=\"large.bin\"",
    "Content-Disposition: attachment; filename=\"large.bin\"",
    "Content-Transfer-Encoding: base64",
    "",
    oversized,
    "--large-boundary--",
    ""
  ].join("\r\n");

  const parsed = parseRawEmailMessage(raw);
  assert.equal(parsed?.attachments?.[0]?.fileName, "large.bin");
  assert.equal(parsed?.attachments?.[0]?.size, MAX_EMAIL_ATTACHMENT_BYTES + 1);
  assert.equal(parsed?.attachments?.[0]?.contentBase64, undefined);
  assert.equal(buildEmailAttachmentHref("large-message", 0, parsed?.attachments?.[0] ?? {}), undefined);
});

await run("imap raw email parser keeps malformed base64 attachments as metadata only", () => {
  const raw = [
    "Message-ID: <bad-attachment@example.com>",
    "From: Buyer <buyer@example.com>",
    "To: Sales <sales@example.com>",
    "Subject: Bad attachment",
    "Content-Type: multipart/mixed; boundary=\"bad-attachment-boundary\"",
    "",
    "--bad-attachment-boundary",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Broken attachment attached.",
    "--bad-attachment-boundary",
    "Content-Type: application/octet-stream; name=\"broken.bin\"",
    "Content-Disposition: attachment; filename=\"broken.bin\"",
    "Content-Transfer-Encoding: base64",
    "",
    "AA=A",
    "--bad-attachment-boundary--",
    ""
  ].join("\r\n");

  const parsed = parseRawEmailMessage(raw);
  assert.equal(parsed?.attachments?.[0]?.fileName, "broken.bin");
  assert.equal(parsed?.attachments?.[0]?.size, 0);
  assert.equal(parsed?.attachments?.[0]?.contentBase64, undefined);
});

await run("oauth email connection config is encrypted and refreshes expired tokens", async () => {
  const secret = "test-email-config-secret-32-bytes";
  const encrypted = encryptEmailConnectionConfig(
    {
      oauthProvider: "gmail",
      accessToken: "old-access-token",
      refreshToken: "refresh-token",
      expiresAt: "2026-06-20T09:59:30.000Z",
      scope: "https://mail.google.com/"
    },
    secret
  );
  assert.equal(encrypted.includes("refresh-token"), false);

  const decrypted = decryptEmailConnectionConfig(encrypted, secret);
  assertOAuthConfig("gmail", decrypted);
  assert.equal(shouldRefreshOAuthToken(decrypted, new Date("2026-06-20T10:00:00.000Z")), true);

  let requestedBody = "";
  const refreshed = await refreshOAuthAccessToken("gmail", decrypted, {
    now: new Date("2026-06-20T10:00:00.000Z"),
    providerConfig: { tokenUrl: "https://oauth.example/token", clientId: "client-id", clientSecret: "client-secret" },
    fetchImpl: async (_url, init) => {
      requestedBody = String(init?.body);
      return new Response(JSON.stringify({ access_token: "new-access-token", expires_in: 3600, token_type: "Bearer" }), { status: 200 });
    }
  });

  assert.match(requestedBody, /grant_type=refresh_token/);
  assert.equal(refreshed.accessToken, "new-access-token");
  assert.equal(refreshed.refreshToken, "refresh-token");
  assert.equal(refreshed.expiresAt, "2026-06-20T11:00:00.000Z");
});

await run("oauth email provider sends gmail messages through the api adapter", async () => {
  const account = {
    id: "gmail-account",
    workspaceId: defaultWorkspaceId,
    name: "Gmail",
    emailAddress: "gmail@example.com",
    provider: "gmail",
    status: "active",
    syncEnabled: true,
    sendEnabled: true,
    connectionConfigured: true,
    createdById: "user-admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  let requestedUrl = "";
  let requestedBody;
  let persistedConfig;
  const fakeRepository = {
    async getEmailAccount() {
      return account;
    },
    async getEmailAccountConnectionConfig() {
      return { oauthProvider: "gmail", accessToken: "access-token", refreshToken: "refresh-token", expiresAt: "2099-06-20T12:00:00.000Z" };
    },
    async updateEmailAccountConnectionConfig(_context, _accountId, config) {
      persistedConfig = config;
      return account;
    },
    async markEmailAccountConnectionError(_context, _accountId, errorMessage) {
      return { ...account, status: errorMessage ? "error" : "active", lastConnectionError: errorMessage ?? undefined };
    },
    async sendEmailMessage(_context, input) {
      return {
        id: "message-outbound",
        workspaceId: defaultWorkspaceId,
        threadId: "thread-outbound",
        accountId: input.accountId,
        direction: "outbound",
        status: "sent",
        from: account.emailAddress,
        to: input.to,
        subject: input.subject,
        bodyText: input.bodyText,
        externalMessageId: input.externalMessageId,
        createdAt: new Date().toISOString()
      };
    }
  };
  const adapter = createEmailProviderAdapter(fakeRepository, {
    oauth: {
      fetchImpl: async (url, init) => {
        requestedUrl = String(url);
        if (requestedUrl.endsWith("/users/me/profile")) {
          return new Response(JSON.stringify({ emailAddress: account.emailAddress }), { status: 200 });
        }
        requestedBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ id: "gmail-message-id" }), { status: 200 });
      }
    }
  });
  const context = { workspaceId: defaultWorkspaceId, user: seedData.users[0], role: seedData.roles[0] };
  const result = await adapter.testConnection(context, account.id);

  assert.equal(result.result.oauth, "ok");
  assert.equal(result.result.oauthAccountEmail, account.emailAddress);
  assert.equal(result.result.smtp, "skipped");
  const sent = await adapter.send(context, {
    accountId: account.id,
    to: ["buyer@example.com"],
    cc: ["copied@example.com\r\nX-Cc-Injected: yes"],
    bcc: ["secret@example.com\r\nX-Bcc-Injected: yes"],
    subject: "Hello\r\nX-Subject-Injected: yes",
    bodyText: "Body",
    messageId: "message-outbound",
    inReplyTo: "<gmail-inbound@example.com>",
    references: ["<gmail-inbound@example.com>"],
    attachments: [{ fileName: "proposal.txt", contentType: "text/plain", size: 11, contentBase64: Buffer.from("hello world").toString("base64") }]
  });
  assert.equal(requestedUrl, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
  const rawGmailMessage = Buffer.from(requestedBody.raw, "base64url").toString("utf8");
  assert.match(rawGmailMessage, /Subject: Hello/);
  assert.doesNotMatch(rawGmailMessage, /\r\nX-Subject-Injected:/);
  assert.doesNotMatch(rawGmailMessage, /\r\nX-Cc-Injected:/);
  assert.doesNotMatch(rawGmailMessage, /\r\nX-Bcc-Injected:/);
  assert.match(rawGmailMessage, /Message-ID: <message-outbound@ai-agent-crm\.local>/);
  assert.match(rawGmailMessage, /In-Reply-To: <gmail-inbound@example\.com>/);
  assert.match(rawGmailMessage, /References: <gmail-inbound@example\.com>/);
  assert.match(rawGmailMessage, /Content-Type: multipart\/mixed/);
  assert.match(rawGmailMessage, /filename="proposal\.txt"/);
  assert.match(rawGmailMessage, /aGVsbG8gd29ybGQ=/);
  assert.equal(persistedConfig.accessToken, "access-token");
  assert.equal(sent.status, "sent");
  assert.equal(sent.externalMessageId, "<message-outbound@ai-agent-crm.local>");
});

await run("direct email sends synthesize stable message ids for provider threading", async () => {
  const account = {
    id: "gmail-direct-generated-account",
    workspaceId: defaultWorkspaceId,
    name: "Gmail Direct Generated",
    emailAddress: "gmail-direct-generated@example.com",
    provider: "gmail",
    status: "active",
    syncEnabled: true,
    sendEnabled: true,
    connectionConfigured: true,
    createdById: "user-admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  let requestedBody;
  const fakeRepository = {
    async getEmailAccount() {
      return account;
    },
    async getEmailAccountConnectionConfig() {
      return { oauthProvider: "gmail", accessToken: "access-token", refreshToken: "refresh-token", expiresAt: "2099-06-20T12:00:00.000Z" };
    },
    async updateEmailAccountConnectionConfig() {
      return account;
    },
    async markEmailAccountConnectionError() {
      return account;
    },
    async sendEmailMessage(_context, input) {
      return {
        id: "message-generated-direct",
        workspaceId: defaultWorkspaceId,
        threadId: "thread-generated-direct",
        accountId: input.accountId,
        direction: "outbound",
        status: "sent",
        from: account.emailAddress,
        to: input.to,
        subject: input.subject,
        bodyText: input.bodyText,
        externalMessageId: input.externalMessageId,
        createdAt: new Date().toISOString()
      };
    }
  };
  const adapter = createEmailProviderAdapter(fakeRepository, {
    oauth: {
      fetchImpl: async (_url, init) => {
        requestedBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ id: "gmail-provider-id" }), { status: 200 });
      }
    }
  });
  const context = { workspaceId: defaultWorkspaceId, user: seedData.users[0], role: seedData.roles[0] };
  const sent = await adapter.send(context, {
    accountId: account.id,
    to: ["buyer@example.com"],
    subject: "Generated Message-ID",
    bodyText: "Body"
  });
  const rawGmailMessage = Buffer.from(requestedBody.raw, "base64url").toString("utf8");
  const messageId = rawGmailMessage.match(/^Message-ID: (<direct-[^>]+@ai-agent-crm\.local>)$/m)?.[1];

  assert.ok(messageId);
  assert.equal(sent.externalMessageId, messageId);
});

await run("email provider test connection requires admin before reading connection config", async () => {
  const store = new CrmStore();
  const salesContext = store.getContext("user-sales");
  const calls = [];
  const repository = {
    async getEmailAccount() {
      calls.push("getEmailAccount");
      throw new Error("getEmailAccount should not be called");
    },
    async getEmailAccountConnectionConfig() {
      calls.push("getEmailAccountConnectionConfig");
      throw new Error("connection config should not be read");
    },
    async markEmailAccountConnectionError() {
      calls.push("markEmailAccountConnectionError");
      throw new Error("connection status should not be updated");
    }
  };

  await assert.rejects(
    () => createEmailProviderAdapter(repository).testConnection(salesContext, "email-account-secret"),
    /crm\.admin/
  );
  assert.deepEqual(calls, []);
});

await run("queued oauth email send derives threading headers from CRM thread history", async () => {
  const account = {
    id: "gmail-thread-account",
    workspaceId: defaultWorkspaceId,
    name: "Gmail Thread",
    emailAddress: "gmail-thread@example.com",
    provider: "gmail",
    status: "active",
    syncEnabled: true,
    sendEnabled: true,
    connectionConfigured: true,
    createdById: "user-admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const queuedMessage = {
    id: "queued-threaded-message",
    workspaceId: defaultWorkspaceId,
    threadId: "thread-gmail-history",
    accountId: account.id,
    direction: "outbound",
    status: "queued",
    from: account.emailAddress,
    to: ["buyer@example.com"],
    subject: "Re: Threaded Gmail",
    bodyText: "Reply body",
    createdAt: new Date().toISOString()
  };
  let requestedBody;
  const fakeRepository = {
    async getEmailMessage() {
      return queuedMessage;
    },
    async getEmailAccount() {
      return account;
    },
    async listEmailMessages() {
      return [
        {
          id: "inbound-message",
          workspaceId: defaultWorkspaceId,
          threadId: queuedMessage.threadId,
          accountId: account.id,
          direction: "inbound",
          status: "received",
          from: "buyer@example.com",
          to: [account.emailAddress],
          subject: "Threaded Gmail",
          bodyText: "Inbound body",
          externalMessageId: "gmail-inbound@example.com",
          createdAt: new Date().toISOString()
        },
        {
          id: "previous-outbound-message",
          workspaceId: defaultWorkspaceId,
          threadId: queuedMessage.threadId,
          accountId: account.id,
          direction: "outbound",
          status: "sent",
          from: account.emailAddress,
          to: ["buyer@example.com"],
          subject: "Re: Threaded Gmail",
          bodyText: "Previous reply",
          externalMessageId: "<previous-outbound@ai-agent-crm.local>",
          createdAt: new Date().toISOString()
        },
        queuedMessage
      ];
    },
    async getEmailAccountConnectionConfig() {
      return { oauthProvider: "gmail", accessToken: "access-token", refreshToken: "refresh-token", expiresAt: "2099-06-20T12:00:00.000Z" };
    },
    async updateEmailAccountConnectionConfig() {
      return account;
    },
    async markEmailAccountConnectionError(_context, _accountId, errorMessage) {
      return { ...account, status: errorMessage ? "error" : "active", lastConnectionError: errorMessage ?? undefined };
    },
    async updateEmailMessageStatus(_context, messageId, status, options) {
      return { ...queuedMessage, id: messageId, status, externalMessageId: options?.externalMessageId, sentAt: new Date().toISOString() };
    }
  };
  const adapter = createEmailProviderAdapter(fakeRepository, {
    oauth: {
      fetchImpl: async (_url, init) => {
        requestedBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ id: "gmail-sent" }), { status: 200 });
      }
    }
  });
  const context = { workspaceId: defaultWorkspaceId, user: seedData.users[0], role: seedData.roles[0] };
  const sent = await adapter.sendQueued(context, queuedMessage.id);
  const raw = Buffer.from(requestedBody.raw, "base64url").toString("utf8");

  assert.match(raw, /Message-ID: <queued-threaded-message@ai-agent-crm\.local>/);
  assert.match(raw, /In-Reply-To: <previous-outbound@ai-agent-crm\.local>/);
  assert.match(raw, /References: <gmail-inbound@example\.com> <previous-outbound@ai-agent-crm\.local>/);
  assert.equal(sent.status, "sent");
  assert.equal(sent.externalMessageId, "<queued-threaded-message@ai-agent-crm.local>");
});

await run("oauth email provider syncs gmail messages with rfc822 message ids", async () => {
  const providerSource = readFileSync("src/lib/email/provider.ts", "utf8");
  assert.match(providerSource, /fetchRecentOAuthEmails\(account\.provider, config, \{ \.\.\.this\.options\.oauth, includeSpam: true, limit: syncLimit \}\)/);
  const account = {
    id: "gmail-sync-account",
    workspaceId: defaultWorkspaceId,
    name: "Gmail Sync",
    emailAddress: "gmail-sync@example.com",
    provider: "gmail",
    status: "active",
    syncEnabled: true,
    sendEnabled: true,
    connectionConfigured: true,
    createdById: "user-admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const imported = [];
  const fakeRepository = {
    async getEmailAccount() {
      return account;
    },
    async getEmailAccountConnectionConfig() {
      return { oauthProvider: "gmail", accessToken: "access-token", refreshToken: "refresh-token", expiresAt: "2099-06-20T12:00:00.000Z" };
    },
    async updateEmailAccountConnectionConfig() {
      return account;
    },
    async findEmailMessageByExternalId() {
      return undefined;
    },
    async recordEmailMessage(_context, input) {
      imported.push(input);
      return { id: `message-${imported.length}`, workspaceId: defaultWorkspaceId, threadId: "thread-gmail-sync", createdAt: new Date().toISOString(), ...input };
    },
    async syncEmailAccount() {
      return { account, importedCount: 0, status: "synced" };
    },
    async markEmailAccountConnectionError(_context, _accountId, errorMessage) {
      return { ...account, status: errorMessage ? "error" : "active", lastConnectionError: errorMessage ?? undefined };
    }
  };
  const adapter = createEmailProviderAdapter(fakeRepository, {
    oauth: {
      fetchImpl: async (url) => {
        const requestUrl = String(url);
        if (requestUrl.includes("/messages?")) {
          return new Response(JSON.stringify({ messages: [{ id: "gmail-api-message-id" }] }), { status: 200 });
        }
        assert.equal(requestUrl.includes("/messages/gmail-api-message-id?format=full"), true);
        return new Response(
          JSON.stringify({
            id: "gmail-api-message-id",
            internalDate: "1781935200000",
            snippet: "Gmail body",
            payload: {
              headers: [
                { name: "Message-ID", value: "<rfc822-gmail-message@example.com>" },
                { name: "From", value: "Buyer <buyer@example.com>" },
                { name: "To", value: "Gmail Sync <gmail-sync@example.com>" },
                { name: "Cc", value: "Manager <manager@example.com>, reviewer@example.com" },
                { name: "Subject", value: "Gmail inbound" }
              ],
              parts: [
                { mimeType: "text/html", body: { data: Buffer.from("<div>HTML body should not win.</div>", "utf8").toString("base64url") } },
                { mimeType: "text/plain", body: { data: Buffer.from("Gmail full body", "utf8").toString("base64url") } },
                { filename: "inbound.pdf", mimeType: "application/pdf", body: { size: 2048, attachmentId: "gmail-attachment-id" } }
              ]
            }
          }),
          { status: 200 }
        );
      }
    }
  });
  const context = { workspaceId: defaultWorkspaceId, user: seedData.users[0], role: seedData.roles[0] };
  const result = await adapter.sync(context, account.id);

  assert.equal(result.importedCount, 1);
  assert.equal(imported[0].externalMessageId, "<rfc822-gmail-message@example.com>");
  assert.equal(imported[0].subject, "Gmail inbound");
  assert.deepEqual(imported[0].cc, ["manager@example.com", "reviewer@example.com"]);
  assert.equal(imported[0].bodyText, "Gmail full body");
  assert.equal(imported[0].bodyHtml, "<div>HTML body should not win.</div>");
  assert.equal(imported[0].attachments[0].fileName, "inbound.pdf");
  assert.equal(imported[0].attachments[0].providerMessageId, "gmail-api-message-id");
  assert.equal(imported[0].attachments[0].providerAttachmentId, "gmail-attachment-id");
});

await run("oauth email api paginates gmail sync within the configured limit", async () => {
  const requestedUrls = [];
  const result = await fetchRecentOAuthEmails(
    "gmail",
    { oauthProvider: "gmail", accessToken: "access-token", refreshToken: "refresh-token", expiresAt: "2099-06-20T12:00:00.000Z" },
    {
      limit: 26,
      fetchImpl: async (url) => {
        const requestUrl = String(url);
        requestedUrls.push(requestUrl);
        if (requestUrl.includes("/messages?")) {
          const params = new URL(requestUrl).searchParams;
          const pageToken = params.get("pageToken");
          const ids = pageToken === "page-2" ? ["gmail-page-2-message"] : Array.from({ length: 25 }, (_item, index) => `gmail-page-1-message-${index + 1}`);
          return new Response(JSON.stringify({ messages: ids.map((id) => ({ id })), nextPageToken: pageToken === "page-2" ? "page-3" : "page-2" }), { status: 200 });
        }
        const id = requestUrl.match(/messages\/([^?]+)/)?.[1] ?? "unknown";
        return new Response(
          JSON.stringify({
            id,
            payload: {
              headers: [
                { name: "Message-ID", value: `<${id}@example.com>` },
                { name: "From", value: "Buyer <buyer@example.com>" },
                { name: "To", value: "Sales <sales@example.com>" },
                { name: "Subject", value: id }
              ],
              parts: [{ mimeType: "text/plain", body: { data: Buffer.from(`body ${id}`, "utf8").toString("base64url") } }]
            }
          }),
          { status: 200 }
        );
      }
    }
  );

  const listUrls = requestedUrls.filter((url) => url.includes("/messages?"));
  assert.equal(result.messages.length, 26);
  assert.equal(result.fetchedCount, 26);
  assert.equal(result.pageCount, 2);
  assert.equal(result.hasMore, true);
  assert.equal(new URL(listUrls[0]).searchParams.get("maxResults"), "25");
  assert.equal(new URL(listUrls[0]).searchParams.get("q"), "in:inbox");
  assert.equal(new URL(listUrls[1]).searchParams.get("maxResults"), "1");
  assert.equal(new URL(listUrls[1]).searchParams.get("q"), "in:inbox");
  assert.equal(new URL(listUrls[1]).searchParams.get("pageToken"), "page-2");
});

await run("oauth email api can include gmail spam messages with source metadata", async () => {
  const requestedQueries = [];
  const result = await fetchRecentOAuthEmails(
    "gmail",
    { oauthProvider: "gmail", accessToken: "access-token", refreshToken: "refresh-token", expiresAt: "2099-06-20T12:00:00.000Z" },
    {
      includeSpam: true,
      limit: 2,
      fetchImpl: async (url) => {
        const requestUrl = String(url);
        if (requestUrl.includes("/messages?")) {
          const query = new URL(requestUrl).searchParams.get("q");
          requestedQueries.push(query);
          return new Response(JSON.stringify({ messages: query === "in:spam" ? [{ id: "gmail-spam-message" }] : [] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            id: "gmail-spam-message",
            payload: {
              headers: [
                { name: "Message-ID", value: "<gmail-spam@example.com>" },
                { name: "From", value: "Spam <spam@example.com>" },
                { name: "To", value: "Sales <sales@example.com>" },
                { name: "Subject", value: "Spam inbound" }
              ],
              parts: [{ mimeType: "text/plain", body: { data: Buffer.from("Spam body", "utf8").toString("base64url") } }]
            }
          }),
          { status: 200 }
        );
      }
    }
  );

  assert.deepEqual(requestedQueries, ["in:inbox", "in:spam"]);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].inboundMetadata.sourceMailbox, "SPAM");
  assert.equal(result.messages[0].inboundMetadata.sourceMailboxRole, "spam");
});

await run("oauth email api ignores malformed gmail internal dates", async () => {
  const result = await fetchRecentOAuthEmails(
    "gmail",
    { oauthProvider: "gmail", accessToken: "access-token", refreshToken: "refresh-token", expiresAt: "2099-06-20T12:00:00.000Z" },
    {
      limit: 1,
      fetchImpl: async (url) => {
        const requestUrl = String(url);
        if (requestUrl.includes("/messages?")) {
          return new Response(JSON.stringify({ messages: [{ id: "gmail-bad-date-message" }] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            id: "gmail-bad-date-message",
            internalDate: "not-a-timestamp",
            payload: {
              headers: [
                { name: "Message-ID", value: "<gmail-bad-date@example.com>" },
                { name: "From", value: "Buyer <buyer@example.com>" },
                { name: "To", value: "Sales <sales@example.com>" },
                { name: "Subject", value: "Bad Gmail date" }
              ],
              parts: [{ mimeType: "text/plain", body: { data: Buffer.from("Body with bad date", "utf8").toString("base64url") } }]
            }
          }),
          { status: 200 }
        );
      }
    }
  );

  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].subject, "Bad Gmail date");
  assert.equal(result.messages[0].receivedAt, undefined);
});

await run("oauth email provider syncs gmail html bodies as plain text fallback", async () => {
  const account = {
    id: "gmail-html-sync-account",
    workspaceId: defaultWorkspaceId,
    name: "Gmail HTML Sync",
    emailAddress: "gmail-html@example.com",
    provider: "gmail",
    status: "active",
    syncEnabled: true,
    sendEnabled: true,
    connectionConfigured: true,
    createdById: "user-admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const imported = [];
  const fakeRepository = {
    async getEmailAccount() {
      return account;
    },
    async getEmailAccountConnectionConfig() {
      return { oauthProvider: "gmail", accessToken: "access-token", refreshToken: "refresh-token", expiresAt: "2099-06-20T12:00:00.000Z" };
    },
    async updateEmailAccountConnectionConfig() {
      return account;
    },
    async findEmailMessageByExternalId() {
      return undefined;
    },
    async recordEmailMessage(_context, input) {
      imported.push(input);
      return { id: `message-${imported.length}`, workspaceId: defaultWorkspaceId, threadId: "thread-gmail-html-sync", createdAt: new Date().toISOString(), ...input };
    },
    async syncEmailAccount() {
      return { account, importedCount: 0, status: "synced" };
    },
    async markEmailAccountConnectionError(_context, _accountId, errorMessage) {
      return { ...account, status: errorMessage ? "error" : "active", lastConnectionError: errorMessage ?? undefined };
    }
  };
  const adapter = createEmailProviderAdapter(fakeRepository, {
    oauth: {
      fetchImpl: async (url) => {
        const requestUrl = String(url);
        if (requestUrl.includes("/messages?")) {
          return new Response(JSON.stringify({ messages: [{ id: "gmail-html-message-id" }] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            id: "gmail-html-message-id",
            payload: {
              headers: [
                { name: "From", value: "Buyer <buyer@example.com>" },
                { name: "To", value: "Gmail HTML <gmail-html@example.com>" },
                { name: "Subject", value: "HTML body" }
              ],
              parts: [{ mimeType: "text/html", body: { data: Buffer.from("<p>Hello <strong>Gmail</strong><br>Next step.</p>", "utf8").toString("base64url") } }]
            }
          }),
          { status: 200 }
        );
      }
    }
  });
  const context = { workspaceId: defaultWorkspaceId, user: seedData.users[0], role: seedData.roles[0] };
  const result = await adapter.sync(context, account.id);

  assert.equal(result.importedCount, 1);
  assert.equal(imported[0].bodyText, "Hello Gmail\nNext step.");
  assert.equal(imported[0].bodyHtml, "<p>Hello <strong>Gmail</strong><br>Next step.</p>");
});

await run("oauth email provider downloads gmail attachment content", async () => {
  let requestedUrl = "";
  const result = await downloadOAuthAttachment(
    "gmail",
    { oauthProvider: "gmail", accessToken: "access-token", refreshToken: "refresh-token", expiresAt: "2099-06-20T12:00:00.000Z" },
    { fileName: "inbound.pdf", contentType: "application/pdf", size: 11, providerMessageId: "gmail-message-id", providerAttachmentId: "gmail-attachment-id" },
    {
      fetchImpl: async (url) => {
        requestedUrl = String(url);
        return new Response(JSON.stringify({ data: Buffer.from("hello world", "utf8").toString("base64url"), size: 11 }), { status: 200 });
      }
    }
  );

  assert.equal(requestedUrl, "https://gmail.googleapis.com/gmail/v1/users/me/messages/gmail-message-id/attachments/gmail-attachment-id");
  assert.equal(Buffer.from(result.contentBase64, "base64").toString("utf8"), "hello world");
  assert.equal(result.contentType, "application/pdf");
  assert.equal(result.size, 11);
});

await run("oauth email provider rejects malformed gmail attachment content", async () => {
  await assert.rejects(
    () =>
      downloadOAuthAttachment(
        "gmail",
        { oauthProvider: "gmail", accessToken: "access-token", refreshToken: "refresh-token", expiresAt: "2099-06-20T12:00:00.000Z" },
        { fileName: "broken.pdf", contentType: "application/pdf", size: 4, providerMessageId: "gmail-message-id", providerAttachmentId: "gmail-attachment-id" },
        {
          fetchImpl: async () => new Response(JSON.stringify({ data: "AA=A", size: 4 }), { status: 200 })
        }
      ),
    /valid base64/
  );
});

await run("oauth email provider sends outlook messages with internet threading headers", async () => {
  const account = {
    id: "outlook-send-account",
    workspaceId: defaultWorkspaceId,
    name: "Outlook Send",
    emailAddress: "outlook-send@example.com",
    provider: "outlook",
    status: "active",
    syncEnabled: true,
    sendEnabled: true,
    connectionConfigured: true,
    createdById: "user-admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  let requestedBody;
  const fakeRepository = {
    async getEmailAccount() {
      return account;
    },
    async getEmailAccountConnectionConfig() {
      return { oauthProvider: "outlook", accessToken: "access-token", refreshToken: "refresh-token", expiresAt: "2099-06-20T12:00:00.000Z" };
    },
    async updateEmailAccountConnectionConfig() {
      return account;
    },
    async markEmailAccountConnectionError(_context, _accountId, errorMessage) {
      return { ...account, status: errorMessage ? "error" : "active", lastConnectionError: errorMessage ?? undefined };
    },
    async sendEmailMessage(_context, input) {
      return { id: "outlook-sent", workspaceId: defaultWorkspaceId, threadId: "thread-outlook-send", direction: "outbound", status: "sent", from: account.emailAddress, createdAt: new Date().toISOString(), ...input };
    }
  };
  const adapter = createEmailProviderAdapter(fakeRepository, {
    oauth: {
      fetchImpl: async (url, init) => {
        assert.equal(String(url), "https://graph.microsoft.com/v1.0/me/sendMail");
        requestedBody = JSON.parse(String(init?.body));
        return new Response("", { status: 202 });
      }
    }
  });
  const context = { workspaceId: defaultWorkspaceId, user: seedData.users[0], role: seedData.roles[0] };
  const sent = await adapter.send(context, {
    accountId: account.id,
    to: ["buyer@example.com"],
    subject: "Outlook threaded reply",
    bodyText: "Body",
    messageId: "outlook-outbound",
    inReplyTo: "<outlook-inbound@example.com>\r\nX-Reply-Injected: yes",
    references: ["<outlook-parent@example.com>", "<outlook-inbound@example.com>\r\nX-Refs-Injected: yes"],
    attachments: [{ fileName: "quote.txt", contentType: "text/plain", size: 5, contentBase64: Buffer.from("quote").toString("base64") }]
  });

  const headers = requestedBody.message.internetMessageHeaders;
  assert.equal(headers.every((header) => !/[\r\n]/.test(header.value)), true);
  assert.deepEqual(headers, [
    { name: "Message-ID", value: "<outlook-outbound@ai-agent-crm.local>" },
    { name: "In-Reply-To", value: "<outlook-inbound@example.com> X-Reply-Injected: yes" },
    { name: "References", value: "<outlook-parent@example.com> <outlook-inbound@example.com> X-Refs-Injected: yes" }
  ]);
  assert.deepEqual(requestedBody.message.attachments, [
    {
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: "quote.txt",
      contentType: "text/plain",
      contentBytes: Buffer.from("quote").toString("base64")
    }
  ]);
  assert.equal(sent.status, "sent");
});

await run("oauth email provider syncs outlook messages through the api adapter", async () => {
  const account = {
    id: "outlook-account",
    workspaceId: defaultWorkspaceId,
    name: "Outlook",
    emailAddress: "outlook@example.com",
    provider: "outlook",
    status: "active",
    syncEnabled: true,
    sendEnabled: true,
    connectionConfigured: true,
    createdById: "user-admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const imported = [];
  const fakeRepository = {
    async getEmailAccount() {
      return account;
    },
    async getEmailAccountConnectionConfig() {
      return { oauthProvider: "outlook", accessToken: "access-token", refreshToken: "refresh-token", expiresAt: "2099-06-20T12:00:00.000Z" };
    },
    async updateEmailAccountConnectionConfig() {
      return account;
    },
    async recordEmailMessage(_context, input) {
      imported.push(input);
      return { id: `message-${imported.length}`, workspaceId: defaultWorkspaceId, threadId: "thread-sync", createdAt: new Date().toISOString(), ...input };
    },
    async findEmailMessageByExternalId() {
      return undefined;
    },
    async syncEmailAccount() {
      return { account, importedCount: 0, status: "synced" };
    },
    async markEmailAccountConnectionError(_context, _accountId, errorMessage) {
      return { ...account, status: errorMessage ? "error" : "active", lastConnectionError: errorMessage ?? undefined };
    }
  };
  const adapter = createEmailProviderAdapter(fakeRepository, {
    oauth: {
      fetchImpl: async (url) => {
        assert.match(String(url), /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/mailFolders\/(?:inbox|junkemail)\/messages/);
        if (String(url).includes("/mailFolders/junkemail/messages")) {
          return new Response(JSON.stringify({ value: [] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "outlook-message-id",
                subject: "Outlook inbound",
                bodyPreview: "Graph body preview",
                body: { contentType: "html", content: "<div>Hello <strong>buyer</strong><br />Full Outlook body &amp; next step.</div>" },
                receivedDateTime: "2026-06-20T10:30:00.000Z",
                attachments: [{ id: "outlook-attachment-id", name: "quote.pdf", contentType: "application/pdf", size: 12 }],
                from: { emailAddress: { address: "buyer@example.com" } },
                toRecipients: [{ emailAddress: { address: "outlook@example.com" } }],
                ccRecipients: [{ emailAddress: { address: "manager@example.com" } }, { emailAddress: { address: "reviewer@example.com" } }]
              }
            ]
          }),
          { status: 200 }
        );
      }
    }
  });
  const context = { workspaceId: defaultWorkspaceId, user: seedData.users[0], role: seedData.roles[0] };
  const result = await adapter.sync(context, account.id);

  assert.equal(result.importedCount, 1);
  assert.equal(imported[0].externalMessageId, "outlook-message-id");
  assert.equal(imported[0].subject, "Outlook inbound");
  assert.deepEqual(imported[0].cc, ["manager@example.com", "reviewer@example.com"]);
  assert.equal(imported[0].bodyText, "Hello buyer\nFull Outlook body & next step.");
  assert.equal(imported[0].bodyHtml, "<div>Hello <strong>buyer</strong><br />Full Outlook body &amp; next step.</div>");
  assert.equal(imported[0].attachments[0].providerMessageId, "outlook-message-id");
  assert.equal(imported[0].attachments[0].providerAttachmentId, "outlook-attachment-id");
  assert.equal(imported[0].attachments[0].fileName, "quote.pdf");
});

await run("oauth email api follows outlook next links within the configured limit", async () => {
  const requestedUrls = [];
  const result = await fetchRecentOAuthEmails(
    "outlook",
    { oauthProvider: "outlook", accessToken: "access-token", refreshToken: "refresh-token", expiresAt: "2099-06-20T12:00:00.000Z" },
    {
      limit: 2,
      fetchImpl: async (url) => {
        const requestUrl = String(url);
        requestedUrls.push(requestUrl);
        const isSecondPage = requestUrl.includes("skiptoken=page-2");
        return new Response(
          JSON.stringify({
            value: [
              {
                id: isSecondPage ? "outlook-page-2-message" : "outlook-page-1-message",
                subject: isSecondPage ? "Second page" : "First page",
                bodyPreview: isSecondPage ? "Second body" : "First body",
                receivedDateTime: "2026-06-20T10:30:00.000Z",
                from: { emailAddress: { address: "buyer@example.com" } },
                toRecipients: [{ emailAddress: { address: "sales@example.com" } }]
              }
            ],
            "@odata.nextLink": isSecondPage ? "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?skiptoken=page-3" : "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?skiptoken=page-2"
          }),
          { status: 200 }
        );
      }
    }
  );

  assert.equal(result.messages.length, 2);
  assert.equal(result.fetchedCount, 2);
  assert.equal(result.pageCount, 2);
  assert.equal(result.hasMore, true);
  assert.equal(requestedUrls[0].startsWith("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?"), true);
  assert.equal(requestedUrls[1], "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?skiptoken=page-2");
});

await run("oauth email api ignores malformed outlook received dates", async () => {
  const result = await fetchRecentOAuthEmails(
    "outlook",
    { oauthProvider: "outlook", accessToken: "access-token", refreshToken: "refresh-token", expiresAt: "2099-06-20T12:00:00.000Z" },
    {
      limit: 1,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            value: [
              {
                id: "outlook-bad-date-message",
                subject: "Bad Outlook date",
                bodyPreview: "Body with bad date",
                receivedDateTime: "not-a-date",
                from: { emailAddress: { address: "buyer@example.com" } },
                toRecipients: [{ emailAddress: { address: "sales@example.com" } }]
              }
            ]
          }),
          { status: 200 }
        )
    }
  );

  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].subject, "Bad Outlook date");
  assert.equal(result.messages[0].receivedAt, undefined);
});

await run("oauth email provider downloads outlook attachment content", async () => {
  let requestedUrl = "";
  const result = await downloadOAuthAttachment(
    "outlook",
    { oauthProvider: "outlook", accessToken: "access-token", refreshToken: "refresh-token", expiresAt: "2099-06-20T12:00:00.000Z" },
    { fileName: "quote.pdf", contentType: "application/pdf", size: 12, providerMessageId: "outlook-message-id", providerAttachmentId: "outlook-attachment-id" },
    {
      fetchImpl: async (url) => {
        requestedUrl = String(url);
        return new Response(Buffer.from("outlook file"), { status: 200, headers: { "content-type": "application/pdf" } });
      }
    }
  );

  assert.equal(requestedUrl, "https://graph.microsoft.com/v1.0/me/messages/outlook-message-id/attachments/outlook-attachment-id/$value");
  assert.equal(Buffer.from(result.contentBase64, "base64").toString("utf8"), "outlook file");
  assert.equal(result.contentType, "application/pdf");
  assert.equal(result.size, 12);
});

await run("oauth email provider sync skips messages already imported for the same account", async () => {
  const account = {
    id: "outlook-dedupe-account",
    workspaceId: defaultWorkspaceId,
    name: "Outlook Dedupe",
    emailAddress: "outlook-dedupe@example.com",
    provider: "outlook",
    status: "active",
    syncEnabled: true,
    sendEnabled: true,
    connectionConfigured: true,
    createdById: "user-admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const imported = [];
  const existingMessage = {
    id: "existing-outlook-message",
    workspaceId: defaultWorkspaceId,
    threadId: "thread-existing",
    accountId: account.id,
    direction: "inbound",
    status: "received",
    from: "buyer@example.com",
    to: [account.emailAddress],
    subject: "Already synced",
    bodyText: "Existing body",
    externalMessageId: "duplicate-outlook-id",
    createdAt: new Date().toISOString()
  };
  const fakeRepository = {
    async getEmailAccount() {
      return account;
    },
    async getEmailAccountConnectionConfig() {
      return { oauthProvider: "outlook", accessToken: "access-token", refreshToken: "refresh-token", expiresAt: "2099-06-20T12:00:00.000Z" };
    },
    async updateEmailAccountConnectionConfig() {
      return account;
    },
    async findEmailMessageByExternalId(_context, accountId, externalMessageId) {
      assert.equal(accountId, account.id);
      return externalMessageId === existingMessage.externalMessageId ? existingMessage : undefined;
    },
    async recordEmailMessage(_context, input) {
      imported.push(input);
      return { id: `message-${imported.length}`, workspaceId: defaultWorkspaceId, threadId: "thread-sync", createdAt: new Date().toISOString(), ...input };
    },
    async syncEmailAccount() {
      return { account, importedCount: 0, status: "synced" };
    },
    async markEmailAccountConnectionError(_context, _accountId, errorMessage) {
      return { ...account, status: errorMessage ? "error" : "active", lastConnectionError: errorMessage ?? undefined };
    }
  };
  const adapter = createEmailProviderAdapter(fakeRepository, {
    oauth: {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            value: [
              {
                id: "duplicate-outlook-id",
                subject: "Already synced",
                bodyPreview: "Existing body",
                receivedDateTime: "2026-06-20T10:30:00.000Z",
                from: { emailAddress: { address: "buyer@example.com" } },
                toRecipients: [{ emailAddress: { address: account.emailAddress } }]
              },
              {
                id: "new-outlook-id",
                subject: "New inbound",
                bodyPreview: "New body",
                receivedDateTime: "2026-06-20T10:35:00.000Z",
                from: { emailAddress: { address: "new@example.com" } },
                toRecipients: [{ emailAddress: { address: account.emailAddress } }]
              }
            ]
          }),
          { status: 200 }
        )
    }
  });
  const context = { workspaceId: defaultWorkspaceId, user: seedData.users[0], role: seedData.roles[0] };
  const result = await adapter.sync(context, account.id);

  assert.equal(result.importedCount, 1);
  assert.equal(result.scannedCount, 2);
  assert.equal(result.skippedDuplicateCount, 1);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].externalMessageId, "new-outlook-id");
});

await run("email ai generation respects disabled toggles and returns sources", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { features: { draft: false, translate: true, context_analysis: true, auto_summarize: true } });
  const disabledContext = store.buildEmailAssistantContext(context, { purpose: "draft", objectKey: "contacts", recordId: "contact-lin" });
  const disabled = await generateEmailAiOutput({ context: disabledContext, userPrompt: "write a reply" });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.generationMode, "disabled");
  assert.match(disabled.text, /disabled/);

  store.updateEmailAiSettings(context, { features: { draft: true } });
  const enabledContext = store.buildEmailAssistantContext(context, { purpose: "draft", objectKey: "contacts", recordId: "contact-lin" });
  const enabled = await generateEmailAiOutput({ context: enabledContext, userPrompt: "write a concise reply" });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.generationMode, "local");
  assert.match(enabled.text, /您好/);
  assert.doesNotMatch(enabled.text, /Draft goal|Sources/);
  assert.match(enabled.suggestedSubject ?? "", /write a concise reply/);
  assert.equal(enabled.sources.some((source) => source.recordId === "contact-lin"), true);
});

await run("openai-compatible email ai generation uses bounded CRM context", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { features: { draft: true, translate: true, context_analysis: true, auto_summarize: true } });
  const assistantContext = store.buildEmailAssistantContext(context, { purpose: "draft", objectKey: "contacts", recordId: "contact-lin" });
  let requestedUrl = "";
  let requestedBody;

  const result = await generateEmailAiOutput(
    { context: assistantContext, userPrompt: "write a warm reply" },
    {
      config: { provider: "openai-compatible", apiKey: "test-key", baseUrl: "https://ai.example/v1", model: "test-model", timeoutMs: 1000 },
      fetchImpl: async (url, init) => {
        requestedUrl = String(url);
        requestedBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ text: "Model drafted email with CRM sources.", suggestedSubject: "Follow up from CRM context" }) } }] }), { status: 200 });
      }
    }
  );

  assert.equal(requestedUrl, "https://ai.example/v1/chat/completions");
  assert.equal(requestedBody.model, "test-model");
  assert.match(requestedBody.messages[1].content, /Customer background/);
  assert.match(requestedBody.messages[1].content, /write a warm reply/);
  assert.equal(result.text, "Model drafted email with CRM sources.");
  assert.equal(result.suggestedSubject, "Follow up from CRM context");
  assert.equal(result.generationMode, "provider");
  assert.equal(result.providerError, undefined);
  assert.equal(result.sources.some((source) => source.recordId === "contact-lin"), true);
});

await run("openai-compatible email ai generation falls back locally on provider failure", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  store.updateEmailAiSettings(context, { features: { draft: true } });
  const assistantContext = store.buildEmailAssistantContext(context, { purpose: "draft", objectKey: "contacts", recordId: "contact-lin" });

  const result = await generateEmailAiOutput(
    { context: assistantContext, userPrompt: "write a fallback reply" },
    {
      config: { provider: "openai-compatible", apiKey: "test-key", baseUrl: "https://ai.example/v1", model: "test-model", timeoutMs: 1000 },
      fetchImpl: async () => new Response("unavailable", { status: 503 })
    }
  );

  assert.match(result.text, /您好/);
  assert.doesNotMatch(result.text, /Draft goal|Sources/);
  assert.match(result.suggestedSubject ?? "", /write a fallback reply/);
  assert.equal(result.enabled, true);
  assert.equal(result.generationMode, "provider_fallback");
  assert.match(result.providerError ?? "", /HTTP 503/);
});

await run("ai query planner creates controlled high-value deal queries", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const definitions = store.snapshot().objectDefinitions;
  const fields = store.listFieldDefinitions(context);

  const plan = buildAiQueryPlan({
    question: "show high amount deals for Acme",
    objectDefinitions: definitions,
    fields,
    pageSize: 25
  });

  assert.equal(plan.objectKeys[0], "deals");
  assert.deepEqual(plan.objectKeys, ["deals"]);
  assert.equal(plan.queries.deals.page, 1);
  assert.equal(plan.queries.deals.pageSize, 25);
  assert.deepEqual(plan.queries.deals.sort, { field: "amount", direction: "desc" });
  assert.equal(plan.queries.deals.filters, undefined);
  assert.equal(plan.queries.deals.q, "Acme");
});

await run("ai query planner keeps explicit object scope", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const definitions = store.snapshot().objectDefinitions;
  const fields = store.listFieldDefinitions(context);

  const plan = buildAiQueryPlan({
    question: "show contacts",
    objectDefinitions: definitions,
    fields,
    objectKey: "contacts",
    pageSize: 25
  });

  assert.deepEqual(plan.objectKeys, ["contacts"]);
  assert.ok(plan.queries.contacts.q === undefined || plan.queries.contacts.q === "");
});

await run("ai query planner validates model-shaped plans through allowlists", () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const definitions = store.snapshot().objectDefinitions;
  const fields = store.listFieldDefinitions(context);
  const plan = validateAiQueryPlan(
    {
      objectKeys: ["deals", "missing"],
      queries: {
        deals: {
          page: 9,
          pageSize: 999,
          q: "x".repeat(300),
          filters: [
            { field: "DROP TABLE", operator: "contains", value: "bad" },
            { field: "amount", operator: "equals", value: "280000" }
          ],
          sort: { field: "DROP TABLE", direction: "asc" }
        }
      },
      reason: "model"
    },
    definitions,
    fields,
    25
  );

  assert.deepEqual(plan.objectKeys, ["deals"]);
  assert.equal(plan.queries.deals.page, 1);
  assert.equal(plan.queries.deals.pageSize, 25);
  assert.equal(plan.queries.deals.q?.length, 200);
  assert.deepEqual(plan.queries.deals.filters, [{ field: "amount", operator: "equals", value: "280000" }]);
  assert.equal(plan.queries.deals.sort, undefined);
});

await run("ai natural language queries reject write intents", () => {
  assert.doesNotThrow(() => assertReadOnlyAiQuestion("Find Acme opportunities this month"));
  assert.throws(() => assertReadOnlyAiQuestion("delete Acme contacts"), /read-only/);
  assert.throws(() => assertReadOnlyAiQuestion("move the deal to won"), /read-only/);
});

await run("ai suggestions stay read-only and source-backed", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const record = store.getRecord(context, "deals", "deal-platform");
  const activities = store.listActivities(context, record.id);
  const response = await createAiProvider().suggestNextActions({ record, activities });

  assert.match(response.text, /AI/);
  assert.match(response.text, /next|follow|建议|下一步/i);
  assert.doesNotMatch(response.text, /undefined|null/);
  assert.equal(response.sources[0]?.objectKey, record.objectKey);
  assert.equal(response.sources[0]?.recordId, record.id);
  assert.equal(store.getRecord(context, "deals", "deal-platform").stageKey, "proposal");
});

await run("openai-compatible ai provider calls chat completions and keeps local sources", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const record = store.getRecord(context, "deals", "deal-platform");
  const activities = store.listActivities(context, record.id);
  const requests = [];
  const provider = createAiProvider({
    config: {
      provider: "openai-compatible",
      apiKey: "test-key",
      baseUrl: "https://ai.example/v1/",
      model: "crm-test-model",
      timeoutMs: 1000
    },
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ text: "模型建议：联系采购负责人确认预算。" }) } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const response = await provider.suggestNextActions({ record, activities });
  const body = JSON.parse(String(requests[0].init.body));

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://ai.example/v1/chat/completions");
  assert.equal(requests[0].init.headers.authorization, "Bearer test-key");
  assert.equal(body.model, "crm-test-model");
  assert.match(response.text, /AI/);
  assert.match(response.text, /不会修改|只读/);
  assert.equal(response.sources[0]?.objectKey, record.objectKey);
  assert.equal(response.sources[0]?.recordId, record.id);
});

await run("openai-compatible ai provider falls back when remote call fails", async () => {
  const store = new CrmStore();
  const context = store.getContext("user-admin");
  const record = store.getRecord(context, "deals", "deal-platform");
  const provider = createAiProvider({
    config: {
      provider: "openai-compatible",
      apiKey: "test-key",
      baseUrl: "https://ai.example/v1",
      model: "crm-test-model",
      timeoutMs: 1000
    },
    fetchImpl: async () => new Response("bad gateway", { status: 502 })
  });

  const response = await provider.summarizeRecord({ record, fields: store.listFieldDefinitions(context, "deals"), activities: [] });

  assert.match(response.text, /不会修改|只读/);
  assert.equal(response.sources[0]?.objectKey, record.objectKey);
  assert.equal(response.sources[0]?.recordId, record.id);
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

await runMcpTests(run);

const failed = results.filter((result) => !result.ok);
for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}`);
  if (!result.ok) {
    console.error(result.error);
  }
}

if (failed.length > 0) {
  process.exitCode = 1;
} else {
  console.log(`All ${results.length} tests passed.`);
}
