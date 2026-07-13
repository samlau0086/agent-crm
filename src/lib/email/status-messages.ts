import type { EmailMessage } from "@/lib/crm/types";

export function formatEmailSendResultMessage(message: Pick<EmailMessage, "status" | "subject" | "failureReason" | "scheduledSendAt" | "imapSyncStatus" | "imapSyncError">): string {
  if (message.status === "queued" && message.scheduledSendAt) {
    return `邮件已加入待发送 ${message.subject}，计划发送时间 ${new Date(message.scheduledSendAt).toLocaleString()}`;
  }
  if (message.status === "queued") {
    return `邮件已加入发送队列 ${message.subject}`;
  }
  if (message.status === "sending") {
    return `邮件正在发送 ${message.subject}`;
  }
  if (message.status === "failed") {
    return `邮件发送失败 ${message.subject}${message.failureReason ? `：${message.failureReason}` : ""}`;
  }
  if (message.imapSyncStatus === "failed") {
    return `已发送邮件 ${message.subject}，但同步到远程“已发送”失败${message.imapSyncError ? `：${message.imapSyncError}` : ""}`;
  }
  return `已发送邮件 ${message.subject}`;
}
