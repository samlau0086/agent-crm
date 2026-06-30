import { createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const webhookEvents = [
  "record.created",
  "record.updated",
  "record.deleted",
  "record.contacts.created",
  "record.contacts.updated",
  "record.contacts.deleted",
  "record.companies.created",
  "record.companies.updated",
  "record.companies.deleted",
  "record.deals.created",
  "record.deals.updated",
  "record.deals.deleted",
  "record.products.created",
  "record.products.updated",
  "record.products.deleted",
  "record.quotes.created",
  "record.quotes.updated",
  "record.quotes.deleted",
  "activity.created",
  "email.message.created",
  "email.thread.updated",
  "email.thread.deleted",
  "import.completed",
  "import.failed",
  "webhook.test"
] as const;

export type WebhookEvent = (typeof webhookEvents)[number] | `record.${string}.created` | `record.${string}.updated` | `record.${string}.deleted`;

const WEBHOOK_SECRET_BYTES = 32;
const WEBHOOK_SECRET_PREFIX = "whsec";
const WEBHOOK_SECRET_VISIBLE_PREFIX_LENGTH = 16;

export function createWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}_${randomBytes(WEBHOOK_SECRET_BYTES).toString("base64url")}`;
}

export function getWebhookSecretPrefix(secret: string): string {
  return secret.slice(0, WEBHOOK_SECRET_VISIBLE_PREFIX_LENGTH);
}

export function signWebhookPayload(secret: string, payload: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
}

export function buildWebhookSignatureHeader(secret: string, payload: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${signWebhookPayload(secret, payload, timestamp)}`;
}

export function assertValidWebhookEvents(events: string[]): WebhookEvent[] {
  const normalized = Array.from(new Set(events.map((event) => event.trim()).filter(Boolean)));
  if (normalized.length === 0) {
    throw new Error("Webhook must subscribe to at least one event");
  }
  if (normalized.some((event) => !isValidWebhookEvent(event))) {
    throw new Error("Webhook contains unsupported events");
  }
  return normalized as WebhookEvent[];
}

export function isValidWebhookEvent(event: string): event is WebhookEvent {
  return (webhookEvents as readonly string[]).includes(event) || isRecordObjectWebhookEvent(event);
}

export function expandWebhookEventsForPayload(event: WebhookEvent, data: Record<string, unknown>): WebhookEvent[] {
  const events = [event];
  const objectKey = typeof data.objectKey === "string" ? data.objectKey.trim() : "";
  const recordMatch = /^(record)\.(created|updated|deleted)$/.exec(event);
  if (recordMatch && objectKey && /^[a-z][a-z0-9-]*s$/.test(objectKey)) {
    events.push(`record.${objectKey}.${recordMatch[2]}` as WebhookEvent);
  }
  return Array.from(new Set(events));
}

function isRecordObjectWebhookEvent(event: string): boolean {
  return /^record\.[a-z][a-z0-9-]*s\.(created|updated|deleted)$/.test(event);
}

export function assertValidWebhookUrl(value: string, env: NodeJS.ProcessEnv = process.env): string {
  const url = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Webhook URL is invalid");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Webhook URL must not include credentials");
  }

  const isPrivateTarget = isPrivateWebhookHostname(parsed.hostname);
  const isPrivateAllowed = isPrivateWebhookUrlAllowed(env);

  if (parsed.protocol !== "https:" && !(isPrivateTarget && isPrivateAllowed)) {
    throw new Error("Webhook URL must use HTTPS");
  }

  if (!isPrivateAllowed && isPrivateTarget) {
    throw new Error("Webhook URL must not target localhost or private network addresses");
  }

  return url;
}

export async function assertWebhookDeliveryTarget(
  value: string,
  input: {
    env?: NodeJS.ProcessEnv;
    resolver?: (hostname: string) => Promise<Array<{ address: string; family?: number }>>;
  } = {}
): Promise<void> {
  const env = input.env ?? process.env;
  const parsed = new URL(assertValidWebhookUrl(value, env));
  if (isPrivateWebhookUrlAllowed(env)) {
    return;
  }

  const addresses = isIP(parsed.hostname)
    ? [{ address: parsed.hostname }]
    : await (input.resolver ?? defaultWebhookResolver)(parsed.hostname);

  if (addresses.length === 0 || addresses.some((entry) => isPrivateWebhookHostname(entry.address))) {
    throw new Error("Webhook resolved to a localhost or private network address");
  }
}

function isPrivateWebhookUrlAllowed(env: NodeJS.ProcessEnv): boolean {
  return env.ALLOW_PRIVATE_WEBHOOK_URLS === "true" || env.NODE_ENV !== "production";
}

function isPrivateWebhookHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return isPrivateIpv4(normalized);
  }
  if (ipVersion === 6) {
    return isPrivateIpv6(normalized);
  }

  return !normalized.includes(".");
}

function isPrivateIpv4(value: string): boolean {
  const parts = value.split(".").map((part) => Number(part));
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

async function defaultWebhookResolver(hostname: string): Promise<Array<{ address: string; family?: number }>> {
  return lookup(hostname, { all: true });
}
