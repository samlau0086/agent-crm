import type { PrismaCrmRepository } from "@/lib/crm/repository";
import type {
  CsvImportJob,
  CsvImportMapping,
  CsvImportStrategy,
  EmailMessage,
  EmailThread,
  RequestContext,
  WebhookDelivery,
  WebhookEvent,
  WorkflowRun
} from "@/lib/crm/types";
import { requirePermission } from "@/lib/auth/rbac";
import { analyzeEmailThreadWithAi, type EmailAnalyzeJobPayload, type EmailAnalyzeResult } from "@/lib/email/analysis";
import { createEmailProviderAdapter, type EmailSyncResult } from "@/lib/email/provider";
import { summarizeEmailThreadWithAi, type EmailSummarizeJobPayload, type EmailSummarizeResult } from "@/lib/email/summarization";
import { translateEmailMessage, type EmailTranslateJobPayload } from "@/lib/email/translation";
import { enqueueJob, getJobQueueName } from "@/lib/jobs/redis-queue";

export interface CsvImportJobPayload {
  objectKey: string;
  csv: string;
  strategy?: CsvImportStrategy;
  mapping?: CsvImportMapping;
  presetId?: string;
  presetName?: string;
}

export interface WebhookEventJobPayload {
  event: WebhookEvent;
  data: Record<string, unknown>;
}

export interface EmailSyncJobPayload {
  accountId: string;
  limit?: number;
}

export interface EmailSendJobPayload {
  messageId: string;
}

export interface WorkflowRunJobPayload {
  workflowId?: string;
  event: string;
  data: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface CsvImportQueuedJobEnvelope {
  type: "csv_import";
  workspaceId: string;
  userId: string;
  jobId: string;
  payload: CsvImportJobPayload;
  enqueuedAt: string;
  attempts: number;
  lastError?: string;
}

export interface WebhookEventQueuedJobEnvelope {
  type: "webhook_event";
  workspaceId: string;
  userId: string;
  payload: WebhookEventJobPayload;
  enqueuedAt: string;
  attempts: number;
  lastError?: string;
}

export interface EmailSyncQueuedJobEnvelope {
  type: "email_sync";
  workspaceId: string;
  userId: string;
  payload: EmailSyncJobPayload;
  enqueuedAt: string;
  attempts: number;
  lastError?: string;
}

export interface EmailSendQueuedJobEnvelope {
  type: "email_send";
  workspaceId: string;
  userId: string;
  payload: EmailSendJobPayload;
  enqueuedAt: string;
  attempts: number;
  lastError?: string;
}

export interface EmailTranslateQueuedJobEnvelope {
  type: "email_translate";
  workspaceId: string;
  userId: string;
  payload: EmailTranslateJobPayload;
  enqueuedAt: string;
  attempts: number;
  lastError?: string;
}

export interface EmailAnalyzeQueuedJobEnvelope {
  type: "email_analyze";
  workspaceId: string;
  userId: string;
  payload: EmailAnalyzeJobPayload;
  enqueuedAt: string;
  attempts: number;
  lastError?: string;
}

export interface EmailSummarizeQueuedJobEnvelope {
  type: "email_summarize";
  workspaceId: string;
  userId: string;
  payload: EmailSummarizeJobPayload;
  enqueuedAt: string;
  attempts: number;
  lastError?: string;
}

export interface WorkflowRunQueuedJobEnvelope {
  type: "workflow_run";
  workspaceId: string;
  userId: string;
  payload: WorkflowRunJobPayload;
  enqueuedAt: string;
  attempts: number;
  lastError?: string;
}

export type QueuedJobEnvelope =
  | CsvImportQueuedJobEnvelope
  | WebhookEventQueuedJobEnvelope
  | EmailSyncQueuedJobEnvelope
  | EmailSendQueuedJobEnvelope
  | EmailTranslateQueuedJobEnvelope
  | EmailAnalyzeQueuedJobEnvelope
  | EmailSummarizeQueuedJobEnvelope
  | WorkflowRunQueuedJobEnvelope;

export interface BackgroundJobExecutor {
  runCsvImportJob(context: RequestContext, jobId: string, payload: CsvImportJobPayload): Promise<CsvImportJob>;
  runWebhookEvent(context: RequestContext, payload: WebhookEventJobPayload): Promise<{ queued: boolean; deliveries?: WebhookDelivery[] }>;
  runEmailSyncJob(context: RequestContext, payload: EmailSyncJobPayload): Promise<EmailSyncResult>;
  runEmailSendJob(context: RequestContext, payload: EmailSendJobPayload): Promise<EmailMessage>;
  runEmailTranslateJob(context: RequestContext, payload: EmailTranslateJobPayload): Promise<EmailMessage>;
  runEmailAnalyzeJob(context: RequestContext, payload: EmailAnalyzeJobPayload): Promise<EmailAnalyzeResult>;
  runEmailSummarizeJob(context: RequestContext, payload: EmailSummarizeJobPayload): Promise<EmailSummarizeResult>;
  runWorkflowJob(context: RequestContext, payload: WorkflowRunJobPayload): Promise<WorkflowRun[]>;
}

export class InlineBackgroundJobExecutor implements BackgroundJobExecutor {
  private readonly repository: PrismaCrmRepository;

  constructor(repository: PrismaCrmRepository) {
    this.repository = repository;
  }

  async runCsvImportJob(context: RequestContext, jobId: string, payload: CsvImportJobPayload): Promise<CsvImportJob> {
    return this.repository.runCsvImportJob(context, jobId, payload);
  }

  async runWebhookEvent(context: RequestContext, payload: WebhookEventJobPayload): Promise<{ queued: boolean; deliveries: WebhookDelivery[] }> {
    return { queued: false, deliveries: await this.repository.deliverWebhookEvent(context, payload.event, payload.data) };
  }

  async runEmailSyncJob(context: RequestContext, payload: EmailSyncJobPayload): Promise<EmailSyncResult> {
    return createEmailProviderAdapter(this.repository).sync(context, payload.accountId, payload.limit);
  }

  async runEmailSendJob(context: RequestContext, payload: EmailSendJobPayload): Promise<EmailMessage> {
    return createEmailProviderAdapter(this.repository).sendQueued(context, payload.messageId);
  }

  async runEmailTranslateJob(context: RequestContext, payload: EmailTranslateJobPayload): Promise<EmailMessage> {
    return translateEmailMessage(context, this.repository, payload);
  }

  async runEmailAnalyzeJob(context: RequestContext, payload: EmailAnalyzeJobPayload): Promise<EmailAnalyzeResult> {
    return analyzeEmailThreadWithAi(context, this.repository, payload);
  }

  async runEmailSummarizeJob(context: RequestContext, payload: EmailSummarizeJobPayload): Promise<EmailSummarizeResult> {
    return summarizeEmailThreadWithAi(context, this.repository, payload);
  }

  async runWorkflowJob(context: RequestContext, payload: WorkflowRunJobPayload): Promise<WorkflowRun[]> {
    return this.repository.runWorkflowsForEvent(context, payload.event, payload.data, { workflowId: payload.workflowId, idempotencyKey: payload.idempotencyKey });
  }
}

export class RedisBackgroundJobExecutor implements BackgroundJobExecutor {
  private readonly repository: PrismaCrmRepository;

  constructor(repository: PrismaCrmRepository) {
    this.repository = repository;
  }

  async runCsvImportJob(context: RequestContext, jobId: string, payload: CsvImportJobPayload): Promise<CsvImportJob> {
    const envelope = buildCsvImportJobEnvelope(context, jobId, payload);
    await enqueueJob(getJobQueueName(), envelope);
    return this.repository.getImportJob(context, jobId);
  }

  async runWebhookEvent(context: RequestContext, payload: WebhookEventJobPayload): Promise<{ queued: boolean }> {
    await enqueueJob(getJobQueueName(), buildWebhookEventEnvelope(context, payload));
    return { queued: true };
  }

  async runEmailSyncJob(context: RequestContext, payload: EmailSyncJobPayload): Promise<EmailSyncResult> {
    requirePermission(context, "crm.admin");
    await enqueueJob(getJobQueueName(), buildEmailSyncJobEnvelope(context, payload));
    const account = await this.repository.markEmailAccountSyncQueued(context, payload.accountId);
    return {
      account,
      importedCount: 0,
      scannedCount: 0,
      skippedDuplicateCount: 0,
      hasMore: false,
      status: "queued"
    };
  }

  async runEmailSendJob(context: RequestContext, payload: EmailSendJobPayload): Promise<EmailMessage> {
    requirePermission(context, "crm.write");
    await enqueueJob(getJobQueueName(), buildEmailSendJobEnvelope(context, payload));
    return this.repository.getEmailMessage(context, payload.messageId);
  }

  async runEmailTranslateJob(context: RequestContext, payload: EmailTranslateJobPayload): Promise<EmailMessage> {
    requirePermission(context, "ai.use");
    await enqueueJob(getJobQueueName(), buildEmailTranslateJobEnvelope(context, payload));
    return this.repository.getEmailMessage(context, payload.messageId);
  }

  async runEmailAnalyzeJob(context: RequestContext, payload: EmailAnalyzeJobPayload): Promise<EmailAnalyzeResult> {
    requirePermission(context, "ai.use");
    await enqueueJob(getJobQueueName(), buildEmailAnalyzeJobEnvelope(context, payload));
    const thread = (await this.repository.listEmailThreads(context)).find((candidate) => candidate.id === payload.threadId);
    if (!thread) {
      throw new Error("Email thread not found");
    }
    return {
      updated: false,
      queued: true,
      thread,
      result: buildQueuedEmailAnalyzeResult(thread, payload.sourceMessageId)
    };
  }

  async runEmailSummarizeJob(context: RequestContext, payload: EmailSummarizeJobPayload): Promise<EmailSummarizeResult> {
    requirePermission(context, "ai.use");
    await enqueueJob(getJobQueueName(), buildEmailSummarizeJobEnvelope(context, payload));
    const thread = (await this.repository.listEmailThreads(context)).find((candidate) => candidate.id === payload.threadId);
    if (!thread) {
      throw new Error("Email thread not found");
    }
    return {
      updated: false,
      queued: true,
      thread,
      result: buildQueuedEmailSummarizeResult(thread)
    };
  }

  async runWorkflowJob(context: RequestContext, payload: WorkflowRunJobPayload): Promise<WorkflowRun[]> {
    await enqueueJob(getJobQueueName(), buildWorkflowRunJobEnvelope(context, payload));
    return [];
  }
}

function buildQueuedEmailAnalyzeResult(thread: EmailThread, sourceMessageId?: string): EmailAnalyzeResult["result"] {
  return {
    enabled: false,
    purpose: "context_analysis",
    threadId: thread.id,
    recordId: thread.recordId,
    sourceMessageId,
    generationMode: "queued",
    text: "Email thread analysis has been queued.",
    sources: [{ label: thread.subject, ...(thread.recordId ? { recordId: thread.recordId } : {}) }],
    budget: {
      maxContextChars: 0,
      contextCharCount: 0,
      modelPromptChars: 0,
      truncated: false,
      outputTruncated: false
    }
  };
}

function buildQueuedEmailSummarizeResult(thread: EmailThread): EmailSummarizeResult["result"] {
  return {
    enabled: false,
    purpose: "summarize",
    threadId: thread.id,
    recordId: thread.recordId,
    generationMode: "queued",
    text: "Email thread summarization has been queued.",
    sources: [{ label: thread.subject, ...(thread.recordId ? { recordId: thread.recordId } : {}) }],
    budget: {
      maxContextChars: 0,
      contextCharCount: 0,
      modelPromptChars: 0,
      truncated: false,
      outputTruncated: false
    }
  };
}

export function buildCsvImportJobEnvelope(context: RequestContext, jobId: string, payload: CsvImportJobPayload): CsvImportQueuedJobEnvelope {
  return {
    type: "csv_import",
    workspaceId: context.workspaceId,
    userId: context.user.id,
    jobId,
    payload,
    enqueuedAt: new Date().toISOString(),
    attempts: 0
  };
}

export function buildWebhookEventEnvelope(context: RequestContext, payload: WebhookEventJobPayload): WebhookEventQueuedJobEnvelope {
  return {
    type: "webhook_event",
    workspaceId: context.workspaceId,
    userId: context.user.id,
    payload,
    enqueuedAt: new Date().toISOString(),
    attempts: 0
  };
}

export function buildEmailSyncJobEnvelope(context: RequestContext, payload: EmailSyncJobPayload): EmailSyncQueuedJobEnvelope {
  return {
    type: "email_sync",
    workspaceId: context.workspaceId,
    userId: context.user.id,
    payload,
    enqueuedAt: new Date().toISOString(),
    attempts: 0
  };
}

export function buildEmailSendJobEnvelope(context: RequestContext, payload: EmailSendJobPayload): EmailSendQueuedJobEnvelope {
  return {
    type: "email_send",
    workspaceId: context.workspaceId,
    userId: context.user.id,
    payload,
    enqueuedAt: new Date().toISOString(),
    attempts: 0
  };
}

export function buildEmailTranslateJobEnvelope(context: RequestContext, payload: EmailTranslateJobPayload): EmailTranslateQueuedJobEnvelope {
  return {
    type: "email_translate",
    workspaceId: context.workspaceId,
    userId: context.user.id,
    payload,
    enqueuedAt: new Date().toISOString(),
    attempts: 0
  };
}

export function buildEmailAnalyzeJobEnvelope(context: RequestContext, payload: EmailAnalyzeJobPayload): EmailAnalyzeQueuedJobEnvelope {
  return {
    type: "email_analyze",
    workspaceId: context.workspaceId,
    userId: context.user.id,
    payload,
    enqueuedAt: new Date().toISOString(),
    attempts: 0
  };
}

export function buildEmailSummarizeJobEnvelope(context: RequestContext, payload: EmailSummarizeJobPayload): EmailSummarizeQueuedJobEnvelope {
  return {
    type: "email_summarize",
    workspaceId: context.workspaceId,
    userId: context.user.id,
    payload,
    enqueuedAt: new Date().toISOString(),
    attempts: 0
  };
}

export function buildWorkflowRunJobEnvelope(context: RequestContext, payload: WorkflowRunJobPayload): WorkflowRunQueuedJobEnvelope {
  return {
    type: "workflow_run",
    workspaceId: context.workspaceId,
    userId: context.user.id,
    payload,
    enqueuedAt: new Date().toISOString(),
    attempts: 0
  };
}

export function getBackgroundJobExecutor(repository: PrismaCrmRepository): BackgroundJobExecutor {
  if (process.env.JOB_EXECUTOR === "redis") {
    return new RedisBackgroundJobExecutor(repository);
  }

  return new InlineBackgroundJobExecutor(repository);
}
