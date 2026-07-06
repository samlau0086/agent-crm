import { getCrmRepository, type PrismaCrmRepository } from "@/lib/crm/repository";
import type { EmailAccount, RequestContext } from "@/lib/crm/types";
import { requirePermission } from "@/lib/auth/rbac";
import { getBackgroundJobExecutor, type BackgroundJobExecutor } from "@/lib/jobs/executor";
import { getEmailProviderCapability } from "@/lib/email/providers";

export interface ScheduledEmailSyncAccount {
  accountId: string;
  emailAddress: string;
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
  accounts: ScheduledEmailSyncAccount[];
}

export async function scheduleEmailSyncForActiveAccounts(
  context: RequestContext,
  options: { repository?: PrismaCrmRepository; executor?: BackgroundJobExecutor; limit?: number } = {}
): Promise<ScheduledEmailSyncSummary> {
  requirePermission(context, "crm.admin");
  const repository = options.repository ?? getCrmRepository();
  const executor = options.executor ?? getBackgroundJobExecutor(repository);
  const accounts = await repository.listEmailAccounts(context);
  const results: ScheduledEmailSyncAccount[] = [];

  for (const account of accounts) {
    const skipReason = getEmailSyncSkipReason(account);
    if (skipReason) {
      results.push({
        accountId: account.id,
        emailAddress: account.emailAddress,
        status: "skipped",
        importedCount: 0,
        skipped: true,
        skipReason
      });
      continue;
    }

    try {
      const result = await executor.runEmailSyncJob(context, { accountId: account.id, limit: options.limit });
      results.push({
        accountId: account.id,
        emailAddress: account.emailAddress,
        status: result.status,
        importedCount: result.importedCount,
        scannedCount: result.scannedCount,
        skippedDuplicateCount: result.skippedDuplicateCount,
        hasMore: result.hasMore
      });
    } catch (error) {
      results.push({
        accountId: account.id,
        emailAddress: account.emailAddress,
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
