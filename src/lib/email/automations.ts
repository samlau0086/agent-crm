import type { EmailAiGenerationAuditInput, EmailAiSettings, EmailMessage, EmailThread, RequestContext } from "@/lib/crm/types";
import { canRunEmailAiAutomation, canRunEmailClassification } from "@/lib/email/assistant";
import type { EmailAnalyzeJobPayload } from "@/lib/email/analysis";
import type { EmailClassifyJobPayload } from "@/lib/email/classification";
import type { EmailSummarizeJobPayload } from "@/lib/email/summarization";
import type { EmailTranslateJobPayload } from "@/lib/email/translation";

export interface EmailAutomationExecutor {
  runEmailClassifyJob(context: RequestContext, payload: EmailClassifyJobPayload): Promise<unknown>;
  runEmailTranslateJob(context: RequestContext, payload: EmailTranslateJobPayload): Promise<EmailMessage>;
  runEmailAnalyzeJob(context: RequestContext, payload: EmailAnalyzeJobPayload): Promise<unknown>;
  runEmailSummarizeJob(context: RequestContext, payload: EmailSummarizeJobPayload): Promise<unknown>;
}

export interface EmailAutomationAuditRepository {
  recordEmailAiGeneration(context: RequestContext, input: EmailAiGenerationAuditInput): void | Promise<void>;
  getEmailThread?(context: RequestContext, threadId: string): EmailThread | Promise<EmailThread>;
  listEmailMessages?(context: RequestContext, threadId: string): EmailMessage[] | Promise<EmailMessage[]>;
}

export const EMAIL_AUTO_SUMMARY_MIN_NEW_MESSAGES = 3;

export async function runEmailAutomationsBestEffort(
  context: RequestContext,
  repository: EmailAutomationAuditRepository,
  executor: EmailAutomationExecutor,
  message: EmailMessage,
  settings: EmailAiSettings
): Promise<void> {
  if (!isEmailMessageEligibleForAutomation(message)) {
    return;
  }
  const tasks: Array<Promise<void>> = [];
  if (message.direction === "inbound" && canRunEmailClassification(context, settings)) {
    tasks.push(
      runAutomationTask(context, repository, {
        purpose: "classification",
        threadId: message.threadId,
        sourceMessageId: message.id,
        action: () => executor.runEmailClassifyJob(context, { messageId: message.id })
      })
    );
  }
  if (message.direction === "inbound" && canRunEmailAiAutomation(context, settings, "auto_translate")) {
    tasks.push(
      runAutomationTask(context, repository, {
        purpose: "translate",
        threadId: message.threadId,
        sourceMessageId: message.id,
        targetLocale: settings.defaultLocale,
        action: () => executor.runEmailTranslateJob(context, { messageId: message.id, targetLocale: settings.defaultLocale })
      })
    );
  }
  if (canRunEmailAiAutomation(context, settings, "auto_summarize") && (await shouldScheduleEmailAutoSummary(context, repository, message, settings))) {
    tasks.push(
      runAutomationTask(context, repository, {
        purpose: "summarize",
        threadId: message.threadId,
        action: () => executor.runEmailSummarizeJob(context, { threadId: message.threadId })
      })
    );
  }
  if (message.direction === "inbound" && canRunEmailAiAutomation(context, settings, "auto_context_analysis")) {
    tasks.push(
      runAutomationTask(context, repository, {
        purpose: "context_analysis",
        threadId: message.threadId,
        sourceMessageId: message.id,
        action: () => executor.runEmailAnalyzeJob(context, { threadId: message.threadId, sourceMessageId: message.id })
      })
    );
  }
  await Promise.all(tasks);
}

export function isEmailMessageEligibleForAutomation(message: Pick<EmailMessage, "direction" | "status">): boolean {
  return (message.direction === "inbound" && message.status === "received") || (message.direction === "outbound" && message.status === "sent");
}

export function shouldRunEmailAutoSummary(settings: EmailAiSettings, thread: EmailThread | undefined, messages: EmailMessage[]): boolean {
  const threadMessages = messages.filter((message) => !thread || message.threadId === thread.id);
  if (threadMessages.length === 0) {
    return false;
  }

  const maxHistoryMessages = normalizeLimit(settings.maxHistoryMessages, 8, 1, 20);
  const maxContextChars = normalizeLimit(settings.maxContextChars, 8000, 1000, 20000);
  const summaryTime = thread?.summaryUpdatedAt ? Date.parse(thread.summaryUpdatedAt) : Number.NaN;
  const hasUsableSummary = Boolean(thread?.summary && Number.isFinite(summaryTime));

  if (!hasUsableSummary) {
    return threadMessages.length >= maxHistoryMessages || totalMessageChars(threadMessages) > maxContextChars * 0.45;
  }

  const newMessages = threadMessages.filter((message) => {
    const time = Date.parse(messageTime(message));
    return Number.isFinite(time) && time > summaryTime;
  });
  const minNewMessages = Math.min(EMAIL_AUTO_SUMMARY_MIN_NEW_MESSAGES, maxHistoryMessages);
  return newMessages.length >= minNewMessages || totalMessageChars(newMessages) > maxContextChars * 0.25;
}

async function shouldScheduleEmailAutoSummary(
  context: RequestContext,
  repository: EmailAutomationAuditRepository,
  message: EmailMessage,
  settings: EmailAiSettings
): Promise<boolean> {
  if (!repository.getEmailThread || !repository.listEmailMessages) {
    return true;
  }
  try {
    const thread = await repository.getEmailThread(context, message.threadId);
    const messages = await repository.listEmailMessages(context, message.threadId);
    return shouldRunEmailAutoSummary(settings, thread, messages);
  } catch {
    return true;
  }
}

export function scheduleEmailAutomationsBestEffort(
  context: RequestContext,
  repository: EmailAutomationAuditRepository,
  executor: EmailAutomationExecutor,
  message: EmailMessage,
  settings: EmailAiSettings
): void {
  void runEmailAutomationsBestEffort(context, repository, executor, message, settings).catch(() => {
    // Individual automation tasks already record failures; scheduling must never affect email intake.
  });
}

async function runAutomationTask(
  context: RequestContext,
  repository: EmailAutomationAuditRepository,
  input: {
    purpose: "classification" | "translate" | "context_analysis" | "summarize";
    threadId: string;
    sourceMessageId?: string;
    targetLocale?: string;
    action: () => Promise<unknown>;
  }
): Promise<void> {
  try {
    await input.action();
  } catch (error) {
    await recordAutomationFailure(context, repository, input, error);
  }
}

async function recordAutomationFailure(
  context: RequestContext,
  repository: EmailAutomationAuditRepository,
  input: {
    purpose: "classification" | "translate" | "context_analysis" | "summarize";
    threadId: string;
    sourceMessageId?: string;
    targetLocale?: string;
  },
  error: unknown
): Promise<void> {
  try {
    await repository.recordEmailAiGeneration(context, {
      purpose: input.purpose,
      enabled: false,
      threadId: input.threadId,
      sourceMessageId: input.sourceMessageId,
      sourceCount: 0,
      sourceLabels: [],
      targetLocale: input.targetLocale,
      resultTextLength: 0,
      automationFailed: true,
      errorMessage: truncateAutomationError(error)
    });
  } catch {
    // Email intake must not fail because automation failure auditing failed.
  }
}

function truncateAutomationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

function normalizeLimit(value: number, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

function totalMessageChars(messages: EmailMessage[]): number {
  return messages.reduce((total, message) => total + message.subject.length + message.bodyText.length, 0);
}

function messageTime(message: EmailMessage): string {
  return message.sentAt ?? message.receivedAt ?? message.createdAt;
}
