import type { EmailAccount } from "@/lib/crm/types";

const DEFAULT_STALE_AFTER_MS = 10 * 60 * 1000;

export interface EmailSyncProgressState {
  inProgress: boolean;
  stale: boolean;
  reason?: string;
  staleMessage?: string;
}

export function getEmailSyncProgressState(account: EmailAccount, now: Date = new Date()): EmailSyncProgressState {
  if (account.lastSyncStatus !== "queued" && account.lastSyncStatus !== "running") {
    return { inProgress: false, stale: false };
  }

  const timestamp = account.lastSyncStatus === "running" ? account.lastSyncStartedAt : account.updatedAt;
  const ageMs = timestamp ? now.getTime() - new Date(timestamp).getTime() : 0;
  const staleAfterMs = getEmailSyncStaleAfterMs();
  const stale = Number.isFinite(ageMs) && ageMs > staleAfterMs;
  const staleMinutes = Math.max(1, Math.round(staleAfterMs / 60000));

  if (stale) {
    return {
      inProgress: true,
      stale: true,
      staleMessage: `上一轮邮件同步超过 ${staleMinutes} 分钟未结束，已标记为失败，可重新同步。`
    };
  }

  return {
    inProgress: true,
    stale: false,
    reason: account.lastSyncStatus === "queued" ? "同步已在队列中，等待后台 worker 开始拉取" : "正在拉取邮件，请等待当前同步完成"
  };
}

export function buildEmailSyncInProgressResult(account: EmailAccount) {
  return {
    account,
    importedCount: account.lastSyncImportedCount ?? 0,
    scannedCount: account.lastSyncScannedCount ?? 0,
    skippedDuplicateCount: account.lastSyncSkippedDuplicateCount ?? 0,
    hasMore: false,
    status: account.lastSyncStatus ?? "queued"
  };
}

function getEmailSyncStaleAfterMs(): number {
  const raw = process.env.EMAIL_SYNC_STALE_AFTER_MS;
  if (!raw) {
    return DEFAULT_STALE_AFTER_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STALE_AFTER_MS;
}
