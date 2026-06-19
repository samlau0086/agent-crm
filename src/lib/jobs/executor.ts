import type { PrismaCrmRepository } from "@/lib/crm/repository";
import type { CsvImportJob, CsvImportMapping, CsvImportStrategy, RequestContext, WebhookDelivery, WebhookEvent } from "@/lib/crm/types";
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

export type QueuedJobEnvelope = CsvImportQueuedJobEnvelope | WebhookEventQueuedJobEnvelope;

export interface BackgroundJobExecutor {
  runCsvImportJob(context: RequestContext, jobId: string, payload: CsvImportJobPayload): Promise<CsvImportJob>;
  runWebhookEvent(context: RequestContext, payload: WebhookEventJobPayload): Promise<{ queued: boolean; deliveries?: WebhookDelivery[] }>;
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

export function getBackgroundJobExecutor(repository: PrismaCrmRepository): BackgroundJobExecutor {
  if (process.env.JOB_EXECUTOR === "redis") {
    return new RedisBackgroundJobExecutor(repository);
  }

  return new InlineBackgroundJobExecutor(repository);
}
