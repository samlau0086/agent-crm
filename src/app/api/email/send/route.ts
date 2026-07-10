import type { NextRequest } from "next/server";
import type { z } from "zod";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { emailSendSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";
import type { EmailAccount, EmailSignature } from "@/lib/crm/types";
import { getFailedEmailSendResultOrThrow } from "@/lib/email/send-failure";
import { getEmailDeliveryMode } from "@/lib/email/delivery-mode";
import { getEmailProviderCapability } from "@/lib/email/providers";
import { getBackgroundJobExecutor } from "@/lib/jobs/executor";

type EmailSendBody = z.infer<typeof emailSendSchema>;
type EmailQueueBody = Omit<EmailSendBody, "signatureId" | "signatureName">;

export const dynamic = "force-dynamic";
async function sendEmail(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, emailSendSchema);
    const repository = getCrmRepository();
    const account = await repository.getEmailAccount(context, body.accountId);
    const { signatureId, signatureName, ...messageBody } = body;
    const queuedBody = await applySelectedSignature(repository, context, account, messageBody as EmailQueueBody, { signatureId, signatureName });
    const capability = getEmailProviderCapability(account.provider);
    if (getEmailDeliveryMode() !== "dry-run" && account.status === "active" && account.sendEnabled && capability.supportsSend && !account.connectionConfigured) {
      throw new Error("Email account connection is not configured");
    }
    const scheduledAt = queuedBody.scheduledSendAt ? new Date(queuedBody.scheduledSendAt) : undefined;
    const shouldDelaySend = Boolean(scheduledAt && scheduledAt.getTime() > Date.now());
    if (queuedBody.groupSendMode && queuedBody.to.length > 1) {
      const messages = [];
      for (const [index, recipient] of queuedBody.to.entries()) {
        messages.push(
          await repository.queueEmailMessage(context, {
            ...queuedBody,
            to: [recipient],
            clientRequestId: queuedBody.clientRequestId ? `${queuedBody.clientRequestId}:${index}` : undefined,
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
    const queuedMessage = await repository.queueEmailMessage(context, queuedBody);
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

export const POST = withApiMetrics("POST /api/email/send", sendEmail);

async function applySelectedSignature(
  repository: ReturnType<typeof getCrmRepository>,
  context: Awaited<ReturnType<typeof getRequestContext>>,
  account: EmailAccount,
  message: EmailQueueBody,
  selection: Pick<EmailSendBody, "signatureId" | "signatureName">
): Promise<EmailQueueBody> {
  const signature = await resolveSelectedSignature(repository, context, account, selection);
  if (!signature) {
    return message;
  }
  return {
    ...message,
    bodyText: appendTextSignature(message.bodyText, signature.bodyText),
    bodyHtml: appendHtmlSignature(message.bodyHtml, signature.bodyHtml ?? signature.bodyText)
  };
}

async function resolveSelectedSignature(
  repository: ReturnType<typeof getCrmRepository>,
  context: Awaited<ReturnType<typeof getRequestContext>>,
  account: EmailAccount,
  selection: Pick<EmailSendBody, "signatureId" | "signatureName">
): Promise<EmailSignature | undefined> {
  const signatures = await repository.listEmailSignatures(context);
  const activeScoped = signatures.filter((signature) => signature.active && (!signature.accountId || signature.accountId === account.id));
  if (selection.signatureId || selection.signatureName) {
    const signature = selection.signatureId
      ? activeScoped.find((candidate) => candidate.id === selection.signatureId)
      : activeScoped.find((candidate) => candidate.name.toLowerCase() === selection.signatureName!.toLowerCase());
    if (!signature) {
      throw new Error(selection.signatureId ? `Email signature not found: ${selection.signatureId}` : `Email signature not found: ${selection.signatureName}`);
    }
    return signature;
  }
  return activeScoped.find((candidate) => candidate.id === account.defaultSignatureId) ?? activeScoped.find((candidate) => !candidate.accountId && candidate.isDefault);
}

function appendTextSignature(bodyText: string, signatureText: string): string {
  const normalizedSignature = signatureText.trim();
  if (!normalizedSignature || bodyText.includes(normalizedSignature)) {
    return bodyText;
  }
  return `${bodyText.trimEnd()}\n\n${normalizedSignature}`;
}

function appendHtmlSignature(bodyHtml: string | undefined, signatureHtml: string | undefined): string | undefined {
  const normalizedSignature = signatureHtml?.trim();
  if (!normalizedSignature) {
    return bodyHtml;
  }
  if (!bodyHtml) {
    return normalizedSignature.includes("<") ? normalizedSignature : normalizedSignature.replace(/\n/g, "<br>");
  }
  if (bodyHtml.includes(normalizedSignature)) {
    return bodyHtml;
  }
  return `${bodyHtml.trimEnd()}<br><br>${normalizedSignature}`;
}
