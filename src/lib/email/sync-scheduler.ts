import { requirePermission } from "@/lib/auth/rbac";
import { getCrmRepository, type PrismaCrmRepository } from "@/lib/crm/repository";
import type { EmailAccount, RequestContext } from "@/lib/crm/types";
import { getEmailProviderCapability } from "@/lib/email/providers";
import { getEmailSyncProgressState } from "@/lib/email/sync-state";
import { getBackgroundJobExecutor, type BackgroundJobExecutor } from "@/lib/jobs/executor";

export interface ScheduledEmailSyncAccount {
  accountId: string;
  emailAddress: string;
  account?: EmailAccount;
  status: string;
  importedCount: number;
  scannedCount?: number;
  skippedDuplicateCount?: number;
  hasMore?: boolean;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
}

export interface ScheduledEmailSyncSummary {
  scheduledCount: number;
  skippedCount: number;
  limit?: number;
  fullResync?: boolean;
  accounts: ScheduledEmailSyncAccount[];
}

export async function scheduleEmailSyncForActiveAccounts(
  context: RequestContext,
  options: { repository?: PrismaCrmRepository; executor?: BackgroundJobExecutor; limit?: number; fullResync?: boolean } = {}
): Promise<ScheduledEmailSyncSummary> {
  requirePermission(context, "crm.admin");
  const repository = options.repository ?? getCrmRepository();
  const executor = options.executor ?? getBackgroundJobExecutor(repository);
  const accounts = await repository.listEmailAccounts(context);
  const results: ScheduledEmailSyncAccount[] = [];

  for (const account of accounts) {
    let currentAccount = account;
    const progress = getEmailSyncProgressState(currentAccount);
    if (progress.inProgress && !progress.stale) {
      results.push({
        accountId: currentAccount.id,
        emailAddress: currentAccount.emailAddress,
        account: currentAccount,
        status: "skipped",
        importedCount: 0,
        skipped: true,
        skipReason: progress.reason
      });
      continue;
    }
    if (progress.stale && progress.staleMessage) {
      currentAccount = await repository.markEmailAccountSyncFailed(context, currentAccount.id, progress.staleMessage);
    }

    const skipReason = getEmailSyncSkipReason(currentAccount);
    if (skipReason) {
      results.push({
        accountId: currentAccount.id,
        emailAddress: currentAccount.emailAddress,
        account: currentAccount,
        status: "skipped",
        importedCount: 0,
        skipped: true,
        skipReason
      });
      continue;
    }

    try {
      const result = await executor.runEmailSyncJob(context, { accountId: currentAccount.id, limit: options.limit, fullResync: options.fullResync });
      results.push({
        accountId: currentAccount.id,
        emailAddress: currentAccount.emailAddress,
        account: result.account,
        status: result.status,
        importedCount: result.importedCount,
        scannedCount: result.scannedCount,
        skippedDuplicateCount: result.skippedDuplicateCount,
        hasMore: result.hasMore
      });
    } catch (error) {
      results.push({
        accountId: currentAccount.id,
        emailAddress: currentAccount.emailAddress,
        account: currentAccount,
        status: "failed",
        importedCount: 0,
        error: error instanceof Error ? error.message : "Email sync scheduling failed"
      });
    }
  }

  const summary: ScheduledEmailSyncSummary = {
    scheduledCount: results.filter((result) => result.status !== "failed" && result.status !== "skipped").length,
    skippedCount: results.filter((result) => result.status === "skipped").length,
    accounts: results
  };
  if (options.limit !== undefined) {
    summary.limit = options.limit;
  }
  if (options.fullResync !== undefined) {
    summary.fullResync = options.fullResync;
  }
  return summary;
}

function getEmailSyncSkipReason(account: EmailAccount): string | undefined {
  const capability = getEmailProviderCapability(account.provider);
  if (account.status !== "active" && account.status !== "error") {
    return `账号状态为 ${account.status}`;
  }
  if (!account.syncEnabled) {
    return "未开启收件同步";
  }
  if (!account.connectionConfigured) {
    return "未配置收件连接";
  }
  if (!capability.supportsSync) {
    return `${capability.label} 不支持收件同步`;
  }
  return undefined;
}
