import type { EmailAttachment } from "@/lib/crm/types";

export const MAX_EMAIL_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_EMAIL_ATTACHMENT_BASE64_CHARS = 7 * 1024 * 1024;

export function buildEmailAttachmentHref(
  messageId: string,
  attachmentIndex: number,
  attachment: Pick<EmailAttachment, "contentBase64" | "providerMessageId" | "providerAttachmentId" | "externalUrl">
): string | undefined {
  const externalUrl = safeExternalAttachmentUrl(attachment.externalUrl);
  if (externalUrl) {
    return externalUrl;
  }
  if (!attachment.contentBase64 && !(attachment.providerMessageId && attachment.providerAttachmentId)) {
    return undefined;
  }
  return `/api/email/messages/${encodeURIComponent(messageId)}/attachments/${attachmentIndex}`;
}

function safeExternalAttachmentUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
