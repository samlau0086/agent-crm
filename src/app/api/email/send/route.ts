import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { emailSendSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";
import { getFailedEmailSendResultOrThrow } from "@/lib/email/send-failure";
import { getBackgroundJobExecutor } from "@/lib/jobs/executor";


export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, emailSendSchema);
    const repository = getCrmRepository();
    const queuedMessage = await repository.queueEmailMessage(context, body);
    const executor = getBackgroundJobExecutor(repository);
    try {
      return ok(await executor.runEmailSendJob(context, { messageId: queuedMessage.id }), { status: 201 });
    } catch (sendError) {
      return ok(await getFailedEmailSendResultOrThrow(context, repository, queuedMessage.id, sendError), { status: 202 });
    }
  } catch (error) {
    return handleApiError(error, request);
  }
}
