import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { emailSyncSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";
import { getFailedEmailSyncResultOrThrow } from "@/lib/email/sync-failure";
import { getBackgroundJobExecutor } from "@/lib/jobs/executor";


export const dynamic = "force-dynamic";
async function postApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, emailSyncSchema);
    const repository = getCrmRepository();
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
