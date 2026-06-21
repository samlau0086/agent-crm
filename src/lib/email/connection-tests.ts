import type { EmailAccount, RequestContext } from "@/lib/crm/types";
import type { PrismaCrmRepository } from "@/lib/crm/repository";
import { requirePermission } from "@/lib/auth/rbac";
import { createEmailProviderAdapter, type EmailConnectionTestSummary, type EmailProviderAdapter } from "@/lib/email/provider";

export interface EmailConnectionTestRunResult {
  account: EmailAccount;
  ok: boolean;
  skipped: boolean;
  result?: EmailConnectionTestSummary["result"];
  reason?: string;
  error?: string;
}

export interface EmailConnectionTestRun {
  testedAt: string;
  total: number;
  tested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: EmailConnectionTestRunResult[];
}

export interface TestEmailAccountConnectionsOptions {
  adapter?: EmailProviderAdapter;
  now?: Date;
}

export async function testEmailAccountConnections(
  context: RequestContext,
  repository: Pick<PrismaCrmRepository, "listEmailAccounts">,
  options: TestEmailAccountConnectionsOptions = {}
): Promise<EmailConnectionTestRun> {
  requirePermission(context, "crm.admin");
  const accounts = await repository.listEmailAccounts(context);
  const adapter = options.adapter ?? createEmailProviderAdapter(repository as PrismaCrmRepository);
  const results: EmailConnectionTestRunResult[] = [];

  for (const account of accounts) {
    if (account.status !== "active") {
      results.push({ account, ok: false, skipped: true, reason: "Account is not active" });
      continue;
    }
    if (!account.connectionConfigured) {
      results.push({ account, ok: false, skipped: true, reason: "Connection is not configured" });
      continue;
    }

    try {
      const summary = await adapter.testConnection(context, account.id);
      results.push({ account: summary.account, ok: true, skipped: false, result: summary.result });
    } catch (error) {
      const failedAccount = extractFailedAccount(error) ?? account;
      results.push({ account: failedAccount, ok: false, skipped: false, error: error instanceof Error ? error.message : "Connection test failed" });
    }
  }

  const tested = results.filter((result) => !result.skipped).length;
  const succeeded = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok && !result.skipped).length;
  const skipped = results.filter((result) => result.skipped).length;

  return {
    testedAt: (options.now ?? new Date()).toISOString(),
    total: accounts.length,
    tested,
    succeeded,
    failed,
    skipped,
    results
  };
}

function extractFailedAccount(error: unknown): EmailAccount | undefined {
  if (!error || typeof error !== "object" || !("account" in error)) {
    return undefined;
  }
  return (error as { account?: EmailAccount }).account;
}
