import type { QueuedJobEnvelope } from "@/lib/jobs/executor";

const DEFAULT_MAX_JOB_ATTEMPTS = 3;
const DEFAULT_EMAIL_SYNC_MAX_JOB_ATTEMPTS = 1;

export function getMaxJobAttempts(): number {
  const value = Number(process.env.JOB_MAX_ATTEMPTS || DEFAULT_MAX_JOB_ATTEMPTS);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_JOB_ATTEMPTS;
}

export function getMaxJobAttemptsForEnvelope(envelope: QueuedJobEnvelope): number {
  if (envelope.type !== "email_sync") {
    return getMaxJobAttempts();
  }
  const value = Number(process.env.EMAIL_SYNC_JOB_MAX_ATTEMPTS || DEFAULT_EMAIL_SYNC_MAX_JOB_ATTEMPTS);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_EMAIL_SYNC_MAX_JOB_ATTEMPTS;
}

export function buildFailedJobEnvelope(envelope: QueuedJobEnvelope, errorMessage: string): QueuedJobEnvelope {
  return {
    ...envelope,
    attempts: (envelope.attempts ?? 0) + 1,
    lastError: errorMessage
  };
}
