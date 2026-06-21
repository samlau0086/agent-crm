import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseOptionalJson } from "@/lib/api";
import { emailSyncAllSchema } from "@/lib/crm/api-schemas";
import { scheduleEmailSyncForActiveAccounts } from "@/lib/email/sync-scheduler";


export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseOptionalJson(request, emailSyncAllSchema, {});
    return ok(await scheduleEmailSyncForActiveAccounts(context, { limit: body.limit }));
  } catch (error) {
    return handleApiError(error, request);
  }
}
