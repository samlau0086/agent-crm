import { randomUUID } from "node:crypto";
import type { EmailAccount, EmailAttachment, EmailMessage, RequestContext } from "@/lib/crm/types";
import type { PrismaCrmRepository } from "@/lib/crm/repository";
import { requirePermission } from "@/lib/auth/rbac";
import { assertEmailDeliveryModeAllowed, getEmailDeliveryMode } from "@/lib/email/delivery-mode";
import { fetchRecentMailboxEmails, sendSmtpEmail, testMailConnection, type MailConnectionTestResult, type MailSendResult } from "@/lib/email/smtp-imap";
import { assertOAuthConfig, isOAuthProvider } from "@/lib/email/oauth";
import { fetchRecentOAuthEmails, sendOAuthEmail, testOAuthConnection, type OAuthMailApiOptions } from "@/lib/email/oauth-api";
import { assertOutboundEmailRecipientPolicy } from "@/lib/email/outbound-policy";
import { getEmailProviderCapability } from "@/lib/email/providers";

export interface EmailSendInput {
  accountId: string;
  threadId?: string;
  recordId?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  attachments?: EmailAttachment[];
  aiAssisted?: boolean;
  aiPurpose?: EmailMessage["aiPurpose"];
  aiSourceMessageId?: string;
  aiSources?: EmailMessage["aiSources"];
  aiGeneratedAt?: string;
  clientRequestId?: string;
}

export interface EmailSyncResult {
  account: EmailAccount;
  importedCount: number;
  scannedCount: number;
  skippedDuplicateCount: number;
  pageCount?: number;
  hasMore?: boolean;
  status: string;
}

export interface EmailConnectionTestSummary {
  account: EmailAccount;
  result: MailConnectionTestResult;
}

export interface EmailProviderAdapter {
  send(context: RequestContext, input: EmailSendInput): Promise<EmailMessage>;
  sendQueued(context: RequestContext, messageId: string): Promise<EmailMessage>;
  sync(context: RequestContext, accountId: string, limit?: number): Promise<EmailSyncResult>;
  testConnection(context: RequestContext, accountId: string): Promise<EmailConnectionTestSummary>;
}

export interface EmailProviderAdapterOptions {
  oauth?: OAuthMailApiOptions;
}

export function createEmailProviderAdapter(repository: PrismaCrmRepository, options: EmailProviderAdapterOptions = {}): EmailProviderAdapter {
  return new RepositoryEmailProviderAdapter(repository, options);
}

class RepositoryEmailProviderAdapter implements EmailProviderAdapter {
  private readonly repository: PrismaCrmRepository;
  private readonly options: EmailProviderAdapterOptions;

  constructor(repository: PrismaCrmRepository, options: EmailProviderAdapterOptions) {
    this.repository = repository;
    this.options = options;
  }

  async send(context: RequestContext, input: EmailSendInput): Promise<EmailMessage> {
    const account = await this.repository.getEmailAccount(context, input.accountId);
    if (!account.sendEnabled || account.status !== "active") {
      throw new Error("Email account is not enabled for sending");
    }
    assertProviderSupports(account, "send");
    const deliverableInput = ensureEmailSendMessageId(input);
    assertOutboundEmailRecipientPolicy(deliverableInput);
    const delivery = await this.deliver(context, account, deliverableInput);
    return this.repository.sendEmailMessage(context, { ...deliverableInput, externalMessageId: delivery.externalMessageId });
  }

  async sendQueued(context: RequestContext, messageId: string): Promise<EmailMessage> {
    const message = await this.repository.getEmailMessage(context, messageId);
    if (message.direction !== "outbound") {
      throw new Error("Only outbound email messages can be sent");
    }
    if (message.status !== "queued" && message.status !== "failed" && message.status !== "sending") {
      return message;
    }
    const claim = await this.claimMessageForSending(context, message);
    if (!claim.claimed) {
      return claim.message;
    }
    const claimedMessage = claim.message;
    const account = await this.repository.getEmailAccount(context, claimedMessage.accountId);
    try {
      if (!account.sendEnabled || account.status !== "active") {
        throw new Error("Email account is not enabled for sending");
      }
      assertProviderSupports(account, "send");
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Email account is not enabled for sending";
      const failed = await this.repository.updateEmailMessageStatus(context, claimedMessage.id, "failed", { failureReason: messageText });
      throw Object.assign(new Error(messageText), { emailMessage: failed });
    }
    const input: EmailSendInput = {
      accountId: claimedMessage.accountId,
      threadId: claimedMessage.threadId,
      messageId: claimedMessage.id,
      ...(await this.buildThreadingHeaders(context, claimedMessage)),
      to: claimedMessage.to,
      cc: claimedMessage.cc,
      bcc: claimedMessage.bcc,
      subject: claimedMessage.subject,
      bodyText: claimedMessage.bodyText,
      bodyHtml: claimedMessage.bodyHtml,
      attachments: claimedMessage.attachments,
      aiAssisted: claimedMessage.aiAssisted,
      aiPurpose: claimedMessage.aiPurpose,
      aiSourceMessageId: claimedMessage.aiSourceMessageId,
      aiSources: claimedMessage.aiSources,
      aiGeneratedAt: claimedMessage.aiGeneratedAt,
      clientRequestId: claimedMessage.clientRequestId
    };
    try {
      assertOutboundEmailRecipientPolicy(input);
    } catch (error) {
      await this.repository.updateEmailMessageStatus(context, message.id, "failed", { failureReason: error instanceof Error ? error.message : "Email recipient policy failed" });
      throw error;
    }
    try {
      const delivery = await this.deliver(context, account, input);
      return this.repository.updateEmailMessageStatus(context, message.id, "sent", { externalMessageId: delivery.externalMessageId });
    } catch (error) {
      await this.repository.updateEmailMessageStatus(context, message.id, "failed", { failureReason: error instanceof Error ? error.message : "Email delivery failed" });
      throw error;
    }
  }

  private async claimMessageForSending(context: RequestContext, message: EmailMessage): Promise<{ message: EmailMessage; claimed: boolean }> {
    const repository = this.repository as PrismaCrmRepository & {
      claimEmailMessageForSending?: (context: RequestContext, messageId: string) => Promise<{ message: EmailMessage; claimed: boolean }>;
    };
    return repository.claimEmailMessageForSending ? repository.claimEmailMessageForSending(context, message.id) : { message: { ...message, status: "sending" }, claimed: true };
  }

  async sync(context: RequestContext, accountId: string, limit?: number): Promise<EmailSyncResult> {
    requirePermission(context, "crm.admin");
    const account = await this.repository.getEmailAccount(context, accountId);
    if (!account.syncEnabled || account.status !== "active") {
      throw new Error("Email account is not enabled for sync");
    }
    assertProviderSupports(account, "sync");
    const syncLimit = normalizeEmailSyncLimit(limit ?? this.options.oauth?.limit);
    if (isOAuthProvider(account.provider)) {
      const config = await this.getOAuthProviderConfig(context, account);
      try {
        const result = await fetchRecentOAuthEmails(account.provider, config, { ...this.options.oauth, limit: syncLimit });
        await this.repository.updateEmailAccountConnectionConfig(context, accountId, result.config);
        const importResult = await this.importInboundMessages(context, account, result.messages);
        const synced = await this.repository.syncEmailAccount(context, accountId);
        await this.repository.markEmailAccountConnectionError(context, accountId, null);
        return {
          ...synced,
          ...importResult,
          pageCount: result.pageCount,
          hasMore: result.hasMore,
          status: "synced"
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : `${account.provider} sync failed`;
        await this.repository.markEmailAccountConnectionError(context, accountId, message);
        throw new Error(message);
      }
    }
    const config = await this.repository.getEmailAccountConnectionConfig(context, accountId);
    if (!config) {
      const message = "Email account connection is not configured";
      await this.repository.markEmailAccountConnectionError(context, accountId, message);
      throw new Error(message);
    }

    try {
      const inbound = await fetchRecentMailboxEmails(config, syncLimit);
      const importResult = await this.importInboundMessages(context, account, inbound);
      const result = await this.repository.syncEmailAccount(context, accountId);
      await this.repository.markEmailAccountConnectionError(context, accountId, null);
      return { ...result, ...importResult, hasMore: inbound.length >= syncLimit, status: "synced" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mailbox sync failed";
      await this.repository.markEmailAccountConnectionError(context, accountId, message);
      throw new Error(message);
    }
  }

  async testConnection(context: RequestContext, accountId: string): Promise<EmailConnectionTestSummary> {
    requirePermission(context, "crm.admin");
    const account = await this.repository.getEmailAccount(context, accountId);
    const capability = getEmailProviderCapability(account.provider);
    if (!capability.supportsSend && !capability.supportsSync) {
      throw new Error(`Email provider ${capability.label} does not support connection tests without a custom adapter`);
    }
    const config = await this.repository.getEmailAccountConnectionConfig(context, accountId);
    if (!config) {
      throw new Error("Email account connection is not configured");
    }
    if (isOAuthProvider(account.provider)) {
      try {
        const result = await testOAuthConnection(account.provider, config, this.options.oauth);
        await this.repository.updateEmailAccountConnectionConfig(context, accountId, result.config);
        const updated = await this.repository.markEmailAccountConnectionError(context, accountId, null);
        return { account: updated, result: { oauth: "ok", smtp: "skipped", imap: "skipped", pop3: "skipped", oauthAccountEmail: result.accountEmail } };
      } catch (error) {
        const message = error instanceof Error ? error.message : "OAuth connection test failed";
        const updated = await this.repository.markEmailAccountConnectionError(context, accountId, message);
        throw Object.assign(new Error(message), { account: updated });
      }
    }
    try {
      const result = await testMailConnection(config, {
        smtp: account.sendEnabled,
        sync: account.syncEnabled
      });
      const updated = await this.repository.markEmailAccountConnectionError(context, accountId, null);
      return { account: updated, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email connection test failed";
      const updated = await this.repository.markEmailAccountConnectionError(context, accountId, message);
      throw Object.assign(new Error(message), { account: updated });
    }
  }

  private async getOAuthProviderConfig(context: RequestContext, account: EmailAccount) {
    const config = await this.repository.getEmailAccountConnectionConfig(context, account.id);
    if (!config) {
      throw new Error("Email account connection is not configured");
    }
    try {
      assertOAuthConfig(account.provider, config);
      await this.repository.markEmailAccountConnectionError(context, account.id, null);
      return config;
    } catch (error) {
      const message = error instanceof Error ? error.message : "OAuth connection is invalid";
      await this.repository.markEmailAccountConnectionError(context, account.id, message);
      throw new Error(message);
    }
  }

  private async deliver(context: RequestContext, account: EmailAccount, input: EmailSendInput): Promise<MailSendResult> {
    if (getEmailDeliveryMode() === "dry-run") {
      assertEmailDeliveryModeAllowed();
      return { externalMessageId: `dry-run-${input.messageId ?? Date.now()}` };
    }
    if (account.provider === "smtp_imap") {
      const config = await this.repository.getEmailAccountConnectionConfig(context, input.accountId);
      if (!config) {
        throw new Error("Email account connection is not configured");
      }
      try {
        const result = await sendSmtpEmail(config, input, account.emailAddress);
        await this.repository.markEmailAccountConnectionError(context, input.accountId, null);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "SMTP send failed";
        await this.repository.markEmailAccountConnectionError(context, input.accountId, message);
        throw new Error(message);
      }
    }
    if (isOAuthProvider(account.provider)) {
      const config = await this.getOAuthProviderConfig(context, account);
      try {
        const result = await sendOAuthEmail(account.provider, config, input, account.emailAddress, this.options.oauth);
        await this.repository.updateEmailAccountConnectionConfig(context, input.accountId, result.config);
        await this.repository.markEmailAccountConnectionError(context, input.accountId, null);
        return { externalMessageId: result.externalMessageId };
      } catch (error) {
        const message = error instanceof Error ? error.message : `${account.provider} send failed`;
        await this.repository.markEmailAccountConnectionError(context, input.accountId, message);
        throw new Error(message);
      }
    }
    return {};
  }

  private async buildThreadingHeaders(context: RequestContext, message: EmailMessage): Promise<Pick<EmailSendInput, "inReplyTo" | "references">> {
    const threadMessages = await this.repository.listEmailMessages(context, message.threadId);
    const referenceIds = threadMessages
      .filter((candidate) => candidate.id !== message.id)
      .map((candidate) => candidate.externalMessageId)
      .filter((value): value is string => Boolean(value))
      .map(formatMessageIdHeader)
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(-10);
    return {
      inReplyTo: referenceIds.at(-1),
      references: referenceIds.length ? referenceIds : undefined
    };
  }

  private async importInboundMessages(context: RequestContext, account: EmailAccount, messages: Awaited<ReturnType<typeof fetchRecentOAuthEmails>>["messages"]): Promise<Pick<EmailSyncResult, "importedCount" | "scannedCount" | "skippedDuplicateCount">> {
    let importedCount = 0;
    let skippedDuplicateCount = 0;
    for (const message of messages) {
      try {
        if (message.externalMessageId && (await this.repository.findEmailMessageByExternalId(context, account.id, message.externalMessageId))) {
          skippedDuplicateCount += 1;
          continue;
        }
        await this.repository.recordEmailMessage(context, {
          accountId: account.id,
          direction: "inbound",
          status: "received",
          from: message.from,
          to: message.to.length ? message.to : [account.emailAddress],
          cc: message.cc,
          subject: message.subject,
          bodyText: message.bodyText || "(empty)",
          bodyHtml: message.bodyHtml,
          attachments: message.attachments,
          externalMessageId: message.externalMessageId,
          receivedAt: message.receivedAt
        });
        importedCount += 1;
      } catch (error) {
        if (!isDuplicateMessageError(error)) {
          throw error;
        }
        skippedDuplicateCount += 1;
      }
    }
    return { importedCount, scannedCount: messages.length, skippedDuplicateCount };
  }
}

function normalizeEmailSyncLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(100, Math.floor(limit ?? 10)));
}

function ensureEmailSendMessageId(input: EmailSendInput): EmailSendInput {
  return input.messageId?.trim() ? input : { ...input, messageId: `direct-${randomUUID()}` };
}

function isDuplicateMessageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Unique constraint") || message.includes("duplicate key");
}

function formatMessageIdHeader(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed : `<${trimmed}>`;
}

function assertProviderSupports(account: EmailAccount, action: "send" | "sync"): void {
  const capability = getEmailProviderCapability(account.provider);
  const supported = action === "send" ? capability.supportsSend : capability.supportsSync;
  if (!supported) {
    throw new Error(`Email provider ${capability.label} does not support ${action} without a custom adapter`);
  }
}
