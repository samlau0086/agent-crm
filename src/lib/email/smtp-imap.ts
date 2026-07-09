import net from "node:net";
import tls from "node:tls";
import type { Readable } from "node:stream";
import { ImapFlow } from "imapflow";
import type { EmailAttachment, EmailConnectionConfig, EmailMailboxMapping, EmailOutboundServiceConfig } from "@/lib/crm/types";
import { MAX_EMAIL_ATTACHMENT_BYTES, normalizeEmailAttachmentBase64 } from "@/lib/email/attachments";
import { getDefaultOutboundService, getInboundConnectionConfig, getOutboundSmtpConnectionConfig } from "@/lib/email/connection-config";
import { repairEmailMojibake } from "@/lib/email/mojibake";
import type { EmailSendInput } from "@/lib/email/provider";
import { extractInboundMetadata } from "@/lib/email/tracking";

export interface InboundEmail {
  externalMessageId?: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  attachments?: EmailAttachment[];
  receivedAt?: string;
  inboundMetadata?: ReturnType<typeof extractInboundMetadata>;
}

export interface MailConnectionTestResult {
  smtp?: "ok" | "skipped";
  imap?: "ok" | "skipped";
  resend?: "ok" | "skipped";
  oauth?: "ok" | "skipped";
  oauthAccountEmail?: string;
}

export interface MailSendResult {
  externalMessageId?: string;
}

export interface MailboxFetchOptions {
  deadlineAt?: number;
  fullResync?: boolean;
  fullResyncBeforeUid?: string;
  imapUidValidity?: string;
  imapLastSeenUid?: string;
}

export interface MailboxFetchResult {
  messages: InboundEmail[];
  hasMore?: boolean;
  fullResyncBeforeUid?: string;
  imapUidValidity?: string;
  imapLastSeenUid?: string;
}

export interface ImapMailboxInfo {
  path: string;
  name: string;
  delimiter?: string;
  flags: string[];
  specialUse?: string;
}

export interface SmtpTransportOptions {
  port: number;
  secure: boolean;
  startTls: boolean;
}

const DEFAULT_MAIL_CONNECT_TIMEOUT_MS = 15000;
const DEFAULT_MAIL_RESPONSE_TIMEOUT_MS = 30000;
const DEFAULT_MAIL_FETCH_RESPONSE_TIMEOUT_MS = 60000;
const MAX_MAIL_TIMEOUT_MS = 300000;
const DEFAULT_MAIL_IMAP_FETCH_BYTES = 262144;
const MAX_MAIL_IMAP_FETCH_BYTES = 5000000;

export function resolveSmtpTransport(config: EmailConnectionConfig | EmailOutboundServiceConfig): SmtpTransportOptions {
  const startTls = config.smtpStartTls === true;
  const secure = !startTls && config.smtpSecure !== false;
  return {
    port: config.smtpPort ?? (startTls ? 587 : secure ? 465 : 25),
    secure,
    startTls
  };
}

export async function testMailConnection(config: EmailConnectionConfig, options: { smtp?: boolean; sync?: boolean; imap?: boolean; outboundServiceId?: string } = {}): Promise<MailConnectionTestResult> {
  const result: MailConnectionTestResult = {};
  if (options.smtp !== false) {
    const normalized = config.outboundServices?.length ? config : undefined;
    const outboundService =
      options.outboundServiceId && normalized?.outboundServices
        ? normalized.outboundServices.find((service) => service.id === options.outboundServiceId)
        : getDefaultOutboundService(config);
    if (options.outboundServiceId && !outboundService) {
      throw new Error("Outbound service not found");
    }
    if (outboundService?.type === "resend") {
      if (!outboundService.resendApiKey) {
        throw new Error("Resend outbound service requires an API key");
      }
      result.smtp = "skipped";
      result.resend = "ok";
    } else {
      const smtpConfig = getOutboundSmtpConnectionConfig(config, outboundService);
      assertSmtpConfig(smtpConfig);
      const smtp = await SmtpClient.connect(smtpConfig);
      try {
        await prepareSmtpSession(smtp, smtpConfig);
        if (smtpConfig.username && smtpConfig.password) {
          await smtp.command(`AUTH PLAIN ${Buffer.from(`\0${smtpConfig.username}\0${smtpConfig.password}`).toString("base64")}`, 235);
        }
        await smtp.command("QUIT", 221).catch(() => undefined);
        result.smtp = "ok";
        result.resend = "skipped";
      } finally {
        smtp.close();
      }
    }
  } else {
    result.smtp = "skipped";
    result.resend = "skipped";
  }

  const shouldTestSync = options.sync ?? options.imap ?? true;
  const inboundConfig = getInboundConnectionConfig(config);
  if (shouldTestSync) {
    assertImapConfig(inboundConfig);
    const imap = createImapFlowClient(inboundConfig);
    try {
      await imap.connect();
      await imap.mailboxOpen(inboundConfig.mailbox ?? "INBOX", { readOnly: true });
      await imap.logout().catch(() => undefined);
      result.imap = "ok";
    } finally {
      if (!result.imap) {
        imap.close();
      }
    }
  } else {
    result.imap = "skipped";
  }
  return result;
}

export async function sendSmtpEmail(config: EmailConnectionConfig, input: EmailSendInput, from: string): Promise<MailSendResult> {
  assertSmtpConfig(config);
  const client = await SmtpClient.connect(config);
  try {
    await prepareSmtpSession(client, config);
    if (config.username && config.password) {
      await client.command(`AUTH PLAIN ${Buffer.from(`\0${config.username}\0${config.password}`).toString("base64")}`, 235);
    }
    await client.command(`MAIL FROM:<${from}>`, 250);
    for (const recipient of [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])]) {
      await client.command(`RCPT TO:<${recipient}>`, [250, 251]);
    }
    await client.command("DATA", 354);
    await client.writeData(buildRfc822Message(input, from));
    await client.command("QUIT", 221).catch(() => undefined);
    return { externalMessageId: input.messageId ? formatOutboundMessageId(input.messageId) : undefined };
  } finally {
    client.close();
  }
}

export async function fetchRecentImapEmails(config: EmailConnectionConfig, limit = 10, options: MailboxFetchOptions = {}): Promise<InboundEmail[]> {
  return (await fetchRecentImapEmailBatch(config, limit, options)).messages;
}

export async function fetchRecentImapEmailBatch(config: EmailConnectionConfig, limit = 10, options: MailboxFetchOptions = {}): Promise<MailboxFetchResult> {
  assertImapConfig(config);
  const client = createImapFlowClient(config, options);
  try {
    await client.connect();
    const mailbox = await client.mailboxOpen(config.mailbox ?? "INBOX", { readOnly: true });
    const messageCount = mailbox.exists;
    const safeLimit = normalizeMailboxFetchLimit(limit);
    const uidValidity = mailbox.uidValidity?.toString();
    const fetchBytes = getMailImapFetchBytes();
    const uidSearch = await resolveImapFetchUids(client, messageCount, safeLimit, uidValidity, options);
    const messages: InboundEmail[] = [];
    let lastSeenUid = options.imapUidValidity === uidValidity ? normalizeImapUid(options.imapLastSeenUid) : undefined;
    let fullResyncBeforeUid: string | undefined;
    for (const uid of uidSearch.fetchUids) {
      assertMailSyncDeadline(options);
      const source = await downloadImapSource(client, uid, fetchBytes, options);
      const fetchedUid = uid;
      const parsed = source ? parseRawEmailMessage(source.toString("utf8")) : undefined;
      if (parsed) {
        messages.push(withInboundMailboxSource(withImapFallbackExternalMessageId(parsed, config.mailbox ?? "INBOX", fetchedUid), config.mailbox ?? "INBOX"));
      }
      lastSeenUid = maxImapUid(lastSeenUid, fetchedUid);
      if (options.fullResync) {
        fullResyncBeforeUid = minImapUid(fullResyncBeforeUid, fetchedUid);
      }
    }
    await client.logout().catch(() => undefined);
    return {
      messages,
      hasMore: uidSearch.hasMore,
      ...(fullResyncBeforeUid ? { fullResyncBeforeUid } : {}),
      ...(uidValidity ? { imapUidValidity: uidValidity } : {}),
      ...(lastSeenUid ? { imapLastSeenUid: lastSeenUid } : {})
    };
  } finally {
    client.close();
  }
}

export async function listImapMailboxes(config: EmailConnectionConfig): Promise<{ mailboxes: ImapMailboxInfo[]; suggestedMapping: EmailMailboxMapping }> {
  assertImapConfig(config);
  const client = createImapFlowClient(config);
  try {
    await client.connect();
    const listed = (await client.list()) as Array<{ path?: string; name?: string; delimiter?: string; flags?: Set<string> | string[]; specialUse?: string }>;
    const mailboxes: ImapMailboxInfo[] = listed
      .map((mailbox): ImapMailboxInfo | undefined => {
        const path = mailbox.path?.trim() || mailbox.name?.trim() || "";
        const flags = Array.isArray(mailbox.flags) ? mailbox.flags : Array.from(mailbox.flags ?? []);
        return path
          ? {
              path,
              name: mailbox.name?.trim() || path,
              delimiter: mailbox.delimiter,
              flags,
              specialUse: mailbox.specialUse
            }
          : undefined;
      })
      .filter((mailbox): mailbox is ImapMailboxInfo => Boolean(mailbox))
      .sort((left, right) => left.path.localeCompare(right.path));
    await client.logout().catch(() => undefined);
    return { mailboxes, suggestedMapping: suggestMailboxMapping(mailboxes, config.mailbox) };
  } finally {
    client.close();
  }
}

export async function fetchRecentMailboxEmails(config: EmailConnectionConfig, limit = 10, options: MailboxFetchOptions = {}): Promise<InboundEmail[]> {
  return (await fetchRecentMailboxEmailBatch(config, limit, options)).messages;
}

export async function fetchRecentMailboxEmailBatch(config: EmailConnectionConfig, limit = 10, options: MailboxFetchOptions = {}): Promise<MailboxFetchResult> {
  const inboundConfig = getInboundConnectionConfig(config);
  return fetchRecentImapEmailBatch(inboundConfig, limit, options);
}

export function buildImapFallbackExternalMessageId(mailbox: string, uid: string): string {
  return `imap:${sanitizeImapExternalIdPart(mailbox)}:${sanitizeImapExternalIdPart(uid)}`;
}

export function withImapFallbackExternalMessageId(message: InboundEmail, mailbox: string, uid: string): InboundEmail {
  return message.externalMessageId ? message : { ...message, externalMessageId: buildImapFallbackExternalMessageId(mailbox, uid) };
}

export function withInboundMailboxSource(message: InboundEmail, mailbox: string, role: "inbox" | "spam" = inferInboundMailboxRole(mailbox)): InboundEmail {
  return {
    ...message,
    inboundMetadata: {
      ...message.inboundMetadata,
      sourceMailbox: mailbox,
      sourceMailboxRole: role
    }
  };
}

export function getMappedMailbox(mapping: EmailMailboxMapping | undefined, role: keyof EmailMailboxMapping, fallback: string): string {
  return mapping?.[role]?.trim() || fallback;
}

function suggestMailboxMapping(mailboxes: ImapMailboxInfo[], configuredMailbox?: string): EmailMailboxMapping {
  return {
    inbox: findMailboxByRole(mailboxes, "\\Inbox", ["inbox"]) ?? configuredMailbox?.trim() ?? "INBOX",
    sent: findMailboxByRole(mailboxes, "\\Sent", ["sent", "sent mail", "sent messages"]),
    spam: findMailboxByRole(mailboxes, "\\Junk", ["spam", "junk", "bulk"]),
    trash: findMailboxByRole(mailboxes, "\\Trash", ["trash", "deleted", "deleted items", "bin"]),
    archive: findMailboxByRole(mailboxes, "\\Archive", ["archive", "all mail"])
  };
}

function findMailboxByRole(mailboxes: ImapMailboxInfo[], specialUse: string, keywords: string[]): string | undefined {
  const special = mailboxes.find((mailbox) => mailbox.specialUse === specialUse || mailbox.flags.includes(specialUse));
  if (special) {
    return special.path;
  }
  return mailboxes.find((mailbox) => {
    const normalized = mailbox.path.toLowerCase();
    return keywords.some((keyword) => normalized === keyword || normalized.endsWith(`/${keyword}`) || normalized.endsWith(`]/${keyword}`));
  })?.path;
}

function inferInboundMailboxRole(mailbox: string): "inbox" | "spam" {
  const normalized = mailbox.toLowerCase();
  return normalized.includes("spam") || normalized.includes("junk") || normalized.includes("bulk") ? "spam" : "inbox";
}

class SmtpClient {
  private socket: net.Socket;
  private buffer = "";
  private readonly onData = (chunk: string | Buffer) => {
    this.buffer += chunk.toString();
  };

  private constructor(socket: net.Socket) {
    this.socket = socket;
    this.attachSocket(socket);
  }

  static async connect(config: EmailConnectionConfig): Promise<SmtpClient> {
    const transport = resolveSmtpTransport(config);
    const socket = await connectSocket(config.smtpHost!, transport.port, transport.secure);
    const client = new SmtpClient(socket);
    await client.readResponse([220]);
    return client;
  }

  async command(command: string, expected: number | number[]): Promise<string> {
    this.socket.write(`${command}\r\n`);
    return this.readResponse(Array.isArray(expected) ? expected : [expected]);
  }

  async writeData(message: string): Promise<string> {
    this.socket.write(`${message.replace(/\r?\n\./g, "\r\n..")}\r\n.\r\n`);
    return this.readResponse([250]);
  }

  close(): void {
    this.socket.destroy();
  }

  async upgradeToTls(host: string): Promise<void> {
    this.socket.off("data", this.onData);
    const secureSocket = tls.connect({ socket: this.socket, servername: host });
    await waitForSecureConnect(secureSocket);
    this.socket = secureSocket;
    this.buffer = "";
    this.attachSocket(secureSocket);
  }

  private async readResponse(expected: number[]): Promise<string> {
    const response = await readUntil(this.socket, () => {
      const lines = this.buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] ?? "";
      return /^\d{3} /.test(last);
    }, () => this.buffer);
    this.buffer = "";
    const code = Number(response.match(/^(\d{3})/m)?.[1]);
    if (!expected.includes(code)) {
      throw new Error(`SMTP returned ${code || "unknown"}: ${response.slice(0, 300)}`);
    }
    return response;
  }

  private attachSocket(socket: net.Socket): void {
    socket.setEncoding("utf8");
    socket.on("data", this.onData);
  }
}

async function prepareSmtpSession(client: SmtpClient, config: EmailConnectionConfig): Promise<void> {
  await client.command(`EHLO ${hostnameForHelo()}`, 250);
  if (resolveSmtpTransport(config).startTls) {
    await client.command("STARTTLS", 220);
    await client.upgradeToTls(config.smtpHost!);
    await client.command(`EHLO ${hostnameForHelo()}`, 250);
  }
}

async function connectSocket(host: string, port: number, secure: boolean, timeoutMs = getMailConnectTimeoutMs()): Promise<net.Socket> {
  try {
    return await connectSocketOnce(host, port, secure, timeoutMs);
  } catch (error) {
    if (!isTransientDnsError(error)) {
      throw error;
    }
    await delay(500);
    return connectSocketOnce(host, port, secure, timeoutMs);
  }
}

function connectSocketOnce(host: string, port: number, secure: boolean, timeoutMs = getMailConnectTimeoutMs()): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeListener("connect", done);
      socket.removeListener("secureConnect", done);
      socket.removeListener("error", fail);
    };
    const done = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(socket);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    };

    timeout = setTimeout(() => {
      fail(new Error(`Connection to ${host}:${port} timed out`));
    }, timeoutMs);

    if (secure) {
      socket.once("secureConnect", done);
    } else {
      socket.once("connect", done);
    }
    socket.once("error", fail);
  });
}

function isTransientDnsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "EAI_AGAIN");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForSecureConnect(socket: tls.TLSSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("STARTTLS handshake timed out"));
    }, getMailConnectTimeoutMs());
    socket.once("secureConnect", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function readUntil(socket: net.Socket, done: () => boolean, read: () => string, timeoutMs = getMailResponseTimeoutMs()): Promise<string> {
  if (done()) {
    return Promise.resolve(read());
  }
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const armTimeout = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => cleanup(reject, new Error(`Mail server response timed out after ${timeoutMs} ms`)), timeoutMs);
    };
    const onData = () => {
      if (done()) {
        cleanup(resolve, read());
        return;
      }
      armTimeout();
    };
    const onError = (error: Error) => cleanup(reject, error);
    const cleanup = <T>(callback: (value: T) => void, value: T) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      socket.off("data", onData);
      socket.off("error", onError);
      callback(value);
    };
    socket.on("data", onData);
    socket.once("error", onError);
    armTimeout();
  });
}

function buildRfc822Message(input: EmailSendInput, from: string): string {
  const attachments = normalizeOutboundAttachments(input.attachments);
  const bodyContentType = input.bodyHtml ? "text/html" : "text/plain";
  const headers = [
    `From: ${sanitizeHeader(from)}`,
    `To: ${formatAddressHeader(input.to)}`,
    input.cc?.length ? `Cc: ${formatAddressHeader(input.cc)}` : undefined,
    `Subject: ${encodeHeader(input.subject)}`,
    input.messageId ? `Message-ID: ${formatOutboundMessageId(input.messageId)}` : undefined,
    input.inReplyTo ? `In-Reply-To: ${sanitizeHeader(input.inReplyTo)}` : undefined,
    input.references?.length ? `References: ${input.references.map(sanitizeHeader).filter(Boolean).join(" ")}` : undefined,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    attachments.length ? `Content-Type: multipart/mixed; boundary="${messageBoundary(input.messageId)}"` : `Content-Type: ${bodyContentType}; charset=utf-8`,
    attachments.length ? undefined : "Content-Transfer-Encoding: 8bit"
  ].filter(Boolean);
  if (!attachments.length) {
    return `${headers.join("\r\n")}\r\n\r\n${input.bodyHtml ?? input.bodyText}`;
  }

  const boundary = messageBoundary(input.messageId);
  const parts = [
    [
      `--${boundary}`,
      `Content-Type: ${bodyContentType}; charset=utf-8`,
      "Content-Transfer-Encoding: 8bit",
      "",
      input.bodyHtml ?? input.bodyText
    ].join("\r\n"),
    ...attachments.map((attachment) => buildAttachmentPart(boundary, attachment)),
    `--${boundary}--`
  ];
  return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}`;
}

function buildAttachmentPart(boundary: string, attachment: EmailAttachment): string {
  const fileName = encodeHeader(attachment.fileName);
  const disposition = attachment.disposition === "inline" ? "inline" : "attachment";
  return [
    `--${boundary}`,
    `Content-Type: ${sanitizeHeader(attachment.contentType || "application/octet-stream")}; name="${fileName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: ${disposition}; filename="${fileName}"`,
    attachment.contentId ? `Content-ID: <${sanitizeHeader(attachment.contentId)}>` : undefined,
    "",
    foldBase64(normalizeEmailAttachmentBase64(attachment.contentBase64 ?? ""))
  ]
    .filter((line) => line !== undefined)
    .join("\r\n");
}

function normalizeOutboundAttachments(attachments: EmailAttachment[] | undefined): EmailAttachment[] {
  return (attachments ?? []).filter((attachment) => Boolean(attachment.contentBase64?.trim()));
}

function messageBoundary(seed: string | undefined): string {
  return `ai-agent-crm-${Buffer.from(seed || `${Date.now()}`).toString("base64url").slice(0, 24)}`;
}

function normalizeBase64(value: string): string {
  return value.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
}

function foldBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function formatOutboundMessageId(value: string): string {
  const trimmed = sanitizeHeader(value);
  return trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed : `<${trimmed}@ai-agent-crm.local>`;
}

function formatAddressHeader(values: string[]): string {
  return values.map(sanitizeHeader).filter(Boolean).join(", ");
}

function encodeHeader(value: string): string {
  const sanitized = sanitizeHeader(value);
  return /[^\x20-\x7e]/.test(sanitized) ? `=?UTF-8?B?${Buffer.from(sanitized, "utf8").toString("base64")}?=` : sanitized;
}

async function resolveImapFetchUids(
  client: ImapFlow,
  messageCount: number,
  limit: number,
  uidValidity: string | undefined,
  options: MailboxFetchOptions
): Promise<{ fetchUids: string[]; hasMore: boolean }> {
  if (messageCount <= 0) {
    return { fetchUids: [], hasMore: false };
  }
  const previousUid = normalizeImapUid(options.imapLastSeenUid);
  if (options.fullResync) {
    const beforeUid = normalizeImapUid(options.fullResyncBeforeUid);
    if (beforeUid && BigInt(beforeUid) <= 1n) {
      return { fetchUids: [], hasMore: false };
    }
    const uidRange = beforeUid ? `1:${BigInt(beforeUid) - 1n}` : "1:*";
    const uids = await searchImapUids(client, { uid: uidRange }, options);
    return { fetchUids: uids.slice(-limit), hasMore: uids.length > limit };
  }
  if (uidValidity && options.imapUidValidity === uidValidity && previousUid) {
    const nextUid = (BigInt(previousUid) + 1n).toString();
    const uids = await searchImapUids(client, { uid: `${nextUid}:*` }, options);
    return { fetchUids: uids.slice(0, limit), hasMore: uids.length > limit };
  }
  const startSequenceNumber = Math.max(1, messageCount - limit + 1);
  const uids = await searchImapUids(client, { seq: `${startSequenceNumber}:*` }, options);
  return { fetchUids: uids.slice(-limit), hasMore: false };
}

function createImapFlowClient(config: EmailConnectionConfig, options: MailboxFetchOptions = {}): ImapFlow {
  const port = config.imapPort ?? (config.imapSecure === false ? 143 : 993);
  const secure = config.imapSecure !== false;
  const timeoutMs = mailOperationTimeout(getMailResponseTimeoutMs(), options);
  const client = new ImapFlow({
    host: config.imapHost!,
    port,
    secure,
    doSTARTTLS: secure ? undefined : false,
    auth: {
      user: config.username ?? "",
      pass: config.password ?? ""
    },
    connectionTimeout: mailOperationTimeout(getMailConnectTimeoutMs(), options),
    greetingTimeout: timeoutMs,
    socketTimeout: mailOperationTimeout(getMailFetchResponseTimeoutMs(), options),
    maxLiteralSize: getMailImapFetchBytes(),
    logger: false
  });
  client.on("error", () => undefined);
  return client;
}

async function searchImapUids(client: ImapFlow, query: { uid?: string; seq?: string }, options: MailboxFetchOptions): Promise<string[]> {
  const values = await withMailOperationTimeout(client.search(query, { uid: true }), mailOperationTimeout(getMailResponseTimeoutMs(), options));
  return sortImapUids((values || []).map((uid) => uid.toString()).map(normalizeImapUid).filter((uid): uid is string => Boolean(uid)));
}

async function downloadImapSource(client: ImapFlow, uid: string, maxBytes: number, options: MailboxFetchOptions): Promise<Buffer | undefined> {
  const download = async () => {
    const response = await client.download(uid, undefined, { uid: true, maxBytes, chunkSize: maxBytes });
    if (!response.content) {
      return undefined;
    }
    return readBoundedStream(response.content, maxBytes);
  };
  return withMailOperationTimeout(download(), mailOperationTimeout(getMailFetchResponseTimeoutMs(), options));
}

async function readBoundedStream(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = maxBytes - total;
    if (remaining <= 0) {
      break;
    }
    chunks.push(buffer.length > remaining ? buffer.subarray(0, remaining) : buffer);
    total += Math.min(buffer.length, remaining);
  }
  return Buffer.concat(chunks);
}

function normalizeImapUid(value: string | undefined): string | undefined {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }
  return BigInt(value).toString();
}

function sortImapUids(values: string[]): string[] {
  return [...values].sort((left, right) => (BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0));
}

function maxImapUid(left: string | undefined, right: string | undefined): string | undefined {
  const normalizedRight = normalizeImapUid(right);
  if (!normalizedRight) {
    return normalizeImapUid(left);
  }
  const normalizedLeft = normalizeImapUid(left);
  if (!normalizedLeft) {
    return normalizedRight;
  }
  return BigInt(normalizedRight) > BigInt(normalizedLeft) ? normalizedRight : normalizedLeft;
}

function minImapUid(left: string | undefined, right: string | undefined): string | undefined {
  const normalizedRight = normalizeImapUid(right);
  if (!normalizedRight) {
    return normalizeImapUid(left);
  }
  const normalizedLeft = normalizeImapUid(left);
  if (!normalizedLeft) {
    return normalizedRight;
  }
  return BigInt(normalizedRight) < BigInt(normalizedLeft) ? normalizedRight : normalizedLeft;
}

function normalizeMailboxFetchLimit(limit: number): number {
  return Math.max(1, Math.min(100, Math.floor(Number.isFinite(limit) ? limit : 10)));
}

function getMailConnectTimeoutMs(): number {
  return resolvePositiveEnvInt("MAIL_CONNECT_TIMEOUT_MS", DEFAULT_MAIL_CONNECT_TIMEOUT_MS);
}

function getMailResponseTimeoutMs(): number {
  return resolvePositiveEnvInt("MAIL_RESPONSE_TIMEOUT_MS", DEFAULT_MAIL_RESPONSE_TIMEOUT_MS);
}

function getMailFetchResponseTimeoutMs(): number {
  return resolvePositiveEnvInt("MAIL_FETCH_RESPONSE_TIMEOUT_MS", DEFAULT_MAIL_FETCH_RESPONSE_TIMEOUT_MS);
}

function mailOperationTimeout(defaultTimeoutMs: number, options: MailboxFetchOptions): number {
  if (!options.deadlineAt) {
    return defaultTimeoutMs;
  }
  const remainingMs = options.deadlineAt - Date.now();
  if (remainingMs <= 0) {
    throw new Error("Mailbox sync timed out before completion.");
  }
  return Math.max(1, Math.min(defaultTimeoutMs, remainingMs));
}

function assertMailSyncDeadline(options: MailboxFetchOptions): void {
  if (options.deadlineAt && Date.now() >= options.deadlineAt) {
    throw new Error("Mailbox sync timed out before completion.");
  }
}

function withMailOperationTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`Mail server response timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

function getMailImapFetchBytes(): number {
  return resolvePositiveEnvIntWithMax("MAIL_IMAP_FETCH_BYTES", DEFAULT_MAIL_IMAP_FETCH_BYTES, MAX_MAIL_IMAP_FETCH_BYTES);
}

function resolvePositiveEnvInt(name: string, fallback: number): number {
  return resolvePositiveEnvIntWithMax(name, fallback, MAX_MAIL_TIMEOUT_MS);
}

function resolvePositiveEnvIntWithMax(name: string, fallback: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

export function parseRawEmailMessage(messageText: string): InboundEmail | undefined {
  const [rawHeaders, ...bodyParts] = messageText.split(/\r?\n\r?\n/);
  const headers = parseHeaders(rawHeaders);
  const from = firstAddress(headers.from ?? "");
  const to = splitAddressHeader(headers.to ?? "");
  const cc = splitAddressHeader(headers.cc ?? "");
  if (!from) {
    return undefined;
  }
  const contentType = parseContentType(headers["content-type"]);
  const body = bodyParts.join("\n\n");
  const parsedBody = parseMimeBody(body, contentType, headers);
  const bodyHtml = parsedBody.bodyHtml ? repairEmailMojibake(parsedBody.bodyHtml) : undefined;
  const bodyText = repairEmailMojibake(parsedBody.bodyText);
  return {
    externalMessageId: headers["message-id"],
    from,
    to,
    ...(cc.length ? { cc } : {}),
    subject: repairEmailMojibake(decodeHeader(headers.subject ?? "(no subject)")),
    bodyText: bodyText.trim().slice(0, 20000),
    bodyHtml: bodyHtml?.trim().slice(0, 20000),
    attachments: parsedBody.attachments,
    receivedAt: safeIsoDate(headers.date),
    inboundMetadata: extractInboundMetadata(headers)
  };
}

function parseHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  let current = "";
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s/.test(line) && current) {
      headers[current] += ` ${line.trim()}`;
      continue;
    }
    const index = line.indexOf(":");
    if (index > 0) {
      current = line.slice(0, index).toLowerCase();
      headers[current] = line.slice(index + 1).trim();
    }
  }
  return headers;
}

function splitAddressHeader(value: string): string[] {
  return uniqueParsedEmailAddresses(value);
}

function firstAddress(value: string): string {
  return splitAddressHeader(value)[0] ?? "";
}

const EMAIL_ADDRESS_PATTERN = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi;

function uniqueParsedEmailAddresses(value: string): string[] {
  const matches = decodeHeader(value).match(EMAIL_ADDRESS_PATTERN) ?? [];
  return Array.from(new Set(matches.map((email) => email.toLowerCase())));
}

interface ParsedContentType {
  mimeType: string;
  params: Record<string, string>;
}

function parseMimeBody(body: string, contentType: ParsedContentType, headers: Record<string, string>): { bodyText: string; bodyHtml?: string; attachments?: EmailAttachment[] } {
  if (contentType.mimeType.startsWith("multipart/") && contentType.params.boundary) {
    const parts = splitMultipartBody(body, contentType.params.boundary);
    const parsedParts = parts.map(parseMimePart);
    const bodyHtml = parsedParts.find((part) => part.bodyHtml)?.bodyHtml;
    const bodyText = parsedParts.find((part) => part.bodyText)?.bodyText ?? (bodyHtml ? stripHtml(bodyHtml) : "");
    const attachments = parsedParts.flatMap((part) => part.attachments ?? []);
    return { bodyText, bodyHtml, attachments: attachments.length ? attachments : undefined };
  }

  if (contentType.mimeType === "text/html") {
    const bodyHtml = decodeMimeText(body, headers["content-transfer-encoding"], contentType.params.charset);
    return {
      bodyText: stripHtml(bodyHtml),
      bodyHtml,
      attachments: undefined
    };
  }

  return {
    bodyText: decodeMimeText(body, headers["content-transfer-encoding"], contentType.params.charset),
    attachments: undefined
  };
}

function parseMimePart(raw: string): { bodyText?: string; bodyHtml?: string; attachments?: EmailAttachment[] } {
  const [rawHeaders, ...bodyParts] = raw.split(/\r?\n\r?\n/);
  const headers = parseHeaders(rawHeaders);
  const contentType = parseContentType(headers["content-type"]);
  const body = bodyParts.join("\n\n");
  if (contentType.mimeType.startsWith("multipart/") && contentType.params.boundary) {
    return parseMimeBody(body, contentType, headers);
  }

  const disposition = parseHeaderWithParams(headers["content-disposition"]);
  const fileName = decodeHeader(disposition.params.filename ?? contentType.params.name ?? "");
  const isAttachment = Boolean(fileName) || disposition.value === "attachment" || disposition.value === "inline";
  if (isAttachment) {
    const content = parseAttachmentContent(body, headers["content-transfer-encoding"], contentType.params.charset);
    return {
      attachments: [
        {
          fileName: fileName || "attachment",
          contentType: contentType.mimeType || "application/octet-stream",
          size: content.size,
          ...(content.contentBase64 && content.size <= MAX_EMAIL_ATTACHMENT_BYTES ? { contentBase64: content.contentBase64 } : {}),
          ...(headers["content-id"] ? { contentId: headers["content-id"].replace(/[<>]/g, "").trim() } : {}),
          ...(disposition.value === "inline" ? { disposition: "inline" as const } : { disposition: "attachment" as const })
        }
      ]
    };
  }

  if (contentType.mimeType === "text/plain" || !contentType.mimeType) {
    return { bodyText: decodeMimeText(body, headers["content-transfer-encoding"], contentType.params.charset) };
  }
  if (contentType.mimeType === "text/html") {
    const bodyHtml = decodeMimeText(body, headers["content-transfer-encoding"], contentType.params.charset);
    return { bodyText: stripHtml(bodyHtml), bodyHtml };
  }
  return {};
}

function parseAttachmentContent(body: string, transferEncoding: string | undefined, charset?: string): { contentBase64?: string; size: number } {
  if (transferEncoding?.toLowerCase() === "base64") {
    try {
      const contentBase64 = normalizeEmailAttachmentBase64(body);
      return { contentBase64, size: Buffer.from(contentBase64, "base64").length };
    } catch {
      return { size: 0 };
    }
  }
  const contentBase64 = Buffer.from(decodeMimeText(body, transferEncoding, charset), "utf8").toString("base64");
  return { contentBase64, size: Buffer.from(contentBase64, "base64").length };
}

function splitMultipartBody(body: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  return body
    .split(marker)
    .map((part) => part.replace(/^\r?\n/, "").replace(/\r?\n$/, ""))
    .filter((part) => part.trim() && part.trim() !== "--" && !part.trim().startsWith("--"));
}

function parseContentType(value: string | undefined): ParsedContentType {
  const parsed = parseHeaderWithParams(value);
  return {
    mimeType: (parsed.value || "text/plain").toLowerCase(),
    params: parsed.params
  };
}

function parseHeaderWithParams(value: string | undefined): { value: string; params: Record<string, string> } {
  const parts = (value ?? "").split(";").map((part) => part.trim()).filter(Boolean);
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const index = part.indexOf("=");
    if (index > 0) {
      const key = part.slice(0, index).trim().toLowerCase();
      params[key] = part.slice(index + 1).trim().replace(/^"|"$/g, "");
    }
  }
  return { value: (parts[0] ?? "").toLowerCase(), params };
}

function decodeMimeText(value: string, transferEncoding?: string, charset?: string): string {
  const bytes = decodeMimeBytes(value, transferEncoding);
  return decodeBufferWithCharset(bytes, charset);
}

function decodeMimeBytes(value: string, transferEncoding?: string): Buffer {
  const encoding = transferEncoding?.toLowerCase();
  if (encoding === "base64") {
    return Buffer.from(normalizeBase64(value), "base64");
  }
  if (encoding === "quoted-printable") {
    return decodeQuotedPrintableToBuffer(value);
  }
  return Buffer.from(value, "utf8");
}

function decodeBufferWithCharset(bytes: Buffer, charset?: string): string {
  const label = normalizeCharsetLabel(charset);
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

function normalizeCharsetLabel(charset?: string): string {
  const label = charset?.trim().replace(/^"|"$/g, "").toLowerCase();
  if (!label) {
    return "utf-8";
  }
  if (label === "gb2312" || label === "gbk" || label === "x-gbk") {
    return "gb18030";
  }
  if (label === "iso-8859-1" || label === "latin1") {
    return "windows-1252";
  }
  return label;
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeQuotedPrintable(value: string): string {
  return decodeBufferWithCharset(decodeQuotedPrintableToBuffer(value), "utf-8");
}

function decodeQuotedPrintableToBuffer(value: string): Buffer {
  const normalized = value.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === "=" && /^[0-9a-f]{2}$/i.test(normalized.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(normalized.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }
    bytes.push(...Buffer.from(char, "utf8"));
  }
  return Buffer.from(bytes);
}

function decodeHeader(value: string): string {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]+)\?=/gi, (_match, charset: string, encoding: string, encoded: string) => {
    if (encoding.toLowerCase() === "b") {
      return decodeBufferWithCharset(Buffer.from(normalizeBase64(encoded), "base64"), charset);
    }
    return decodeBufferWithCharset(decodeQuotedPrintableToBuffer(encoded.replace(/_/g, " ")), charset);
  });
}

function safeIsoDate(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function escapeImap(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function sanitizeImapExternalIdPart(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._=-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "unknown";
}

function hostnameForHelo(): string {
  return process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL).hostname : "localhost";
}

function assertSmtpConfig(config: EmailConnectionConfig): void {
  if (!config.smtpHost || !config.username || !config.password) {
    throw new Error("SMTP host, username, and password are required");
  }
}

function assertImapConfig(config: EmailConnectionConfig): void {
  if (!config.imapHost || !config.username || !config.password) {
    throw new Error("IMAP host, username, and password are required");
  }
}
