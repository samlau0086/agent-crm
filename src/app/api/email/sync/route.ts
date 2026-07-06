import type { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { emailSyncSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";
import { getFailedEmailSyncResultOrThrow } from "@/lib/email/sync-failure";
import { buildEmailSyncInProgressResult, getEmailSyncProgressState } from "@/lib/email/sync-state";
import { getBackgroundJobExecutor } from "@/lib/jobs/executor";


export const dynamic = "force-dynamic";
async function postApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, emailSyncSchema);
    const repository = getCrmRepository();
    requirePermission(context, "crm.admin");
    const account = await repository.getEmailAccount(context, body.accountId);
    const progress = getEmailSyncProgressState(account);
    if (progress.inProgress && !progress.stale) {
      return ok(buildEmailSyncInProgressResult(account), { status: 202 });
    }
    if (progress.stale && progress.staleMessage) {
      await repository.markEmailAccountSyncFailed(context, body.accountId, progress.staleMessage);
    }
    const executor = getBackgroundJobExecutor(repository);
    try {
      const result = await executor.runEmailSyncJob(context, { accountId: body.accountId, limit: body.limit });
      return ok(result, { status: result.status === "queued" ? 202 : 200 });
    } catch (syncError) {
      return ok(await getFailedEmailSyncResultOrThrow(context, repository, body.accountId, syncError), { status: 202 });
    }
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/email/sync", postApiMetricsHandler);
