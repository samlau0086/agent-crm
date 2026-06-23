import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { EmailConnectionConfig } from "@/lib/crm/types";

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
  return {
    smtpHost: normalizeHost(config.smtpHost),
    smtpPort: normalizePort(config.smtpPort),
    smtpSecure: config.smtpSecure ?? true,
    smtpStartTls: config.smtpStartTls === true,
    syncProtocol: config.syncProtocol === "pop3" ? "pop3" : "imap",
    imapHost: normalizeHost(config.imapHost),
    imapPort: normalizePort(config.imapPort),
    imapSecure: config.imapSecure ?? true,
    pop3Host: normalizeHost(config.pop3Host),
    pop3Port: normalizePort(config.pop3Port),
    pop3Secure: config.pop3Secure ?? true,
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
