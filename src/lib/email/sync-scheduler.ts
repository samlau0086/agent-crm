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
  const eligible = accounts.filter(isEligibleForBackgroundSync);
  const results: ScheduledEmailSyncAccount[] = [];

  for (const account of eligible) {
    try {
      const result = await executor.runEmailSyncJob(context, { accountId: account.id, limit: options.limit });
      results.push({
        accountId: account.id,
        emailAddress: account.emailAddress,
        status: result.status,
        importedCount: result.importedCount
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
    scheduledCount: results.filter((result) => result.status !== "failed").length,
    skippedCount: accounts.length - eligible.length,
    accounts: results
  };
  if (options.limit !== undefined) {
    summary.limit = options.limit;
  }
  return summary;
}

function isEligibleForBackgroundSync(account: EmailAccount): boolean {
  return account.status === "active" && account.syncEnabled && account.connectionConfigured && getEmailProviderCapability(account.provider).supportsSync;
}
