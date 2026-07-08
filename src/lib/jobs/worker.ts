import { getRequestContextByUserId, getCrmRepository, type PrismaCrmRepository } from "@/lib/crm/repository";
import type { CsvImportJob, EmailMessage, EmailThread, WebhookDelivery, WorkflowRun } from "@/lib/crm/types";
import type { QueuedJobEnvelope } from "@/lib/jobs/executor";
import { analyzeEmailThreadWithAi } from "@/lib/email/analysis";
import { createEmailProviderAdapter, type EmailSyncResult } from "@/lib/email/provider";
import { summarizeEmailThreadWithAi } from "@/lib/email/summarization";
import { translateEmailMessage } from "@/lib/email/translation";
import { dequeueJob, enqueueJob, getDeadLetterQueueName, getJobQueueName } from "@/lib/jobs/redis-queue";
import { buildFailedJobEnvelope, getMaxJobAttemptsForEnvelope } from "@/lib/jobs/worker-policy";

export interface JobWorkerResult {
  processed: boolean;
  jobType?: QueuedJobEnvelope["type"];
  scheduledEmailSend?: boolean;
  requeued?: boolean;
  deadLettered?: boolean;
  error?: string;
  job?: CsvImportJob;
  deliveries?: WebhookDelivery[];
  emailSync?: EmailSyncResult;
  emailMessage?: EmailMessage;
  emailThread?: EmailThread;
  workflowRuns?: WorkflowRun[];
  workflowResumeScan?: { scanned: number; resumed: number; runs: WorkflowRun[] };
  workflowScheduleScan?: { scanned: number; triggered: number; runs: WorkflowRun[] };
}

export async function runQueuedJobOnce(repository: PrismaCrmRepository = getCrmRepository()): Promise<JobWorkerResult> {
  const queueName = getJobQueueName();
  const envelope = await dequeueJob<QueuedJobEnvelope>(queueName);
  if (!envelope) {
    return (await processDueWorkflowAutomation(repository)) ?? processDueQueuedEmailSend(repository);
  }

  try {
    return await processQueuedJobEnvelope(envelope, repository);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Queued job failed";
    const failedEnvelope = buildFailedJobEnvelope(envelope, message);
    if (failedEnvelope.attempts < getMaxJobAttemptsForEnvelope(envelope)) {
      await enqueueJob(queueName, failedEnvelope);
      return { processed: true, jobType: envelope.type, requeued: true, error: message };
    }

    await enqueueJob(getDeadLetterQueueName(queueName), failedEnvelope);
    if (envelope.type === "csv_import") {
      await repository.markCsvImportJobFailedFromWorker(envelope.workspaceId, envelope.jobId, envelope.payload.objectKey, message);
    }
    if (envelope.type === "email_sync") {
      await markDeadLetteredEmailSyncFailed(repository, envelope, message);
    }
    return { processed: true, jobType: envelope.type, deadLettered: true, error: message };
  }
}

async function markDeadLetteredEmailSyncFailed(repository: PrismaCrmRepository, envelope: QueuedJobEnvelope, message: string) {
  try {
    const context = await getRequestContextByUserId(envelope.userId);
    if (context.workspaceId !== envelope.workspaceId || envelope.type !== "email_sync") {
      return;
    }
    await repository.markEmailAccountSyncFailed(context, envelope.payload.accountId, message);
  } catch {
    // The dead-letter entry remains the source of truth if account status update fails.
  }
}

async function processDueQueuedEmailSend(repository: PrismaCrmRepository): Promise<JobWorkerResult> {
  const dueMessages = await repository.listDueQueuedEmailMessagesForWorker(1);
  const message = dueMessages[0];
  if (!message?.createdById) {
    return { processed: false };
  }
  const context = await getRequestContextByUserId(message.createdById);
  if (context.workspaceId !== message.workspaceId) {
    return { processed: false };
  }
  const emailMessage = await createEmailProviderAdapter(repository).sendQueued(context, message.id);
  return { processed: true, jobType: "email_send", scheduledEmailSend: true, emailMessage };
}

async function processDueWorkflowAutomation(repository: PrismaCrmRepository): Promise<JobWorkerResult | undefined> {
  const userId = process.env.WORKFLOW_AUTOMATION_USER_ID || process.env.EMAIL_SYNC_USER_ID || "user-admin";
  let context: Awaited<ReturnType<typeof getRequestContextByUserId>>;
  try {
    context = await getRequestContextByUserId(userId);
  } catch {
    return undefined;
  }
  const workflowResumeScan = await repository.runWorkflowResumeScan(context, { limit: 25 });
  if (workflowResumeScan.resumed > 0) {
    return { processed: true, jobType: "workflow_resume_scan", workflowResumeScan, workflowRuns: workflowResumeScan.runs };
  }
  const workflowScheduleScan = await repository.runWorkflowScheduleScan(context, { limit: 50 });
  if (workflowScheduleScan.triggered > 0) {
    return { processed: true, jobType: "workflow_schedule_scan", workflowScheduleScan, workflowRuns: workflowScheduleScan.runs };
  }
  return undefined;
}

export async function processQueuedJobEnvelope(
  envelope: QueuedJobEnvelope,
  repository: PrismaCrmRepository = getCrmRepository(),
  loadContext: (userId: string) => Promise<Awaited<ReturnType<typeof getRequestContextByUserId>>> = getRequestContextByUserId
): Promise<JobWorkerResult> {
  const context = await loadContext(envelope.userId);
  if (context.workspaceId !== envelope.workspaceId) {
    throw new Error("Queued job workspace does not match the requesting user");
  }

  if (envelope.type === "csv_import") {
    const job = await repository.runCsvImportJob(context, envelope.jobId, envelope.payload);
    return { processed: true, jobType: envelope.type, job };
  }

  if (envelope.type === "webhook_event") {
    const deliveries = await repository.deliverWebhookEvent(context, envelope.payload.event, envelope.payload.data);
    return { processed: true, jobType: envelope.type, deliveries };
  }

  if (envelope.type === "email_sync") {
    const emailSync = await createEmailProviderAdapter(repository).sync(context, envelope.payload.accountId, envelope.payload.limit);
    return { processed: true, jobType: envelope.type, emailSync };
  }

  if (envelope.type === "email_send") {
    const emailMessage = await createEmailProviderAdapter(repository).sendQueued(context, envelope.payload.messageId);
    return { processed: true, jobType: envelope.type, emailMessage };
  }

  if (envelope.type === "email_translate") {
    const emailMessage = await translateEmailMessage(context, repository, envelope.payload);
    return { processed: true, jobType: envelope.type, emailMessage };
  }

  if (envelope.type === "email_analyze") {
    const result = await analyzeEmailThreadWithAi(context, repository, envelope.payload);
    return { processed: true, jobType: envelope.type, emailThread: result.thread };
  }

  if (envelope.type === "email_summarize") {
    const result = await summarizeEmailThreadWithAi(context, repository, envelope.payload);
    return { processed: true, jobType: envelope.type, emailThread: result.thread };
  }

  if (envelope.type === "workflow_run") {
    const workflowRuns = await repository.runWorkflowsForEvent(context, envelope.payload.event, envelope.payload.data, {
      workflowId: envelope.payload.workflowId,
      idempotencyKey: envelope.payload.idempotencyKey
    });
    return { processed: true, jobType: envelope.type, workflowRuns };
  }

  if (envelope.type === "workflow_resume_scan") {
    const workflowResumeScan = await repository.runWorkflowResumeScan(context, { limit: envelope.payload.limit });
    return { processed: true, jobType: envelope.type, workflowResumeScan, workflowRuns: workflowResumeScan.runs };
  }

  if (envelope.type === "workflow_schedule_scan") {
    const workflowScheduleScan = await repository.runWorkflowScheduleScan(context, { limit: envelope.payload.limit });
    return { processed: true, jobType: envelope.type, workflowScheduleScan, workflowRuns: workflowScheduleScan.runs };
  }

  throw new Error(`Unsupported queued job type: ${(envelope as { type?: string }).type}`);
}

export function formatJobWorkerResult(result: JobWorkerResult): string | undefined {
  if (!result.processed) {
    return undefined;
  }
  if (result.requeued) {
    return `Requeued ${result.jobType ?? "job"} after worker error: ${result.error ?? "unknown error"}`;
  }
  if (result.deadLettered) {
    return `Moved ${result.jobType ?? "job"} to dead letter queue: ${result.error ?? "unknown error"}`;
  }
  if (result.emailSync) {
    return `Processed email sync for ${result.emailSync.account.emailAddress} with status ${result.emailSync.status}`;
  }
  if (result.emailMessage) {
    const action = result.jobType === "email_translate" ? "translate" : "send";
    return `Processed email ${result.scheduledEmailSend ? "scheduled " : ""}${action} ${result.emailMessage.id} with status ${result.emailMessage.status}`;
  }
  if (result.emailThread) {
    const action = result.jobType === "email_analyze" ? "analyze" : result.jobType === "email_summarize" ? "summarize" : "thread";
    return `Processed email ${action} for thread ${result.emailThread.id}`;
  }
  if (result.deliveries) {
    return `Processed webhook event with ${result.deliveries.length} deliveries`;
  }
  if (result.workflowResumeScan) {
    return `Processed workflow resume scan: ${result.workflowResumeScan.resumed}/${result.workflowResumeScan.scanned} resumed`;
  }
  if (result.workflowScheduleScan) {
    return `Processed workflow schedule scan: ${result.workflowScheduleScan.triggered}/${result.workflowScheduleScan.scanned} triggered`;
  }
  if (result.workflowRuns) {
    return `Processed workflow run job with ${result.workflowRuns.length} run(s)`;
  }
  if (result.job) {
    return `Processed csv import ${result.job.id} with status ${result.job.status}`;
  }
  return `Processed ${result.jobType ?? "job"}`;
}
