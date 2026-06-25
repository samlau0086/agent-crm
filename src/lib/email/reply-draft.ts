import type { EmailAttachment, EmailMessage } from "@/lib/crm/types";

export type EmailComposeReplyDraft = {
  accountId: string;
  threadId?: string;
  recordId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  signatureId?: string;
  replyOriginalBodyText?: string;
  replyOriginalBodyHtml?: string;
  replyOriginalFrom?: string;
  replyOriginalSentAt?: string;
  attachments?: EmailAttachment[];
  aiAssisted?: boolean;
  aiPurpose?: EmailMessage["aiPurpose"];
  aiSourceMessageId?: string;
  aiSources?: EmailMessage["aiSources"];
  aiGeneratedAt?: string;
};

export type EmailReplyDraftInput = {
  message: Pick<EmailMessage, "accountId" | "threadId" | "direction" | "from" | "to" | "cc" | "subject" | "bodyText"> &
    Partial<Pick<EmailMessage, "bodyHtml" | "sentAt" | "receivedAt" | "createdAt">>;
  accountEmail?: string;
  recordId?: string;
};

export function buildEmailReplyDraft(input: EmailReplyDraftInput): EmailComposeReplyDraft {
  const accountAddress = input.accountEmail?.trim().toLowerCase();
  const recipients = uniqueEmailStrings(
    input.message.direction === "inbound"
      ? [input.message.from, ...(input.message.cc ?? [])]
      : [...input.message.to, ...(input.message.cc ?? [])]
  ).filter((email) => email !== accountAddress);

  return {
    accountId: input.message.accountId,
    threadId: input.message.threadId,
    recordId: input.recordId ?? "",
    to: recipients.join(", "),
    cc: "",
    bcc: "",
    subject: replySubject(input.message.subject),
    bodyText: "",
    bodyHtml: "",
    signatureId: "",
    replyOriginalBodyText: input.message.bodyText,
    replyOriginalBodyHtml: input.message.bodyHtml,
    replyOriginalFrom: input.message.from,
    replyOriginalSentAt: input.message.sentAt ?? input.message.receivedAt ?? input.message.createdAt,
    attachments: []
  };
}

function uniqueEmailStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean)));
}

function replySubject(subject: string): string {
  const normalized = subject.trim();
  return /^re\s*:/i.test(normalized) ? normalized : `Re: ${normalized}`;
}
