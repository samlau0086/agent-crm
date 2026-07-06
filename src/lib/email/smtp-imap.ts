import net from "node:net";
import tls from "node:tls";
import type { EmailAttachment, EmailConnectionConfig, EmailOutboundServiceConfig } from "@/lib/crm/types";
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
  pop3?: "ok" | "skipped";
  resend?: "ok" | "skipped";
  oauth?: "ok" | "skipped";
  oauthAccountEmail?: string;
}

export interface MailSendResult {
  externalMessageId?: string;
}

export interface SmtpTransportOptions {
  port: number;
  secure: boolean;
  startTls: boolean;
}

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
  const syncProtocol = resolveSyncProtocol(inboundConfig);
  if (shouldTestSync && syncProtocol === "imap") {
    assertImapConfig(inboundConfig);
    const imap = await ImapClient.connect(inboundConfig);
    try {
      await imap.command(`LOGIN "${escapeImap(inboundConfig.username ?? "")}" "${escapeImap(inboundConfig.password ?? "")}"`);
      await imap.command(`SELECT "${escapeImap(inboundConfig.mailbox ?? "INBOX")}"`);
      await imap.command("LOGOUT").catch(() => undefined);
      result.imap = "ok";
    } finally {
      imap.close();
    }
    result.pop3 = "skipped";
  } else if (shouldTestSync && syncProtocol === "pop3") {
    assertPop3Config(inboundConfig);
    const pop3 = await Pop3Client.connect(inboundConfig);
    try {
      await pop3.command(`USER ${inboundConfig.username ?? ""}`);
      await pop3.command(`PASS ${inboundConfig.password ?? ""}`);
      await pop3.command("STAT");
      await pop3.command("QUIT").catch(() => undefined);
      result.pop3 = "ok";
    } finally {
      pop3.close();
    }
    result.imap = "skipped";
  } else {
    result.imap = "skipped";
    result.pop3 = "skipped";
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

export async function fetchRecentImapEmails(config: EmailConnectionConfig, limit = 10): Promise<InboundEmail[]> {
  assertImapConfig(config);
  const client = await ImapClient.connect(config);
  try {
    await client.command(`LOGIN "${escapeImap(config.username ?? "")}" "${escapeImap(config.password ?? "")}"`);
    await client.command(`SELECT "${escapeImap(config.mailbox ?? "INBOX")}"`);
    const search = await client.command("UID SEARCH ALL");
    const uids = parseUidSearch(search).slice(-limit);
    const messages: InboundEmail[] = [];
    for (const uid of uids) {
      const raw = await client.command(`UID FETCH ${uid} (BODY.PEEK[])`);
      const parsed = parseFetchedMessage(raw);
      if (parsed) {
        messages.push(withImapFallbackExternalMessageId(parsed, config.mailbox ?? "INBOX", uid));
      }
    }
    await client.command("LOGOUT").catch(() => undefined);
    return messages;
  } finally {
    client.close();
  }
}

export async function fetchRecentMailboxEmails(config: EmailConnectionConfig, limit = 10): Promise<InboundEmail[]> {
  const inboundConfig = getInboundConnectionConfig(config);
  return resolveSyncProtocol(inboundConfig) === "pop3" ? fetchRecentPop3Emails(inboundConfig, limit) : fetchRecentImapEmails(inboundConfig, limit);
}

export async function fetchRecentPop3Emails(config: EmailConnectionConfig, limit = 10): Promise<InboundEmail[]> {
  assertPop3Config(config);
  const client = await Pop3Client.connect(config);
  try {
    await client.command(`USER ${config.username ?? ""}`);
    await client.command(`PASS ${config.password ?? ""}`);
    const list = await client.command("LIST");
    const messageNumbers = parsePop3List(list).slice(-limit);
    const uidlMap = await client.command("UIDL").then(parsePop3Uidl).catch(() => new Map<string, string>());
    const messages: InboundEmail[] = [];
    for (const messageNumber of messageNumbers) {
      const raw = await client.command(`RETR ${messageNumber}`);
      const parsed = parsePop3Message(raw);
      if (parsed) {
        messages.push(withPop3FallbackExternalMessageId(parsed, uidlMap.get(messageNumber) ?? messageNumber));
      }
    }
    await client.command("QUIT").catch(() => undefined);
    return messages;
  } finally {
    client.close();
  }
}

export function buildImapFallbackExternalMessageId(mailbox: string, uid: string): string {
  return `imap:${sanitizeImapExternalIdPart(mailbox)}:${sanitizeImapExternalIdPart(uid)}`;
}

export function withImapFallbackExternalMessageId(message: InboundEmail, mailbox: string, uid: string): InboundEmail {
  return message.externalMessageId ? message : { ...message, externalMessageId: buildImapFallbackExternalMessageId(mailbox, uid) };
}

export function buildPop3FallbackExternalMessageId(uid: string): string {
  return `pop3:${sanitizeImapExternalIdPart(uid)}`;
}

export function withPop3FallbackExternalMessageId(message: InboundEmail, uid: string): InboundEmail {
  return message.externalMessageId ? message : { ...message, externalMessageId: buildPop3FallbackExternalMessageId(uid) };
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

class ImapClient {
  private readonly socket: net.Socket;
  private buffer = "";
  private tagCounter = 1;

  private constructor(socket: net.Socket) {
    this.socket = socket;
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk) => {
      this.buffer += chunk;
    });
  }

  static async connect(config: EmailConnectionConfig): Promise<ImapClient> {
    const port = config.imapPort ?? (config.imapSecure === false ? 143 : 993);
    const socket = await connectSocket(config.imapHost!, port, config.imapSecure !== false);
    const client = new ImapClient(socket);
    await readUntil(socket, () => client.buffer.includes("* OK"), () => client.buffer);
    client.buffer = "";
    return client;
  }

  async command(command: string): Promise<string> {
    const tag = `A${String(this.tagCounter++).padStart(4, "0")}`;
    this.socket.write(`${tag} ${command}\r\n`);
    const response = await readUntil(this.socket, () => this.buffer.includes(`${tag} OK`) || this.buffer.includes(`${tag} NO`) || this.buffer.includes(`${tag} BAD`), () => this.buffer);
    this.buffer = "";
    if (response.includes(`${tag} NO`) || response.includes(`${tag} BAD`)) {
      throw new Error(`IMAP command failed: ${response.slice(0, 300)}`);
    }
    return response;
  }

  close(): void {
    this.socket.destroy();
  }
}

class Pop3Client {
  private readonly socket: net.Socket;
  private buffer = "";

  private constructor(socket: net.Socket) {
    this.socket = socket;
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk) => {
      this.buffer += chunk;
    });
  }

  static async connect(config: EmailConnectionConfig): Promise<Pop3Client> {
    const port = config.pop3Port ?? (config.pop3Secure === false ? 110 : 995);
    const socket = await connectSocket(config.pop3Host!, port, config.pop3Secure !== false);
    const client = new Pop3Client(socket);
    await client.readResponse(false);
    return client;
  }

  async command(command: string): Promise<string> {
    const isMultiline = /^(LIST|UIDL|RETR)\b/i.test(command);
    this.socket.write(`${command}\r\n`);
    return this.readResponse(isMultiline);
  }

  close(): void {
    this.socket.destroy();
  }

  private async readResponse(multiline: boolean): Promise<string> {
    const response = await readUntil(
      this.socket,
      () => (multiline ? /\r?\n\.\r?\n$/.test(this.buffer) : /\r?\n$/.test(this.buffer)),
      () => this.buffer
    );
    this.buffer = "";
    if (response.startsWith("-ERR")) {
      throw new Error(`POP3 command failed: ${response.slice(0, 300)}`);
    }
    if (!response.startsWith("+OK")) {
      throw new Error(`POP3 returned an invalid response: ${response.slice(0, 300)}`);
    }
    return response;
  }
}

function connectSocket(host: string, port: number, secure: boolean): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Connection to ${host}:${port} timed out`));
    }, 15000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once("secureConnect", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForSecureConnect(socket: tls.TLSSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("STARTTLS handshake timed out"));
    }, 15000);
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

function readUntil(socket: net.Socket, done: () => boolean, read: () => string): Promise<string> {
  if (done()) {
    return Promise.resolve(read());
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => cleanup(reject, new Error("Mail server response timed out")), 20000);
    const onData = () => {
      if (done()) {
        cleanup(resolve, read());
      }
    };
    const onError = (error: Error) => cleanup(reject, error);
    const cleanup = <T>(callback: (value: T) => void, value: T) => {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", onError);
      callback(value);
    };
    socket.on("data", onData);
    socket.once("error", onError);
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

function parseUidSearch(response: string): string[] {
  const line = response.split(/\r?\n/).find((candidate) => candidate.startsWith("* SEARCH")) ?? "";
  return line.replace("* SEARCH", "").trim().split(/\s+/).filter(Boolean);
}

function parseFetchedMessage(response: string): InboundEmail | undefined {
  const messageText = response.match(/\{\\?\d+\}\r?\n([\s\S]*?)\r?\n\)/)?.[1] ?? response;
  return parseRawEmailMessage(messageText);
}

function parsePop3List(response: string): string[] {
  return stripPop3MultilineResponse(response)
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((value) => /^\d+$/.test(value));
}

function parsePop3Uidl(response: string): Map<string, string> {
  return new Map(
    stripPop3MultilineResponse(response)
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length >= 2 && /^\d+$/.test(parts[0]))
      .map(([messageNumber, uid]) => [messageNumber, uid])
  );
}

function parsePop3Message(response: string): InboundEmail | undefined {
  return parseRawEmailMessage(stripPop3MultilineResponse(response));
}

function stripPop3MultilineResponse(response: string): string {
  return response
    .replace(/^\+OK[^\r\n]*(?:\r?\n)?/, "")
    .replace(/\r?\n\.\r?\n?$/, "")
    .replace(/(^|\r?\n)\.\./g, "$1.");
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

function assertPop3Config(config: EmailConnectionConfig): void {
  if (!config.pop3Host || !config.username || !config.password) {
    throw new Error("POP3 host, username, and password are required");
  }
}

function resolveSyncProtocol(config: EmailConnectionConfig): "imap" | "pop3" {
  return config.syncProtocol === "pop3" ? "pop3" : "imap";
}
