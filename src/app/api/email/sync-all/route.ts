import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseOptionalJson, withApiMetrics } from "@/lib/api";
import { emailSyncAllSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";
import { scheduleEmailSyncForActiveAccounts } from "@/lib/email/sync-scheduler";


export const dynamic = "force-dynamic";
async function postApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseOptionalJson(request, emailSyncAllSchema, {});
    const repository = getCrmRepository();
    const result = await scheduleEmailSyncForActiveAccounts(context, { repository, limit: body.limit, fullResync: body.fullResync });
    return ok(result, { status: result.accounts.some((account) => account.status === "queued") ? 202 : 200 });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/email/sync-all", postApiMetricsHandler);
