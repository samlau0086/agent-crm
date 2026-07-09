import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { EmailConnectionConfig, EmailInboundConnectionConfig, EmailOutboundServiceConfig } from "@/lib/crm/types";

const CIPHER = "aes-256-gcm";
const VERSION = "v1";

export function encryptEmailConnectionConfig(config: EmailConnectionConfig, secret = process.env.EMAIL_CONFIG_SECRET ?? process.env.APP_SECRET ?? ""): string {
  const normalized = normalizeEmailConnectionConfig(config);
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(normalized), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptEmailConnectionConfig(value: string, secret = process.env.EMAIL_CONFIG_SECRET ?? process.env.APP_SECRET ?? ""): EmailConnectionConfig {
  const [version, ivText, tagText, ciphertextText] = value.split(".");
  if (version !== VERSION || !ivText || !tagText || !ciphertextText) {
    throw new Error("Email connection config is invalid");
  }
  const decipher = createDecipheriv(CIPHER, deriveKey(secret), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
  return normalizeEmailConnectionConfig(JSON.parse(plaintext) as EmailConnectionConfig);
}

export function normalizeEmailConnectionConfig(config: EmailConnectionConfig): EmailConnectionConfig {
  const inbound = normalizeInboundConnectionConfig(config.inbound ?? legacyInboundConfig(config));
  const outboundServices = normalizeOutboundServices(config.outboundServices ?? legacyOutboundServices(config));
  const defaultOutboundServiceId =
    outboundServices.find((service) => service.id === config.defaultOutboundServiceId)?.id ??
    outboundServices.find((service) => service.enabled !== false)?.id ??
    outboundServices[0]?.id;

  return {
    inbound,
    outboundServices,
    defaultOutboundServiceId,
    smtpHost: normalizeHost(config.smtpHost),
    smtpPort: normalizePort(config.smtpPort),
    smtpSecure: config.smtpSecure ?? true,
    smtpStartTls: config.smtpStartTls === true,
    syncProtocol: "imap",
    imapHost: normalizeHost(config.imapHost),
    imapPort: normalizePort(config.imapPort),
    imapSecure: config.imapSecure ?? true,
    username: config.username?.trim() || undefined,
    password: config.password ?? undefined,
    mailbox: config.mailbox?.trim() || "INBOX",
    oauthProvider: normalizeOAuthProvider(config.oauthProvider),
    accessToken: config.accessToken?.trim() || undefined,
    refreshToken: config.refreshToken?.trim() || undefined,
    tokenType: config.tokenType?.trim() || undefined,
    expiresAt: normalizeExpiresAt(config.expiresAt),
    scope: config.scope?.trim() || undefined
  };
}

export function getInboundConnectionConfig(config: EmailConnectionConfig): EmailConnectionConfig {
  const normalized = normalizeEmailConnectionConfig(config);
  const inbound = normalized.inbound;
  return {
    ...normalized,
    syncProtocol: inbound?.syncProtocol,
    imapHost: inbound?.imapHost,
    imapPort: inbound?.imapPort,
    imapSecure: inbound?.imapSecure,
    username: inbound?.username,
    password: inbound?.password,
    mailbox: inbound?.mailbox,
    oauthProvider: inbound?.oauthProvider,
    accessToken: inbound?.accessToken,
    refreshToken: inbound?.refreshToken,
    tokenType: inbound?.tokenType,
    expiresAt: inbound?.expiresAt,
    scope: inbound?.scope
  };
}

export function getDefaultOutboundService(config: EmailConnectionConfig): EmailOutboundServiceConfig | undefined {
  const normalized = normalizeEmailConnectionConfig(config);
  return (
    normalized.outboundServices?.find((service) => service.id === normalized.defaultOutboundServiceId && service.enabled !== false) ??
    normalized.outboundServices?.find((service) => service.enabled !== false)
  );
}

export function getOutboundSmtpConnectionConfig(config: EmailConnectionConfig, service = getDefaultOutboundService(config)): EmailConnectionConfig {
  if (!service || service.type !== "smtp") {
    throw new Error("Default outbound service is not SMTP");
  }
  return {
    ...normalizeEmailConnectionConfig(config),
    smtpHost: service.smtpHost,
    smtpPort: service.smtpPort,
    smtpSecure: service.smtpSecure,
    smtpStartTls: service.smtpStartTls,
    username: service.username,
    password: service.password
  };
}

function normalizeInboundConnectionConfig(config?: EmailInboundConnectionConfig): EmailInboundConnectionConfig | undefined {
  if (!config) {
    return undefined;
  }
  const normalized: EmailInboundConnectionConfig = {
    syncProtocol: "imap",
    imapHost: normalizeHost(config.imapHost),
    imapPort: normalizePort(config.imapPort),
    imapSecure: config.imapSecure ?? true,
    username: config.username?.trim() || undefined,
    password: config.password ?? undefined,
    mailbox: config.mailbox?.trim() || "INBOX",
    oauthProvider: normalizeOAuthProvider(config.oauthProvider),
    accessToken: config.accessToken?.trim() || undefined,
    refreshToken: config.refreshToken?.trim() || undefined,
    tokenType: config.tokenType?.trim() || undefined,
    expiresAt: normalizeExpiresAt(config.expiresAt),
    scope: config.scope?.trim() || undefined
  };
  return hasInboundConfig(normalized) ? normalized : undefined;
}

function normalizeOutboundServices(services?: EmailOutboundServiceConfig[]): EmailOutboundServiceConfig[] {
  return (services ?? []).map(normalizeOutboundService).filter((service): service is EmailOutboundServiceConfig => Boolean(service));
}

function normalizeOutboundService(service: EmailOutboundServiceConfig): EmailOutboundServiceConfig | undefined {
  const type = service.type === "resend" ? "resend" : "smtp";
  const normalized: EmailOutboundServiceConfig = {
    id: service.id?.trim() || type,
    name: service.name?.trim() || (type === "resend" ? "Resend" : "SMTP"),
    type,
    enabled: service.enabled !== false,
    fromEmail: service.fromEmail?.trim() || undefined,
    smtpHost: normalizeHost(service.smtpHost),
    smtpPort: normalizePort(service.smtpPort),
    smtpSecure: service.smtpSecure ?? true,
    smtpStartTls: service.smtpStartTls === true,
    username: service.username?.trim() || undefined,
    password: service.password ?? undefined,
    resendApiKey: service.resendApiKey?.trim() || undefined
  };
  if (type === "smtp" && !normalized.smtpHost && !normalized.username && !normalized.password) {
    return undefined;
  }
  if (type === "resend" && !normalized.resendApiKey) {
    return undefined;
  }
  return normalized;
}

function legacyInboundConfig(config: EmailConnectionConfig): EmailInboundConnectionConfig | undefined {
  if (!config.imapHost && !config.accessToken && !config.refreshToken && !config.username && !config.password) {
    return undefined;
  }
  return {
    syncProtocol: config.syncProtocol,
    imapHost: config.imapHost,
    imapPort: config.imapPort,
    imapSecure: config.imapSecure,
    username: config.username,
    password: config.password,
    mailbox: config.mailbox,
    oauthProvider: config.oauthProvider,
    accessToken: config.accessToken,
    refreshToken: config.refreshToken,
    tokenType: config.tokenType,
    expiresAt: config.expiresAt,
    scope: config.scope
  };
}

function legacyOutboundServices(config: EmailConnectionConfig): EmailOutboundServiceConfig[] {
  if (!config.smtpHost && !config.username && !config.password) {
    return [];
  }
  return [
    {
      id: "smtp",
      name: "SMTP",
      type: "smtp",
      smtpHost: config.smtpHost,
      smtpPort: config.smtpPort,
      smtpSecure: config.smtpSecure,
      smtpStartTls: config.smtpStartTls,
      username: config.username,
      password: config.password
    }
  ];
}

function hasInboundConfig(config: EmailInboundConnectionConfig): boolean {
  return Boolean(config.imapHost || config.username || config.password || config.accessToken || config.refreshToken);
}

function deriveKey(secret: string): Buffer {
  if (!secret || secret.length < 16) {
    throw new Error("EMAIL_CONFIG_SECRET or APP_SECRET must be at least 16 characters to store mailbox credentials");
  }
  return createHash("sha256").update(secret).digest();
}

function normalizeHost(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizePort(value?: number): number | undefined {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(65535, Math.max(1, Math.floor(value)));
}

function normalizeOAuthProvider(value?: EmailConnectionConfig["oauthProvider"]): EmailConnectionConfig["oauthProvider"] | undefined {
  return value === "gmail" || value === "outlook" || value === "custom" ? value : undefined;
}

function normalizeExpiresAt(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
