import type { EmailAccount, RequestContext } from "@/lib/crm/types";
import type { EmailSyncResult } from "@/lib/email/provider";

export interface EmailSyncFailureLookup {
  getEmailAccount(context: RequestContext, accountId: string): EmailAccount | Promise<EmailAccount>;
}

export type FailedEmailSyncResult = EmailSyncResult & { error?: string };

export async function getFailedEmailSyncResultOrThrow(
  context: RequestContext,
  repository: EmailSyncFailureLookup,
  accountId: string,
  error: unknown
): Promise<FailedEmailSyncResult> {
  try {
    const account = await repository.getEmailAccount(context, accountId);
    return {
      account,
      importedCount: 0,
      scannedCount: 0,
      skippedDuplicateCount: 0,
      hasMore: false,
      status: "failed",
      error: account.lastConnectionError || (error instanceof Error ? error.message : "Email sync failed")
    };
  } catch {
    // Preserve the original sync failure if the follow-up lookup also fails.
  }
  throw error;
}
