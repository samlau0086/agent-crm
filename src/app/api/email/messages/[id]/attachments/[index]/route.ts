import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";
import { buildEmailAttachmentResponse } from "@/lib/email/attachment-response";
import { downloadOAuthAttachment } from "@/lib/email/oauth-api";
import { isOAuthEmailProvider } from "@/lib/email/providers";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string; index: string };
}

async function getApiMetricsHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const repository = getCrmRepository();
    const message = await repository.getEmailMessage(context, params.id);
    const attachmentIndex = Number(params.index);
    if (!Number.isInteger(attachmentIndex) || attachmentIndex < 0) {
      throw new Error("Email attachment not found");
    }
    const attachment = message.attachments?.[attachmentIndex];
    if (!attachment) {
      throw new Error("Email attachment not found");
    }

    if (attachment.contentBase64) {
      return buildEmailAttachmentResponse(attachment.fileName, attachment.contentType, attachment.contentBase64);
    }

    const account = await repository.getEmailAccount(context, message.accountId);
    if (!isOAuthEmailProvider(account.provider)) {
      throw new Error("Email attachment content is not available from this provider");
    }
    const config = await repository.getEmailAccountConnectionConfig(context, account.id);
    if (!config) {
      throw new Error("Email account connection is not configured");
    }
    const downloaded = await downloadOAuthAttachment(account.provider, config, attachment);
    if (JSON.stringify(downloaded.config) !== JSON.stringify(config)) {
      await repository.updateEmailAccountConnectionConfig(context, account.id, downloaded.config);
    }
    return buildEmailAttachmentResponse(downloaded.fileName, downloaded.contentType, downloaded.contentBase64);
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/email/messages/[id]/attachments/[index]", getApiMetricsHandler);
