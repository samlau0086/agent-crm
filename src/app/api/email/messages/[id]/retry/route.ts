import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";
import { getFailedEmailSendResultOrThrow } from "@/lib/email/send-failure";
import { getBackgroundJobExecutor } from "@/lib/jobs/executor";


export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    const repository = getCrmRepository();
    const message = await repository.getEmailMessage(context, params.id);
    if (message.direction !== "outbound") {
      throw new Error("Only outbound email messages can be retried");
    }
    if (message.status !== "failed") {
      throw new Error("Only failed email messages can be retried");
    }

    const queued = await repository.updateEmailMessageStatus(context, message.id, "queued");
    const executor = getBackgroundJobExecutor(repository);
    try {
      return ok(await executor.runEmailSendJob(context, { messageId: queued.id }));
    } catch (sendError) {
      return ok(await getFailedEmailSendResultOrThrow(context, repository, queued.id, sendError), { status: 202 });
    }
  } catch (error) {
    return handleApiError(error, request);
  }
}
