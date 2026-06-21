import type { EmailMessage } from "@/lib/crm/types";

export function formatEmailSendResultMessage(message: Pick<EmailMessage, "status" | "subject" | "failureReason">): string {
  if (message.status === "queued") {
    return `邮件已加入发送队列 ${message.subject}`;
  }
  if (message.status === "sending") {
    return `邮件正在发送 ${message.subject}`;
  }
  if (message.status === "failed") {
    return `邮件发送失败 ${message.subject}${message.failureReason ? `：${message.failureReason}` : ""}`;
  }
  return `已发送邮件 ${message.subject}`;
}
