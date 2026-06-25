import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { emailSendSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";
import { getFailedEmailSendResultOrThrow } from "@/lib/email/send-failure";
import { getEmailDeliveryMode } from "@/lib/email/delivery-mode";
import { getEmailProviderCapability } from "@/lib/email/providers";
import { getBackgroundJobExecutor } from "@/lib/jobs/executor";


export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, emailSendSchema);
    const repository = getCrmRepository();
    const account = await repository.getEmailAccount(context, body.accountId);
    const capability = getEmailProviderCapability(account.provider);
    if (getEmailDeliveryMode() !== "dry-run" && account.status === "active" && account.sendEnabled && capability.supportsSend && !account.connectionConfigured) {
      throw new Error("Email account connection is not configured");
    }
    const scheduledAt = body.scheduledSendAt ? new Date(body.scheduledSendAt) : undefined;
    const shouldDelaySend = Boolean(scheduledAt && scheduledAt.getTime() > Date.now());
    if (body.groupSendMode && body.to.length > 1) {
      const messages = [];
      for (const [index, recipient] of body.to.entries()) {
        messages.push(
          await repository.queueEmailMessage(context, {
            ...body,
            to: [recipient],
            clientRequestId: body.clientRequestId ? `${body.clientRequestId}:${index}` : undefined,
            groupSendMode: true
          })
        );
      }
      if (!shouldDelaySend) {
        const executor = getBackgroundJobExecutor(repository);
        const delivered = [];
        for (const message of messages) {
          try {
            delivered.push(await executor.runEmailSendJob(context, { messageId: message.id }));
          } catch (sendError) {
            delivered.push(await getFailedEmailSendResultOrThrow(context, repository, message.id, sendError));
          }
        }
        return ok({ messages: delivered }, { status: 201 });
      }
      return ok({ messages }, { status: 202 });
    }
    const queuedMessage = await repository.queueEmailMessage(context, body);
    if (shouldDelaySend) {
      return ok(queuedMessage, { status: 202 });
    }
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
