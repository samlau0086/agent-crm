import { MAX_EMAIL_ATTACHMENT_BYTES } from "@/lib/email/attachments";

export function buildEmailAttachmentResponse(fileName: string, contentType: string | undefined, contentBase64: string): Response {
  const bytes = Buffer.from(normalizeBase64(contentBase64), "base64");
  if (bytes.length > MAX_EMAIL_ATTACHMENT_BYTES) {
    throw new Error(`Email attachment exceeds ${MAX_EMAIL_ATTACHMENT_BYTES} bytes`);
  }

  return new Response(bytes, {
    headers: {
      "content-type": sanitizeContentType(contentType),
      "content-length": String(bytes.length),
      "content-disposition": contentDisposition(fileName),
      "cache-control": "private, max-age=60"
    }
  });
}

function normalizeBase64(value: string): string {
  return value.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
}

function sanitizeContentType(value: string | undefined): string {
  const trimmed = value?.trim() || "";
  if (!trimmed || /[\r\n]/.test(trimmed)) {
    return "application/octet-stream";
  }
  return /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;\s*[A-Za-z0-9!#$&^_.+-]+=(?:"[^"\r\n]*"|[A-Za-z0-9!#$&^_.+-]+))*$/.test(trimmed)
    ? trimmed
    : "application/octet-stream";
}

function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[\r\n"]/g, " ").trim() || "attachment";
  return `attachment; filename="${fallback.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(fallback)}`;
}
