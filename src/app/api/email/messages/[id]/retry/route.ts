import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";
import { getFailedEmailSendResultOrThrow } from "@/lib/email/send-failure";
import { getBackgroundJobExecutor } from "@/lib/jobs/executor";


export const dynamic = "force-dynamic";
async function postApiMetricsHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    const repository = getCrmRepository();
    const message = await repository.getEmailMessage(context, params.id);
    if (message.direction !== "outbound") {
      throw new Error("Only outbound email messages can be retried");
    }
    if (message.status !== "failed" && message.status !== "sending") {
      throw new Error("Only failed or sending email messages can be retried");
    }

    const retryMessage =
      message.status === "failed" ? await repository.updateEmailMessageStatus(context, message.id, "queued") : message;
    const executor = getBackgroundJobExecutor(repository);
    try {
      return ok(await executor.runEmailSendJob(context, { messageId: retryMessage.id }));
    } catch (sendError) {
      return ok(await getFailedEmailSendResultOrThrow(context, repository, retryMessage.id, sendError), { status: 202 });
    }
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/email/messages/[id]/retry", postApiMetricsHandler);
