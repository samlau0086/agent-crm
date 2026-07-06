import { randomUUID } from "node:crypto";
import type { EmailAccount, EmailAttachment, EmailConnectionConfig, EmailMessage, RequestContext } from "@/lib/crm/types";
import type { PrismaCrmRepository } from "@/lib/crm/repository";
import { requirePermission } from "@/lib/auth/rbac";
import { assertEmailDeliveryModeAllowed, getEmailDeliveryMode } from "@/lib/email/delivery-mode";
import { fetchRecentMailboxEmails, sendSmtpEmail, testMailConnection, type MailConnectionTestResult, type MailSendResult } from "@/lib/email/smtp-imap";
import { getDefaultOutboundService, getInboundConnectionConfig, getOutboundSmtpConnectionConfig } from "@/lib/email/connection-config";
import { sendResendEmail } from "@/lib/email/resend";
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
  skipAutoLink?: boolean;
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

export interface EmailConnectionTestOptions {
  scope?: "all" | "inbound" | "outbound";
  outboundServiceId?: string;
}

export interface EmailProviderAdapter {
  send(context: RequestContext, input: EmailSendInput): Promise<EmailMessage>;
  sendQueued(context: RequestContext, messageId: string): Promise<EmailMessage>;
  sync(context: RequestContext, accountId: string, limit?: number): Promise<EmailSyncResult>;
  testConnection(context: RequestContext, accountId: string, options?: EmailConnectionTestOptions): Promise<EmailConnectionTestSummary>;
}

export interface EmailProviderAdapterOptions {
  oauth?: OAuthMailApiOptions;
}

export function createEmailProviderAdapter(repository: PrismaCrmRepository, options: EmailProviderAdapterOptions = {}): EmailProviderAdapter {
  return new RepositoryEmailProviderAdapter(repository, options);
}

type EmailSyncCounters = Pick<EmailSyncResult, "importedCount" | "scannedCount" | "skippedDuplicateCount">;

type RepositoryEmailSyncStatusMethods = {
  markEmailAccountSyncRunning?: (context: RequestContext, accountId: string) => Promise<EmailAccount> | EmailAccount;
  markEmailAccountSyncCompleted?: (context: RequestContext, accountId: string, result: EmailSyncCounters) => Promise<EmailAccount> | EmailAccount;
  markEmailAccountSyncFailed?: (context: RequestContext, accountId: string, errorMessage: string) => Promise<EmailAccount> | EmailAccount;
  syncEmailAccount?: (context: RequestContext, accountId: string) => Promise<{ account: EmailAccount; importedCount: number; status: string }> | { account: EmailAccount; importedCount: number; status: string };
};

class RepositoryEmailProviderAdapter implements EmailProviderAdapter {
  private readonly repository: PrismaCrmRepository;
  private readonly options: EmailProviderAdapterOptions;

  constructor(repository: PrismaCrmRepository, options: EmailProviderAdapterOptions) {
    this.repository = repository;
    this.options = options;
  }

  async send(context: RequestContext, input: EmailSendInput): Promise<EmailMessage> {
    const account = await this.repository.getEmailAccount(context, input.accountId);
    if (!account.sendEnabled || account.status === "disabled") {
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
      if (!account.sendEnabled || account.status === "disabled") {
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
    if (!account.syncEnabled || (account.status !== "active" && account.status !== "error")) {
      throw new Error("Email account is not enabled for sync");
    }
    assertProviderSupports(account, "sync");
    const syncLimit = normalizeEmailSyncLimit(limit ?? this.options.oauth?.limit);
    await this.markSyncRunning(context, accountId);
    if (isOAuthProvider(account.provider)) {
      const config = await this.getOAuthProviderConfig(context, account);
      try {
        const result = await fetchRecentOAuthEmails(account.provider, config, { ...this.options.oauth, limit: syncLimit });
        await this.repository.updateEmailAccountConnectionConfig(context, accountId, result.config);
        const importResult = await this.importInboundMessages(context, account, result.messages);
        await this.repository.markEmailAccountConnectionError(context, accountId, null);
        const syncedAccount = await this.markSyncCompleted(context, accountId, importResult);
        return {
          account: syncedAccount,
          ...importResult,
          pageCount: result.pageCount,
          hasMore: result.hasMore,
          status: "synced"
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : `${account.provider} sync failed`;
        await this.repository.markEmailAccountConnectionError(context, accountId, message);
        await this.markSyncFailed(context, accountId, message);
        throw new Error(message);
      }
    }
    const config = await this.repository.getEmailAccountConnectionConfig(context, accountId);
    if (!config) {
      const message = "Email account connection is not configured";
      await this.repository.markEmailAccountConnectionError(context, accountId, message);
      await this.markSyncFailed(context, accountId, message);
      throw new Error(message);
    }

    try {
      const inbound = await fetchRecentMailboxEmails(config, syncLimit);
      const importResult = await this.importInboundMessages(context, account, inbound);
      await this.repository.markEmailAccountConnectionError(context, accountId, null);
      const syncedAccount = await this.markSyncCompleted(context, accountId, importResult);
      return { account: syncedAccount, ...importResult, hasMore: inbound.length >= syncLimit, status: "synced" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mailbox sync failed";
      const statusMessage = withInboundEndpointContext(message, config);
      await this.repository.markEmailAccountConnectionError(context, accountId, statusMessage);
      await this.markSyncFailed(context, accountId, statusMessage);
      throw new Error(message);
    }
  }

  private async markSyncRunning(context: RequestContext, accountId: string): Promise<void> {
    const repository = this.repository as PrismaCrmRepository & RepositoryEmailSyncStatusMethods;
    if (repository.markEmailAccountSyncRunning) {
      await repository.markEmailAccountSyncRunning(context, accountId);
    }
  }

  private async markSyncCompleted(context: RequestContext, accountId: string, result: EmailSyncCounters): Promise<EmailAccount> {
    const repository = this.repository as PrismaCrmRepository & RepositoryEmailSyncStatusMethods;
    if (repository.markEmailAccountSyncCompleted) {
      return repository.markEmailAccountSyncCompleted(context, accountId, result);
    }
    if (repository.syncEmailAccount) {
      const synced = await repository.syncEmailAccount(context, accountId);
      return synced.account;
    }
    return this.repository.getEmailAccount(context, accountId);
  }

  private async markSyncFailed(context: RequestContext, accountId: string, errorMessage: string): Promise<void> {
    const repository = this.repository as PrismaCrmRepository & RepositoryEmailSyncStatusMethods;
    if (repository.markEmailAccountSyncFailed) {
      await repository.markEmailAccountSyncFailed(context, accountId, errorMessage);
    }
  }

  async testConnection(context: RequestContext, accountId: string, options: EmailConnectionTestOptions = {}): Promise<EmailConnectionTestSummary> {
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
        smtp: options.scope === "inbound" ? false : account.sendEnabled,
        sync: options.scope === "outbound" ? false : account.syncEnabled,
        outboundServiceId: options.outboundServiceId
      });
      const updated = await this.repository.markEmailAccountConnectionError(context, accountId, null);
      return { account: updated, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email connection test failed";
      const statusMessage = options.scope === "outbound" ? message : withInboundEndpointContext(message, config);
      const updated = await this.repository.markEmailAccountConnectionError(context, accountId, statusMessage);
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
      const outboundService = getDefaultOutboundService(config);
      if (outboundService?.type === "resend") {
        try {
          const result = await sendResendEmail(outboundService, input, account.emailAddress);
          await this.repository.markEmailAccountConnectionError(context, input.accountId, null);
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Resend send failed";
          await this.repository.markEmailAccountConnectionError(context, input.accountId, message);
          throw new Error(message);
        }
      }
      try {
        const result = await sendSmtpEmail(getOutboundSmtpConnectionConfig(config, outboundService), input, outboundService?.fromEmail ?? account.emailAddress);
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
          receivedAt: message.receivedAt,
          inboundMetadata: message.inboundMetadata
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

function withInboundEndpointContext(message: string, config: EmailConnectionConfig): string {
  const endpoint = describeInboundEndpoint(config);
  if (!endpoint || message.includes(endpoint)) {
    return message;
  }
  return `${message} [inbound ${endpoint}]`;
}

function describeInboundEndpoint(config: EmailConnectionConfig): string | undefined {
  const inbound = getInboundConnectionConfig(config);
  const protocol = inbound.syncProtocol === "pop3" ? "POP3" : "IMAP";
  const host = protocol === "POP3" ? inbound.pop3Host : inbound.imapHost;
  const port = protocol === "POP3" ? inbound.pop3Port : inbound.imapPort;
  const secure = protocol === "POP3" ? inbound.pop3Secure : inbound.imapSecure;
  if (!host && !port) {
    return `${protocol} host not configured`;
  }
  const hostText = host ?? "host not configured";
  const portText = port ? `:${port}` : "";
  const securityText = secure === false ? "plain" : "TLS";
  const mailboxText = protocol === "IMAP" && inbound.mailbox ? ` mailbox=${inbound.mailbox}` : "";
  return `${protocol} ${hostText}${portText} ${securityText}${mailboxText}`;
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
