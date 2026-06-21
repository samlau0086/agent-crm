import type { EmailAttachment, EmailConnectionConfig } from "@/lib/crm/types";
import type { EmailSendInput } from "@/lib/email/provider";
import type { InboundEmail } from "@/lib/email/smtp-imap";
import { assertOAuthConfig, refreshOAuthAccessToken, type OAuthProviderConfig } from "@/lib/email/oauth";

export interface OAuthMailApiResult {
  config: EmailConnectionConfig;
  externalMessageId?: string;
}

export interface OAuthMailSyncResult extends OAuthMailApiResult {
  messages: InboundEmail[];
  fetchedCount: number;
  pageCount: number;
  hasMore: boolean;
}

export interface OAuthAttachmentDownloadResult extends OAuthMailApiResult {
  fileName: string;
  contentType: string;
  contentBase64: string;
  size: number;
}

export interface OAuthConnectionTestResult extends OAuthMailApiResult {
  provider: "gmail" | "outlook";
  accountEmail?: string;
}

export interface OAuthMailApiOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
  providerConfig?: Partial<OAuthProviderConfig>;
  limit?: number;
}

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";
const OUTLOOK_API_BASE = "https://graph.microsoft.com/v1.0";

export async function testOAuthConnection(
  provider: "gmail" | "outlook",
  config: EmailConnectionConfig,
  options: OAuthMailApiOptions = {}
): Promise<OAuthConnectionTestResult> {
  const refreshed = await ensureOAuthAccess(provider, config, options);
  const fetchImpl = options.fetchImpl ?? fetch;
  if (provider === "gmail") {
    const response = await fetchImpl(`${GMAIL_API_BASE}/users/me/profile`, {
      headers: oauthJsonHeaders(refreshed)
    });
    await assertOk(response, "Gmail connection test");
    const payload = (await response.json().catch(() => ({}))) as { emailAddress?: string };
    return { provider, config: refreshed, accountEmail: payload.emailAddress };
  }

  const response = await fetchImpl(`${OUTLOOK_API_BASE}/me?$select=id,mail,userPrincipalName`, {
    headers: oauthJsonHeaders(refreshed)
  });
  await assertOk(response, "Outlook connection test");
  const payload = (await response.json().catch(() => ({}))) as { mail?: string; userPrincipalName?: string };
  return { provider, config: refreshed, accountEmail: payload.mail || payload.userPrincipalName };
}

export async function sendOAuthEmail(
  provider: "gmail" | "outlook",
  config: EmailConnectionConfig,
  input: EmailSendInput,
  from: string,
  options: OAuthMailApiOptions = {}
): Promise<OAuthMailApiResult> {
  const refreshed = await ensureOAuthAccess(provider, config, options);
  const fetchImpl = options.fetchImpl ?? fetch;
  if (provider === "gmail") {
    const response = await fetchImpl(`${GMAIL_API_BASE}/users/me/messages/send`, {
      method: "POST",
      headers: oauthJsonHeaders(refreshed),
      body: JSON.stringify({ raw: encodeBase64Url(buildRfc822Message(input, from)) })
    });
    await assertOk(response, "Gmail send");
    const payload = (await response.json().catch(() => ({}))) as { id?: string };
    return { config: refreshed, externalMessageId: input.messageId ? formatOutboundMessageId(input.messageId) : payload.id };
  }

  const response = await fetchImpl(`${OUTLOOK_API_BASE}/me/sendMail`, {
    method: "POST",
    headers: oauthJsonHeaders(refreshed),
    body: JSON.stringify({
      message: {
        subject: input.subject,
        body: {
          contentType: input.bodyHtml ? "HTML" : "Text",
          content: input.bodyHtml || input.bodyText
        },
        toRecipients: input.to.map(toGraphRecipient),
        ccRecipients: (input.cc ?? []).map(toGraphRecipient),
        bccRecipients: (input.bcc ?? []).map(toGraphRecipient),
        attachments: normalizeOutboundAttachments(input.attachments).map(toGraphAttachment),
        ...optionalInternetMessageHeaders(input)
      },
      saveToSentItems: true
    })
  });
  await assertOk(response, "Outlook send");
  return { config: refreshed, externalMessageId: input.messageId ? formatOutboundMessageId(input.messageId) : undefined };
}

export async function downloadOAuthAttachment(
  provider: "gmail" | "outlook",
  config: EmailConnectionConfig,
  attachment: EmailAttachment,
  options: OAuthMailApiOptions = {}
): Promise<OAuthAttachmentDownloadResult> {
  const refreshed = await ensureOAuthAccess(provider, config, options);
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!attachment.providerMessageId || !attachment.providerAttachmentId) {
    throw new Error(`${provider} attachment download requires providerMessageId and providerAttachmentId`);
  }

  if (provider === "gmail") {
    const response = await fetchImpl(
      `${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(attachment.providerMessageId)}/attachments/${encodeURIComponent(attachment.providerAttachmentId)}`,
      { headers: oauthJsonHeaders(refreshed) }
    );
    await assertOk(response, "Gmail attachment download");
    const payload = (await response.json()) as { data?: string; size?: number };
    const contentBase64 = normalizeBase64(payload.data ?? "");
    return {
      config: refreshed,
      fileName: attachment.fileName,
      contentType: attachment.contentType || "application/octet-stream",
      contentBase64,
      size: Number.isFinite(Number(payload.size)) ? Math.max(0, Number(payload.size)) : Buffer.from(contentBase64, "base64").length
    };
  }

  const response = await fetchImpl(
    `${OUTLOOK_API_BASE}/me/messages/${encodeURIComponent(attachment.providerMessageId)}/attachments/${encodeURIComponent(attachment.providerAttachmentId)}/$value`,
    { headers: oauthJsonHeaders(refreshed) }
  );
  await assertOk(response, "Outlook attachment download");
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    config: refreshed,
    fileName: attachment.fileName,
    contentType: response.headers.get("content-type") || attachment.contentType || "application/octet-stream",
    contentBase64: bytes.toString("base64"),
    size: bytes.length
  };
}

export async function fetchRecentOAuthEmails(
  provider: "gmail" | "outlook",
  config: EmailConnectionConfig,
  options: OAuthMailApiOptions = {}
): Promise<OAuthMailSyncResult> {
  const refreshed = await ensureOAuthAccess(provider, config, options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = normalizeSyncLimit(options.limit);
  if (provider === "gmail") {
    const messages: InboundEmail[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;
    let hasMore = false;
    do {
      const url = new URL(`${GMAIL_API_BASE}/users/me/messages`);
      url.searchParams.set("maxResults", String(Math.min(25, limit - messages.length)));
      url.searchParams.set("q", "in:anywhere");
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }
      const listResponse = await fetchImpl(url.toString(), {
        headers: oauthJsonHeaders(refreshed)
      });
      await assertOk(listResponse, "Gmail list messages");
      const listPayload = (await listResponse.json()) as { messages?: Array<{ id?: string }>; nextPageToken?: string };
      pageCount += 1;
      pageToken = listPayload.nextPageToken;
      hasMore = Boolean(pageToken);
      for (const item of listPayload.messages ?? []) {
        if (!item.id || messages.length >= limit) {
          continue;
        }
        const messageResponse = await fetchImpl(`${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(item.id)}?format=full`, {
          headers: oauthJsonHeaders(refreshed)
        });
        await assertOk(messageResponse, "Gmail get message");
        const parsed = parseGmailMessage(await messageResponse.json());
        if (parsed) {
          messages.push(parsed);
        }
      }
    } while (pageToken && messages.length < limit);
    return { config: refreshed, messages, fetchedCount: messages.length, pageCount, hasMore: hasMore && messages.length >= limit };
  }

  const messages: InboundEmail[] = [];
  let url: string | undefined = buildOutlookMessagesUrl(Math.min(25, limit));
  let pageCount = 0;
  let hasMore = false;
  while (url && messages.length < limit) {
    const response = await fetchImpl(url, {
      headers: oauthJsonHeaders(refreshed)
    });
    await assertOk(response, "Outlook list messages");
    const payload = (await response.json()) as { value?: unknown[]; "@odata.nextLink"?: string };
    pageCount += 1;
    for (const item of payload.value ?? []) {
      if (messages.length >= limit) {
        break;
      }
      const parsed = parseOutlookMessage(item);
      if (parsed) {
        messages.push(parsed);
      }
    }
    url = payload["@odata.nextLink"];
    hasMore = Boolean(url);
  }
  return {
    config: refreshed,
    messages,
    fetchedCount: messages.length,
    pageCount,
    hasMore: hasMore && messages.length >= limit
  };
}

function normalizeSyncLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(100, Math.floor(limit ?? 10)));
}

function buildOutlookMessagesUrl(top: number): string {
  const params = new URLSearchParams({
    $top: String(top),
    $orderby: "receivedDateTime desc",
    $expand: "attachments"
  });
  return `${OUTLOOK_API_BASE}/me/messages?${params.toString()}`;
}

async function ensureOAuthAccess(
  provider: "gmail" | "outlook",
  config: EmailConnectionConfig,
  options: OAuthMailApiOptions
): Promise<EmailConnectionConfig> {
  assertOAuthConfig(provider, config);
  const refreshed = await refreshOAuthAccessToken(provider, config, {
    now: options.now,
    fetchImpl: options.fetchImpl,
    providerConfig: options.providerConfig
  });
  if (!refreshed.accessToken) {
    throw new Error(`${provider} OAuth access token is required`);
  }
  return refreshed;
}

function oauthJsonHeaders(config: EmailConnectionConfig): HeadersInit {
  return {
    authorization: `${config.tokenType || "Bearer"} ${config.accessToken}`,
    "content-type": "application/json"
  };
}

function buildRfc822Message(input: EmailSendInput, from: string): string {
  const attachments = normalizeOutboundAttachments(input.attachments);
  const bodyContentType = input.bodyHtml ? "text/html" : "text/plain";
  const headers = [
    `From: ${sanitizeHeader(from)}`,
    `To: ${formatAddressHeader(input.to)}`,
    input.cc?.length ? `Cc: ${formatAddressHeader(input.cc)}` : undefined,
    input.bcc?.length ? `Bcc: ${formatAddressHeader(input.bcc)}` : undefined,
    `Subject: ${encodeHeader(input.subject)}`,
    input.messageId ? `Message-ID: ${formatOutboundMessageId(input.messageId)}` : undefined,
    input.inReplyTo ? `In-Reply-To: ${sanitizeHeader(input.inReplyTo)}` : undefined,
    input.references?.length ? `References: ${input.references.map(sanitizeHeader).filter(Boolean).join(" ")}` : undefined,
    "MIME-Version: 1.0",
    attachments.length ? `Content-Type: multipart/mixed; boundary="${messageBoundary(input.messageId)}"` : `Content-Type: ${bodyContentType}; charset=utf-8`
  ].filter(Boolean);
  if (!attachments.length) {
    return `${headers.join("\r\n")}\r\n\r\n${input.bodyHtml || input.bodyText}`;
  }
  const boundary = messageBoundary(input.messageId);
  const parts = [
    [
      `--${boundary}`,
      `Content-Type: ${bodyContentType}; charset=utf-8`,
      "Content-Transfer-Encoding: 8bit",
      "",
      input.bodyHtml || input.bodyText
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
    foldBase64(normalizeBase64(attachment.contentBase64 ?? ""))
  ]
    .filter((line) => line !== undefined)
    .join("\r\n");
}

function optionalInternetMessageHeaders(input: EmailSendInput): { internetMessageHeaders?: Array<{ name: string; value: string }> } {
  const internetMessageHeaders = [
    input.messageId ? { name: "Message-ID", value: formatOutboundMessageId(input.messageId) } : undefined,
    input.inReplyTo ? { name: "In-Reply-To", value: sanitizeHeader(input.inReplyTo) } : undefined,
    input.references?.length ? { name: "References", value: input.references.map(sanitizeHeader).filter(Boolean).join(" ") } : undefined
  ].filter((header): header is { name: string; value: string } => Boolean(header?.value));
  return internetMessageHeaders.length ? { internetMessageHeaders } : {};
}

function formatOutboundMessageId(value: string): string {
  const trimmed = sanitizeHeader(value);
  return trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed : `<${trimmed}@ai-agent-crm.local>`;
}

function encodeHeader(value: string): string {
  const sanitized = sanitizeHeader(value);
  return /[^\x20-\x7e]/.test(sanitized) ? `=?UTF-8?B?${Buffer.from(sanitized, "utf8").toString("base64")}?=` : sanitized;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function toGraphRecipient(address: string): { emailAddress: { address: string } } {
  return { emailAddress: { address } };
}

function toGraphAttachment(attachment: EmailAttachment): Record<string, unknown> {
  return {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: attachment.fileName,
    contentType: attachment.contentType || "application/octet-stream",
    contentBytes: normalizeBase64(attachment.contentBase64 ?? ""),
    ...(attachment.contentId ? { contentId: attachment.contentId, isInline: attachment.disposition === "inline" } : {})
  };
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

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n"]/g, " ").replace(/\s{2,}/g, " ").trim();
}

function formatAddressHeader(values: string[]): string {
  return values.map(sanitizeHeader).filter(Boolean).join(", ");
}

async function assertOk(response: Response, label: string): Promise<void> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${label} failed with HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
}

function parseGmailMessage(payload: unknown): InboundEmail | undefined {
  const message = payload as {
    id?: string;
    internalDate?: string;
    payload?: GmailPart & { headers?: Array<{ name?: string; value?: string }> };
    snippet?: string;
  };
  const headers = normalizeHeaders(message.payload?.headers ?? []);
  const from = headers.from;
  const to = parseAddressList(headers.to);
  const cc = parseAddressList(headers.cc);
  const subject = headers.subject || "(no subject)";
  const bodyText = decodeGmailBody(message.payload) || message.snippet || "(empty)";
  const attachments = collectGmailAttachments(message.payload, message.id);
  return from
    ? {
        externalMessageId: headers["message-id"] || message.id,
        from,
        to,
        ...(cc.length ? { cc } : {}),
        subject,
        bodyText,
        attachments,
        receivedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : undefined
      }
    : undefined;
}

function parseOutlookMessage(payload: unknown): InboundEmail | undefined {
  const message = payload as {
    id?: string;
    subject?: string;
    body?: { contentType?: string; content?: string };
    bodyPreview?: string;
    receivedDateTime?: string;
    hasAttachments?: boolean;
    attachments?: Array<{ id?: string; name?: string; contentType?: string; size?: number; isInline?: boolean; contentId?: string }>;
    from?: { emailAddress?: { address?: string } };
    toRecipients?: Array<{ emailAddress?: { address?: string } }>;
    ccRecipients?: Array<{ emailAddress?: { address?: string } }>;
  };
  const from = message.from?.emailAddress?.address;
  const cc = (message.ccRecipients ?? []).map((recipient) => recipient.emailAddress?.address).filter((address): address is string => Boolean(address));
  return from
    ? {
        externalMessageId: message.id,
        from,
        to: (message.toRecipients ?? []).map((recipient) => recipient.emailAddress?.address).filter((address): address is string => Boolean(address)),
        ...(cc.length ? { cc } : {}),
        subject: message.subject || "(no subject)",
        bodyText: parseOutlookBody(message.body, message.bodyPreview),
        attachments: collectOutlookAttachments(message),
        receivedAt: message.receivedDateTime
      }
    : undefined;
}

function normalizeHeaders(headers: Array<{ name?: string; value?: string }>): Record<string, string> {
  return Object.fromEntries(headers.filter((header) => header.name && header.value).map((header) => [header.name!.toLowerCase(), header.value!]));
}

function parseAddressList(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.match(/<([^>]+)>/)?.[1] ?? item)
    .map((item) => item.trim())
    .filter(Boolean);
}

interface GmailPart {
  filename?: string;
  mimeType?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: unknown[];
}

function decodeGmailBody(part: GmailPart | undefined): string {
  const parts = flattenGmailParts(part);
  const textPart = parts.find((candidate) => candidate.mimeType?.toLowerCase() === "text/plain" && candidate.body?.data);
  if (textPart?.body?.data) {
    return Buffer.from(textPart.body.data, "base64url").toString("utf8").trim();
  }
  const htmlPart = parts.find((candidate) => candidate.mimeType?.toLowerCase() === "text/html" && candidate.body?.data);
  if (htmlPart?.body?.data) {
    return stripHtml(Buffer.from(htmlPart.body.data, "base64url").toString("utf8"));
  }
  return "";
}

function flattenGmailParts(part: GmailPart | undefined): GmailPart[] {
  if (!part) {
    return [];
  }
  return [part, ...(part.parts ?? []).flatMap((child) => flattenGmailParts(child as GmailPart))];
}

function collectGmailAttachments(part: GmailPart | undefined, providerMessageId?: string): EmailAttachment[] | undefined {
  if (!part) {
    return undefined;
  }
  const current =
    part.filename && part.body?.attachmentId
      ? [
          {
            fileName: part.filename,
            contentType: part.mimeType || "application/octet-stream",
            size: Number.isFinite(Number(part.body.size)) ? Math.max(0, Number(part.body.size)) : 0,
            ...(providerMessageId ? { providerMessageId } : {}),
            providerAttachmentId: part.body.attachmentId
          }
        ]
      : [];
  const children = (part.parts ?? []).flatMap((child) => collectGmailAttachments(child as GmailPart, providerMessageId) ?? []);
  const attachments = [...current, ...children];
  return attachments.length ? attachments : undefined;
}

function parseOutlookBody(body: { contentType?: string; content?: string } | undefined, preview: string | undefined): string {
  const content = body?.content?.trim();
  if (!content) {
    return preview || "(empty)";
  }
  return body?.contentType?.toLowerCase() === "html" ? stripHtml(content) || preview || "(empty)" : content;
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

function collectOutlookAttachments(message: { id?: string; hasAttachments?: boolean; attachments?: Array<{ id?: string; name?: string; contentType?: string; size?: number; isInline?: boolean; contentId?: string }> }): EmailAttachment[] | undefined {
  const attachments = (message.attachments ?? [])
    .filter((attachment) => attachment.id && attachment.name)
    .map((attachment) => ({
      fileName: attachment.name!,
      contentType: attachment.contentType || "application/octet-stream",
      size: Number.isFinite(Number(attachment.size)) ? Math.max(0, Number(attachment.size)) : 0,
      ...(attachment.isInline ? { disposition: "inline" as const } : { disposition: "attachment" as const }),
      ...(attachment.contentId ? { contentId: attachment.contentId } : {}),
      ...(message.id ? { providerMessageId: message.id } : {}),
      providerAttachmentId: attachment.id!
    }));
  if (attachments.length) {
    return attachments;
  }
  return message.hasAttachments && message.id ? [{ fileName: "Outlook attachments", contentType: "application/octet-stream", size: 0, providerMessageId: message.id }] : undefined;
}
