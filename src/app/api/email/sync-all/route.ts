import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseOptionalJson, withApiMetrics } from "@/lib/api";
import { emailSyncAllSchema } from "@/lib/crm/api-schemas";
import { scheduleEmailSyncForActiveAccounts } from "@/lib/email/sync-scheduler";


export const dynamic = "force-dynamic";
async function postApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseOptionalJson(request, emailSyncAllSchema, {});
    return ok(await scheduleEmailSyncForActiveAccounts(context, { limit: body.limit }));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/email/sync-all", postApiMetricsHandler);
