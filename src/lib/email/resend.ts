import type { EmailOutboundServiceConfig } from "@/lib/crm/types";
import type { EmailSendInput } from "@/lib/email/provider";
import type { MailSendResult } from "@/lib/email/smtp-imap";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";

export async function sendResendEmail(service: EmailOutboundServiceConfig, input: EmailSendInput, fallbackFrom: string): Promise<MailSendResult> {
  if (!service.resendApiKey) {
    throw new Error("Resend outbound service requires an API key");
  }
  const from = service.fromEmail || fallbackFrom;
  const response = await fetch(RESEND_EMAILS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${service.resendApiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: input.to,
      cc: input.cc?.length ? input.cc : undefined,
      bcc: input.bcc?.length ? input.bcc : undefined,
      subject: input.subject,
      text: input.bodyText,
      html: input.bodyHtml,
      attachments: input.attachments?.map((attachment) => ({
        filename: attachment.fileName,
        content: attachment.contentBase64,
        content_type: attachment.contentType
      }))
    })
  });
  const payload = await response.json().catch(() => undefined) as { id?: string; message?: string; error?: string } | undefined;
  if (!response.ok) {
    throw new Error(`Resend send failed: ${payload?.message ?? payload?.error ?? response.statusText}`);
  }
  return { externalMessageId: payload?.id };
}
