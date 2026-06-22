import type { EmailAttachment } from "@/lib/crm/types";

export const MAX_EMAIL_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_EMAIL_ATTACHMENT_BASE64_CHARS = 7 * 1024 * 1024;
const INVALID_ATTACHMENT_BASE64_MESSAGE = "Attachment contentBase64 must be valid base64 or base64url text";

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

export function normalizeEmailAttachmentBase64(value: string): string {
  const compact = value.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!compact) {
    return "";
  }
  if (/[^A-Za-z0-9+/=]/.test(compact)) {
    throw new Error(INVALID_ATTACHMENT_BASE64_MESSAGE);
  }

  const paddingMatch = compact.match(/=+$/);
  const paddingLength = paddingMatch?.[0].length ?? 0;
  const body = paddingLength ? compact.slice(0, -paddingLength) : compact;
  if (body.includes("=") || paddingLength > 2 || (paddingLength > 0 && compact.length % 4 !== 0) || (!body && paddingLength > 0) || body.length % 4 === 1) {
    throw new Error(INVALID_ATTACHMENT_BASE64_MESSAGE);
  }

  return `${body}${"=".repeat((4 - (body.length % 4)) % 4)}`;
}

export function isValidEmailAttachmentBase64(value: string): boolean {
  try {
    normalizeEmailAttachmentBase64(value);
    return true;
  } catch {
    return false;
  }
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
