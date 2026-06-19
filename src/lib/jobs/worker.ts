import { getRequestContextByUserId, getCrmRepository, type PrismaCrmRepository } from "@/lib/crm/repository";
import type { CsvImportJob, WebhookDelivery } from "@/lib/crm/types";
import type { QueuedJobEnvelope } from "@/lib/jobs/executor";
import { dequeueJob, enqueueJob, getDeadLetterQueueName, getJobQueueName } from "@/lib/jobs/redis-queue";
import { buildFailedJobEnvelope, getMaxJobAttempts } from "@/lib/jobs/worker-policy";

export interface JobWorkerResult {
  processed: boolean;
  requeued?: boolean;
  deadLettered?: boolean;
  error?: string;
  job?: CsvImportJob;
  deliveries?: WebhookDelivery[];
}

export async function runQueuedJobOnce(repository: PrismaCrmRepository = getCrmRepository()): Promise<JobWorkerResult> {
  const queueName = getJobQueueName();
  const envelope = await dequeueJob<QueuedJobEnvelope>(queueName);
  if (!envelope) {
    return { processed: false };
  }

  try {
    const context = await getRequestContextByUserId(envelope.userId);
    if (context.workspaceId !== envelope.workspaceId) {
      throw new Error("Queued job workspace does not match the requesting user");
    }

    if (envelope.type === "csv_import") {
      const job = await repository.runCsvImportJob(context, envelope.jobId, envelope.payload);
      return { processed: true, job };
    }

    if (envelope.type === "webhook_event") {
      const deliveries = await repository.deliverWebhookEvent(context, envelope.payload.event, envelope.payload.data);
      return { processed: true, deliveries };
    }

    throw new Error(`Unsupported queued job type: ${(envelope as { type?: string }).type}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Queued job failed";
    const failedEnvelope = buildFailedJobEnvelope(envelope, message);
    if (failedEnvelope.attempts < getMaxJobAttempts()) {
      await enqueueJob(queueName, failedEnvelope);
      return { processed: true, requeued: true, error: message };
    }

    await enqueueJob(getDeadLetterQueueName(queueName), failedEnvelope);
    if (envelope.type === "csv_import") {
      await repository.markCsvImportJobFailedFromWorker(envelope.workspaceId, envelope.jobId, envelope.payload.objectKey, message);
    }
    return { processed: true, deadLettered: true, error: message };
  }
}
