import type { EmailMessage, RequestContext } from "@/lib/crm/types";

export interface EmailSendFailureLookup {
  getEmailMessage(context: RequestContext, messageId: string): EmailMessage | Promise<EmailMessage>;
}

export async function getFailedEmailSendResultOrThrow(
  context: RequestContext,
  repository: EmailSendFailureLookup,
  messageId: string,
  error: unknown
): Promise<EmailMessage> {
  try {
    const message = await repository.getEmailMessage(context, messageId);
    if (message.status === "failed") {
      return message;
    }
  } catch {
    // Preserve the original send failure if the follow-up lookup also fails.
  }
  throw error;
}
