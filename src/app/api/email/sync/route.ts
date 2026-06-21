import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { emailSyncSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";
import { getFailedEmailSyncResultOrThrow } from "@/lib/email/sync-failure";
import { getBackgroundJobExecutor } from "@/lib/jobs/executor";


export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, emailSyncSchema);
    const repository = getCrmRepository();
    try {
      return ok(await getBackgroundJobExecutor(repository).runEmailSyncJob(context, { accountId: body.accountId, limit: body.limit }));
    } catch (syncError) {
      return ok(await getFailedEmailSyncResultOrThrow(context, repository, body.accountId, syncError), { status: 202 });
    }
  } catch (error) {
    return handleApiError(error, request);
  }
}
